# CAD benchmark — project-box-v0

## Constants (do not change between runs)

- **id:** `project-box-v0`
- **model / flavor:** `xai/grok-4.5` (same every run)
- **agent:** `cad`
- **user prompt:** exact block below (byte-identical)
- **variable later:** tools / skill only

## User prompt

```text
I need a small 3D-printable desk box, about 100 by 70 by 30 mm, walls around 2 mm.

The bottom should have four M2.5 standoffs, a USB cutout on one short side, and a few vents. The lid should press on with no screws.
```

## Run

```bash
bun run bench cad project-box-v0
```

Writes `score.json` in the run dir. Pass requires QC `complete` and a STEP per part. Artifacts copy to `runs/<run>/studio/`.

Keep prior run dirs; each run is a new timestamped folder.
