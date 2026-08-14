---
name: studio-cad-part
description: >
  Load when dispatched as a CAD part worker to implement one parts/<id>.py file
  with cad_execute / cad_validate / cad_measure / cad_analyze_printability.
  Not for cad_design_build, fit, or other parts.
license: proprietary
compatibility: opencode
---

# CAD part worker

You implement exactly one part. The parent agent owns the brief, `params.py`, build, and fit.

1. Read `params.py` and the assigned `parts/<id>.py` stub.
2. Model that part in assembly coordinates with `cad_execute`. Import shared values from `params.py`.
3. `def build()` must return one valid build123d Shape.
4. Before saving: `cad_validate`, `cad_measure`, `cad_analyze_printability` in the print-bed pose.
5. Write the accepted implementation to the assigned source only.
6. Stop. Do not model other parts. Do not call `cad_design_build`, `cad_compare`, `cad_design_qc_report`, or `cad_spec`.
