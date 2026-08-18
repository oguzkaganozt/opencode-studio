# Product platform research

Status: research recommendation, not an implementation plan or final ADR.
Research date: 2026-08-17.

## Goal

Turn the Concept, CAD, PCB, and Firmware studio idea into one shared platform
that ships separate, focused products without preserving the current OpenCode
plugin architecture. The existing repository is evidence about the problem and
contains useful domain engines, benchmarks, and product lessons. It is not an
architectural constraint.

The target is a product family that is fast to build and extend, smooth for
users, provider-neutral, observable, testable, safe around native tools, and
cheap to maintain. Users subscribe to the platform and access only the focused
products they need.

The first release is Product PCB. It must ship with no Concept, CAD, Firmware,
or Full Suite dependency, placeholder, navigation item, worker image, or
required schema. Product CAD is the intended second proof of platform reuse and
is marketed independently.

## Product requirements

The platform must support:

- interactive agents and explicit, visual engineering workflows;
- deterministic domain gates alongside nondeterministic model decisions;
- human approvals, structured input, cancellation, retry, suspend, and resume;
- operator-swappable models behind one product model, without user keys or a picker;
- isolated CAD, PCB, and firmware execution with streamed logs and artifacts;
- persistent sessions, runs, events, interrupts, and artifact lineage;
- first-class deterministic benchmarks, trajectory evals, traces, token/cost
  metrics, and human annotation;
- a dense React engineering UI rather than a generic chatbot;
- local-first installation plus a credible team/self-hosted deployment path;
- separate product entry points, onboarding, entitlements, toolchains, and
  interfaces on top of one platform core;
- versioned artifact interoperability without direct cross-product imports;
- optional composition into a Full Suite without weakening focused products;
- replaceable framework boundaries so a runtime upgrade does not rewrite the
  product database, UI protocol, or domain tools.

## Research conclusion

The strongest platform-first candidate is:

```text
Focused products
  Product PCB first
  Product CAD / Concept / Firmware later
  optional Full Suite
        |
React 19 + Vite shared product shell
  product manifest + entitlement
  assistant-ui + AG-UI + React Flow
        |
platform account/session/run/event/artifact model
        |
Mastra agents + workflows + evals
        |
Mastra built-in runner locally
Inngest runner when managed durability/concurrency is required
        |
Docker/Podman execution adapter
        |
CAD / PCB / firmware OCI workers
```

Supporting systems:

- Langfuse through OpenTelemetry for production traces, experiments, scores,
  and annotations;
- repository-native deterministic benchmarks as the release gate;
- PGlite locally and PostgreSQL for shared deployments, with Kysely and explicit
  SQL migrations;
- content-addressed local artifact storage and an S3-compatible remote adapter;
- a bundled Node 24 LTS daemon serving the Vite application in local mode;
- Docker Compose plus PostgreSQL and Caddy for the initial team deployment.

This is a recommendation to validate, not permission to import every package at
once. The application owns its durable contracts. Frameworks implement them.

## Product composition model

The platform is internal infrastructure, not an empty user-facing product. Each
customer-facing product is a build/deployment composition with a focused job:

```text
Platform Core
  -> Product PCB (first release)
  -> Product CAD (second platform proof)
  -> Product Concept (later)
  -> Product Firmware (later)
  -> Full Suite (later)
```

The core owns accounts, subscriptions, entitlements, projects, sessions, runs,
events, approvals, artifact storage/lineage, runtime adapters, design-system
primitives, and platform APIs. It contains no domain-specific CAD, PCB,
Firmware, or Concept behavior.

A product manifest selects branding, navigation, studios, workflows, viewers,
worker images, onboarding, and entitlement rules. A studio package owns its
domain tools, artifact schemas, quality gates, execution workers, viewers, and
benchmarks.

A product is composed with an explicit allowlist. Product PCB contains one PCB
studio package and has no knowledge that other products may exist. Platform
APIs cannot require a cross-product registry to boot, migrate, authenticate, or
render. The account portal may advertise or list entitlements, but the focused
product UI does not expose unrelated products in primary navigation.

Products interoperate through versioned artifacts and deep links. A PCB product
can publish an `ElectronicsSpec` for Firmware or consume a `MechanicalSpec`
without importing either product. Cross-product workflows live in integration
packages or the optional suite.

