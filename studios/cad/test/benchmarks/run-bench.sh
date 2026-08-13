#!/usr/bin/env bash
# Deprecated. Use: bun run bench cad <case>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"
exec bun run bench cad "$@"
