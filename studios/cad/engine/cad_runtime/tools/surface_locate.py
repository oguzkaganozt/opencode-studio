"""Surface locate + boolean diagnostics for freeform feature placement.

Agents struggle on organic shells when cutters sit outside the solid or bosses
miss the wall. These helpers return concrete hit points/normals and say whether
a boolean actually changed volume / whether the cutter intersects the body.
"""

from __future__ import annotations

import json
from typing import Any

_SIDE_DIRS: dict[str, tuple[float, float, float]] = {
    "front": (0.0, 1.0, 0.0),
    "back": (0.0, -1.0, 0.0),
    "rear": (0.0, -1.0, 0.0),
    "right": (1.0, 0.0, 0.0),
    "left": (-1.0, 0.0, 0.0),
    "top": (0.0, 0.0, 1.0),
    "bottom": (0.0, 0.0, -1.0),
}


def _vec(x: float, y: float, z: float) -> tuple[float, float, float]:
    return (float(x), float(y), float(z))


def _face_center(face: Any) -> tuple[float, float, float] | None:
    try:
        c = face.center()
        return _vec(c.X, c.Y, c.Z)
    except Exception:
        return None


def _face_normal(face: Any) -> tuple[float, float, float] | None:
    try:
        c = face.center()
        n = face.normal_at(c)
        return _vec(n.X, n.Y, n.Z)
    except Exception:
        try:
            n = face.normal_at()
            return _vec(n.X, n.Y, n.Z)
        except Exception:
            return None


