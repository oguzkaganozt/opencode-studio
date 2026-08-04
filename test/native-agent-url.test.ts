import { describe, expect, test } from "bun:test"
import { nativeDirectoryUrl, nativePromptDraftUrl, resolveAgentDirectory } from "../ui/native-agent-url"

describe("native Agent handoff", () => {
  test("keeps Studio Home as the fallback but targets a selected project", () => {
    expect(resolveAgentDirectory(undefined, "/home/studio")).toBe("/home/studio")
    expect(resolveAgentDirectory(" /home/studio/designs/case ", "/home/studio")).toBe("/home/studio/designs/case")
    expect(nativeDirectoryUrl("/home/studio/circuits/board")).toBe("/L2hvbWUvc3R1ZGlvL2NpcmN1aXRzL2JvYXJk")
    expect(nativePromptDraftUrl(resolveAgentDirectory("/home/studio/designs/case", "/home/studio"), "Build it")).toBe(
      "/L2hvbWUvc3R1ZGlvL2Rlc2lnbnMvY2FzZQ/session?prompt=Build%20it",
    )
  })
})
