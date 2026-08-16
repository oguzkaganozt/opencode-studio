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

Create design "project-box-v0" with cad_design_create and this exact locked acceptance contract (the host pins its hash):

{"schema":1,"state":"locked","authority":"harness","manufacturing":{"process":"fdm","buildVolumeMm":[220,220,250],"nozzleMm":0.4,"minimumWallMm":1.2,"bedToleranceMm":0.1,"defaultClearanceMm":0.2},"dimensions":[{"id":"body-x","kind":"bbox","artifactId":"body","measure":"size","axis":"X","targetMm":100,"toleranceMm":5},{"id":"body-y","kind":"bbox","artifactId":"body","measure":"size","axis":"Y","targetMm":70,"toleranceMm":5},{"id":"body-z","kind":"bbox","artifactId":"body","measure":"size","axis":"Z","targetMm":30,"toleranceMm":4},{"id":"lid-x","kind":"bbox","artifactId":"lid","measure":"size","axis":"X","targetMm":100,"toleranceMm":5},{"id":"lid-y","kind":"bbox","artifactId":"lid","measure":"size","axis":"Y","targetMm":70,"toleranceMm":5}],"interfaces":[{"id":"body-lid","a":"body","b":"lid","fit":"clearance","targetMm":0.2,"toleranceMm":0.3}]}

Parts: body (qty 1) and lid (qty 1). Then model both, cad_design_build, cad_print_plan_apply, cad_verify requirements/printability/interfaces, and cad_design_qc_report. The bench scores disk evidence, not claims.
```

## Run

```bash
bun run bench cad project-box-v0
```

Writes `score.json` in the run dir. Pass requires the disk scorer: expected design id `project-box-v0` with parts body+lid, locked acceptance hash matching `project-box-v0.acceptance.json`, current print plan covering both artifacts, host-complete QC recomputed from disk, and no unresolved findings. Artifacts copy to `runs/<run>/studio/`.

Keep prior run dirs; each run is a new timestamped folder.
