import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const benchmark = path.join(root, "benchmarks", "organic-shell")
const requestedWorkspace = process.env.BENCHMARK_WORKSPACE
const workspace = requestedWorkspace ? path.resolve(requestedWorkspace) : await mkdtemp(path.join(os.tmpdir(), "cad-organic-benchmark-"))
const model = process.env.BENCHMARK_MODEL ?? "xai/grok-4.5"
const variant = process.env.BENCHMARK_VARIANT ?? "high"

await mkdir(workspace, { recursive: true })
const configHome = path.join(workspace, ".xdg-config")
const runtime = path.join(workspace, ".benchmark-runtime")
const forge = path.join(runtime, "forge")
const skill = path.join(workspace, ".opencode", "skills", "cad-studio")
const input = path.join(workspace, "input")
await mkdir(configHome, { recursive: true })
await mkdir(forge, { recursive: true })
await mkdir(skill, { recursive: true })
await mkdir(input, { recursive: true })

const pluginBuild = await Bun.build({
  entrypoints: [path.join(root, "src", "plugin.ts")],
  outdir: runtime,
  target: "bun",
  format: "esm",
  naming: "plugin.js",
})
if (!pluginBuild.success) throw new Error(`Failed to bundle benchmark plugin: ${pluginBuild.logs.join("\n")}`)
for (const name of ["forge_cli.py", "pyproject.toml", "uv.lock"]) {
  await copyFile(path.join(root, "forge", name), path.join(forge, name))
}
await copyFile(path.join(root, "skills", "cad-studio", "SKILL.md"), path.join(skill, "SKILL.md"))

await writeFile(
  path.join(workspace, "opencode.json"),
  JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      mcp: {
        build123d: {
          type: "local",
          command: ["uv", "tool", "run", "--python", "3.12", "build123d-mcp@0.3.77"],
          timeout: 120000,
          enabled: true,
        },
      },
      plugin: [
        [
          path.join(runtime, "plugin.js"),
          {
            studioRoot: workspace,
            forgeProjectDir: forge,
            companionUrl: "http://127.0.0.1:4173",
          },
        ],
      ],
    },
    null,
    2,
  ),
)

const prompt = await Bun.file(path.join(benchmark, "PROMPT.md")).text()
const references: string[] = []
for (const view of ["front", "side", "top", "iso"]) {
  const source = path.join(benchmark, `reference-${view}.png`)
  if (!(await Bun.file(source).exists())) throw new Error(`Missing benchmark reference: ${source}`)
  const destination = path.join(input, `reference-${view}.png`)
  await copyFile(source, destination)
  references.push(destination)
}

const command = [
  "opencode",
  "run",
  prompt,
  "--dir",
  workspace,
  "--model",
  model,
  "--variant",
  variant,
  "--agent",
  "build",
  "--auto",
  "--format",
  "json",
  "--title",
  "Manufactured freeform benchmark",
]
for (const reference of references) command.push("--file", reference)

console.log(`Benchmark workspace: ${workspace}`)
console.log(`Model: ${model} (${variant})`)

const child = Bun.spawn(command, {
  cwd: workspace,
  stdout: "pipe",
  stderr: "pipe",
  env: {
    ...process.env,
    XDG_CONFIG_HOME: configHome,
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
  },
})
const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
await writeFile(path.join(workspace, "run.jsonl"), stdout)
await writeFile(path.join(workspace, "stderr.log"), stderr)

if (stdout) process.stdout.write(stdout)
if (stderr) process.stderr.write(stderr)
if (exitCode !== 0) throw new Error(`Organic benchmark exited with ${exitCode}; workspace preserved at ${workspace}`)

console.log(`Benchmark completed; inspect ${workspace}`)
