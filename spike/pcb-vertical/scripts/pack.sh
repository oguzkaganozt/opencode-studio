#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-"$root/dist/pcb-only.tar.gz"}"
mkdir -p "$(dirname "$out")"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/pcb"
cp "$root/package.json" "$root/tsconfig.json" "$root/README.md" "$root/install.sh" "$tmp/pcb/"
cp -R "$root/src" "$tmp/pcb/src"
mkdir -p "$tmp/pcb/engine"
cp "$root/engine/package.json" "$root/engine/run.mjs" "$tmp/pcb/engine/"
cp -R "$root/engine/fixtures" "$tmp/pcb/engine/fixtures"
tar -C "$tmp" -czf "$out" pcb
echo "$out"
