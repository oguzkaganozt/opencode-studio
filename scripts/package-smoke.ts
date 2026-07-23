import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { configureStudios } from "../src/lifecycle"

const root = path.resolve(import.meta.dir, "..")
const staging = await mkdtemp(path.join(tmpdir(), "opencode-studio-pack-"))

try {
  const pack = Bun.spawn(["bun", "pm", "pack"], { cwd: root, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(pack.stdout).text(), new Response(pack.stderr).text(), pack.exited])
  if (code !== 0) throw new Error(`pack failed: ${err || out}`)
  const tarball = out
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.endsWith(".tgz"))
  if (!tarball) throw new Error(`Could not find tarball in pack output:\n${out}`)
  const tarballPath = path.join(root, tarball)

  const install = Bun.spawn(["bun", "add", tarballPath], { cwd: staging, stdout: "pipe", stderr: "pipe" })
  const installCode = await install.exited
  if (installCode !== 0) throw new Error(`install failed: ${await new Response(install.stderr).text()}`)

  const pkg = path.join(staging, "node_modules/opencode-studio")
  const plugin = await import(path.join(pkg, "dist/plugin.js"))
  if (typeof plugin.default !== "function") throw new Error("default export is not a plugin function")

  const provider = await import(path.join(pkg, "dist/media-provider.js"))
  if (typeof provider.createNativeMediaProvider !== "function") throw new Error("media-provider export missing")

  const mediaGo = await import(path.join(pkg, "dist/media-go.js"))
  if (typeof mediaGo.default !== "function") throw new Error("media-go export missing")

  for (const skill of ["cad", "media", "pcb", "startup"]) {
    const skillPath = path.join(pkg, "studios", skill, "skill", "SKILL.md")
    if (!(await Bun.file(skillPath).exists())) throw new Error(`missing packed skill: ${skill}`)
  }
  if (!(await Bun.file(path.join(pkg, "studios/cad/forge/forge_cli.py")).exists())) {
    throw new Error("missing packed forge_cli.py")
  }
  if (!(await Bun.file(path.join(pkg, "studios/cad/forge/.python-version")).exists())) {
    throw new Error("missing packed forge .python-version")
  }
  if (!(await Bun.file(path.join(pkg, "studios/cad/forge/uv.lock")).exists())) {
    throw new Error("missing packed forge uv.lock")
  }
  if (!(await Bun.file(path.join(pkg, "studios/cad/forge/pyproject.toml")).exists())) {
    throw new Error("missing packed forge pyproject.toml")
  }
  if (!(await Bun.file(path.join(pkg, "dist/ui/index.html")).exists())) {
    throw new Error("missing packed UI")
  }

  const cli = path.join(pkg, "dist/cli.js")
  const status = Bun.spawn(["bun", cli, "status", "--workspace", staging], { stdout: "pipe", stderr: "pipe" })
  const [cliOut, cliErr, cliCode] = await Promise.all([
    new Response(status.stdout).text(),
    new Response(status.stderr).text(),
    status.exited,
  ])
  if (cliCode !== 0) throw new Error(`cli status failed: ${cliErr || cliOut}`)

  // Configure from source package root for skill sources (packed package uses same layout)
  await configureStudios({
    workspace: staging,
    enabled: ["startup"],
    packageRoot: pkg,
    validateOpenCode: false,
  })
  const studioJson = JSON.parse(await readFile(path.join(staging, ".opencode/studio.json"), "utf8"))
  if (JSON.stringify(studioJson.enabled) !== JSON.stringify(["startup"])) throw new Error("configure failed in packed package")
  if (!(await Bun.file(path.join(staging, ".opencode/skills/startup-studio/SKILL.md")).exists())) {
    throw new Error("packed configure did not install skill")
  }

  console.log("package-smoke ok")
} finally {
  await rm(staging, { recursive: true, force: true })
  const tgz = Bun.spawn(["bash", "-lc", "rm -f opencode-studio-*.tgz"], { cwd: root })
  await tgz.exited
}
