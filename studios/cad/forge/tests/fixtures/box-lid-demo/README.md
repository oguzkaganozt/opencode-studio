# box-lid-demo

Minimal 2-part FDM assembly used as the forge unit-test fixture (`test_examples.py`).

## Parts

- `box` — hollow shell with open top, modeled at z=0.
- `lid` — flat top with snug-fit lip, modeled at z=BOX_HEIGHT (assembly position).

Both parts are modeled in assembly (world) coordinates. Loading both GLBs at
origin shows the assembled box + lid.

## Print orientation

- `box`: print open-top down (flip on Z) so the cavity overhangs are ≤45°.
- `lid`: print flat-side down.

## Hardware

None — snug press fit (0.15mm clearance per side).
