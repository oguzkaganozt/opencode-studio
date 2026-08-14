# CAD benchmark — speaker-organic-v0

Hardest tier: visual reference + multi-part + **organic shell** (form fidelity required).

## Constants (do not change between runs)

- **id:** `speaker-organic-v0`
- **model / flavor:** `xai/grok-4.5` (same every run)
- **agent:** `cad`
- **reference image:** `studios/cad/test/benchmarks/speaker-gold-cones.png` (attach with `--file`)
- **user prompt:** exact block below (byte-identical)
- **variable later:** tools / skill only

## User prompt

```text
I want a speaker like the attached photo.

Curved stone-look shell, two gold cones on a dark face, thin brass foot rail. About 50 by 30 by 20 cm. Printable parts that fit together. Just the housing — no electronics.
```

## Why this is hardest

- Manufactured freeform envelope (changing silhouette / loft-class body)
- Multi-part: shell + baffle/plate + drivers (+ rail)
- Fit between organic shell and face plate / drivers
- Form axis is real — not prismatic `not applicable`
- Reference image drives proportions and character

## Run

```bash
bun run bench cad speaker-organic-v0
```

Also judge from `runs/<run>/studio/designs/` renders / STL:

- outer envelope is curved/organic, not a filleted box
- dual driver layout readable on front
- multi-part assembly with real openings (not solid decorative block)
- `cad_analyze_form` with numeric contract (stations); form pass from evidence, not notes-only
- optional `cad_form_review` for visual feedback (does not unlock form pass)
- `complete: true` if claimed
- wall time / tokens / execute fails
