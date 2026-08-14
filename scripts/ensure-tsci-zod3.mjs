import { mkdir, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const SHIM_PACKAGE = `{
  "name": "zod",
  "version": "3.25.76",
  "type": "module",
  "main": "./index.js",
  "exports": {
    ".": "./index.js",
    "./package.json": "./package.json"
  }
}
`

function shimSource(zodV3Href) {
  return `export * from ${JSON.stringify(zodV3Href)}
export { default } from ${JSON.stringify(zodV3Href)}
import * as z from ${JSON.stringify(zodV3Href)}
export { z }
`
}

async function writeShim(targetDir, zodV3Href) {
  await mkdir(targetDir, { recursive: true })
  await writeFile(path.join(targetDir, "package.json"), SHIM_PACKAGE)
  await writeFile(path.join(targetDir, "index.js"), shimSource(zodV3Href))
}

const zodV3Href = import.meta.resolve("zod/v3")
const targets = [
  path.join(packageRoot, "node_modules", "@tscircuit", "node_modules", "zod"),
  path.join(packageRoot, "node_modules", "tscircuit", "node_modules", "zod"),
]

for (const target of targets) {
  await writeShim(target, zodV3Href)
}

const propsZod = require.resolve("zod", { paths: [require.resolve("@tscircuit/props")] })
if (
  !propsZod.includes(`${path.sep}@tscircuit${path.sep}node_modules${path.sep}zod`) &&
  !propsZod.includes(`${path.sep}tscircuit${path.sep}node_modules${path.sep}zod`)
) {
  throw new Error(`tsci still resolves zod from ${propsZod}`)
}