def _dot(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _sub(
    a: tuple[float, float, float], b: tuple[float, float, float]
) -> tuple[float, float, float]:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _add(
    a: tuple[float, float, float], b: tuple[float, float, float]
) -> tuple[float, float, float]:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _scale(a: tuple[float, float, float], s: float) -> tuple[float, float, float]:
    return (a[0] * s, a[1] * s, a[2] * s)


def _len(a: tuple[float, float, float]) -> float:
    return (a[0] ** 2 + a[1] ** 2 + a[2] ** 2) ** 0.5


def _norm(a: tuple[float, float, float]) -> tuple[float, float, float]:
    L = _len(a)
    if L < 1e-12:
        return (0.0, 0.0, 1.0)
    return (a[0] / L, a[1] / L, a[2] / L)


def locate_surface(
    shape: Any,
    side: str | None = "back",
    point: tuple[float, float, float] | list[float] | None = None,
    min_area: float = 0.5,
    inset: float = 1.0,
    outset: float = 8.0,
) -> dict[str, Any]:
    """Pick a surface hit for placing cutters/bosses on freeform solids.

    Parameters
    ----------
    shape:
        Target solid.
    side:
        World-axis side name: front/back/rear/left/right/top/bottom.
        Ignored when ``point`` is set (then closest face to the point wins).
    point:
        Optional (x, y, z). Closest face center to this point is chosen; when
        combined with ``side``, faces are re-ranked by normal alignment too.
    min_area:
        Ignore tiny faces (mm²).
    inset / outset:
        Distances along the chosen normal for suggested cutter anchors (mm).

    Returns a dict with point, normal, inset/outset anchors, face_area, and a
    short placement hint. Normal points roughly outward from the solid.
    """
    if shape is None:
        raise ValueError("locate_surface: shape is None")

    side_key = (side or "back").strip().lower()
    direction: tuple[float, float, float] | None = None
    if point is None:
        if side_key not in _SIDE_DIRS:
            raise ValueError(
                f"Unknown side {side!r}. Use one of: {', '.join(sorted(_SIDE_DIRS))}"
            )
        direction = _SIDE_DIRS[side_key]

    pt: tuple[float, float, float] | None = None
    if point is not None:
        if len(point) != 3:
            raise ValueError("point must be (x, y, z)")
        pt = _vec(point[0], point[1], point[2])

    candidates: list[tuple[float, Any, tuple[float, float, float], tuple[float, float, float], float]] = []
    for face in shape.faces():
        try:
            area = float(face.area)
        except Exception:
            continue
        if area < min_area:
            continue
        center = _face_center(face)
        normal = _face_normal(face)
        if center is None or normal is None:
            continue
        normal = _norm(normal)

        if pt is not None:
            dist = _len(_sub(center, pt))
            score = -dist
            if direction is not None:
                score += 2.0 * _dot(normal, direction)
        else:
            assert direction is not None
            # Prefer faces facing the requested side and sitting on that side of the part.
            score = 8.0 * _dot(normal, direction) + 0.02 * _dot(center, direction) + 0.0005 * area

        candidates.append((score, face, center, normal, area))

    if not candidates:
        raise ValueError("locate_surface: no faces met min_area / normal probes")

    candidates.sort(key=lambda row: row[0], reverse=True)
    _score, _face, center, normal, area = candidates[0]

    # Ensure normal points toward the requested side when a side is given
    # (flip if the best face normal points the wrong way).
    if direction is not None and _dot(normal, direction) < 0:
        normal = _scale(normal, -1.0)

    inset_pt = _sub(center, _scale(normal, abs(inset)))
    outset_pt = _add(center, _scale(normal, abs(outset)))

    result = {
        "point": center,
        "normal": normal,
        "inset_point": inset_pt,
        "outset_point": outset_pt,
        "face_area": area,
        "side": side_key if pt is None else None,
        "plane": {
            "origin": center,
            "z_dir": normal,
        },
        "hint": (
            "Cutter: start outside at outset_point, axis along -normal through the wall "
            "(depth > wall thickness). Boss: place at inset_point along -normal into the solid. "
            "After boolean: boolean_status(before, after, cutter=cutter)."
        ),
    }
    return result


def boolean_status(
    before: Any,
    after: Any,
    cutter: Any | None = None,
    tol: float = 1e-3,
) -> dict[str, Any]:
    """Report whether a boolean changed volume and how the cutter relates to the body."""
    if before is None or after is None:
        raise ValueError("boolean_status: before and after shapes are required")

    try:
        vol_b = float(before.volume)
        vol_a = float(after.volume)
    except Exception as exc:
        raise ValueError(f"boolean_status: volume probe failed: {exc}") from exc

    delta = vol_a - vol_b
    rel = abs(delta) / max(abs(vol_b), 1.0)
    noop = abs(delta) < tol or rel < 1e-9

    try:
        faces_b = len(before.faces())
        faces_a = len(after.faces())
    except Exception:
        faces_b = faces_a = -1

    status = "noop" if noop else ("removed_material" if delta < 0 else "added_material")
    out: dict[str, Any] = {
        "volume_before": vol_b,
        "volume_after": vol_a,
        "delta": delta,
        "relative_delta": rel,
        "faces_before": faces_b,
        "faces_after": faces_a,
        "noop": noop,
        "status": status,
    }

    if cutter is not None:
        try:
            from cad_runtime.tools.measure import _clearance_report

            rep = json.loads(_clearance_report(before, cutter))
            cutter_info = {
                "relation": rep.get("status"),
                "clearance": rep.get("clearance"),
                "containment": rep.get("containment"),
                "intersection_volume": rep.get("intersection_volume"),
            }
            out["cutter"] = cutter_info
            rel_st = rep.get("status")
            if rel_st == "apart":
                out["diagnosis"] = "cutter_outside_solid"
                out["hint"] = (
                    "Cutter does not meet the body — move it with locate_surface(...) "
                    "anchors (outset_point → -normal) before cutting."
                )
            elif noop and rel_st == "touching":
                out["diagnosis"] = "cutter_tangent_no_volume_change"
                out["hint"] = (
                    "Cutter only touches the body; push it along -normal through the wall "
                    "or enlarge the cutter so the boolean removes volume."
                )
            elif noop and rel_st == "containing":
                out["diagnosis"] = "cutter_nested_but_noop"
                out["hint"] = (
                    "Cutter is nested/containing but volume did not change — check you "
                    "assigned `body = body - cutter` (not a discarded expression) and show(body)."
                )
            elif noop:
                out["diagnosis"] = "boolean_noop"
                out["hint"] = (
                    "Volume unchanged. Verify intersection and assignment; "
                    "use locate_surface to re-place the cutter."
                )
            elif rel_st == "interpenetrating" or (rep.get("intersection_volume") or 0) > tol:
                out["diagnosis"] = "ok_intersecting"
            else:
                out["diagnosis"] = "ok"
        except Exception as exc:
            out["cutter_error"] = str(exc)
            if noop:
                out["diagnosis"] = "boolean_noop"
                out["hint"] = "Volume unchanged; cutter relation could not be computed."
    elif noop:
        out["diagnosis"] = "boolean_noop"
        out["hint"] = (
            "Volume unchanged after update — likely missed boolean. "
            "Pass cutter=... to boolean_status for outside/tangent diagnosis, "
            "or locate_surface(body, side='back') to place the cutter."
        )

    return out


def format_locate_surface(result: dict[str, Any]) -> str:
    p = result["point"]
    n = result["normal"]
    return (
        f"locate_surface: point=({p[0]:.3f},{p[1]:.3f},{p[2]:.3f}) "
        f"normal=({n[0]:.3f},{n[1]:.3f},{n[2]:.3f}) "
        f"area={result['face_area']:.1f} side={result.get('side')}"
    )


def format_boolean_status(result: dict[str, Any]) -> str:
    parts = [
        f"boolean_status: {result.get('status')}",
        f"ΔV={result.get('delta'):.4g}",
        f"noop={result.get('noop')}",
    ]
    if result.get("diagnosis"):
        parts.append(f"diagnosis={result['diagnosis']}")
    if result.get("cutter"):
        parts.append(f"cutter={result['cutter'].get('relation')}")
    return " ".join(parts)
