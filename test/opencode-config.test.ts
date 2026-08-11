import { describe, expect, test } from "bun:test"
import {
  hasManagedStudioPermissions,
  type OpenCodeConfig,
  withManagedStudioPermissions,
  withoutManagedStudioPermissions,
} from "../src/core/opencode-config"

function config(value: Record<string, unknown>): OpenCodeConfig {
  return { exists: true, text: `${JSON.stringify(value, null, 2)}\n`, value, filePath: "opencode.json" }
}

describe("managed Studio permissions", () => {
  test("appends isolation rules while preserving unrelated policy", () => {
    const next = withManagedStudioPermissions(
      config({ permission: { bash: { "git *": "allow", "*": "ask" }, skill: { "*": "allow", personal: "deny" } } }),
    )
    expect(hasManagedStudioPermissions(next)).toBe(true)
    expect((next.value.permission as any).bash).toEqual({ "git *": "allow", "*": "ask" })
    expect((next.value.permission as any).skill.personal).toBe("deny")
  })

  test("normalizes scalar defaults without losing their semantics", () => {
    const next = withManagedStudioPermissions(config({ permission: "ask" }))
    expect((next.value.permission as any)["*"]).toBe("ask")
    expect(hasManagedStudioPermissions(next)).toBe(true)

    const nested = withManagedStudioPermissions(config({ permission: { skill: "ask" } }))
    expect((nested.value.permission as any).skill["*"]).toBe("ask")
    expect((nested.value.permission as any).skill["studio-cad"]).toBe("deny")
  })

  test("removes only Studio-owned rules", () => {
    const installed = withManagedStudioPermissions(config({ permission: { edit: "ask", skill: { personal: "allow" } } }))
    const removed = withoutManagedStudioPermissions(installed)
    expect(removed.value.permission).toEqual({ edit: "ask", skill: { personal: "allow" } })
    expect(hasManagedStudioPermissions(removed)).toBe(false)
  })
})
