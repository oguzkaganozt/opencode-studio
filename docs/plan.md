# UI/UX Overhaul Plan

Status: **implemented through Phase 3** (product locked; polish/F₁ core landed — further studio color purge optional)  
Scope: Viewer shell (`ui/`) + all studio viewers (`studios/*/viewer/`)  
Out of scope: domain tools, host APIs, forge/engines (unless UI needs a thin endpoint)

Companion model stays: viewers are **read-only inspection**; mutation stays in agent/tools.

**Interaction mantra:** canvas is the stage; agent is a callable stagehand.  
Feel target: Linear detail + Figma inspect + Cursor chat — not Slack bolted onto four mini-apps.

**Code anchors (today):**

| Fact | Location |
| --- | --- |
| Agent default **open** | `ui/app.tsx` `useState(true)` |
| Agent `hidden` when closed (stays mounted) | `ui/agent-panel.tsx` `open ? flex : hidden` |
| TopBar status always emerald | `ui/app.tsx` |
| Panel status binary (error vs ok) | `ui/agent-panel.tsx` |
| Sessions already per-studio | `metadata["opencode-studio"] === studioId` |
| CAD Prompt = clipboard only | `studios/cad/viewer/src/app.tsx` |
| No `@ui/*` alias yet | `vite.config.ts` / `tsconfig.json` (`@/*` → `src/*`, `@studios/*` only) |
| Studio forces light | `color-scheme: light` on each `studios/*/viewer/src/styles.css` |
| Token copies + drift | `ui/tokens.css` vs four `viewer/src/tokens.css` |
| PCB tabs state, fixed height | `ViewTab` + `useState`; `h-[560px]` in tab components |
| Smoke | `scripts/browser-smoke.ts` — 1280×800; waits `getByLabel("OpenCode agent")`; no theme/width asserts |
| Standalone viewer shells | `studios/*/viewer/index.html` + `main.tsx` exist; **host build `root: "ui"` only** |

---

## Locked decisions

| Area | Decision |
| --- | --- |
| **Theme timing (F)** | **Parallel P0 minimal (F₀).** Must not block Agent default-closed. |
| **Theme preference** | `system` \| `light` \| `dark` in `localStorage` (`opencode-studio.theme`). Default `system`. |
| **Token source** | Single `ui/tokens.css`. Studios `@import "@ui/tokens.css"`. Delete hand copies. Rewrite `ui/tokens.css` header + `AGENTS.md` (“import, don’t copy”). |
| **DOM theme** | Only `html[data-theme="light"\|"dark"]`. Preference `system` resolved in JS, never left on DOM. |
| **Canvas** | `--osc-canvas-bg` stays dark both themes. |
| **Dark accents** | Keep brand hues; tune only if contrast fails. |
| **Agent default** | **Closed** when `opencode-studio.agentOpen` **absent**. Persist global `"true"` / `"false"`. Migration: today’s default-open users get closed once (acceptable). |
| **Handoff** | **Open + fill composer + focus.** Clipboard secondary. **No auto-send.** |
| **Sessions** | **Keep existing filter** — do not rebuild. UX: titles, empty copy only. |
| **Chrome** | **Slot standard** (title / status / actions). **No** mandatory CAD subnav. |
| **Settings** | Drawer now. `/studio/settings` **Phase 2 optional** if drawer remains enough. |
| **Primitives (B)** | B-light extract-as-you-go; home + media first. |
| **A11y** | Baseline in every touched PR. Dialog/skip-link polish later. |
| **Markdown** | **Deferred past 1a** (after handoff/status/scroll). |
| **Ownership** | **A owns agent sheet/overlay.** **C owns studio rails/inspectors only.** |
| **Standalone viewers** | **Ignore for product path.** Host-only FOUC/theme. Optional: one-line note in scaffold; do not maintain parallel theme boot unless someone runs standalone. Do not block Phase 0 on deleting them. |
| **PCB tab segments** | Match existing `ViewTab`: `schematic` \| `pcb` \| `bom` \| `3d` \| `json`. |

Still open (implementation PR):

- Markdown renderer (when un-deferred).
- Rail collapse `localStorage` key names.
- Exact scroll “near bottom” threshold px (default **80**).

---

## Explicit deferrals (not Phase 0–1a)

