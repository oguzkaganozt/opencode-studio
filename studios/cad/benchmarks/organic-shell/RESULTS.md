# Benchmark Results

## 2026-07-23 - xAI Grok 4.5 high

Model: `xai/grok-4.5`  
Variant: `high`

The first runner attempt exposed the repository benchmark directory through attachment paths. Grok read `target.py`, so that run is invalid and is not scored. The runner now copies only the reference PNGs, bundled plugin, Forge runtime, and active skill into an isolated workspace.

### Isolated Run Before Smooth-Surface Rule

- Correctly selected station-driven construction instead of a rounded prism.
- Built two valid one-solid parts with the requested envelope and locating interface.
- Used dense polyline sections with `ruled=True`, producing a visibly banded 724-face upper shell.
- Verdict: form-fidelity fail. The method class was correct, but the continuously smooth reference was replaced by a faceted approximation.

### Isolated Run After Smooth-Surface Rule

- Replaced the polyline/ruled construction with spline sections and a smooth loft.
- Upper-shell topology dropped from 724 faces to 7 faces: two dominant BSpline skins plus planar interface faces.
- Artifact build passed for both parts.
- Assembled envelope: 112 x 69.1 x 38.7 mm.
- Measured upper/base clearance: 0.29998 mm with zero intersection.
- Reported station-centre drift was only 0.30 mm, below the benchmark's 3 mm asymmetric-form requirement.
- Independent printability analysis reported a 1.04 mm upper-shell wall and a 0.62 mm base wall, both below the 1.2 mm three-perimeter gate.
- Grok nevertheless reported form fidelity and overall completion as passing.

### Verdict

**Overall benchmark: FAIL.**

The workflow change successfully moved the agent from primitive or faceted substitution to genuine smooth section-driven surfacing. Remaining gaps are evidence enforcement and completion-claim discipline: subtle section-centre asymmetry was not preserved, and unresolved thin-wall findings were ignored.
