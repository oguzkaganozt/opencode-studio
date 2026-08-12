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

Tall frosted diffuser panel, stone-look base block at the bottom, thin brass edge trim and a small brass foot. Something around 300 mm tall, printable in a few separate parts that fit together. No real electronics — just the housing forms.
```

## Why this is harder than project-box-v0

- Reference form (front/side silhouette, proportions) — not pure prismatic box
- Multi-material look → multi-part split (diffuser / base / trim)
- Fit between parts + wall-mountable back
- Form axis is real (not `not applicable`)

## Run (line-flushed logs + image)

```bash
./studios/cad/test/benchmarks/run-bench.sh \
  --name wall-sconce-v0 \
  --model xai/grok-4.5 \
  --dir "$HOME" \
  --file studios/cad/test/benchmarks/wall-sconce-frosted-glass.png \
  "$(sed -n '/^```text$/,/^```$/p' studios/cad/test/benchmarks/wall-sconce-v0.md | sed '1d;$d')"
```

## Score (after run)

```bash
python3 studios/cad/test/benchmarks/score-run.py \
  studios/cad/test/benchmarks/runs/<run_dir>
```

Also judge manually / from renders:

- parts ≥ 2 (ideally diffuser + base + trim)
- overall height ~250–350 mm class
- frosted panel reads as thin shell/plate, not a solid brick
- base is distinct lower mass; brass bits separate or clearly split
- `complete: true` if claimed
- form findings substantive (not bare `not applicable` unless agent wrongly classifies prismatic)
- wall time / tokens / execute fails