| Item | Earliest |
| --- | --- |
| Markdown in agent | after 1a |
| Dialog primitive / modal migration | Phase 3 |
| Settings URL route | Phase 2 (optional) |
| PCB tab URLs | Phase 2 |
| F₁ full hardcoded purge + all-studio theme verify | Phase 2–3 |
| Badge / PageHeader unless a touched surface needs them | on demand |
| Full media migration beyond first Button/Empty extract | 1b timebox |
| Readiness hub / home extras | Phase 2–3 |
| Agent drag-resize, Storybook, Radix kit | never (v1) |

---

## Goals

1. One product, not four mini-apps beside chat.
2. Agent is opt-in side tool, not viewport landlord.
3. Shared empty/error/button language (Media bar).
4. Phone → ultrawide without crushed columns.
5. OS-aware light/dark + override.
6. A11y baseline on touched surfaces.

Non-goals: design-system package, token codegen, full Radix/shadcn, canvas aesthetic rewrites, CSS-in-JS.

---

## Priority order

**Viewport truth → inspect→agent path → shared skin → theme/a11y depth.**

| Order | Focus |
| --- | --- |
| **1** | **A** default-closed, persist, status machine, handoff, scroll, agent sheet |
| **2** | **C** studio rails + PCB height (agent breakpoints already in A) |
| **3** | **Loop** skill empties, permission copy (light) |
| **4** | **B-light** extract on touch |
| **5** | **F₁** purge + deep theme verify |
| **6** | **D thin** PCB URLs, optional settings route |
| **7** | **E polish** dialog, skip link, contrast |

**F₀ ∥ A₀ in Phase 0** (alias/tokens/theme must not gate default-closed, but alias is step 0 for any `@ui` import).

---

## Engineering contracts (implement against these)

### 0. Alias + token contract (Phase 0 step 0)

1. Add to **both** `vite.config.ts` `resolve.alias` and `tsconfig.json` `paths`:
   - `@ui/*` → `ui/*`
2. CSS: Vite must resolve `@import "@ui/tokens.css"` (alias on CSS imports). Host keeps `@import "./tokens.css"` or switches to `@ui` — one cascade.
3. Delete `studios/*/viewer/src/tokens.css` after studio `styles.css` imports `@ui/tokens.css`.
4. Same PR: flip `ui/tokens.css` comment + `AGENTS.md` — **import canonical tokens; do not copy.**
5. Host already loads tokens via `ui/styles.css`; studio import keeps lazy/standalone CSS self-contained and kills drift.

### 1. Handoff API (highest product risk)

Lazy CAD **cannot** reach `AgentPanel` internal `useState`. Shell must expose a stable bridge.

**Recommended shape** (pick one implementation; behavior is normative):

```ts
// ui/agent-handoff.ts — module + React context, or extend window __OPENCODE_STUDIO__
type AgentHandoffRequest = {
  text: string
  source?: "cad" | "pcb" | "media" | "startup" | "shell"
  /** default true */
  open?: boolean
  /** default true */
  focus?: boolean
  /** default false — clipboard is secondary fallback only */
  copyFallback?: boolean
}

// Imperative API for lazy viewers:
requestAgentHandoff(req: AgentHandoffRequest): void
// StudioFrame/AgentPanel subscribes; applies open → setPrompt → focus textarea
```

| Case | Behavior |
| --- | --- |
| Panel closed | Open (`setAgentOpen(true)` + persist), then fill + focus |
| Panel open | Fill + focus |
| CSRF missing | Still fill + focus; composer shows existing disabled Send + clear CSRF hint (do not silently no-op) |
| Auth / setup gate | Still fill + focus; user sees unlock UI with text preserved |
| No auto-send | Never call send mutation from handoff |
| Clipboard | Optional secondary if `copyFallback` or copy button; primary toast **“Sent to agent”** / focus flash — not “copied!” |
| CAD skill/tools copy | Update `studios/cad/skill/SKILL.md` + tool blurb when Prompt behavior changes (parity/docs, not `tools.json` unless tool schema changes) |

**Tests:**

- Unit: handoff bus/context — closed→open, text set, focus requested (mock).
- No requirement for full GLB click in browser-smoke v1.

**Wire order:** shell API first → CAD Prompt one-liner second (avoid double CAD rework).

### 2. Status state machine

Shared derivation used by **TopBar dot** and **AgentPanel header** (one function).

| State | When (normative) |
| --- | --- |
| `loading` | Panel open and sessions/state query fetching with no usable data yet |
| `ready` | Open, no hard error, session list or idle/busy state OK (busy is still ready connectivity) |
| `needs-password` | 401 or unlock UI |
| `setup` | `chat_auth_required` / remote password setup |
| `error` | Other query/mutation hard errors |
| `closed` | Panel closed — TopBar may show neutral/muted, **not** fake emerald “connected” |

