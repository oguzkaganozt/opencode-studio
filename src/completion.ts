const COMMANDS = ["status", "repair", "warm", "remove", "upgrade"] as const

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
    `    COMPREPLY=($(compgen -W "$commands" -- "$cur"))`,
    `    return`,
    `  fi`,
    `  case "$cmd" in`,
    `    status|remove) COMPREPLY=($(compgen -W "$common" -- "$cur")) ;;`,
    `    repair) COMPREPLY=($(compgen -W "$common --dry-run" -- "$cur")) ;;`,
    `    warm) COMPREPLY=($(compgen -W "--json --help -h" -- "$cur")) ;;`,
    `    upgrade) COMPREPLY=($(compgen -W "--check --json --help -h" -- "$cur")) ;;`,
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
    `    '1:command:($commands)' \\`,
    `    '*::arg:->args'`,
    `  case $words[1] in`,
    `    status|remove)`,
    `      _arguments '--workspace[Domain data root]:path:_files -/' '--json' '(-h --help)'{-h,--help} ;;`,
    `    repair)`,
    `      _arguments '--workspace[Domain data root]:path:_files -/' '--dry-run' '--json' '(-h --help)'{-h,--help} ;;`,
    `    warm)`,
    `      _arguments '--json' '(-h --help)'{-h,--help} ;;`,
    `    upgrade)`,
    `      _arguments '--check' '--json' '(-h --help)'{-h,--help} ;;`,
    `  esac`,
    `}`,
    `_${id}`,
    "",
  ].join("\n")
}
