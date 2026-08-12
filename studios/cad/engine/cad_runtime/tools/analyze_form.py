"""Station-based form analysis for freeform QC evidence.

Slices a solid along an axis, reports per-station width/depth/area/center,
and optionally compares against a numeric form contract (±tol).
"""

from __future__ import annotations

import json
import math
import re
from typing import Any


def _resolve_shape(session, object_name: str):
    if object_name:
        if object_name not in session.objects:
            raise ValueError(
                f"Unknown object '{object_name}'. Registered: {list(session.objects.keys())}"
            )
        return session.objects[object_name], object_name
    if session.current_shape is None:
        raise ValueError("No shape in session. Execute code to create geometry first.")
    return session.current_shape, "current_shape"


def _parse_positions(stations: str, lo: float, hi: float, num_stations: int) -> list[float]:
    raw = stations.strip()
    if raw:
        vals: list[float] = []
        for part in re.split(r"[,;\s]+", raw):
            if not part:
                continue
            vals.append(float(part))
        if len(vals) < 2:
            raise ValueError("stations needs at least 2 positions (mm along axis)")
        return vals
    n = max(int(num_stations), 2)
    span = hi - lo
    # inset 1% so end caps don't collapse to points
    lo_s = lo + span * 0.01
    hi_s = hi - span * 0.01
    if n == 2:
        return [lo_s, hi_s]
    step = (hi_s - lo_s) / (n - 1)
    return [lo_s + i * step for i in range(n)]


def _parse_contract(contract: str) -> list[dict[str, float]] | None:
    raw = contract.strip()
    if not raw:
        return None
    # JSON array preferred
    if raw.startswith("["):
        data = json.loads(raw)
        if not isinstance(data, list) or not data:
            raise ValueError("contract JSON must be a non-empty array of station objects")
        out: list[dict[str, float]] = []
        for i, row in enumerate(data):
            if not isinstance(row, dict):
                raise ValueError(f"contract[{i}] must be an object")
            t = row.get("t", row.get("position", row.get("pos")))
            w = row.get("width", row.get("w"))
            d = row.get("depth", row.get("d", row.get("height", row.get("h"))))
            if t is None or w is None or d is None:
                raise ValueError(
                    f"contract[{i}] needs t/position, width, depth (aliases: w, d/height/h)"
                )
            item = {"t": float(t), "width": float(w), "depth": float(d)}
            if row.get("area") is not None:
                item["area"] = float(row["area"])
            out.append(item)
        return out
    # Compact: "0:40x28, 50:52x30, 100:36x22"
    out = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        m = re.match(
            r"^([+-]?\d+(?:\.\d+)?)\s*:\s*([+-]?\d+(?:\.\d+)?)\s*[xX×]\s*([+-]?\d+(?:\.\d+)?)$",
            part,
        )
        if not m:
            raise ValueError(
                f"Bad contract token '{part}'. Use JSON array or 't:widthxdepth' list."
            )
        out.append({"t": float(m.group(1)), "width": float(m.group(2)), "depth": float(m.group(3))})
    if len(out) < 2:
        raise ValueError("contract needs at least 2 stations")
    return out


def _axis_span(bb, axis: str) -> tuple[float, float, Any, Any]:
    from OCP.gp import gp_Dir, gp_Pnt

    axis = axis.upper()
    if axis == "X":
        return bb.min.X, bb.max.X, gp_Dir(1, 0, 0), lambda pos: gp_Pnt(pos, 0, 0)
    if axis == "Y":
        return bb.min.Y, bb.max.Y, gp_Dir(0, 1, 0), lambda pos: gp_Pnt(0, pos, 0)
    return bb.min.Z, bb.max.Z, gp_Dir(0, 0, 1), lambda pos: gp_Pnt(0, 0, pos)


def _in_plane_axes(axis: str) -> tuple[str, str]:
    axis = axis.upper()
    if axis == "X":
        return "Y", "Z"
    if axis == "Y":
        return "X", "Z"
    return "X", "Y"


