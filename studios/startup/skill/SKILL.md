---
name: startup-studio
description: Mine, research, paper-evaluate, and manage SaaS idea candidates with opencode-studio tools and the pool viewer. Use for idea discovery, evidence checks, and desk evaluation — not product builds or ads.
license: MIT
compatibility: opencode
metadata:
  workflow: idea-research-eval
---

# Startup Studio — Idea Research & Paper Eval

You run **deliberate research sessions**, not a continuous mining motor. Goal: a small pool of high-quality, evidence-backed candidates the founder can browse in the companion viewer.

## Hard boundaries

- **In scope:** territory scan, web research, evidence, paper evaluation, pool write, reject.
- **Out of scope:** smoke ads, landing builds, Stripe, product code, promote/lifecycle gates, auto batch mine.
- **No hallucinated evidence.** Every claim needs a real URL you fetched or searched.
- **Session cap:** default max **3 new candidates** per session unless the user asks for more.
- Companion viewer is **read-only**. Never tell the user to edit via the UI.

## Tools

| Tool | Use |
|------|-----|
| `startup_status` | Pool/rejects snapshot before/after |
| `startup_list` | Browse pool (filters: minTotal, signalClass, verdict) |
| `startup_read` | Full candidate |
| `startup_check_evidence` | HTTP liveness of URLs (`name` and/or `urls_json`) — no LLM |
| `startup_upsert` | Create/replace pool entry (edit permission on `pool.json`) |
| `startup_reject` | Move pool → rejects with reason |
| `startup_view` | Companion URL + health |

Data Root holds `pool.json` and `rejects.json` only. No portfolio, no ideas markdown lifecycle.

## Pre-screen filter (must pass before upsert)

1. Instant/zero-install value (no prod access, no security review to try)
2. Credit-card buyer: SMB team or developer
3. Public demand proof (complaints and/or money already spent on half-solutions)
4. Weekly+ natural usage rhythm (not rare-event value)
5. Sellable V0 in 1–2 weeks with an agent team
6. **Distribution shelf** the buyer already walks: marketplace, high-intent search, or active niche community. No shelf → no candidate.

## Signal classes

- **A — served but bleeding:** paid products with 1–3★ patterns, long-open feature requests, "X alternative" demand.
- **B — unserved pain:** workaround recipes, repeated micro-jobs for hire, new shelf openings.

Aim for balance; do not flood the pool with only one class.

## Session pipeline

### 0. Orient

1. Call `startup_status` and skim top names so you do not re-propose rejects/duplicates.
2. Agree territory + angle with the user (or take their brief).

### 1. Research

Use OpenCode web/search/fetch tools. Prefer primary sources: issue trackers, review sites, official docs, marketplaces, forums with dates and engagement.

For each promising pain, collect **1–4 evidence** items: `{ url, summary, date?, engagement? }`.

### 2. Draft fields

- `name` — kebab-case slug
- `problem`, `buyer`, `shelf`, `signal_class`
- `one_liner` — short founder-facing line (EN or TR as user prefers)
- `batch` — e.g. `session-YYYY-MM-DD`

### 3. Evidence gate

Call `startup_check_evidence` with the URLs (or upsert then check by `name`).

- All dead → drop or find replacements; do not upsert dead-only candidates.
- Partial live → keep live links only; verdict at most `partial`.

### 4. Paper evaluate + score

Rubric each **0–2** (integers or halves ok if honest):

| Key | Meaning |
|-----|---------|
| pain | Severity / frequency of the pain |
| payment | Proof people pay today (or clear willingness) |
| shelf | Strength/access of distribution shelf |
| freshness | Recent signal (prefer last 12–24 months) |
| fit | Zero-install + agent-buildable V0 + CC buyer |

`total` = sum (0–10). Optional `evaluation`: `{ pros, cons, risks, recommendation, updated_at }`.

Verdict:

- `verified` — live evidence supports the core claim
- `partial` — some support, gaps remain
- `unverified` — should not normally enter the pool

### 5. Persist

`startup_upsert` with full fields. `evidence_json` and `rubric_json` are JSON strings.

If the idea fails the filter or is a dead end worth remembering: `startup_reject` with a clear reason (from pool if present).

### 6. Show

`startup_view` with optional `name` for a deep link. Tell the founder to open the companion (read-only).

## Companion

```text
opencode-studio serve --workspace /absolute/path/to/workspace
```

Default dogfood root in this package: `./workspace` (port **4190**).

## Anti-patterns

- Running endless research to grow pool size instead of improving top candidates
- Upserting without `startup_check_evidence`
- Inventing blog domains or metrics
- Starting build/smoke work from this skill
- Treating high `total` as a launch order — founder decides next steps outside this studio
