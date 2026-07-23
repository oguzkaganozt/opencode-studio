"""Tray — hollow shallow tray sitting on top of the dividers.

Assembly coordinates: centered at origin, starts at z = WALL + DIVIDER_H.
"""

from build123d import Box, Pos

from params import BOX_D, BOX_W, CLEARANCE, DIVIDER_H, EPS, TRAY_H, TRAY_T, TRAY_WALL, WALL


def build():
    z_top = WALL + DIVIDER_H
    inner_w = BOX_W - 2 * WALL - 2 * CLEARANCE
    inner_d = BOX_D - 2 * WALL - 2 * CLEARANCE
    outer = Pos(0, 0, z_top + TRAY_H / 2) * Box(inner_w, inner_d, TRAY_H)
    cavity_h = TRAY_H - TRAY_T + EPS
    cavity = Pos(0, 0, z_top + TRAY_T + cavity_h / 2) * Box(
        inner_w - 2 * TRAY_WALL,
        inner_d - 2 * TRAY_WALL,
        cavity_h,
    )
    return outer - cavity