Busy/retry is **activity**, not a fifth connectivity lie — show in composer/header text if useful; dot stays `ready` while streaming unless error.

**Must-pass:** error/auth never render emerald; closed never looks “live connected.”

### 3. Agent open persistence

```ts
const KEY = "opencode-studio.agentOpen"
function readAgentOpen(): boolean {
  const v = localStorage.getItem(KEY)
  if (v === null) return false // first visit / migration
  return v === "true"
}
```

Toggle and handoff-open write `"true"` / `"false"`.

### 4. Scroll stickiness

- Threshold: user is “pinned” if `scrollHeight - scrollTop - clientHeight < 80` (tunable).
- On `stateQuery.data` update: auto-scroll **only if pinned**.
- Poll stays 800ms busy / 2.5s idle — do not change intervals for UX.

### 5. Theme + studio footguns (F₀)

1. FOUC: inline script in **`ui/index.html` only** (host path). No SSR.
2. Remove or theme-bind studio root `color-scheme: light` — must follow `html[data-theme]` / `color-scheme` on `html`.
3. F₀ acceptance: **shell + agent readable in both themes**; studios must **not force light scheme**. Full studio chrome polish = F₁.
4. Watch `ui/styles.css` `body::before` warm gradient — token-aware or acceptable on both.
5. Canvas HUD `text-white/…` stays on dark canvas; don’t “fix” to theme text tokens.

### 6. Browser smoke contract

Today: agent label wait + height chain @ 1280. Panel stays in DOM when `hidden`, so **default-closed alone may not fail** `getByLabel` — still update smoke intentionally.

**Same PR as A₀/F₀ (or immediately after):**

| Assert | Detail |
| --- | --- |
| Agent closed by default | At 1280, studio main content width ≳ **60%** of viewport (or agent column not taking layout width — `hidden` / zero width) |
| Theme | Force `data-theme` light vs dark → `getComputedStyle(document.documentElement).getPropertyValue('--osc-bg')` differs |
| FOUC contract | Optional: LS set before nav → `dataset.theme` ∈ light\|dark |
| Don’t require open agent column | Waiting for label OK if mounted+hidden; do **not** require visible chat chrome |
| 360 | Phase 2 (C): no document H-scroll on home + one studio |

Gate: theme/layout PRs run `bun run build && bun run test:browser`.

### 7. Media Button lift

Existing: CVA `default` \| `outline` \| `ghost` (`studios/media/viewer/src/components/ui/button.tsx`).  
Shared Button: map `default`→primary, keep outline/ghost; add `danger` / sizes **only when a caller needs them** — not a vacuum redesign.

---

## Workstreams

| ID | Priority | Owns |
| --- | --- | --- |
| **A** | P0 | Agent open state, sheet, status, handoff consumer, scroll, labels, type floor |
| **F₀** | P0 ∥ | Alias, tokens, dark map, FOUC, toggle, kill `color-scheme: light` force |
| **C** | P0–P1 | Studio rails, PCB `h-[560px]` → flex, badge diet — **not** agent sheet |
| **Loop** | P1 | Skill empties, permission microcopy, CAD toast/skill blurb |
| **B** | P1 (1b) | `cn`, Button, Empty, … on demand |
| **F₁** | P2 | Hardcoded purge, deep both-theme studio check |
| **D** | P2 | PCB tab routes, catalog a11y, optional settings route |
| **E** | P2–3 | Dialog, skip link, contrast pass |

---

## F — Theme

### Structure

```css
:root { /* fonts, radii, motion, accent IDs, canvas-bg */ }
html[data-theme="light"] { /* surfaces… */ }
html[data-theme="dark"] { /* … */ }
[data-studio="cad"] { --osc-accent: var(--osc-accent-cad); }
/* … */
```

`ui/theme.ts`: resolve preference → apply `data-theme` + `color-scheme`; subscribe to `matchMedia` when preference is `system`.

### F₀ vs F₁

| | F₀ | F₁ |
| --- | --- | --- |
| Alias + single tokens + delete copies | yes | — |
| Dark map + FOUC + toggle | yes | refine |
| Un-force studio `color-scheme: light` | yes | — |
| Shell+agent readable both themes | yes | — |
| Hardcoded amber/emerald purge | shell status tokens if easy | full |
| All studio chrome verified | no | yes |
| Smoke `--osc-bg` differs | yes | + more |

