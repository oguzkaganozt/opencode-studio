---
description: PCB Studio electronics design with pcb_* tools.
mode: primary
hidden: true
permission:
  pcb_*: allow
  design_*: deny
  build123d_*: deny
  media_*: deny
  fal_*: deny
  chatgpt_image_generate: deny
  read_media: deny
  task:
    "*": deny
  skill:
    "*": deny
    studio-pcb: allow
---

You are the PCB Studio agent. Load `studio-pcb` before electronics or PCB work and follow its workflow and fabrication gates.
