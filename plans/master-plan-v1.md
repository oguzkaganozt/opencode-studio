# CAD Studio Master Plan v1

Lean first increment. Goal: the host can tell whether a design is actually
complete. Geometry authoring stays Python.

Full contracts for later work stay in `plans/cad-studio-master-plan.md`.

## Why

CAD already builds STEP/STL/GLB. The costly failures are false completes:

- agents write any file or run Bash
- QC evidence is in-memory and often revisionless
- one fit can pass a multi-part design
- warnings do not block
- form/reference can be claimed `not applicable`
- benches pass on `complete: true` plus STEP files
- product build can time out inside the warm session

## In

1. Deny generic writes. Domain tools only.
2. Lock acceptance (profile, bbox dims, interfaces) at create.
3. Build in a killable child. Publish only via `current`.
4. Persist evidence on disk. QC takes no agent statuses.
5. Require a print pose and profile check per final body.
6. Require one fit record per declared interface.
7. Score benches from disk, not the agent's claim.

## Out

- IR / `cad_ir_*`
- Worker dispatch, leases, generations
- Bubblewrap as a completion gate
- RFC8785 hash lattice, STEP-byte reuse, region-only no-reexport
- Host-extracted region compiler, helper solids, motion
- Hole / wall / station evaluators
- `cad_reference_render`, visual review, resemblance scoring
- Waivers, contract revision, `escape_reason`, construction theater
- `authoring` field (everything is hand until IR exists)

## Authority

| Concern | Authority |
| --- | --- |
| Requirements | Locked `acceptance.json` |
| Geometry | `parts/*.py` + `params.py` |
| Built truth | Artifact generation at `current` |
| Print pose | Host `print-plan.json` |
| QC proof | `evidence/records/*.json` |
| Completion | Host `cad_design_qc_report` |
| Benchmark | Offline scorer on disk |

Prose, session names, and tool-call presence are not proof.

## 1. Writes

- Deny `edit`, `write`, and `bash` on CAD primary and cad-part.
- CAD tools request `cad_mutate` instead of generic `edit`.
- Source, params, acceptance, print plan, and evidence change only through
  host tools. Each write checks design id, part id, path, and base hash.
- `cad_execute` and diagnostic `save_to` write only host scratch.
- No schema 2 worker dispatch. The parent models every part.

Isolation of the Python kernel (Bubblewrap) is a later hardening step. v1 does
not mark builds `untrusted` when it is missing.

## 2. Schema

New designs are schema 2. Schema 1 still reads and builds.

```ts
type DesignManifestV2 = {
  schema: 2
  id: string
  params: "params.py"
  acceptance: "acceptance.json"
  parts: { id: string; qty: 1 | 2; source: `parts/${string}.py` }[]
}
```

Same path and mirror-collision rules as today. Cap `sum(qty)` at 8.

v1 hashes (plain SHA-256 of canonical JSON or file bytes):

| Name | Input |
| --- | --- |
| `contractHash` | locked acceptance, hash field omitted |
| `buildRevision` | design.json + params.py + each part source + engine id |
| `bodyHash` | exact STEP bytes of one final body |

Evidence and QC bind to `buildRevision` + `contractHash` + subject ids.
Do not invent more hash types in v1.

## 3. Acceptance

Lock once in `cad_design_create`. Recreate the design to change it.

```ts
type AcceptanceV1 = {
  schema: 1
  state: "locked"
  authority: "harness" | "user"
  contractHash: string
  manufacturing: {
    process: "fdm"
    buildVolumeMm: [number, number, number]
    nozzleMm: number
    minimumWallMm: number
    bedToleranceMm: number
    defaultClearanceMm: number
  }
  dimensions: {
    id: string
    kind: "bbox"
    artifactId: string
    measure: "size"
    axis: "X" | "Y" | "Z"
    targetMm: number
    toleranceMm: number
  }[]
  interfaces: {
    id: string
    a: string                         // artifact id
    b: string
    fit: "clearance" | "contact" | "interference"
    targetMm: number
    toleranceMm: number
  }[]
}
```

- Benchmark injects a pinned harness contract. Interactive create confirms the
  normalized contract with the user, then writes it.
- Host writes `acceptance/history/<hash>.json` and active `acceptance.json`.
- Scaffold sources only after that commit.
- Bbox is measured on the final STEP. Interface `a`/`b` must be design artifact
  ids (including `*_mirror` when qty is 2).
- Effective min wall for printability is `manufacturing.minimumWallMm`.

## 4. Build

Keep the atomic generation switch. Change:

- Input allowlist: `design.json`, `params.py`, `parts/*.py` named by the
  manifest. Not acceptance, evidence, or renders.
- Run `cad_build` in a killable child. Abort kills the process group and
  returns only after it exits. Do not build inside the warm execute session.
- Readers trust only `current`. Delete the newest-mtime fallback in
  `host/artifacts.ts`.
- Artifact manifest records part ids, files, metrics, and `bodyHash`.

