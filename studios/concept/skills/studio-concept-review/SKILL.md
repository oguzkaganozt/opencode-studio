---
name: studio-concept-review
description: >
  Load before concept_review. Industrial-design review of concept.json and
  moodboards: form language, CMF, cliché, weak musts, missing user/context.
  Not for authoring a new concept.
license: proprietary
compatibility: opencode
---

# Concept review

Load this skill immediately before `concept_review`. Read `concept.json` and
the moodboards. Do not edit the concept in this pass.

Walk every item. Submit only structured findings:

- `blocker` — cannot freeze until fixed or explicitly waived
- `weak` — should improve; does not block
- `note` — observation

Check:

1. Intent is a specific product, not a vibe.
2. User and environment are concrete.
3. Musts are testable. Reject empty praise ("beautiful", "premium").
4. Chosen direction has a distinct form language and CMF, not a color swap.
5. Moodboard matches the chosen direction (form + CMF), not a generic product shot.
6. Constraints do not contradict the use (pocket vs 300 mm, sealed vs open ports).

Then call `concept_review` with those findings. Zero findings is a clean pass.
