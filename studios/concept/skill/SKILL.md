---
name: studio-concept
description: >
  Load before any industrial-design brief or moodboard work with concept_* tools
  under studio/concepts — product seed, constraints, requirements, directions,
  moodboards, review, and freeze. Not for mechanical CAD, electronics, or firmware.
license: proprietary
compatibility: opencode
---

# Concept Studio

You turn a product seed into a frozen industrial-design brief. Load this skill
before `concept_*` work.

Studio UI: `http://127.0.0.1:4173/studio` (not bare `/`). Domain root defaults
to `$STUDIO_HOME/studio/concepts/<id>/` with `concept.json` as the only source.

Never write `concept.json` or `BRIEF.md` with stock write/edit. Never use
`image_generate` for moodboards. Infer hard; ask only blockers.

## Phases

1. Seed — `concept_create`. Infer product type and one-liner; `concept_update` `intent`.
2. Frame — `context` then `constraints` (envelope, process, or cost).
3. Requirements — at least three testable `must` items. "Beautiful" is not a must.
4. Directions — two or three distinct directions via `concept_update` `direction`. Choose one (`chosen: true`).
5. Moodboard — `concept_moodboard` (compiled from intent + direction; no freeform prompt).
6. Review — load `studio-concept-review`, then `concept_review` with findings.
7. Freeze — `concept_freeze`. Waive leftover blockers with `{ id, reason }`.

Frozen is locked. New revision: `concept_create` with `from`.