Timeouts: child 180s < host call 210s. Add a test that abort cannot publish.

## 5. Print plan and interfaces

After a successful build the host requires a print plan:

```ts
type PrintPlanV1 = {
  schema: 1
  buildRevision: string
  entries: {
    artifactId: string
    bodyHash: string
    // rotation in degrees about world axes, then translation mm
    rotateDeg: [number, number, number]
    translateMm: [number, number, number]
    boundsMm: { min: [number, number, number]; max: [number, number, number] }
  }[]
}
```

- One entry per final artifact, including mirrors.
- Host applies the transform, computes bounds, checks bed (`minZ` within
  `bedToleranceMm`, not below bed) and build-volume fit.
- Printability imports that STEP, applies that pose, and uses the profile
  (volume, nozzle, min wall). Missing profile or plan is unverified.

Interfaces: v1 compares the two named built solids with the existing fit
analyzer (clearance / contact / interference). Whole-object fit is accepted
only because the contract names the exact pair. A pass on `{body,lid}` does
not cover `{body,base}`.

## 6. Evidence and QC

Session measure/compare/printability stay diagnostic.

Completion records live at `evidence/records/<id>.json`:

```ts
type EvidenceV1 = {
  id: string
  axis: "requirement" | "printability" | "interface"
  buildRevision: string
  contractHash: string
  subjects: string[]                  // artifact ids
  requirementId?: string
  interfaceId?: string
  status: "pass" | "fail"
  findings: { severity: "warning" | "error"; message: string }[]
}
```

Host writes id, hashes, and time. QC keeps the latest record whose
`buildRevision` and `contractHash` match. Anything else is ignored.

`cad_design_qc_report({ id })` takes no status fields.

| Axis | Pass |
| --- | --- |
| Artifact | `current` valid; every expected STEP exists and hashes |
| Requirements | every bbox dim has a current pass |
| Manufacturing | every body has current print-plan + profile printability pass |
| Interfaces | every declared pair has a current matching fit pass |
| Findings | no warning or error on any current record |

No waivers. No agent `not applicable`. Single-part designs omit interfaces.
SPEC publishes only from a complete current report and goes stale when
`buildRevision` or `contractHash` changes.

## 7. Tools

Keep: `cad_design_create`, `cad_design_read`, `cad_design_build`,
`cad_design_qc_report`.

Add:

- `cad_source_apply({ id, part, path, contents, base_hash })` — params or
  `parts/*.py` only
- `cad_print_plan_apply({ id, entries })` — host fills bounds/hashes
- `cad_verify({ id, kind: "requirements" \| "printability" \| "interfaces" })`

`cad_design_read` returns contract, sources, artifacts, print plan, and latest
evidence. Do not add separate read tools.

Keep diagnostic session tools. They do not complete QC unless `cad_verify`
calls them on exact built bodies.

Schema 2 does not use `cad_design_join`.

## 8. Benchmarks

```text
studios/cad/test/benchmarks/<case>.acceptance.json
studios/cad/test/benchmarks/<case>.benchmark.json
```

```ts
type BenchFixtureV1 = {
  schema: 1
  expectedDesignId: string
  expectedParts: { id: string; qty: 1 | 2 }[]
  pinnedContractHash: string
  wallTimeMs: number
}
```

Runner injects the harness contract, rejects a different active hash, enforces
wall time, then scores disk with production validators.

Pass: expected design/parts/mirrors, valid artifacts, locked contract,
host-complete QC, no unresolved warnings.

Gates:

- `project-box-v0` — bbox + lid fit + print poses
- `wall-sconce-v0` — multi-interface coverage; cannot pass with one fit or
  empty interfaces

`speaker-organic-v0` is a canary, not a v1 blocker.

Negative fixtures must fail: forged `complete: true`, missing interface,
stale evidence, missing print plan, warning-only printability, wrong contract.

## Order

1. Permissions, `cad_mutate`, scratch-only diagnostics.
2. Schema 2 + three hashes + schema 1 still builds.
3. Out-of-session build, allowlist, no mtime fallback, abort test.
4. Acceptance lock at create.
5. Print plan + manufacturing verify.
6. Interface verify (named pairs).
7. Disk evidence + claim-free QC + SPEC freshness.
8. Semantic scorer + negative fixtures.

Stop. Do not start IR, workers, or Bubblewrap until both release benches are
trusted.

## Exit

- CAD agents cannot write product files except through the three apply/verify
  tools plus create/build.
- Build abort cannot publish and does not reset the execute session.
- QC result is the same if the agent omits all status fields.
- Forged `complete: true` fails the bench.
- One fit cannot complete a two-interface design.
- Unresolved warnings block.
- Schema 1 designs still build.

## Later

From `plans/cad-studio-master-plan.md`, after v1 is green:

1. Hole / wall / station requirements.
2. Extracted analytic regions.
3. Kernel isolation (Bubblewrap).
4. Prismatic IR.
5. Worker leases, then dispatch.
6. Visual review and freeform IR.
