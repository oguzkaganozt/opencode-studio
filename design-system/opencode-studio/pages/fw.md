# Page override — Firmware viewer

Overrides MASTER for Firmware studio viewer.

## Intent
Project browser + UART console. Emerald accent on rails only. Host shell stays locked.

## Surfaces
- Home: Projects grid, health badges for last build/sim
- Project: crumb + chip/engine + tabs Console · Run · Build · Pins (Pins only when `gpio` is in caps)
- Console is the canvas: last UART log, line select → Fix with agent
- Run: last expect/fail record
- Build: idf.py log
- Pins: empty unless gpio capability; never invent pin state

## Chrome rules
- Accent `#059669` / dark `#34d399` via `--osc-accent-fw`
- Empty/error: dashed EmptyState with short recovery copy
- Agent → `firmware`
