# CAD Studio Master Plan v2

Depends on `plans/master-plan-v1.md` being green. Do not start this until
the v1 benches are trusted.

v1 made completion honest. v2 makes construction cheaper and requirements
complete. Together they cover the useful core of
`plans/cad-studio-master-plan.md` without the bureaucracy.

## Why

Latest benches spend most of the clock in `cad_execute`, rebuilds, and
guessing form. Speaker: 39 min, 46 executes, 15 builds. That is authoring
pain, not scoring pain.

v1 will not shorten that. v2 will.

## In

1. Host hole / wall / station checks on final STEP.
2. Small IR: prismatic ops, then loft/sweep.
3. `cad_ir_apply` is the default write for new parts.
4. Hand Python stays as an explicit escape through `cad_source_apply`.
5. Workers with generation + lease, after the IR write path exists.
6. Locked station requirements replace form `not applicable`.

## Out

Still not worth it here:

- Visual resemblance / independent-model review
- Waivers and contract revision
- Extracted region compiler (v1 named pairs stay)
- Helper solids, motion, snap retention
- Fillet / chamfer / shell / revolve / gordon as IR ops
- IR history/diff
- Bubblewrap as a completion gate
- Extra hash types beyond v1 + `irHash`

Those stay in the full master plan until a bench proves the need.

## Split with v1

| Layer | v1 | v2 |
| --- | --- | --- |
| Writes | deny bash/edit; `cad_source_apply` | `cad_ir_apply` default |
| Requirements | bbox + profile + named interfaces | + hole, wall, station |
| Authoring | Python | IR → generated `parts/*.py` |
| Form | not a gate | locked stations on final STEP |
| Workers | parent only | leased IR workers |
| Bench | honest complete | box IR; sconce/speaker stations |

## 1. More requirement kinds

Extend v1 `AcceptanceV1.dimensions` with:

```ts
type DimensionReqV2 =
  | AcceptanceV1["dimensions"][number]
  | {
      id: string
      kind: "hole_diameter"
      artifactId: string
      match: { axis?: "X" | "Y" | "Z"; nearMm?: [number, number, number]; maxDistanceMm?: number }
      targetMm: number
      toleranceMm: number
    }
  | {
      id: string
      kind: "wall"
      artifactId: string
      atMm: [number, number, number]
      direction: [number, number, number]
      minimumMm: number
    }
  | {
      id: string
      kind: "station"
      artifactId: string
      axis: "X" | "Y" | "Z"
      tMode: "from_min"
      t: number
      target: { widthMm: number; depthMm: number }
      toleranceMm: number
    }
```

Host evaluators run on exact STEP (`bodyHash`), same semantics as the master
plan (exact-one hole, wall line through `atMm`, `cad_analyze_form` stations).
`cad_verify({ kind: "requirements" })` covers all kinds. Missing kind = fail,
not skip.

A part with any station requirement cannot complete without those stations
passing. That is the form gate. No visual review.

## 2. IR

Agent-editable source for new schema 2 parts is `ir/<part>.json`. Build
compiles it to `parts/*.py` inside the existing unpublished generation.
Do not maintain a second source tree or recovery journal.

```ts
type CadIrV2 = {
  schema: 1
  part: string
  params: string[]                    // names from params.py
  ops: CadOp[]
  show: string
}
```

Ops, frozen:

```text
primitive(box|cylinder|cone|sphere)
sketch(rect|circle on XY|XZ|YZ) + extrude
hole, boolean, transform
pattern(linear|polar)
loft(3-7 stations, smooth, no ruled)
path(line|spline) + sweep
```

Unknown ops, Python fields, and `ruled: true` are schema errors.

Compile rules:

- Forward DAG, unique ids, `show` is one solid.
- Params resolved by the same restricted AST as the master plan; embed numbers
  in generated Python.
- Verify local IR checks only if present. They never replace acceptance.
- All measurements for QC stay on the built STEP.
- Same `base_hash` optimistic write as v1 sources.
- Failed compile does not publish generated Python or artifacts.
- Cold compile must match. No last-compile topology ids.

Hand escape: `cad_source_apply` on `parts/*.py` for that part, and drop/ignore
IR until IR is applied again. No `escape_reason` ceremony.

## 3. Tools

Add:

- `cad_ir_apply({ id, part, base_hash, document | patch })`
- `cad_ir_docs()` — frozen op list, nothing else

`cad_design_read` already returns IR + stale/compile state. No `cad_ir_read`,
`cad_ir_compile`, or `cad_ir_diff`. Build compiles stale IR.

`cad_execute` stays diagnostic. It must not write `parts/*.py` or `ir/`.

## 4. Workers

Only after `cad_ir_apply` works.

- Two or more parts: spawn up to 3 `cad-part` workers.
- Ledger: part, session, generation, lease, state.
- Persist `starting` + lease **before** `promptAsync`.
- Worker may `cad_ir_apply` only its part. Denied: build, QC, compare, other
  parts, `cad_source_apply` unless that part is already hand.
- Stale generation / expired lease / wrong `base_hash` → no write.
- Takeover increments generation. Cancellation is best effort; the lease is
  the hard stop.
- `cad_design_join` waits on ledger `ready|failed`, not Python stubs.

Parent still owns print plan, verify, and QC.

## 5. Schema touch

```ts
type DesignPartV2 = {
  id: string
  qty: 1 | 2
  source: `parts/${string}.py`        // generated or hand
  ir?: `ir/${string}.json`            // present ⇒ IR part
}
```

`buildRevision` adds current IR bytes when `ir` is set. No new hash family.

## 6. Benchmarks

Same fixtures as v1, plus:

- `project-box-v0`: body and lid are IR; no `cad_execute` as source write;
  hole + bbox requirements pass.
- `wall-sconce-v0`: expressible parts IR; at least one station requirement on
  the dominant body; form N/A cannot pass.
- `speaker-organic-v0` becomes a gate: loft/sweep IR envelope, 3+ stations
  pass, no filleted-box substitute.

Score IR provenance from disk (`ir/` present, generated source matches last
compile), not from event logs alone.

## Order

1. Hole / wall / station evaluators on v1 evidence.
2. Prismatic IR + `cad_ir_apply` + compile-in-build. Box bench.
3. Loft / sweep + station requirements. Sconce, then speaker.
4. Worker lease + join. Multi-part IR only.

Do not add fillet/shell/visual-review/waivers in this increment.

## Exit

v1 exits still hold, and:

- New parts default to IR. Hand is the exception path.
- Box completes with IR and no execute-as-source.
- Sconce cannot pass without its locked stations.
- Speaker cannot pass as a filleted box; stations must match.
- Two IR workers cannot overwrite each other.
- `cad_execute` count on box drops sharply vs the last v1 baseline.
- Build/execute storms on speaker drop vs the 15-build / 46-execute run.

## Left for later

Only if a real bench demands it:

- Fillet, chamfer, shell, revolve
- Extracted regions, helper solids
- Visual review
- Waivers / contract edits
- Bubblewrap
- IR history

v1 + v2 is the product loop: honest gates, cheap construction, real form.
The rest is polish.
