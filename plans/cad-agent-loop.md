# CAD Studio Agent Loop - Implementable Plan

OpenCode Studio remains the product and OCCT remains the commit kernel. This
plan replaces agent-authored `parts/*.py` with a small, owned JSON IR for the
default path. Generated Python remains an implementation artifact so the
existing STEP/STL/GLB build pipeline can be reused.

This document is the implementation contract for v1. Prose examples are not a
substitute for the authoritative JSON Schema described below.

## Goal

Give the CAD agent a closed construction loop:

1. Read or patch one part IR.
2. Validate it without executing agent-authored code.
3. Compile it deterministically through build123d to OCCT.
4. Observe kernel metrics, selector matches, verification results, and views.
5. Patch the IR using an optimistic base hash.
6. Build final STEP/STL/GLB through `cad_design_build`.

The existing outer checks remain: artifact validity, printability, assembly
fit, form, and `cad_design_qc_report`. A new computed `construction` QC axis
proves that every IR-authored part in the built artifact passed its declared
verification contract.

## Constraints

- Harness: OpenCode Studio and its `cad_*` plugin tools.
- Commit kernel: OCCT through OCP/build123d.
- Final exports: only `cad_design_build` publishes STEP/STL/GLB.
- Runtime: the existing warm `studio-cad-runtime` process.
- Viewer: existing face-split GLB, pins, regions, and renders.
- Escape hatch: hand-authored Python remains available for explicitly listed
  unsupported operations.
- Existing designs and artifacts must remain readable during migration.

## Non-goals

- Replacing OpenCode, OCCT, or the existing artifact build.
- Making Zoo, OpenSCAD, CadQuery, FreeCAD, Fusion, replicad, or Manifold the
  commit path.
- Supporting organic/sculptural topology, fabric, anatomy, lattices, or
  implicit modeling in v1.
- Ports, mates, or simulation contracts. Those belong to
  `sim-plans/cad-sim.md`.
- Persistent OCCT topology naming in v1.
- Removing `cad_execute` in v1.

## Decisions

| Layer | v1 decision |
| --- | --- |
| Product | OpenCode Studio |
| Agent source | Owned JSON IR, schema 1 |
| Compiler | Deterministic Python package in `cad_runtime/ir/` |
| Backend | build123d 0.11.1 on OCCT |
| Generated source | Algebra-mode `parts/*.py` with `def build()` |
| Parameter input | Restricted numeric evaluation from `params.py`; values embedded in generated Python |
| Observation | Kernel metrics and verification first, render second |
| Concurrency | One design lock shared by IR apply, IR compile, and product build |
| History | Per-part, bounded, excluded from build inputs |
| Escape | Manifest-declared `authoring: "hand"` with a reason |

build123d is the compiler target, not the source language. OCCT is the geometry
engine and remains authoritative for validity, topology, measurements, and
exports.

## On-disk Model

New designs use design manifest schema 2:

```ts
type DesignManifestV2 = {
  schema: 2
  id: string
  params: "params.py"
  parts: DesignPartV2[]
}

type DesignPartV2 = {
  id: string
  qty: 1 | 2
  source: `parts/${string}.py`       // build input; generated or hand-authored
  authoring: "ir" | "hand"
  ir?: `ir/${string}.json`           // required only for authoring=ir
  escape_reason?: string             // required only for authoring=hand
}
```

Schema 2 requires unique part IDs and source paths, preserves the existing
mirror-collision rule, and requires `1 <= sum(parts[].qty) <= 8`. The upper
bound counts final artifact bodies, so a `qty: 2` source consumes two slots.

Example layout:

```text
$STUDIO_HOME/studio/designs/<id>/
  design.json
  params.py
  ir/
    <part>.json                       # current source of truth
    .state/<part>.json                # latest compile result and fingerprints
    history/<part>/
      v000001/
        ir.json                       # immutable canonical IR
        params.json                   # resolved parameter values
        result.json
        generated.py                  # present after geometry compile success
  parts/
    <part_source>.py                  # generated for IR, editable for hand mode
    <part_source>.py.ir-meta.json     # generated fingerprint sidecar
  ... existing artifact and QC files ...
```

Rules:

- `source` always means the Python path consumed by `cad_build.py`; it is never
  overloaded as an authoring mode.
- The compiler always writes to the exact `part.source`, including existing
  underscore-normalized filenames.
- For `authoring: "ir"`, only `part.ir` is editable geometry source.
  `part.source` and its sidecar are compiler output.
- For `authoring: "hand"`, `part.source` is editable and no IR compile occurs.
- IR history and `.state` are operational data, not build inputs or SPEC source.
- New hand-authored parts require a non-empty `escape_reason`, chosen from the
  unsupported-op list returned by `cad_ir_docs` or a human explanation.

### Migration

- Existing design schema 1 is read as legacy hand-authored data. Its `source`
  behavior does not change and no file is overwritten by the IR compiler. New
  schema 2 artifacts synthesized from a legacy design record
  `escape_reason: "legacy schema 1"`.
- Final v1 behavior: `cad_design_create` writes schema 2 and defaults each new
  part to `authoring: "ir"`. During rollout, schema 2 accepts explicit IR parts
  before the default changes in Phase 5.
- The TypeScript and Python manifest readers accept schema 1 and schema 2
  during the migration window. New builds always write artifact schema 2.
- Existing artifact schema 1 and engine `forge-cad/1` remain readable.
  New builds write artifact schema 2 and engine `forge-cad/2`.
- Automatic conversion of arbitrary Python to IR is not attempted.
- Switching an IR part to hand mode is explicit: set `authoring: "hand"`,
  remove `ir`, add `escape_reason`, and replace the generated source. Switching
  back requires a valid IR document and a successful compile.

`cad_design_create.parts[]` adds optional `authoring` and `escape_reason`.
In final v1, `authoring` defaults to `ir`; `escape_reason` is required for an
explicitly hand part. IR scaffolding writes a valid draft document with empty
operations and a generated `build()` stub that raises `NotImplementedError`.
Hand scaffolding retains the existing editable Python stub. No IR state/history
exists until the first successful validation followed by a compile attempt.

## Authoritative Schema

The single machine-readable source is:

```text
studios/cad/engine/cad_runtime/ir/schema.json
```

