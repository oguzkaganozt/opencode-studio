"""Restricted params.py AST: numbers, uppercase names, + - * / // % **, parens."""

from __future__ import annotations

import ast
from typing import Any

_ALLOWED_BINOPS = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow)
_ALLOWED_UNARY = (ast.UAdd, ast.USub)


class ParamError(ValueError):
    pass


def _eval_node(node: ast.AST, env: dict[str, float]) -> float:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        value = float(node.value)
        if not (value == value and abs(value) != float("inf")):
            raise ParamError("parameter values must be finite numbers")
        return value
    if isinstance(node, ast.Name):
        if node.id not in env:
            raise ParamError(f"unknown parameter {node.id}")
        return env[node.id]
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, _ALLOWED_UNARY):
        value = _eval_node(node.operand, env)
        return value if isinstance(node.op, ast.UAdd) else -value
    if isinstance(node, ast.BinOp) and isinstance(node.op, _ALLOWED_BINOPS):
        left = _eval_node(node.left, env)
        right = _eval_node(node.right, env)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Div):
            return left / right
        if isinstance(node.op, ast.FloorDiv):
            return left // right
        if isinstance(node.op, ast.Mod):
            return left % right
        return left**right
    raise ParamError("params.py only allows numbers, uppercase names, + - * / // % **, and parentheses")


def resolve_params(source: str) -> dict[str, float]:
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        raise ParamError(f"params.py is not valid Python: {exc}") from exc
    env: dict[str, float] = {}
    for stmt in tree.body:
        if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant) and stmt.value.value is None:
            continue
        if not isinstance(stmt, ast.Assign) or len(stmt.targets) != 1 or not isinstance(stmt.targets[0], ast.Name):
            raise ParamError("params.py may only assign uppercase names to numeric expressions")
        name = stmt.targets[0].id
        if name != name.upper() or not name.isidentifier():
            raise ParamError(f"parameter {name} must be an uppercase identifier")
        env[name] = _eval_node(stmt.value, env)
    return env


def resolve_scalar(value: Any, env: dict[str, float], label: str) -> float:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        number = float(value)
        if number != number or abs(number) == float("inf"):
            raise ParamError(f"{label} must be finite")
        return number
    if isinstance(value, dict) and isinstance(value.get("param"), str):
        name = value["param"]
        if name not in env:
            raise ParamError(f"{label} references unknown parameter {name}")
        return env[name]
    raise ParamError(f"{label} must be a number or {{param: NAME}}")
