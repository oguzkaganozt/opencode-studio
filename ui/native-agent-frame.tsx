/** @deprecated iframe agent removed — use ui/agent/AgentPanel. Kept for directory-bind unit tests. */

export function shouldBindAgentDirectory(mounted: boolean, previousDirectory: string | undefined, nextDirectory: string) {
  return !mounted || previousDirectory !== nextDirectory
}