`jsonschema>=4,<5` validates documents in Python. `cad_ir_docs` returns this
schema, selector descriptions, limits, compiler identity, and the unsupported
operation list. Tests ensure the schema, compiler dispatch, docs, and fixtures
cover the same exact op set. TypeScript tool schemas describe the tool envelope;
the nested IR document is validated authoritatively by the runtime.

All schema objects use `additionalProperties: false`. Numbers must be finite.
Unknown operations, code strings, Python expressions, lambdas, and import fields
are schema errors.

## IR Schema 1

All distances are millimeters and all angles are degrees. Operations form a
forward-only DAG: an operation may reference only an earlier operation ID.
Operation IDs and verification IDs are unique and match
`^[a-z][a-z0-9_]{0,63}$`.

```ts
type CadIr = {
  schema: 1
  state: "draft" | "ready"
  part: string
  units: "mm"
  params: string[]                   // exact sorted set of ParamRef names
  verify: Verify[]
  ops: CadOp[]
  show: string                       // final op id
}

type ParamRef = { param: string }
type Scalar = number | ParamRef
type Vec2 = [Scalar, Scalar]
type Vec3 = [Scalar, Scalar, Scalar]
type AxisName = "X" | "Y" | "Z"

type AxisRef = {
  origin: Vec3
  direction: AxisName | Vec3
}

type PlaneRef =
  | { kind: "principal"; plane: "XY" | "XZ" | "YZ"; offset?: Scalar }
  | {
      kind: "face"
      on: string
      face: FaceSelector
      offset?: Scalar
      x_axis_hint: AxisName
    }

type Profile =
  | { kind: "rect"; width: Scalar; height: Scalar; corner_radius?: Scalar; center?: Vec2 }
  | { kind: "ellipse"; width: Scalar; height: Scalar; center?: Vec2 }
  | { kind: "circle"; diameter: Scalar; center?: Vec2 }
  | { kind: "spline"; closed: true; points: Vec2[] }
```

Draft documents may have empty `ops`, `verify`, and `show`. Ready documents
must have 1-96 operations, 3-7 verification claims, a valid forward DAG, and a
`show` ID that resolves to an operation producing one final shape.

Every `ParamRef` must appear exactly once in sorted `params`; unused declared
parameters are rejected. Numeric literals are allowed for local construction
constants. Shared or user-facing dimensions should use parameters.

### Operations

The v1 op set is exactly the following 14 operations:

```ts
type CadOp =
  | {
      op: "sketch"
      id: string
      plane: PlaneRef
      profile: Profile
    }
  | {
      op: "path"
      id: string
      kind: "line" | "spline"
      points: Vec3[]
    }
  | {
      op: "primitive"
      id: string
      kind: "box"
      size: Vec3
      origin?: Vec3
    }
  | {
      op: "primitive"
      id: string
      kind: "cylinder" | "cone"
      radius: Scalar
      radius2?: Scalar               // required for cone, forbidden for cylinder
      height: Scalar
      axis: AxisRef
    }
  | {
      op: "primitive"
      id: string
      kind: "sphere"
      radius: Scalar
      center?: Vec3
    }
  | {
      op: "extrude"
      id: string
      sketch: string
      amount: Scalar
      both?: boolean
    }
  | {
      op: "revolve"
      id: string
      sketch: string
      axis: AxisRef
      angle?: Scalar                 // default 360
    }
  | {
      op: "loft"
      id: string
      axis: AxisName
      stations: LoftStation[]
      ruled?: false                  // true is a schema error in v1
    }
  | {
      op: "sweep"
      id: string
      path: string                   // references a path op
      section: Profile
      transition: "transformed"
    }
  | {
      op: "hole"
      id: string
      on: string
      origin: Vec3
      direction: AxisName | Vec3
      diameter: Scalar
      depth: Scalar | "through"
    }
  | {
      op: "fillet"
      id: string
      on: string
      edges: EdgeSelector
      radius: Scalar
    }
  | {
      op: "chamfer"
      id: string
      on: string
      edges: EdgeSelector
      length: Scalar
    }
  | {
      op: "shell"
      id: string
      on: string
      remove_faces: FaceSelector
      thickness: Scalar
    }
  | {
      op: "boolean"
      id: string
      kind: "fuse" | "cut" | "intersect"
      a: string
      b: string
    }
  | {
      op: "pattern"
      id: string
      on: string
      combine: "compound" | "fuse"
      pattern: LinearPattern | PolarPattern
    }
  | {
      op: "transform"
      id: string
      on: string
      move?: Vec3
      rotate?: { axis: AxisRef; angle: Scalar }
    }

type LoftStation = {
  t: Scalar                            // coordinate along loft axis
  profile: Profile
  center?: Vec2                       // coordinates in the orthogonal plane
  rotation?: Scalar
}

type LinearPattern = {
  kind: "linear"
  direction: AxisName | Vec3
  count: number                       // integer 2-64
  spacing: Scalar
}

type PolarPattern = {
  kind: "polar"
  axis: AxisRef
  count: number                       // integer 2-64
  angle: Scalar                       // total angle, >0 and <=360
}
```

Semantic rules enforced after JSON Schema validation:

- A line path has exactly two distinct points. A spline path has 3-16 points.
- A closed spline profile has 4-8 distinct points and no self-intersection.
- Loft has 3-7 stations with strictly increasing resolved `t` values.
- Loft station planes are normal to the named axis. `center` uses the two
  remaining world axes in their natural order: X -> YZ, Y -> XZ, Z -> XY.
- Sweep places its section normal to the path tangent at the first point and
  uses build123d's transformed transition. Closed paths are not supported.
- Dimensions, radii, thicknesses, and pattern spacing must resolve positive.
- Box `origin` is its minimum XYZ corner. Cylinder/cone axis origin is the base
  center; cone `radius` is at the base and `radius2` at the axis endpoint.
- Extrude follows the sketch plane's positive normal. `both: true` centers the
  total requested amount on the sketch plane.
- Hole `origin` is the opening center and `direction` points into the target.
  A through hole extends beyond both target bounds by a compiler-owned epsilon
  that does not change nominal finished dimensions.
- Positive shell thickness always offsets inward so the input outer envelope is
  preserved.
- Pattern `count` is the total number including the original at index zero.
- Transform applies rotation first and translation second.
- Pattern expansion across the entire document may not exceed 256 shape
  instances.
- Every verification claim is evaluated against the final `show` solid after
  the complete operation graph has run. Intermediate operations cannot satisfy
  artifact verification. Verification parameter references participate in the
  same exact `params` set as operation references.
