import { describe, expect, test } from "bun:test"
import { compactDirectoryLabel } from "./path-label"

describe("compactDirectoryLabel", () => {
  test("collapses home to tilde", () => {
    expect(compactDirectoryLabel("/home/oguz", "/home/oguz")).toBe("~")
  })

  test("keeps short paths under home", () => {
    expect(compactDirectoryLabel("/home/oguz/studio/designs", "/home/oguz")).toBe("~/studio/designs")
  })

  test("ellipsis deep home paths to last two segments", () => {
    expect(compactDirectoryLabel("/home/oguz/studio/designs/wall-light/parts", "/home/oguz")).toBe("~/…/wall-light/parts")
  })

  test("shortens absolute paths outside home", () => {
    expect(compactDirectoryLabel("/var/tmp/project/src")).toBe("…/project/src")
  })
})
