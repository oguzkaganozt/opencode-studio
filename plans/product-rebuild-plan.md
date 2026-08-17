# Product platform plan

## Goal

Build one shared engineering platform and use it to ship separate, focused
products. A user subscribes to the platform and opens only the products they
need. Concept, CAD, PCB, and Firmware are not forced into one application.

The first release is Product PCB only. The absence of Concept, CAD, Firmware,
or Full Suite must not affect its UI, install, runtime, data model, workflows,
or marketing.

Reuse proven domain knowledge, engines, and benchmarks where useful. Do not
preserve the OpenCode plugin architecture or its technical debt.

## Product model

```text
Platform account
  -> Product PCB (first release)
  -> Product CAD (later, separate market)
  -> Product Concept (later)
  -> Product Firmware (later)
  -> Full Suite (optional, later)
```

Each product has its own positioning, onboarding, navigation, workflows,
viewers, toolchain, entitlement, web entry point, and optional desktop build.
All products share the same platform core and can exchange versioned artifacts
when the user enables an integration.

Product PCB must build and ship from a manifest that includes only PCB. Missing
products are not disabled navigation items, optional runtime dependencies, or
required schemas. They do not exist from the PCB user's perspective.

## Shared stack

| Layer | Choice |
| --- | --- |
| Web | React 19, Vite, TanStack Query |
| Agent UI | assistant-ui, AG-UI, React Flow |
| Agent/runtime | Mastra agents, workflows, memory, evals |
| Models | Mastra model router, multi-provider BYOK |
| Durability | Mastra locally; Inngest when required |
| Observability | OpenTelemetry to Langfuse |
| Execution | Docker/rootless Podman behind an internal adapter |
| App data | PGlite locally; PostgreSQL for team/cloud |
| SQL | Kysely with explicit migrations |
| Runtime data | Mastra LibSQL locally; PostgreSQL for team/cloud |
| Artifacts | Local content-addressed store; S3-compatible remote |
| Backend | Node.js 24 LTS, Hono, resumable SSE |
| Distribution | Web-first local daemon; desktop-shell ready; Docker Compose for teams |
| Repository | pnpm workspaces; Turborepo only when needed |

Optional only after a measured need: Vercel AI SDK, Restate, Temporal,
BoxLite, Kubernetes, Pi, LangGraph.js, or a desktop shell.

## Composition

The platform core has no Concept, CAD, PCB, or Firmware knowledge. Products are
assembled from manifests:

```ts
defineProduct({
  id: "pcb",
  studios: [pcbStudio],
  workflows: [pcbDesignWorkflow],
  viewers: [schematicViewer, boardViewer, bomViewer],
})
```

A later suite is another composition, not a different platform:

```ts
defineProduct({
  id: "suite",
  studios: [conceptStudio, cadStudio, pcbStudio, firmwareStudio],
  workflows: [productDevelopmentWorkflow],
})
```

## Boundaries

- The platform owns accounts, subscriptions, entitlements, projects, sessions,
  runs, events, approvals, artifacts, lineage, and workflow versions.
- A product manifest owns navigation, enabled studios, workflows, viewers,
  branding, toolchains, and product-specific onboarding.
- A studio package owns domain tools, workers, artifact schemas, quality gates,
  viewers, and benchmarks.
- Products communicate through versioned artifact contracts, never direct
  cross-product imports.
- Mastra is hidden behind an application-owned runtime interface.
- AG-UI is an edge protocol, not the database model.
- First-party tools use typed application contracts; MCP is for external tools.
- Large artifacts and logs never live in workflow state or database rows.
- Every mutating operation is idempotent and produces an auditable receipt.

## Studio quality contract

These rules come from CAD studio failures. They apply to every studio,
starting with Product PCB. Reuse domain engines and benchmarks. Do not reuse
the OpenCode plugin plans, tool names, or on-disk CAD schemas.

| Concern | Sole authority |
| --- | --- |
| Requirements | Locked intent written before the first domain write |
| Source | Domain tools only; no generic edit, write, or shell on product files |
| Built truth | Immutable published artifacts and their hashes |
| QC proof | Host-written, revision-bound evidence |
| Completion | Host coverage over every declared check |
| Benchmark | Offline scorer on disk, never the agent's completion claim |

- Agent prose, filenames, tool-call presence, and self-asserted statuses are
  never proof.
- Lock board intent, manufacturing profile, and declared checks at create.
  After lock, the agent may only propose a revision; a human or harness
  approves it.
- Keep the contract separate from authoring sources. Changing intent does not
  rewrite schematic or board bytes.
- Host tools write hashes, timestamps, producer IDs, and approval receipts.
  Agent payloads cannot supply these fields.
- Evidence binds to contract hash, source/build hash, and subject IDs. Stale
  evidence is ignored.
- Every declared check needs current evidence. One DRC pass does not cover
  ERC, netlist, BOM, or assembly.
- Warnings fail closed. Narrative explanations do not dismiss defects.
- Diagnostic tools do not complete QC. Only host verify/report tools do.
- Abort cannot publish. Readers trust only the current published generation.
- Untrusted or unsandboxed builds cannot produce complete QC or release
  artifacts.