- Verification tolerance and selector distance/tolerance values must resolve
  positive. Normalized station `t` must resolve in `[0, 1]`.
- Hole `near` and `max_distance` are either both present or both absent.
- `show` must resolve to exactly one valid non-zero-volume solid at compile
  success. Intermediate compounds are allowed.

Gordon surfaces, guide surfaces, surface patches, drafting, warehouse parts,
threads, variable-radius blends, and arbitrary curves remain hand-mode escape
operations in v1.

## Selectors

Selectors are declarative and evaluated against one named prior operation.
They never contain Python and never reference a previous compile's topology ID.

```ts
type Cardinality = { min: number; max: number } // 0 <= min <= max <= 256

type FaceSelector = {
  kind: "extreme"
  axis: AxisName
  side: "min" | "max"
  planar_only?: boolean
  tolerance?: number                  // default 0.01 mm
  expect: Cardinality
} | {
  kind: "normal"
  axis: AxisName
  sign: -1 | 1
  angular_tolerance_deg?: number      // default 1 degree
  expect: Cardinality
} | {
  kind: "near"
  point: Vec3
  max_distance: Scalar
  expect: Cardinality
} | {
  kind: "cylinder"
  axis?: AxisName
  diameter?: Scalar
  tolerance?: number                  // default 0.05 mm
  expect: Cardinality
}

type EdgeSelector = {
  kind: "parallel"
  axis: AxisName
  angular_tolerance_deg?: number
  expect: Cardinality
} | {
  kind: "circle"
  radius?: Scalar
  center?: Vec3
  tolerance?: number
  expect: Cardinality
} | {
  kind: "extreme"
  axis: AxisName
  side: "min" | "max"
  tolerance?: number
  expect: Cardinality
} | {
  kind: "near"
  point: Vec3
  max_distance: Scalar
  expect: Cardinality
}
```

The compiler sorts matches by a stable geometric signature made from entity
type, center, measure, normal/tangent, and bounding box quantized to 1e-6 mm
and 1e-9 direction components. It reports
the matched signatures and coordinates in `IrCompileResult`. Cardinality
mismatch is a topology defect; the compiler never silently chooses the first
match. Cold compiles and cache-free compiles must produce the same match set.

Fillet, chamfer, and shell selectors require `expect.min >= 1`. A face-based
plane requires `expect: { min: 1, max: 1 }` regardless of selector kind.

Face-based `PlaneRef` requires exactly one planar face. `x_axis_hint` is
projected into that plane to define the local X axis; a parallel hint is a
topology error. This makes sketch placement independent of OCCT traversal
order.

## Parameter Contract

`params.py` remains the shared authoring file, but IR compilation does not
execute it. The IR parameter evaluator parses its AST and supports only:

- finite numeric literals;
- earlier uppercase numeric names;
- unary `+` and `-`;
- binary `+`, `-`, `*`, `/`, `//`, `%`, and `**`;
- parentheses.

Calls, attributes, subscripts, comprehensions, imports, conditionals, and
environment access are rejected when needed to resolve an IR parameter.
Hand-authored parts retain the existing Python behavior.

The compiler resolves the dependency closure of every declared parameter and
embeds the resulting numeric values into generated Python. Generated IR Python
does not import `params.py`. This prevents build-time parameter drift while
keeping `params.py` as the editable binding source.

Missing, cyclic, non-finite, boolean, or unsupported parameter values are typed
parameter errors. A parameter-only change invalidates only IR parts whose
resolved dependency map changes.

## Verification Contract

Every ready IR has 3-7 numeric claims. Verification is a discriminated union;
cross-part clearance remains in outer `cad_compare` and is not a part IR claim.

```ts
type Target = Scalar | { min: Scalar; max: Scalar }

type Verify =
  | {
      id: string
      kind: "bbox"
      measure: "size" | "min" | "max"
      axis: AxisName
      target: Target
      tol: Scalar
    }
  | {
      id: string
      kind: "volume"
      target: Target
      tol: Scalar
    }
  | {
      id: string
      kind: "hole_dia"
      match: {
        axis?: AxisName
        near?: Vec3
        max_distance?: Scalar
      }
      target: Target
      tol: Scalar
    }
  | {
      id: string
      kind: "wall"
      at: Vec3
      direction: AxisName | Vec3
      target: Target
      tol: Scalar
    }
  | {
      id: string
      kind: "station"
      axis: AxisName
      t: Scalar
      t_mode: "absolute" | "from_min" | "normalized"
      target: {
        width: Scalar
        depth: Scalar
        center?: Vec2
      }
      tol: Scalar
    }
```

Target semantics:

- All measurements and feature recognition run on `show`, never on the
  operation that originally introduced a feature.
- Numeric target passes when `abs(got - resolved_target) <= resolved_tol`.
- Range target passes when
  `resolved_min - resolved_tol <= got <= resolved_max + resolved_tol`.
- A hole match must resolve exactly one recognized hole.
- Wall uses the solid intersections along the declared ray and returns the
  local material span containing `at`; no hit or ambiguous spans fail.
- Station uses the same slicing semantics as `cad_analyze_form`. Width, depth,
  and optional center must all pass.
- Any part containing a loft or sweep must include at least three station
  claims spanning the first, an interior, and the last quartile of its dominant
  axis.

Verification failure does not erase valid geometry. It returns
`status: "verify_failed"`, publishes the generated Python for inspection, and
later blocks the computed construction QC axis.

## Results

Dry-run validation and compilation have separate result types.

