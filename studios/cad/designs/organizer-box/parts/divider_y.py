"""Divider Y — long divider with a bottom half-notch at the center.

Assembly coordinates: centered at origin, sits inside body cavity from z=WALL up.
The bottom notch interlocks with divider-x's complementary top notch.
"""

from build123d import Box, Pos

from params import BOX_D, CLEARANCE, DIVIDER_H, DIVIDER_T, EPS, WALL


def build():
    inner_d = BOX_D - 2 * WALL - 2 * CLEARANCE
    full = Pos(0, 0, WALL + DIVIDER_H / 2) * Box(DIVIDER_T, inner_d, DIVIDER_H)
    notch_h = DIVIDER_H / 2 + EPS
    notch = Pos(0, 0, WALL + notch_h / 2) * Box(DIVIDER_T + 2 * EPS, DIVIDER_T + 2 * EPS, notch_h)
    return full - notch
