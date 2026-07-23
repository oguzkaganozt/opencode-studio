# Wall Sconce Rev-A (example project)

Example tscircuit project used to exercise the OpenCode PCB Studio plugin and
viewer. `src/circuit.tsx` is the authoring source; everything under `dist/` is
generated and untracked.

```bash
npm install
npm run build:source      # tsci build → dist/src/circuit/circuit.json
npm run export:schematic  # → dist/schematic.svg
npm run export:pcb        # → dist/pcb.svg
npm run export:gerbers    # → dist/circuit-gerbers.zip
npm run export:kicad      # → dist/circuit-kicad.zip (KiCad review)
```

The plugin runs `npm run build:source` when present, so keep that script name.
