# CAD Studio Master Improvement Plan

This is the integrated implementation roadmap for CAD Studio. It merges the
best parts of:

- `plans/cad-agent-loop.md`: deterministic IR authoring, typed defects,
  provenance, bounded compilation, and atomic build integration.
- `plans/cad-improvement-plan.md`: immutable product requirements,
  manufacturing context, interface coverage, durable evidence, visual review,
  semantic benchmarks, and worker ownership.

The two source plans remain design references. When they conflict, this master
plan controls implementation order, shared schemas, authority, and completion
semantics.

## Executive Decision

CAD Studio should improve in this order:

1. Protect all authoritative writes and define one revision model.
2. Make builds bounded, atomic, and content-addressed.
3. Lock product acceptance and manufacturing requirements before geometry.
4. Persist host-generated evidence and compute completion without agent claims.
5. Require complete part, interface, warning, and reference coverage.
6. Replace structural benchmark scoring with offline semantic scoring.
7. Introduce a prismatic IR authoring beta with explicit hand-mode escape.
8. Add enforceable worker generations and leases.
9. Expand IR to manufactured freeform and advanced interface/topology checks.
10. Add caching and UX after correctness and freshness behavior are stable.

The outer truth model ships before broad IR coverage. A better authoring loop is
valuable only when the host can tell whether the resulting product is actually
correct.

## Evaluation of the Source Plans

### Keep

| Source | Keep |
| --- | --- |
| Agent loop | OpenCode and OCCT, owned JSON IR, deterministic parameter resolution, final-shape verification, content fingerprints, typed defects, explicit hand mode, bounded subprocesses, source-to-artifact provenance |
| General improvement | Locked acceptance contract, required FDM profile, named interfaces, exact print poses, durable revision-bound evidence, structured warning closure, final-artifact render provenance, independent semantic benchmark score |
| Current implementation | One-solid and positive-volume gates, STEP round-trip validation, atomic artifact generations, face-split GLB/topology, useful measurement/printability/form analyzers |

### Correct in the merge

| Problem | Master-plan decision |
| --- | --- |
| Both plans amend schema 2 independently | Freeze one combined design and artifact schema before implementation |
| Acceptance approvals are self-asserted JSON | Approval identity and receipts are generated only by host tools or the benchmark harness |
| Evidence is process-memory-only | Persist immutable host evidence; the in-memory ledger becomes a cache only |
| Generic `designRevision` conflicts with incremental reuse | Use explicit contract, geometry, body, plan, and evidence input hashes |
| IR verification duplicates product requirements | IR checks are local compiler checks only; locked acceptance is independently evaluated on final artifacts |
| Acceptance was proposed as a geometry build input | Acceptance changes invalidate QC/SPEC, not geometry artifacts |
| One fit result can cover a whole assembly | Every declared interface gets its own region-bound evidence |
| Visual review hashes arbitrary session renders | Host renders deterministic views from exact final artifacts |
| Worker generations cannot stop direct writes | Deny generic writes/Bash and route source publication through scoped host tools |
| Full IR and approval machinery are front-loaded | Ship a minimal enforceable v1, then expand from benchmark and escape telemetry |

### Defer

- Delegated multi-party approval policy beyond harness, user, and configured host
  policy.
- Arbitrary helper-solid region compilers.
- Motion/retention simulation and functional topology beyond initial analytic
  checks.
- Event-driven worker cancellation when the OpenCode API cannot guarantee it.
- Full IR history/diff and the complete 14-op set before the prismatic beta
  demonstrates value.
- Automated image-similarity claims without an independent reviewer.
- Manifold, PicoGK, Gordon surfaces, ports/mates, and removal of `cad_execute`.

## Goal

Let the agent choose and construct geometry while the host deterministically
answers:

- What requirements were approved?
- Which exact source produced each artifact?
- Does every final body fit the manufacturing profile?
- Does every declared interface have current evidence?
- Are all locked dimensions and form requirements satisfied?
- Are warnings fixed, locally disproved, or explicitly approved?
- Do reference-driven products have final-artifact views and review?
- Is every piece of evidence current for its exact inputs?
- Does the benchmark result agree with the host, independent of the agent's
  completion claim?

## Non-goals

- Replacing OpenCode, OCCT, build123d, or the existing viewer.
- Hard-coding benchmark names, part names, or product-specific geometry.
- Treating numeric form checks as visual similarity.
- Making all warnings disappear through prose or nominal parameter math.
- Preventing edits by external users or processes. External changes are detected
  by hashes; the controlled OpenCode agents are prevented from bypassing tools.
- Guaranteeing elastic snap behavior, material strain, or production fitness
  without the required simulation or physical evidence.

## Authority Model

Each concern has one source of truth:

| Concern | Sole authority |
| --- | --- |
| Product requirements | Active locked acceptance contract |
| FDM assumptions | Manufacturing profile inside the active contract |
| Part geometry | Exactly one current IR revision or one hand source |
| Interface region geometry | Current region declaration tied to part source |
| Local compiler checks | IR `verify`; diagnostic only, never acceptance evidence |
| Built truth | Artifact manifest and exact output hashes |
| Print pose | Host-owned print plan tied to body hashes and profile hash |
| QC proof | Immutable host-written evidence records |
| Warning closure | Host-validated resolution or approval receipt |
| Completion | Host requirement-coverage computation |
| Benchmark success | Offline scorer over disk artifacts, contracts, and evidence |

Agent prose, session object names, filenames, timestamps, and tool-call presence
are never authorities.

## Protected Mutation Boundary

The contracts above are unenforceable while CAD agents can write arbitrary
files or invoke shell commands. Before schema 2 becomes writable:

- Deny generic `edit`, `write`, and `bash` to the primary CAD agent and cad-part
  workers for product work.
- Keep stock read access and `cad_*` domain tools.
- Replace current generic `edit` permission requests inside CAD tools with a
  dedicated `cad_mutate` permission. Only CAD host tools request it; agents
  cannot invoke it as a filesystem primitive.
- Route params, IR, hand source, region, acceptance, print-plan, evidence,
  review, and waiver mutations through host-owned tools.
- Validate design ID, part ID, authoring mode, optimistic base hash, and path
  containment on every mutation. Worker-originated mutations additionally
  require the active generation and lease; parent-owned mutations require no
  synthetic worker lease.
- Generate approvals, record hashes, timestamps, producer identities, and
  revision hashes in the host. Never accept these fields from agent payloads.
- Treat `cad_execute` as session-only geometry work. Its restricted runtime may
  not write authoritative source or evidence files.
- Restrict diagnostic `save_to` arguments to a host-created runtime scratch
  directory. Only `cad_reference_render` may publish under design `renders/`.

Hand source is executable code, so tool-mediated writes alone are insufficient.
Every schema 2 hand build runs in an isolation backend with:

- an immutable read-only snapshot containing only declared build inputs;
- a writable unpublished output directory and no writable design/workspace
  mount;
- no network namespace;
- an explicit environment-variable allowlist;
- bounded process, CPU, and memory limits.

If the isolation backend is unavailable, a hand build fails capability checks.
An explicitly configured unsafe legacy build may produce diagnostic artifacts,
but it is marked `untrusted` and can never produce host-complete QC or benchmark
success. Bounded subprocess execution is not treated as a sandbox by itself.

The v1 Linux backend is Bubblewrap, packaged/discovered during Studio health
checks. The long-lived diagnostic CAD runtime is also launched inside a
Bubblewrap mount/network namespace: workspace/design inputs are read-only, the
Python environment is read-only, network is unshared, and only a host-created
scratch directory is writable. `cad_execute` and build123d export APIs can write
only there. Authoritative IR/build coordinators run as separate host-controlled
operations that receive immutable inputs and staged output directories; they do
not grant the diagnostic runtime a writable design mount. Non-Linux backends
must provide equivalent tests before enabling schema 2 completion.

Schema 1 designs remain usable through scoped hand-source and params tools.
External filesystem edits are detected as drift and invalidate affected
artifacts/evidence.

## Unified Revision Model

Do not use one overloaded `designRevision`. Use explicit hashes:

### Canonical hash framing

Except for hashes explicitly defined over raw file bytes, every hash is:

```text
SHA-256(UTF-8(RFC8785({
  domain: "opencode-studio/cad/<name>",
  version: 1,
  payload: <typed canonical object>
})))
```

The domain tag, version, payload field names, array order, relative POSIX paths,
and lowercase hex encoding are part of the contract. Unordered maps are encoded
as arrays sorted by UTF-8 path/ID before canonicalization. No hash uses string
concatenation or host-native path encoding. TS, Python, and scorer share golden
preimage-byte and digest fixtures for every domain. Raw file hashes use
`SHA-256(exact bytes)` and are placed inside the framed parent object.

