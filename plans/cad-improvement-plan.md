# CAD Studio - General Improvement Plan

This plan turns lessons from the organic speaker benchmark into general CAD agent capabilities. It must improve future enclosures, fixtures, products, mechanisms, and reference-driven models without adding benchmark-specific rules.

## Goal

Let the agent choose the geometry while the host deterministically verifies its measurable claims.

A design may complete only when:

- the original acceptance contract is satisfied,
- every final part fits the selected manufacturing profile,
- every declared assembly interface has current evidence,
- warnings are resolved with local evidence or an explicit waiver,
- all evidence and renders belong to the final source revision,
- reference fidelity is reviewed when an image drives the task.

## Relationship to the Agent Loop Plan

`plans/cad-agent-loop.md` improves the inner geometry-authoring loop through a typed IR. This plan improves the outer product contract, manufacturing checks, evidence model, benchmark scoring, and worker lifecycle.

The plans are compatible but independently useful. None of the gates below should depend on whether a part was authored through IR or `cad_execute`.

## Principles

| Principle | Rule |
| --- | --- |
| Agent chooses; host verifies | Do not encode design choices as filename or part-name heuristics. |
| Requirements are immutable | A failed check cannot be fixed by silently changing its target. |
| Evidence is revision-bound | Source changes invalidate affected validation, fit, printability, form, and render evidence. |
| Claims require full coverage | One successful part or interface cannot stand in for an entire design. |
| Manufacturing context is explicit | Printer envelope and process limits apply to every final part. |
| Reference fidelity is separate from form | Numeric station checks do not prove resemblance to an image. |
| Warnings fail closed | Narrative explanations do not override measured defects. |
| Benchmarks score semantics | `complete: true` is an input to inspect, not the benchmark result. |

## Non-goals

- Hard-coding speaker, trim, cone, enclosure, or benchmark identifiers
- Inferring quantity or symmetry from part names
- Treating every photo-driven task as freeform
- Hard-coding a 300 mm printer for all users and tasks
- Adding prompt text that only teaches the current benchmark answer
- Replacing the existing CAD kernel, build outputs, or viewer
- Requiring the planned CAD IR before these improvements can ship

## Priority Plan

| Priority | Area | Change | General contract | Result |
| --- | --- | --- | --- | --- |
| P0 | Acceptance | Immutable acceptance contract | Capture dimensions, manufacturing profile, functional assertions, required interfaces, and reference policy before modeling. Changes create an explicit new contract revision. | Prevents goal mutation after a failed check. |
| P0 | Manufacturing | Required printer profile | Bind build volume, nozzle, layer assumptions, minimum wall, and clearance policy to the design. Check every final part against it. | Prevents unchecked oversized or under-resolved parts. |
| P0 | Assembly | Interface manifest | Declare each mating pair, interface type, target clearance, retention strategy, assembly method, and required evidence. | Makes assembly completeness measurable. |
| P0 | QC | Interface coverage | Require current evidence for every declared interface, not merely the latest successful comparison. | Prevents partial fit evidence from passing a full assembly. |
| P0 | Evidence | Revision-bound evidence graph | Bind evidence to design revision, part source hashes, interface ids, and manufacturing profile hash. | Blocks stale checks and renders. |
| P0 | Warnings | Structured resolution | A warning is unresolved until fixed, locally disproved by a tool, or explicitly waived with evidence. | Prevents text-only dismissal of thin walls and similar defects. |
| P0 | Reference | Visual fidelity axis | When image input drives the brief, require final revision renders and a reference review result. | Separates visual similarity from numeric form checks. |
| P0 | Scoring | Independent semantic scorer | Derive benchmark success from contracts and evidence rather than the agent's completion claim. | Makes benchmark results trustworthy. |
| P1 | Function | Functional topology assertions | Allow task-level assertions such as closed volume, allowed openings, through-path, accessible cavity, or motion envelope. | Detects structurally valid but functionally wrong geometry. |
| P1 | Fit | Interface-region comparisons | Compare declared mating regions or helper solids instead of whole-object global minimum distance. | Produces meaningful fit evidence. |
| P1 | Planning | Pre-dispatch manufacturing plan | Estimate final part envelopes, split strategy, print poses, and interfaces before spawning workers. | Finds impossible part plans early. |
| P1 | Workers | Lifecycle and source ownership | Add heartbeat, state, timeout, cancellation, generation id, and exclusive source leases. | Stops obsolete workers and conflicting writes. |
| P1 | Efficiency | Incremental evidence DAG | Re-run only checks affected by changed parts, interfaces, or profiles. Cache unchanged evidence. | Reduces repeated builds and broad QC batches. |
| P1 | Runtime | Progress and retry budgets | Bound worker time, retries, build loops, and no-progress iterations. Return incomplete when the budget is exhausted. | Prevents unbounded agent loops. |
| P2 | Output | Final view set | Generate front, side, iso, and contract-required section or exploded views after the final build. | Makes visual and assembly defects inspectable. |
| P2 | Policy | Structured claim vocabulary | Restrict claims such as `retention not required`, `false positive`, and `printable` to structured evidence states. | Reduces narrative self-approval. |