```ts
type IrValidateResult = {
  ok: boolean
  compile_ready: boolean
  part: string
  ir_hash?: string                     // canonical candidate hash when valid
  issues: {
    path: string
    code: string
    message: string
  }[]
}

type IrCompileResult = {
  status: "pass" | "verify_failed" | "compile_failed"
  part: string
  show: string
  version: number
  ir_hash: string
  input_fingerprint?: string
  compiled_hash?: string
  cache_hit: boolean
  published: boolean                    // generated output is current on disk
  geometry?: {
    volume: number
    bbox: { min: number[]; max: number[]; size: number[] }
    topology: { solids: number; faces: number; edges: number; vertices: number }
  }
  delta?: {
    volume?: number
    faces?: number
    bbox_size?: number[]
  }
  selectors: {
    op_id: string
    selector_kind: string
    matched: number
    signatures: string[]
    centers: number[][]
  }[]
  verify: VerifyResult[]
  defects: IrDefect[]
}

type VerifyResult =
  | { id: string; kind: "bbox" | "volume" | "hole_dia" | "wall"; pass: boolean; got?: number; hint?: string }
  | { id: string; kind: "station"; pass: boolean; got?: { width: number; depth: number; center: number[] }; hint?: string }

type IrDefect = {
  id: string
  kind: "parameter" | "empty_selector" | "selector_cardinality" |
        "missed_boolean" | "invalid_brep" | "zero_volume" |
        "solid_count" | "budget" | "kernel"
  class: "dimension" | "topology" | "parameter" | "budget" | "kernel"
  op_id?: string
  at?: number[]
  hint: string
  next: "patch_value" | "rewrite_selector" | "patch_op" | "fix_param" | "use_hand_mode"
}

type IrConflictResult = {
  ok: false
  status: "conflict"
  part: string
  expected_hash: string
  actual_hash: string
  next: "cad_ir_read"
}

type IrBusyResult = {
  ok: false
  status: "busy"
  design: string
  waited_ms: number
  retry_after_ms: number
  next: "retry"
}

type IrCompileBatchResult = {
  ok: boolean
  published: boolean
  results: IrCompileResult[]
}
```

Silent OCCT success with an empty, invalid, zero-volume, or multi-solid final
shape is `compile_failed`. Unknown ops are validation failures and never reach
the kernel.

## Canonical Hashes and Staleness

Two hashes have distinct meanings:

```text
ir_hash = SHA-256(RFC 8785 canonical current IR)

input_fingerprint = SHA-256(
  canonical IR
  + canonical resolved parameter dependency map
  + IR schema version
  + compiler identity
  + build123d and OCP versions
)

compiled_hash = SHA-256(exact generated Python bytes)
```

Canonical JSON uses the `rfc8785` Python package. `compiler identity` is the
SHA-256 of `schema.json` plus the ordered source bytes of the modules under
`cad_runtime/ir/` that participate in validation, parameter resolution,
selection, compilation, and verification. It therefore changes in development
builds even before a package version bump.

The sidecar beside generated Python stores all three hashes. An IR part is
stale when any of these is true:

- current `input_fingerprint` differs from the sidecar;
- current generated Python hash differs from `compiled_hash`;
- sidecar or generated Python is missing;
- the compiler/backend identity changed.

Mtime is never used for correctness. A hand edit to generated Python is
detected even when it is newer than the IR and is overwritten only after a
successful recompile.

## Apply, Compile, and History Semantics

### Dry run

`cad_ir_apply(..., dry_run=true)`:

- requires the current `base_hash`;
- applies the candidate patch in memory;
- runs JSON Schema, semantic validation, and restricted parameter resolution,
  but performs no OCCT work;
- returns `IrValidateResult`;
- writes no IR, history, state, or generated Python;
- consumes no version.

### Normal apply

`cad_ir_apply(..., dry_run=false)`:

1. Resolve the design and enforce part/session scope.
2. Acquire the shared design lock.
3. Reject with a typed conflict if `base_hash` is not current.
4. Apply and validate the candidate.
5. On validation failure, write nothing and consume no version.
6. Require the candidate to be `state: "ready"`; draft state is scaffold-only
   and may be evaluated by dry-run but is not committed through normal apply.
   A valid draft candidate returns `IrValidateResult` with `ok: true` and
   `compile_ready: false`, without mutation.
7. On a valid ready candidate, allocate the next per-part version without
   publishing it yet.
8. Compile the candidate in a transaction directory.
9. On geometry success, commit current IR, generated Python, sidecar, state, and
   immutable history as one recoverable transaction; register `show` in the
   caller's session.
10. On compile failure, commit only current IR plus failed state/history, leave
   the previous generated Python untouched, and mark the new IR stale so it can
   be patched on the next call.
11. Release the lock and return `IrCompileResult`.

A candidate whose canonical `ir_hash` equals the current hash is a no-op: it
returns the current state with `cache_hit: true` and consumes no version.

### Explicit compile

`cad_ir_compile` recompiles selected IR parts or all IR parts. It is used for
parameter/compiler changes and build preparation.

- Each attempted part consumes one per-part version, including parameter-only
  compiles and compile failures.
- A true fingerprint cache hit consumes no version.
- Multi-part generated output publication is all-or-nothing: compile every
  selected part to temporary files first, then publish all generated files only
  if every part reaches geometry success. `verify_failed` is geometry success.
- State/history still record each attempt when batch publication is aborted.
  Every batch result has `published: false`, including parts that compiled
  successfully, and remains stale until a later successful batch.

### History and diff

- Versions are per part, so parallel workers cannot collide.
- History stores canonical IR, resolved parameters, result, and generated source
  when available.
- `cad_ir_diff` compares stored IR documents and results, returning op inserts,
  deletes, replacements, parameter deltas, verification deltas, and metric
  deltas.
- Retain the newest 50 versions per part plus any version referenced by the
  current artifact manifest. Pruning runs after successful publication.
- History is excluded from artifact inputs and SPEC source hashes.

## Shared Lock and Atomic Build

Move the existing design-lock implementation into a package-local helper shared
by `cad_build.py` and `cad_runtime/ir/`. All IR writes, compile publication, and
product builds use `.build.lock`.

The shared helper replaces the current fail-fast live-owner behavior with a
bounded FIFO queue:

1. Allocate a monotonic ticket under a short advisory queue mutex.
2. Persist ticket, PID, operation, and creation time under
   `.build.lock.queue/`.
3. Wait until the ticket is the oldest live ticket, then acquire the design
   lock and remove the ticket.
4. Remove dead-owner tickets after verifying their local PID no longer exists.
5. On wait timeout, remove the caller's ticket and return `IrBusyResult` without
   allocating a version or mutating source.

IR read waits up to 5 seconds, IR apply/compile up to 30 seconds, and product
build up to 60 seconds. Polling starts at 50 ms and backs off to 500 ms. Ticket
order, not scheduler wake order, defines fairness. Product-build busy errors use
the existing failed build envelope with `status: "busy"` and retry guidance.
All source-aware readers, including `cad_ir_read/diff`, `cad_design_read`, design
inspection, QC, and SPEC resolution, enter the helper so they recover or wait
instead of observing an interrupted transaction.

