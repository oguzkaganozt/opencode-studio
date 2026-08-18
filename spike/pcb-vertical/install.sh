#!/usr/bin/env bash
set -euo pipefail
archive="${1:?usage: install.sh <pcb-only.tar.gz> [dest]}"
dest="${2:-"${HOME}/.local/share/studio-pcb-spike"}"
mkdir -p "$dest"
tar -xzf "$archive" -C "$dest" --strip-components=1
if tar -tzf "$archive" | grep -E 'studios/(cad|concept|fw)|design-system|opencode-plugin' >/dev/null; then
  echo "archive contains non-PCB product files" >&2
  exit 1
fi
echo "installed $dest"