## Data Model

Use a host-owned `acceptance.json` sidecar. Do not merge acceptance data into
the geometry-authoring fields of `design.json`.

For design manifest schema 2, add the required fixed reference
`acceptance: "acceptance.json"`. During migration, legacy schema 1 and early
schema 2 designs may omit it and receive a synthesized, explicitly legacy
contract that cannot produce reference, interface, or topology passes without
new declarations.

Contract authority rules:

- The host locks the initial contract before worker dispatch or the first
  geometry write, whichever happens first.
- A harness-owned benchmark contract is pinned by hash and cannot be
  superseded by the agent.
- A user-owned contract can be superseded by explicit user approval or by a
  host policy that the user explicitly delegated in the locked contract.
- An agent may revise an unlocked draft. After lock, it may only propose a
  revision; an approver allowed by the locked revision policy must approve it.
- Scoring always evaluates the pinned contract hash, not merely the newest
  contract revision on disk.

```ts
type Sha256 = string
type EvidenceId = string
type RequirementId = string

type DesignAcceptanceContract = {
  schema: 1
  revision: number
  contractHash: Sha256
  state: "draft" | "locked" | "superseded"
  authority: "harness" | "user" | "agent"
  approvedBy?: ContractApproval
  createdAt: string
  supersedes?: number
  supersedesHash?: Sha256
  changeReason?: string
  changedRequirementIds?: RequirementId[]
  revisionPolicy: RevisionPolicy
  waiverPolicy: WaiverPolicy
  manufacturingProfile: ManufacturingProfile
  dimensions: DimensionRequirement[]
  interfaces: AssemblyInterface[]
  topology: FunctionalAssertion[]
  reference?: ReferencePolicy
}

type ContractApproval = {
  authority: "harness" | "user" | "host_policy"
  actorId: string
  policyId?: string
  approvalId: string
  approvedAt: string
}

type RevisionPolicy = {
  approvers: ("harness" | "user" | "host_policy")[]
  delegatedHostPolicyId?: string
}

type DimensionRequirement =
  | {
      id: RequirementId
      metric: "bbox_axis"
      subject: string
      axis: "X" | "Y" | "Z"
      targetMm: number
      toleranceMm: number
      waivable: boolean
    }
  | {
      id: RequirementId
      metric: "diameter"
      region: InterfaceRegion
      targetMm: number
      toleranceMm: number
      waivable: boolean
    }
  | {
      id: RequirementId
      metric: "wall"
      subject: string
      regionId?: string
      minimumMm: number
      waivable: boolean
    }
  | {
      id: RequirementId
      metric: "clearance"
      interfaceId: RequirementId
      targetMm: number
      toleranceMm: number
      waivable: boolean
    }
  | {
      id: RequirementId
      metric: "station"
      subject: string
      axis: "X" | "Y" | "Z"
      tMode: "world" | "from_min"
      positionMm: number
      section: { widthMm: number; depthMm: number }
      toleranceMm: number
      waivable: boolean
    }

type ManufacturingProfile = {
  process: "fdm"
  buildVolumeMm: [number, number, number]
  nozzleMm: number
  nominalLayerMm: number
  minimumWallMm: number
  defaultClearanceMm: number
}

type InterfaceRegion = {
  artifactId: string
  regionId: string
  source: "named_region" | "helper_solid"
}

type AssemblyInterface = {
  id: RequirementId
  sides: [InterfaceRegion, InterfaceRegion]
  kind: "seat" | "slip" | "press" | "slide" | "hinge" | "fastened" | "adhesive" | "contact"
  fit:
    | { kind: "clearance"; targetMm: number; toleranceMm: number }
    | { kind: "contact"; maximumGapMm: number }
    | { kind: "interference"; targetMm: number; toleranceMm: number }
  alignment?:
    | { kind: "coaxial" | "concentric"; toleranceMm: number }
    | { kind: "coplanar" | "parallel"; angleToleranceDeg: number; offsetToleranceMm: number }
    | { kind: "transform"; target: RigidTransform; positionToleranceMm: number; angleToleranceDeg: number }
  motion?:
    | {
        kind: "linear"
        axis: SpatialAxis
        rangeMm: [number, number]
        stages: number
      }
    | {
        kind: "rotary"
        axis: SpatialAxis
        rangeDeg: [number, number]
        stages: number
      }
  retention: "geometry" | "fastener" | "adhesive" | "friction" | "gravity" | "none"
  retentionJustification?: string
  assemblyMethod: string
  evidence: ("fit" | "align" | "motion" | "retention")[]
}

type RigidTransform = {
  translationMm: [number, number, number]
  quaternionXyzw: [number, number, number, number]
}

type SpatialAxis = {
  originMm: [number, number, number]
  direction: [number, number, number]
}

type FunctionalAssertion =
  | { id: RequirementId; kind: "closed_volume"; parts: string[]; allowedOpenings?: string[]; waivable: boolean }
  | { id: RequirementId; kind: "opening"; part: string; minimumMm: [number, number]; waivable: boolean }
  | { id: RequirementId; kind: "through_path"; parts: string[]; minimumDiameterMm: number; waivable: boolean }
  | { id: RequirementId; kind: "accessible_cavity"; part: string; throughInterface: string; waivable: boolean }
  | { id: RequirementId; kind: "motion_envelope"; interface: string; stages: number; waivable: boolean }

type ReferencePolicy = {
  inputs: ReferenceInput[]
  requiredViews: ("front" | "side" | "iso" | "section" | "exploded")[]
  criteria: ReferenceCriterion[]
  review: "agent" | "human" | "automated"
  blocking: boolean
}

type ReferenceCriterion = {
  id: RequirementId
  kind: "silhouette" | "proportion" | "feature_count" | "feature_placement" | "negative_space" | "surface_transition"
  description: string
  waivable: boolean
}

type ReferenceInput = {
  path: string
  sha256: Sha256
}

type WaiverPolicy = {
  mode: "forbidden" | "approved_only"
  approvers: ("harness" | "user" | "host_policy")[]
  nonWaivableRequirementIds: RequirementId[]
}

type RegionFrame = {
  originMm: [number, number, number]
  xDirection: [number, number, number]
  yDirection: [number, number, number]
  normal: [number, number, number]
}

type ArtifactRegion = {
  id: string
  sourcePart: string
  artifactId: string
  sourceHash: Sha256
  artifactHash: Sha256
  geometry:
    | { kind: "plane"; frame: RegionFrame }
    | { kind: "cylinder"; axis: SpatialAxis; radiusMm: number }
    | { kind: "axis"; axis: SpatialAxis }
    | { kind: "helper_solid"; path: string; sha256: Sha256; frame: RegionFrame }
}
```

