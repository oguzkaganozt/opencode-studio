import { describe, expect, test } from "bun:test"
import { nativeFrameLooksBroken } from "./native-agent-frame"

describe("nativeFrameLooksBroken", () => {
  test("null snap is broken", () => {
    expect(nativeFrameLooksBroken(null)).toBe(true)
  })

  test("OpenCode title is ok", () => {
    expect(nativeFrameLooksBroken({ title: "OpenCode", bodyText: "", hasAppRoot: true })).toBe(false)
  })

  test("JSON error body is broken", () => {
    expect(nativeFrameLooksBroken({ bodyText: '{"error":{"code":"opencode_error","message":"down"}}' })).toBe(true)
  })

  test("chat_auth_required body is broken", () => {
    expect(nativeFrameLooksBroken({ bodyText: '{"error":{"code":"chat_auth_required","message":"Set OPENCODE_STUDIO_PASSWORD"}}' })).toBe(
      true,
    )
  })

  test("empty body is broken", () => {
    expect(nativeFrameLooksBroken({ bodyText: "" })).toBe(true)
  })

  test("app root without title is ok", () => {
    expect(nativeFrameLooksBroken({ bodyText: "Projects", hasAppRoot: true })).toBe(false)
  })
})
