import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

from forge_cli import build_design


DESIGNS = Path(__file__).resolve().parents[2] / "designs"
EXAMPLE_ID = "box-lid-demo"


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
    def test_example_design_builds_successfully(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = DESIGNS / EXAMPLE_ID
            design = Path(tmp) / EXAMPLE_ID
            design.mkdir()
            shutil.copy2(source / "design.json", design / "design.json")
            shutil.copy2(source / "params.py", design / "params.py")
            shutil.copytree(source / "parts", design / "parts")
            manifest_path = build_design(str(design))
            self.assertTrue(manifest_path.is_file())

    def test_every_part_is_one_connected_solid(self):
        for part_id, shape in load_shapes(EXAMPLE_ID).items():
            self.assertEqual(len(shape.solids()), 1, f"{EXAMPLE_ID}/{part_id} is disconnected")

    def test_lid_overlaps_body_rim(self):
        box = load_shapes(EXAMPLE_ID)
        self.assertGreater(box["lid"].bounding_box().size.X, 60 - 2 * 1.6)


if __name__ == "__main__":
    unittest.main()