```ts
type RevisionSet = {
  contractHash: Sha256
  profileHash: Sha256
  geometryRevision: Sha256
  buildRevision: Sha256
  printPlanHash?: Sha256
  assessmentInputKey: Sha256
  qcSelectionHash: Sha256
  assessmentHash: Sha256
}
```

### Definitions

`contractHash`:

- `cad/acceptance-contract` framed hash of the locked contract with its own hash
  field omitted.
- Changes only through an approved replacement contract.

`profileHash`:

- `cad/manufacturing-profile` framed hash of the manufacturing profile embedded
  in the contract.

`bodySourceFingerprint`:

- IR part uses a `cad/body-source` payload
  `{ authoring: "ir", irHash, resolvedParams, schemaVersion,
  compilerIdentity, build123dVersion, ocpVersion }`.
- Hand part uses a `cad/body-source` payload
  `{ authoring: "hand", namedSourceFileHashes, paramsHash,
  isolationPolicyHash, buildEngineIdentity }`.
- `resolvedParams` and named files are sorted by UTF-8 name/path. This master
  framing replaces any prose-concatenation interpretation of the agent-loop
  fingerprint.

`regionSourceFingerprint`:

- `cad/region-source` framed payload over a part's region declaration and helper
  sources when supported.
- It changes region publication and geometry revision without forcing body
  re-export or changing `bodyHash`.

`geometryRevision`:

- The `cad/geometry-revision` payload contains schema version,
  geometry-relevant design projection, params file hash, sorted part records
  with body/region source fingerprints, and compiler/build identities.
- Excludes acceptance content, print plan, evidence, renders, and reviews.

`bodyHash`:

- SHA-256 of exact STEP bytes for one final artifact body.
- Artifact records also carry independent STL, GLB, and topology hashes.
- It is an artifact identity, not a promise that a fresh OCCT export is
  byte-deterministic. When source fingerprint, transform, and engine identity
  are unchanged, a new generation reuses the exact prior output bytes instead
  of re-exporting that body. A clean rebuild may require new evidence if its
  exact body bytes differ.

`buildRevision`:

- The `cad/build-revision` payload contains artifact schema/engine, geometry
  revision, sorted source provenance, source-to-artifact mapping, region
  registry, metrics, and output hashes with `buildRevision` omitted.

`assessmentInputKey`:

- The `cad/assessment-input` payload contains build revision, active contract
  hash, profile hash, print-plan hash when required, sorted evaluator
  identities/versions, and relevant region/render hashes.

`qcSelectionHash`:

- The `cad/qc-selection` payload contains sorted exact selected evidence
  IDs/record hashes, resolution/waiver receipt hashes, active visual-review hash,
  per-axis status, blockers, and computed completion.

`assessmentHash`:

- The `cad/assessment` payload is
  `{ assessmentInputKey, qcSelectionHash }`.
- QC reports and SPEC publication bind to this hash. A newer failing record,
  changed review decision, or changed warning closure changes selection and
  makes an older SPEC stale even when geometry inputs did not change.

### Incremental evidence

Evidence freshness uses an exact node input key, not global build equality:

```text
nodeInputHash = hash("cad/evidence-node", {
  evaluator, canonicalAtomicInputs, atomicCoverageId, contractHash, profileHash,
  subjects, regionHashes, printPlanEntryHash, renderHashes
})
```

`canonicalAtomicInputs` is produced by the evaluator from one atomic contract
node, not from the public tool-call envelope. Batch filters such as
`requirement_ids?`, input ordering, omitted defaults, and caller formatting only
choose which nodes run and never enter the hash. Each evaluator versions a
typed normalization schema and golden preimage fixtures. At minimum:

- construction normalizes one source provenance record;
- printability normalizes one artifact, profile, and print-plan entry;
- requirement/topology normalizes one locked requirement;
- interface normalizes one locked interface and its two extracted regions;
- reference normalizes one criterion plus active review/render-set provenance.

Evidence may be reused across builds only when its complete node input hash is
unchanged. The host records the derivation; it never silently rewrites an old
record to a new revision.

An evidence record's `buildRevision` is provenance for when it was produced,
not by itself a freshness requirement. A later report may reuse it only after
recomputing the node input hash from current body/region/profile/plan-entry
inputs and recording that derivation in `qc-report.json`.

## On-disk Model

```text
$STUDIO_HOME/studio/designs/<id>/
  design.json
  params.py
  acceptance.json                     # host-generated active activation record
  acceptance/
    history/<contract-hash>.json      # immutable contracts
    proposals/<proposal-hash>.json
    approvals/<approval-id>.json      # host-generated receipts
  ir/                                 # from agent-loop plan
  parts/
  regions/
    <source-part>.json                # editable only through cad_region_apply
  print-plan.json                     # host-generated active plan record
  print-plans/history/<plan-hash>.json
  evidence/
    records/<evidence-id>.json        # immutable host records
    resolutions/<resolution-id>.json
    waivers/<waiver-receipt-id>.json
    index.json                        # host-rebuilt index/cache
  renders/
    <build-revision>/
      <render-set-hash>/
        render-manifest.json
        <view-id>.png
  visual-review.json                  # host-generated active review record
  reviews/history/<record-hash>.json
  reviews/approvals/<approval-receipt-id>.json
  qc-report.json                      # latest computed report, not source
  .cad-dispatch.json                  # worker leases/generations
  .artifacts/
    <generation>/
    current -> <generation>
  SPEC.json
```

Operational caches and indexes may be rebuilt. Contract history, artifact
generations, evidence records, approval receipts, and accepted visual review
records, print-plan history, render manifests/bytes, and review history are
immutable once published. Active pointer records are replaceable only by their
host lifecycle tools and validate against immutable history on every read.

## Combined Design Schema 2

```ts
type DesignManifestV2 = {
  schema: 2
  id: string
  params: "params.py"
  acceptance: "acceptance.json"
  parts: DesignPartV2[]
}

type DesignPartV2 = {
  id: string
  qty: 1 | 2
  source: `parts/${string}.py`
  authoring: "ir" | "hand"
  ir?: `ir/${string}.json`
  regions?: `regions/${string}.json`
  escape_reason?: string
}
```

Rules:

- Keep the exact IR/hand field rules, safe paths, mirror collision checks, and
  maximum eight final bodies from `cad-agent-loop.md`.
- `acceptance` is required and fixed for schema 2.
- `regions` is required when the active contract references a region on that
  source part.
- Legacy schema 1 remains readable/buildable as hand mode. It receives a
  synthesized legacy contract that allows artifact validation but cannot claim
  interface, reference, or topology coverage until explicitly migrated.
- TypeScript and Python validators share fixtures and must accept/reject the same
  documents.
- `partPlanHash` uses the `cad/part-plan` framed payload containing design ID and
  design-order part records `{ id, qty, authoring, source, ir, regions,
  escape_reason }` with absent optionals omitted.

## Acceptance Contract v1

The initial release uses a smaller enforceable contract. Full delegated policy
and arbitrary approval graphs are deferred.