The contract is not a classifier such as `prismatic | freeform`. It records what must be true, not how the geometry must be authored.

`contractHash` is the SHA-256 of canonical JSON with `contractHash` omitted.
Locked contracts require `approvedBy`; drafts forbid it. A superseding revision
requires both `supersedes` and `supersedesHash`, and the host verifies that they
identify the currently active locked contract.

Revision policy invariants:

- Harness-owned contracts allow only `harness` approval.
- User-owned contracts allow only `user` plus an optional `host_policy`; they
  always reject `harness`. Host-policy approval is allowed only when the
  user-approved locked contract names `delegatedHostPolicyId`.
- Agent-owned contracts may allow `agent` proposals but lock or supersede only
  through `user` or a named `host_policy`.
- A `host_policy` approval requires `policyId` equal to
  `delegatedHostPolicyId`; other approval authorities forbid `policyId`.

## On-disk Integration

```text
$STUDIO_HOME/studio/designs/<id>/
  design.json
  acceptance.json            # locked acceptance contract and authority
  print-plan.json             # final-artifact print poses; revisioned QC input
  visual-review.json          # durable final reference-review evidence
  regions/
    <source-part>.json        # authored region declarations for IR or hand mode
  region-helpers/
    <source-part>/
      <region>.json           # optional IR helper source
      <region>.py             # optional hand helper source
  region/
    <artifact-id>/
      <region>.step           # generated helper-solid artifact, when declared
  ... geometry sources and artifacts ...
```

