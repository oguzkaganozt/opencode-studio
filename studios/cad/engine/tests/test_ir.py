import tempfile
import unittest
from pathlib import Path

from cad_runtime.ir.compile import compile_document
from cad_runtime.ir.params import resolve_params
from cad_runtime.ir.schema import IrError, validate_document


class IrCompileTest(unittest.TestCase):
    def test_resolves_restricted_params(self):
        env = resolve_params("BODY_X = 100\nWALL = 2\nINNER = BODY_X - 2 * WALL\n")
        self.assertEqual(env["INNER"], 96.0)

    def test_compiles_box_and_hole(self):
        source = compile_document(
            {
                "schema": 1,
                "part": "body",
                "params": ["BODY_X"],
                "ops": [
                    {"op": "primitive", "id": "box", "kind": "box", "size": [{"param": "BODY_X"}, 70, 30], "origin": [0, 0, 0]},
                    {
                        "op": "hole",
                        "id": "usb",
                        "on": "box",
                        "origin": [50, 0, 15],
                        "direction": "Y",
                        "diameter": 8,
                        "depth": "through",
                    },
                ],
                "show": "usb",
            },
            "BODY_X = 100\n",
        )
        self.assertIn("Box(100.0, 70.0, 30.0)", source)
        self.assertIn("return usb", source)
        self.assertNotIn("from params import", source)

    def test_rejects_ruled_loft(self):
        with self.assertRaises(IrError):
            validate_document(
                {
                    "schema": 1,
                    "part": "shell",
                    "params": [],
                    "ops": [
                        {
                            "op": "loft",
                            "id": "body",
                            "axis": "Z",
                            "ruled": True,
                            "stations": [
                                {"t": 0, "profile": {"kind": "circle", "diameter": 10}},
                                {"t": 10, "profile": {"kind": "circle", "diameter": 12}},
                                {"t": 20, "profile": {"kind": "circle", "diameter": 8}},
                            ],
                        }
                    ],
                    "show": "body",
                }
            )


if __name__ == "__main__":
    unittest.main()