This model preserves focused positioning and onboarding while centralizing
maintenance. It also allows separate web URLs and desktop builds from the same
monorepo and platform runtime.

## Domain quality contract

The existing CAD studio plans are discarded as implementation contracts. They
assume the OpenCode plugin host, generic file writes, and in-memory QC. Their
useful product lesson is kept as a studio SDK rule:

- lock intent before the first domain write;
- mutate product files only through typed domain tools;
- persist host-written evidence bound to contract and source hashes;
- compute completion from coverage, never from agent status fields;
- score benchmarks from disk, including negative fixtures;
- fail closed on warnings, stale evidence, abort, and unsandboxed builds.
- mutate PCB/firmware sources only through hashed apply tools, with in-lock
  hash recheck and exactly one winner for concurrent same-hash writes;
- return canonical `changedPaths` so viewers refresh without guessing;
- keep abort separate from dispose and reap worker children on shutdown;
- ship a single-product install archive; never a partial multi-product bundle.

Product PCB instantiates this with ERC/DRC, netlist, BOM, footprint, and
manufacturing readiness. Product CAD later reuses the same contract shape, not
the old CAD plan files.

## Primary runtime candidates

### 1. Mastra: recommended product runtime

Current verified package: `@mastra/core` 1.59.0, Apache-2.0 package license,
Node `>=22.13.0`.

Mastra provides the broadest coherent TypeScript product surface:

- provider-neutral model routing;
- typed agents and tools;
- explicit workflows with branching, parallelism, loops, suspend, and resume;
- memory and persistent threads;
- tool approvals and permission policies;
- MCP support;
- workflow and agent tracing;
- built-in scorers, deterministic quick checks, datasets, experiments, tool
  mocks, and CI gates;
- local Studio tooling;
- official Inngest workflow runner.

`AgentController` is particularly relevant to an interactive engineering
studio: it coordinates modes, models, storage, workspaces, approvals,
subagents, channels, and isolated sessions.

Important limitation: `AgentController` is beta and may break without a major
version bump. It must sit behind an application-owned `AgentRuntime` contract.
Mastra classes and event types must not become the browser protocol or database
schema.

Mastra persistence is not automatically equivalent to distributed durable
execution. Thread messages persist, but arbitrary live session state, pending
approvals, and active runs do not all survive process recreation merely because
storage is configured. Side-effecting tools still need idempotency keys and
explicit receipts.

Production evidence is credible but vendor-published. Salesforce Agentforce
Vibes uses a Mastra harness for non-Claude models, including local SQLite,
approval pauses, external tools, and provider adapters. Other named adopters
include Sanity, Replit, Factorial, Counsel Health, WorkOS, and StarSling.

### 2. LangGraph.js + Deep Agents JS: control-first alternative

Current verified package: `@langchain/langgraph` 1.4.10, MIT. The JS repository
is actively maintained but smaller than the Python ecosystem.

Use LangGraph instead when explicit checkpoint boundaries, replay, complex
branching, multi-day graphs, and controlled deterministic/agentic mixtures are
more important than initial product velocity. It has a stronger checkpoint and
recovery model than Mastra and extensive production evidence.

Costs:

- more infrastructure and graph plumbing;
- steeper development model;
- the polished deployment, trace, and eval experience leans toward LangSmith;
- Deep Agents improves the harness starting point but does not remove the
  operational surface.

It is the correct benchmark alternative, not a dependency to combine with
Mastra.

### 3. Pi: minimal harness benchmark

Current verified package: `@earendil-works/pi-agent-core` 0.84.2, MIT, Node
`>=22.19.0`.

Pi has an excellent small loop, broad provider support, tree-structured local
sessions, steering, typed events, SDK/RPC modes, and deep extension points.
It is proven as the substrate below Flue and OpenClaw.

Pi deliberately does not provide the full product platform needed here:

- no workflow engine;
- no built-in permission or approval system;
- no built-in MCP client;
- no integrated eval product;
- no visual workflow surface;
- no durable distributed execution.

Those omissions make Pi a strong coding harness and a useful quality/latency
benchmark. They make it a higher-maintenance primary platform for this product.
Use it only if a measured Mastra limitation requires a specialized low-level
agent loop.

### Model-layer note: Vercel AI SDK 7

