# Intent: OpenCode Studio — native agent, supervised runtime, lean product

## Purpose

OpenCode Studio is a companion workspace on OpenCode: **CAD / PCB studios**, Files, skills, tools, and MCP. The product value is domain viewers + agentic domain work — not a generic IDE.

Two structural gaps block a clean experience today:

1. **Agent UI** embeds the full OpenCode web app in an **iframe** (fragile focus/auth/resize, directory URL hacks, handoff via `?prompt=`).
2. **Lifecycle** expects a separate **`opencode serve`** (attach-only). Unclear as a product; opencode-manager’s model is clearer: one app owns UI + agent process.

This plan keeps Studio (viewers, plugins, skills) and makes the shell **native, self-starting, and lean**.

## Goal

```
Browser → http://host:4173/studio   (single port)
              │
              Studio host (UI + OC API proxy + supervise + status)
              │
              ├─ native Agent panel + session files strip
              ├─ CAD | PCB | Files (refresh + pick-to-agent)
              └─ child or attach: opencode serve (loopback API only)
```

**Target DX**

```bash
opencode-studio          # UI + supervised OpenCode API
# → http://127.0.0.1:4173/studio   (only URL users need)
```

- No manual `opencode serve` in the default path (spawn if needed; attach if already up).
- No OpenCode web UI required; **no second public port** in the default path.
- CAD/PCB/Files ↔ agent feels like one app (handoff, pick-to-agent, live viewer, files touched this session).

Optional: `OPENCODE_URL` / healthy parent → **attach** only (dev / external OC).

## Non-goals

- Multi-user collab, Monaco/full text IDE, Git IDE inside Studio
- Forking OpenChamber / CodeNomad / opencode-manager as the product
- CopilotKit / replacing OpenCode with a custom agent loop
- Rewriting CAD/PCB forge or skill packaging semantics

## Keep

| Keep | Why |
| --- | --- |
| `studios/*`, plugins, skills, MCP | Product core |
| Host API, Files, media (as today) | Working platform |
| `requestAgentHandoff` / `setAgentContextDirectory` **API** | CAD/PCB already depend on them |
| `createOpenCodeBridge` (HTTP proxy) | Talk to OpenCode API |
| Lean security (loopback / Basic / CSRF only) | AGENTS.md |
| OpenCode as agent **runtime** | Sessions, tools, skills, MCP |

## Workstreams

### 1 — Native Agent panel (kill the iframe)

| Remove | Replace |
| --- | --- |
| `native-agent-frame` / `native-opencode-pane` iframes | `ui/agent/*` React panel |
| DOM “broken frame” heuristics | API / SSE health |
| Directory via iframe URL paths | SDK + bridge `x-opencode-directory` |
| Handoff via `?prompt=` navigation | Prefill composer (same handoff API) |

**Stack:** assistant-ui (Thread, tool slots, markdown) + `@opencode-ai/sdk` (already a dep). Not CopilotKit.

```
ui/agent/
  client.ts           # SDK → /api/opencode (bridge)
  runtime.ts          # assistant-ui ↔ OpenCode parts
  AgentPanel.tsx
  SessionList.tsx
  Thread.tsx
  Composer.tsx
  PermissionModal.tsx
  tool-parts/         # bash, edit/diff, read, todo (minimal)
  useAgentSession.ts
  useAgentEvents.ts
```

Handoff contract stays:

```ts
requestAgentHandoff({ text, directory?, open: true })
// → open panel + prefill composer
```

Home `/`: session hub inside Studio chrome — not proxied OpenCode SPA.

**References (no product fork):** CADAM / open-canvas (chat \| companion layout); opencode-manager (session/SSE/permission + supervise patterns); OpenChamber (rare tool-card peek only).

### 2 — Supervise OpenCode (opencode-manager model)

Studio host owns a small supervisor (**inspired by opencode-manager, not a fork**):

| Concern | Behavior |
| --- | --- |
| **Resolve** | Healthy parent / `OPENCODE_URL` → attach |
| **Spawn** | Else `opencode serve` (loopback, password aligned with Studio) |
| **Health** | Poll `/global/health`; conservative auto-restart |
| **Stop** | On host shutdown, stop **only** processes Studio spawned |
| **Config** | Normal `~/.config/opencode` so repair/skills/plugins keep working |
| **Surface** | API server only; Studio UI is the only browser UI |

### 3 — OpenCode version bump

- Today: pinned **1.18.2** (`@opencode-ai/sdk`, `@opencode-ai/plugin`, `engines.opencode`).
- Target: **latest stable** (SDK + plugin + engine floor aligned; binary on PATH matches).
- Smoke after bump: `repair`, plugin load, CAD/PCB tools, media hooks, bridge health, then native agent API.
- Do this **early** so the panel is not built on a stale API.

### 4 — Viewer refresh loop (CADAM-style)

When the agent writes/builds domain artifacts, the open studio viewer must update without a full manual reload.

- Subscribe to OpenCode session/tool/file events (via agent SSE or host bridge).
- Invalidate/refetch the active CAD design or PCB project when relevant paths change.
- Keep it lean: event → “reload current project”, not a second file watcher framework.

