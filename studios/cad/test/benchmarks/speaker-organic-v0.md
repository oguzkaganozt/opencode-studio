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

Create design "speaker-organic-v0" with cad_design_create and this exact locked acceptance contract (the host pins its hash):

{"schema":1,"state":"locked","authority":"harness","manufacturing":{"process":"fdm","buildVolumeMm":[300,300,350],"nozzleMm":0.4,"minimumWallMm":1.2,"bedToleranceMm":0.1,"defaultClearanceMm":0.2},"dimensions":[{"id":"shell-x","kind":"bbox","artifactId":"shell_l","measure":"size","axis":"X","targetMm":175,"toleranceMm":25},{"id":"shell-y","kind":"bbox","artifactId":"shell_l","measure":"size","axis":"Y","targetMm":265,"toleranceMm":30}],"interfaces":[{"id":"shell-baffle","a":"shell_l","b":"baffle","fit":"clearance","targetMm":0.2,"toleranceMm":0.5},{"id":"shell-rail","a":"shell_l","b":"foot_rail","fit":"clearance","targetMm":0.2,"toleranceMm":0.5}]}

Parts: shell_l (qty 1), shell_r (qty 1), baffle (qty 1), foot_rail (qty 1), cone (qty 2). Then model all, cad_design_build, cad_print_plan_apply, cad_verify requirements/printability/interfaces, and cad_design_qc_report. The bench scores disk evidence, not claims.
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
- `cad_analyze_form` with numeric contract (stations) is diagnostic; v1 QC gates on the locked contract dimensions, printability, and interfaces
- `complete: true` if claimed
- wall time / tokens / execute fails
