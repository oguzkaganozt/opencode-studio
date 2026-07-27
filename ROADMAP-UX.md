# OpenCode Studio — Usability & Effectiveness Roadmap

ROI-ranked recommendations to make opencode-studio more usable, efficient, effective, and streamlined.

**Out of scope here:** security vulnerabilities and hardening (domain API auth on `--web`, TLS, uv checksums, multi-user auth, etc.). Track those separately.

**Scoring:** effort S / M / L · impact Y / O / D (high / medium / low) · ROI stars reflect impact ÷ effort.

**Current product baseline (2026-07):** CAD/PCB always on; simplified CLI; first-run docs; PCB agent handoff + skill depth; CAD `design_qc_report`; shared chrome; Files responsive; agent resize; CAD SSE; structured PCB part/BOM detail.

---

## Shipped

| # | What shipped |
|---|----------------|
| 1 | Always-on CAD/PCB; postinstall repair; CLI: serve/status/repair/remove/upgrade/service |
| 2 | README OpenCode-first; `/` vs `/studio`; repair skill-path wording |
| 3 | PCB NavLink active (`useLocation` / basename) |
| 4 | Shared `@ui` EmptyState / ErrorState in Files + PCB |
| 5 | Files responsive (stack below `md`; mobile list/preview) |
| 6 | `useStudioChrome()` — agent open / status / handoff |
| 7 | PCB “Send diagnostics to agent” |
| 8 | Richer `status` / `serve` (MCP + plugin checks; restart tips) |
| 9 | Repair/status/UI restart hints (configure Apply asymmetry gone) |
| 10 | PCB skill micro-flow + readiness field table + `/studio` URL |
| 11 | CAD `design_qc_report` (artifact / print / fit / form + `complete`) |
| 15 | Agent panel resize + width persist |
| 16 | PCB diagnostics collapsed by default |
| 19 | CAD designs SSE watcher (no 2s poll) |
| 22 | Structured part/BOM detail (PartDetailView + BOM row open) |
| 23 | Files keyboard + type-to-filter |
| 24 | Home skill/engine badges (`/api/studios` checks) |

---

## Next — UI/UX only (skip DX + security)

Ranked for **daily designer / agent-split** impact after the baseline above.

| Rank | # | Recommendation | Payoff | Effort | Impact | ROI | Where |
|------|---|----------------|--------|--------|--------|-----|--------|
| 1 | **27** | **CAD measure / isolate** | Deeper viewport inspection; pairs with Prompt + QC | L | Y | ★★★★☆ | CAD viewport |
| 2 | **21** | **CAD freeform example design** | Sample bar aligns with skill freeform bar | M | O | ★★★☆☆ | `studios/cad/designs/` |
| 3 | **26** | **Command palette ⌘K** | IDE feel for large workspaces | L | O | ★★☆☆☆ | UI shell |
| 4 | **29** | **`docs/user-guide.md`** | Human onboarding (skills are agent-facing) | M | O | ★★☆☆☆ | `docs/` |

**Suggested UI/UX sprint (next):** **#27** (measure alone may be multi-day).

---

## Backlog — maint / DX / regression (explicitly deferred for now)

Do **not** pull these into the next UI sprint unless adding a third studio or fighting real regressions.

| # | Recommendation | Payoff | Effort | Notes |
|---|----------------|--------|--------|--------|
| 12 | Single catalog registration map | New-studio tax ↓ | M | N=2; asserts already catch drift |
| 13 | `create-studio` auto-wire / checklist | Contributor DX | S–M | |
| 14 | wall-sconce **build gate** (not presence-only) | Real PCB regression signal | M | Highest *test* ROI when ready |
| 17 | Split `lifecycle.ts` | Safer lifecycle edits | M | Pure maint |
| 18 | `StudioModule` contract + tool prefix docs | Multi-studio agent clarity | M | |
| 20 | `remove --purge-plugins` | Cleaner uninstall | S | Partial story already exists |
| 25 | macOS launchd or documented tmux/serve | Non-Linux background | M/S | Segment |
| 28 | Parity freeze for key arg/response fields | Contract drift | M | |
| 30 | Visual regression in browser smoke | Catch chrome drift | M | QA, not product UX |

---

## Suggested sprints (updated)

| Sprint | Items | Focus | Status |
|--------|-------|--------|--------|
| **A** | #1–3, #7–10, #16 | Always-on, first-run, PCB agent loop | **Shipped** |
| **B** | #4–6, #11 | Shared chrome + CAD QC honesty | **Shipped** |
| **C** | #15, #19, #22 | Agent resize, CAD SSE, structured parts | **Shipped** |
| **D** | #23, #24 | Files power + Home health badges | **Shipped** |
| **E — next (UI/UX)** | **#27** | CAD inspection depth | **Next** |
| **F — later UI** | #21, #26, #29 | Samples, palette, human guide | Later |
| **G — maint when needed** | #12–14, #17–18, #20, #25, #28, #30 | DX / regression / segment | Deferred |

---

## Deliberately defer

| Item | Why |
|------|-----|
| Security / remote hardening | Tracked outside this doc |
| Multi-user, marketplace, dynamic third-party studios | Low ROI; changes product class |
| Full MCAD / full EDA replacement | Scope explosion — prefer skills + QC axes over kernel work |
| Maint/DX items above while UI/UX sprint D is open | User priority: product feel over contributor tax |

---

## Principle

Highest ROI is usually **not a new domain feature**. After always-on + agent loop + QC honesty, prefer:

1. ~~First-run clarity and restart/status visibility~~ **done**
2. ~~CAD ↔ PCB agent handoff parity~~ **done**
3. ~~Thin UI consistency + responsive Files + agent chrome~~ **done**
4. ~~PCB skill depth + CAD machine-readable QC~~ **done**
5. ~~Files power-user speed + Home health badges~~ **done**
6. **Next:** CAD inspection depth (#27)
7. Then samples / palette / human guide; maint only when adding studios or fighting regressions

---

## Context

Derived from a full product review (architecture, CLI/lifecycle, CAD/PCB domains, Viewer UI/UX, test maturity). Scores assume current modular monolith (`studios/` modules, always-on domains, workspace-local data, roots-only `studio.json`).
