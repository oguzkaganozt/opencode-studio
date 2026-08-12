const COMMANDS = ["up", "status", "repair", "ensure-host", "remove", "upgrade"] as const

function shellIdent(binName: string) {
  return binName.replaceAll("-", "_")
}

export function bashCompletionScript(binName = "opencode-studio") {
  const id = shellIdent(binName)
  return [
    `_${id}_completion() {`,
    `  local cur prev words cword`,
    `  _init_completion || return`,
    `  local commands="${COMMANDS.join(" ")}"`,
    `  local common="--workspace --json --help -h"`,
    `  local cmd=""`,
    `  for ((i=1; i < cword; i++)); do`,
    `    case "\${words[i]}" in`,
    `      ${COMMANDS.join("|")}) cmd="\${words[i]}"; break ;;`,
    `    esac`,
    `  done`,
    `  if [[ -z "$cmd" ]]; then`,
    `    COMPREPLY=($(compgen -W "$commands --help -h --version -v" -- "$cur"))`,
    `    return`,
    `  fi`,
    `  case "$cmd" in`,
    `    up|ensure-host) COMPREPLY=($(compgen -W "--help -h" -- "$cur")) ;;`,
    `    status|remove) COMPREPLY=($(compgen -W "$common" -- "$cur")) ;;`,
    `    repair) COMPREPLY=($(compgen -W "$common --dry-run" -- "$cur")) ;;`,
    `    upgrade) COMPREPLY=($(compgen -W "--check --yes -y --json --help -h" -- "$cur")) ;;`,
    `  esac`,
    `}`,
    `complete -F _${id}_completion ${binName}`,
    "",
  ].join("\n")
}

export function zshCompletionScript(binName = "opencode-studio") {
  const id = shellIdent(binName)
  const commandWords = COMMANDS.map((c) => `'${c}'`).join(" ")
  return [
    `#compdef ${binName}`,
    `_${id}() {`,
    `  local -a commands`,
    `  commands=(${commandWords})`,
    `  _arguments -C \\`,
    `    '(-h --help)'{-h,--help} \\`,
    `    '(-v --version)'{-v,--version} \\`,
    `    '1:command:($commands)' \\`,
    `    '*::arg:->args'`,
    `  case $words[1] in`,
    `    up|ensure-host)`,
    `      _arguments '(-h --help)'{-h,--help} ;;`,
    `    status|remove)`,
    `      _arguments '--workspace[Domain data root]:path:_files -/' '--json' '(-h --help)'{-h,--help} ;;`,
    `    repair)`,
    `      _arguments '--workspace[Domain data root]:path:_files -/' '--dry-run' '--json' '(-h --help)'{-h,--help} ;;`,
    `    upgrade)`,
    `      _arguments '--check' '(-y --yes)'{-y,--yes} '--json' '(-h --help)'{-h,--help} ;;`,
    `    esac`,
    `}`,
    `compdef _${id} ${binName}`,
    "",
  ].join("\n")
}