Because several source files must change together, publication uses a recovery
journal under `ir/.transactions/<uuid>/`. The transaction contains staged
files, target paths, backups, and a committed marker. While holding the lock,
the publisher fsyncs the transaction, replaces targets, marks it committed, and
then removes backups. Every lock acquisition first recovers an interrupted
transaction by completing a committed replacement or restoring all backups.
No build, read, or apply observes source files until recovery finishes. Tests
kill publication after each replacement step and prove recovery yields either
the complete old set or the complete new set.

### Bounded kernel execution

The current `WorkerSession` watchdog kills and replays the warm worker on an
operation timeout, so it is only a last-resort backstop. IR kernel work runs in
short-lived subprocesses with earlier deadlines:

- A part-compile subprocess receives canonical IR plus resolved parameters and
  writes result JSON, generated Python, and a temporary STEP used to register
  the compiled `show` shape in the warm session.
- The controller terminates the subprocess process group at the inner deadline,
  discards its transaction directory, and returns a typed `budget` defect.
- `cad_design_build` runs the complete locked compile/export transaction in a
  bounded product-build subprocess. A timeout returns the ordinary failed-build
  envelope and preserves the previous artifact generation.
- Product build exports each final artifact body through its own bounded
  artifact subprocess. It loads the exact source, applies the declared mirror
  when needed, validates, and writes staged STEP/STL/GLB/topology plus metrics.
- Temporary subprocesses are per call and are not a second long-lived runtime.
- Worker proxy timeouts exceed lock wait plus inner work by at least 15 seconds,
  so expected budget exhaustion never reaches `_do_call`'s worker-reset path.

After a successful part compile, the warm worker imports the temporary STEP and
registers it under `show`. A timed-out compile does not mutate session objects,
variables, snapshots, or execute history.

`cad_design_build` executes this sequence inside one lock:

1. Read and validate the design manifest.
2. Resolve all schema 2 IR parts.
3. Recompute fingerprints and compile every stale IR part into temporary files.
4. If any part has a geometry compile failure, publish no generated files or
   artifacts and preserve the previous artifact generation.
5. Atomically publish all generated Python, sidecars, state, and history.
6. Build the exact `part.source` files through the existing `build()` contract.
7. Snapshot an explicit build-input allowlist.
8. Validate source and STEP round trips and write temporary artifacts.
9. Re-hash the allowlist; reject publication if any input changed.
10. Atomically switch the artifact generation as today.

The build-input allowlist is:

- `design.json` and `params.py`;
- for each IR part: current IR, generated Python, and its sidecar;
- for each hand part: hand-authored Python source.

It excludes history, `.state`, renders, generated artifacts, caches, unrelated
Python files, and lock files. This replaces the current recursive `rglob("*.py")`
input discovery for artifact schema 2.

## Artifact, QC, and SPEC Integration

Artifact schema 2 is the complete built-artifact contract:

```ts
type ArtifactManifestV2 = {
  schema: 2
  id: string
  sources: ArtifactSourceV2[]
  parts: ArtifactPartV2[]
  build: {
    engine: "forge-cad/2"
    inputs: Record<string, string>     // safe relative path -> SHA-256
  }
}

type ArtifactSourceV2 =
  | {
      part: string
      qty: 1 | 2
      authoring: "ir"
      source: `parts/${string}.py`
      ir: `ir/${string}.json`
      ir_version: number
      ir_hash: string
      input_fingerprint: string
      compiled_hash: string
      construction: "pass" | "fail"
      verify: VerifyResult[]
    }
  | {
      part: string
      qty: 1 | 2
      authoring: "hand"
      source: `parts/${string}.py`
      construction: "not_applicable"
      escape_reason: string
    }

type ArtifactPartV2 = {
  id: string
  source_part: string
  transform: "identity" | "mirror_yz"
  files: {
    step: `step/${string}.step`
    stl: `stl/${string}.stl`
    glb: `glb/${string}.glb`
    topo: `topo/${string}.json`
  }
  metrics: {
    volume_mm3: number
    size_mm: { x: number; y: number; z: number }
    bounds_mm: { min: [number, number, number]; max: [number, number, number] }
    solid_count: 1
    face_count: number
  }
}
```

Manifest invariants:

- `sources` contains exactly one record for each design-manifest part, in design
  order, with matching `part`, `qty`, authoring mode, and source paths.
- Source part IDs are unique. Every artifact part references exactly one source
  through `source_part`; no orphan or extra source/part is allowed.
- A source with `qty: 1` produces exactly one artifact part with
  `id == source_part` and `transform: "identity"`.
- A source with `qty: 2` produces exactly two artifact parts, in order:
  `source_part` with `identity`, then `${source_part}_mirror` with `mirror_yz`.
  No separate source record is created for the mirror.
- Every file basename equals its artifact part ID and every metric is finite and
  positive, with bounds strictly increasing, integer positive `face_count`, and
  exactly one solid.
- IR source records require every IR/provenance/verification field and forbid
  `escape_reason`. Hand source records require a non-empty `escape_reason`,
  require `not_applicable`, and forbid IR/provenance/verification fields.
- IR versions are positive integers, hashes are lowercase 64-character SHA-256,
  and verify results contain exactly the current IR's 3-7 unique verification
  IDs. `construction` is `pass` exactly when every result passes.
- Legacy schema 1 designs synthesized into schema 2 artifacts use
  `escape_reason: "legacy schema 1"`.
- `build.inputs` contains exactly the explicit allowlist for the locked source
  snapshot; every value is a lowercase 64-character SHA-256.
- `sources` and `parts` together must match the locked `design.json`; manifest
  validation does not infer quantity or mirroring from names alone.

The build copies compile verification from the same locked input snapshot into
the artifact manifest. Historical or session-only `IrResult` data is never
accepted as artifact evidence.

`cad_design_qc_report` adds a computed `construction` axis:

- `pass`: every IR-authored artifact part has matching fingerprints and all
  verification claims pass; hand parts are `not_applicable` with a reason.
- `fail`: any IR part has missing, stale, or failed verification.
- The axis takes no agent-supplied status and cannot be overridden.
- `complete` now requires artifact, construction, printability, fit, and form to
  pass.

Mirrored `qty: 2` artifacts resolve construction through their shared
`source_part` record. They therefore inherit the exact source verification and
fingerprint because the build applies the deterministic YZ mirror afterward.
Verification is recorded for the pre-mirror source solid; the build separately
requires the mirrored output to remain one valid non-zero-volume solid. Any
acceptance requirement about the mirror's world-space location belongs to the
outer design/interface contract. Outer fit and printability still evaluate the
mirrored artifact where relevant.

