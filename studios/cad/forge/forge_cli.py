"""Command-line build interface for CAD Studio designs."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import sys
import uuid
from pathlib import Path
from typing import Any

from build123d import Mesher, Shape, export_step, import_step
import numpy as np
import trimesh
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.GeomAbs import GeomAbs_SurfaceType
from OCP.TopAbs import TopAbs_FACE, TopAbs_Orientation
from OCP.TopExp import TopExp
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS
from OCP.TopTools import TopTools_IndexedMapOfShape

ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
OUTPUT_DIRS = ("step", "stl", "glb", "topo")
ARTIFACTS_DIR = ".artifacts"
LOCK_DIR = ".build.lock"
FORGE_ENGINE = "forge-cad/1"
STEP_VOLUME_REL_TOL = 1e-7
STEP_VOLUME_ABS_TOL_MM3 = 1e-6
STEP_BOUNDS_ABS_TOL_MM = 1e-6
MESH_LINEAR_DEFLECTION = 0.1
MESH_ANGULAR_DEFLECTION = 0.5
GENERATION_PATTERN = re.compile(r"^[0-9a-f]{32}$")

_SURFACE_TYPE_NAMES = {
    GeomAbs_SurfaceType.GeomAbs_Plane: "plane",
    GeomAbs_SurfaceType.GeomAbs_Cylinder: "cylinder",
    GeomAbs_SurfaceType.GeomAbs_Cone: "cone",
    GeomAbs_SurfaceType.GeomAbs_Sphere: "sphere",
    GeomAbs_SurfaceType.GeomAbs_Torus: "torus",
    GeomAbs_SurfaceType.GeomAbs_BezierSurface: "bezier",
    GeomAbs_SurfaceType.GeomAbs_BSplineSurface: "bspline",
    GeomAbs_SurfaceType.GeomAbs_SurfaceOfRevolution: "revolution",
    GeomAbs_SurfaceType.GeomAbs_SurfaceOfExtrusion: "extrusion",
    GeomAbs_SurfaceType.GeomAbs_OffsetSurface: "offset",
    GeomAbs_SurfaceType.GeomAbs_OtherSurface: "other",
}


def load_manifest(design_dir: Path) -> dict[str, Any]:
    manifest_path = design_dir / "design.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"Missing design manifest: {manifest_path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in {manifest_path}: {exc}") from exc

    if manifest.get("schema") != 1:
        raise ValueError("design.json must use schema 1")

    design_id = manifest.get("id")
    if not isinstance(design_id, str) or not ID_PATTERN.fullmatch(design_id):
        raise ValueError("Design id must use lowercase letters, numbers, hyphens, or underscores")

    parts = manifest.get("parts")
    if not isinstance(parts, list) or not parts:
        raise ValueError("design.json must define at least one part")

    seen: set[str] = set()
    if manifest.get("params", "params.py") != "params.py":
        raise ValueError("design.json params must be params.py")
    for part in parts:
        if not isinstance(part, dict):
            raise ValueError("Each part must be an object")
        part_id = part.get("id")
        source = part.get("source")
        if not isinstance(part_id, str) or not ID_PATTERN.fullmatch(part_id):
            raise ValueError(f"Invalid part id: {part_id!r}")
        if part_id in seen:
            raise ValueError(f"Duplicate part id: {part_id}")
        if not isinstance(source, str) or not source.endswith(".py"):
            raise ValueError(f"Part {part_id} must reference a Python source file")
        seen.add(part_id)

    return manifest


def resolve_source(design_dir: Path, source: str) -> Path:
    resolved = (design_dir / source).resolve()
    if not resolved.is_relative_to(design_dir / "parts"):
        raise ValueError(f"Part source must be under parts/: {source}")
    if not resolved.is_file():
        raise ValueError(f"Part source not found: {resolved}")
    return resolved


def build_shape(source: Path, part_id: str) -> Shape:
    module_name = f"cad_studio_{part_id}"
    spec = importlib.util.spec_from_file_location(module_name, source)
    if spec is None or spec.loader is None:
        raise ValueError(f"Could not load part source: {source}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    build = getattr(module, "build", None)
    if not callable(build):
        raise ValueError(f"Part {part_id} must define build()")

    shape = build()
    if not isinstance(shape, Shape):
        raise ValueError(f"Part {part_id} build() must return a build123d Shape")
    if not shape.is_valid:
        raise ValueError(f"Part {part_id} produced invalid geometry")
    if shape.volume <= 0:
        raise ValueError(f"Part {part_id} produced zero-volume geometry")
    if len(shape.solids()) != 1:
        raise ValueError(f"Part {part_id} must produce exactly one solid")
    return shape


def _surface_type_name(face) -> str:
    try:
        kind = BRepAdaptor_Surface(face).GetType()
        return _SURFACE_TYPE_NAMES.get(kind, "other")
    except Exception:
        return "other"


def tessellate_shape(
    shape: Shape,
    *,
    linear_deflection: float = MESH_LINEAR_DEFLECTION,
    angular_deflection: float = MESH_ANGULAR_DEFLECTION,
) -> tuple[np.ndarray, np.ndarray, list[int], list[dict[str, Any]]]:
    """Tessellate B-rep with stable per-triangle face ids (0-based map order)."""
    topo = shape.wrapped
    BRepMesh_IncrementalMesh(topo, linear_deflection, False, angular_deflection, True)

    face_map = TopTools_IndexedMapOfShape()
    TopExp.MapShapes_s(topo, TopAbs_FACE, face_map)
    if face_map.Size() == 0:
        raise ValueError("Shape has no faces to tessellate")

    vertices: list[tuple[float, float, float]] = []
    triangles: list[tuple[int, int, int]] = []
    triangle_face_ids: list[int] = []
    face_records: list[dict[str, Any]] = []

    for face_index in range(1, face_map.Size() + 1):
        face = TopoDS.Face_s(face_map.FindKey(face_index))
        face_id = face_index - 1
        location = TopLoc_Location()
        triangulation = BRep_Tool.Triangulation_s(face, location)
        if triangulation is None or triangulation.NbTriangles() == 0:
            face_records.append({"id": face_id, "triangleCount": 0, "type": _surface_type_name(face)})
            continue

        transform = location.Transformation()
        base = len(vertices)
        for node_index in range(1, triangulation.NbNodes() + 1):
            point = triangulation.Node(node_index)
            point.Transform(transform)
            vertices.append((point.X(), point.Y(), point.Z()))

        reversed_face = face.Orientation() == TopAbs_Orientation.TopAbs_REVERSED
        tri_count = 0
        for tri_index in range(1, triangulation.NbTriangles() + 1):
            n1, n2, n3 = triangulation.Triangle(tri_index).Get()
            i1, i2, i3 = base + n1 - 1, base + n2 - 1, base + n3 - 1
            if reversed_face:
                triangles.append((i1, i3, i2))
            else:
                triangles.append((i1, i2, i3))
            triangle_face_ids.append(face_id)
            tri_count += 1

        face_records.append({"id": face_id, "triangleCount": tri_count, "type": _surface_type_name(face)})

    if not triangles:
        raise ValueError("Tessellation produced no triangles")

    return (
        np.asarray(vertices, dtype=np.float64),
        np.asarray(triangles, dtype=np.int64),
        triangle_face_ids,
        face_records,
    )


def export_glb_with_topo(
    shape: Shape,
    glb_path: Path,
    topo_path: Path,
    part_id: str,
) -> dict[str, Any]:
    vertices, faces, triangle_face_ids, face_records = tessellate_shape(shape)
    if len(faces) == 0:
        raise ValueError(f"Could not create GLB for empty tessellation: {part_id}")

    # One glTF mesh per B-rep face (name face_<id>) so the viewer can pick without a sidecar.
    tris_by_face: dict[int, list[int]] = {}
    for tri_index, face_id in enumerate(triangle_face_ids):
        tris_by_face.setdefault(face_id, []).append(tri_index)

    scene = trimesh.Scene()
    for face_id, tri_indices in tris_by_face.items():
        used: list[int] = sorted({int(v) for i in tri_indices for v in faces[i]})
        remap = {old: new for new, old in enumerate(used)}
        face_vertices = vertices[used]
        face_triangles = np.asarray(
            [[remap[int(a)], remap[int(b)], remap[int(c)]] for i in tri_indices for a, b, c in [faces[i]]],
            dtype=np.int64,
        )
        mesh = trimesh.Trimesh(vertices=face_vertices, faces=face_triangles, process=False)
        name = f"face_{face_id}"
        scene.add_geometry(mesh, node_name=name, geom_name=name)

    if len(scene.geometry) == 0:
        raise ValueError(f"Could not create GLB for empty tessellation: {part_id}")
    scene.export(glb_path, file_type="glb")

    topo = {
        "schema": 1,
        "partId": part_id,
        "faceCount": len(face_records),
        "triangleCount": len(triangle_face_ids),
        "triangleFaceIds": triangle_face_ids,
        "faces": face_records,
    }
    topo_path.write_text(json.dumps(topo, separators=(",", ":")) + "\n", encoding="utf-8")
    return topo


def validate_step_round_trip(source: Shape, step_path: Path, part_id: str) -> None:
    imported = import_step(step_path)
    if not imported.is_valid:
        raise ValueError(f"Part {part_id} STEP round-trip produced invalid geometry")
    if imported.volume <= 0:
        raise ValueError(f"Part {part_id} STEP round-trip produced zero-volume geometry")
    if len(imported.solids()) != 1:
        raise ValueError(f"Part {part_id} STEP round-trip must contain exactly one solid")

    volume_tolerance = max(STEP_VOLUME_ABS_TOL_MM3, source.volume * STEP_VOLUME_REL_TOL)
    if abs(imported.volume - source.volume) > volume_tolerance:
        raise ValueError(f"Part {part_id} STEP round-trip volume differs from source")

    source_box = source.bounding_box()
    imported_box = imported.bounding_box()
    source_bounds = (*tuple(source_box.min), *tuple(source_box.max))
    imported_bounds = (*tuple(imported_box.min), *tuple(imported_box.max))
    if any(
        abs(source_value - imported_value) > STEP_BOUNDS_ABS_TOL_MM
        for source_value, imported_value in zip(source_bounds, imported_bounds)
    ):
        raise ValueError(f"Part {part_id} STEP round-trip bounds differ from source")


def export_part(shape: Shape, part_id: str, tmp_dirs: dict[str, Path]) -> dict[str, Any]:
    step_path = tmp_dirs["step"] / f"{part_id}.step"
    stl_path = tmp_dirs["stl"] / f"{part_id}.stl"
    glb_path = tmp_dirs["glb"] / f"{part_id}.glb"
    topo_path = tmp_dirs["topo"] / f"{part_id}.json"

    export_step(shape, step_path)
    validate_step_round_trip(shape, step_path, part_id)
    mesher = Mesher()
    mesher.add_shape(shape)
    mesher.write(stl_path)
    topo = export_glb_with_topo(shape, glb_path, topo_path, part_id)

    box = shape.bounding_box()
    size = box.size
    return {
        "id": part_id,
        "files": {
            "step": f"step/{step_path.name}",
            "stl": f"stl/{stl_path.name}",
            "glb": f"glb/{glb_path.name}",
            "topo": f"topo/{topo_path.name}",
        },
        "metrics": {
            "volume_mm3": round(shape.volume, 3),
            "solid_count": len(shape.solids()),
            "face_count": topo["faceCount"],
            "bounds_mm": {
                "min": [round(value, 3) for value in box.min],
                "max": [round(value, 3) for value in box.max],
            },
            "size_mm": {
                "x": round(size.X, 3),
                "y": round(size.Y, 3),
                "z": round(size.Z, 3),
            },
        },
    }


def ensure_public_links(design_dir: Path) -> None:
    targets = {
        "step": f"{ARTIFACTS_DIR}/current/step",
        "stl": f"{ARTIFACTS_DIR}/current/stl",
        "glb": f"{ARTIFACTS_DIR}/current/glb",
        "topo": f"{ARTIFACTS_DIR}/current/topo",
        "manifest.json": f"{ARTIFACTS_DIR}/current/manifest.json",
    }
    for name, target in targets.items():
        public = design_dir / name
        if os.path.lexists(public):
            if public.is_symlink() and os.readlink(public) == target:
                continue
            if public.is_dir() and not public.is_symlink():
                shutil.rmtree(public)
            else:
                public.unlink()
        temporary = design_dir / f".{name.replace('.', '_')}.{uuid.uuid4().hex}.tmp"
        os.symlink(target, temporary)
        os.replace(temporary, public)


def acquire_build_lock(design_dir: Path) -> Path:
    lock = design_dir / LOCK_DIR
    try:
        lock.mkdir()
    except FileExistsError as exc:
        try:
            owner = json.loads((lock / "owner.json").read_text(encoding="utf-8"))
            os.kill(int(owner["pid"]), 0)
        except ProcessLookupError:
            shutil.rmtree(lock, ignore_errors=True)
            return acquire_build_lock(design_dir)
        except (FileNotFoundError, KeyError, TypeError, ValueError, json.JSONDecodeError):
            pass
        raise ValueError(f"Design is already being built: {design_dir}") from exc
    (lock / "owner.json").write_text(json.dumps({"pid": os.getpid()}) + "\n", encoding="utf-8")
    return lock


def build_input_hashes(design_dir: Path) -> dict[str, str]:
    inputs = [design_dir / "design.json", *sorted(design_dir.rglob("*.py"))]
    return {
        path.relative_to(design_dir).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in inputs
        if not any(part in {ARTIFACTS_DIR, LOCK_DIR} for part in path.parts)
    }


def prune_generations(artifacts_dir: Path, current: str, previous: str | None) -> None:
    """Retain the current generation and at most its complete predecessor."""
    retained = {current}
    if previous is not None:
        previous_dir = artifacts_dir / previous
        if GENERATION_PATTERN.fullmatch(previous) and (previous_dir / "manifest.json").is_file():
            retained.add(previous)

    for candidate in artifacts_dir.iterdir():
        if candidate.name in retained or not GENERATION_PATTERN.fullmatch(candidate.name):
            continue
        if candidate.is_dir() and not candidate.is_symlink():
            shutil.rmtree(candidate)


def build_design(design_path: str) -> Path:
    design_dir = Path(design_path).resolve()
    if not design_dir.is_dir():
        raise ValueError(f"Design directory not found: {design_dir}")

    lock = acquire_build_lock(design_dir)
    temporary_generation: Path | None = None
    path_inserted = False
    try:
        input_hashes = build_input_hashes(design_dir)
        manifest = load_manifest(design_dir)
        artifacts_dir = design_dir / ARTIFACTS_DIR
        artifacts_dir.mkdir(exist_ok=True)
        current_link = artifacts_dir / "current"
        previous_generation = os.readlink(current_link) if current_link.is_symlink() else None
        generation_id = uuid.uuid4().hex
        temporary_generation = artifacts_dir / f".{generation_id}.tmp"
        final_generation = artifacts_dir / generation_id
        temporary_generation.mkdir()
        tmp_dirs = {sub: temporary_generation / sub for sub in OUTPUT_DIRS}
        for directory in tmp_dirs.values():
            directory.mkdir()

        sys.modules.pop("params", None)
        sys.path.insert(0, str(design_dir))
        path_inserted = True
        built_parts = [
            export_part(
                build_shape(resolve_source(design_dir, part["source"]), part["id"]),
                part["id"],
                tmp_dirs,
            )
            for part in manifest["parts"]
        ]
        artifact_manifest = {
            "schema": 1,
            "id": manifest["id"],
            "parts": built_parts,
            "build": {
                "engine": FORGE_ENGINE,
                "inputs": input_hashes,
            },
        }
        manifest_text = json.dumps(artifact_manifest, indent=2) + "\n"
        (temporary_generation / "manifest.json").write_text(manifest_text, encoding="utf-8")
        if build_input_hashes(design_dir) != input_hashes:
            raise ValueError("Design inputs changed during build; build was not published")
        temporary_generation.rename(final_generation)

        temporary_link = artifacts_dir / f".current.{generation_id}.tmp"
        os.symlink(generation_id, temporary_link)
        os.replace(temporary_link, current_link)
        ensure_public_links(design_dir)
        prune_generations(artifacts_dir, generation_id, previous_generation)
        return design_dir / "manifest.json"
    except Exception:
        if temporary_generation is not None:
            shutil.rmtree(temporary_generation, ignore_errors=True)
        raise
    finally:
        if path_inserted and str(design_dir) in sys.path:
            sys.path.remove(str(design_dir))
        sys.modules.pop("params", None)
        shutil.rmtree(lock, ignore_errors=True)


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="forge")
    subparsers = parser.add_subparsers(dest="command", required=True)
    build = subparsers.add_parser("build", help="Build a CAD Studio design in place")
    build.add_argument("design", help="Directory containing design.json")
    return parser


def main() -> None:
    args = create_parser().parse_args()
    try:
        if args.command == "build":
            manifest_path = build_design(args.design)
            print(f"Build complete: {manifest_path}")
    except Exception as exc:
        print(f"forge: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
