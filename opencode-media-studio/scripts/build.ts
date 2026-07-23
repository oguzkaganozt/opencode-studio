import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const outdir = path.join(root, "dist")
await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

const result = await Bun.build({
  entrypoints: ["provider", "plugin", "server", "cli"].map((name) => path.join(root, "src", `${name}.ts`)),
  outdir,
  target: "bun",
  format: "esm",
  packages: "external",
  sourcemap: "none",
  minify: false,
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  throw new Error("Runtime build failed")
}

const cliPath = path.join(outdir, "cli.js")
const cli = await readFile(cliPath, "utf8")
if (!cli.startsWith("#!")) await writeFile(cliPath, `#!/usr/bin/env bun\n${cli}`)
await chmod(cliPath, 0o755)