CAD SPEC source freshness includes:

- `design.json` and `params.py`;
- current IR files for IR-authored parts;
- source Python for hand-authored parts.

It excludes generated IR Python, sidecars, state, and history. Therefore an IR
edit immediately makes a previously published SPEC stale, even before build.

## Public Tools

IR tools are explicit lifecycle-style wrappers in `studios/cad/tools/index.ts`,
not generic catalog-to-public session tools. The host resolves safe design paths,
asks for exact edit permissions, enforces worker scope, and calls private runtime
operations through the existing session transport.

```ts
cad_ir_read({
  id: string,
  part: string
})

cad_ir_apply({
  id: string,
  part: string,
  base_hash: string,
  document?: CadIr,
  patch?: IrPatch,
  dry_run?: boolean
})

cad_ir_compile({
  id: string,
  parts?: string[]                    // omitted means every IR part
})

cad_ir_diff({
  id: string,
  part: string,
  from_version: number,
  to_version: number
})

cad_ir_docs({ schema?: 1 })
```

Exactly one of `document` or `patch` is required by `cad_ir_apply`.
`cad_ir_apply` returns `IrValidateResult`, `IrCompileResult`,
`IrConflictResult`, or `IrBusyResult` according to the paths above.
`cad_ir_compile` returns `IrCompileBatchResult` or `IrBusyResult`.
`cad_ir_read` and `cad_ir_diff` may return `IrBusyResult` if recovery or a writer
holds the design past their five-second read wait.

```ts
type IrPatch = {
  state?: "ready"
  params?: string[]
  verify?: Verify[]
  show?: string
  ops?: (
    | { action: "insert_after"; after: string | null; value: CadOp }
    | { action: "replace"; id: string; value: CadOp }
    | { action: "delete"; id: string }
  )[]
}
```

Patch actions execute in array order. `insert_after: null` inserts first.
Replacing preserves position and requires `value.id` to equal `id`. Duplicate
IDs, missing targets, dangling references, or deleting the `show` op are
validation failures.

`cad_ir_read` returns the current document, current `ir_hash`, latest state,
available versions, authoring mode, and whether generated output is stale.

`cad_ir_docs` returns:

- authoritative JSON Schema;
- semantic rules and limits;
- selector grammar and examples;
- compiler/backend identity;
- exact unsupported operation names and recommended hand-mode reasons.

`cad_execute` remains unchanged. The CAD skill restricts it to hand-authored
parts or session-only diagnosis. It is not allowed to edit generated Python for
an IR-authored part.

## Worker Scope and Concurrency

`cad_design_create` records each spawned worker's `sessionID`, design, and part
in `.cad-dispatch.json` as today. Every public IR read/write wrapper checks that
mapping:

- A registered cad-part child may read/apply/diff only its assigned part.
- A child may call `cad_ir_docs`, validation/measurement/render tools, and
  printability.
- A child is denied `cad_ir_compile` because it is design-wide capable.
- The primary CAD session may operate on any part in the active design.
- Tools use explicit design and part IDs, so child runtime design binding is not
  required.

The shared lock serializes disk publication across up to three workers. The
`base_hash` rejects stale retries and makes duplicate tool calls idempotent.

`cad_design_join` no longer inspects Python stubs for IR parts. An IR part is
ready when its current document is `state: "ready"`, its latest result is
`pass` or `verify_failed`, and that result has `published: true`. Compile or
batch-publication failure remains pending. Hand parts retain the existing
Python-stub readiness check.

## Limits and Budgets

The runtime enforces:

| Limit | v1 value |
| --- | ---: |
| Serialized IR document | 128 KiB |
| Operations per part | 96 |
| Verification claims | 3-7 |
| Spline profile points | 4-8 |
| Spline path points | 3-16 |
| Loft stations | 3-7 |
| Pattern count | 64 |
| Expanded shape instances | 256 |
| Selector matches | 256 |
| Selector candidates scanned | 10,000 |
| Final artifact bodies (`sum(qty)`) | 8 |
| Part-compile inner timeout | 20 seconds |
| Aggregate IR compile inner budget | 160 seconds (8 x 20) |
| Artifact build/export inner timeout | 20 seconds per final body |
| Aggregate artifact export budget | 160 seconds (8 x 20) |
| Product-build orchestration margin | 20 seconds |
| Product-build inner budget after lock | 340 seconds |
| IR apply worker-proxy backstop | 65 seconds |
| IR compile worker-proxy backstop | 205 seconds |
| Product-build worker-proxy backstop | 415 seconds |
| TypeScript product-build timeout | 430 seconds |
| CAD runtime session ceiling | 450 seconds |
| History retained | 50 versions per part plus artifact references |

The aggregate compile and artifact-export controllers stop starting work when
less than one second remains, terminate an active child at the relevant
deadline, and mark every unattempted or terminated item with a budget failure.
Compile-budget failure publishes no selected generated files; export-budget
failure publishes no artifact generation. The 340-second product budget is the
sum of worst-case compile, worst-case export, and orchestration margin. Lock-wait
time is separate. Budget exhaustion does not reset unrelated session state or
publish partial generated files.

## Agent and Skill Changes

`studios/cad/agent/cad.md`:

- Default construction uses `cad_ir_read/apply`.
- Never edit compiler-generated Python.
- Use `cad_execute` only for a manifest-declared hand part or temporary
  diagnosis that is not treated as source.
- Completion requires the computed construction QC axis.
- Update the documented public tool count and tool list.

`studios/cad/skill/SKILL.md`:

- Phase 0 creates schema 2 designs and numeric verification claims.
- Phase 1 is IR draft -> dry-run -> apply/compile -> validate/measure/render ->
  product build.
- Manufactured freeform uses loft/sweep IR with required station claims.
- Gordon/surface patch/drafting/warehouse operations switch the affected part
  explicitly to hand mode with an escape reason.
- Viewer feedback maps to semantic selectors or operation parameters, never to
  previous-run face IDs.

`studios/cad/agent/cad-part.md` and `studio-cad-part`:

- Worker writes only its assigned IR through `cad_ir_apply`.
- Worker always reads a fresh base hash before patching.
- Worker cannot call design-wide compile/build/QC or edit generated Python.

