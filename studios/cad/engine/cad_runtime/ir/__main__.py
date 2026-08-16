from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from cad_runtime.ir.compile import compile_part
from cad_runtime.ir.schema import IR_DOCS, IrError, validate_document


def main() -> int:
    parser = argparse.ArgumentParser(prog="cad_runtime.ir")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("docs")
    emit = sub.add_parser("emit")
    emit.add_argument("--ir", required=True)
    emit.add_argument("--params", required=True)
    emit.add_argument("--out")
    check = sub.add_parser("validate")
    check.add_argument("--ir", required=True)
    args = parser.parse_args()
    if args.command == "docs":
        print(json.dumps(IR_DOCS, indent=2))
        return 0
    if args.command == "validate":
        validate_document(json.loads(Path(args.ir).read_text(encoding="utf-8")))
        return 0
    try:
        text = compile_part(Path(args.ir), Path(args.params))
    except (IrError, OSError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
