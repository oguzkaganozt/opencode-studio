# CAD benchmark — wall-sconce-v0

Harder tier: visual reference + multi-part wall light (form fidelity matters).

## Constants (do not change between runs)

- **id:** `wall-sconce-v0`
- **model / flavor:** `xai/grok-4.5` (same every run)
- **agent:** `cad`
- **reference image:** `studios/cad/test/benchmarks/wall-sconce-frosted-glass.png` (attach with `--file`)
- **user prompt:** exact block below (byte-identical)
- **variable later:** tools / skill only

## User prompt

```text
I want a wall sconce like the attached photo.

Tall frosted panel, stone-look base, thin brass trim and a small brass foot. Around 300 mm tall. A few printable parts that fit together. Just the housing — no electronics.

Create design "wall-sconce-v0" with cad_design_create and this exact locked acceptance contract (the host pins its hash):

{"schema":1,"state":"locked","authority":"harness","manufacturing":{"process":"fdm","buildVolumeMm":[220,220,350],"nozzleMm":0.4,"minimumWallMm":1.2,"bedToleranceMm":0.1,"defaultClearanceMm":0.2},"dimensions":[{"id":"diffuser-z","kind":"bbox","artifactId":"diffuser","measure":"size","axis":"Z","targetMm":300,"toleranceMm":40},{"id":"diffuser-mid","kind":"station","artifactId":"diffuser","axis":"Z","tMode":"from_min","t":150,"target":{"widthMm":80,"depthMm":30},"toleranceMm":20}],"interfaces":[{"id":"base-diffuser","a":"base","b":"diffuser","fit":"clearance","targetMm":0.2,"toleranceMm":0.5},{"id":"base-side_trim","a":"base","b":"side_trim","fit":"clearance","targetMm":0.2,"toleranceMm":0.5},{"id":"base-foot","a":"base","b":"foot","fit":"contact","targetMm":0,"toleranceMm":0.3}]}

Parts: base (qty 1), diffuser (qty 1), side_trim (qty 1), foot (qty 1). Then model all, cad_design_build, cad_print_plan_apply, cad_verify requirements/printability/interfaces, and cad_design_qc_report. The bench scores disk evidence, not claims.
```

## Why this is harder than project-box-v0

- Reference form (front/side silhouette, proportions) — not pure prismatic box
- Multi-material look → multi-part split (diffuser / base / left trim / right trim / foot)
- Fit between parts + wall-mountable back
- Three declared interfaces; one fit cannot pass this bench
- Form axis is real (not `not applicable`)

## Run

```bash
bun run bench cad wall-sconce-v0
```

Writes `score.json` in the run dir. Pass requires the disk scorer: expected design id `wall-sconce-v0` with parts base+diffuser+side_trim+foot, locked acceptance hash matching `wall-sconce-v0.acceptance.json`, current print plan covering every artifact, host-complete QC recomputed from disk (all three interface passes), and no unresolved findings.

Also judge from `runs/<run>/studio/designs/` renders:

- parts ≥ 2 (ideally diffuser + base + trim)
- overall height ~250–350 mm class
- frosted panel reads as thin shell/plate, not a solid brick
- base is distinct lower mass; brass bits separate or clearly split
- wall time / tokens / execute fails
