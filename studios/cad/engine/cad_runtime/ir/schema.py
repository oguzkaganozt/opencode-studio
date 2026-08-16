"""Validate CadIrV2 documents. No OCCT."""

from __future__ import annotations

from typing import Any

OP_ID = r"^[a-z][a-z0-9_]{0,63}$"
import re

_OP_ID = re.compile(OP_ID)

IR_DOCS = {
    "schema": 1,
    "ops": [
        "primitive(box|cylinder|cone|sphere)",
        "sketch(rect|circle on XY|XZ|YZ) + extrude",
        "hole, boolean, transform",
        "pattern(linear|polar)",
        "loft(3-7 stations, smooth, no ruled)",
        "path(line|spline) + sweep",
    ],
}


class IrError(ValueError):
    pass


def _obj(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise IrError(f"{label} must be an object")
    return value


def _id(value: Any, label: str) -> str:
    if not isinstance(value, str) or not _OP_ID.fullmatch(value):
        raise IrError(f"{label} must match {OP_ID}")
    return value


def _scalar(value: Any, label: str) -> None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return
    if isinstance(value, dict) and isinstance(value.get("param"), str) and set(value) <= {"param"}:
        return
    raise IrError(f"{label} must be a number or {{param}}")


def _vec(value: Any, n: int, label: str) -> None:
    if not isinstance(value, list) or len(value) != n:
        raise IrError(f"{label} must be a {n}-vector")
    for i, item in enumerate(value):
        _scalar(item, f"{label}[{i}]")


def _axis_name(value: Any, label: str) -> str:
    if value not in ("X", "Y", "Z"):
        raise IrError(f"{label} must be X, Y, or Z")
    return value


def _axis_ref(value: Any, label: str) -> None:
    obj = _obj(value, label)
    _vec(obj.get("origin"), 3, f"{label}.origin")
    direction = obj.get("direction")
    if direction not in ("X", "Y", "Z"):
        _vec(direction, 3, f"{label}.direction")


def _profile(value: Any, label: str) -> None:
    obj = _obj(value, label)
    kind = obj.get("kind")
    if kind == "rect":
        _scalar(obj.get("width"), f"{label}.width")
        _scalar(obj.get("height"), f"{label}.height")
        if "corner_radius" in obj:
            _scalar(obj["corner_radius"], f"{label}.corner_radius")
        if "center" in obj:
            _vec(obj["center"], 2, f"{label}.center")
        return
    if kind == "circle":
        _scalar(obj.get("diameter"), f"{label}.diameter")
        if "center" in obj:
            _vec(obj["center"], 2, f"{label}.center")
        return
    raise IrError(f"{label} kind must be rect or circle")


def _plane(value: Any, label: str) -> None:
    obj = _obj(value, label)
    if obj.get("kind") != "principal":
        raise IrError(f"{label}.kind must be principal")
    if obj.get("plane") not in ("XY", "XZ", "YZ"):
        raise IrError(f"{label}.plane must be XY, XZ, or YZ")
    if "offset" in obj:
        _scalar(obj["offset"], f"{label}.offset")


def _pattern(value: Any, label: str) -> None:
    obj = _obj(value, label)
    kind = obj.get("kind")
    count = obj.get("count")
    if not isinstance(count, int) or count < 2 or count > 64:
        raise IrError(f"{label}.count must be an integer 2-64")
    if kind == "linear":
        if obj.get("direction") not in ("X", "Y", "Z"):
            _vec(obj.get("direction"), 3, f"{label}.direction")
        _scalar(obj.get("spacing"), f"{label}.spacing")
        return
    if kind == "polar":
        _axis_ref(obj.get("axis"), f"{label}.axis")
        _scalar(obj.get("angle"), f"{label}.angle")
        return
    raise IrError(f"{label}.kind must be linear or polar")


def _op(raw: Any, index: int, seen: set[str]) -> dict[str, Any]:
    op = _obj(raw, f"ops[{index}]")
    kind = op.get("op")
    oid = _id(op.get("id"), f"ops[{index}].id")
    if oid in seen:
        raise IrError(f"duplicate op id {oid}")
    seen.add(oid)
    if kind == "sketch":
        _plane(op.get("plane"), f"{oid}.plane")
        _profile(op.get("profile"), f"{oid}.profile")
    elif kind == "path":
        if op.get("kind") not in ("line", "spline"):
            raise IrError(f"{oid}.kind must be line or spline")
        points = op.get("points")
        if not isinstance(points, list):
            raise IrError(f"{oid}.points must be an array")
        if op["kind"] == "line" and len(points) != 2:
            raise IrError(f"{oid} line path needs exactly 2 points")
        if op["kind"] == "spline" and not (3 <= len(points) <= 16):
            raise IrError(f"{oid} spline path needs 3-16 points")
        for i, point in enumerate(points):
            _vec(point, 3, f"{oid}.points[{i}]")
    elif kind == "primitive":
        pkind = op.get("kind")
        if pkind == "box":
            _vec(op.get("size"), 3, f"{oid}.size")
            if "origin" in op:
                _vec(op["origin"], 3, f"{oid}.origin")
        elif pkind in ("cylinder", "cone"):
            _scalar(op.get("radius"), f"{oid}.radius")
            _scalar(op.get("height"), f"{oid}.height")
            _axis_ref(op.get("axis"), f"{oid}.axis")
            if pkind == "cone":
                _scalar(op.get("radius2"), f"{oid}.radius2")
            elif "radius2" in op:
                raise IrError(f"{oid} cylinder cannot have radius2")
        elif pkind == "sphere":
            _scalar(op.get("radius"), f"{oid}.radius")
            if "center" in op:
                _vec(op["center"], 3, f"{oid}.center")
        else:
            raise IrError(f"{oid} primitive kind must be box, cylinder, cone, or sphere")
    elif kind == "extrude":
        if not isinstance(op.get("sketch"), str):
            raise IrError(f"{oid}.sketch must be an op id")
        _scalar(op.get("amount"), f"{oid}.amount")
        if "both" in op and not isinstance(op["both"], bool):
            raise IrError(f"{oid}.both must be a boolean")
    elif kind == "loft":
        _axis_name(op.get("axis"), f"{oid}.axis")
        if op.get("ruled") is True:
            raise IrError(f"{oid}: ruled lofts are not allowed")
        stations = op.get("stations")
        if not isinstance(stations, list) or not (3 <= len(stations) <= 7):
            raise IrError(f"{oid} needs 3-7 stations")
        for i, station in enumerate(stations):
            row = _obj(station, f"{oid}.stations[{i}]")
            _scalar(row.get("t"), f"{oid}.stations[{i}].t")
            _profile(row.get("profile"), f"{oid}.stations[{i}].profile")
            if "center" in row:
                _vec(row["center"], 2, f"{oid}.stations[{i}].center")
            if "rotation" in row:
                _scalar(row["rotation"], f"{oid}.stations[{i}].rotation")
    elif kind == "sweep":
        if not isinstance(op.get("path"), str):
            raise IrError(f"{oid}.path must be an op id")
        _profile(op.get("section"), f"{oid}.section")
        if op.get("transition") != "transformed":
            raise IrError(f"{oid}.transition must be transformed")
    elif kind == "hole":
        if not isinstance(op.get("on"), str):
            raise IrError(f"{oid}.on must be an op id")
        _vec(op.get("origin"), 3, f"{oid}.origin")
        if op.get("direction") not in ("X", "Y", "Z"):
            _vec(op.get("direction"), 3, f"{oid}.direction")
        _scalar(op.get("diameter"), f"{oid}.diameter")
        if op.get("depth") != "through":
            _scalar(op.get("depth"), f"{oid}.depth")
    elif kind == "boolean":
        if op.get("kind") not in ("fuse", "cut", "intersect"):
            raise IrError(f"{oid}.kind must be fuse, cut, or intersect")
        if not isinstance(op.get("a"), str) or not isinstance(op.get("b"), str):
            raise IrError(f"{oid} needs a and b op ids")
    elif kind == "pattern":
        if not isinstance(op.get("on"), str):
            raise IrError(f"{oid}.on must be an op id")
        if op.get("combine") not in ("compound", "fuse"):
            raise IrError(f"{oid}.combine must be compound or fuse")
        _pattern(op.get("pattern"), f"{oid}.pattern")
    elif kind == "transform":
        if not isinstance(op.get("on"), str):
            raise IrError(f"{oid}.on must be an op id")
        if "move" in op:
            _vec(op["move"], 3, f"{oid}.move")
        if "rotate" in op:
            rot = _obj(op["rotate"], f"{oid}.rotate")
            _axis_ref(rot.get("axis"), f"{oid}.rotate.axis")
            _scalar(rot.get("angle"), f"{oid}.rotate.angle")
        if "move" not in op and "rotate" not in op:
            raise IrError(f"{oid} needs move or rotate")
    else:
        raise IrError(f"ops[{index}]: unknown op {kind!r}")
    return op


def _refs(op: dict[str, Any]) -> list[str]:
    kind = op["op"]
    if kind == "extrude":
        return [op["sketch"]]
    if kind == "sweep":
        return [op["path"]]
    if kind == "hole":
        return [op["on"]]
    if kind == "boolean":
        return [op["a"], op["b"]]
    if kind in ("pattern", "transform"):
        return [op["on"]]
    return []


def validate_document(value: Any) -> dict[str, Any]:
    doc = _obj(value, "ir")
    extra = set(doc) - {"schema", "part", "params", "ops", "show", "verify"}
    if extra:
        raise IrError(f"unknown IR fields: {sorted(extra)}")
    if doc.get("schema") != 1:
        raise IrError("ir.schema must be 1")
    part = doc.get("part")
    if not isinstance(part, str) or not part:
        raise IrError("ir.part must be a non-empty string")
    params = doc.get("params")
    if not isinstance(params, list) or any(not isinstance(item, str) or not item for item in params):
        raise IrError("ir.params must be an array of names")
    ops_raw = doc.get("ops")
    if not isinstance(ops_raw, list):
        raise IrError("ir.ops must be an array")
    seen: set[str] = set()
    ops = [_op(item, index, seen) for index, item in enumerate(ops_raw)]
    by_id = {op["id"]: i for i, op in enumerate(ops)}
    instances = 0
    for i, op in enumerate(ops):
        for ref in _refs(op):
            if ref not in by_id:
                raise IrError(f"{op['id']} references unknown op {ref}")
            if by_id[ref] >= i:
                raise IrError(f"{op['id']} must reference an earlier op (forward DAG)")
        if op["op"] == "pattern":
            instances += int(op["pattern"]["count"])
    if instances > 256:
        raise IrError("pattern expansion exceeds 256 instances")
    show = doc.get("show")
    if not isinstance(show, str) or not show:
        raise IrError("ir.show must name one solid op")
    if show not in by_id:
        raise IrError(f"ir.show {show} is not an op id")
    return {"schema": 1, "part": part, "params": params, "ops": ops, "show": show, "verify": doc.get("verify")}
