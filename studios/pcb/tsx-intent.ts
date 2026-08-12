import { readFile } from "node:fs/promises"
import path from "node:path"

/**
 * Intent bridge for tscircuit's `noConnect` prop.
 *
 * tscircuit does not propagate `noConnect={["pin3"]}` into the built
 * circuit.json (source ports keep `do_not_connect: undefined`), so the
 * fabrication gate cannot distinguish "intentionally unconnected" from
 * "forgot to route". This module extracts the declarations from the
 * project's own `src/circuit.tsx` (the source of truth) so the gate can
 * resolve them in-memory — no artifact mutation, no upstream dependency.
 *
 * Supported shape: `noConnect={["pin3"]}` / `noConnect={["pin3", "pin4"]}`
 * on a component element that also declares `name="REFDES"`.
 */

export type NoConnectIntents = ReadonlyMap<string, ReadonlySet<string>>

const COMPONENT_TAG_RE = /<([A-Za-z][\w]*)\b([^>]*)>/gs

export function parseNoConnectIntents(tsxSource: string): NoConnectIntents {
  const intents = new Map<string, Set<string>>()
  for (const match of tsxSource.matchAll(COMPONENT_TAG_RE)) {
    const attributes = match[2]
    if (!attributes) continue
    const nameMatch = /\bname=["']([\w-]+)["']/.exec(attributes)
    if (!nameMatch) continue
    const noConnectMatch = /\bnoConnect=\{\s*\[([^\]]*)\]\s*\}/.exec(attributes)
    if (!noConnectMatch) continue
    const pins = [...noConnectMatch[1].matchAll(/["']([^"']+)["']/g)].map((pin) => pin[1])
    if (pins.length === 0) continue
    const existing = intents.get(nameMatch[1]) ?? new Set<string>()
    for (const pin of pins) existing.add(pin)
    intents.set(nameMatch[1], existing)
  }
  return intents
}

export async function loadNoConnectIntents(projectDir: string): Promise<NoConnectIntents> {
  const sourcePath = path.join(projectDir, "src", "circuit.tsx")
  try {
    return parseNoConnectIntents(await readFile(sourcePath, "utf8"))
  } catch {
    return new Map()
  }
}
