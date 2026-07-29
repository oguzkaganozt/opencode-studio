# Page override — CAD viewer

Overrides MASTER for CAD studio viewer (not host shell).

## Intent
Read-only assembly inspection. Canvas is always dark; chrome is quiet tool UI. CAD amber accent on selection rail / highlight / Prompt when armed only.
**Mobile/phone is first-class** — bottom sheets, 44px targets, safe-area.

## Layout
- Root: `flex-1 min-h-0` under host shell (never `h-full` / restyle `.studio-shell`)
- **Wide (main ≥960px, agent closed):** docked Designs rail + canvas + Parts/Renders
- **Compact tablet (agent open OR main &lt;960, width ≥640):** side sheets (left Designs / right Parts)
- **Phone (width &lt;640):** **bottom sheets** (thumb zone)
- Host sets `data-agent-open` on `.studio-shell` for CAD to observe
- Footer: 32px meta strip + safe-area; long mono note hidden &lt;sm

## Critical interaction rule
- Canvas chrome may use `inert` while a sheet is open.
- **Sheets + scrim must be siblings outside the inert subtree** (never children). Nested `inert` freezes iOS Safari taps inside the sheet.

## Canvas chrome
- Solid dark toolbar panel (`.cad-toolbar`) — no backdrop-blur
- Compact: **design name** · **`N parts`** · **Pick | Region | Select** · (**Face | Rect | Free** when Region) · **Fit** · reload · open
- Wide docked: design id · status · Pick|Region|Select · Face|Rect|Free · Fit · reload/open (Parts via right rail)
- No ⋯ overflow menu — all primary actions are direct toolbar controls
- **Prompt only on surface HUD** when any annotation exists — never permanent toolbar chrome
- Empty: dashed well + Retry / Open .glb / Designs
- HUD: pin + region counts · **Δ** · last detail + **Link** / **Clear / Prompt**; while drawing: loop/W×H hint only
- **Pick**: multi-select (cap 8); mesh snap (`vertex|edge|midpoint|center`) + canvas edge-distance guides (viewer-only); **touch hold+drag** snap reticle; **Link** A→B (max 4); Clear = picks + links
- **Region**: **Face** (default, tap whole face) | **Rect** (planar, live W×H on canvas) | **Free** (loop-close freehand); cap 5; face-split GLB; Clear = regions only
- **Select**: tap region to select (no draw); selected rect → HUD typed W/H (`quality=construction`, center fixed); empty tap deselects
- Prompt = **full** annotation state (pins + regions + measures; `kind=face|rect|freehand`; rect includes `size_mm`/`frame=viewer-plane`)
- Pins + region overlays stay visible together; faces amber; plane regions get fill+outline
- Face data: forge multi-mesh GLB `face_<id>` + optional `topo/`; plane regions include boundary2d
- Fit: resize + bounding-sphere framing; double-rAF after layout settles
- Prompt: `requestAgentHandoff({ copyFallback: true })` for iOS reliability

## Rails / sheets
- Designs: **buttons** (not Links) → navigate + close sheet
- Parts: **pressable rows** with custom check (no native checkbox — iOS reliability)
- Show all / Hide all when ≥2 parts; Badge status on designs
- Bottom sheet: handle, max ~78dvh, safe-area padding, touch scroll (`overscroll-contain`)
- Focus trap: safe restore (skip inert/disconnected); Escape + scrim dismiss

## Keep
- Routes, EventSource, agent handoff, GLB drop/open, fit/reload/copy/prompt
- PART_COLORS for 3D mesh identity
