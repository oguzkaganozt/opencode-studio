"""Canonical outer envelope used to generate the benchmark reference views."""

from build123d import Align, Box, Ellipse, Plane, loft


STATIONS = (
    (-56.0, 10.0, 8.0, 0.0),
    (-44.0, 42.0, 22.0, -1.0),
    (-18.0, 66.0, 36.0, -4.0),
    (12.0, 68.0, 38.0, -5.0),
    (38.0, 52.0, 28.0, -2.0),
    (54.0, 18.0, 12.0, 1.0),
    (56.0, 6.0, 6.0, 0.0),
)


def build():
    sections = []
    for x, width, height, y_offset in STATIONS:
        plane = Plane(origin=(x, y_offset, height / 2), x_dir=(0, 1, 0), z_dir=(1, 0, 0))
        sections.append(plane * Ellipse(width / 2, height / 2))
    envelope = loft(sections)
    return envelope & Box(120, 80, 40, align=(Align.CENTER, Align.CENTER, Align.MIN))