def _section_at(shape, pos: float, pln_dir, make_pnt) -> dict[str, Any]:
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Section
    from OCP.BRepBndLib import BRepBndLib
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
    from OCP.BRepGProp import BRepGProp
    from OCP.Bnd import Bnd_Box
    from OCP.GProp import GProp_GProps
    from OCP.gp import gp_Pln
    from OCP.ShapeAnalysis import ShapeAnalysis_FreeBounds
    from OCP.TopAbs import TopAbs_EDGE
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    from OCP.TopTools import TopTools_HSequenceOfShape

    plane = gp_Pln(make_pnt(pos), pln_dir)
    section = BRepAlgoAPI_Section(shape.wrapped, plane, False)
    section.Build()
    sec_shape = section.Shape()

    edges = TopTools_HSequenceOfShape()
    exp = TopExp_Explorer(sec_shape, TopAbs_EDGE)
    while exp.More():
        edges.Append(exp.Current())
        exp.Next()

    if edges.Length() == 0:
        return {
            "t": round(pos, 4),
            "area": 0.0,
            "width": 0.0,
            "depth": 0.0,
            "center": {"u": 0.0, "v": 0.0},
            "ok": False,
            "note": "empty section",
        }

    wires = TopTools_HSequenceOfShape()
    ShapeAnalysis_FreeBounds.ConnectEdgesToWires_s(edges, 1e-7, False, wires)

    total_area = 0.0
    cx = cy = cz = 0.0
    mass = 0.0
    for j in range(1, wires.Length() + 1):
        wire = TopoDS.Wire_s(wires.Value(j))
        try:
            face_maker = BRepBuilderAPI_MakeFace(plane, wire)
            if not face_maker.IsDone():
                continue
            face = face_maker.Face()
            props = GProp_GProps()
            BRepGProp.SurfaceProperties_s(face, props)
            a = abs(props.Mass())
            if a <= 0:
                continue
            total_area += a
            c = props.CentreOfMass()
            cx += c.X() * a
            cy += c.Y() * a
            cz += c.Z() * a
            mass += a
        except Exception:
            pass

    bnd = Bnd_Box()
    BRepBndLib.Add_s(sec_shape, bnd, True)
    if bnd.IsVoid():
        return {
            "t": round(pos, 4),
            "area": round(total_area, 4),
            "width": 0.0,
            "depth": 0.0,
            "center": {"u": 0.0, "v": 0.0},
            "ok": total_area > 0,
            "note": "no bbox",
        }
    xmin, ymin, zmin, xmax, ymax, zmax = bnd.Get()
    return {
        "t": round(pos, 4),
        "area": round(total_area, 4),
        "bbox": {
            "xmin": round(xmin, 4),
            "ymin": round(ymin, 4),
            "zmin": round(zmin, 4),
            "xmax": round(xmax, 4),
            "ymax": round(ymax, 4),
            "zmax": round(zmax, 4),
        },
        "center3d": {
            "x": round(cx / mass, 4) if mass > 0 else round((xmin + xmax) / 2, 4),
            "y": round(cy / mass, 4) if mass > 0 else round((ymin + ymax) / 2, 4),
            "z": round(cz / mass, 4) if mass > 0 else round((zmin + zmax) / 2, 4),
        },
        "ok": total_area > 1e-6,
    }


def _project_station(raw: dict[str, Any], axis: str) -> dict[str, Any]:
    u_name, v_name = _in_plane_axes(axis)
    bb = raw.get("bbox") or {}
    c3 = raw.get("center3d") or {}
    if axis.upper() == "X":
        width = float(bb.get("ymax", 0) - bb.get("ymin", 0)) if bb else 0.0
        depth = float(bb.get("zmax", 0) - bb.get("zmin", 0)) if bb else 0.0
        cu, cv = float(c3.get("y", 0)), float(c3.get("z", 0))
    elif axis.upper() == "Y":
        width = float(bb.get("xmax", 0) - bb.get("xmin", 0)) if bb else 0.0
        depth = float(bb.get("zmax", 0) - bb.get("zmin", 0)) if bb else 0.0
        cu, cv = float(c3.get("x", 0)), float(c3.get("z", 0))
    else:
        width = float(bb.get("xmax", 0) - bb.get("xmin", 0)) if bb else 0.0
        depth = float(bb.get("ymax", 0) - bb.get("ymin", 0)) if bb else 0.0
        cu, cv = float(c3.get("x", 0)), float(c3.get("y", 0))

    return {
        "t": raw["t"],
        "area": raw.get("area", 0.0),
        "width": round(width, 4),
        "depth": round(depth, 4),
        "center": {"u": round(cu, 4), "v": round(cv, 4), "u_axis": u_name, "v_axis": v_name},
        "ok": bool(raw.get("ok")),
        **({"note": raw["note"]} if raw.get("note") else {}),
    }


