"""Divider X — long divider with a top half-notch at the center.

Assembly coordinates: centered at origin, sits inside body cavity from z=WALL up.
The top notch interlocks with divider-y's complementary bottom notch.
"""

from build123d import Box, Pos

from params import BOX_W, CLEARANCE, DIVIDER_H, DIVIDER_T, EPS, WALL


def build():
    inner_w = BOX_W - 2 * WALL - 2 * CLEARANCE
    full = Pos(0, 0, WALL + DIVIDER_H / 2) * Box(inner_w, DIVIDER_T, DIVIDER_H)
    notch_h = DIVIDER_H / 2 + EPS
    notch = Pos(0, 0, WALL + DIVIDER_H - notch_h / 2) * Box(DIVIDER_T + 2 * EPS, DIVIDER_T + 2 * EPS, notch_h)
    return full - notch
