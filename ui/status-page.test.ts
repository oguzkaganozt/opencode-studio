import { describe, expect, test } from "bun:test"
import { MANAGED_IDS } from "./status-managed-ids"

describe("status managed ids", () => {
  test("does not require retired cad-part checks", () => {
    expect(MANAGED_IDS).not.toContain("skill:cad-part")
    expect(MANAGED_IDS).not.toContain("agent:cad-part")
    expect(MANAGED_IDS).toEqual([
      "plugin-registration",
      "permission:studio",
      "skill:concept",
      "skill:cad",
      "skill:pcb",
      "skill:fw",
      "skill:concept-review",
      "agent:concept",
      "agent:cad",
      "agent:pcb",
      "agent:fw",
      "cad-engine",
    ])
  })
})
