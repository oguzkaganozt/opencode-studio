import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const temporary = await mkdtemp(path.join(os.tmpdir(), "opencode-media-studio-package-"))
const probe = Bun.serve({ port: 0, fetch: () => new Response("probe") })
const port = probe.port
probe.stop(true)

async function run(command: string[], cwd: string, expectedExitCode = 0) {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe", env: processEnv() })
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  if (exitCode !== expectedExitCode) {
    throw new Error(`${command.join(" ")} exited with ${exitCode}\n${stdout}\n${stderr}`)
  }
  return { stdout, stderr }
}

function processEnv() {
  const env = { ...process.env }
  delete env.FAL_KEY
  delete env.OPENCODE_AUTH_CONTENT
  return env
}

async function files(directory: string): Promise<string[]> {
  const output: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) output.push(...(await files(filePath)))
    else output.push(filePath)
  }
  return output
}

function relativeText(value: string) {
  return value.split("/").pop() ?? value
}

async function waitForHealth(origin: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await fetch(`${origin}/api/health`).catch(() => undefined)
    if (response?.ok) return response
    await Bun.sleep(25)
  }
  throw new Error(`Companion ${origin} never reported /api/health`)
}

try {
  const packed = await run([process.execPath, "pm", "pack", "--ignore-scripts", "--destination", temporary, "--quiet"], root)
  const archive = path.resolve(temporary, path.basename(packed.stdout.trim()))
  const listing = (await run(["tar", "-tzf", archive], root)).stdout.trim().split("\n")
  const forbidden = listing.filter((entry) =>
    /(^|\/)(src|test|scripts|node_modules|media|docs)(\/|$)|TODO\.md|AGENTS\.md|\.map$/.test(entry),
  )
  if (forbidden.length > 0) throw new Error(`Package contains forbidden files:\n${forbidden.join("\n")}`)
  for (const required of [
    "package/package.json",
    "package/LICENSE",
    "package/README.md",
    "package/opencode-studio.json",
    "package/skills/media-studio/SKILL.md",
    "package/dist/provider.js",
    "package/dist/plugin.js",
    "package/dist/server.js",
    "package/dist/cli.js",
    "package/dist/ui/index.html",
  ]) {
    if (!listing.includes(required)) throw new Error(`Package is missing ${required}`)
  }

  const project = path.join(temporary, "consumer")
  const studio = path.join(project, "studio")
  await mkdir(studio, { recursive: true })
  await writeFile(
    path.join(project, "package.json"),
    JSON.stringify(
      {
        name: "package-smoke",
        private: true,
        type: "module",
        dependencies: { "opencode-media-studio": `file:${archive}` },
      },
      null,
      2,
    ),
  )
  await run([process.execPath, "install"], project)
  await writeFile(
    path.join(project, "smoke.ts"),
    `
import { createNativeMediaProvider } from "opencode-media-studio"
import plugin from "opencode-media-studio/server"
import { createMediaStudioApp } from "opencode-media-studio/api"
if (typeof createNativeMediaProvider !== "function") throw new Error("package root export failed")
if (typeof plugin !== "function") throw new Error("server export failed")
if (typeof createMediaStudioApp !== "function") throw new Error("api export failed")
`,
  )
  await run([process.execPath, "smoke.ts"], project)

  const bin = path.join(project, "node_modules", ".bin", "opencode-media-studio")
  const usage = await run([bin], project, 1)
  if (!usage.stderr.includes("opencode-media-studio serve")) throw new Error("Packaged CLI usage failed")
  if (!usage.stderr.includes("opencode-media-studio install")) throw new Error("Packaged CLI must expose OSC install")
  if (!usage.stderr.includes("opencode-media-studio doctor")) throw new Error("Packaged CLI must expose OSC doctor")
  if (!usage.stderr.includes("service-install")) throw new Error("Packaged CLI must expose service-install")

  const configHome = path.join(temporary, "opencode-config")
  const installedSkill = path.join(configHome, "opencode", "skills", "media-studio", "SKILL.md")
  const markerFile = path.join(configHome, "opencode", "skills", "media-studio", ".osc-managed.json")
  await run([bin, "install", "--config-home", configHome], project)
  if (!(await readFile(installedSkill, "utf8")).includes("name: media-studio")) throw new Error("Packaged skill install failed")
  if (!(await Bun.file(markerFile).exists())) throw new Error("Packaged skill ownership marker missing")
  await run([bin, "install", "--config-home", configHome], project)
  await run([bin, "doctor", "--config-home", configHome, "--json"], project)
  await run([bin, "remove", "--config-home", configHome], project)
  if (await Bun.file(installedSkill).exists()) throw new Error("Packaged skill remove failed")

  const managedRoot = path.join(temporary, "managed-app")
  const installPreview = await run(
    [bin, "service-install", "--directory", path.join(temporary, "library"), "--install-root", managedRoot, "--dry-run"],
    project,
  )
  if (!installPreview.stdout.includes(`${managedRoot}/current/node_modules/opencode-media-studio/dist/cli.js`)) {
    throw new Error("Packaged managed-install preview did not use the stable current path")
  }

  const origin = `http://127.0.0.1:${port}`
  const server = Bun.spawn([bin, "serve", "--root", studio, "--host", "127.0.0.1", "--port", String(port)], {
    cwd: project,
    stdout: "pipe",
    stderr: "pipe",
    env: processEnv(),
  })
  try {
    await waitForHealth(origin)

    const healthResponse = await fetch(`${origin}/api/health`)
    const health = await healthResponse.json()
    if (JSON.stringify(health) !== JSON.stringify({ status: "ok" }))
      throw new Error(`Unexpected /api/health body: ${JSON.stringify(health)}`)
    if (healthResponse.headers.get("x-content-type-options") !== "nosniff") throw new Error("Missing nosniff header")
    if (!healthResponse.headers.get("content-security-policy")?.includes("default-src 'self'")) {
      throw new Error("Missing CSP header")
    }

    const studioIdentity = (await (await fetch(`${origin}/api/studio`)).json()) as {
      id?: string
      packageVersion?: string
      contractVersion?: string
    }
    if (studioIdentity.id !== "media" || !studioIdentity.packageVersion || !studioIdentity.contractVersion) {
      throw new Error(`Unexpected /api/studio body: ${JSON.stringify(studioIdentity)}`)
    }

    const version = (await (await fetch(`${origin}/api/version`)).json()) as Record<string, unknown>
    if (typeof version.running !== "string" || typeof version.installed !== "string" || typeof version.updateCommand !== "string") {
      throw new Error(`Unexpected /api/version body: ${JSON.stringify(version)}`)
    }

    const rootResponse = await fetch(`${origin}/`)
    if (!rootResponse.ok || !(await rootResponse.text()).includes("OpenCode Media Studio")) {
      throw new Error("Packaged companion UI did not start")
    }

    const assets = (await (await fetch(`${origin}/api/assets`)).json()) as Record<string, unknown>
    if (!Array.isArray(assets.assets)) throw new Error(`/api/assets did not return an assets array: ${JSON.stringify(assets)}`)
    if (typeof assets.hasMore !== "boolean") throw new Error(`/api/assets did not return hasMore: ${JSON.stringify(assets)}`)

    const missingAssets = await fetch(`${origin}/api/assets/not-a-real-ref`)
    if (missingAssets.status !== 404) throw new Error(`/api/assets/:ref should return 404, got ${missingAssets.status}`)

    for (const forbiddenPath of ["/api/jobs", "/api/events", "/api/catalog", "/api/auth/login", "/api/assets/upload"]) {
      const response = await fetch(`${origin}${forbiddenPath}`, { method: forbiddenPath.endsWith("upload") ? "POST" : "GET" })
      if (response.status !== 404) throw new Error(`${forbiddenPath} should return 404, got ${response.status}`)
    }
  } finally {
    server.kill("SIGTERM")
    await server.exited
  }

  const installed = path.join(project, "node_modules", "opencode-media-studio")
  const developmentPath = root
  const packedDist = path.join(installed, "dist")
  const distFiles = await files(packedDist)
  if (distFiles.length === 0) throw new Error("Packed dist directory is empty")
  for (const forbiddenArtifact of ["catalog.sqlite", "catalog.db", "opencode-media-studio.sqlite", ".opencode-media-studio.sqlite"]) {
    const matched = distFiles.find((filePath) => relativeText(filePath) === forbiddenArtifact)
    if (matched) throw new Error(`Packed dist contains catalog artifact: ${matched}`)
  }
  for (const filePath of distFiles) {
    const content = await readFile(filePath).catch(() => Buffer.alloc(0))
    const text = content.toString("utf8")
    if (text.includes(developmentPath)) throw new Error(`Artifact contains development path: ${filePath}`)
    if (/Bearer test-access|must-not-persist|test-key/.test(text)) throw new Error(`Artifact contains test credentials: ${filePath}`)
    if (/bun:sqlite|sql\.Statement|pragma journal_mode/.test(text)) {
      throw new Error(`Artifact contains SQLite primitives: ${filePath}`)
    }
    if (/catalog_job_id|stableAssetId|persistentCatalog/.test(text)) {
      throw new Error(`Artifact contains persistent catalog identifier: ${filePath}`)
    }
  }

  console.log(`Packed package smoke test passed: ${archive}`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
