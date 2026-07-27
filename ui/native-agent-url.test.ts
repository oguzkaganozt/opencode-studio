import { describe, expect, test } from "bun:test"
import { encodeBase64Url, nativeOpenCodeHomeUrl, nativePromptDraftUrl } from "./native-agent-url"

describe("native-agent-url", () => {
  test("encodeBase64Url is url-safe and unpadded", () => {
    expect(encodeBase64Url("/home/user/project")).toBe(Buffer.from("/home/user/project").toString("base64url"))
    expect(encodeBase64Url("http://127.0.0.1:4173")).toBe(Buffer.from("http://127.0.0.1:4173").toString("base64url"))
  })

  test("home url is root", () => {
    expect(nativeOpenCodeHomeUrl()).toBe("/")
  })

  test("prompt draft url encodes workspace and prompt", () => {
    const url = nativePromptDraftUrl("/srv/project", "  Edit the board  ")
    const dir = encodeBase64Url("/srv/project")
    expect(url).toBe(`/${dir}/session?prompt=${encodeURIComponent("Edit the board")}`)
  })

  test("empty prompt falls back to home", () => {
    expect(nativePromptDraftUrl("/srv/project", "   ")).toBe("/")
  })
})
