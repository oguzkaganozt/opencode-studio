import { describe, expect, test } from "bun:test"
import type { NormalVector } from "../viewer/src/geometry"
import { dominantDirection } from "../viewer/src/geometry"

const cases: Array<[NormalVector, ReturnType<typeof dominantDirection>]> = [
  [{ x: 1, y: 0, z: 0 }, "right"],
  [{ x: -1, y: 0, z: 0 }, "left"],
  [{ x: 0, y: 1, z: 0 }, "top"],
  [{ x: 0, y: -1, z: 0 }, "bottom"],
  [{ x: 0, y: 0, z: 1 }, "front"],
  [{ x: 0, y: 0, z: -1 }, "back"],
  [{ x: 0.2, y: -0.9, z: 0.4 }, "bottom"],
]

describe("dominantDirection", () => {
  test.each(cases)("maps %o to %s", (normal, expected) => {
    expect(dominantDirection(normal)).toBe(expected)
  })
})
