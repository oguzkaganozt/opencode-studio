import { afterEach, describe, expect, test } from "bun:test"
import { access, mkdir, readFile, readlink, realpath, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import studioManifest from "../opencode-studio.json" with { type: "json" }
import manifest from "../package.json" with { type: "json" }
import { generateSystemdUnit, installService, managedInstallRootFromModule, startMediaStudioCli, updateService } from "../src/cli"
import { initializeLibrary } from "../src/library"

const root = path.join(import.meta.dir, ".cli-root")
const missingUi = path.join(import.meta.dir, ".missing-ui")
const deploymentHome = path.join(import.meta.dir, ".deployment-home")

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(missingUi, { recursive: true, force: true })
  await rm(deploymentHome, { recursive: true, force: true })
})

describe("companion CLI", () => {
  test("prints usage when no command is provided", async () => {
    const subprocess = Bun.spawn([process.execPath, "src/cli.ts"], {
      cwd: `${import.meta.dir}/..`,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, stderr] = await Promise.all([subprocess.exited, new Response(subprocess.stderr).text()])
    expect(exitCode).toBe(1)
    expect(stderr).toContain("opencode-media-studio serve --root")
  })

  test("serves an existing Library root without creating layout, reports it, and has no SQLite state", async () => {
    await mkdir(root, { recursive: true })
    const probe = Bun.serve({ port: 0, fetch: () => new Response("probe") })
    const port = probe.port
    probe.stop(true)
    const logs: string[] = []
    const warnings: string[] = []
    const running = (await startMediaStudioCli(["serve", "--root", root, "--host", "127.0.0.1", "--port", String(port)], {
      uiDirectory: missingUi,
      log: (message) => logs.push(message),
      warn: (message) => warnings.push(message),
    })) as { server: unknown; root: string; shutdown: () => Promise<void> }
    try {
      const canonicalRoot = await realpath(root)
      expect(running.root).toBe(canonicalRoot)
      expect(logs).toEqual(
        expect.arrayContaining([expect.stringContaining(`127.0.0.1:${port}`), expect.stringContaining(`Library root: ${canonicalRoot}`)]),
      )
      await expect(access(path.join(canonicalRoot, "users"))).rejects.toThrow()
      await expect(access(path.join(canonicalRoot, "shared", "images"))).rejects.toThrow()
      await expect(access(path.join(canonicalRoot, ".opencode-media-studio.sqlite"))).rejects.toThrow()
      expect(warnings).toEqual([expect.stringContaining("no application authentication")])
      expect(await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()).toEqual({ status: "ok" })
      const uiResponse = await fetch(`http://127.0.0.1:${port}/`)
      expect(uiResponse.status).toBe(503)
      expect(await uiResponse.json()).toEqual({ error: "Companion UI build not found; run bun run build:ui" })
    } finally {
      await running.shutdown()
    }
    await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow()
  })

  test("warns when serve uses deprecated --directory", async () => {
    await mkdir(root, { recursive: true })
    const probe = Bun.serve({ port: 0, fetch: () => new Response("probe") })
    const port = probe.port
    probe.stop(true)
    const warnings: string[] = []
    const running = (await startMediaStudioCli(["serve", "--directory", root, "--host", "127.0.0.1", "--port", String(port)], {
      uiDirectory: missingUi,
      warn: (message) => warnings.push(message),
    })) as { shutdown: () => Promise<void> }
    try {
      expect(warnings[0]).toContain("--directory is deprecated")
    } finally {
      await running.shutdown()
    }
  })

  test("serves filesystem-only endpoints with no jobs, events, catalog, or auth surface", async () => {
    await mkdir(root, { recursive: true })
    await initializeLibrary({ root, resolveUsername: () => process.env.USER ?? "unknown" })
    const probe = Bun.serve({ port: 0, fetch: () => new Response("probe") })
    const port = probe.port
    probe.stop(true)
    const running = (await startMediaStudioCli(["serve", "--root", root, "--host", "127.0.0.1", "--port", String(port)], {
      uiDirectory: missingUi,
    })) as { server: unknown; root: string; shutdown: () => Promise<void> }
    try {
      const origin = `http://127.0.0.1:${port}`
      const health = await (await fetch(`${origin}/api/health`)).json()
      expect(health).toEqual({ status: "ok" })

      const assets = (await (await fetch(`${origin}/api/assets`)).json()) as Record<string, unknown>
      expect(Object.keys(assets).sort()).toEqual(["assets", "hasMore"])
      expect(Array.isArray(assets.assets)).toBe(true)
      expect(assets.hasMore).toBe(false)

      const detail = await fetch(`${origin}/api/assets/${Buffer.from("users/me/images/missing.png").toString("base64url")}`)
      expect(detail.status).toBe(404)

      for (const forbiddenPath of [
        "/api/jobs",
        "/api/events",
        "/api/catalog",
        "/api/catalog/assets",
        "/api/catalog.sqlite",
        "/api/auth/login",
        "/api/login",
        "/api/tls",
        "/api/providers",
        "/api/sessions",
      ]) {
        const response = await fetch(`${origin}${forbiddenPath}`)
        expect(response.status).toBe(404)
      }

      const studio = await (await fetch(`${origin}/api/studio`)).json()
      expect(studio).toEqual({
        id: studioManifest.id,
        packageVersion: manifest.version,
        contractVersion: studioManifest.contractVersion,
      })

      const crossOriginUpload = await fetch(`${origin}/api/assets/upload`, {
        method: "POST",
        headers: { Origin: "https://attacker.example", "Content-Type": "multipart/form-data; boundary=x" },
        body: "--x--",
      })
      expect(crossOriginUpload.status).toBe(404)

      const crossOriginDelete = await fetch(`${origin}/api/assets/${Buffer.from("shared/images/x.png").toString("base64url")}`, {
        method: "DELETE",
        headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      })
      expect(crossOriginDelete.status).toBe(404)
    } finally {
      await running.shutdown()
    }
  })

  test("rejects removed mutation endpoints", async () => {
    await mkdir(root, { recursive: true })
    const probe = Bun.serve({ port: 0, fetch: () => new Response("probe") })
    const port = probe.port
    probe.stop(true)
    const running = (await startMediaStudioCli(["serve", "--root", root, "--host", "127.0.0.1", "--port", String(port)], {
      uiDirectory: missingUi,
    })) as { server: unknown; root: string; shutdown: () => Promise<void> }
    try {
      const origin = `http://127.0.0.1:${port}`
      const username = process.env.USER ?? "unknown"

      const createResponse = await fetch(`${origin}/api/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ scope: "personal", modality: "image", user: username, name: "project1" }),
      })
      expect(createResponse.status).toBe(404)
    } finally {
      await running.shutdown()
    }
  })
})

describe("generateSystemdUnit", () => {
  test("infers a managed root from an immutable release module", () => {
    expect(
      managedInstallRootFromModule(
        "/home/alice/.local/share/opencode-media-studio/app/releases/1.2.0/node_modules/opencode-media-studio/dist/cli.js",
      ),
    ).toBe("/home/alice/.local/share/opencode-media-studio/app")
    expect(managedInstallRootFromModule("/workspace/src/cli.ts")).toBeUndefined()
  })

  test("system service uses the shared current release with hardening", () => {
    const unit = generateSystemdUnit({
      scope: "system",
      libraryRoot: "/srv/opencode-media-studio",
      installRoot: "/opt/opencode-media-studio",
      host: "127.0.0.1",
      port: 4173,
      bunPath: "/usr/local/bin/bun",
    })
    expect(unit).toContain("User=opencode-companion")
    expect(unit).toContain("Group=opencode-media")
    expect(unit).toContain('WorkingDirectory="/srv/opencode-media-studio"')
    expect(unit).toContain(
      'ExecStart="/usr/local/bin/bun" "/opt/opencode-media-studio/current/node_modules/opencode-media-studio/dist/cli.js" serve --root "/srv/opencode-media-studio" --host "127.0.0.1" --port 4173',
    )
    expect(unit).toContain('Environment="OPENCODE_MEDIA_STUDIO_INSTALL_ROOT=/opt/opencode-media-studio"')
    expect(unit).toContain("NoNewPrivileges=true")
    expect(unit).toContain("ProtectSystem=strict")
    expect(unit).toContain('ReadWritePaths="/srv/opencode-media-studio"')
    expect(unit).toContain("WantedBy=multi-user.target")
  })

  test("user service uses a user-owned current release without system hardening", () => {
    const unit = generateSystemdUnit({
      scope: "user",
      libraryRoot: "/home/alice/library",
      installRoot: "/home/alice/.local/share/opencode-media-studio/app",
      host: "127.0.0.1",
      port: 4173,
      bunPath: "/home/alice/.bun/bin/bun",
    })
    expect(unit).not.toContain("User=")
    expect(unit).not.toContain("ProtectSystem")
    expect(unit).toContain(
      'ExecStart="/home/alice/.bun/bin/bun" "/home/alice/.local/share/opencode-media-studio/app/current/node_modules/opencode-media-studio/dist/cli.js" serve --root "/home/alice/library" --host "127.0.0.1" --port 4173',
    )
    expect(unit).toContain("WantedBy=default.target")
  })
})

function fakeDeploymentRunner(input: {
  commands: string[]
  serviceEnabled?: boolean
  serviceActive?: boolean
  failRestartOnce?: boolean
  failEnableOnce?: boolean
}) {
  let failRestart = input.failRestartOnce ?? false
  let failEnable = input.failEnableOnce ?? false
  return async (command: string, args: string[]) => {
    input.commands.push([command, ...args].join(" "))
    if (command === "npm" && args[0] === "view") return { exitCode: 0, stdout: '"9.9.9"\n', stderr: "" }
    if (command === "npm" && args[0] === "install") {
      const prefix = args[args.indexOf("--prefix") + 1]!
      const version = args.at(-1)!.split("@").at(-1)!
      const packageRoot = path.join(prefix, "node_modules/opencode-media-studio")
      await mkdir(path.join(packageRoot, "dist/ui"), { recursive: true })
      for (const dependency of Object.keys(manifest.dependencies)) {
        await mkdir(path.join(prefix, "node_modules", dependency), { recursive: true })
        await writeFile(
          path.join(prefix, "node_modules", dependency, "package.json"),
          JSON.stringify({ name: dependency, version: "1.0.0" }),
        )
      }
      await writeFile(
        path.join(packageRoot, "package.json"),
        JSON.stringify({ name: "opencode-media-studio", version, dependencies: manifest.dependencies }),
      )
      await writeFile(path.join(packageRoot, "dist/cli.js"), "console.error('Usage: opencode-media-studio serve')")
      await writeFile(path.join(packageRoot, "dist/plugin.js"), "export default function plugin() {}")
      await writeFile(path.join(packageRoot, "dist/provider.js"), "export const provider = true")
      await writeFile(path.join(packageRoot, "dist/ui/index.html"), "<title>OpenCode Media Studio</title>")
      return { exitCode: 0, stdout: "", stderr: "" }
    }
    if (command === "/usr/bin/bun") return { exitCode: 1, stdout: "", stderr: "Usage: opencode-media-studio serve" }
    if (args.includes("is-enabled")) return { exitCode: input.serviceEnabled === false ? 1 : 0, stdout: "", stderr: "" }
    if (args.includes("is-active")) return { exitCode: input.serviceActive === false ? 1 : 0, stdout: "", stderr: "" }
    if (args.includes("enable") && failEnable) {
      failEnable = false
      return { exitCode: 1, stdout: "", stderr: "enable failed" }
    }
    if (args.includes("restart") && failRestart) {
      failRestart = false
      return { exitCode: 1, stdout: "", stderr: "restart failed" }
    }
    return { exitCode: 0, stdout: "", stderr: "" }
  }
}

function managedHealthFetcher(installRoot: string, failVersion?: string) {
  return async (input: string | URL | Request) => {
    const packageInfo = JSON.parse(
      await readFile(path.join(installRoot, "current/node_modules/opencode-media-studio/package.json"), "utf8"),
    ) as { version: string }
    if (String(input).endsWith("/api/health")) {
      return packageInfo.version === failVersion ? Response.json({ error: "starting" }, { status: 503 }) : Response.json({ status: "ok" })
    }
    return Response.json({ running: packageInfo.version })
  }
}

describe("managed installation and update", () => {
  test("dry-run prints a user unit without side effects", async () => {
    const logs: string[] = []
    const commands: string[] = []
    const installRoot = path.join(deploymentHome, "app")
    const result = await installService(
      ["install", "--directory", path.join(deploymentHome, "library"), "--install-root", installRoot, "--dry-run"],
      {
        log: (message) => logs.push(message),
        getuid: () => 1000,
        homedir: () => deploymentHome,
        bunPath: "/usr/bin/bun",
        runCommand: fakeDeploymentRunner({ commands }),
      },
    )
    expect(result.installed).toBe(false)
    expect(commands).toEqual([])
    expect(logs[0]).toContain(`${installRoot}/current/node_modules/opencode-media-studio/dist/cli.js`)
    await expect(access(installRoot)).rejects.toThrow()
  })

  test("installs one immutable user release and points systemd at current", async () => {
    const commands: string[] = []
    const installRoot = path.join(deploymentHome, "app")
    const result = await installService(["install", "--directory", path.join(deploymentHome, "library"), "--install-root", installRoot], {
      getuid: () => 1000,
      homedir: () => deploymentHome,
      bunPath: "/usr/bin/bun",
      runCommand: fakeDeploymentRunner({ commands }),
      fetcher: managedHealthFetcher(installRoot),
      sleep: async () => {},
    })
    expect(result.installed).toBe(true)
    expect(result.scope).toBe("user")
    expect(await readlink(path.join(installRoot, "current"))).toBe(`releases/${manifest.version}`)
    expect(await readFile(path.join(deploymentHome, ".config/systemd/user/opencode-media-studio.service"), "utf8")).toContain(
      `${installRoot}/current/node_modules/opencode-media-studio/dist/cli.js`,
    )
    expect(commands).toEqual(
      expect.arrayContaining([
        expect.stringContaining("npm install --prefix"),
        "systemctl --user daemon-reload",
        "systemctl --user enable --now opencode-media-studio",
      ]),
    )
  })

  test("updates current and restarts a managed companion", async () => {
    const commands: string[] = []
    const installRoot = path.join(deploymentHome, "app")
    const dependencies = {
      getuid: () => 1000,
      homedir: () => deploymentHome,
      bunPath: "/usr/bin/bun",
      runCommand: fakeDeploymentRunner({ commands }),
      fetcher: managedHealthFetcher(installRoot),
      sleep: async () => {},
    }
    await installService(["install", "--install-root", installRoot], dependencies)
    const result = await updateService(["update", "--version", "9.9.9", "--install-root", installRoot], dependencies)
    expect(result).toMatchObject({ updated: true, version: "9.9.9", restarted: true })
    expect(await readlink(path.join(installRoot, "current"))).toBe("releases/9.9.9")
    expect(commands).toContain("systemctl --user restart opencode-media-studio")
  })

  test("updates an active managed companion even when its unit is disabled", async () => {
    const commands: string[] = []
    const installRoot = path.join(deploymentHome, "app")
    await installService(["install", "--install-root", installRoot], {
      getuid: () => 1000,
      homedir: () => deploymentHome,
      bunPath: "/usr/bin/bun",
      runCommand: fakeDeploymentRunner({ commands }),
      fetcher: managedHealthFetcher(installRoot),
      sleep: async () => {},
    })
    const result = await updateService(["update", "--version", "9.9.9", "--install-root", installRoot], {
      getuid: () => 1000,
      homedir: () => deploymentHome,
      runCommand: fakeDeploymentRunner({ commands, serviceEnabled: false, serviceActive: true }),
      fetcher: managedHealthFetcher(installRoot),
      sleep: async () => {},
    })
    expect(result).toMatchObject({ updated: true, restarted: true })
    expect(commands).toContain("systemctl --user restart opencode-media-studio")
  })

  test("updates a standalone installation without requiring a service", async () => {
    const commands: string[] = []
    const installRoot = path.join(deploymentHome, "app")
    await installService(["install", "--install-root", installRoot, "--no-service"], {
      getuid: () => 1000,
      homedir: () => deploymentHome,
      bunPath: "/usr/bin/bun",
      runCommand: fakeDeploymentRunner({ commands, serviceEnabled: false }),
      fetcher: managedHealthFetcher(installRoot),
      sleep: async () => {},
    })
    const result = await updateService(["update", "--install-root", installRoot], {
      getuid: () => 1000,
      homedir: () => deploymentHome,
      bunPath: "/usr/bin/bun",
      runCommand: fakeDeploymentRunner({ commands, serviceEnabled: false }),
    })
    expect(result).toMatchObject({ updated: true, version: "9.9.9", restarted: false })
    expect(await readlink(path.join(installRoot, "current"))).toBe("releases/9.9.9")
    expect(commands.some((command) => command.includes("restart opencode-media-studio"))).toBe(false)
  })

  test("refuses to mark an active managed service as standalone", async () => {
    const commands: string[] = []
    const installRoot = path.join(deploymentHome, "app")
    const dependencies = {
      getuid: () => 1000,
      homedir: () => deploymentHome,
      bunPath: "/usr/bin/bun",
      runCommand: fakeDeploymentRunner({ commands }),
      fetcher: managedHealthFetcher(installRoot),
      sleep: async () => {},
    }
    await installService(["install", "--install-root", installRoot], dependencies)
    await expect(installService(["install", "--install-root", installRoot, "--no-service"], dependencies)).rejects.toThrow(
      "Disable opencode-media-studio.service",
    )
    expect(JSON.parse(await readFile(path.join(installRoot, "deployment.json"), "utf8"))).toMatchObject({ service: true })
  })

  test("restarts an active service when install settings change", async () => {
    const commands: string[] = []
    const installRoot = path.join(deploymentHome, "app")
    const dependencies = {
      getuid: () => 1000,
      homedir: () => deploymentHome,
      bunPath: "/usr/bin/bun",
      runCommand: fakeDeploymentRunner({ commands }),
      fetcher: managedHealthFetcher(installRoot),
      sleep: async () => {},
    }
    await installService(["install", "--install-root", installRoot], dependencies)
    commands.length = 0
    await installService(["install", "--install-root", installRoot, "--port", "4180"], dependencies)
    expect(commands).toContain("systemctl --user restart opencode-media-studio")
    expect(await readFile(path.join(deploymentHome, ".config/systemd/user/opencode-media-studio.service"), "utf8")).toContain("--port 4180")
  })

  test("rolls back current when the managed companion cannot restart", async () => {
    const commands: string[] = []
    const installRoot = path.join(deploymentHome, "app")
    await installService(["install", "--install-root", installRoot], {
      getuid: () => 1000,
      homedir: () => deploymentHome,
      bunPath: "/usr/bin/bun",
      runCommand: fakeDeploymentRunner({ commands }),
      fetcher: managedHealthFetcher(installRoot),
      sleep: async () => {},
    })
    await expect(
      updateService(["update", "--version", "9.9.9", "--install-root", installRoot], {
        getuid: () => 1000,
        homedir: () => deploymentHome,
        bunPath: "/usr/bin/bun",
        runCommand: fakeDeploymentRunner({ commands, failRestartOnce: true }),
        fetcher: managedHealthFetcher(installRoot),
        sleep: async () => {},
      }),
    ).rejects.toThrow("Could not restart")
    expect(await readlink(path.join(installRoot, "current"))).toBe(`releases/${manifest.version}`)
  })

  test("rolls back when a restarted companion fails its health check", async () => {
    const commands: string[] = []
    const installRoot = path.join(deploymentHome, "app")
    const healthy = {
      getuid: () => 1000,
      homedir: () => deploymentHome,
      bunPath: "/usr/bin/bun",
      runCommand: fakeDeploymentRunner({ commands }),
      fetcher: managedHealthFetcher(installRoot),
      sleep: async () => {},
    }
    await installService(["install", "--install-root", installRoot], healthy)
    await expect(
      updateService(["update", "--version", "9.9.9", "--install-root", installRoot], {
        ...healthy,
        fetcher: managedHealthFetcher(installRoot, "9.9.9"),
      }),
    ).rejects.toThrow("Companion health check failed")
    expect(await readlink(path.join(installRoot, "current"))).toBe(`releases/${manifest.version}`)
  })

  test("restores a fresh installation when systemd enable fails", async () => {
    const commands: string[] = []
    const installRoot = path.join(deploymentHome, "app")
    const unitPath = path.join(deploymentHome, ".config/systemd/user/opencode-media-studio.service")
    await expect(
      installService(["install", "--install-root", installRoot], {
        getuid: () => 1000,
        homedir: () => deploymentHome,
        bunPath: "/usr/bin/bun",
        runCommand: fakeDeploymentRunner({ commands, serviceEnabled: false, failEnableOnce: true }),
        fetcher: managedHealthFetcher(installRoot),
        sleep: async () => {},
      }),
    ).rejects.toThrow("systemctl enable --now failed")
    await expect(readlink(path.join(installRoot, "current"))).rejects.toThrow()
    await expect(access(unitPath)).rejects.toThrow()
    expect(commands).toContain("systemctl --user disable --now opencode-media-studio")
  })

  test("restores active-but-disabled service state after a failed reinstall", async () => {
    const commands: string[] = []
    const installRoot = path.join(deploymentHome, "app")
    await installService(["install", "--install-root", installRoot], {
      getuid: () => 1000,
      homedir: () => deploymentHome,
      bunPath: "/usr/bin/bun",
      runCommand: fakeDeploymentRunner({ commands }),
      fetcher: managedHealthFetcher(installRoot),
      sleep: async () => {},
    })
    commands.length = 0
    await expect(
      installService(["install", "--install-root", installRoot, "--port", "4180"], {
        getuid: () => 1000,
        homedir: () => deploymentHome,
        bunPath: "/usr/bin/bun",
        runCommand: fakeDeploymentRunner({ commands, serviceEnabled: false, serviceActive: true, failRestartOnce: true }),
        fetcher: managedHealthFetcher(installRoot),
        sleep: async () => {},
      }),
    ).rejects.toThrow("systemctl restart failed")
    expect(commands).toContain("systemctl --user disable opencode-media-studio")
  })

  test("rejects invalid input and concurrent updates", async () => {
    await expect(installService(["install", "--port", "99999"])).rejects.toThrow("Invalid port")
    expect(() =>
      generateSystemdUnit({
        scope: "system",
        libraryRoot: "/srv/opencode-media-studio",
        installRoot: "/opt/opencode-media-studio",
        host: "127.0.0.1",
        port: 4173,
        bunPath: "/usr/local/bin/bun",
        serviceUser: "bad\nUser=root",
      }),
    ).toThrow("Invalid service user")

    const installRoot = path.join(deploymentHome, "app")
    const commands: string[] = []
    await installService(["install", "--install-root", installRoot, "--no-service"], {
      getuid: () => 1000,
      homedir: () => deploymentHome,
      bunPath: "/usr/bin/bun",
      runCommand: fakeDeploymentRunner({ commands, serviceEnabled: false }),
    })
    await mkdir(path.join(installRoot, ".update-lock"), { recursive: true })
    await expect(
      updateService(["update", "--version", "9.9.9", "--install-root", installRoot], {
        getuid: () => 1000,
        homedir: () => deploymentHome,
        bunPath: "/usr/bin/bun",
        runCommand: fakeDeploymentRunner({ commands }),
      }),
    ).rejects.toThrow("Another OpenCode Media Studio")
  })

  test("recovers a lock left by a dead updater", async () => {
    const installRoot = path.join(deploymentHome, "app")
    const commands: string[] = []
    const dependencies = {
      getuid: () => 1000,
      homedir: () => deploymentHome,
      bunPath: "/usr/bin/bun",
      runCommand: fakeDeploymentRunner({ commands, serviceEnabled: false }),
      processAlive: () => false,
      now: () => 10_000,
    }
    await installService(["install", "--install-root", installRoot, "--no-service"], dependencies)
    const lockPath = path.join(installRoot, ".update-lock")
    await mkdir(lockPath)
    await writeFile(path.join(lockPath, "owner.json"), JSON.stringify({ pid: 999_999, startedAt: 1_000 }))
    const result = await updateService(["update", "--version", "9.9.9", "--install-root", installRoot], dependencies)
    expect(result).toMatchObject({ updated: true, version: "9.9.9", restarted: false })
  })
})
