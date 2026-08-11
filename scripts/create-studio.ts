import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { STUDIO_IDS, STUDIO_TOOL_PERMISSIONS } from "../src/core/registry"

const id = process.argv[2]
if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error("Usage: bun run create-studio <id>")
  process.exit(2)
}

const root = path.resolve(import.meta.dir, "..")
const dir = path.join(root, "studios", id)
try {
  await mkdir(dir)
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
  console.error(`Refusing to overwrite existing directory: studios/${id}`)
  process.exit(1)
}
await mkdir(path.join(dir, "skill"), { recursive: true })
await mkdir(path.join(dir, "agent"), { recursive: true })
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
  toolPermissions: ["TODO_*"],
  requiredEngines: [],
  root: { default: "studio_home", relativePath: "studio/${id}", create: true },
}
`,
)
const otherToolDenies = STUDIO_IDS.flatMap((studioId) => STUDIO_TOOL_PERMISSIONS[studioId])
  .map((permission) => `  ${permission}: deny`)
  .join("\n")
await writeFile(
  path.join(dir, `agent/studio-${id}.md`),
  `---
description: ${id} Studio agent.
mode: primary
hidden: true
permission:
  TODO_*: allow
${otherToolDenies}
  task:
    "*": deny
  skill:
    "*": deny
    studio-${id}: allow
---

You are the ${id} Studio agent. Load \`studio-${id}\` before domain work and follow its workflow.
`,
)
await writeFile(
  path.join(dir, "skill/SKILL.md"),
  `---
name: studio-${id}
description: TODO
license: proprietary
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
console.log(`  test/parity/* (tools, skill digest, and agent digest)`)
