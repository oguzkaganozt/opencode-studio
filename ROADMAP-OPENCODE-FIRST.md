# OpenCode-first architecture

Greenfield redesign. Sole user — **no migration**, no dual-mode, no deprecation window.

**Deleted models:** Studio-outer host, owned OpenCode sidecar (`createOpencodeServer`), user-facing `opencode-studio serve` / host systemd, attach-disables-proxy.

**Status: ready to implement from Phase 1.**

---

## Working model

```
opencode serve                         ← sole lifecycle owner
  └── first directory Instance
        └── plugin (@opencode-studio + media-go)
              ├── tools / skills / MCP
              └── in-process startHost() :4173
                    ├── /studio  → Viewer
                    ├── /api/*   → domain APIs
                    └── /*       → reverse proxy → parent serverUrl
                                  (Agent iframe same-origin)

serve process exits  →  host exits with it (same process)
Instance dispose     →  host stays up
```

1. Run **`opencode serve`** only supported parent (not plain TUI without listen).
2. Something creates a **directory** Instance (parent UI / API with directory) → plugin loads.
3. Plugin **ensure-host** in-process: `startHost` on **4173**, pin first `context.directory`, attach to parent.
4. Browser: **`http://127.0.0.1:4173/studio`** only after step 2–3 (cold 4173 before that is expected).
5. Agent: iframe `/` → Studio proxies to this serve.
6. Studio never spawns OpenCode; never has a separate user daemon.

OpenCode work unit = **directory** (`context.directory`). First directory **pins** the host for its life; later directories unsupported (tools may disagree with viewer — known limit).

---

## Phase 0 — Contracts (LOCKED)

### Product

| Topic | Decision |
| --- | --- |
| Lifecycle | 100% `opencode serve` |
| User CLI | `repair` / `status` / `remove` / `upgrade` only — **no `serve`, no host `service *`** |
| Host API | Internal `startHost()` — plugin + tests/smoke only |
| Parent | `opencode serve` only |
| Browser | `http://127.0.0.1:4173/studio` |
| Port | **4173** fixed; busy → **fail** (no ephemeral) |
| Directory | First Instance wins; no rebind |
| Host death | With OpenCode **process**; **not** on plugin `dispose` |
| Multi-tenant / multi-dir rebind | Out of scope |
| Security extras | Minimal; sole user; global SSE **allow** |

### Engineering

| Topic | Decision |
| --- | --- |
| Host shape | **In-process** `Bun.serve` inside OpenCode plugin process |
| Signals | `startHost` library path: **no** `SIGINT`/`SIGTERM` → `process.exit`. Tests may pass optional `onSignal` / manage lifecycle themselves |
| Singleton | Module-level ensure + lock/health on 4173; second ensure reuses if healthy |
| Bridge | Attach-only: `createOpenCodeBridge({ baseUrl, workspace, env? })`; proxy + WS **always** |
| Parent URL | From `context.serverUrl`, then **normalize** bind hosts `0.0.0.0` / `::` → `127.0.0.1` |
| Real parent | Do **not** trust URL presence (OpenCode falls back to `http://localhost:4096`). **Probe** parent health (e.g. `/global/health` or equivalent) before ensure; fail soft if dead |
| Bootstrap UX | Host starts only after first directory Instance; plugin **logs** Studio URL; document cold `/studio` until then |
| `OPENCODE_STUDIO_OPENCODE_URL` | Remove as product path; tests inject `parentOpenCodeUrl` / bridge `baseUrl` |
| `OPENCODE_STUDIO_URL` | Ensure output for tools/companion (default `http://127.0.0.1:4173`) |
| `OPENCODE_STUDIO_AUTOSTART=0` | Opt-out ensure (CI) |
| Parent auth | Inherit / pass `OPENCODE_SERVER_*` into bridge when parent has Basic |
| media-go | Unchanged |
| `createOpencodeServer` | Zero production usage |

### Success criterion

> `opencode serve` + first directory Instance → plugin ensure → `:4173/studio` + Agent same-origin to **this** serve → no Studio-spawned `opencode` in the tree → Instance dispose leaves host → killing serve drops `:4173`.

### Bootstrap (explicit)

```
opencode serve          →  parent listens (Studio not up yet)
client hits directory   →  Instance + plugin
ensure-host             →  :4173 up; log http://127.0.0.1:4173/studio
browser opens /studio   →  Viewer + Agent
```

---

## Phase 1 — Attach-only bridge  ← **START HERE**

**Files:** `src/opencode-bridge.ts`, `test/opencode-bridge.test.ts`, thin `src/server.ts` compile wiring

