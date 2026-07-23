import { readFile } from "node:fs/promises"
import path from "node:path"
import manifest from "../package.json" with { type: "json" }

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const REGISTRY_URL = `https://registry.npmjs.org/${manifest.name}/latest`

export type VersionInfo = {
  running: string
  installed: string
  latest: string | null
  updateAvailable: boolean
  restartRequired: boolean
  updateCommand: string
}

export function compareVersions(left: string, right: string) {
  const [leftCore, leftPre] = left.split("-", 2)
  const [rightCore, rightPre] = right.split("-", 2)
  const leftParts = leftCore!.split(".").map(Number)
  const rightParts = rightCore!.split(".").map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return Math.sign(difference)
  }
  if (leftPre === undefined && rightPre !== undefined) return 1
  if (leftPre !== undefined && rightPre === undefined) return -1
  const leftIdentifiers = (leftPre ?? "").split(".")
  const rightIdentifiers = (rightPre ?? "").split(".")
  for (let index = 0; index < Math.max(leftIdentifiers.length, rightIdentifiers.length); index += 1) {
    const leftIdentifier = leftIdentifiers[index]
    const rightIdentifier = rightIdentifiers[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    if (leftIdentifier === rightIdentifier) continue
    const leftNumeric = /^\d+$/.test(leftIdentifier)
    const rightNumeric = /^\d+$/.test(rightIdentifier)
    if (leftNumeric && rightNumeric) return Math.sign(Number(leftIdentifier) - Number(rightIdentifier))
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftIdentifier.localeCompare(rightIdentifier, "en-US")
  }
  return 0
}

type VersionFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export function createVersionProvider(input: {
  installRoot?: string
  scope: "system" | "user"
  fetcher?: VersionFetcher
  now?: () => number
  readManifest?: (filePath: string) => Promise<string>
}) {
  const fetcher = input.fetcher ?? fetch
  const now = input.now ?? Date.now
  const readManifest = input.readManifest ?? ((filePath: string) => readFile(filePath, "utf8"))
  let latest: { version: string | null; checkedAt: number } | undefined

  return async (): Promise<VersionInfo> => {
    let installed = manifest.version
    if (input.installRoot) {
      try {
        const text = await readManifest(path.join(input.installRoot, "current", "node_modules", manifest.name, "package.json"))
        const parsed = JSON.parse(text) as { version?: unknown }
        if (typeof parsed.version === "string") installed = parsed.version
      } catch {
        // A manually started companion may not use a managed installation.
      }
    }

    if (!latest || now() - latest.checkedAt >= CHECK_INTERVAL_MS) {
      try {
        const response = await fetcher(REGISTRY_URL, { signal: AbortSignal.timeout(3000) })
        if (!response.ok) throw new Error(`npm registry returned ${response.status}`)
        const body = (await response.json()) as { version?: unknown }
        latest = { version: typeof body.version === "string" ? body.version : null, checkedAt: now() }
      } catch {
        latest = { version: null, checkedAt: now() }
      }
    }

    return {
      running: manifest.version,
      installed,
      latest: latest.version,
      updateAvailable: latest.version !== null && compareVersions(latest.version, installed) > 0,
      restartRequired: installed !== manifest.version,
      updateCommand: input.scope === "system" ? `sudo ${manifest.name} service-update` : `${manifest.name} service-update`,
    }
  }
}

export function staticVersionInfo(): VersionInfo {
  return {
    running: manifest.version,
    installed: manifest.version,
    latest: null,
    updateAvailable: false,
    restartRequired: false,
    updateCommand: `${manifest.name} service-update`,
  }
}
