# CAD benchmark — wall-sconce-v0

Harder tier: visual reference + multi-part wall light (form fidelity matters).

## Constants (do not change between runs)

- **id:** `wall-sconce-v0`
- **model / flavor:** `xai/grok-4.5` (same every run)
- **agent:** `studio-cad`
- **reference image:** `studios/cad/test/benchmarks/wall-sconce-frosted-glass.png` (attach with `--file`)
- **user prompt:** exact block below (byte-identical)
- **variable later:** tools / skill only

## User prompt

```text
I want a wall sconce like the attached photo.

Tall frosted panel, stone-look base, thin brass trim and a small brass foot. Around 300 mm tall. A few printable parts that fit together. Just the housing — no electronics.
```

## Why this is harder than project-box-v0

- Reference form (front/side silhouette, proportions) — not pure prismatic box
- Multi-material look → multi-part split (diffuser / base / trim)
- Fit between parts + wall-mountable back
- Form axis is real (not `not applicable`)

## Run

```bash
bun run bench cad wall-sconce-v0
```

Also judge from `runs/<run>/studio/designs/` renders:

- parts ≥ 2 (ideally diffuser + base + trim)
- overall height ~250–350 mm class
- frosted panel reads as thin shell/plate, not a solid brick
- base is distinct lower mass; brass bits separate or clearly split
- `complete: true` if claimed
- freeform: `cad_analyze_form` contract pass (not notes-only); prismatic mis-classify as N/A is a fail
- wall time / tokens / execute fails