Current verified packages: `ai` 7.0.66 and `@ai-sdk/workflow` 1.0.67,
Apache-2.0, Node `>=22`.

AI SDK 7 is a strong provider, streaming, structured-output, tool, and React
toolkit. It is also a credible custom-runtime foundation. It should not run a
second agent loop inside Mastra. That duplicates provider abstraction, tool
schemas, approval state, streams, telemetry, and workflow execution.

If Mastra is selected, use its model router. Add a direct AI SDK dependency
only for a concrete isolated capability that Mastra does not expose well.
Do not install `@ai-sdk/react` if assistant-ui + AG-UI is the selected UI path.

## Durable workflow candidates

Agent state and durable execution are different. The durable layer coordinates
long-running compilation, simulation, approvals, retries, worker leases, and
artifact publication. It must not store artifact bytes or full logs in workflow
history.

### Inngest: fastest Mastra production path

Current verified SDK: `inngest` 4.18.1, Apache-2.0 SDK, Node `>=20`.

Advantages:

- official Mastra runner and examples;
- excellent TypeScript ergonomics;
- step memoization and retries;
- durable sleep and event waits;
- concurrency, throttling, rate limits, debounce, priority, batching, and fan
  out;
- very good local development server and managed product;
- direct production evidence in coding and agent products.

Limits matter: 1,000 steps per function, 4 MiB per step result, 32 MiB total run
state, and a two-hour maximum individual step. These are acceptable if large
artifacts and logs remain outside workflow state.

The server uses SSPL with delayed Apache publication. Production self-hosting
adds PostgreSQL and Redis. Inngest is the fastest path when managed operation
and the official Mastra integration are worth more than strict local-first
infrastructure minimalism.

### Restate: strongest low-ops local durability candidate

Current verified SDK: `@restatedev/restate-sdk` 1.16.6, MIT. Official TypeScript
support includes Node 22+, Bun, and Deno. The server is a single Rust binary
and can run as one persistent node or an HA cluster.

Advantages:

- journal-based durable execution;
- keyed workflows that run once;
- durable timers and external events;
- idempotency and call deduplication;
- single-writer Virtual Objects for workspace/session state;
- local invocation journal and state UI;
- no separate database for a single-node local deployment.

Costs:

- no first-party Mastra runner;
- custom integration around `ctx.run` and workflow handlers;
- flow-control features are newer than Inngest's mature concurrency controls;
- the server is BSL 1.1 with an additional-use grant, not OSI open source;
- an HA cluster becomes a real stateful platform.

Restate is the best durability spike when offline/local durable execution is a
hard product requirement. It is not automatically the fastest product path.

### Temporal: escalation path

Temporal remains the maturity and correctness leader: deterministic replay,
activities, heartbeats, Signals, Updates, child workflows, Continue-As-New,
worker versioning, replay testing, and proven multi-team operations.

It also has the highest conceptual and operational cost. Bun workers remain
experimental; Node should be used. Mastra's Temporal runner is experimental and
not production-ready.

Temporal earns its complexity only when failures or duplicate work carry
material customer/safety cost, workflows cross many deployments, multiple
teams/languages share the platform, or HA and workflow versioning are core
requirements. Duration alone is not a reason to adopt it.

### Durable recommendation

1. Use Mastra's built-in runner during product discovery and local vertical
   slices.
2. Validate Inngest as the default managed/team runner because it is the
   shortest supported Mastra path.
3. Validate Restate only if local/offline durability is a first-release product
   promise.
4. Keep Temporal as a documented escalation path, not a v1 dependency.

## Evaluation and observability

### Langfuse: recommended system of record

Langfuse has the best balance for this product:

- JS/TS SDK v5 is based on OpenTelemetry;
- model, agent, tool, workflow, session, token, cost, and latency visibility;
- datasets, experiments, custom and model-based scores;
- human corrections and annotation queues;
- hosted low-ops path plus MIT self-hosted core;
- broad production adoption and framework neutrality.

Self-hosting is not a lightweight local feature. A production Langfuse v4
deployment includes PostgreSQL, ClickHouse, Redis/Valkey, and object storage.
Use Langfuse Cloud initially or make it optional; do not bundle it into local
first-run installation.

### Mastra eval ownership

