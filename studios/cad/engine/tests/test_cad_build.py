import json
import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import trimesh
from build123d import Box
from cad_build import build_design, build_input_hashes, export_part


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
                link = design / rel
                self.assertTrue(link.is_symlink())
                self.assertFalse(os.readlink(link).startswith("/"), os.readlink(link))
            current = design / ".artifacts" / "current"
            self.assertTrue(current.is_symlink())
            self.assertFalse(os.readlink(current).startswith("/"), os.readlink(current))

    def test_qty_two_exports_yz_mirror(self):
        with tempfile.TemporaryDirectory() as tmp:
            design = self._make_design(
                Path(tmp),
                "from build123d import Box, Location\n\n"
                "def build():\n"
                "    return Location((20, 0, 0)) * Box(10, 10, 10)\n",
            )
            manifest = json.loads((design / "design.json").read_text(encoding="utf-8"))
            manifest["parts"][0]["qty"] = 2
            (design / "design.json").write_text(json.dumps(manifest), encoding="utf-8")
            built = json.loads(build_design(str(design)).read_text(encoding="utf-8"))
            ids = [part["id"] for part in built["parts"]]
            self.assertEqual(ids, ["body", "body_mirror"])
            self.assertTrue((design / "step" / "body.step").is_file())
            self.assertTrue((design / "step" / "body_mirror.step").is_file())
            body_min = built["parts"][0]["metrics"]["bounds_mm"]["min"][0]
            mirror_max = built["parts"][1]["metrics"]["bounds_mm"]["max"][0]
            self.assertGreater(body_min, 0)
            self.assertLess(mirror_max, 0)
            for part in built["parts"]:
                self.assertRegex(part["body_hash"], r"^[a-f0-9]{64}$")
                step_bytes = (design / "step" / f"{part['id']}.step").read_bytes()
                self.assertEqual(part["body_hash"], hashlib.sha256(step_bytes).hexdigest())

    def test_schema_two_manifest_builds(self):
        with tempfile.TemporaryDirectory() as tmp:
            design = self._make_design(
                Path(tmp),
                "from build123d import Box\n"
                "from params import SIZE\n\n"
                "def build():\n"
                "    return Box(SIZE, SIZE, SIZE)\n",
            )
            manifest = json.loads((design / "design.json").read_text(encoding="utf-8"))
            manifest["schema"] = 2
            manifest["params"] = "params.py"
            manifest["acceptance"] = "acceptance.json"
            (design / "design.json").write_text(json.dumps(manifest), encoding="utf-8")
            (design / "acceptance.json").write_text("{}", encoding="utf-8")
            built = json.loads(build_design(str(design)).read_text(encoding="utf-8"))
            self.assertEqual(built["id"], "test-design")
            self.assertEqual(built["parts"][0]["id"], "body")

    def test_input_hashes_only_allowlisted_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            design = self._make_design(
                Path(tmp),
                "from build123d import Box\n\ndef build():\n    return Box(2, 2, 2)\n",
            )
            (design / "stray.py").write_text("print('not a build input')\n", encoding="utf-8")
            manifest = json.loads((design / "design.json").read_text(encoding="utf-8"))
            hashes = build_input_hashes(design, manifest)
            self.assertEqual(set(hashes), {"design.json", "params.py", "parts/body.py"})
            (design / "stray.py").write_text("print('changed')\n", encoding="utf-8")
            self.assertEqual(build_input_hashes(design, manifest), hashes)

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
            with patch("cad_build.import_step", return_value=invalid):
                with self.assertRaisesRegex(ValueError, "STEP round-trip produced invalid geometry"):
                    build_design(str(design))
            self.assertEqual(
                (design / "manifest.json").read_text(encoding="utf-8"),
                first_manifest,
            )
            self.assertEqual((design / ".artifacts" / "current").readlink(), first_generation)
            self.assertTrue((design / "step" / "body.step").is_file())

    def test_input_mutation_during_build_is_not_published(self):
        with tempfile.TemporaryDirectory() as tmp:
            design = self._make_design(
                Path(tmp),
                "from build123d import Box\n"
                "from params import SIZE\n\n"
                "def build():\n"
                "    return Box(SIZE, SIZE, SIZE)\n",
            )
            build_design(str(design))
            first_generation = (design / ".artifacts" / "current").readlink()
            first_manifest = (design / "manifest.json").read_text(encoding="utf-8")

            def export_then_mutate(*args, **kwargs):
                result = export_part(*args, **kwargs)
                (design / "params.py").write_text("SIZE = 20.0\n", encoding="utf-8")
                return result

            with patch("cad_build.export_part", side_effect=export_then_mutate):
                with self.assertRaisesRegex(ValueError, "inputs changed during build"):
                    build_design(str(design))

            self.assertEqual((design / ".artifacts" / "current").readlink(), first_generation)
            self.assertEqual((design / "manifest.json").read_text(encoding="utf-8"), first_manifest)
            generations = [
                path
                for path in (design / ".artifacts").iterdir()
                if path.is_dir() and not path.is_symlink()
            ]
            self.assertEqual(generations, [design / ".artifacts" / first_generation])

    def test_successful_builds_retain_only_current_and_previous_generations(self):
        with tempfile.TemporaryDirectory() as tmp:
            design = self._make_design(
                Path(tmp),
                "from build123d import Box\n"
                "from params import SIZE\n\n"
                "def build():\n"
                "    return Box(SIZE, SIZE, SIZE)\n",
            )
            generations = []
            for _ in range(4):
                build_design(str(design))
                generations.append((design / ".artifacts" / "current").readlink())

            retained = {
                path.name
                for path in (design / ".artifacts").iterdir()
                if path.is_dir() and not path.is_symlink()
            }
            self.assertEqual(retained, {str(generation) for generation in generations[-2:]})
            self.assertTrue((design / ".artifacts" / "current").resolve().is_dir())

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
            with patch("cad_build.import_step", return_value=empty):
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
                    with patch("cad_build.import_step", return_value=imported):
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
