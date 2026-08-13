import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { load } from "js-yaml"
import { type OpenCodeConfig, withManagedStudioPermissions } from "../src/core/opencode-config"
import { STUDIO_IDS, type StudioId } from "../src/core/registry"
import tools from "./parity/tools.json"

type Action = "allow" | "ask" | "deny"
type Rule = { permission: string; pattern: string; action: Action }

function wildcard(pattern: string, value: string) {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*")
  return new RegExp(`^${source}$`).test(value)
}

function rules(permission: unknown): Rule[] {
  if (!permission || typeof permission !== "object" || Array.isArray(permission)) return []
  const output: Rule[] = []
  for (const [name, value] of Object.entries(permission as Record<string, unknown>)) {
    if (typeof value === "string") output.push({ permission: name, pattern: "*", action: value as Action })
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [pattern, action] of Object.entries(value as Record<string, unknown>)) {
        if (typeof action === "string") output.push({ permission: name, pattern, action: action as Action })
      }
    }
  }
  return output
}

function actionFor(input: { permission: string; pattern: string; rules: Rule[] }) {
  return input.rules.filter((rule) => wildcard(rule.permission, input.permission) && wildcard(rule.pattern, input.pattern)).at(-1)?.action
}

async function agentPermission(studioId: StudioId) {
  const source = await readFile(path.join(import.meta.dir, "..", "studios", studioId, "agent", `studio-${studioId}.md`), "utf8")
  const match = /^---\n([\s\S]*?)\n---/.exec(source)
  if (!match) throw new Error(`Missing frontmatter for studio-${studioId}`)
  const frontmatter = load(match[1]!) as { mode?: string; hidden?: boolean; permission?: unknown }
  expect(frontmatter.mode).toBe("primary")
  expect(frontmatter.hidden).toBe(true)
  return frontmatter.permission
}

describe("Studio agent isolation", () => {
  test("each agent sees only its own Studio tools and skill", async () => {
    const base: OpenCodeConfig = { exists: false, text: "{}\n", value: {}, filePath: "opencode.json" }
    const globalPermission = withManagedStudioPermissions(base).value.permission
    const globalRules = rules(globalPermission)
    const inventory = tools.tools as Record<string, { studio: StudioId | "platform" }>
    const studioTools = Object.fromEntries(Object.entries(inventory).filter(([, entry]) => entry.studio !== "platform"))

    for (const toolName of Object.keys(studioTools)) {
      expect(actionFor({ permission: toolName, pattern: "*", rules: globalRules })).toBe("deny")
    }
    expect(actionFor({ permission: "image_generate", pattern: "*", rules: globalRules })).toBeUndefined()
    expect(actionFor({ permission: "read", pattern: "*", rules: globalRules })).toBeUndefined()

    for (const studioId of STUDIO_IDS) {
      const combined = [...globalRules, ...rules(await agentPermission(studioId))]
      const visible = Object.keys(studioTools)
        .filter((toolName) => actionFor({ permission: toolName, pattern: "*", rules: combined }) !== "deny")
        .sort()
      const expected = Object.entries(studioTools)
        .filter(([, entry]) => entry.studio === studioId)
        .map(([toolName]) => toolName)
        .sort()
      expect(visible).toEqual(expected)

      for (const candidate of STUDIO_IDS) {
        expect(actionFor({ permission: "skill", pattern: `studio-${candidate}`, rules: combined })).toBe(
          candidate === studioId ? "allow" : "deny",
        )
      }
      expect(actionFor({ permission: "task", pattern: "general", rules: combined })).toBe("deny")
    }
  })
})