### Acceptance (testable)

- [ ] No `studios/*/viewer/src/tokens.css` left
- [ ] OS dark cold load: dark shell, no light flash
- [ ] LS override persists; system tracks OS
- [ ] `--osc-bg` light ≠ dark in smoke
- [ ] No studio root forces `color-scheme: light` independently of theme

---

## A — Agent panel UX

### Changes

1. Default closed + global LS (see contract §3).
2. **Mobile sheet:** refine existing `absolute inset-0` / `md:static` column — not greenfield. Focus restore on close (mirror SideDrawer patterns). Escape closes when appropriate.
3. Handoff consumer (contract §1); CAD Prompt wires to it.
4. Status machine (contract §2) on TopBar + panel.
5. Scroll stickiness (contract §4).
6. Sessions: **filter stays**; wider titles; studio-specific empty strings.
7. CSRF/auth: in-composer copy when Send disabled.
8. Permissions: Allow once · Always allow · Deny.
9. Icon buttons + `aria-label`; body ≥12–13px.
10. Markdown: **out of 1a.**

### Acceptance (testable must-pass)

- [ ] No LS key → agent closed; content owns width @ 1280 (smoke)
- [ ] LS `"true"` → open after reload
- [ ] Handoff unit: opens, sets text, requests focus; no send
- [ ] Status ∈ documented enum; error/auth ≠ emerald; closed ≠ fake live
- [ ] Manual or unit: scrolled-up thread not yanked on poll
- [ ] CAD Prompt calls handoff (integration or thin mock)

---

## B — Primitives (1b)

Extract-as-you-go under `ui/components/*` + `ui/lib/cn.ts`.  
First consumers: shell controls and/or home + media re-export.  
Subjective “density feels one” is **not** must-pass — use import graph / no new one-off primary buttons.

---

## C — Responsive (studio-owned)

| Region | Behavior |
| --- | --- |
| CAD / Startup rails | Collapsible; mobile select/sheet |
| PCB viewers | Drop fixed `h-[560px]`; flex in height chain (`min-h-0` parents) |
| PCB cards | Badge diet |
| Agent | Already A |

Acceptance: 360 path + no H-scroll (smoke Phase 2); PCB tabs flex; startup rail collapses.

---

## Loop glue

1. Handoff extensible `source` field.
2. Skill-shaped empties when touching studio empties.
3. Update CAD skill “paste into chat” → handoff language.
4. Home microcopy light pass in 1b if touching home.
5. Readiness hub → later.

---

## D — IA (thin, Phase 2)

- PCB: nested routes under `projects/:id/:tab` with `ViewTab` names.
- Catalog keyboard rows.
- Settings route optional.
- Slot headers via PageHeader when extracted — CAD no fake subnav.

---

## E — A11y

**Continuous:** labels, focus-visible, Escape/restore on agent sheet, reduced motion.  
**Later:** Dialog, skip link, catalog, contrast.

---

## Cross-cutting rules

1. No cross-studio imports; share `@ui/*` or `src/core/`.
2. Framing: `.studio-shell` / `flex-1 min-h-0` (`AGENTS.md`).
3. Tailwind: `@source "./components"` when dir exists; keep `@source "../studios"`.
4. Tests: `bun run check`; theme/layout → `build` + `test:browser`. Unit `theme.ts` + handoff.
5. UI-only → no `test/parity/*` unless tools/skills strings require digest updates.
6. CSRF/Origin unchanged.
7. No theme remount of Three/tscircuit roots.
8. Do not build: DS package, Style Dictionary, full Radix, agent docking.

---

## Phased delivery

### Phase 0 — Foundation (multi-PR OK)

| A₀ | F₀ |
| --- | --- |
| Default closed + LS | **Step 0:** `@ui` alias vite+tsconfig |
| Status machine + TopBar | tokens single-source; delete copies; AGENTS.md |
| Toggle/close labels | dark map + FOUC + `theme.ts` + control |
| Smoke: closed width | un-force `color-scheme: light`; smoke `--osc-bg` |

**Exit:** canvas-first first paint; shell dark/light; smoke green; contracts §0–§3,§5–§6 landed.

### Phase 1a — Agent loop (no B requirement)

- Handoff API + CAD wire + toast/skill blurb
- Scroll stickiness
- Session title width + studio empty copy
- Permission labels; CSRF composer hint
- Agent sheet focus/Escape refine (A-owned)

