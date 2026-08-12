"""Build a CAD Studio design in-process (same runtime as session tools)."""

from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path


def studio_build(session, design_dir: str = "") -> str:
    """Run forge build_design on design_dir. Disk sources are the source of truth.

    Binds design_dir into the interactive session so execute() sees params.py.
    """
    if not isinstance(design_dir, str) or not design_dir.strip():
        return json.dumps(
            {
                "ok": False,
                "exitCode": 1,
                "designDir": design_dir,
                "manifestPath": None,
                "stdout": "",
                "stderr": "design_dir is required",
            },
            indent=2,
        )

    bind = getattr(session, "bind_design_dir", None)
    if callable(bind):
        bind(design_dir)

    forge_root = Path(__file__).resolve().parents[2]
    root_str = str(forge_root)
    if root_str not in sys.path:
        sys.path.insert(0, root_str)

    try:
        import cad_build
    except ImportError as exc:
        return json.dumps(
            {
                "ok": False,
                "exitCode": 1,
                "designDir": design_dir,
                "manifestPath": None,
                "stdout": "",
                "stderr": f"cad_build import failed: {exc}",
            },
            indent=2,
        )

    try:
        manifest_path = cad_build.build_design(design_dir)
        return json.dumps(
            {
                "ok": True,
                "exitCode": 0,
                "designDir": str(Path(design_dir).resolve()),
                "manifestPath": str(manifest_path),
                "stdout": f"Build complete: {manifest_path}",
                "stderr": "",
            },
            indent=2,
        )
    except Exception as exc:
        return json.dumps(
            {
                "ok": False,
                "exitCode": 1,
                "designDir": str(Path(design_dir).resolve()) if design_dir else design_dir,
                "manifestPath": None,
                "stdout": "",
                "stderr": str(exc),
                "traceback": traceback.format_exc()[-4000:],
            },
            indent=2,
        )