```ts
type AcceptanceContractV1 = {
  schema: 1
  revision: number
  state: "locked"
  authority: "harness" | "user" | "host_policy"
  contractHash: Sha256
  manufacturing: ManufacturingProfileV1
  dimensions: DimensionRequirementV1[]
  interfaces: AssemblyInterfaceV1[]
  topology: TopologyRequirementV1[]
  reference?: ReferencePolicyV1
  waiverPolicy: {
    mode: "forbidden" | "approved_only"
    nonWaivableRequirementIds: string[]
  }
}

type AcceptanceActivationV1 = {
  schema: 1
  activeContractHash: Sha256
  previousContractHash?: Sha256
  approvalReceiptId: string
  activationHash: Sha256
}

type ContractApprovalReceiptV1 = {
  schema: 1
  id: string
  proposalHash?: Sha256               // absent only for initial creation
  candidateContractHash: Sha256
  baseContractHash?: Sha256
  activation: "initial" | "immediate" | "with_part_plan"
  expectedPartPlanHash?: Sha256
  authority: "harness" | "user" | "host_policy"
  channel: "benchmark_fixture" | "opencode_user_prompt" | "configured_policy"
  policyId?: string
  approvedAt: string
  receiptHash: Sha256
  signingKeyId: string
  signature: string                     // Ed25519 signature over receiptHash
}

type AcceptanceProposalV1 = {
  schema: 1
  baseContractHash: Sha256
  candidateContractHash: Sha256
  activation: "immediate" | "with_part_plan"
  expectedPartPlanHash?: Sha256          // required only with_part_plan
  changedRequirementIds: string[]
  reason: string
  proposalHash: Sha256
}

type ManufacturingProfileV1 = {
  process: "fdm"
  buildVolumeMm: [number, number, number]
  nozzleMm: number
  nominalLayerMm: number
  minimumWallMm: number
  minimumPerimeters: number
  supportAngleDeg: number
  bedToleranceMm: number
  minimumFeatureMm: number
  defaultClearanceMm: number
}

type DimensionRequirementV1 =
  | {
      id: string
      kind: "bbox"
      artifactId: string
      measure: "size" | "min" | "max"
      axis: "X" | "Y" | "Z"
      targetMm: number
      toleranceMm: number
      waivable: boolean
    }
  | {
      id: string
      kind: "hole_diameter"
      artifactId: string
      match: { axis?: "X" | "Y" | "Z"; nearMm?: [number, number, number]; maxDistanceMm?: number }
      targetMm: number
      toleranceMm: number
      waivable: boolean
    }
  | {
      id: string
      kind: "wall"
      artifactId: string
      atMm: [number, number, number]
      direction: [number, number, number]
      minimumMm: number
      waivable: boolean
    }
  | {
      id: string
      kind: "station"
      artifactId: string
      axis: "X" | "Y" | "Z"
      tMode: "absolute" | "from_min" | "normalized"
      t: number
      target: { widthMm: number; depthMm: number; centerMm?: [number, number] }
      toleranceMm: number
      waivable: boolean
    }

type AssemblyInterfaceV1 = {
  id: string
  sides: [InterfaceRegionRef, InterfaceRegionRef]
  kind: "seat" | "slip" | "press" | "fastened" | "adhesive" | "contact"
  fit:
    | { kind: "clearance"; targetMm: number; toleranceMm: number }
    | { kind: "contact"; maximumGapMm: number }
    | { kind: "interference"; targetMm: number; toleranceMm: number }
  alignment?:
    | { kind: "coaxial" | "concentric"; toleranceMm: number }
    | { kind: "coplanar" | "parallel"; angleToleranceDeg: number; offsetToleranceMm: number }
  retention:
    | { kind: "none" | "gravity"; justification: string }
    | { kind: "fastener"; hardware: string; verification: "aligned_regions" }
    | { kind: "adhesive"; specification: string; verification: "contact_region" }
    | { kind: "friction"; targetInterferenceMm: number; toleranceMm: number }
  waivable: boolean
}

type TopologyRequirementV1 =
  | { id: string; kind: "closed_volume"; artifactIds: string[]; waivable: boolean }
  | { id: string; kind: "opening"; region: InterfaceRegionRef; minimumMm: [number, number]; waivable: boolean }

type RigidTransform = {
  translationMm: [number, number, number]
  quaternionXyzw: [number, number, number, number]
}

type ReferenceViewV1 =
  | { id: string; kind: "front" | "side" | "iso" }
  | { id: string; kind: "section"; plane: { originMm: [number, number, number]; normal: [number, number, number] } }
  | { id: string; kind: "exploded"; transforms: { artifactId: string; transform: RigidTransform }[] }

type ReferencePolicyV1 = {
  inputs: { path: string; sha256: Sha256 }[]
  requiredViews: ReferenceViewV1[]
  criteria: {
    id: string
    kind: "silhouette" | "proportion" | "feature_count" | "feature_placement" | "negative_space" | "surface_transition"
    description: string
    waivable: boolean
  }[]
  reviewer: "agent" | "human" | "independent_model"
  blocking: boolean
}
```

Contract rules:

- IDs are unique and every artifact/interface/region reference resolves against
  the declared part plan.
- All vectors are finite and normalized where required; dimensions and
  tolerances are positive.
- V1 retention is deliberately bounded: none/gravity requires justification;
  fastener requires fit plus declared analytic alignment; adhesive requires a
  contact-region pass; friction requires the declared interference target.
  Snap/undercut geometry retention is unsupported until P2 and remains
  unverified if requested by a future contract version.
- An interface-specific fit target is authoritative for that interface.
  `defaultClearanceMm` is used only to construct a proposed interface target.
- Effective minimum wall is the stricter of the manufacturing profile and any
  requirement-specific minimum.
- Unsupported topology or reference evaluator requirements remain unverified;
  they are never silently ignored.

Acceptance dimension evaluators run only on exact final STEP bodies and use
these fixed semantics:

- Bbox uses world-axis min/max/size from the final body.
- A hole is one grouped coaxial set of interior cylindrical faces connected to
  an exterior opening; counterbores/spotfaces belong to the same hole and the
  requirement measures the smallest bore diameter. Axis matching uses one
  degree angular tolerance. `nearMm` measures Euclidean distance to the exterior
  opening center, and `nearMm`/`maxDistanceMm` are both present or absent. The
  match must resolve exactly one hole.
- Wall uses the infinite line through `atMm` in both signs of the normalized
  direction. It intersects the solid, chooses the unique material interval that
  contains `atMm` within `1e-4 mm`, and reports that interval length. A point in
  void/outside material or multiple containing intervals is unverified;
  direction sign does not change the result.
- Station slicing matches `cad_analyze_form`: normalized `t` is in `[0,1]`, and
  orthogonal coordinates use X -> YZ, Y -> XZ, Z -> XY.
- Numeric targets pass within absolute tolerance; minimum requirements pass at
  or above the effective minimum.
- Region references always use the pair `(artifactId, regionId)`; unqualified
  region IDs are invalid.
- V1 `closed_volume` requires each named final STEP to be one watertight,
  manifold, positive-volume solid. V1 `opening` requires one published planar
  region whose extracted boundary width/depth meet the minimum. Through paths,
  accessible cavities, allowed-opening inventories, and motion envelopes are P2.

### Lock and revision lifecycle

Initial design creation is one host transaction:

1. Resolve a harness contract or normalize the agent-proposed interactive
   contract.
2. Present the normalized interactive summary through `context.ask`, unless an
   explicitly configured host policy owns approval.
3. Generate the approval receipt and locked contract in the host.
4. Write immutable contract history and receipt, then atomically publish an
   `AcceptanceActivationV1` as `acceptance.json` with a validated hash chain.
5. Write the design scaffold and sources in the same recoverable transaction.
6. Only after successful commit may workers dispatch or geometry mutate.

Harness contracts are injected by the benchmark runner and pinned by hash. The
agent cannot replace them.

After lock:

- `cad_acceptance_propose` creates an immutable proposal with base contract hash,
  candidate hash, activation mode, changed requirement IDs, and reason. A
  proposal coupled to part changes includes the exact expected
  `cad/part-plan` framed hash. `proposalHash` uses
  `cad/acceptance-proposal` with itself omitted.
- `cad_acceptance_approve` is host-authorized through user confirmation or a
  configured host policy. It writes a receipt bound to candidate/base hashes.
  `immediate` proposals activate through `acceptance.json`; `with_part_plan`
  proposals become `approved_pending` and do not change the active contract.
- Harness contracts reject proposals and approvals during a benchmark.
- Agent payloads never contain `approvedBy`, actor IDs, timestamps, or receipt
  IDs.
- Every read validates active contract hash, activation hash, approval receipt,
  candidate hash, base hash, authority channel, and append-only history chain.
- Approval receipts are signed by a host key stored outside the design
  workspace, or by a configured trusted harness key. Agent payloads and design
  files cannot supply trusted signing keys. Unknown keys or invalid signatures
  reject activation.
- `receiptHash` uses `cad/contract-approval` with `receiptHash` and `signature`
  omitted; `activationHash` uses `cad/acceptance-activation` with
  `activationHash` omitted.
- Contract changes do not rebuild unchanged geometry. They invalidate
  requirement evidence, QC, review, and SPEC through the assessment input/hash
  chain.

## IR and Hand Authoring

The full IR contract remains in `cad-agent-loop.md`, with these merged rules:

- IR `verify` claims are mutable compiler checks for fast feedback and
  construction provenance only.
- They are always evaluated on the final `show` solid.
- They cannot satisfy or replace locked acceptance requirements.
- Acceptance dimensions are re-evaluated independently on exact STEP body
  hashes by host requirement evaluators.
- Hand parts remain supported with an escape reason and receive the same outer
  acceptance/manufacturing/interface/reference gates as IR parts.
- New designs do not default to IR until the staged IR benchmarks meet rollout
  criteria.

### IR implementation stages

Prismatic beta:

- box/cylinder/cone primitives;
- principal-plane rectangle/circle sketches and extrude;
- hole, boolean, transform, linear/polar pattern;
- bbox, volume, hole-diameter, and wall local verification;
- restricted numeric params;
- base-hash writes, typed defects, final-shape metrics, and hand escape.

Manufactured-freeform expansion:

- revolve, loft, path/sweep, shell;
- deterministic selectors, fillet, chamfer;
- station verification and speaker-class form fixtures;
- viewer-to-IR selector diagnostics.

History/diff ships only if agent runs demonstrate a concrete rollback or
comparison need. Compiler internals may keep bounded operational history without
exposing it as product source.

## Build and Artifact Contract

Keep the artifact schema 2 source-to-artifact mapping from the agent-loop plan,
including identity/mirror mapping, construction status, metrics, and exact input
provenance. Add output and region hashes:

```ts
type ArtifactPartV2 = {
  id: string
  source_part: string
  transform: "identity" | "mirror_yz"
  files: {
    step: string
    stl: string
    glb: string
    topo: string
  }
  hashes: {
    bodyHash: Sha256                 // exact STEP bytes
    stl: Sha256
    glb: Sha256
    topo: Sha256
  }
  metrics: ArtifactMetrics
}

type ArtifactManifestV2 = {
  schema: 2
  id: string
  geometryRevision: Sha256
  buildRevision: Sha256
  sources: ArtifactSourceV2[]
  parts: ArtifactPartV2[]
  regions: ArtifactRegionV1[]
  build: {
    engine: "forge-cad/2"
    compilerIdentity: Sha256
    inputs: Record<string, Sha256>
  }
}

type ArtifactExecutionTrustV2 =
  | { authoring: "ir"; trusted: true; policy: "owned_ir_compiler" }
  | {
      authoring: "hand"
      trusted: boolean
      isolationBackend: string
      isolationPolicyHash: Sha256
      declaredEnvironmentHash: Sha256
    }
```

Every artifact source record includes matching `ArtifactExecutionTrustV2`.
Schema 2 requires `trusted: true`; unsafe legacy diagnostics remain readable but
construction/QC treat them as failed authority.
Each source record also carries separate `bodySourceFingerprint` and optional
`regionSourceFingerprint`, so region-only publication can change build revision
without re-exporting or invalidating an unchanged body hash.

Important separation:

- Acceptance, print plan, evidence, renders, and reviews are not geometry build
  inputs.
- Region declarations and helper sources are geometry inputs because they are
  published against body geometry.
- Artifact manifests do not become stale solely because acceptance changes.
- QC always evaluates the active contract against the current build revision.

Build behavior:

- Derive an explicit input allowlist from schema 2.
- Use one documented cross-process lock, journal, and recovery format from both
  TypeScript and Python. Every authoritative mutation/freshness read enters the
  same protocol; no language keeps a private lock domain.
- Exactly one outer coordinator owns the lock per operation. Pure host mutations
  acquire it in TypeScript. IR compile/apply and product build acquire it in the
  Python coordinator; their TypeScript callers do not pre-lock. Nested compiler,
  artifact, and hand-build children receive an in-memory already-held context
  from the coordinator and never reacquire or receive a forgeable filesystem
  token. Hand source receives no lock capability.
- Run OCCT compile/export in killable subprocesses before warm-worker watchdogs.
- Run hand sources only inside the mandatory isolation snapshot defined by the
  protected mutation boundary.
- Reuse the current unpublished artifact generation and atomic `current` switch.
- Validate source and STEP as exactly one valid non-zero-volume solid.
- Hash all output bytes before manifest publication.
- Re-hash all inputs before switching the generation.
- Preserve the previous generation on timeout, crash, input drift, or any part
  failure.
- Treat only the validated `current` pointer/commit record as published. Readers
  never fall back to the newest generation by mtime.
- Reuse exact prior output bytes for unchanged body source fingerprint,
  transform, isolation/compiler policy, and engine identity so unrelated or
  region-only rebuilds preserve body hashes.
- Keep the eight-final-body v1 limit and validate the configured nested timeout
  ordering mathematically.

Artifact commit record:

```ts
type ArtifactCommitV1 = {
  schema: 1
  generation: string
  manifestHash: Sha256
  buildRevision: Sha256
  previousGeneration?: string
  committedAt: string
  commitHash: Sha256
}
```

The builder fsyncs manifest/output files and `COMMITTED.json`, then atomically
switches `current`. `commitHash` omits itself. Readers require the pointer target,
commit record, manifest hash, and build revision to agree. Recovery uses the
journal's recorded previous pointer; it never scans mtimes for a replacement.
`manifestHash` is the explicit raw-byte exception
`SHA-256(exact manifest.json bytes)`. `commitHash` uses the framed
`cad/artifact-commit` payload containing every commit field except itself.

Default timeout ordering is inherited as one validated configuration:

```text
IR apply:     lock wait 30s + part child 20s + margin < RPC 65s
IR compile:   lock wait 30s + aggregate children 160s + margin < RPC 205s
Product:      lock wait 60s + product child 340s + margin < controller 415s
Controller:   415s < TypeScript call 430s < runtime session ceiling 450s
```

The host creates a build-control token/path outside the design and passes it to
the product controller. Abort writes the cancel signal; the controller polls it,
terminates the active process group, waits up to 10 seconds, escalates to
SIGKILL, and returns only after child exit and transaction cleanup. Expected
abort/timeout therefore cannot continue publishing after the RPC returns. The
outer runtime is reset only if this cancellation protocol itself fails.

## Interface Regions v1

The first release supports analytic, attachment-validated regions only. Helper
solids are deferred.

```ts
type SpatialAxis = {
  originMm: [number, number, number]
  direction: [number, number, number]   // normalized
}

type RegionFrame = {
  originMm: [number, number, number]
  xDirection: [number, number, number] // normalized
  yDirection: [number, number, number] // normalized
  normal: [number, number, number]     // x cross y
}

type RegionDeclarationFileV1 = {
  schema: 1
  sourcePart: string
  regions: RegionDeclarationV1[]
}

type RegionDeclarationV1 = {
  id: string
  attachmentToleranceMm: number
  query:
    | { kind: "plane"; frame: RegionFrame; boundaryMm: [number, number] }
    | { kind: "cylinder"; axis: SpatialAxis; radiusMm: number; rangeMm: [number, number] }
}

type InterfaceRegionRef = {
  artifactId: string
  regionId: string
}

type ArtifactRegionV1 = {
  artifactId: string
  sourcePart: string
  regionId: string
  declarationHash: Sha256
  bodyHash: Sha256
  regionHash: Sha256
  geometry:
    | { kind: "plane"; frame: RegionFrame; boundaryMm: [number, number]; faceSignature: string }
    | { kind: "cylinder"; axis: SpatialAxis; radiusMm: number; rangeMm: [number, number]; faceSignature: string }
}
```

Rules:

- Region IDs are unique per source part; published identity is
  `(artifactId, regionId)`.
- `declarationHash` uses `cad/region-declaration` over the complete declaration
  file. Numeric region hashing/signatures quantize millimeters to `1e-6` and
  direction components to `1e-9`.
- `attachmentToleranceMm` must be positive and no greater than the
  profile-independent v1 host cap of `0.1 mm`; the agent cannot widen it.
- Build treats declaration geometry as a query against exact STEP and requires
  exactly one bounded planar or cylindrical surface match. Detached, ambiguous,
  or partial-out-of-boundary matches block publication.
- Plane boundaries and cylinder ranges are preserved in artifact records.
- Artifact geometry is host-extracted from the matched STEP surface, not copied
  from authored nominal coordinates. `regionHash` uses `cad/artifact-region`
  over artifact ID, body hash, extracted geometry, and declaration hash.
- Plane frame origin is the queried origin projected onto the matched face;
  normal is oriented toward the query normal; query X projected into the plane
  defines X and `normal cross X` defines Y. Parallel/degenerate query axes fail.
- Cylinder axis origin is the closest point on the extracted axis to the query
  origin and direction is oriented with the query direction. `faceSignature`
  canonically contains surface kind, quantized center/axis/normal, radius when
  applicable, area, and bounds.
- Mirrors receive deterministic YZ-transformed frames, boundaries, axes, and
  handedness.
- Interface evaluators resolve exactly the two locked region references and
  bind evidence to both body and region hashes.
- Global whole-body minimum distance remains diagnostic and cannot satisfy an
  interface requirement.

V1 interface evaluators support clearance/contact/interference, declared
analytic alignment, and the bounded retention rules in `AssemblyInterfaceV1`.
Snap/undercut retention, motion paths, compliant behavior, and helper-solid
interfaces are P2.

## Print Plan and Manufacturing

`print-plan.json` is created only after a build because it binds exact body
hashes.

```ts
type PrintPlanV1 = {
  schema: 1
  buildRevision: Sha256
  profileHash: Sha256
  entries: PrintPlanEntryV1[]
  planHash: Sha256
}

type PrintPlanEntryV1 = {
  artifactId: string
  bodyHash: Sha256
  transformArtifactToBed: RigidTransform
  transformedBoundsMm: {
    min: [number, number, number]
    max: [number, number, number]
    size: [number, number, number]
  }
  entryHash: Sha256
}
```

Coordinate convention:

- Right-handed millimeter coordinates.
- The transform maps artifact coordinates into printer-bed coordinates.
- Bed plane is `Z=0`; positive Z points upward.
- Quaternion is XYZW, finite, and normalized within `1e-6`.

Host behavior:

- `cad_print_plan_apply` accepts proposed transforms only. The host imports exact
  STEP bodies, applies transforms, computes bounds, and writes hashes.
- Every artifact has exactly one entry. Missing or duplicate entries fail.
- `entryHash` uses `cad/print-plan-entry` with `entryHash` omitted. `planHash`
  uses `cad/print-plan` over the complete ordered plan with `planHash` omitted.
  The host stores every accepted plan under `print-plans/history/<planHash>.json`
  before replacing active `print-plan.json`.
