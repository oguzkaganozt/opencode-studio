# OpenCode Studio — Usability & Effectiveness Roadmap

ROI-ranked recommendations to make opencode-studio more usable, efficient, effective, and streamlined.

**Out of scope here:** security vulnerabilities and hardening (domain API auth on `--web`, TLS, uv checksums, multi-user auth, etc.). Track those separately.

**Scoring:** effort S / M / L · impact Y / O / D (high / medium / low) · ROI stars reflect impact ÷ effort.

---

## ROI table

| # | Recommendation | Payoff | Effort | Impact | ROI | Where |
|---|----------------|--------|--------|--------|-----|--------|
| 1 | ~~Enable/disable + CLI bloat~~ **DONE** — always-on; postinstall repair; CLI: serve/status/repair/remove/upgrade/service | Simpler UX/DX | — | — | ✓ | shipped |
| 2 | ~~**README / CLI alignment**~~ **DONE** — OpenCode-first prerequisites; `/` vs `/studio` table; repair skill path wording | Less support load | — | — | ✓ | shipped |
| 3 | ~~**PCB `NavLink` active state**~~ **DONE** — basename-aware `useLocation` matching | Clear “where am I” | — | — | ✓ | shipped |
| 4 | **Shared UI adoption** — Files/PCB use `@ui` `EmptyState` / `ErrorState` / `--osc-error`; kill token drift | Consistency + cheaper maintenance | S | O | ★★★★☆ | `ui/`, studio viewers |
| 5 | **Files responsive layout** — stack or collapsible list below `md` | Usable Files on narrow viewports | S–M | O | ★★★★☆ | `ui/files-explorer.tsx` |
| 6 | **`useStudioChrome()` extract** — shared agent open / status / handoff for Files + Studio frames | Less duplication; safer new surfaces | S–M | O | ★★★★☆ | `ui/app.tsx` |
| 7 | ~~**PCB → Agent handoff**~~ **DONE** — “Send diagnostics to agent” | Closes agent loop for PCB | — | — | ✓ | shipped |
| 8 | ~~**Richer `status` / `serve` output**~~ **DONE** — MCP + plugin checks; serve tip; status restart tip on warn/fail | Half-configured states visible | — | — | ✓ | shipped |
| 9 | ~~**CLI configure messaging**~~ **DONE** — repair/status/UI restart hints (Apply asymmetry obsolete) | — | — | — | ✓ | shipped |
| 10 | ~~**Deepen PCB skill**~~ **DONE** — micro-flow + readiness field table + `/studio` URL | Better agent PCB outcomes | — | — | ✓ | shipped |
| 11 | **CAD `design_qc_report`** — separate artifact / print / fit / form statuses | Less overclaim; mirrors PCB multi-axis honesty | M | Y | ★★★★☆ | `studios/cad/tools.ts`, skill, parity |
| 12 | **Single catalog registration map** — id → definition / plugin / api / viewer | New-studio tax ↓; loader drift ↓ | M | Y (maint) | ★★★★☆ | `registry`, loaders, `ui/app.tsx` |
| 13 | **`create-studio` auto-wire or checklist script** | Contributor DX | S–M | O | ★★★☆☆ | `scripts/create-studio.ts` |
| 14 | **wall-sconce build gate** (not presence-only) | Real PCB regression signal | M | O–Y | ★★★☆☆ | `test:pcb-fixture` / scripts |
| 15 | **Agent panel resize + width persist** | Better daily split workflow | M | O | ★★★☆☆ | `ui/native-agent-frame.tsx` |
| 16 | ~~**PCB compact header**~~ **DONE** — diagnostics collapsed by default (`details`) | See the board first | — | — | ✓ | shipped |
| 17 | **Split `lifecycle.ts`** — skills / plugin-reg / mcp / doctor modules | Faster, safer lifecycle changes | M | O (maint) | ★★★☆☆ | `src/lifecycle.ts` |
| 18 | **`StudioModule` contract** — shared error envelope; document tool prefixes (`design_*` vs `pcb_*`) | Clearer multi-studio agent sessions | M | O | ★★★☆☆ | `src/core/`, skills |
| 19 | **CAD SSE or revision endpoint** — replace blind 2s poll | Fresher viewer, less noise | M | O | ★★★☆☆ | CAD `api.ts` + viewer |
| 20 | **`remove --purge-plugins`** | Clean uninstall story | S | D–O | ★★★☆☆ | lifecycle + CLI |
| 21 | **CAD freeform example design** | Align sample bar with skill freeform bar | M | O | ★★★☆☆ | `studios/cad/designs/` |
| 22 | **Structured part/BOM detail** (not raw JSON dump) | Better designer UX | M | O | ★★★☆☆ | PCB catalog / BOM tabs |
| 23 | **Files keyboard + type-to-filter** | Power-user speed | M | D–O | ★★☆☆☆ | `ui/files-explorer.tsx` |
| 24 | **Home skill/engine badges** | Discoverability of configure health | S | D | ★★☆☆☆ | Home cards |
| 25 | **macOS launchd or documented tmux/serve** | Non-Linux background story | M / S | O (segment) | ★★☆☆☆ | `src/service.ts`, docs |
| 26 | **Command palette ⌘K** | IDE feel for large workspaces | L | O | ★★☆☆☆ | UI shell |
| 27 | **CAD measure / isolate** | Deeper inspection | L | O | ★★☆☆☆ | CAD viewport |
| 28 | **Parity freeze for key arg/response fields** | Contract drift protection | M | O (maint) | ★★☆☆☆ | `test/parity/` |
| 29 | **`docs/user-guide.md`** — first part / first board / media | Human onboarding (skills are agent-facing) | M | O | ★★☆☆☆ | `docs/` |
| 30 | **Visual regression screenshots** in browser smoke | Catch chrome drift | M | D–O | ★☆☆☆☆ | `scripts/browser-smoke.ts` |

---

## Suggested sprints

| Sprint | Items | Focus |
|--------|-------|--------|
| **A** | #1–3, #7–10, #16 | **Shipped** — always-on, first-run, PCB agent loop |
| **B — next** | #4–6, #11 | Shared chrome + CAD QC honesty |
| **C** | #12–14, #17 | Maint speed + regression confidence |
| **D — later** | #15, #18–22, #26–27 | Polish and depth |

---

## Deliberately defer

| Item | Why |
|------|-----|
| Security / remote hardening | Tracked outside this doc |
| Multi-user, marketplace, dynamic third-party studios | Low ROI; changes product class |
| Full MCAD / full EDA replacement | Scope explosion — prefer #11 + skills over kernel work |

---

## Principle

Highest ROI is usually **not a new domain feature**. Prefer:

1. First-run clarity and restart/status visibility  
2. CAD ↔ PCB agent handoff parity  
3. Thin UI consistency fixes  
4. PCB skill depth + CAD machine-readable QC  
5. Then registration/lifecycle maint refactors  

---

## Context

Derived from a full product review (architecture, CLI/lifecycle, CAD/PCB domains, Viewer UI/UX, test maturity). Scores assume current modular monolith (`studios/` modules, fail-closed global enablement, workspace-local data).
