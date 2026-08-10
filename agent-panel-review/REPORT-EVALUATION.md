# Report evaluation — Agent Panel UI review

**Evaluates:** `AGENT-PANEL-UI-REVIEW.md` against `full.png`, `top-bar.png`, `chat-section.png`  
**Purpose:** Calibrate findings before the improvement/polish plan.  
**Date:** 2026-08-10

---

## Report quality (meta)

| Dimension | Score | Notes |
| --- | --- | --- |
| Structure | Strong | Clear sections, works vs issues, severity table, prioritized list |
| Evidence | Good | Grounded in screenshots; flags what couldn’t be judged (streaming) |
| Balance | Good | Strengths section prevents “all broken” bias |
| Severity calibration | Weak | Two **High**s overstated; one Med (“overcrowded”) misread |
| Deduping | Weak | Send called out twice; touch targets repeated in a11y |
| Scope hygiene | Mixed | Visual polish mixed with product features (copy/retry/timestamps) |
| Completeness | Adequate for light full-page only | No dark mode, no CAD/PCB side-panel, no empty/busy/error states |

**Verdict on the report:** Usable planning input after severity/scope cleanup. Do **not** treat the original High list as the sprint backlog without the recalibration below.

---

## Finding-by-finding verdict

### Keep (validated)

| ID | Original | Recalibrated sev | Verdict | Rationale |
| --- | --- | --- | --- | --- |
| T1 | Gear icon ambiguous | **Med** | Keep | Gear = Settings mental model; no label in chrome. Real wayfinding bug if target is Status. |
| T2 | “+” hit target tiny | **Med** | Keep | Visibly undersized vs comfortable 36–44px targets. |
| C1 | User vs assistant contrast weak | **Med → Med-High** | Keep, demote from High | Alignment already signals role; gray bubbles are readable but soft. Worth polish, not a broken UI. |
| C2 | Short user pings look imbalanced | **Low** | Keep, demote | Industry-normal; only polish if min-width/padding tuned. |
| D1 | Send low affordance | **Med** (size); enabled contrast **unverified** | Keep, rewrite | Screenshot shows **empty composer → disabled send**. Gray is correct when disabled. Real issues: small target (~30px circle); enabled state not in evidence — must verify with draft text. |
| D2 | `~` path cryptic | **Med** | Keep | At studio home, tilde-only is opaque; human label better. |
| D3 | Meta row competes with typing | **Low–Med** | Keep, slight demote | Strip is quiet; still a second chrome band — soften/de-emphasize, don’t remove usage for power users. |
| A1 | Icon-only discoverability (gear especially) | **Med** | Keep | Overlaps T1; merge in plan. |
| A2 | Touch targets &lt; ~40px (+, send, gear) | **Med** | Keep | Merge with T2/D1 into one “hit targets” work item. |

### Rewrite / merge

| Original | Action |
| --- | --- |
| High: Send gray circle | Split: (a) disabled-when-empty OK; (b) enlarge + strengthen **enabled** send; (c) don’t count empty-state gray as a defect |
| Med: Disabled-looking send must jump when enabled | Merge into D1 — duplicate |
| A11y touch targets + T2 + send size | Single work item: **chrome/composer hit targets ≥36px** |
| Gear ambiguous + a11y icon names | Single work item: **Status affordance (icon + label/tooltip/aria)** |

### Demote, defer, or drop

| Original | Action | Why |
| --- | --- | --- |
| Med: Header overcrowded on the right | **Drop / rewrite → Low** | Bar is mostly empty center; trailing is compact, not crowded. Real issue is **meaning** of gear, not density. |
| Low: No “Agent” product label | **Defer / won’t fix** unless nav confusion shows up | Session-as-title is normal on Agent home; drawer covers IA. |
| Low: Menu OK | **Remove from issues** | Not a finding. |
| Med: No per-message actions | **Defer to product** (P2+) | Valid for coding agent; larger than visual polish. Minimum viable: copy on assistant. |
| Med: No timestamps | **Optional / Low** | Many AI chats omit them; only if long-thread pain is real. |
| Low: Assistant full-bleed vs user max-width | **Accept as design** | Intentional read hierarchy; don’t “fix” unless unifying surfaces. |
| Low: Streaming not in capture | **Audit gap only** | Not a product defect. Plan should include busy/streaming QA. |
| Low: Model/Effort look non-interactive | **Low polish** | Acceptable secondary chrome; optional hover/bg. |
| Low: No attach/@ in dock | **Drop** | Speculative; chips/handoffs exist outside this frame. |

---

## Gaps the original report missed

Worth considering in the polish plan or a follow-up pass:

1. **States not reviewed:** empty session, streaming/busy, error/unavailable, permission bar, side-panel (CAD/PCB), dark theme.
2. **Enabled send + non-empty draft** — must capture before calling send “fixed.”
3. **Long session title truncation** — not stressed in screenshots (title is long but fits).
4. **Focus rings / keyboard** — invisible in static shots.
5. **Composer↔thread boundary** when thread is long (scroll fade, sticky dock) — short thread only.
6. **Usage strip information density** — three metrics is fine; confirm $ and TPS remain secondary to draft.

---

## Calibrated backlog (for planning)

Ordered for an **improvement + polish** pass. Product features separated from visual polish.

### P0 — Visual / operability polish (do in pass)

1. **User bubble identity** — Stronger fill/border so user turns scan without relying only on right-align (C1).
2. **Send control** — Larger hit target; clear enabled vs disabled; verify with non-empty draft (D1).
3. **Hit targets** — New session `+`, send, header icons ≥36px (T2, A2).
4. **Status control clarity** — Replace or label gear so it doesn’t read as Settings (T1, A1).

### P1 — Clarity polish

5. **Path label** — Prefer Home / short name over bare `~` (D2).
6. **Composer meta** — Quieter usage/path hierarchy so draft stays primary (D3).
7. **Short user bubble padding/min treatment** — Optional tighten so one-word pings don’t look like orphans (C2).

### P2 — Product / later (out of pure visual polish unless scoped in)

8. Assistant **copy** (hover/focus).
9. Retry / edit — only if explicitly wanted.
10. Timestamps / turn markers — optional.
11. Model/Effort hover affordance — optional micro-polish.
12. Dark theme + side-panel + busy/error **regression review**.

### Explicit non-goals (this pass)

- Adding an “Agent” title beside session name
- Forcing user/assistant to identical bubble chrome
- Removing usage metrics
- Inventing attach UI without a product need

---

## Severity summary (after calibration)

| Sev | Count | Themes |
| --- | --- | --- |
| High | **0** (was 2) | None blocking; foundation is sound |
| Med | **4–5** | Bubbles, send/targets, Status icon, path label |
| Low | Several | Meta quieting, short pills, secondary chrome |
| Defer | Several | Copy/retry/timestamps, dark/side-panel QA |

---

## Planning implications

1. **Pass type:** Polish + small UX clarity — not a redesign. Keep layout, column, composer structure, session IA.
2. **Success criteria:** Role scan in &lt;1s; send obvious when enabled; Status not confused with Settings; targets comfortable; `~` gone at home.
3. **Evidence loop:** Re-screenshot light full-page (same three crops) + one with draft text (enabled send) + quick dark check if touched tokens.
4. **Risk:** Over-scoping message actions/timestamps will balloon the pass; keep P2 gated.
5. **Original report** stays as historical audit; **this file** is the planning source of truth.

---

## One-line go / no-go

**Go** for a bounded polish pass using the calibrated P0–P1 list; **do not** execute the original recommendations 1–8 verbatim without the demotions and merges above.
