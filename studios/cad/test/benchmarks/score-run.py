#!/usr/bin/env python3
"""Score a CAD benchmark run directory (events.jsonl + on-disk designs)."""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path


def load_events(path: Path) -> list[dict]:
    events = []
    if not path.exists():
        return events
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events


def score(run_dir: Path, designs_root: Path) -> dict:
    events = load_events(run_dir / "events.jsonl")
    tools: Counter[str] = Counter()
    texts: list[str] = []
    first_ts = last_ts = None
    tok_in = tok_out = tok_r = 0.0
    steps = 0
    fails: list[str] = []
    qc_out = None
    design_ids: list[str] = []
    fit_statuses: list[str] = []

    for e in events:
        ts = e.get("timestamp")
        first_ts = first_ts or ts
        last_ts = ts or last_ts
        part = e.get("part") or {}
        et = e.get("type")
        if et == "tool_use" or part.get("type") == "tool":
            tool = part.get("tool") or "?"
            tools[tool] += 1
            st = part.get("state") or {}
            out = str(st.get("output") or "")
            inp = st.get("input") or {}
            if out.startswith("Error:") or tool == "invalid":
                fails.append(f"{tool}: {out[:160].replace(chr(10), ' ')}")
            if tool == "cad_design_create":
                did = inp.get("id")
                if isinstance(did, str):
                    design_ids.append(did)
            if tool == "cad_design_qc_report":
                qc_out = out
            if tool == "cad_compare" and str(inp.get("kind", "")).lower() == "fit":
                try:
                    data = json.loads(out) if out.strip().startswith("{") else {}
                    fit_statuses.append(str(data.get("status") or "?"))
                except json.JSONDecodeError:
                    m = re.search(r'"status"\s*:\s*"([^"]+)"', out)
                    fit_statuses.append(m.group(1) if m else "?")
        if et == "step_finish" or part.get("type") == "step-finish":
            steps += 1
            tok = part.get("tokens") or {}
            tok_in += float(tok.get("input") or 0)
            tok_out += float(tok.get("output") or 0)
            tok_r += float(tok.get("reasoning") or 0)
        if (et == "text" or part.get("type") == "text") and part.get("text"):
            texts.append(part["text"])

    design_id = design_ids[-1] if design_ids else None
    design_dir = designs_root / design_id if design_id else None
    parts = []
    artifacts = {}
    if design_dir and design_dir.is_dir():
        design_json = design_dir / "design.json"
        if design_json.exists():
            try:
                parts = [p.get("id") for p in json.loads(design_json.read_text()).get("parts", [])]
            except json.JSONDecodeError:
                parts = []
        for part_id in parts:
            artifacts[part_id] = {
                "step": (design_dir / "step" / f"{part_id}.step").exists(),
                "stl": (design_dir / "stl" / f"{part_id}.stl").exists(),
                "py": (design_dir / "parts" / f"{part_id}.py").exists(),
            }

    complete = None
    blocked = None
    if qc_out:
        try:
            # qc_report may be pretty JSON
            blob = json.loads(qc_out) if qc_out.strip().startswith("{") else None
            if blob is None:
                m = re.search(r'"complete"\s*:\s*(true|false)', qc_out)
                complete = m.group(1) == "true" if m else None
            else:
                complete = blob.get("complete")
                blocked = blob.get("blockedBy")
        except json.JSONDecodeError:
            m = re.search(r'"complete"\s*:\s*(true|false)', qc_out)
            complete = m.group(1) == "true" if m else None

    final = texts[-1] if texts else ""
    if complete is None and "complete: true" in final.lower():
        complete = True

    dur_s = round((last_ts - first_ts) / 1000, 1) if first_ts and last_ts else None
    report = {
        "run_dir": str(run_dir),
        "design_id": design_id,
        "duration_s": dur_s,
        "steps": steps,
        "tools": dict(tools.most_common()),
        "tool_calls": sum(tools.values()),
        "tokens": {
            "input": int(tok_in),
            "output": int(tok_out),
            "reasoning": int(tok_r),
            "new_approx": int(tok_in + tok_out + tok_r),
        },
        "execute_fails": [f for f in fails if f.startswith("cad_execute") or f.startswith("invalid")],
        "fail_count": len(fails),
        "fit_compare_statuses": fit_statuses,
        "qc": {"complete": complete, "blockedBy": blocked},
        "parts": parts,
        "artifacts": artifacts,
        "checks": {
            "has_build": tools.get("cad_design_build", 0) > 0,
            "has_qc_report": tools.get("cad_design_qc_report", 0) > 0,
            "has_fit_compare": tools.get("cad_compare", 0) > 0,
            "all_step_present": bool(artifacts) and all(v.get("step") for v in artifacts.values()),
            "complete_true": complete is True,
        },
        "final_text_head": final[:400],
    }
    report["score"] = {
        "pass_complete": report["checks"]["complete_true"],
        "pass_artifacts": report["checks"]["all_step_present"],
        "pass_fit_tool_used": report["checks"]["has_fit_compare"],
        "fit_gap_pass_seen": any(s == "pass" for s in fit_statuses),
        "fit_only_contact": fit_statuses and all(s == "unverified" for s in fit_statuses),
    }
    return report


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: score-run.py <run_dir> [designs_root]", file=sys.stderr)
        return 2
    run_dir = Path(sys.argv[1]).resolve()
    designs_root = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else Path.home() / "studio" / "designs"
    report = score(run_dir, designs_root)
    out = run_dir / "score.json"
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"\nWrote {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
