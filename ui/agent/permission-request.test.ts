import { describe, expect, test } from "bun:test"
import { normalizePermissionProperties } from "./permission-request"

describe("normalizePermissionProperties", () => {
  test("maps v1 permission.asked", () => {
    const next = normalizePermissionProperties("permission.asked", {
      id: "p1",
      sessionID: "s1",
      permission: "edit",
      patterns: ["src/**"],
      metadata: {},
      always: ["*"],
    })
    expect(next).toEqual({
      id: "p1",
      sessionID: "s1",
      permission: "edit",
      patterns: ["src/**"],
      metadata: {},
      always: ["*"],
      api: "v1",
    })
  })

  test("maps v2 permission.v2.asked action/resources", () => {
    const next = normalizePermissionProperties("permission.v2.asked", {
      id: "p2",
      sessionID: "s2",
      action: "bash",
      resources: ["npm install"],
      save: ["bash"],
    })
    expect(next).toEqual({
      id: "p2",
      sessionID: "s2",
      permission: "bash",
      patterns: ["npm install"],
      metadata: {},
      always: ["bash"],
      api: "v2",
    })
  })

  test("rejects missing id", () => {
    expect(normalizePermissionProperties("permission.v2.asked", { action: "x" })).toBeNull()
  })

  test("v2 without resources still yields empty patterns array", () => {
    const next = normalizePermissionProperties("permission.v2.asked", {
      id: "p3",
      sessionID: "s3",
      action: "edit",
    })
    expect(next?.patterns).toEqual([])
    expect(next?.api).toBe("v2")
  })
})
