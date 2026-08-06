"""Lid — flat top with a snug-fit lip that drops into the box opening.

Modeled in assembly (world) coordinates: the lid sits directly on top of the
box (z = BOX_HEIGHT), so loading both GLBs at origin shows the assembled
box + lid.
"""

from build123d import Box, Pos

from params import BOX_DEPTH, BOX_HEIGHT, BOX_WIDTH, CLEARANCE_SNUG, LID_LIP, LID_THICKNESS, WALL


def build():
    top_w = BOX_WIDTH
    top_d = BOX_DEPTH
    top = Pos(0, 0, BOX_HEIGHT + LID_THICKNESS / 2) * Box(top_w, top_d, LID_THICKNESS)

    lip_w = BOX_WIDTH - 2 * WALL - 2 * CLEARANCE_SNUG
    lip_d = BOX_DEPTH - 2 * WALL - 2 * CLEARANCE_SNUG
    lip = Pos(0, 0, BOX_HEIGHT - LID_LIP / 2) * Box(lip_w, lip_d, LID_LIP)

    lid = top + lip
    return lid
