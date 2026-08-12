import json
import tempfile
import unittest
from pathlib import Path


class CadRuntimeNamespaceTests(unittest.TestCase):
    def test_registry_names_bind_into_execute(self) -> None:
        from build123d import Box
        from cad_runtime.session import Session

        session = Session(exec_timeout=30)
        session.objects["body"] = Box(10, 10, 10)
        out = session.execute(
            "assert 'body' in cad_objects\n"
            "assert cad_object('body') is body\n"
            "assert body.volume > 0\n"
            "print('bound-ok', round(body.volume, 1))"
        )
        self.assertNotIn("Error:", out)
        self.assertIn("bound-ok", out)

    def test_invalid_identifiers_via_cad_object(self) -> None:
        from build123d import Box
        from cad_runtime.session import Session

        session = Session(exec_timeout=30)
        session.objects["part-1"] = Box(2, 2, 2)
        out = session.execute(
            "p = cad_object('part-1')\n"
            "assert p.volume > 0\n"
            "print('alias-ok')"
        )
        self.assertNotIn("Error:", out)
        self.assertIn("alias-ok", out)

    def test_build123d_preloaded_without_import(self) -> None:
        from cad_runtime.session import Session

        session = Session(exec_timeout=30)
        out = session.execute(
            "b = Box(4, 5, 6)\n"
            "assert b.volume > 0\n"
            "print('preseed-ok', round(b.volume, 1))"
        )
        self.assertNotIn("Error:", out)
        self.assertIn("preseed-ok", out)

    def test_design_params_bind_into_execute(self) -> None:
        from cad_runtime.session import Session

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "params.py").write_text("BOX_L = 100.0\nWALL = 2.0\n", encoding="utf-8")
            session = Session(exec_timeout=30)
            bound = json.loads(session.bind_design_dir(str(root)))
            self.assertTrue(bound["ok"])
            self.assertTrue(bound["params"])
            out = session.execute(
                "assert BOX_L == 100.0\n"
                "assert params.WALL == 2.0\n"
                "print('params-ok', BOX_L, params.WALL)"
            )
            self.assertNotIn("Error:", out)
            self.assertIn("params-ok", out)

    def test_analyze_form_contract_pass_and_box_near_prismatic(self) -> None:
        from build123d import Box
        from cad_runtime.tools.analyze_form import analyze_form
        from cad_runtime.session import Session

        session = Session(exec_timeout=30)
        # Centered box: world Z in [-50, 50]; from_min maps brief t=0..100 onto that span.
        session.objects["block"] = Box(40, 28, 100)
        out = analyze_form(session, object_name="block", axis="Z", num_stations=4)
        self.assertIn("near_prismatic", out)
        data = json.loads(out.split("\n\n", 1)[1])
        self.assertEqual(data["status"], "unverified")
        self.assertEqual(data["t_mode"], "from_min")
        self.assertGreaterEqual(len(data["stations"]), 2)

        # Brief-style contract (0..H from axis min) on a centered solid must pass.
        brief = analyze_form(
            session,
            object_name="block",
            axis="Z",
            contract="5:40x28, 50:40x28, 95:40x28",
            tol_mm=1.0,
        )
        bdata = json.loads(brief.split("\n\n", 1)[1])
        self.assertEqual(bdata["status"], "pass", brief)
        self.assertTrue(bdata["contract_matched"])

        # Rebuild contract from measured from_min stations.
        mids = data["stations"]
        contract = ",".join(f"{s['t_from_min']}:{s['width']}x{s['depth']}" for s in mids)
        matched = analyze_form(session, object_name="block", axis="Z", contract=contract, tol_mm=0.5)
        mdata = json.loads(matched.split("\n\n", 1)[1])
        self.assertEqual(mdata["status"], "pass")
        self.assertTrue(mdata["contract_matched"])

        bad = analyze_form(
            session,
            object_name="block",
            axis="Z",
            contract="0:10x10, 50:10x10, 100:10x10",
            tol_mm=1.0,
        )
        fail_data = json.loads(bad.split("\n\n", 1)[1])
        self.assertEqual(fail_data["status"], "fail")

    def test_repair_hints_for_rotated_and_chamfer_api(self) -> None:
        from cad_runtime.tools.execute import execute_code
        from cad_runtime.session import Session

        session = Session(exec_timeout=30)
        rotated = execute_code(session, "Box(1,1,1).rotated(90)")
        self.assertIn("Error:", rotated)
        self.assertIn("rotated_attr", rotated)
        self.assertIn("rotate", rotated.lower())

        chamfer = execute_code(session, "Box(10,10,10).chamfer(0.5)")
        self.assertIn("Error:", chamfer)
        self.assertTrue("fillet_api" in chamfer or "edge_list" in chamfer or "chamfer" in chamfer.lower())

    def test_locate_surface_and_boolean_status(self) -> None:
        from build123d import Box, Pos
        from cad_runtime.session import Session
        from cad_runtime.tools.surface_locate import boolean_status, locate_surface

        body = Box(40, 20, 30)
        hit = locate_surface(body, side="back")
        self.assertLess(hit["normal"][1], -0.5)  # back ~ -Y
        self.assertGreater(hit["face_area"], 1.0)
        self.assertIn("outset_point", hit)

        # Cutter fully outside → noop cut diagnosis
        before = body
        cutter = Pos(0, -40, 0) * Box(10, 10, 10)
        after = before - cutter
        st = boolean_status(before, after, cutter=cutter)
        self.assertTrue(st["noop"])
        self.assertEqual(st.get("diagnosis"), "cutter_outside_solid")

        session = Session(exec_timeout=30)
        out = session.execute(
            "body = Box(40, 20, 30)\n"
            "show(body, 'body')\n"
            "hit = locate_surface(body, side='back')\n"
            "assert hit['normal'][1] < -0.5\n"
            "before = body\n"
            "cutter = Pos(0, -40, 0) * Box(8, 8, 8)\n"
            "body2 = body - cutter\n"
            "st = boolean_status(before, body2, cutter=cutter)\n"
            "print('loc-ok', round(hit['point'][1], 1), st['diagnosis'])\n"
            "show(body2, 'body')\n"
        )
        self.assertNotIn("Error:", out)
        self.assertIn("loc-ok", out)
        self.assertIn("cutter_outside_solid", out)
        # near-identical rebound should warn
        self.assertTrue(
            "boolean may have missed" in out or "almost unchanged" in out or "cutter_outside" in out
        )


if __name__ == "__main__":
    unittest.main()