Integration with `plans/cad-agent-loop.md` is explicit:

- Extend `DesignManifestV2` with `acceptance: "acceptance.json"`.
- Add `acceptance.json`, each declared `regions/<source-part>.json`, and each
  referenced IR or hand region-helper source to the schema 2 build-input
  allowlist and artifact manifest provenance. Contract or region-source changes
  therefore stale the artifact contract.
- Keep `print-plan.json` out of geometry compilation and artifact build inputs,
  but include it in QC and SPEC freshness. A print-plan change invalidates
  printability evidence and SPEC without forcing a geometry rebuild.
- Artifact schema 2 records `acceptance_revision` and `acceptance_hash` from the
  locked snapshot.
- Artifact schema 2 adds a `regions: ArtifactRegion[]` registry. Region records
  carry final geometry frames or helper-solid hashes and exact source/artifact
  provenance.
- SPEC source freshness includes `acceptance.json`, `print-plan.json`, and the
  host-owned `visual-review.json` when reference review is blocking.
- Plugin permissions allow the host contract tools to write these fixed paths;
  workers cannot edit contract authority, approvals, print plans, or visual
  review records.
- The agent-loop plan's build allowlist, artifact schema, SPEC freshness rules,
  migration fixtures, and permissions must be amended with these fields before
  either plan is implemented.

## Region Authoring and Publication

Both IR and hand-authored parts declare interface regions through the same
`regions/<source-part>.json` contract:

```ts
type RegionDeclarationFile = {
  schema: 1
  sourcePart: string
  regions: RegionDeclaration[]
}

type RegionDeclaration = {
  id: string
  attachmentToleranceMm: number
  source:
    | { kind: "analytic"; geometry: AnalyticRegionGeometry }
    | {
        kind: "ir_helper"
        ir: `region-helpers/${string}/${string}.json`
        frame: RegionFrame
      }
    | {
        kind: "hand_helper"
        source: `region-helpers/${string}/${string}.py`
        frame: RegionFrame
        escapeReason: string
      }
}

type AnalyticRegionGeometry =
  | { kind: "plane"; frame: RegionFrame; boundaryMm: [number, number] }
  | { kind: "cylinder"; axis: SpatialAxis; radiusMm: number; rangeMm: [number, number] }
  | { kind: "axis"; axis: SpatialAxis }
```

Publication rules:

- Region declaration files are editable design inputs for both authoring modes.
- `ir_helper` uses the same deterministic IR compiler contract and must produce
  exactly one helper solid. `hand_helper` uses the existing hand escape policy
  and must also produce exactly one helper solid.
- Helper declarations provide the authoritative `RegionFrame`; the build never
  infers orientation from helper geometry. Publication validates the frame and
  mirrors it together with the helper solid.
- The build validates every analytic region or helper solid against its source
  part using `attachmentToleranceMm`; detached or ambiguous regions fail build
  publication.
- Helper outputs publish to
  `region/<artifact-id>/<region-id>.step` and their hashes appear in
  `ArtifactManifestV2.regions`. They are generated artifacts, not build inputs.
- Identity artifacts preserve the authored frame. Mirrored artifacts receive a
  deterministic YZ-mirrored frame, axis, and helper solid. Their region records
  use the final artifact id, retain the source declaration hash, and record the
  transformed helper artifact hash.
- Region ids are unique within a source part. Published region identity is the
  pair `(artifactId, regionId)`, including mirrored artifact ids.
- An `InterfaceRegion` resolves exactly one published `(artifactId, regionId)`;
  no filename or part-name inference is allowed.

## Evidence Model

Each evidence record should carry enough context to reject stale or partial proof.

