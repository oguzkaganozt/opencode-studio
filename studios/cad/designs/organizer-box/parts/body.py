"""Body — hollow shell with open top.

Assembly coordinates: base sits on XY plane (z=0), outer footprint centered at origin.
"""

from build123d import Pos, Rectangle, extrude

from params import BOX_D, BOX_H, BOX_W, EPS, WALL


def build():
    outer = extrude(Rectangle(BOX_W, BOX_D), amount=BOX_H)
    cavity = Pos(0, 0, WALL) * extrude(
        Rectangle(BOX_W - 2 * WALL, BOX_D - 2 * WALL),
        amount=BOX_H - WALL + EPS,
    )
    return outer - cavity
