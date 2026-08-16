import { describe, expect, test } from "bun:test"
import { applyIrPatch, validateIrDocument } from "../host/ir"

const boxDoc = {
  schema: 1 as const,
  part: "body",
  params: ["BODY_X"],
  ops: [{ op: "primitive", id: "box", kind: "box", size: [{ param: "BODY_X" }, 70, 30], origin: [0, 0, 0] }],
  show: "box",
}

describe("IR document", () => {
  test("accepts a prismatic box and rejects unknown ops / ruled loft", () => {
    expect(validateIrDocument(boxDoc).show).toBe("box")
    expect(() => validateIrDocument({ ...boxDoc, ops: [{ op: "fillet", id: "f", on: "box" }], show: "f" })).toThrow(/unknown op/)
    expect(() =>
      validateIrDocument({
        ...boxDoc,
        ops: [
          { op: "sketch", id: "s0", plane: { kind: "principal", plane: "XY" }, profile: { kind: "circle", diameter: 10 } },
          { op: "sketch", id: "s1", plane: { kind: "principal", plane: "XY", offset: 10 }, profile: { kind: "circle", diameter: 12 } },
          { op: "sketch", id: "s2", plane: { kind: "principal", plane: "XY", offset: 20 }, profile: { kind: "circle", diameter: 8 } },
          {
            op: "loft",
            id: "body",
            axis: "Z",
            stations: [
              { t: 0, profile: { kind: "circle", diameter: 10 } },
              { t: 10, profile: { kind: "circle", diameter: 12 } },
              { t: 20, profile: { kind: "circle", diameter: 8 } },
            ],
            ruled: true,
          },
        ],
        show: "body",
      }),
    ).toThrow(/ruled/)
  })

  test("rejects backward DAG references", () => {
    expect(() =>
      validateIrDocument({
        schema: 1,
        part: "body",
        params: [],
        ops: [
          { op: "boolean", id: "cut", kind: "cut", a: "box", b: "cyl" },
          { op: "primitive", id: "box", kind: "box", size: [10, 10, 10] },
        ],
        show: "cut",
      }),
    ).toThrow(/earlier op/)
  })

  test("applies insert/replace/delete patches", () => {
    const withHole = applyIrPatch(boxDoc, {
      ops: [
        {
          action: "insert_after",
          after: "box",
          value: {
            op: "hole",
            id: "usb",
            on: "box",
            origin: [0, 0, 15],
            direction: "Y",
            diameter: 8,
            depth: "through",
          },
        },
      ],
      show: "usb",
    })
    expect(withHole.ops.map((op) => op.id)).toEqual(["box", "usb"])
    expect(withHole.show).toBe("usb")
    const replaced = applyIrPatch(withHole, {
      ops: [{ action: "replace", id: "usb", value: { ...withHole.ops[1]!, diameter: 10 } }],
    })
    expect(replaced.ops[1]?.diameter).toBe(10)
    expect(() => applyIrPatch(withHole, { ops: [{ action: "delete", id: "usb" }] })).toThrow(/show/)
  })
})
