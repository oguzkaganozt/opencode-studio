# ADR 0001 — Phase 0 stack lock

Status: accepted
Date: 2026-08-18
Spike: `spike/pcb-vertical` (8 tests green)

## Decision

Product PCB ships on this stack. Changes require a new ADR.

| Layer | Locked choice |
| --- | --- |
| Web | React 19, Vite, TanStack Query |
| Agent UI | assistant-ui over AG-UI; React Flow for workflows |
| Agent/runtime | Mastra agents, workflows, tools, model router |
| Models | One product model for users. Operators switch via Mastra `provider/model`. Keys stay on the platform. |
| Durability | Mastra + LibSQL locally; Inngest only if a measured need appears |
| Observability | OpenTelemetry to Langfuse |
| Execution | Docker / rootless Podman; tscircuit CLI via Bun in the PCB worker |
| App data | PGlite locally; PostgreSQL for team/cloud |
| SQL | Kysely + explicit migrations |
| Runtime data | Mastra LibSQL locally; PostgreSQL for team/cloud |
| Artifacts | Local CAS; S3-compatible remote |
| Backend | Node.js 24 LTS, Hono, resumable SSE |
| Distribution | Signed Node daemon, PCB-only GitHub Release + `install.sh`, Compose, optional systemd |
| Repo | pnpm workspaces |

## Evidence

- Locked intent, hashed apply, abort-without-publish, claim-free QC: host tests.
- Mastra workflow suspend/resume and LibSQL restart: slice tests.
- Real tscircuit compile + `@tscircuit/checks` overlap DRC: host/worker tests.
- Mastra `Agent` + `createTool` and model router ids (`openai/*`, `xai/*`):
  missing `OPENAI_API_KEY` fails closed in the router.
- AG-UI: `@ag-ui/core` + `@ag-ui/encoder` SSE over HTTP.
- Live BYOK: same Mastra agent generated through
  `openrouter/google/gemini-2.5-flash-lite` and
  `openrouter/meta-llama/llama-3.2-3b-instruct`.
- PCB-only `scripts/pack.sh` + `install.sh`: archive has no CAD/Concept/FW.

## Not evidenced, still locked

These remain implementation, not stack reopeners:

- assistant-ui wiring on top of the AG-UI encoder.
- Hono daemon, PGlite, Langfuse, and signed product `install.sh`.
- Direct OpenAI/xAI keys in addition to OpenRouter.

## Model access

The user never pastes a key or picks a model. Subscription includes inference.
Operators change the single product model in config. Mastra router stays so
that swap is one string, not a rewrite.

## Rejected

- Pi as the product runtime (no workflow/eval/approval product surface).
- LangGraph or AI SDK as a second loop.
- Mega-app / four studios in one PCB install.
- OpenCode plugin host.
- Generic `edit` / `write` / `bash` tools.
- User-facing BYOK or a model picker.

## Consequences

Phase 1 may start. New frameworks need a new ADR. PCB domain engines may be
reused; OpenCode plugin code may not.
