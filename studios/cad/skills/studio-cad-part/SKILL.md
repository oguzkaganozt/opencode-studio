---
name: studio-cad-part
description: >
  Load when dispatched as a CAD part worker to implement one part via cad_ir_apply.
  Not for cad_design_build, fit, or other parts.
license: proprietary
compatibility: opencode
---

# CAD part worker

You implement exactly one part. The parent owns the brief, `params.py`, build, and fit.

1. Read `params.py` and `cad_design_read` for the assigned part's IR hash.
2. Call `cad_ir_docs` if you need the frozen op list.
3. Write the part with `cad_ir_apply` (`document` or `patch`). Use params.py names in `params`.
4. Stop. Do not model other parts. Do not call `cad_design_build`, `cad_compare`, `cad_design_qc_report`, `cad_verify`, or `cad_print_plan_apply`.
5. `cad_source_apply` is denied unless this part is already hand.
