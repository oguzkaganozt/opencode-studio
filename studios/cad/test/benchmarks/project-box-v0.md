# CAD benchmark — project-box-v0

## Constants (do not change between runs)

- **id:** `project-box-v0`
- **model / flavor:** `xai/grok-4.5` (same every run)
- **agent:** `studio-cad`
- **user prompt:** exact block below (byte-identical)
- **variable later:** tools / skill only

## User prompt

```text
Small desk project box, outer ~100×70×30 mm, walls ~2 mm.

Bottom: four M2.5 standoffs on ~80×50 mm, USB cutout (~12×8) on one short side, a few side vents.
Lid: snug press-fit, no screws.
```

## Run (line-flushed logs)

```bash
./studios/cad/test/benchmarks/run-bench.sh \
  --name project-box-v0 \
  --model xai/grok-4.5 \
  --dir "$HOME" \
  "$(sed -n '/^```text$/,/^```$/p' studios/cad/test/benchmarks/project-box-v0.md | sed '1d;$d')"
```

## Score (after run)

```bash
python3 studios/cad/test/benchmarks/score-run.py \
  studios/cad/test/benchmarks/runs/<run_dir>
```

Writes `score.json` in the run dir. Checks:

- `cad_design_qc_report.complete`
- build artifacts (STEP per part)
- `cad_compare kind=fit` used; prefer `gap_verified` pass (seat-only `unverified` is weaker)
- printability evidence
- wall time / tool-call / token counts

Keep prior run dirs; each run is a new timestamped folder.