- Published specs go stale when contract or source hashes change.
- Benchmarks include negative fixtures: forged complete, stale evidence,
  missing checks, and warning-only reports.
- Do not encode design choices as filename or part-name heuristics.
- Ship the outer truth model before cheaper authoring loops or worker fan-out.
- Register no generic `bash`, `edit`, `write`, `grep`, `find`, or `ls` tools.
- PCB source changes go through `pcb_source_read` / `pcb_source_apply` with a
  `base_hash`. Generic writes must not exist before these tools exist.
- Serialize apply by canonical target path and recheck the hash inside the
  lock. Two concurrent same-hash writes have exactly one winner.
- Every mutator returns canonical `changedPaths`. Viewers refresh from that
  set, not from tool-name guesses.

For Product PCB the first locked checks are ERC/DRC, netlist, BOM, footprint,
and manufacturing readiness. Gerber, drill, BOM, and pick-and-place publish
only from a current host-complete report.

## User access

- One platform account and billing relationship.
- Product entitlements determine which applications the user can open.
- Each product has a direct URL and focused UI; unrelated products are not
  shown in its primary navigation.
- A small account portal lists entitled products and shared projects.
- Cross-product actions appear only when useful, for example `Open in Firmware`
  or `Export MechanicalSpec`.
- Full Suite is offered later to users who need connected multi-discipline
  workflows.

## Desktop-ready from day one

- The React application talks only to the versioned HTTP/SSE/WebSocket API.
- Product logic, tools, storage, secrets, and execution never live in the
  renderer or desktop-shell process.
- A small `PlatformBridge` owns dialogs, notifications, deep links, clipboard,
  updater hooks, window commands, and OS keychain access.
- Browser mode uses `WebPlatformBridge`; a future Electron or Tauri shell adds
  `DesktopPlatformBridge` without changing product features.
- Each focused product can produce its own desktop application from the same
  web build, daemon, and product manifest.
- The Node daemon runs independently. A desktop shell only starts,
  authenticates, monitors, and stops it as a sidecar.
- Filesystem access always goes through backend capabilities; browser storage
  is never authoritative product state.

## Sessions and distribution holes

- One active prompt per session; a second prompt returns `409 busy`.
- Abort cancels work without disposing the session. Dispose unsubscribes,
  flushes, and reaps worker children. Shutdown disposes every live session.
- Session and worker keys stay distinct when two conversations share a cwd.
- Product PCB ships as a single-product GitHub Release archive plus
  `install.sh`. Do not publish a partial multi-product bundle.
- Team/self-host default remains Docker Compose. An optional per-user systemd
  unit may run the same daemon; one user, one port, independent upgrade.

## Phases

### 0. Validate the platform hypothesis

Build a Product PCB vertical slice: locked board intent -> approval -> real PCB
task -> DRC/readiness failure -> correction -> abort that cannot publish ->
restart/resume -> host-complete manufacturing artifact -> claim-free score ->
trace/eval. Confirm Mastra, durability, AG-UI, Docker/Podman, packaging, and
provider switching. Record the decision in an ADR.

### 1. Platform foundation

Create the monorepo, platform contracts, product manifests, entitlements,
`PlatformBridge`, app database, artifact graph, event stream, secrets, runtime
adapters, design system, and CI/release pipeline.

### 2. First focused product

Build Product PCB with its own positioning, onboarding, workflows, tools,
schematic/board/BOM/3D viewers, locked intent, host evidence, apply tools,
negative benchmarks, web entry point, and a PCB-only release archive. Do not
build a generic empty platform or expose placeholder products.

### 3. Second focused product

Build Product CAD as a separately positioned product to prove that platform
APIs are reusable. Move code into the platform only when PCB and CAD genuinely
share it. Product PCB must continue to ship without CAD packages.

### 4. Interoperability

Add versioned artifact contracts, import/export, deep links, entitlement-aware
handoffs, and connected workflows without making products depend on each other.

### 5. Account portal and distribution

Ship the product selector, subscriptions/entitlements, signed local Node daemon
releases, `install.sh`, product-specific web deployments, Docker Compose with
PostgreSQL and Caddy, and an optional per-user systemd unit.

### 6. Optional Full Suite

Compose existing products into a separate suite only after users demonstrate a
real multi-discipline workflow. The focused products remain independently
usable and purchasable.

### 7. Release gate

Require domain benchmarks, negative fixtures, claim-free QC, agent trajectory
evals, restart/recovery tests, abort-without-publish, isolation tests,
entitlement tests, artifact contract compatibility, provider tests,
upgrade/rollback, and clean installation before release.

## Success

- Users understand and access only the focused products they need.
- Product PCB ships independently before any other product exists.
- One shared platform keeps infrastructure and maintenance centralized.
- Adding a product does not change existing products or platform contracts.
- Products exchange versioned artifacts without direct coupling.
- The same product web build runs in a browser and a future desktop shell.
- Providers, runtimes, durability engines, and execution backends remain
  replaceable behind product-owned contracts.
- A design is complete only when host evidence covers every locked check.
- Agents cannot mutate product files except through hashed apply tools.
- A second prompt cannot start on a busy session; abort does not leak workers.