```ts
type CadEvidence = {
  id: EvidenceId
  axis: "validate" | "printability" | "fit" | "form" | "topology" | "visual"
  designRevision: string
  contractRevision: number
  contractHash: Sha256
  manufacturingProfileHash: Sha256
  subjects: EvidenceSubject[]
  interfaceId?: string
  requirementIds?: RequirementId[]
  printPlanHash?: Sha256
  tool: string
  status: "pass" | "fail" | "unverified"
  findings: StructuredFinding[]
  recordedAt: string
}

type EvidenceSubject = {
  id: string
  sourceHash: Sha256
  artifactHash: Sha256
  regionId?: string
}

type StructuredFinding = {
  id: string
  severity: "info" | "warning" | "error"
  kind: string
  message: string
  locationMm?: [number, number, number]
  requirementIds: RequirementId[]
  resolution?: WarningResolution
}

type VisualReviewEvidence = CadEvidence & {
  axis: "visual"
  references: { path: string; sha256: Sha256 }[]
  renders: {
    view: "front" | "side" | "iso" | "section" | "exploded"
    path: string
    sha256: Sha256
    designRevision: string
  }[]
  reviewer: {
    mode: "agent" | "human" | "automated"
    actorId: string
    implementation?: string
  }
  criteria: {
    criterionId: RequirementId
    status: "pass" | "fail" | "unverified"
    findingIds: string[]
  }[]
}

type VisualReviewRecord = {
  schema: 1
  designRevision: string
  contractHash: Sha256
  evidence: VisualReviewEvidence
  recordHash: Sha256
}

type PrintabilityEvidence = CadEvidence & {
  axis: "printability"
  printPlanHash: Sha256
  printPose: {
    artifactId: string
    entryHash: Sha256
    transform: RigidTransform
    transformedBoundsMm: {
      min: [number, number, number]
      max: [number, number, number]
      size: [number, number, number]
    }
  }
}
```

Completion rules:

1. Every artifact part has final-revision validation and printability evidence.
2. Every interface has every evidence kind declared by its contract.
3. Every topology assertion has final-revision evidence.
4. Every blocking reference policy has final-revision review evidence.
5. No unresolved error or warning remains.
6. Every final render is stamped with the design revision it depicts.

## Warning Resolution

Warnings must use structured states rather than prose embedded in a pass claim.

```ts
type WarningResolution =
  | { state: "fixed"; evidenceId: EvidenceId }
  | { state: "disproved"; localizedMeasurementId: EvidenceId; reason: string }
  | {
      state: "waived"
      waiverId: string
      findingId: string
      requirementIds: RequirementId[]
      supportingEvidenceIds: EvidenceId[]
      reason: string
      acceptedRisk: string
      approvedBy: ContractApproval
    }
  | { state: "unresolved" }
```

Rules:

- Warning and error findings require a resolution state; info findings may omit it.
- Aggregate volume, section area, or nominal parameter math cannot disprove a localized minimum-wall warning.
- A localized defect requires a localized measurement or geometry change.
- Waivers remain visible in QC and benchmark output; they do not silently become clean passes.
- Waivers must satisfy the contract's authority and waiver policy.
- Benchmarks pin non-waivable requirement ids in the harness-owned contract.

## Assembly Verification

Replace the current "latest fit pass touches any design part" rule with interface coverage.

For each `AssemblyInterface`:

1. Resolve both declared region ids against the final-revision named-region or
   helper-solid registry in artifact schema 2; missing, stale, or ambiguous
   regions are unverified.
2. Run interface-specific fit evidence.
3. Evaluate the typed alignment target when `alignment` is declared.
4. Evaluate every motion stage and range endpoint when `motion` is declared.
5. Require retention evidence unless the contract explicitly chooses `none` or `gravity` with justification.
6. Bind evidence to the interface id, both region ids, both artifact hashes, and final revision.

Interface schema invariants:

- Every interface has exactly one typed fit target.
- `evidence` contains `align` exactly when `alignment` is declared.
- `evidence` contains `motion` exactly when `motion` is declared.
- `retention: "none" | "gravity"` requires `retentionJustification`.
- Named regions and helper solids are emitted by the authoring/build pipeline
  into `ArtifactManifestV2.regions` with stable ids, geometry frames, source
  hashes, and artifact hashes. Free-form face queries are not accepted as final
  QC subjects.

Whole-object global minimum distance may be diagnostic, but it cannot prove a mating clearance unless the compared subjects are isolated mating regions.

## Printability Verification

