"""CAD IR v2: schema, param AST, compile-to-Python."""

from cad_runtime.ir.compile import compile_document, compile_part
from cad_runtime.ir.schema import IR_DOCS, IrError, validate_document

__all__ = ["IR_DOCS", "IrError", "compile_document", "compile_part", "validate_document"]