def _tol_for(target: float, tol_mm: float, tol_frac: float) -> float:
    return max(float(tol_mm), abs(float(target)) * float(tol_frac))


def _normalize_t_mode(t_mode: str) -> str:
    mode = (t_mode or "from_min").strip().lower()
    aliases = {
        "from_min": "from_min",
        "relative": "from_min",
        "span": "from_min",
        "design": "from_min",
        "absolute": "absolute",
        "world": "absolute",
        "normalized": "normalized",
        "unit": "normalized",
        "frac": "normalized",
    }
    if mode not in aliases:
        raise ValueError("t_mode must be from_min (default), absolute, or normalized")
    return aliases[mode]


def _map_t(t: float, lo: float, hi: float, mode: str) -> float:
    span = hi - lo
    if mode == "from_min":
        return lo + float(t)
    if mode == "normalized":
        return lo + float(t) * span
    return float(t)  # absolute world


def analyze_form(
    session,
    object_name: str = "",
    axis: str = "Z",
    num_stations: int = 5,
    stations: str = "",
    contract: str = "",
    tol_mm: float = 2.0,
    tol_frac: float = 0.05,
    t_mode: str = "from_min",
) -> str:
    """Measure form stations (width/depth/area/center) and optional contract match.

    contract t values default to from_min (mm from axis bbox min), matching form
    briefs like 0:40x28 at the base through H:… at the top — not world absolute.
    """
    try:
        shape, subject = _resolve_shape(session, object_name)
        axis_u = (axis or "Z").strip().upper()
        if axis_u not in {"X", "Y", "Z"}:
            raise ValueError("axis must be X, Y, or Z")
        mode = _normalize_t_mode(t_mode)

        bb = shape.bounding_box()
        lo, hi, pln_dir, make_pnt = _axis_span(bb, axis_u)
        span = hi - lo
        if span <= 1e-9:
            raise ValueError(f"shape has zero span along {axis_u}")

        contract_rows = _parse_contract(contract)
        # Explicit stations= without contract: treat as world absolute (legacy cross-section style).
        # Contract t uses t_mode (default from_min).
        if contract_rows:
            sample_plan = [
                {
                    "t_input": float(row["t"]),
                    "t_world": _map_t(float(row["t"]), lo, hi, mode),
                    "target": row,
                }
                for row in contract_rows
            ]
        else:
            world_positions = _parse_positions(stations, lo, hi, num_stations)
            sample_plan = [
                {"t_input": float(pos), "t_world": float(pos), "target": None} for pos in world_positions
            ]

        stations_out: list[dict[str, Any]] = []
        for sample in sample_plan:
            raw = _section_at(shape, float(sample["t_world"]), pln_dir, make_pnt)
            st = _project_station(raw, axis_u)
            st["t_world"] = round(float(sample["t_world"]), 4)
            st["t_input"] = round(float(sample["t_input"]), 4)
            st["t_from_min"] = round(float(sample["t_world"]) - lo, 4)
            # Keep primary t as design-relative when using contract/from_min so reports match briefs.
            if contract_rows and mode == "from_min":
                st["t"] = st["t_input"]
            elif contract_rows and mode == "normalized":
                st["t"] = st["t_input"]
            else:
                st["t"] = st["t_world"]
            stations_out.append(st)

        valid = [s for s in stations_out if s.get("ok") and s["width"] > 0 and s["depth"] > 0]
        widths = [s["width"] for s in valid]
        depths = [s["depth"] for s in valid]

        def _rel_range(vals: list[float]) -> float:
            if not vals:
                return 0.0
            mid = (max(vals) + min(vals)) / 2.0
            if mid <= 1e-9:
                return 0.0
            return (max(vals) - min(vals)) / mid

        width_var = _rel_range(widths)
        depth_var = _rel_range(depths)
        character = "near_prismatic" if max(width_var, depth_var) < 0.03 else "varying"

        centers = [s["center"] for s in valid]
        center_drift = 0.0
        if centers:
            us = [c["u"] for c in centers]
            vs = [c["v"] for c in centers]
            center_drift = math.hypot(max(us) - min(us), max(vs) - min(vs))

        comparisons: list[dict[str, Any]] = []
        contract_ok = True
        if contract_rows:
            for st, sample in zip(stations_out, sample_plan, strict=True):
                tgt = sample["target"]
                assert tgt is not None
                tw, td = tgt["width"], tgt["depth"]
                tol_w = _tol_for(tw, tol_mm, tol_frac)
                tol_d = _tol_for(td, tol_mm, tol_frac)
                dw = float(st["width"]) - tw
                dd = float(st["depth"]) - td
                ok = bool(st.get("ok")) and abs(dw) <= tol_w and abs(dd) <= tol_d
                if not ok:
                    contract_ok = False
                comparisons.append(
                    {
                        "t": st["t"],
                        "t_world": st["t_world"],
                        "target_t": tgt["t"],
                        "width": st["width"],
                        "depth": st["depth"],
                        "target_width": tw,
                        "target_depth": td,
                        "delta_width": round(dw, 4),
                        "delta_depth": round(dd, 4),
                        "tol_width": round(tol_w, 4),
                        "tol_depth": round(tol_d, 4),
                        "ok": ok,
                    }
                )

        warnings: list[str] = []
        if len(valid) < 2:
            warnings.append("fewer than 2 valid sections — check axis/object/t_mode")
        if character == "near_prismatic":
            warnings.append(
                "sections nearly constant — prismatic form may use QC finding 'not applicable' instead"
            )
        if not contract_rows:
            warnings.append(
                "no contract: stations measured only; form QC pass requires contract match or prismatic N/A"
            )
        warnings.append(
            "contract match proves geometry vs declared stations only — not brief/image fidelity "
            "(do not feed measured widths back as the contract)"
        )

        if contract_rows:
            if contract_ok and len(valid) >= 2:
                status = "pass"
            else:
                status = "fail"
        else:
            status = "unverified" if len(valid) >= 2 else "fail"

        summary_bits = [
            f"form {status}",
            f"axis={axis_u}",
            f"t_mode={mode}",
            f"{len(valid)}/{len(stations_out)} stations",
            character,
            f"width_var={width_var:.1%}",
            f"depth_var={depth_var:.1%}",
            f"center_drift={center_drift:.2f}mm",
        ]
        if contract_rows:
            bad = sum(1 for c in comparisons if not c["ok"])
            summary_bits.append(f"contract_mismatches={bad}")

        data = {
            "object": subject,
            "axis": axis_u,
            "t_mode": mode,
            "axis_min": round(lo, 4),
            "axis_max": round(hi, 4),
            "span_mm": round(span, 4),
            "bbox": {
                "x": round(float(bb.size.X), 4),
                "y": round(float(bb.size.Y), 4),
                "z": round(float(bb.size.Z), 4),
            },
            "stations": stations_out,
            "character": character,
            "width_variation": round(width_var, 4),
            "depth_variation": round(depth_var, 4),
            "center_drift_mm": round(center_drift, 4),
            "contract": contract_rows,
            "comparisons": comparisons,
            "tol_mm": tol_mm,
            "tol_frac": tol_frac,
            "status": status,
            "contract_matched": bool(contract_rows) and contract_ok and len(valid) >= 2,
            "warnings": warnings,
        }
        summary = ", ".join(summary_bits)
        return summary + "\n\n" + json.dumps(data, indent=2)
    except Exception as exc:  # noqa: BLE001 - surface as tool JSON error
        return json.dumps({"error": str(exc)})