- `cad_analyze_printability` should inherit the design manufacturing profile; callers should not repeatedly pass optional build-volume strings.
- Missing profile data is `unverified`, not an implicit unlimited printer.
- Every artifact part must have a bed pose and profile-bound check.
- Patterned or mirrored artifact ids inherit no evidence automatically unless the transform preserves the measured print pose and the host records that derivation.
- A part exceeding the envelope blocks completion until split or assigned a different explicit profile.

`print-plan.json` records the exact pose analyzed for every final artifact:

```ts
type PrintPlan = {
  schema: 1
  designRevision: string
  manufacturingProfileHash: Sha256
  entries: PrintPlanEntry[]
  planHash: Sha256
}

type PrintPlanEntry = {
  artifactId: string
  artifactHash: Sha256
  transform: RigidTransform
  transformedBoundsMm: {
    min: [number, number, number]
    max: [number, number, number]
    size: [number, number, number]
  }
  derivedFrom?: {
    artifactId: string
    evidenceId: EvidenceId
    transformPreservesPose: boolean
  }
}
```

The host validates quaternion normalization, finite values, transformed bounds,
and build-volume containment. Printability evidence must contain the matching
`printPlanHash`, artifact hash, `entryHash`, entry transform, and transformed
bounds. `entryHash` is canonical SHA-256 of the entry. `planHash` is canonical
SHA-256 of the plan with `planHash` omitted. A named session object alone does
not prove which pose was checked.

## Reference Fidelity

Reference review is required only when a visual input materially drives the request.

The review should compare final revision renders against the source reference for:

- dominant silhouette and proportions,
- placement and count of major features,
- negative space and openings,
- visible assembly seams,
- characteristic profile or surface transitions.

`cad_analyze_form` remains numeric and deterministic. It proves only the submitted station contract. It must not be presented as image similarity.

Visual completion requires one `VisualReviewEvidence` record that:

- contains every reference hash from the locked policy,
- contains one final-revision render hash for every required view,
- identifies the reviewer mode and actor or implementation,
- contains exactly one result for every locked reference criterion id,
- reports structured findings tied to failed or unverified criteria,
- becomes stale when a reference, required render, contract, or design revision changes.

The host writes the accepted record to `visual-review.json`. `recordHash` is the
SHA-256 of canonical JSON with `recordHash` omitted. Agents and workers cannot
write or replace this file directly. A record is current only when its contract
hash, design revision, reference hashes, render hashes, reviewer provenance, and
criterion result set all match the locked policy.

## Worker Lifecycle

Extend `.cad-dispatch.json` from a session list into an owned work ledger.

```ts
type CadWorkerRecord = {
  partId: string
  source: string
  sessionId: string
  generation: number
  state: "starting" | "running" | "ready" | "failed" | "cancelled" | "superseded"
  heartbeatAt: string
  startedAt: string
  finishedAt?: string
  error?: string
}
```

Host behavior:

- Workers lease one part source for one generation.
- Parent takeover increments the generation and cancels the worker.
- Writes from cancelled or superseded generations are rejected.
- `cad_design_join` reacts to worker events rather than encouraging sleep polling.
- A bounded timeout returns a structured failure that the parent may take over.

## Efficiency

Model QC dependencies explicitly:

```text
part source
  -> build artifact
  -> validate
  -> printability
  -> interfaces touching the part
  -> topology assertions touching the part
  -> renders containing the part
  -> visual review
```

When a source changes, invalidate only downstream nodes. Do not rerun unrelated parts or interfaces. Repeated calls with the same input hashes should return cached evidence.

Add default budgets:

| Budget | Initial policy |
| --- | --- |
| Worker wall time | Configurable per project; timeout produces takeover option |
| Build retries without source progress | 2 |
| Same failed requirement without changed inputs | 1 repeat, then stop |
| Full QC batch | Once after the final build; incremental checks during modeling |
| Benchmark wall time | Scenario-specific hard limit recorded in score |

## Benchmark Scoring

For CAD, replace structural scoring with semantic scoring.

Required checks:

- final build succeeded,
- all declared artifacts exist,
- artifact ids match the final manifest,
- contract requirements pass,
- all interfaces have complete evidence,
- all parts pass the manufacturing profile,
- evidence and renders match the final revision,
- blocking reference review passes,
- no disallowed waiver exists,
- agent-reported `complete` agrees with host-computed completion.

