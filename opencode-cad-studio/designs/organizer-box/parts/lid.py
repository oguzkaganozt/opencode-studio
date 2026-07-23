"""Lid — flat top with snug-fit lip dropping into the body opening.

Assembly coordinates: sits on top of body at z = BOX_H.
"""

from build123d import Box, Pos

from params import BOX_D, BOX_H, BOX_W, CLEARANCE, LID_LIP, LID_T, WALL


def build():
    inner_w = BOX_W - 2 * WALL - 2 * CLEARANCE
    inner_d = BOX_D - 2 * WALL - 2 * CLEARANCE
    top = Pos(0, 0, BOX_H + LID_T / 2) * Box(BOX_W, BOX_D, LID_T)
    lip = Pos(0, 0, BOX_H - LID_LIP / 2) * Box(inner_w - 2 * LID_LIP, inner_d - 2 * LID_LIP, LID_LIP)
    return top + lip
