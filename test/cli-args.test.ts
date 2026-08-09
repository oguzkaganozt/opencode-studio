import { describe, expect, test } from "bun:test"
import { normalizeCliArgs } from "../src/cli-args"

describe("normalizeCliArgs", () => {
  test("bare invocation starts the primary up path", () => {
    expect(normalizeCliArgs([])).toEqual(["up"])
  })

  test("preserves explicit commands and help", () => {
    expect(normalizeCliArgs(["status"])).toEqual(["status"])
    expect(normalizeCliArgs(["--help"])).toEqual(["--help"])
  })
})
