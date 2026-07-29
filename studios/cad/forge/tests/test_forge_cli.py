import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import trimesh
from build123d import Box
from forge_cli import build_design


class BuildDesignTest(unittest.TestCase):
    def _make_design(self, root: Path, part_source: str) -> Path:
        design = root / "test-design"
        parts = design / "parts"
        parts.mkdir(parents=True)
        (design / "design.json").write_text(
            json.dumps({
                "schema": 1,
                "id": "test-design",
                "parts": [{"id": "body", "source": "parts/body.py"}],
            }),
            encoding="utf-8",
        )
        (design / "params.py").write_text("SIZE = 10.0\n", encoding="utf-8")
        (parts / "body.py").write_text(part_source, encoding="utf-8")
        return design

    def test_builds_design_in_place(self):
        with tempfile.TemporaryDirectory() as tmp:
            design = self._make_design(
                Path(tmp),
                "from build123d import Box\n"
                "from params import SIZE\n\n"
                "def build():\n"
                "    return Box(SIZE, SIZE, SIZE)\n",
            )
            manifest_path = build_design(str(design))
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["id"], "test-design")
            metrics = manifest["parts"][0]["metrics"]
            self.assertEqual(metrics["volume_mm3"], 1000.0)
            self.assertEqual(metrics["solid_count"], 1)
            self.assertEqual(
                metrics["bounds_mm"],
                {"min": [-5.0, -5.0, -5.0], "max": [5.0, 5.0, 5.0]},
            )
            for rel in ("step/body.step", "stl/body.stl", "glb/body.glb", "topo/body.json"):
                self.assertTrue((design / rel).is_file())
            self.assertEqual(manifest["parts"][0]["files"]["topo"], "topo/body.json")
            self.assertGreaterEqual(metrics.get("face_count", 0), 6)
            topo = json.loads((design / "topo" / "body.json").read_text(encoding="utf-8"))
            self.assertEqual(topo["schema"], 1)
            self.assertEqual(topo["partId"], "body")
            self.assertEqual(topo["faceCount"], metrics["face_count"])
            self.assertEqual(len(topo["triangleFaceIds"]), topo["triangleCount"])
            glb_scene = trimesh.load(design / "glb" / "body.glb")
            geom_names = list(getattr(glb_scene, "geometry", {}).keys()) if hasattr(glb_scene, "geometry") else []
            face_named = [name for name in geom_names if name.startswith("face_")]
            self.assertGreaterEqual(len(face_named), 6, f"GLB must expose face_* meshes, got {geom_names}")
            self.assertTrue(manifest_path.is_file())
            for rel in ("step", "stl", "glb", "topo", "manifest.json"):
                self.assertTrue((design / rel).is_symlink())
            self.assertTrue((design / ".artifacts" / "current").is_symlink())

    def test_failed_build_preserves_previous_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            design = self._make_design(
                Path(tmp),
                "from build123d import Box\n"
                "from params import SIZE\n\n"
                "def build():\n"
                "    return Box(SIZE, SIZE, SIZE)\n",
            )
            build_design(str(design))
            first_manifest = (design / "manifest.json").read_text(encoding="utf-8")
            first_generation = (design / ".artifacts" / "current").readlink()

            invalid = MagicMock()
            invalid.is_valid = False
            with patch("forge_cli.import_step", return_value=invalid):
                with self.assertRaisesRegex(ValueError, "STEP round-trip produced invalid geometry"):
                    build_design(str(design))
            self.assertEqual(
                (design / "manifest.json").read_text(encoding="utf-8"),
                first_manifest,
            )
            self.assertEqual((design / ".artifacts" / "current").readlink(), first_generation)
            self.assertTrue((design / "step" / "body.step").is_file())

    def test_rejects_disconnected_source_shape(self):
        with tempfile.TemporaryDirectory() as tmp:
            design = self._make_design(
                Path(tmp),
                "from build123d import Box, Compound, Pos\n\n"
                "def build():\n"
                "    return Compound([Box(1, 1, 1), Pos(2, 0, 0) * Box(1, 1, 1)])\n",
            )
            with self.assertRaisesRegex(ValueError, "must produce exactly one solid"):
                build_design(str(design))

    def test_rejects_empty_step_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            design = self._make_design(
                Path(tmp),
                "from build123d import Box\n\n"
                "def build():\n"
                "    return Box(10, 10, 10)\n",
            )
            empty = MagicMock()
            empty.is_valid = True
            empty.volume = 0
            with patch("forge_cli.import_step", return_value=empty):
                with self.assertRaisesRegex(ValueError, "STEP round-trip produced zero-volume geometry"):
                    build_design(str(design))

    def test_rejects_step_round_trip_volume_or_bounds_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            design = self._make_design(
                Path(tmp),
                "from build123d import Box\n\n"
                "def build():\n"
                "    return Box(10, 10, 10)\n",
            )
            cases = (
                (Box(10, 10, 11), "volume differs"),
                (Box(20, 5, 10), "bounds differ"),
            )
            for imported, message in cases:
                with self.subTest(message=message):
                    with patch("forge_cli.import_step", return_value=imported):
                        with self.assertRaisesRegex(ValueError, message):
                            build_design(str(design))

    def test_build_lock_rejects_concurrent_build(self):
        with tempfile.TemporaryDirectory() as tmp:
            design = self._make_design(
                Path(tmp),
                "from build123d import Box\n"
                "from params import SIZE\n\n"
                "def build():\n"
                "    return Box(SIZE, SIZE, SIZE)\n",
            )
            (design / ".build.lock").mkdir()
            with self.assertRaisesRegex(ValueError, "already being built"):
                build_design(str(design))


if __name__ == "__main__":
    unittest.main()
