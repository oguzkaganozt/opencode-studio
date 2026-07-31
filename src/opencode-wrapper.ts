import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

const MARKER = "# opencode-studio ensure-host wrapper"

export function opencodeWrapperScript(): string {
  return `#!/usr/bin/env bash
${MARKER}
# Starts Studio host (default HOME) alongside \`opencode serve\`, stops it when serve exits.
set -euo pipefail

REAL=""
if [[ -x "\${HOME}/.opencode/bin/opencode" ]]; then
  REAL="\${HOME}/.opencode/bin/opencode"
else
  IFS=':' read -ra __PATH_PARTS <<< "\${PATH}"
  for __d in "\${__PATH_PARTS[@]}"; do
    __cand="\${__d}/opencode"
    [[ -x "\$__cand" && "\$__cand" != "\$0" ]] || continue
    if grep -q "opencode-studio ensure-host wrapper" "\$__cand" 2>/dev/null; then
      continue
    fi
    REAL="\$__cand"
    break
  done
fi

if [[ -z "\$REAL" ]]; then
  echo "opencode-studio wrapper: could not find real opencode binary" >&2
  exit 127
fi

ENSURE_PID=""
cleanup() {
  if [[ -n "\${ENSURE_PID}" ]] && kill -0 "\${ENSURE_PID}" 2>/dev/null; then
    kill "\${ENSURE_PID}" 2>/dev/null || true
    wait "\${ENSURE_PID}" 2>/dev/null || true
  fi
}

if [[ "\${1:-}" == "serve" ]] && command -v opencode-studio >/dev/null 2>&1; then
  nohup opencode-studio ensure-host >>"\${TMPDIR:-/tmp}/opencode-studio-ensure-host.log" 2>&1 &
  ENSURE_PID=\$!
  trap cleanup EXIT INT TERM
fi

exec "\$REAL" "\$@"
`
}

/** Install PATH wrapper so `opencode serve` brings up Studio host automatically. */
export async function installOpencodeServeWrapper(): Promise<{ path: string; wrote: boolean }> {
  const dir = path.join(homedir(), ".local", "bin")
  await mkdir(dir, { recursive: true, mode: 0o755 })
  const target = path.join(dir, "opencode")
  const next = opencodeWrapperScript()
  let wrote = true
  try {
    const prev = await readFile(target, "utf8")
    if (prev === next) wrote = false
    else if (!prev.includes("opencode-studio ensure-host wrapper")) {
      return { path: target, wrote: false }
    }
  } catch {
    // missing
  }
  if (wrote) {
    await writeFile(target, next, { mode: 0o755 })
    await chmod(target, 0o755)
  }
  return { path: target, wrote }
}
