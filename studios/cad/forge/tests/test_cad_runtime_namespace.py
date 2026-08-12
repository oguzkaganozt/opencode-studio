import unittest


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


if __name__ == "__main__":
    unittest.main()