For benchmarks, the scenario supplies `pinnedContractHash`. The scorer rejects
any run whose active contract hash differs, even when the replacement contract
has valid approval metadata. This keeps benchmark requirements immutable while
still allowing authorized revisions in normal interactive work.

The scorer should report both:

- `hostComplete`: computed from contracts and evidence,
- `agentClaimedComplete`: parsed from the agent result.

A disagreement is a benchmark failure and a useful agent-quality signal.

## Agent and Skill Changes

The agent should:

- create the acceptance and assembly plan before worker dispatch,
- propose locked-contract revisions without activating them; activation requires
  an approval allowed by the locked revision policy,
- declare every part interface and retention strategy,
- model or split every part for the selected manufacturing profile,
- resolve warnings through tools rather than narrative,
- rerun only invalidated checks,
- render and review only after the final build,
- return incomplete when evidence remains unresolved.

The skill must not teach geometry-specific answers. It should teach the contract and evidence workflow.

## Implementation Surfaces

| Surface | Expected change |
| --- | --- |
| `studios/cad/host/manifest.ts` | Schema 2 `acceptance.json` reference, profile, interface, topology, and provenance schemas |
| `studios/cad/host/acceptance.ts` | Canonical contract hashing, authority, lock, proposal, and approval lifecycle |
| `studios/cad/host/print-plan.ts` | Rigid-pose validation, transformed bounds, profile binding, and plan hashing |
| `studios/cad/host/visual-review.ts` | Canonical durable review records, criterion coverage, provenance, and freshness |
| `studios/cad/host/regions.ts` | Region declaration validation, helper compilation, attachment checks, mirror publication, and provenance |
| `studios/cad/host/qc-evidence.ts` | Revision, contract, interface, requirement, and profile binding |
| `studios/cad/host/qc-report.ts` | Full part/interface coverage and structured warning resolution |
| `studios/cad/host/dispatch.ts` | Worker ledger, heartbeat, generation, timeout, cancellation, source leases |
| `studios/cad/tools/index.ts` | Contract/interface inputs and structured evidence outputs |
| `studios/cad/engine/cad_runtime/tools/` | Localized measurements, interface-region fit, topology assertions |
| `scripts/bench.ts` | Host-computed semantic CAD score |
| `studios/cad/skill/SKILL.md` | Contract-first workflow and claim discipline |
| `studios/cad/agent/cad.md` | Standing orders for immutable requirements and bounded iteration |
| `plans/cad-agent-loop.md` | Amend schema 2, build allowlist, artifact provenance, SPEC freshness, migration, and permissions for the selected sidecars |

## Tests

### Contract

- A contract revision is immutable after evidence exists.
- Canonical contract hashing is stable across key order and excludes only `contractHash`.
- Draft contracts forbid approval metadata; locked contracts require it.
- Superseding revisions must identify the active revision and hash.
- The host locks the initial contract before worker dispatch or geometry writes.
- Changing a requirement creates a proposal with changed requirement ids and a reason.
- A locked proposal cannot activate without approval allowed by the active contract's revision policy.
- An agent cannot supersede a harness-owned or user-owned contract by itself.
- A benchmark rejects an active contract that differs from its pinned contract hash.
- User-owned host-policy approval is rejected unless the locked contract contains the matching delegation id.
- Host-policy approval rejects a missing or mismatched `policyId`; non-host approvals reject `policyId`.
- Evidence from the previous contract revision cannot complete the new revision.
- A station target cannot be silently removed after a failed form check.
- Every dimension-requirement variant rejects targets or measurement fields from other variants.
- Station requirements require axis, t-mode, position, section dimensions, and tolerance.

### Manufacturing

- Every part inherits the design printer profile.
- Every final artifact has a normalized rigid print transform and transformed bounds.
- Printability evidence rejects a mismatched artifact hash, pose hash, or print-plan hash.
- An oversized part blocks completion even when other printability findings pass.
- Omitting build volume cannot imply an unlimited printer.
- A split design passes only when every resulting part fits.

### Assembly

