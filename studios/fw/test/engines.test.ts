import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fwChipSpec } from "../chips"
import { IDF_INSTALL_MARKER, idfRootFromScript, isIdfInstallComplete, resolveQemu } from "../engines"

describe("fw engines", () => {
  test("idfRootFromScript walks tools/idf.py", () => {
    expect(idfRootFromScript("/opt/esp-idf/tools/idf.py")).toBe("/opt/esp-idf")
  })

  test("resolveQemu finds a binary under a tools tree", () => {
    const root = mkdtempSync(path.join(tmpdir(), "osc-fw-qemu-"))
    const bin = path.join(root, "tools", "qemu-xtensa", "bin")
    mkdirSync(bin, { recursive: true })
    const qemu = path.join(bin, "qemu-system-xtensa")
    writeFileSync(qemu, "")
    const previous = process.env.IDF_TOOLS_PATH
    process.env.IDF_TOOLS_PATH = root
    try {
      const resolved = resolveQemu(fwChipSpec("esp32"))
      expect(resolved?.path).toBe(qemu)
      expect(resolved?.source).toBe("espressif")
    } finally {
      if (previous === undefined) delete process.env.IDF_TOOLS_PATH
      else process.env.IDF_TOOLS_PATH = previous
    }
  })

  test("cached IDF without install marker is incomplete", () => {
    const root = mkdtempSync(path.join(tmpdir(), "osc-fw-idf-"))
    mkdirSync(path.join(root, "tools"), { recursive: true })
    writeFileSync(path.join(root, "tools", "idf.py"), "")
    expect(isIdfInstallComplete(root)).toBe(false)
    writeFileSync(path.join(root, IDF_INSTALL_MARKER), "v5.5.4\n")
    expect(isIdfInstallComplete(root)).toBe(true)
  })
})
