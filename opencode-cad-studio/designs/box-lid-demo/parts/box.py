"""Box body — hollow shell with an open top.

Modeled in assembly (world) coordinates: the box sits on the XY plane (z=0)
with its outer footprint centered at the origin. When the GLB is loaded at
(0,0,0) the lid (modeled in lid.py) sits on top to form the assembly.
"""

from build123d import Pos, Rectangle, extrude

from params import BOX_DEPTH, BOX_HEIGHT, BOX_WIDTH, EPS, WALL


def build():
    outer = Pos(0, 0, 0) * extrude(Rectangle(BOX_WIDTH, BOX_DEPTH), amount=BOX_HEIGHT)

    cavity_w = BOX_WIDTH - 2 * WALL
    cavity_d = BOX_DEPTH - 2 * WALL
    cavity_h = BOX_HEIGHT - WALL
    cavity = Pos(0, 0, WALL) * extrude(
        Rectangle(cavity_w, cavity_d),
        amount=cavity_h + EPS,
    )

    box = outer - cavity
    return box