- Every active-plan read recomputes its hash and requires an identical immutable
  history record; a mismatched or missing history record makes the plan invalid.
- Changing build revision, body hash, or profile hash stales the plan.
- Printability imports exact STEP, applies the recorded transform, and supplies
  all manufacturing-profile fields to the analyzer.
- Bed validity requires `minZ >= -bedToleranceMm` and
  `minZ <= bedToleranceMm`, so the transformed body neither penetrates nor
  floats above the bed. X/Y minima must be at least zero within tolerance and
  every maximum must fit the profile build volume. Omitted profile fields never
  imply an unlimited printer.
- Mirrored artifacts require their own entry unless a host derivation records
  that the transform preserves the pose and body/profile inputs.

## Durable Evidence

Session evidence remains useful for diagnosis but cannot complete QC. Completion
uses immutable host records:

```ts
type CadEvidenceV2 = {
  schema: 2
  id: string
  sequence: number                    // host monotonic per design
  recordHash: Sha256
  axis: "construction" | "requirement" | "printability" | "interface" |
        "topology" | "reference" | "warning_resolution"
  evaluator: { id: string; version: string }
  atomicCoverage: {
    kind: "source" | "artifact_printability" | "requirement" | "interface" |
          "reference_criterion" | "warning_finding"
    id: string
  }
  nodeInputHash: Sha256
  buildRevision: Sha256
  contractHash: Sha256
  profileHash: Sha256
  printPlanHash?: Sha256
  printPlanEntryHash?: Sha256
  requirementIds: string[]
  subjects: {
    artifactId: string
    bodyHash: Sha256
    regionId?: string
    regionHash?: Sha256
  }[]
  status: "pass" | "fail" | "unverified"
  evaluation: {
    schemaId: string                  // evaluator-owned versioned JSON schema
    normalizedInput: JsonValue
    output: JsonValue
  }
  findings: StructuredFindingV2[]
  recordedAt: string                 // host generated
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

type FindingClaimV2 =
  | {
      kind: "wall_line"
      artifactId: string
      bodyHash: Sha256
      atMm: [number, number, number]
      direction: [number, number, number]
      reportedMm: number
      requiredMm: number
    }
  | {
      kind: "region_distance"
      interfaceId: string
      regionHashes: [Sha256, Sha256]
      reportedMm: number
      targetMm: number
      toleranceMm: number
    }
  | {
      kind: "recognized_feature"
      artifactId: string
      bodyHash: Sha256
      featureKind: "hole"
      locator: { axis?: "X" | "Y" | "Z"; nearMm?: [number, number, number]; maxDistanceMm?: number }
      reportedMm: number
      targetMm: number
      toleranceMm: number
    }

type StructuredFindingV2 = {
  id: string
  severity: "info" | "warning" | "error"
  kind: string
  message: string
  locationMm?: [number, number, number]
  requirementIds: string[]
  claim?: FindingClaimV2
  claimHash?: Sha256
}

type WarningResolutionV2 =
  | { kind: "fixed"; findingId: string; successorEvidenceId: string }
  | { kind: "disproved"; findingId: string; localizedEvidenceId: string }
  | { kind: "waived"; findingId: string; waiverReceiptId: string }

type WarningResolutionRecordV2 = {
  schema: 2
  id: string
  sequence: number
  recordHash: Sha256
  contractHash: Sha256
  resolution: WarningResolutionV2
  createdAt: string
}

type WarningWaiverReceiptV1 = {
  schema: 1
  id: string
  contractHash: Sha256
  findingId: string
  requirementIds: string[]
  supportingEvidenceIds: string[]
  reason: string
  acceptedRisk: string
  authority: "user" | "host_policy"
  channel: "opencode_user_prompt" | "configured_policy"
  approvedAt: string
  receiptHash: Sha256
  signingKeyId: string
  signature: string
}
```

Evidence rules:

- Only host evaluators write records.
- `recordHash` uses `cad/evidence-record` with itself omitted.
- Evidence subjects must be final artifact IDs/body hashes, never scratch or
  session object names.
- Requirement IDs are emitted by the evaluator from its requested contract
  coverage; callers cannot claim arbitrary IDs.
- Every evaluator ships the `evaluation.schemaId` schema and canonical input
  normalizer with golden fixtures; normalized input/output participate in record
  hashing. A finding with `claim` requires matching `claimHash`; a finding
  without `claim` forbids it and cannot use the disproved path.
- Evidence nodes are atomic. A batch tool fans out and writes one record per
  source construction check, artifact printability check, contract requirement,
  interface, or reference criterion. It never writes one pass/fail record that
  spans an optional subset.
- QC enumerates the complete expected atomic coverage set from the active
  contract, design sources, and artifact manifest. For each expected node it
  recomputes the one current `nodeInputHash`, then selects only the greatest
  sequence with exactly that hash/coverage ID. Missing nodes are unverified;
  records for older hashes or broader/narrower batches cannot substitute.
- Current evidence is selected by exact node input hash and greatest unique
  host `sequence`; wall-clock time is display metadata only. Evidence and
  resolution sequences are allocated under the shared design lock and never
  reused, so all readers select the same record.
- Revisionless records are never accepted.
- The on-disk index is a cache and can be reconstructed from validated records.
- Host restart does not lose completion evidence.

## Warning Resolution

Warnings and errors block by default. Narrative findings do not resolve them.

Stable finding ID:

```text
hash("cad/finding", {
  evaluator, contractHash, bodyAndRegionHashes, kind, quantizedLocation,
  requirementIds, claimHash
})
```

Closure states:

- `fixed`: a newer successor evaluation may have a different body/region hash,
  but must name the old finding, cover the same logical artifact/region and all
  affected requirement IDs, omit the finding, and pass them. Geometry fixes are
  therefore allowed to create a new node.
- `disproved`: a current localized measurement record names the exact finding,
  same body/region hash, location/feature, and affected requirements.
- `waived`: a host-generated approval receipt names the finding, accepted risk,
  supporting current evidence, and waivable requirement IDs.
- `unresolved`: everything else.

No resolution may reference itself or a stale/circular evidence chain. Harness
non-waivable requirements reject all waivers. Interactive waivers require a user
approval prompt or configured host policy; agent-provided actor metadata is
ignored.

Resolution records are immutable under `evidence/resolutions/`; their
`recordHash` uses `cad/warning-resolution` with itself omitted.
`cad_warning_resolve` creates fixed/disproved records only
after validating successor/localized evidence. `cad_warning_waive` uses the
separate always-prompt `cad_approve` permission and writes a signed
`WarningWaiverReceiptV1`; routine `cad_mutate` approval can never authorize a
waiver. Its `receiptHash` uses `cad/warning-waiver` with hash/signature omitted;
signature trust rules match contract approvals.

`cad_verify_finding` is the host producer for localized disproval evidence. It
accepts only a finding ID, loads its evaluator-owned `FindingClaimV2`, resolves
the claim's exact current body/region hashes, derives the normalized probe from
that claim, runs the corresponding host evaluator, and persists normalized
input/output in one `CadEvidenceV2` node with
atomic coverage `{ kind: "warning_finding", id: findingId }`. Unsupported probes
or findings without a claim are unverified. `claimHash` uses
`cad/finding-claim`; it is included in finding/node hashes. Only a passing
current record whose normalized input exactly corresponds to that claim and
directly contradicts it may be consumed by
`cad_warning_resolve(kind: "disproved")`.

Waivers apply uniformly to dimension requirements, interfaces, topology
requirements, and reference criteria:

- The target schema item must have `waivable: true` and its ID must not appear in
  `nonWaivableRequirementIds`.
- The current failed/unverified atomic evidence must emit the targeted finding
  and requirement ID; a waiver cannot replace missing evaluator execution.
- The receipt names exactly that ID/finding, current supporting evidence, risk,
  and active contract hash.
- Artifact integrity, construction trust, manufacturing-profile availability,
  evidence provenance, and required reference input/view production are never
  waivable in v1.
- An axis closed partly by valid waivers reports `pass_with_waiver`, not clean
  pass. Completion accepts it only when the contract policy allows; benchmarks
  may forbid it.

## Deterministic Final Renders and Review

Host-rendered evidence is separate from arbitrary diagnostic renders.

