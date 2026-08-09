import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { configureStudios } from "../src/lifecycle"

const root = path.resolve(import.meta.dir, "..")
const staging = await mkdtemp(path.join(tmpdir(), "opencode-studio-pack-"))
let tarballPath: string | undefined

try {
  const pack = Bun.spawn(["bun", "pm", "pack"], { cwd: root, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(pack.stdout).text(), new Response(pack.stderr).text(), pack.exited])
  if (code !== 0) throw new Error(`pack failed: ${err || out}`)
  const tarball = out
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.endsWith(".tgz"))
  if (!tarball) throw new Error(`Could not find tarball in pack output:\n${out}`)
  tarballPath = path.join(root, tarball)

  const install = Bun.spawn(["bun", "add", tarballPath], { cwd: staging, stdout: "pipe", stderr: "pipe" })
  const installCode = await install.exited
  if (installCode !== 0) throw new Error(`install failed: ${await new Response(install.stderr).text()}`)

  const pkgName = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).name as string
  const pkg = path.join(staging, "node_modules", ...pkgName.split("/"))
  const plugin = await import(path.join(pkg, "dist/plugin.js"))
  if (typeof plugin.default !== "function") throw new Error("default export is not a plugin function")

  const provider = await import(path.join(pkg, "dist/media-provider.js"))
  if (typeof provider.createNativeMediaProvider !== "function") throw new Error("media-provider export missing")

  const mediaGo = await import(path.join(pkg, "dist/media-go.js"))
  if (typeof mediaGo.default !== "function") throw new Error("media-go export missing")

  for (const skill of ["cad", "pcb"]) {
    const skillPath = path.join(pkg, "studios", skill, "skill", "SKILL.md")
    if (!(await Bun.file(skillPath).exists())) throw new Error(`missing packed skill: ${skill}`)
  }
  if (!(await Bun.file(path.join(pkg, "src/platform/media/skill/SKILL.md")).exists())) {
    throw new Error("missing packed platform media skill")
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

  const studioConfigHome = path.join(staging, "studio-config")
  const openCodeHome = path.join(staging, "opencode-config")
  const domain = path.join(staging, "domain")
  await import("node:fs/promises").then(({ mkdir }) => mkdir(domain, { recursive: true }))

  const cli = path.join(pkg, "dist/cli.js")
  const cliEnv = {
    ...process.env,
    OPENCODE_STUDIO_CONFIG_HOME: studioConfigHome,
    OPENCODE_CONFIG_HOME: openCodeHome,
  }

  // Pre-repair status may exit 1 (missing skills); still must print package line.
  const preStatus = Bun.spawn(["bun", cli, "status", "--workspace", domain], {
    stdout: "pipe",
    stderr: "pipe",
    env: cliEnv,
  })
  const [preOut, preErr] = await Promise.all([
    new Response(preStatus.stdout).text(),
    new Response(preStatus.stderr).text(),
    preStatus.exited,
  ])
  const preText = `${preOut}\n${preErr}`
  if (!preText.includes("Package:") || !preText.includes("@oguzkaganozt/opencode-studio@")) {
    throw new Error(`cli status missing package banner:\n${preText}`)
  }

  // Configure from packed package; config lands in user-global homes (isolated here).
  await configureStudios({
    workspace: domain,
    studioConfigHome,
    openCodeHome,
    packageRoot: pkg,
    validateOpenCode: false,
  })
  const studioJson = JSON.parse(await readFile(path.join(studioConfigHome, "studio.json"), "utf8"))
  if (studioJson.enabled !== undefined) throw new Error("studio.json must not write enabled (always-on)")
  if (!(await Bun.file(path.join(openCodeHome, "skills/studio-pcb/SKILL.md")).exists())) {
    throw new Error("packed configure did not install pcb skill")
  }
  if (!(await Bun.file(path.join(openCodeHome, "skills/studio-cad/SKILL.md")).exists())) {
    throw new Error("packed configure did not install cad skill")
  }
  if (!(await Bun.file(path.join(openCodeHome, "skills/studio-media/SKILL.md")).exists())) {
    throw new Error("packed configure did not install platform media skill")
  }
  if (await Bun.file(path.join(domain, "opencode.json")).exists()) {
    throw new Error("configure must not write opencode.json into the domain root")
  }

  const postStatus = Bun.spawn(["bun", cli, "status", "--workspace", domain], {
    stdout: "pipe",
    stderr: "pipe",
    env: cliEnv,
  })
  const [postOut, postErr, postCode] = await Promise.all([
    new Response(postStatus.stdout).text(),
    new Response(postStatus.stderr).text(),
    postStatus.exited,
  ])
  if (postCode !== 0) throw new Error(`cli status after repair failed: ${postErr || postOut}`)
  if (!postOut.includes("mcp-build123d") || !postOut.includes("skill:pcb")) {
    throw new Error(`cli status after repair missing expected checks:\n${postOut}`)
  }

  console.log("package-smoke ok")
} finally {
  await rm(staging, { recursive: true, force: true })
  if (tarballPath) await rm(tarballPath, { force: true })
}
