import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const temporary = await mkdtemp(path.join(os.tmpdir(), "opencode-pcb-studio-package-"))
const portProbe = Bun.serve({ port: 0, fetch: () => new Response("probe") })
const port = portProbe.port
portProbe.stop(true)

async function run(command: string[], cwd: string, expectedExitCode = 0) {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env } })
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  if (exitCode !== expectedExitCode) throw new Error(`${command.join(" ")} exited with ${exitCode}\n${stdout}\n${stderr}`)
  return { stdout, stderr }
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

async function waitForHealth(origin: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await fetch(`${origin}/api/health`).catch(() => undefined)
    if (response?.ok) return
    await Bun.sleep(25)
  }
  throw new Error(`Companion ${origin} never reported /api/health`)
}

try {
  const packed = await run([process.execPath, "pm", "pack", "--ignore-scripts", "--destination", temporary, "--quiet"], root)
  const archive = path.resolve(temporary, path.basename(packed.stdout.trim()))
  const listing = (await run(["tar", "-tzf", archive], root)).stdout.trim().split("\n")

  const forbidden = listing.filter((entry) => /(^|\/)(src|test|scripts|authoring|docs|node_modules)(\/|$)|PLAN\.md|\.map$/.test(entry))
  if (forbidden.length > 0) throw new Error(`Package contains forbidden files:\n${forbidden.join("\n")}`)
  if (listing.includes("package/AGENTS.md")) throw new Error("Package must not contain prompt-injected AGENTS.md")

  for (const required of [
    "package/package.json",
    "package/LICENSE",
    "package/README.md",
    "package/opencode-studio.json",
    "package/skills/pcb-studio/SKILL.md",
    "package/dist/plugin.js",
    "package/dist/server.js",
    "package/dist/cli.js",
    "package/dist/ui/index.html",
  ]) {
    if (!listing.includes(required)) throw new Error(`Package is missing ${required}`)
  }

  const consumer = path.join(temporary, "consumer")
  const studio = path.join(consumer, "studio")
  await mkdir(studio, { recursive: true })
  await writeFile(
    path.join(consumer, "package.json"),
    JSON.stringify({
      name: "pcb-package-smoke",
      private: true,
      type: "module",
      dependencies: { "opencode-pcb-studio": `file:${archive}` },
    }),
  )
  await run([process.execPath, "install"], consumer)
  await writeFile(
    path.join(consumer, "smoke.ts"),
    `
import plugin from "opencode-pcb-studio/server"
import { createPcbStudioApp } from "opencode-pcb-studio/api"
if (typeof plugin !== "function") throw new Error("package plugin export failed")
if (typeof createPcbStudioApp !== "function") throw new Error("package API export failed")
const hooks = await plugin({ directory: ${JSON.stringify(studio)}, worktree: ${JSON.stringify(studio)} })
if (!hooks.tool?.pcb_workspace_list) throw new Error("packaged plugin tools failed")
if (hooks["experimental.chat.system.transform"]) throw new Error("packaged plugin must not modify the system prompt")
`,
  )
  await run([process.execPath, "smoke.ts"], consumer)

  const bin = path.join(consumer, "node_modules", ".bin", "opencode-pcb-studio")
  const usage = await run([bin], consumer, 1)
  if (!usage.stderr.includes("opencode-pcb-studio serve")) throw new Error("Packaged CLI usage failed")
  if (!usage.stderr.includes("opencode-pcb-studio install")) throw new Error("Packaged CLI must expose OSC install")
  if (!usage.stderr.includes("opencode-pcb-studio doctor")) throw new Error("Packaged CLI must expose OSC doctor")

  const configHome = path.join(temporary, "opencode-config")
  const installedSkill = path.join(configHome, "opencode", "skills", "pcb-studio", "SKILL.md")
  const markerFile = path.join(configHome, "opencode", "skills", "pcb-studio", ".osc-managed.json")
  await run([bin, "install", "--config-home", configHome], consumer)
  if (!(await readFile(installedSkill, "utf8")).includes("name: pcb-studio")) throw new Error("Packaged skill install failed")
  if (!(await Bun.file(markerFile).exists())) throw new Error("Packaged skill ownership marker missing")
  await run([bin, "install", "--config-home", configHome], consumer)
  await run([bin, "doctor", "--config-home", configHome, "--json"], consumer)
  await run([bin, "remove", "--config-home", configHome], consumer)
  if (await Bun.file(installedSkill).exists()) throw new Error("Packaged skill remove failed")

  const origin = `http://127.0.0.1:${port}`
  const server = Bun.spawn([bin, "serve", "--root", studio, "--host", "127.0.0.1", "--port", String(port)], {
    cwd: consumer,
    stdout: "pipe",
    stderr: "pipe",
  })
  try {
    await waitForHealth(origin)
    const healthResponse = await fetch(`${origin}/api/health`)
    const health = await healthResponse.json()
    if (JSON.stringify(health) !== JSON.stringify({ status: "ok" })) throw new Error(`Unexpected health body: ${JSON.stringify(health)}`)
    if (healthResponse.headers.get("x-content-type-options") !== "nosniff") throw new Error("Missing nosniff header")
    if (!healthResponse.headers.get("content-security-policy")?.includes("default-src 'self'")) {
      throw new Error("Missing CSP header")
    }

    const studioIdentity = (await (await fetch(`${origin}/api/studio`)).json()) as {
      id?: string
      packageVersion?: string
      contractVersion?: string
    }
    if (studioIdentity.id !== "pcb" || !studioIdentity.packageVersion || !studioIdentity.contractVersion) {
      throw new Error(`Unexpected /api/studio body: ${JSON.stringify(studioIdentity)}`)
    }

    const projects = (await (await fetch(`${origin}/api/projects`)).json()) as { projects?: unknown }
    if (!Array.isArray(projects.projects)) throw new Error("/api/projects did not return an array")

    const rootResponse = await fetch(origin)
    if (!rootResponse.ok || !(await rootResponse.text()).includes("PCB Studio")) throw new Error("Packaged companion UI did not start")
  } finally {
    server.kill("SIGTERM")
    await server.exited
  }

  const installed = path.join(consumer, "node_modules", "opencode-pcb-studio")
  for (const filePath of await files(path.join(installed, "dist"))) {
    const text = (await readFile(filePath).catch(() => Buffer.alloc(0))).toString("utf8")
    if (text.includes(root)) throw new Error(`Artifact contains development path: ${filePath}`)
  }

  console.log(`Packed package smoke test passed: ${archive}`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