```ts
type RenderSetManifestV1 = {
  schema: 1
  renderSetHash: Sha256
  buildRevision: Sha256
  contractHash: Sha256
  renderer: { id: string; version: string; settingsHash: Sha256 }
  views: {
    viewId: string
    definition: ReferenceViewV1
    artifactBodyHashes: Record<string, Sha256>
    path: string
    pngHash: Sha256
  }[]
}

type VisualReviewRecordV1 = {
  schema: 1
  recordHash: Sha256
  reviewPayloadHash: Sha256
  sequence: number
  buildRevision: Sha256
  contractHash: Sha256
  renderSetHash: Sha256
  reviewer:
    | { kind: "agent"; sessionId: string }
    | { kind: "human"; approvalReceiptId: string }
    | { kind: "independent_model"; provider: string; model: string; requestHash: Sha256 }
  criteria: {
    criterionId: string
    status: "pass" | "fail" | "unverified"
    findingIds: string[]
  }[]
  findings: StructuredFindingV2[]
}

type HumanReviewApprovalReceiptV1 = {
  schema: 1
  id: string
  contractHash: Sha256
  buildRevision: Sha256
  renderSetHash: Sha256
  reviewPayloadHash: Sha256
  authority: "user" | "harness_reviewer"
  channel: "opencode_user_prompt" | "benchmark_fixture"
  approvedAt: string
  receiptHash: Sha256
  signingKeyId: string
  signature: string
}

type ReviewFindingInputV1 = {
  criterionId: string
  severity: "info" | "warning" | "error"
  kind: string
  message: string
}
```

`cad_reference_render`:

- Loads exact final artifact GLB/STEP by build revision.
- Uses an orthographic camera fitted to exact scene bounds with 10% margin,
  1600x1200 raster, white background, and fixed renderer settings. Front looks
  along world `-Y` with `+Z` up; side along `-X` with `+Z` up; iso along
  normalized `(-1,-1,-1)` with projected `+Z` up. Section planes and exploded
  transforms come from the locked `ReferenceViewV1` definitions.
- Records artifact IDs/body hashes, scene transform, camera, clip plane,
  dimensions, renderer identity/version, output path, and PNG hash in
  `render-manifest.json`.
- Computes `renderSetHash` from build/contract hashes, exact view definitions,
  artifact/scene transforms, renderer identity/version/settings, and output
  dimensions using `cad/render-set`; manifest `renderSetHash` is omitted from
  that payload. It writes immutable files under
  `renders/<buildRevision>/<renderSetHash>/`; rerendering different inputs never
  overwrites bytes referenced by review history.
- Never renders unnamed scratch session objects for final evidence.

`cad_reference_review` accepts criterion statuses and typed
`ReviewFindingInputV1[]`; the host validates provenance, assigns canonical
finding IDs/full `StructuredFindingV2` records, verifies each criterion's
finding references, and writes the review. The host can prove coverage and
freshness, not visual resemblance itself.

- Interactive contracts may authorize agent or human review.
- Benchmark contracts choose human or independent-model review when visual
  fidelity is a blocking score.
- Every locked reference hash, required view hash, and criterion ID must appear
  exactly once.
- A changed build, reference, renderer input, contract, or required view stales
  the review.
- Missing independent reviewer capability yields `unverified`, not a pass.
- Before updating active `visual-review.json`, the host writes the immutable
  record to `reviews/history/<recordHash>.json`. The active record contains that
  hash and is validated against history on every read.
- Visual review `recordHash` uses `cad/visual-review` with itself omitted.
- `reviewPayloadHash` uses `cad/visual-review-payload` over build/contract/render
  hashes, criterion results, and full findings before reviewer receipt fields.
  For `reviewer: human`, the tool first creates this immutable proposed payload,
  then invokes the always-prompt `cad_approve` channel displaying the exact
  criteria/findings/hash. Only that user event, or a pre-signed trusted harness
  reviewer fixture, may cause the host to sign and publish
  `HumanReviewApprovalReceiptV1` under `reviews/approvals/`; the calling agent
  cannot approve it. Its receipt hash uses `cad/human-review-approval` with
  hash/signature omitted. Offline validation requires trusted key, matching
  payload/build/contract/render hashes, and matching active review receipt ID.
- Accepting a visual review also emits one immutable `CadEvidenceV2` record per
  locked criterion. Each record uses atomic coverage
  `{ kind: "reference_criterion", id: criterionId }`, links the active review
  record/render-set hashes in its canonical inputs, copies that criterion's full
  `StructuredFindingV2` subset and status, and receives its own host sequence.
  The bundled review is provenance; these atomic records are the QC selection
  authority.
- P0 includes a benchmark reviewer adapter so a harness contract requiring an
  independent model has an implementable path before wall-sconce becomes a
  blocking release gate.

## Host-computed QC

`cad_design_qc_report({ id })` takes no agent pass/fail inputs. It computes:

| Axis | Pass condition |
| --- | --- |
| Artifact | Current manifest validates; every declared final artifact and output hash exists |
| Construction | Every IR source has matching compiler provenance/local checks; every hand source has an escape reason and trusted isolated build |
| Requirements | Every locked dimension requirement has current passing evidence or valid requirement waiver |
| Manufacturing | Every final artifact has a current print-plan entry and profile-bound printability pass |
| Interfaces | Every declared interface has fit/alignment plus bounded retention evidence, or a valid interface waiver |
| Topology | Every declared supported topology requirement has current passing evidence or valid topology waiver |
| Reference | Not required, or required views/review exist and every criterion passes or has a valid criterion waiver |
| Findings | No unresolved warning/error remains |

Computed `not_required` is allowed only when the locked contract declares no
requirements for that axis. Agents cannot submit `not applicable`.
Axis status is `pass`, `pass_with_waiver`, `fail`, `unverified`, or
`not_required`; only the first two satisfy a required axis under policy.

`complete` is true only when every required axis passes. The report writes
`qc-report.json` with assessment input key, QC selection hash, assessment hash,
exact evidence/closure/review IDs and record hashes, blocked requirement IDs,
unresolved finding IDs, and evaluator versions.

SPEC publication occurs only from a complete current report. SPEC freshness is
recomputed under the shared lock by selecting current evidence/review/closure
records again and reproducing `assessmentHash`. A changed newest record or
review makes the old selection hash differ and the SPEC stale. Evidence/review
records are referenced by hashes in SPEC facts rather than treated as editable
geometry source.

## Worker Ownership

Schema 2 workers are owned work units:

```ts
type CadWorkerRecordV2 = {
  partId: string
  authoring: "ir" | "hand"
  sessionId: string
  generation: number
  leaseId: string
  state: "starting" | "running" | "ready" | "failed" | "cancelled" | "superseded"
  leaseExpiresAt: string
  heartbeatAt: string
  startedAt: string
  finishedAt?: string
  error?: string
}
```

Rules:

- Every worker mutation validates implicit session ID, current generation,
  active lease, eligible `starting|running` state, assigned part, and base hash
  while holding the design lock. Ready, failed, cancelled, and superseded states
  cannot publish.
- Lease IDs and generations are host-generated and never trusted from arbitrary
  payload fields.
- Every successful worker tool call renews heartbeat/lease.
- Default lease duration is 60 seconds and workers renew at least every 20
  seconds while actively invoking tools. Expiry uses host monotonic time; after
  host restart every previously running lease is expired and requires takeover.
- Parent takeover increments generation and marks the prior record superseded.
- Failure, cancellation, readiness, expiry, authoring-mode change, and takeover
  revoke the old lease. A resumed process cannot become eligible without a new
  host generation/lease record.
- OpenCode cancellation is best effort; stale generation rejection is the hard
  publication boundary.
- Workers cannot mutate acceptance, params, print plans, evidence, reviews, QC,
  or other parts.
- New IR workers publish through `cad_ir_apply`.
- Hand workers, when enabled, publish only through `cad_hand_source_apply`.
- Initially, hand-mode parts may remain parent-owned to reduce write-surface
  risk.
- P0 disables all schema 2 worker dispatch. Primary parent transactions operate
  through base hashes until P1-B installs generation/lease enforcement; there is
  no partially enforced P0 worker mode.
- `cad_design_join` reads ledger state. Event-driven updates are P2; bounded
  polling is acceptable after stale writes are enforceably rejected.

Spawn is two phase to avoid a first-write race:

1. Create the OpenCode child session without prompting it.
2. Atomically persist the `starting` worker record, generation, and lease for
   that session.
3. Only then call `promptAsync` and transition to `running` on acceptance.
4. Prompt failure marks the record failed; it never deletes generation history.

## Public Tool Plan

### Existing lifecycle retained

- `cad_design_create`
- `cad_design_read`
- `cad_design_build`
- `cad_design_join`
- `cad_design_qc_report` with no status claims

For schema 2, `cad_design_create` takes the complete part plan, params, and a
candidate acceptance contract. In benchmark mode the host substitutes the
pinned harness contract and rejects an agent-supplied replacement. Interactive
creation performs the approval/activation transaction before scaffolding or
dispatch.

### Protected source and contract tools

- `cad_params_read`, `cad_params_apply`
- `cad_part_plan_read`, `cad_part_plan_apply`, `cad_part_authoring_apply`
- `cad_hand_source_read`, `cad_hand_source_apply`
- `cad_ir_read`, `cad_ir_apply`, `cad_ir_compile`, `cad_ir_docs`
- `cad_region_read`, `cad_region_apply`
- `cad_acceptance_read`, `cad_acceptance_propose`, `cad_acceptance_approve`
- `cad_print_plan_read`, `cad_print_plan_apply`

