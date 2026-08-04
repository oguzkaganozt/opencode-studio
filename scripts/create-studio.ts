import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

const id = process.argv[2]
if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error("Usage: bun run create-studio <id>")
  process.exit(2)
}

const root = path.resolve(import.meta.dir, "..")
const dir = path.join(root, "studios", id)
await mkdir(path.join(dir, "skill"), { recursive: true })
await mkdir(path.join(dir, "viewer", "src"), { recursive: true })
await mkdir(path.join(dir, "test"), { recursive: true })

await writeFile(
  path.join(dir, "studio.ts"),
  `import type { StudioDefinition } from "../../src/core/registry"

export const ${id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}Studio: StudioDefinition = {
  id: "${id}" as any,
  label: "${id} Studio",
  description: "TODO",
  skill: "studio-${id}",
  requiredEngines: [],
  root: { default: "studio_home", relativePath: "studio/${id}", create: true },
}
`,
)
await writeFile(
  path.join(dir, "skill/SKILL.md"),
  `---
name: studio-${id}
description: TODO
license: MIT
compatibility: opencode
---

# ${id} Studio

TODO
`,
)
await writeFile(
  path.join(dir, "plugin.ts"),
  `import type { Plugin } from "@opencode-ai/plugin"\nexport function loadPlugin(): Plugin {\n  return async () => ({ tool: {} })\n}\n`,
)
await writeFile(path.join(dir, "api.ts"), `import { Hono } from "hono"\nexport function createApi() {\n  return new Hono()\n}\n`)
console.log(`Created studios/${id}. Register it in:`)
console.log(`  src/core/registry.ts (STUDIO_IDS)`)
console.log(`  src/studios.ts (definition)`)
console.log(`  src/studio-loaders.ts (plugin + API loaders)`)
console.log(`  ui/app.tsx (viewerLoaders)`)
console.log(`  test/parity/* (if tools/skills change)`)
