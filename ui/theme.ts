export type ThemePreference = "system" | "light" | "dark"
export type ResolvedTheme = "light" | "dark"

export const THEME_STORAGE_KEY = "opencode-studio.theme"

export function readThemePreference(storage: Pick<Storage, "getItem"> = localStorage): ThemePreference {
  try {
    const raw = storage.getItem(THEME_STORAGE_KEY)
    if (raw === "light" || raw === "dark" || raw === "system") return raw
  } catch {
    /* ignore */
  }
  return "system"
}

export function writeThemePreference(preference: ThemePreference, storage: Pick<Storage, "setItem"> = localStorage) {
  try {
    storage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    /* private mode / quota — preference is best-effort */
  }
}

export function resolveTheme(
  preference: ThemePreference,
  prefersDark: boolean = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)").matches : false,
): ResolvedTheme {
  if (preference === "light") return "light"
  if (preference === "dark") return "dark"
  return prefersDark ? "dark" : "light"
}

export function applyResolvedTheme(theme: ResolvedTheme, root: HTMLElement = document.documentElement) {
  root.dataset.theme = theme
  root.style.colorScheme = theme
}

export function applyThemePreference(
  preference: ThemePreference = readThemePreference(),
  options?: { prefersDark?: boolean; root?: HTMLElement },
): ResolvedTheme {
  const resolved = resolveTheme(preference, options?.prefersDark)
  applyResolvedTheme(resolved, options?.root ?? document.documentElement)
  return resolved
}

export function setThemePreference(preference: ThemePreference): ResolvedTheme {
  writeThemePreference(preference)
  return applyThemePreference(preference)
}

/** Subscribe to OS scheme changes while preference is system. Returns unsubscribe. */
export function subscribeSystemTheme(onChange: () => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)")
  const handler = () => {
    if (readThemePreference() === "system") onChange()
  }
  mq.addEventListener("change", handler)
  return () => mq.removeEventListener("change", handler)
}