`cad_part_authoring_apply` is the only tool that changes `authoring`, `ir`,
`source`, or `escape_reason`. It uses manifest base-hash semantics and performs
IR-to-hand or hand-to-IR cleanup/scaffolding as one transaction after validating
contract part/region references. It first increments/supersedes any active worker
generation for that part and revokes its lease.

`cad_part_plan_apply` adds/removes/splits parts or changes quantity through a
manifest base hash. An uncoupled change validates the resulting plan against the
current active contract and rejects dangling artifact/interface references. A
coupled change requires the signed approved-pending proposal/receipt, current
base contract hash, and candidate's expected part-plan hash; it validates the
resulting plan against the candidate contract, not the old active contract. It
atomically publishes the new manifest and candidate activation or neither, then
invalidates affected artifacts, regions, plans, and evidence. Harness benchmark
fixtures reject any result that differs from their expected part plan.

### Artifact-bound evidence tools

- `cad_verify_requirements({ id, requirement_ids? })`
- `cad_verify_printability({ id, artifact_ids? })`
- `cad_verify_interfaces({ id, interface_ids? })`
- `cad_verify_topology({ id, requirement_ids? })`
- `cad_reference_render({ id })`
- `cad_reference_review({ id, criteria, findings })`
- `cad_verify_finding({ id, finding_id })`
- `cad_warning_resolve({ id, finding_id, kind, evidence_id })`
- `cad_warning_waive({ id, finding_id, reason, accepted_risk })`

Contract activation and warning waivers request `cad_approve`, an always-prompt
permission with no persistent allow option. Routine source/plan writes request
`cad_mutate`; the two permissions are never interchangeable.

Existing session `cad_validate`, `cad_measure`, `cad_compare`,
`cad_analyze_printability`, `cad_analyze_form`, and `cad_render_view` remain
diagnostic tools. Their outputs become completion evidence only when invoked by
artifact-bound host evaluators with exact inputs.

## Semantic Benchmark Scoring

Each CAD benchmark gets a machine-readable fixture beside its prompt:

```text
studios/cad/test/benchmarks/<case>.acceptance.json
studios/cad/test/benchmarks/<case>.benchmark.json
```

```ts
type CadBenchmarkFixtureV1 = {
  schema: 1
  expectedDesignId: string
  expectedParts: {
    id: string
    qty: 1 | 2
    allowedAuthoring: ("ir" | "hand")[]
  }[]
  pinnedContractHash: Sha256
  wallTimeMs: number
  allowedEscapeReasons: string[]
  requiredReviewer: "agent" | "human" | "independent_model"
  nonWaivableRequirementIds: string[]
}
```

The expected design/part/mirror plan is harness authority, not agent-authored
`design.json` authority. The scorer requires exactly one matching design and
rejects missing, extra, or quantity-mismatched source/artifact parts.

Runner behavior:

1. Validate and inject the harness-owned contract before agent execution.
2. Reject any active contract hash change.
3. Enforce wall-time/cancellation and record exit status.
4. After the process exits, locate the fixture's exact design ID without using
   tool events, then recompute host completion using
   the same production validators/evidence graph.
5. Validate every expected identity/mirror artifact, output hash, requirement,
   interface, warning, print pose, and blocking review.
6. Inspect event logs only for behavior metrics such as tool counts, escapes,
   retries, and forbidden Bash/edit attempts.

CAD benchmark pass never depends on the last `cad_design_qc_report` event or an
agent-provided `complete` boolean.

Score output includes:

- `hostComplete` from disk truth;
- `agentClaimedComplete` when the final response contains the required
  structured marker;
- disagreement as an agent-quality failure signal;
- blocked requirement/finding/interface IDs;
- wall time, token/tool counts, build attempts, cache hits, escape reasons, and
  worker takeovers.

Retire or update any separate Python scorer so there is one semantic scoring
authority.

## Priority Roadmap

### P0-A: Contract freeze and write boundary

Implement first:

- Combined schema 2 and shared TS/Python fixtures.
- Revision/hash definitions and canonicalization.
- Protected domain-only mutation tools.
- CAD primary/worker denial of generic writes and Bash.
- Dedicated `cad_mutate` permission, diagnostic scratch-only outputs, and
  mandatory isolated hand-build backend.
- One cross-process lock/recovery protocol shared by every authoritative
  TypeScript and Python read-modify-write path.
- Initial acceptance lock inside design creation.
- Schema 1 read/build migration.

Exit criteria:

- No schema 2 geometry or host record can be mutated outside its allowed tool in
  an isolated OpenCode integration test.
- Harness and user acceptance locks are host-generated before dispatch.
- Reordered JSON keys do not change canonical hashes.
- TS/Python validator parity passes.

### P0-B: Bounded build and artifact provenance

- Manifest-derived input allowlist.
- Shared lock, bounded subprocess, and atomic generation behavior.
- Geometry/build revisions and exact output hashes.
- Source-to-identity/mirror mapping and analytic region publication.
- Previous-generation preservation on all failure paths.
- `current` plus its validated commit record is the only artifact publication
  authority. Remove `resolveArtifactGeneration`'s newest-mtime fallback; recovery
  restores a prior recorded pointer and never promotes an unpointed generation.
- Wire and test the actual production path through `host/build.ts`,
  `tools/session.ts`, `cad_runtime/tools/studio_build.py`, and
  `cad_runtime/worker.py`, including in-process mode and nested timeout order.

Exit criteria:

- Killing or timing out each stage exposes either the complete old or complete
  new generation.
- Warm session survives product-build timeout.
- Input drift blocks publication.
- Eight-body budget hierarchy is validated.
- Artifact hashes and mappings validate offline.

### P0-C: Durable evidence and host completion

- Immutable evidence store and node input hashes.
- Acceptance dimension evaluators.
- Print plan and manufacturing-profile checks.
- Analytic interface-region fit/alignment coverage.
- V1 closed-volume and planar-opening topology evaluators.
- Structured finding closure and simple approved waivers.
- Deterministic final render manifest and blocking review provenance.
- Harness independent-review adapter for reference-driven benchmark contracts.
- Claim-free `cad_design_qc_report` and SPEC publication.

Exit criteria:

- Evidence survives restart and stale evidence never completes a new input set.
- Every locked requirement is passed, closed, or listed as a blocker.
- Every artifact and interface has complete current coverage.
- Missing profile, pose, warning resolution, required view, or reviewer blocks.
- Wall-sconce cannot pass via agent-authored form N/A.

### P0-D: Semantic benchmark scorer

- Harness contract fixtures and pinning.
- Offline production-validator scoring.
- Mirror, provenance, interface, warning, pose, review, and wall-time gates.
- Host/agent completion disagreement metric.

Exit criteria:

- Forged tool output or `complete: true` cannot pass.
- Negative fixtures cover wrong contract, stale evidence/render, missing mirror,
  incomplete interface, unresolved warning, oversized part, and absent review.
- `project-box-v0` and `wall-sconce-v0` become trusted release gates.

### P1-A: Prismatic IR beta

- Implement the prismatic subset, deterministic params, final-shape local checks,
  typed defects, base-hash writes, and exact built provenance.
- Keep default authoring hand unless explicitly selected.
- Preserve mixed IR/hand and legacy schema 1 builds.

Exit criteria:

- Repeated clean compiles are deterministic.
- `project-box-v0` uses IR for all expressible parts without `cad_execute`.
- Acceptance is independently rechecked on final body hashes.
- Measured failed iterations improve over the hand baseline.

### P1-B: Worker generations and leases

- Scoped IR/hand writes, generation takeover, heartbeat renewal, stale-write
  rejection, and bounded join.
- Keep dispatch disabled for schema 2 until publication leases are enforced.

Exit criteria:

- A superseded worker cannot publish even if its process continues.
- Three disjoint IR workers publish safely.
- Same-part stale base/generation races fail without mutation.
- Parent takeover is deterministic and auditable.

### P2-A: Manufactured-freeform IR

- Complete the remaining agent-loop operations needed for revolve, shell,
  loft/sweep, selectors, fillets/chamfers, and station form.
- Make wall-sconce and speaker the form/provenance gates.
- Default new parts to IR only after benchmark completion and iteration metrics
  meet or beat the hand baseline.

### P2-B: Advanced product verification

- Region helper solids.
- Motion stages and interface-region motion checks.
- Snap/undercut and compliant retention evidence plus functional topology
  assertions.
- Richer section/exploded output UX and interactive human-review integration.

### P2-C: Efficiency and polish

- Incremental evidence DAG scheduling and caches.
- Event-driven join/cancellation where OpenCode supports it.
- Bounded retry/no-progress policy.
- IR history/diff if telemetry proves it useful.
- Escape-driven IR operation additions.