| Do | Don’t |
| --- | --- |
| Required `{ baseUrl, workspace, env? }` | `createOpencodeServer` / `startServer` inject |
| Proxy + WS always when baseUrl set | Attach disables proxy / owned-sidecar guard |
| Keep pin, header scrub, gzip, location rewrite | Owned server lifecycle |
| Normalize baseUrl host if needed at call site or bridge | |

**Tests:** Invert “attach refuses proxy” → attach enables proxy. Drop spawn fakes. Keep pin/WS.

**Compile:** `startHost` / CLI may temporarily require `parentOpenCodeUrl` stub so typecheck passes; gut user `serve` in Phase 2 same wave as required parent (don’t leave broken CLI until Phase 4).

**DoD:** Bridge has no spawn; unit tests green; `bun run typecheck` green.

---

## Phase 2 — Host library + Agent

**Files:** `src/server.ts`, `ui/app.tsx`, `ui/native-agent-frame.tsx`, `test/server.test.ts`, start gutting `cli.ts` / `service.ts`

1. `HostInput.parentOpenCodeUrl` required (or inject bridge).
2. Strip process-global signal → `process.exit` from library `startHost`.
3. `nativeOpenCodeAvailable = Boolean(parentUrl)` (+ optional reachability).
4. Never kill OpenCode on config/bridge close.
5. UI: parent-down copy only.
6. Health endpoint kept; optional parent field.
7. **Same wave:** remove or non-functional-stub `opencode-studio serve` + host `service *` so nothing calls spawn/host without parent.

**DoD:** Tests call `startHost` + stub parent → Agent `/` works; no user serve path required.

---

## Phase 3 — Plugin ensure-host

**Files:** `src/plugin.ts`, `src/studio-loaders.ts`, `src/host-ensure.ts` (if needed)

```
plugin(context):
  if AUTOSTART=0 → tools only
  baseUrl = normalize(context.serverUrl)
  if parent health probe fails → soft log; tools without companion
  hostUrl = ensureStudioHost({ parent: baseUrl, workspace: context.directory })
  // first directory wins via singleton
  compose tools with hostUrl
  // dispose: do not stop host
```

| Detail | Choice |
| --- | --- |
| Start | In-process `startHost` once |
| Reuse | Healthy :4173 → reuse |
| 4173 foreign busy | Clear error / log |
| Companion | After health ok |
| uiDirectory | Resolve from package root, not cwd |

**DoD:** Integration per success criterion (probe, pin, dispose, process death).

---

## Phase 4 — CLI surface finish

**Files:** `src/cli.ts`, `src/service.ts`, `src/completion.ts`, `package.json`

- Confirm zero host lifecycle commands/docs/completions/scripts.
- Keep repair/status/remove/upgrade; status reports host up? if possible.
- Drop dead env docs for sidecar/attach-disable.

**DoD:** CLI help = OpenCode-first only.

---

## Phase 5 — Docs + smoke + purge

| Target | Content |
| --- | --- |
| README / AGENTS | install → repair → `opencode serve` → open project/directory once → `:4173/studio` |
| CAD skill | Companion via plugin; no manual serve |
| browser-smoke | In-process `startHost` + stub parent |
| vite | Dev Agent proxy as needed |
| Grep | `sidecar`, `createOpencodeServer`, product `serve` host story → 0 |

**DoD:** `bun run release:check`; manual path uses only `opencode serve`.

---

## Out of scope

- media-go split  
- CAD/PCB domain (except companion URL)  
- Multi-tenant shared serve  
- TUI-without-serve parent  
- Multi-directory host rebind  
- Upstream multi-`provider`  
- Studio user daemon  

---

## File cheat sheet

| File | Action |
| --- | --- |
| `src/opencode-bridge.ts` | Attach-only; delete spawn |
| `src/server.ts` | Parent required; no exit-on-signal in library; `startHost` API |
| `src/plugin.ts` | Ensure-host; normalize+probe; no dispose-kill |
| `src/host-ensure.ts` | Optional singleton/ensure helper |
| `src/studio-loaders.ts` | Dynamic hostUrl |
| `src/cli.ts` / `service.ts` / `completion.ts` | Purge serve/service host |
| `ui/*` | Agent flag + copy |
| tests / browser-smoke | `startHost` + stub parent |
| docs / skills | OpenCode-first narrative |

---

## Order

```
0 LOCKED → 1 bridge (START) → 2 host library + Agent + gut serve → 3 plugin ensure → 4 CLI finish → 5 docs/smoke
```

Ship gate = end of **Phase 3**. Critical path **1 → 2 → 3**.

## Checklist

- [x] Phase 0 — contracts locked (incl. in-process, probe, bootstrap, signals)
- [ ] Phase 1 — attach-only bridge  
- [ ] Phase 2 — host library + Agent + gut user serve  
- [ ] Phase 3 — plugin ensure-host  
- [ ] Phase 4 — CLI surface finish  
- [ ] Phase 5 — docs/smoke/purge  
