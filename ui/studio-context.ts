export type StudioRuntime = {
  studioId: string
  apiBase: string
  uiBase: string
}

const KEY = "__OPENCODE_STUDIO__"

export function setStudioRuntime(runtime: StudioRuntime) {
  ;(window as any)[KEY] = runtime
}

export function clearStudioRuntime() {
  delete (window as any)[KEY]
}

export function getStudioRuntime(): StudioRuntime | undefined {
  return (window as any)[KEY] as StudioRuntime | undefined
}

export function apiBase(fallback = "/api") {
  return getStudioRuntime()?.apiBase ?? fallback
}

export function uiBase(fallback = "/") {
  return getStudioRuntime()?.uiBase ?? fallback
}

export function apiUrl(path: string) {
  const base = apiBase().replace(/\/$/, "")
  const suffix = path.startsWith("/") ? path : `/${path}`
  return `${base}${suffix}`
}

/** Absolute path under the current studio UI mount (host or standalone root). */
export function studioHref(path = "") {
  const base = uiBase("").replace(/\/$/, "")
  const suffix = path.replace(/^\//, "")
  if (!base) return suffix ? `/${suffix}` : "/"
  return suffix ? `${base}/${suffix}` : base
}
