import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

from forge_cli import build_design


DESIGNS = Path(__file__).resolve().parents[2] / "designs"


def load_shapes(design_id: str):
    design = DESIGNS / design_id
    manifest = json.loads((design / "design.json").read_text(encoding="utf-8"))
    sys.modules.pop("params", None)
    sys.path.insert(0, str(design))
    try:
        shapes = {}
        for part in manifest["parts"]:
            spec = importlib.util.spec_from_file_location(f"example_{design_id}_{part['id']}", design / part["source"])
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            shapes[part["id"]] = module.build()
        return shapes
    finally:
        sys.path.remove(str(design))
        sys.modules.pop("params", None)


class ExampleDesignTest(unittest.TestCase):
    def test_example_designs_build_successfully(self):
        for design_id in ("box-lid-demo", "organizer-box"):
            with self.subTest(design=design_id), tempfile.TemporaryDirectory() as tmp:
                source = DESIGNS / design_id
                design = Path(tmp) / design_id
                design.mkdir()
                shutil.copy2(source / "design.json", design / "design.json")
                shutil.copy2(source / "params.py", design / "params.py")
                shutil.copytree(source / "parts", design / "parts")
                manifest_path = build_design(str(design))
                self.assertTrue(manifest_path.is_file())

    def test_every_part_is_one_connected_solid(self):
        for design_id in ("box-lid-demo", "organizer-box"):
            with self.subTest(design=design_id):
                for part_id, shape in load_shapes(design_id).items():
                    self.assertEqual(len(shape.solids()), 1, f"{design_id}/{part_id} is disconnected")

    def test_organizer_has_no_pairwise_interference(self):
        shapes = load_shapes("organizer-box")
        ids = list(shapes)
        for index, left in enumerate(ids):
            for right in ids[index + 1 :]:
                with self.subTest(left=left, right=right):
                    self.assertLessEqual((shapes[left] & shapes[right]).volume, 0.001)

    def test_lids_overlap_body_rims(self):
        box = load_shapes("box-lid-demo")
        organizer = load_shapes("organizer-box")
        self.assertGreater(box["lid"].bounding_box().size.X, 60 - 2 * 1.6)
        self.assertGreater(organizer["lid"].bounding_box().size.X, 80 - 2 * 1.6)


if __name__ == "__main__":
    unittest.main()