## Implementation Surfaces

| Surface | Change |
| --- | --- |
| `studios/cad/host/manifest.ts` | Combined schema 2, artifact hashes, source/artifact/region mapping, migration |
| `studios/cad/host/mutation-lock.ts` | Cross-process TS side of shared lock, journal, and recovery protocol |
| `studios/cad/host/build.ts` | Production timeout ordering and out-of-process build invocation |
| `studios/cad/host/artifacts.ts` | Current-pointer-only publication resolution; remove mtime fallback |
| `studios/cad/engine/cad_build.py` | Explicit inputs, bounded child builds, output hashes, region publication |
| `studios/cad/host/acceptance.ts` | Canonical contract, lock/proposal/approval receipts |
| `studios/cad/host/evidence.ts` | Immutable records, record validation, node freshness, index rebuild |
| `studios/cad/host/print-plan.ts` | Pose validation, body/profile binding, transformed bounds |
| `studios/cad/host/regions.ts` | Declaration validation, attachment, mirroring, artifact registry |
| `studios/cad/host/visual-review.ts` | Render/review history, active records, independent reviewer adapter |
| `studios/cad/host/qc-report.ts` | Exact requirement graph and claim-free completion |
| `studios/cad/host/qc-evidence.ts` | Demote in-memory ledger to diagnostic cache |
| `studios/cad/host/dispatch.ts` | Generation, lease, heartbeat, takeover, state |
| `studios/cad/tools/index.ts` | Protected mutation and artifact-bound evaluator tools |
| `studios/cad/tools/session.ts` | Runtime ceiling and actual in-process RPC timeout ordering |
| `src/core/opencode-config.ts` | Dedicated `cad_mutate` and always-prompt `cad_approve` permissions; deny CAD Bash/edit |
| `src/lifecycle.ts` | Bubblewrap/backend health and schema 2 capability reporting |
| `studios/cad/tools/session-tools.ts` | Diagnostics only unless called by host evaluators |
| `studios/cad/engine/cad_runtime/tools/studio_build.py` | Bounded product-build child controller |
| `studios/cad/engine/cad_runtime/worker.py` | Worker proxy backstops after inner deadlines |
| `studios/cad/engine/cad_runtime/isolation.py` | Bubblewrap diagnostic/hand-build mount, network, env, and resource policy |
| `studios/cad/engine/cad_runtime/security.py` | In-process Python restrictions as defense in depth, not sandbox authority |
| `studios/cad/engine/cad_runtime/ir/` | Staged IR implementation from agent-loop contract |
| `studios/cad/engine/cad_runtime/tools/` | Requirement, region, printability, topology evaluators |
| `src/core/spec-resolve.ts` | Geometry/contract/plan/assessment freshness |
| `scripts/bench.ts` | Contract injection, timeout, offline semantic score |
| `studios/cad/agent/*.md` | Domain-only writes, contract-first standing orders |
| `studios/cad/skill/SKILL.md` | Acceptance, evidence, IR/hand, and bounded completion workflow |

## Required Tests

### Authority and schema

- Schema 1 reads/builds without overwrite.
- Schema 2 requires fixed acceptance and validates eight final bodies.
- Contract is locked before worker dispatch or source mutation.
- Agent cannot forge approval metadata or alter host records directly.
- Active acceptance rejects missing/mismatched receipt, base hash, candidate
  hash, activation hash, authority channel, signature/key, or history chain.
- Routine `cad_mutate` permission cannot approve contracts or waivers;
  `cad_approve` always prompts.
- Harness contract cannot be superseded.
- TS/Python schema parity and canonical hashes are stable.

### Build and provenance

- Explicit input allowlist excludes history, evidence, renders, and reviews.
- Acceptance-only changes do not rebuild geometry.
- Source/region/compiler changes stale geometry.
- Artifact output hashes detect missing or modified files.
- Malicious hand source cannot write acceptance/evidence/design files, access
  network, or read undeclared paths from its isolated snapshot.
- Diagnostic `cad_execute`/export APIs can write only runtime scratch and cannot
  read approval keys or authoritative writable paths.
- Unavailable hand isolation marks unsafe legacy output untrusted and blocks
  completion.
- Identity and mirror mappings/regions are exact.
- Unchanged bodies reuse exact prior bytes; `current` resolver never promotes an
  unpointed generation after a crash.
- Timeout/crash/input drift preserves the prior generation and warm session.
- Each operation has one lock owner; nested build/compile calls cannot deadlock.
- Abort terminates and reaps the product process group before returning, with no
  late artifact publication.

### Requirements and evidence

- Every dimension variant has positive/negative final-STEP tests.
- IR local checks cannot satisfy locked acceptance requirements.
- Hole, wall, station, and region-reference evaluator edge cases follow the
  fixed final-STEP semantics in this plan.
- Revisionless, scratch-subject, stale body, stale profile, and stale region
  evidence are rejected.
- Unchanged node inputs can reuse evidence across an unrelated part rebuild.
- Host restart preserves and reindexes evidence.
- Host sequences produce deterministic pass/fail selection when timestamps tie
  or move backward.
- A newer failing evidence/review record changes QC selection and makes prior
  SPEC assessment stale.

### Manufacturing

- Every final body has one normalized print pose.
- Entry and plan hashes are canonical; accepted plan history remains readable.
- Host recomputes transformed bounds from exact STEP.
- Floating and below-bed poses fail `bedToleranceMm` rules.
- Missing build volume/profile/plan is unverified.
- Oversized or below-minimum-wall bodies block completion.
- Mirror pose derivation requires an explicit host record.

### Interfaces and warnings

- Every declared interface requires exact two-region evidence.
- Missing, detached, ambiguous, stale, or whole-body substitute regions fail.
- Interface-specific fit targets override defaults.
- One interface pass cannot cover another.
- Plane/cylinder extraction produces stable canonical region hashes; region-only
  edits preserve unchanged body bytes and body evidence.
- None/gravity, fastener, adhesive, and friction retention each exercise their
  bounded V1 verification rule; unsupported snap retention remains unverified.
- Warning closure requires current same-finding evidence or approved waiver.
- A geometry fix closes an old finding only through a passing successor node
  covering the same logical subjects/requirements.
- Non-waivable harness findings reject waivers.
- Resolution records and signed waiver receipts survive restart and reject
  stale, circular, or mismatched supporting evidence.

### Reference

- Final render manifest names exact body hashes, cameras, views, and output
  hashes.
- Different contract views/renderer settings create different immutable render
  set directories and never overwrite review-referenced bytes.
- Active print/review records require matching immutable history records.
- Arbitrary session render cannot satisfy reference review.
- Missing view/reference/criterion/reviewer blocks.
- Agent review cannot satisfy a benchmark requiring independent review.

### Workers and permissions

- Generic write/Bash is denied for CAD product agents.
- Worker cannot write another part or host-owned record.
- Expired/superseded generation and stale base writes fail.
- Failed, cancelled, ready, and superseded states cannot publish; authoring/part
  plan changes revoke active leases.
- Parent takeover prevents late publication.
- Spawn persists the starting lease before prompting the child.
- Hand source path remains available only through scoped host tool.
- Part-plan split/add/remove applies atomically with approved contract reference
  changes and invalidates affected artifacts/evidence.

### Benchmark

- Last QC event with `complete: true` cannot forge success.
- Harness expected design/part/qty/authoring plan rejects omitted or extra parts.
- Offline scorer rejects stale evidence/render, wrong contract, missing mirror,
  unresolved warning, incomplete interface, absent pose, or missing review.
- Wall-time and non-zero process exit fail.
- Host/agent claim disagreement is reported.

## Success Metrics

Correctness:

- Zero benchmark passes from stale evidence, narrative warning dismissal,
  missing interface coverage, agent N/A claims, or forged completion output.
- Every complete design has exact body hashes, contract hash, print-plan hash,
  evidence IDs, QC selection hash, and assessment hash.

Reliability:

- Build/compile timeouts do not erase warm-session state or publish partial
  generations.
- Superseded workers cannot publish.
- Host restart preserves completion authority.

Agent efficiency:

- Fewer failed build loops and repeated full QC calls than current baselines.
- Prismatic IR reduces construction retries on `project-box-v0`.
- Evidence DAG reuse reduces unrelated checks only after correctness is proven.

Product quality:

- `wall-sconce-v0` cannot pass without real form/reference evidence.
- `speaker-organic-v0` remains a hand/freeform canary until manufactured-freeform
  IR passes its form, manufacturing, interface, and reference gates.
- Escape reasons and unsupported operations are measurable and drive future IR
  scope.

## Final Acceptance

The master plan is complete when CAD Studio can prove, from disk and without
trusting agent prose, that a final artifact set was built from known source,
satisfies its locked measurable contract and manufacturing profile, covers all
interfaces and warnings, carries current reference evidence when required, and
was produced through bounded, auditable authoring and worker paths.
