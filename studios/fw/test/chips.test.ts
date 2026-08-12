import { describe, expect, test } from "bun:test"
import { FW_CHIPS, fwChipSpec, isFwChip, listFwChips } from "../chips"

describe("fw chips", () => {
  test("lists every supported chip with an engine", () => {
    expect(listFwChips().map((item) => item.chip)).toEqual([...FW_CHIPS])
    expect(fwChipSpec("esp32").engine).toBe("qemu")
    expect(fwChipSpec("esp32s3").capabilities).toEqual(["uart"])
    expect(fwChipSpec("esp32c6").engine).toBe("esp-emu")
    expect(fwChipSpec("esp32c6").capabilities).toContain("gpio")
  })

  test("rejects unsupported chips", () => {
    expect(isFwChip("esp32s2")).toBe(false)
    expect(() => fwChipSpec("esp32s2")).toThrow(/Unsupported chip/)
    expect(() => fwChipSpec("stm32")).toThrow(/esp32c6/)
  })
})