**Exit:** inspect→agent works; must-pass A list green. **No markdown gate.**

### Phase 1b — B-light

- `cn` + Button (+ Empty if home/media touched)
- Home and/or media migration timeboxed
- Optional microcopy on home

**Exit:** at least one shared Button path; media re-exports or deletes local button.

### Phase 2 — C finish + D thin

- Rails, PCB height, badge diet, 360 smoke
- PCB tab URLs; catalog keyboard
- Settings route optional
- F₁ start (purge)

### Phase 3 — Polish

- Dialog, skip link, contrast
- F₁ complete; markdown if still wanted
- Loop leftovers

**Target feel:** ~7.5–8/10.

---

## Milestone checklist

### Pre-first-PR (green light)

- [x] Product locks (default-closed, handoff open+fill+focus, global agentOpen, tokens `@ui`, sessions keep)
- [x] Handoff + status + smoke + alias contracts in this doc
- [x] Standalone = ignore product path
- [x] Phase 1 split 1a / 1b
- [x] Deferral table

### F₀

- [ ] `@ui/*` alias
- [ ] Single tokens; copies gone; AGENTS.md
- [ ] FOUC + dark/light + toggle
- [ ] Studio `color-scheme` not forced light
- [ ] Smoke `--osc-bg` assert

### A₀ / 1a

- [ ] Default closed + LS
- [ ] Status machine shared
- [ ] Smoke closed width
- [ ] Handoff API + CAD
- [ ] Scroll stickiness
- [ ] Empty/permission/CSRF copy
- [ ] Sheet a11y baseline

### 1b+

- [ ] Button/cn extract
- [ ] C rails / PCB height
- [ ] D PCB URLs
- [ ] F₁ / E polish

---

## Success metrics

| Signal | Before | After |
| --- | --- | --- |
| First studio open | Agent steals width (`useState(true)`) | Full canvas |
| CAD Prompt | Clipboard + “paste into agent” | Handoff fill+focus |
| Status | Lying emerald | Enum states |
| Theme | Light only + studio `color-scheme: light` | OS-aware shell; no forced light |
| PCB tabs | State + 560px | URL (P2) + flex height |

**Ship bar:** canvas-first; persist; handoff unit+CAD wire; ≥ documented status states; smoke closed width + theme; PCB flex when C done.

**Non-metrics:** dark adoption %, primitive count, subjective density.

---

## Module map (Phase 0–1a)

```
ui/
  index.html           # FOUC snippet only (host)
  tokens.css           # sole source; light+dark; new header
  theme.ts
  main.tsx
  styles.css           # @source "./components" when present
  agent-handoff.ts     # requestAgentHandoff + provider/subscribe
  agent-status.ts      # deriveAgentStatus(...) shared
  agent-panel.tsx      # consumer; scroll pin; status
  app.tsx              # agentOpen LS; TopBar status; theme control
  lib/cn.ts            # 1b
  components/          # 1b+
studios/*/viewer/src/styles.css   # @import "@ui/tokens.css"; no color-scheme: light force
studios/*/viewer/src/tokens.css   # DELETE
studios/cad/viewer/src/app.tsx    # Prompt → requestAgentHandoff
studios/cad/skill/SKILL.md        # handoff language
vite.config.ts + tsconfig.json    # @ui/*
AGENTS.md                         # import tokens, don’t copy
scripts/browser-smoke.ts          # closed width + --osc-bg
```

---

## Microcopy (freeze v1 — avoid bikeshed)

| Place | String |
| --- | --- |
| CAD handoff toast | Prompt ready in agent |
| CAD HUD hint | Prompt sends to agent |
| Permission | Allow once · Always allow · Deny |
| Agent empty CAD | Ask to build or edit a part… |
| Agent empty PCB | Ask to scaffold or fix a board… |
| Agent empty media | Ask to generate or organize library assets… |
| Agent empty startup | Ask to evaluate or refine a candidate… |
| CSRF | Can’t send — refresh to restore security token |
| Settings apply | Save studios — restart OpenCode to load tools |
| Home CTA | Open CAD / Open Media / … (domain noun) |

---

## References

- UI review + 3-agent consult + principal review (validated against repo)
- `docs/architecture.md`, `AGENTS.md`
- Media button: `studios/media/viewer/src/components/ui/button.tsx`
- Smoke: `scripts/browser-smoke.ts`
)
