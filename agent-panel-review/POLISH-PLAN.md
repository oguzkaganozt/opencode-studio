# Agent Panel polish plan (applied)

Source: calibrated evaluation of UI review. Send / meta strip / width asymmetry / message copy / empty session / code-block copy are out of scope.

## P0 — visual / operability

| Problem | Solution | Status |
| --- | --- | --- |
| User bubble weak | Stronger fill/border | Done |
| Gear reads as Settings | Status check icon + existing Status label | Done |
| Tiny hit targets | Icon / + controls ≥36px; header min-height 52px | Done |
| Bare `~` path | `Home` at studio root | Done |
| Focus inconsistent | Shared `--osc-focus-ring` on agent chrome | Done |

## P1 — behavior

| Problem | Solution | Status |
| --- | --- | --- |
| Busy/stream unclear | Thread “Working…” live chip while busy | Done |
| Scrolled up during stream | “Latest” jump chip when not near bottom | Done |
| Error easy to miss | Stronger error band + Retry (health/runtime/sessions) | Done |

## P2 — light

| Problem | Solution | Status |
| --- | --- | --- |
| Permission looks ordinary | Kicker “Permission required” + stronger band | Done |
| Very long user message | Clamp + Show more / Show less | Done |
| Side panel / dark | Shared styles only; no chrome parity rewrite | QA on touch |

## Dropped

- Session search “discovery” (already present)
- Model hover (already present)
- Full side-panel ↔ full-page chrome equalization