Mastra's native evals are sufficient for framework-aware local tests and CI:

- required/forbidden tools;
- tool ordering, counts, and errors;
- trajectory checks;
- structured outputs;
- deterministic tool mocks;
- datasets and experiment runs;
- CI thresholds and verdicts.

Keep engineering invariants and deterministic fixtures in Git and run them in
Vitest. Export runtime traces and subjective/production eval results to
Langfuse via OpenTelemetry.

Do not make both Mastra and Langfuse authoritative for identical datasets,
traces, or experiment history.

## Tool execution and isolation

### V1: Docker/Podman behind an internal adapter

Docker Engine or rootless Podman is the most proven execution substrate for
build123d/OpenCASCADE, tscircuit/Node, ESP-IDF, QEMU, and large native caches.

Own a narrow backend-neutral contract:

```text
create(image, cpu, memory, disk, mounts, networkPolicy)
exec(argv, cwd, env) -> stdout/stderr stream + exit status
signal(processGroup, SIGINT/SIGTERM/SIGKILL)
collectArtifacts(manifest)
stop()
destroy()
```

Use versioned OCI images, narrow mounts, read-only roots where possible,
deny-by-default egress, process-group cancellation, external log storage, and
content-addressed artifacts. Never expose the Docker socket to the browser or
an untrusted worker.

Docker/Podman provides containment, not a hostile multi-tenant kernel boundary.

### BoxLite: local microVM candidate

BoxLite is the most relevant local microVM candidate: Apache-2.0, TypeScript
SDK, embedded runtime, OCI images, host mounts, persistent disks, streaming,
limits, macOS Apple Silicon, and Linux x64/arm64.

It is young and has no demonstrated GPU/device-rich story. Keep it behind the
same executor interface and require a full CAD/ESP-IDF/QEMU compatibility spike
before making it a product dependency.

### Scale path

Move the same OCI images and execution contract to Kubernetes Jobs or
Kubernetes SIG Agent Sandbox when team concurrency, GPU pools, quotas, or
tenant isolation justify a cluster. Modal is a reasonable separate GPU burst
backend. Do not build on raw Firecracker.

MCP is a tool protocol, not a sandbox. First-party domain tools should use
application-owned typed contracts. Use MCP at extension/external-tool
boundaries, with the MCP server running inside an appropriate sandbox.

## Product UI and protocol

### Recommended stack

- React 19 + Vite;
- `@assistant-ui/react` for the initial headless chat/tool presentation;
- `@assistant-ui/react-ag-ui` and `@ag-ui/client` at the runtime boundary;
- `@xyflow/react` for workflow topology and live run overlays;
- TanStack Query for product data;
- HTTP commands plus resumable SSE for normal agent/workflow events;
- WebSocket only for PTY, debugger, collaboration, or high-frequency duplex
  telemetry.

assistant-ui reduces initial chat/tool/HITL UI work. It must remain a
replaceable presentation adapter. Mastra itself replaced assistant-ui with
first-party primitives after its own UI became specialized, which is a useful
warning.

AG-UI is the strongest neutral protocol candidate for run lifecycle, tools,
state snapshots/deltas, parent runs, interrupts, and resume. Its packages are
still `0.0.x`; keep a versioned application event model and translate at the
edge. Do not persist raw AG-UI events as the product database model.

The canonical application entities are separate:

- platform account, subscription, and product entitlement;
- product definition and studio package version;
- project and product context;
- session;
- run;
- immutable ordered event;
- message projection;
- interrupt/approval;
- artifact and artifact lineage;
- workflow definition and version;
- viewer state.

Chat is one projection of execution, not the execution log.

## Data and artifact architecture

### Application database

Recommended:

- PGlite for single-user local mode;
- PostgreSQL for team/self-hosted/cloud modes;
- Kysely with explicit SQL migrations;
- UUID/UUIDv7 IDs, `timestamptz`, explicit constraints, and versioned event
  payloads.

PGlite preserves the PostgreSQL dialect locally but is a single-process,
single-connection WASM database. It is not the team server.

The app database owns platform truth: accounts, subscriptions, entitlements,
product definitions, projects, sessions, runs, events, approvals, artifact
metadata, lineage, and canonical benchmark datasets.
Mastra storage owns memory and resumability snapshots. Langfuse owns trace and
evaluation projections. Never query private Mastra or Langfuse tables as
product contracts.