## Implementation Wiring

### Runtime

- Add `cad_runtime/ir/schema.json` as the authoritative schema.
- Add `cad_runtime/ir/schema.py` for JSON Schema and semantic validation.
- Add `cad_runtime/ir/params.py` for restricted AST parameter resolution.
- Add `cad_runtime/ir/selectors.py` for deterministic selector evaluation.
- Add `cad_runtime/ir/compile.py` for build123d compilation and verification.
- Add `cad_runtime/ir/_compile_subprocess.py` as the bounded OCCT execution
  entry point and staged STEP/result writer.
- Add an internal bounded artifact subprocess entry point used by `cad_build.py`
  to build, mirror, validate, and export one final artifact body.
- Add `cad_runtime/ir/history.py` for fingerprints, versions, diff, and pruning.
- Add `cad_runtime/ir/apply.py` for patches and atomic publication.
- Add `cad_runtime/design_lock.py` and reuse it from `cad_build.py`.
- Run `cad_build.py` through a bounded product-build subprocess from
  `studio_build`; do not execute the complete build inside the warm worker.
- Add private runtime tools `ir_read`, `ir_apply`, `ir_compile`, `ir_diff`, and
  `ir_docs` in `cad_runtime/server.py`.
- Register typed `WorkerSession` methods, `_OPS`, and bounded timeouts in
  `cad_runtime/worker.py`.
- Add `jsonschema>=4,<5` and `rfc8785>=0.1,<1` to `pyproject.toml` and update
  `uv.lock`.

### Host and plugin

- Add explicit public wrappers to `studios/cad/tools/index.ts`.
- Add structured result envelopes and next-step guidance to `tools/result.ts`.
- Extend create permissions to current IR, state/history, generated source, and
  sidecars.
- Extend build permissions because a build may compile stale IR before artifact
  export.
- Raise `CAD_RUNTIME_SESSION_TIMEOUT_MS`, the product-build host timeout, and
  worker operation backstops to the values in Limits and Budgets.
- Update scaffolding, dispatch prompts, readiness, and session-to-part access
  checks.
- Update TypeScript and Python design/artifact manifest validators for schema 2
  plus legacy schema 1 reads.
- Replace schema 2 build input discovery with the explicit manifest-derived
  allowlist.
- Add construction provenance to artifact reading and `cad_design_read`.
- Add computed construction gating to `host/qc-report.ts`.
- Add IR authoring sources to `src/core/spec-resolve.ts`.

### Registration and parity

- Runtime private tools must appear in runtime tool tests but are not added to
  `CAD_SESSION_ALLOWLIST`.
- Public `cad_ir_*` wrappers appear in plugin inventory, parity fixtures, agent
  isolation tests, package smoke tests, and tool-count assertions.
- Cad-part permissions explicitly deny `cad_ir_compile` and continue denying
  design build, fit, and QC.
- Package contents already include `cad_runtime/**`; package smoke adds a check
  for `cad_runtime/ir/schema.json`.

## Tests

### Schema and semantics

- Accept one valid fixture for every op and selector variant.
- Reject unknown ops, unknown fields, code strings, non-finite numbers, invalid
  IDs, duplicate IDs, forward references, cycles, dangling `show`, and limits.
- Reject `ruled: true`, invalid loft station order, invalid spline counts,
  excessive pattern expansion, and ambiguous selector cardinality.
- Prove schema/docs/compiler op-set parity.

### Parameters

- Resolve literals, derived names, unary/binary arithmetic, and dependency
  closure without executing `params.py`.
- Reject calls, imports, cycles, booleans, non-finite values, and missing names.
- Recompile on used parameter changes; cache-hit on unrelated parameter changes.
- Generated Python embeds resolved values and does not import `params.py`.

### Compiler

- Box/lid IR matches existing fixture volume and bounds within tolerance.
- Every primitive, sketch/extrude, revolve, boolean, hole, pattern, transform,
  shell, fillet, and chamfer fixture builds one valid solid.
- A 4-7 station speaker envelope produces a smooth non-prismatic loft.
- Sweep follows a spline path and station verification detects a substituted
  constant section.
- Missed boolean, empty selector, multiple selector matches, invalid BRep,
  zero volume, and multiple final solids return typed defects.
- Cold and cache-free compiles produce identical hashes and selector matches.

### Verification

- Positive and negative tests for every verification kind and range target.
- A hole verified immediately after creation but filled by a later boolean fails
  final `show` verification; the intermediate operation cannot satisfy it.
- Hole match ambiguity and wall-ray ambiguity fail closed.
- Loft/sweep without required station coverage is rejected.
- `verify_failed` publishes inspectable generated geometry but blocks
  construction QC.

### Apply, history, and concurrency

- Dry-run success/failure writes nothing and consumes no version.
- Schema-invalid normal apply writes nothing and consumes no version.
- Compile failure keeps the new IR current, preserves last good generated
  Python, records history, and makes the design stale.
- No-op apply returns a cache hit without a version.
- Stale `base_hash` returns conflict without mutation.
- Three workers queued on different parts acquire the lock in ticket order and
  allocate independent versions safely.
- Two workers on one part cause one success and one stale-base conflict.
- Lock-wait timeout returns `busy`, removes its ticket, and consumes no version.
- Apply-versus-build contention serializes in ticket order; neither sees a
  partially recovered transaction.
- A part-compile subprocess timeout returns a `budget` defect while preserving
  warm-session objects, variables, snapshots, and execute history.
- Diff reconstructs op, parameter, verification, and metric changes.
- Retention preserves 50 newest versions and artifact-referenced versions.

### Build and migration

- Schema 1 designs remain hand-authored and are never overwritten.
- Schema 2 mixed IR/hand designs build correctly.
- Manifest validation rejects `sum(qty) > 8` before dispatch or compilation.
- Artifact schema 2 validator accepts exact mixed and mirrored mappings and
  rejects missing sources, orphan parts, duplicate mirrors, wrong transforms,
  forbidden authoring fields, and incomplete build inputs.
- Parameter, compiler, IR, and generated-source drift trigger recompilation.
- Hand-editing generated IR Python is detected by content hash and overwritten
  only after successful compile.
- A failure in the second stale part publishes no generated files or artifacts.
- Concurrent apply/build is serialized by one design lock.
- Aggregate compile budget exhaustion marks remaining parts, publishes no
  selected generated source, and preserves the prior artifact generation.
