# Page override — CAD viewer

Overrides MASTER for CAD studio viewer (not host shell).

## Intent
Read-only assembly inspection. Canvas is always dark; chrome is quiet tool UI. CAD amber accent on selection rail / highlight only.

## Layout
- Root: `flex-1 min-h-0` under host shell (never `h-full` / restyle `.studio-shell`)
- **Wide (main ≥960px, agent closed):** docked Designs rail + canvas + Parts/Renders
- **Compact (agent open OR main <960px):** docked rails hide; canvas full-width; toolbar **Designs** / **Parts** open overlay sheets
- Host sets `data-agent-open` on `.studio-shell` for CAD to observe
- Footer: 32px meta strip

## Canvas chrome
- Solid dark panels (`rgba` black ~0.82–0.88), **no backdrop-blur**
- Radius md (tool), not full pills
- Status: success/warning tokens, not neon
- Click readout: mono + accent/warning tokens (not raw amber Tailwind)

## Keep
- Routes, EventSource, agent handoff, GLB drop/open, fit/reload/copy/prompt
- PART_COLORS for 3D mesh identity
