# CAD benchmark — speaker-organic-v0

Hardest tier: visual reference + multi-part + **organic shell** (form fidelity required).

## Constants (do not change between runs)

- **id:** `speaker-organic-v0`
- **model / flavor:** `xai/grok-4.5` (same every run)
- **agent:** `studio-cad`
- **reference image:** `studios/cad/test/benchmarks/speaker-gold-cones.png` (attach with `--file`)
- **user prompt:** exact block below (byte-identical)
- **variable later:** tools / skill only

## User prompt

```text
I want a speaker like the attached photo.

Organic curved stone-look shell, two gold driver cones on a dark face plate, thin brass foot rail. About 50 cm wide, 30 cm tall, 20 cm deep. Split into printable parts that fit together. Housing only — no real electronics or LEDs.
```

## Why this is hardest

- Manufactured freeform envelope (changing silhouette / loft-class body)
- Multi-part: shell + baffle/plate + drivers (+ rail)
- Fit between organic shell and face plate / drivers
- Form axis is real — not prismatic `not applicable`
- Reference image drives proportions and character

## Run (line-flushed logs + image)

```bash
./studios/cad/test/benchmarks/run-bench.sh \
  --name speaker-organic-v0 \
  --model xai/grok-4.5 \
  --dir "$HOME" \
  --file studios/cad/test/benchmarks/speaker-gold-cones.png \
  "$(sed -n '/^```text$/,/^```$/p' studios/cad/test/benchmarks/speaker-organic-v0.md | sed '1d;$d')"
```

## Score (after run)

```bash
python3 studios/cad/test/benchmarks/score-run.py \
  studios/cad/test/benchmarks/runs/<run_dir>
```

Also judge from renders / STL:

- outer envelope is curved/organic, not a filleted box
- dual driver layout readable on front
- multi-part assembly with real openings (not solid decorative block)
- `cad_analyze_form` with numeric contract (stations); form pass from evidence, not notes-only
- optional `cad_form_review` for visual feedback (does not unlock form pass)
- `complete: true` if claimed
- wall time / tokens / execute fails