- A multi-interface design remains incomplete when one interface lacks evidence.
- Interface evidence subjects must resolve to both declared region ids.
- Artifact region records contain a typed frame or spatial axis plus exact source and artifact hashes.
- IR and hand region declarations enter the locked build allowlist through their exact declaration and helper-source paths.
- Detached, ambiguous, zero-solid, or multi-solid region helpers fail publication.
- Helper declarations without a finite orthonormal frame fail validation.
- Mirrored artifact regions receive deterministic mirrored frames, axes, helper solids, and artifact hashes.
- Alignment and motion checks use the typed target declared by the interface.
- Rotary motion rejects an axis without an origin and normalized direction.
- Whole-object global distance cannot satisfy an interface-region requirement.
- Clearance without a declared retention strategy remains incomplete.
- Adhesive, fastener, friction, gravity, and geometric retention produce distinct findings.

### Evidence freshness

- Editing a source invalidates affected validate, printability, fit, topology, and render evidence.
- Unaffected parts retain cached evidence.
- Completion rejects a render from an older revision.
- Completion rejects final parts that were not validated after their last source change.
- Evidence records contain stable ids and exact source and artifact hashes for every subject.
- Blocking visual evidence covers every locked reference hash and required final render hash.
- Blocking visual evidence contains exactly the locked reference criterion ids.
- `visual-review.json` rejects mismatched record hashes, reviewer provenance, criteria, references, or renders.
- Changing `print-plan.json` invalidates printability evidence and SPEC without forcing a geometry rebuild.
- Changing `acceptance.json` stales the artifact contract and all contract-bound evidence.

### Warnings

- A local thin-wall warning cannot be disproved by nominal wall parameters.
- A coordinate-bound measurement may resolve the exact warning.
- An unresolved warning blocks completion.
- A waiver is visible in QC and benchmark output.
- A waiver without an authorized approver, supporting evidence, or allowed requirement id is rejected.
- Harness-owned non-waivable requirements reject all waivers.

### Workers

- Parent takeover cancels the active worker generation.
- A superseded worker cannot write its source.
- Worker timeout is structured and does not require shell sleep polling.
- Join completes from worker state events.

### Benchmark

- Existing artifacts plus `complete: true` do not pass when an interface is missing.
- Stale evidence or stale renders fail the score.
- A reference-driven fixture requires visual review.
- A benchmark remains bound to its harness-supplied `pinnedContractHash`.
- `hostComplete` and `agentClaimedComplete` disagreement fails the run.

### Schema integration

- New schema 2 designs require `acceptance: "acceptance.json"`.
- Legacy designs receive an explicitly limited synthesized contract.
- The schema 2 build allowlist and artifact provenance include `acceptance.json`.
- The schema 2 build allowlist includes every region declaration and referenced IR or hand helper source.
- QC and SPEC freshness include `print-plan.json` without treating it as a geometry build input.
- Artifact schema 2 contains the final region registry and rejects stale region provenance.
- `visual-review.json` has a fixed host-owned path and participates in blocking reference SPEC freshness.
- Workers cannot edit acceptance authority or approval fields.

## Rollout

1. Amend the agent-loop schema 2 contract and implement the fixed
   `acceptance.json`, `print-plan.json`, `visual-review.json`, and region-registry
   integration and migration rules.
2. Implement contract canonical hashing, authority, locking, proposals, and approvals.
3. Add manufacturing profile and per-artifact print-plan binding.
4. Add named interface regions and require full interface coverage in QC.
5. Bind all evidence and renders to final design, artifact, contract, and plan hashes.
6. Add structured warning resolution and final-revision validation.
7. Replace CAD benchmark scoring with pinned-contract semantic completion.
8. Add worker generations, cancellation, leases, and event-driven join.
9. Add functional topology assertions and reference fidelity review.
10. Add evidence DAG caching and runtime budgets after correctness gates are stable.

## Acceptance Criteria

This plan is successful when:

- a reference-driven multi-part product cannot complete without final visual review,
- an oversized final part cannot pass through an omitted build-volume argument,
- every declared interface must be proven independently,
- a failed requirement cannot be replaced silently or without authorized approval,
- benchmark requirements remain pinned even when normal interactive contracts may be revised,
- printability evidence proves the exact final-artifact pose and transformed envelope,
- source edits reliably invalidate all affected evidence and views,
- unresolved localized warnings block completion,
- obsolete workers cannot mutate current design sources,
- benchmark success is computed independently of the agent's claim,
- comparable multi-part runs complete with materially fewer repeated builds and QC calls.
