/** A domain handoff can target one project without changing the fixed Studio Home. */
export function resolveAgentDirectory(directory: string | undefined, studioRoot: string): string {
  return directory?.trim() || studioRoot
}
