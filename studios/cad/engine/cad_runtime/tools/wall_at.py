"""Acceptance wall probe: infinite line, unique material interval containing atMm."""

from __future__ import annotations

import json
import math
from typing import Any

from cad_runtime.tools.measure import _resolve_shape

_CONTAIN_TOL = 1e-4


def _unit(vec: tuple[float, float, float]) -> tuple[float, float, float] | None:
    n = math.sqrt(vec[0] ** 2 + vec[1] ** 2 + vec[2] ** 2)
    if n <= 1e-12:
        return None
    return (vec[0] / n, vec[1] / n, vec[2] / n)


def _intervals_on_line(shape: Any, origin: tuple[float, float, float], direction: tuple[float, float, float]) -> list[tuple[float, float]]:
    from OCP.BRepIntCurveSurface import BRepIntCurveSurface_Inter
    from OCP.gp import gp_Dir, gp_Lin, gp_Pnt

    wrapped = getattr(shape, "wrapped", shape)
    inter = BRepIntCurveSurface_Inter()
    inter.Init(wrapped, gp_Lin(gp_Pnt(*origin), gp_Dir(*direction)), 1e-6)
    params: list[float] = []
    while inter.More():
        params.append(float(inter.W()))
        inter.Next()
    params = sorted(set(round(p, 7) for p in params))
    if len(params) < 2:
        return []
    intervals: list[tuple[float, float]] = []
    for i in range(0, len(params) - 1, 2):
        lo, hi = params[i], params[i + 1]
        if hi - lo > 1e-9:
            intervals.append((lo, hi))
    return intervals


def measure_wall(shape: Any, at_mm: tuple[float, float, float], direction: tuple[float, float, float]) -> dict[str, Any]:
    unit = _unit(direction)
    if unit is None:
        return {"ok": False, "error": "direction must be non-zero"}
    intervals = _intervals_on_line(shape, at_mm, unit)
    containing = [item for item in intervals if item[0] - _CONTAIN_TOL <= 0.0 <= item[1] + _CONTAIN_TOL]
    if len(containing) != 1:
        return {"ok": False, "error": "no unique material interval contains atMm", "interval_count": len(containing)}
    lo, hi = containing[0]
    mm = hi - lo
    flipped = _intervals_on_line(shape, at_mm, (-unit[0], -unit[1], -unit[2]))
    flip_containing = [item for item in flipped if item[0] - _CONTAIN_TOL <= 0.0 <= item[1] + _CONTAIN_TOL]
    if len(flip_containing) != 1 or abs((flip_containing[0][1] - flip_containing[0][0]) - mm) > 1e-4:
        return {"ok": False, "error": "wall thickness is not sign-invariant"}
    return {"ok": True, "mm": mm}


def wall_at(session, object_name: str = "", at_mm: str = "", direction: str = "") -> str:
    try:
        shape = _resolve_shape(session, object_name)
        at = json.loads(at_mm) if isinstance(at_mm, str) else at_mm
        direction_v = json.loads(direction) if isinstance(direction, str) else direction
        if not (isinstance(at, list) and len(at) == 3 and isinstance(direction_v, list) and len(direction_v) == 3):
            raise ValueError("at_mm and direction must be JSON arrays of 3 numbers")
        result = measure_wall(shape, (float(at[0]), float(at[1]), float(at[2])), (float(direction_v[0]), float(direction_v[1]), float(direction_v[2])))
        return json.dumps(result)
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"ok": False, "error": str(exc)})
