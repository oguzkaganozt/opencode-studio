import manifest from "../package.json" with { type: "json" }

export type VersionInfo = {
  version: string
}

export function staticVersionInfo(): VersionInfo {
  return { version: manifest.version }
}
