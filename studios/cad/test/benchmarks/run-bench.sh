#!/usr/bin/env bash
# Launch a CAD benchmark with line-flushed event logs (avoids nohup stdout stall).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
Usage:
  run-bench.sh --name <run-name> --model <provider/model> [--file <path>] [--dir <workdir>] <prompt...>

Example:
  run-bench.sh --name wall-sconce-v0 --model xai/grok-4.5 \
    --file studios/cad/test/benchmarks/wall-sconce-frosted-glass.png \
    --dir "$HOME" \
    "$(cat studios/cad/test/benchmarks/wall-sconce-v0.md | sed -n '/^```text$/,/^```$/p' | sed '1d;$d')"
EOF
  exit 2
}

NAME=""
MODEL="xai/grok-4.5"
AGENT="studio-cad"
WORKDIR="${HOME}"
FILE_ARGS=()
PROMPT_PARTS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) NAME="${2:-}"; shift 2 ;;
    --model) MODEL="${2:-}"; shift 2 ;;
    --agent) AGENT="${2:-}"; shift 2 ;;
    --dir) WORKDIR="${2:-}"; shift 2 ;;
    --file) FILE_ARGS+=(-f "${2:-}"); shift 2 ;;
    -h|--help) usage ;;
    --) shift; PROMPT_PARTS+=("$@"); break ;;
    *) PROMPT_PARTS+=("$1"); shift ;;
  esac
done

[[ -n "$NAME" ]] || usage
[[ ${#PROMPT_PARTS[@]} -gt 0 ]] || usage
PROMPT="${PROMPT_PARTS[*]}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="studios/cad/test/benchmarks/runs/${NAME}_${MODEL//\//-}_${TS}"
OUT="${OUT// /_}"
mkdir -p "$OUT"
printf '%s\n' "$PROMPT" >"$OUT/prompt.txt"
printf '%s\n' "$MODEL" >"$OUT/model.txt"
printf '%s\n' "$AGENT" >"$OUT/agent.txt"
date -u +%Y-%m-%dT%H:%M:%SZ >"$OUT/started_at.txt"
printf '%s\n' "$OUT" >studios/cad/test/benchmarks/runs/LATEST

export PYTHONUNBUFFERED=1
# Prefer a PTY so Node/bun line-flushes JSON events (plain pipes block-buffer).
# Message is a single positional after -- so -f array flags cannot swallow it.
run_opencode() {
  local cmd=(
    opencode run
    --agent "$AGENT"
    -m "$MODEL"
    --auto
    --format json
    --title "bench-${NAME}"
    --dir "$WORKDIR"
  )
  if [[ ${#FILE_ARGS[@]} -gt 0 ]]; then
    cmd+=("${FILE_ARGS[@]}")
  fi
  cmd+=(-- "$PROMPT")

  if command -v script >/dev/null 2>&1; then
    # util-linux script: -q quiet, -f flush, -e child exit, -c command
    script -q -f -e -c "$(printf '%q ' "${cmd[@]}")" /dev/null
  elif command -v stdbuf >/dev/null 2>&1; then
    stdbuf -oL -eL "${cmd[@]}"
  else
    "${cmd[@]}"
  fi
}

# shellcheck disable=SC2094
run_opencode >"$OUT/events.jsonl" 2>"$OUT/stderr.txt"
EC=$?
date -u +%Y-%m-%dT%H:%M:%SZ >"$OUT/ended_at.txt"
echo "$EC" >"$OUT/exit_code.txt"
python3 studios/cad/test/benchmarks/score-run.py "$OUT" >/dev/null 2>&1 || true
echo "exit=$EC out=$OUT"
exit "$EC"