Use separate `app` and `mastra` schemas in shared PostgreSQL. Locally, Mastra's
LibSQL store may remain a separate runtime database. Back up and migrate these
boundaries explicitly.

### Artifacts

Store immutable bytes by SHA-256:

```text
sha256/<first-two-hex>/<remaining-hash>
```

Use a local filesystem content-addressed store and an AWS S3 API-compatible
remote adapter. Keep logical names, revisions, roles, producer runs, and
lineage in PostgreSQL. Large logs become compressed artifact chunks plus a
manifest. Never put STEP/STL/GLB, Gerbers, firmware images, or full build logs
in workflow history or database rows.

Do not make MinIO a bundled default; the community repository was archived in
2026. Support generic S3 endpoints instead.

### Secrets

Local BYOK should use OS keychain-backed envelope encryption with an explicit
passphrase vault fallback for headless Linux. Hosted/team mode uses a
`SecretProvider` abstraction for cloud secret managers, Vault, or Infisical.
Only secret references belong in the application database. Secrets must never
enter events, workflow snapshots, traces, logs, URLs, or command lines.

## Distribution and deployment

### Local v1

Use a bundled official Node 24 LTS daemon that serves the built React/Vite UI
to the default browser.

Each focused product receives its own direct entry point and product manifest.
The same daemon can serve multiple entitled products in a shared platform
deployment, while a local install may package only one focused product and its
required toolchains. Product PCB's first store is a GitHub Release archive plus
`install.sh`. Do not ship a tarball that advertises missing products.

Why Node rather than Bun as the product runtime:

- Mastra's declared requirement is Node `>=22.13.0`;
- Node has the least surprising native module, telemetry, process, worker, and
  packaging behavior;
- Bun compatibility for an entire agent/sandbox/native dependency graph is a
  qualification project, not a product advantage.

Run API/control and execution workers as separate processes. A CAD crash must
not terminate the UI or scheduler. Supervise the daemon with per-user launchd
on macOS and systemd on Linux. Bundle a private Node runtime rather than
requiring system Node.

Do not start with Electron or Tauri. A browser UI minimizes platform-specific
maintenance and supports local and remote deployments with one frontend. Keep
the UI behind `PlatformBridge` so each focused product can later produce its own
thin Electron/Tauri build without changing product features.

### Team/self-hosted

Use a multi-architecture Docker Compose bundle:

- Caddy;
- API/UI;
- execution workers;
- PostgreSQL;
- optional Inngest/Restate and Langfuse integrations.

Pin image digests, provide migration jobs, health checks, backups, and explicit
rollback procedures. Kubernetes is a scale target, not the initial team
deployment.

### Repository tooling

Use pnpm workspaces. Add Turborepo only when the build graph and CI caching
justify it. Node is the production runtime; making Bun the package manager adds
another compatibility dimension for little product value.

Suggested layout:

```text
apps/
  account
  product-web
  server
  worker
products/
  concept
  cad
  pcb
  firmware
  suite
studios/
  concept
  cad
  pcb
  firmware
packages/
  platform-contracts
  product-sdk
  studio-sdk
  agent-runtime
  workflow-runtime
  execution
  persistence
  artifacts
  ui
```

## Candidate reference architectures

### A. Product-first: recommended

```text
Focused products + product manifests
  shared platform account/entitlement/artifact graph
Mastra
  built-in local workflows
  Inngest runner for managed/team durability
  native evals -> Langfuse via OTel
AG-UI -> assistant-ui + React Flow
PGlite/Postgres + filesystem/S3 CAS
Docker/Podman execution
Node daemon + Compose team bundle
```

Best for development speed, integrated eval/workflow capabilities, and the
lowest amount of custom agent infrastructure.

Primary risks: Mastra API churn, beta AgentController, Inngest licensing and
self-host footprint, and AG-UI's evolving protocol.

### B. Durability/control-first

```text
LangGraph.js + Deep Agents
Restate or Temporal
Langfuse
same UI/data/sandbox/distribution boundaries
```

Best for explicit graph control and stronger recovery semantics.

Cost: more infrastructure, more framework code, and slower product delivery.

### C. Lean custom platform