### 5 — Richer handoff

Keep the handoff API; enrich payload and UI:

- Support structured context: `paths[]`, annotation / selection text (and existing `text`).
- Composer shows chips (file path, annotation) — not only a blob of markdown.
- Clipboard fallback only when API/panel unavailable.

CAD/PCB call sites gain better context with minimal API churn.

### 6 — In-app status

Minimal status surface (page or settings strip) — not a full Manager clone:

- OpenCode version + healthy/unhealthy
- Plugin / skill / MCP repair indicators (reuse `status` semantics)
- Actions: **Repair**, **Restart agent** (supervised child only)
- CLI (`status` / `repair`) remains; discovery can start in the browser

### 7 — Single start path + dead code

- Primary entry: Studio starts UI + ensures OpenCode (spawn or attach).
- PATH `opencode` wrapper becomes **legacy** (document, then remove once supervise is default).
- After native panel + supervise ship: delete iframe helpers, broken-frame heuristics, obsolete attach-only docs/code paths.

### 8 — Single port

Default product URL is **only** the Studio host (e.g. `:4173`).

- Supervised OpenCode listens on **loopback** (or internal port); Studio host **reverse-proxies** `/api/opencode/*` (and WS/SSE) to it.
- Users never open `:4096` or OpenCode web in the default path.
- Attach mode may still point at an external `OPENCODE_URL`; proxy keeps the browser on one origin.
- Aligns with opencode-manager “one URL” DX; pairs naturally with supervise (phase 3).

### 9 — Pick-to-agent (domain)

CADAM / Orca Design Mode lite — selection in the viewer becomes agent context.

- CAD: select part / face / annotation → **Send to agent** (structured handoff).
- PCB: select component / net / region → same.
- Reuses richer handoff (`paths[]`, annotation, optional geometry id); composer shows chips.
- No general “design mode browser”; domain viewers only.

### 10 — Session files strip

Lightweight “what changed this session” — not a Git IDE.

- From OpenCode session diff / tool events: list of files the agent touched.
- UI: compact strip or side list (path, open-in-files / chip-to-composer).
- Click → open in Files or prefill handoff; optional jump when path is under active CAD/PCB project.
- Inspired by opencode-manager / OpenChamber review surfaces; keep minimal.

## Delivery order

| Phase | Outcome |
| --- | --- |
| **0** | OpenCode **latest stable** bump; Agent aside **without iframe**; health = API reachable (attach OK) |
| **1** | Sessions + stream + send; handoff + directory; **iframes gone** |
| **2** | Permissions; minimal tool cards; model/agent picker; abort/status dot |
| **3** | **Supervisor** + **single port** (OC on loopback, Studio proxies API); single start path |
| **4** | **Viewer refresh** on agent domain file/tool events |
| **5** | **Richer handoff** + **pick-to-agent** (CAD/PCB selection → chips) |
| **6** | **Session files strip** (files touched this session) |
| **7** | **In-app status** (health, repair, restart agent) |
| **8** | Wrapper/legacy/iframe **dead-code** removal; docs = one URL + one start story |

Phases 0–2 can run against external `opencode serve`. Phase 3 makes default DX self-contained and one-port. 4–7 are product polish on the native shell. 8 locks in leanness.

## Expected result

- Zero iframes for Agent / home
- One primary command + **one browser URL/port** for Studio + agent API
- OpenCode remains the engine (skills/MCP/plugins); web UI optional; OC API not exposed as a second user-facing port by default
- CAD/PCB: handoff, pick-to-agent, viewer refresh, session files strip — companion loop
- Status/repair/restart visible in-app
- Lean security and modular studios unchanged; `bun run check` green

## Success checklist

- [x] No `<iframe>` for OpenCode UI in Agent or home
- [x] SDK/plugin/engine on **latest stable** OpenCode; repair + studio smoke green
- [x] Default start: no manual `opencode serve`
- [x] Supervisor attaches if OC already up; spawns only when needed
- [x] Host stop does not kill OpenCode Studio did not start
- [x] Default DX: single Studio origin/port; OC API proxied (loopback child)
- [x] Handoff from CAD/PCB/Files opens panel with text + correct directory
- [x] Handoff can carry paths/annotation as first-class UI chips
- [x] Pick-to-agent: selection in CAD/PCB viewer → handoff chips
- [x] Session files strip lists files touched this session (open / chip)
- [x] Agent status = API/SSE, not iframe DOM
- [x] Permission approve/deny in-panel
- [x] Open studio viewer refreshes after relevant agent edits/builds
- [x] In-app status: version, health, Repair, Restart agent
- [x] Obsolete iframe/wrapper/attach-primary code and docs removed
- [x] No collab / Monaco / Git-IDE scope creep

**Stack note:** native React Agent panel (not assistant-ui). Optional OC web at `/` or `/opencode`.

## One-liner

**Studio stays the product; OpenCode stays the runtime (latest, supervised, one port); kill the iframe; native agent + pick-to-agent + session files + CADAM-style companion loop; one start, clear status, lean code.**
