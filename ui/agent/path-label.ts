/** Compact path for the composer footer; full path stays in the title tooltip. */
export function compactDirectoryLabel(directory: string, home?: string): string {
  const path = directory.trim().replace(/\/+$/, "") || directory.trim()
  if (!path) return directory
  const root = home?.trim().replace(/\/+$/, "") || ""
  if (root && path === root) return "Home"
  if (root && path.startsWith(`${root}/`)) {
    const rest = path.slice(root.length + 1)
    const parts = rest.split("/").filter(Boolean)
    if (parts.length <= 2) return `~/${rest}`
    return `~/…/${parts.slice(-2).join("/")}`
  }
  const parts = path.split("/").filter(Boolean)
  if (parts.length <= 3) return path.startsWith("/") ? path : `/${parts.join("/")}`
  return `…/${parts.slice(-2).join("/")}`
}