```text
Vercel AI SDK 7
@ai-sdk/workflow or Restate
application-owned agent runtime
same UI/data/sandbox/distribution boundaries
```

Best for maximum control and minimal high-level framework commitment.

Cost: the product team must build sessions, memory, approvals, eval integration,
workflow visualization mapping, and operational policy. This repeats work that
Mastra already supplies.

Pi can replace the custom loop in this architecture, but its missing workflow,
approval, MCP, eval, and visual product layers remain product work.

## Avoid initially

- two simultaneous agent runtimes (for example Mastra plus AI SDK ToolLoopAgent);
- two chat protocols (`useChat` plus assistant-ui/AG-UI);
- one mandatory mega-application that exposes every studio to every user;
- separate product codebases that duplicate the platform core;
- direct imports between product or studio packages;
- Temporal before its operational guarantees are required;
- production self-hosted Langfuse in the local installer;
- Kubernetes for single-user/local mode;
- raw Firecracker;
- cloud-only sandboxes as the sole execution backend;
- Electron/Tauri before native-shell value is proven;
- storing product state in framework-private tables;
- storing large artifacts, logs, or transcripts in workflow histories;
- making internal first-party tools MCP calls merely for architectural purity.

## Validation before ADR

Build the Product PCB vertical slice against the three runtime candidates:

```text
PCB board intent
-> structured approval
-> real PCB tool execution
-> DRC/readiness failure
-> correction/retry
-> process kill and restart
-> resume
-> immutable manufacturing artifact publication
-> workflow graph and timeline
-> deterministic and trajectory eval result
```

Hard gates:

- operator model swap without a user-facing key or picker;
- tool allowlists and approval persistence;
- process-tree cancellation;
- restart recovery with no duplicate mutation;
- artifact-by-reference workflow state;
- streamed UI replay after disconnect;
- trace/eval export;
- local packaging on macOS arm64 and Linux x64/arm64.

Compare:

- time to working slice;
- application glue code;
- framework-specific code leaking into product layers;
- recovery semantics;
- UI integration effort;
- latency/token overhead;
- version and licensing risk;
- operational footprint;
- predicted six- and eighteen-month maintenance cost.

Then add a minimal Product CAD package to prove that product manifests,
entitlements, studio contracts, and artifact interoperability are genuinely
reusable rather than abstractions copied from Product PCB. PCB must still build,
install, migrate, and run with the CAD package absent.

The leading hypothesis is Architecture A. The spike exists to invalidate it,
not to implement three products or the Full Suite.

## Primary sources

- Mastra AgentController: <https://mastra.ai/docs/agent-controller/overview>
- Mastra workflow runners: <https://mastra.ai/docs/deployment/workflow-runners>
- Mastra evals in CI: <https://mastra.ai/docs/evals/running-in-ci>
- AI SDK agents/workflows: <https://ai-sdk.dev/v7/docs/agents/workflow-agent>
- LangGraph.js: <https://docs.langchain.com/oss/javascript/langgraph/overview>
- Pi: <https://pi.dev/> and <https://github.com/earendil-works/pi>
- Inngest limits: <https://www.inngest.com/docs/usage-limits/inngest>
- Restate TypeScript: <https://docs.restate.dev/develop/ts/services>
- Restate durability: <https://docs.restate.dev/foundations/key-concepts>
- Temporal TypeScript: <https://github.com/temporalio/sdk-typescript>
- Langfuse SDK/OTel: <https://langfuse.com/docs/observability/sdk/overview>
- Langfuse self-host: <https://langfuse.com/pricing-self-host>
- assistant-ui AG-UI: <https://www.assistant-ui.com/docs/runtimes/ag-ui/overview>
- AG-UI interrupts: <https://docs.ag-ui.com/concepts/interrupts>
- React Flow: <https://reactflow.dev/>
- Docker Engine security: <https://docs.docker.com/engine/security/>
- Podman: <https://github.com/containers/podman>
- BoxLite Node SDK: <https://docs.boxlite.ai/reference/nodejs>
- PGlite: <https://pglite.dev/docs/about>
- Kysely: <https://kysely.dev/docs/getting-started>
- Mastra storage: <https://mastra.ai/docs/storage/overview>
- Node releases: <https://nodejs.org/en/about/previous-releases>
- pnpm workspaces: <https://pnpm.io/workspaces>
