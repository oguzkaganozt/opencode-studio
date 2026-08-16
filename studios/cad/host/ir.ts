export const IR_DOCS = {
  schema: 1,
  ops: [
    "primitive(box|cylinder|cone|sphere)",
    "sketch(rect|circle on XY|XZ|YZ) + extrude",
    "hole, boolean, transform",
    "pattern(linear|polar)",
    "loft(3-7 stations, smooth, no ruled)",
    "path(line|spline) + sweep",
  ],
} as const

const OP_ID = /^[a-z][a-z0-9_]{0,63}$/

export class IrError extends Error {}

export type CadIrV2 = {
  schema: 1
  part: string
  params: string[]
  ops: CadOp[]
  show: string
  verify?: unknown
}

export type CadOp = { op: string; id: string; [key: string]: unknown }

export type IrPatch = {
  params?: string[]
  verify?: unknown
  show?: string
  ops?: Array<
    | { action: "insert_after"; after: string | null; value: CadOp }
    | { action: "replace"; id: string; value: CadOp }
    | { action: "delete"; id: string }
  >
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new IrError(`${label} must be an object`)
  return value as Record<string, unknown>
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== "string" || !OP_ID.test(value)) throw new IrError(`${label} must match ${OP_ID}`)
  return value
}

const SOLID_OPS = new Set(["primitive", "extrude", "loft", "sweep", "hole", "boolean", "pattern", "transform"])

function refsOf(op: CadOp): string[] {
  if (op.op === "extrude" && typeof op.sketch === "string") return [op.sketch]
  if (op.op === "sweep" && typeof op.path === "string") return [op.path]
  if (op.op === "hole" && typeof op.on === "string") return [op.on]
  if (op.op === "boolean" && typeof op.a === "string" && typeof op.b === "string") return [op.a, op.b]
  if ((op.op === "pattern" || op.op === "transform") && typeof op.on === "string") return [op.on]
  return []
}

export function validateIrDocument(value: unknown): CadIrV2 {
  const obj = requireObject(value, "ir")
  const extra = Object.keys(obj).filter((key) => !["schema", "part", "params", "ops", "show", "verify"].includes(key))
  if (extra.length) throw new IrError(`unknown IR fields: ${extra.sort().join(", ")}`)
  if (obj.schema !== 1) throw new IrError("ir.schema must be 1")
  if (typeof obj.part !== "string" || !obj.part) throw new IrError("ir.part must be a non-empty string")
  if (!Array.isArray(obj.params) || obj.params.some((item) => typeof item !== "string" || !item)) {
    throw new IrError("ir.params must be an array of names")
  }
  if (!Array.isArray(obj.ops)) throw new IrError("ir.ops must be an array")
  const ops: CadOp[] = []
  const seen = new Set<string>()
  for (const [index, raw] of obj.ops.entries()) {
    const op = requireObject(raw, `ops[${index}]`)
    const id = requireId(op.id, `ops[${index}].id`)
    if (seen.has(id)) throw new IrError(`duplicate op id ${id}`)
    seen.add(id)
    if (typeof op.op !== "string") throw new IrError(`ops[${index}] needs op`)
    if (op.op === "loft" && op.ruled === true) throw new IrError(`${id}: ruled lofts are not allowed`)
    const known = ["sketch", "path", "primitive", "extrude", "loft", "sweep", "hole", "boolean", "pattern", "transform"]
    if (!known.includes(op.op)) throw new IrError(`unknown op ${op.op}`)
    ops.push(op as CadOp)
  }
  const byId = new Map(ops.map((op, index) => [op.id, index]))
  for (const [index, op] of ops.entries()) {
    for (const ref of refsOf(op)) {
      const at = byId.get(ref)
      if (at === undefined) throw new IrError(`${op.id} references unknown op ${ref}`)
      if (at >= index) throw new IrError(`${op.id} must reference an earlier op (forward DAG)`)
    }
  }
  if (typeof obj.show !== "string" || !obj.show) throw new IrError("ir.show must name one solid op")
  const showOp = ops.find((op) => op.id === obj.show)
  if (!showOp) throw new IrError(`ir.show ${obj.show} is not an op id`)
  if (!SOLID_OPS.has(showOp.op)) throw new IrError(`ir.show ${obj.show} is not a solid`)
  return {
    schema: 1,
    part: obj.part,
    params: obj.params as string[],
    ops,
    show: obj.show,
    ...(obj.verify !== undefined ? { verify: obj.verify } : {}),
  }
}

export function applyIrPatch(current: Pick<CadIrV2, "part" | "params" | "ops" | "show" | "verify">, patch: IrPatch): CadIrV2 {
  const next: CadIrV2 = {
    schema: 1,
    part: current.part,
    params: patch.params ?? current.params,
    ops: [...current.ops],
    show: patch.show ?? current.show,
    ...(patch.verify !== undefined ? { verify: patch.verify } : current.verify !== undefined ? { verify: current.verify } : {}),
  }
  for (const action of patch.ops ?? []) {
    if (action.action === "insert_after") {
      if (action.after === null) {
        next.ops.unshift(action.value)
        continue
      }
      const index = next.ops.findIndex((op) => op.id === action.after)
      if (index < 0) throw new IrError(`insert_after target ${action.after} not found`)
      next.ops.splice(index + 1, 0, action.value)
    } else if (action.action === "replace") {
      const index = next.ops.findIndex((op) => op.id === action.id)
      if (index < 0) throw new IrError(`replace target ${action.id} not found`)
      if (action.value.id !== action.id) throw new IrError("replace must keep the same id")
      next.ops[index] = action.value
    } else {
      const index = next.ops.findIndex((op) => op.id === action.id)
      if (index < 0) throw new IrError(`delete target ${action.id} not found`)
      if (action.id === next.show) throw new IrError("cannot delete the show op")
      next.ops.splice(index, 1)
    }
  }
  return validateIrDocument(next)
}

export function irPathFor(partId: string) {
  return `ir/${partId.replace(/-/g, "_")}.json`
}
