import importlib.util
import unittest
from pathlib import Path


TARGET = Path(__file__).resolve().parent / "fixtures" / "organic-shell" / "target.py"


class OrganicBenchmarkTest(unittest.TestCase):
    def test_reference_target_is_a_variable_section_solid(self):
        spec = importlib.util.spec_from_file_location("organic_benchmark_target", TARGET)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        shape = module.build()

        self.assertTrue(shape.is_valid)
        self.assertEqual(len(shape.solids()), 1)
        bounds = shape.bounding_box().size
        self.assertAlmostEqual(bounds.X, 112.0, delta=0.1)
        self.assertGreater(bounds.Y, 65.0)
        self.assertGreater(bounds.Z, 37.0)

        widths = []
        centres = []
        for x in (-40.0, -15.0, 10.0, 35.0):
            section = shape & module.Plane.YZ.offset(x)
            widths.append(section.bounding_box().size.Y)
            centres.append(section.center().Y)
        self.assertGreater(max(widths) - min(widths), 10.0)
        self.assertGreater(max(centres) - min(centres), 3.0)


if __name__ == "__main__":
    unittest.main()
