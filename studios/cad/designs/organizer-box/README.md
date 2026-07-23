# organizer-box

5-part FDM assembly — a modular organizer box with dividers and a removable tray.

## Parts

- `body` — hollow shell with open top, modeled at z=0.
- `divider-x` — long divider running along X (thin in Y), sits inside body at z=WALL.
- `divider-y` — long divider running along Y (thin in X), notched at center to interlock with divider-x.
- `tray` — hollow shallow tray sitting directly on top of the dividers.
- `lid` — flat top with snug-fit lip, sits at z=BOX_H.

All parts modeled in assembly (world) coordinates. Loading all GLBs at origin shows the assembled organizer.

## Phase 2 QC checks

- `interference(divider-x, divider-y)` — should be zero (divider-y is notched).
- `clearance(body, divider-x)` — snug fit (0.2mm per side).
- `clearance(body, divider-y)` — snug fit (0.2mm per side).
- `clearance(divider-x, tray)` — tray sits on top, should not interfere.
- `clearance(body, lid)` — snug fit (0.2mm per side).

## Print orientation

- `body`: print open-top down (flip on Z).
- `divider-x`, `divider-y`: print flat (thin dimension up, supports may be needed for notch).
- `tray`: print open-side up.
- `lid`: print flat-side down.

## Hardware

None — all snug press-fit (0.2mm clearance).