- Product-build subprocess timeout returns a failed build without resetting the
  warm session.
- Build input count stays bounded as history grows and unchanged source yields
  an unchanged artifact revision.
- Interrupted compile/build preserves the previous artifact generation.

### QC and SPEC

- Current passing verification produces construction pass.
- Missing, stale, or failed verification produces construction fail and blocks
  `complete`.
- Hand parts require an escape reason and appear as construction N/A.
- Mirrored parts inherit the source construction fingerprint.
- Editing current IR immediately marks published SPEC stale.
- History and generated Python changes alone do not change SPEC source hash.

### Tools, isolation, and package

- Public plugin inventory includes all five `cad_ir_*` tools.
- Runtime server/worker/private-tool parity is complete.
- Timer tests enforce inner deadline < worker proxy < TypeScript timeout <
  runtime session ceiling for apply, compile, and product build.
- Cad-part can apply only its assigned part and cannot call `cad_ir_compile`.
- Primary CAD can operate all parts; other studios remain denied by `cad_*`.
- Packaged npm artifact contains schema and compiler modules.

### End-to-end benches

- `project-box-v0`: IR-authored body and lid, no `cad_execute`, complete QC.
- `wall-sconce-v0`: IR for all expressible parts, explicit reasons for any hand
  part, form contract tied to built revision, complete QC.
- `speaker-organic-v0`: station-driven IR loft/sweep envelope, no fallback to a
  filleted box, no unapproved `cad_execute`, complete QC.
- Keep one explicit hand-mode fixture for Gordon/surface-patch escape behavior.

Bench scoring must assert:

- every part's authoring mode and escape reason;
- matching IR/generated/artifact fingerprints;
- no `cad_execute` for IR-authored parts;
- construction QC pass from the built revision;
- compile attempts, cache hits, history count, wall time, and tool failures.

## Rollout

### Phase 0 - Contract freeze

- Land authoritative schema, semantic rules, tool request/result contracts,
  manifest schema 2, fingerprint definition, limits, and fixtures.
- No agent or skill behavior changes yet.
- Exit: schema/docs/compiler parity tests pass and all open contract questions
  are resolved in code comments/tests rather than prose assumptions.

### Phase 1 - Single-part prismatic loop

- Implement parameter resolution, primitive/sketch/extrude/revolve, booleans,
  selectors, verification, apply/history/diff, and generated Python.
- Add public tools and a single-part IR fixture.
- Exit: deterministic cold compiles, dry-run/apply semantics, drift detection,
  and bounded history pass.

### Phase 2 - Atomic build and migration

- Add shared lock, schema 2 build inputs, artifact provenance, construction QC,
  SPEC freshness, and schema 1 compatibility.
- Exit: mixed IR/hand design builds; failure and concurrency tests preserve the
  previous generated source/artifacts; existing fixtures remain unchanged.

### Phase 3 - Multi-part workers

- Update create, dispatch, join, worker scope, prompts, and part skill.
- Exit: three concurrent workers complete disjoint IR parts, stale retries fail
  cleanly, and parent build consumes their exact compiled fingerprints.

### Phase 4 - Manufactured freeform

- Implement loft, path/sweep, shell, form station verification, and the speaker
  envelope fixture.
- Exit: wall-sconce and speaker benchmarks meet form and provenance gates
  without unapproved escape use.

### Phase 5 - Default and tighten

- Make new parts IR-authored by default in the primary CAD skill.
- Restrict `cad_execute` instructions to declared hand parts and diagnosis.
- Record escape reasons from real runs and prioritize only repeated unsupported
  operations for future IR additions.
- Exit: project-box, wall-sconce, and speaker benchmark baselines meet or beat
  current completion rate with fewer failed construction iterations.

### Later, evidence-triggered only

- Add Manifold prefix exploration only if measured OCCT compile latency or
  missed-cut diagnosis remains a bottleneck.
- Add Gordon or guide-surface ops only if a benchmark proves station loft/sweep
  cannot represent a required manufactured form.
- Add PicoGK only as an explicit sidecar for demonstrated lattice/implicit use.
- Remove `cad_execute` only after shipped designs no longer require hand mode.

## Success Criteria

v1 is complete only when all are true:

- The agent's default editable geometry source is valid schema 1 IR.
- A clean checkout compiles without prior topology IDs or history.
- Used parameter, IR, compiler, and generated-source changes are detected by
  content fingerprints, not mtimes.
- Apply, compile, and build cannot publish mixed or partial generated sources.
- Every IR verification result in QC is tied to the exact built artifact
  revision.
- Existing schema 1 designs build without compiler overwrites.
- History growth does not increase build-input count or change unchanged
  artifact revisions.
- Project-box, wall-sconce, and speaker benches prove prismatic, multi-part, and
  manufactured-freeform paths.
- Escape use is explicit, attributable, and absent for operations covered by
  the IR.

## Risks and Mitigations

- **IR coverage is too small:** record explicit hand-mode reasons and add only
  repeatedly needed operations after v1 freezes.
- **IR becomes another fluent API:** retain the exact 14-op v1 set and require a
  benchmark-backed proposal for additions.
- **Selector fragility:** require cardinality, report match coordinates and
  signatures, and prohibit previous-run topology IDs.
- **Compiler drift:** include compiler/backend identity in fingerprints and run
  cold determinism fixtures.
- **Failed IR blocks builds:** preserve last good generated source/artifacts,
  expose the failed current IR and typed defect, and require an explicit patch
  or hand-mode switch.
- **Parallel workers race:** use one design lock, per-part histories, explicit
  part scope, and optimistic `base_hash` checks.
- **History creates hidden cost:** exclude it from build inputs and SPEC, cap it,
  and retain only artifact-referenced older versions.
- **Freeform quality regresses:** require loft/sweep station contracts and real
  wall-sconce/speaker benchmark gates before making IR the default.

## Related

- `sim-plans/cad-sim.md`: later simulation over built session solids.
- CADAM/GrandpaCAD: inspiration for a small write surface, not a kernel choice.
- MAC/agentcad: numeric briefs, typed defects, fail-closed validation, and
  versioned diffs adapted to this runtime.
- PartCAD: ports/mates remain deferred until the simulation layer.

The current CAD Studio's outer QC loop remains a product strength. This plan
changes the inner authoring surface and makes its provenance enforceable; it
does not replace the outer gate.
