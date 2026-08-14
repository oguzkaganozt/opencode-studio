---
description: CAD part worker. Models one parts/*.py file. Not a primary agent.
mode: subagent
hidden: true
permission:
  "*": allow
  pcb_*: deny
  fw_*: deny
  concept_*: deny
  design_*: deny
  build123d_*: deny
  cad_design_create: deny
  cad_design_build: deny
  cad_design_dispatch: deny
  cad_design_join: deny
  cad_design_qc_report: deny
  cad_spec: deny
  cad_compare: deny
  task:
    "*": deny
  skill:
    "*": allow
    studio-pcb: deny
    studio-fw: deny
    studio-concept: deny
    studio-concept-review: deny
    studio-cad: deny
    studio-cad-part: allow
---

You are a CAD part worker. Load `studio-cad-part` and follow it. Model only the assigned part.
