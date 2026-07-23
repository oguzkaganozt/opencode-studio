import { describe, expect, test } from "bun:test"
import manifest from "../package.json" with { type: "json" }
import { compareVersions, createVersionProvider } from "../src/version"

describe("companion version status", () => {
  test("orders stable and prerelease versions using semver precedence", () => {
    expect(compareVersions("1.0.0", "1.0.0-beta.10")).toBe(1)
    expect(compareVersions("1.0.0-beta.10", "1.0.0-beta.2")).toBe(1)
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBe(-1)
    expect(compareVersions("1.0.0-beta", "1.0.0-beta")).toBe(0)
  })

  test("reports available updates and caches npm checks", async () => {
    let requests = 0
    let now = 1_000
    const provider = createVersionProvider({
      installRoot: "/managed",
      scope: "system",
      now: () => now,
      readManifest: async () => JSON.stringify({ version: manifest.version }),
      fetcher: async () => {
        requests += 1
        return Response.json({ version: "9.9.9" })
      },
    })

    expect(await provider()).toMatchObject({
      running: manifest.version,
      installed: manifest.version,
      latest: "9.9.9",
      updateAvailable: true,
      restartRequired: false,
      updateCommand: "sudo opencode-media-studio service-update",
    })
    await provider()
    expect(requests).toBe(1)
    now += 6 * 60 * 60 * 1000
    await provider()
    expect(requests).toBe(2)
  })

  test("distinguishes an installed release waiting for companion restart", async () => {
    const provider = createVersionProvider({
      installRoot: "/managed",
      scope: "user",
      readManifest: async () => JSON.stringify({ version: "9.9.9" }),
      fetcher: async () => Response.json({ version: "9.9.9" }),
    })
    expect(await provider()).toMatchObject({
      running: manifest.version,
      installed: "9.9.9",
      updateAvailable: false,
      restartRequired: true,
      updateCommand: "opencode-media-studio service-update",
    })
  })

  test("keeps the companion healthy when npm is unavailable", async () => {
    const provider = createVersionProvider({
      scope: "user",
      fetcher: async () => {
        throw new Error("offline")
      },
    })
    expect(await provider()).toMatchObject({
      running: manifest.version,
      installed: manifest.version,
      latest: null,
      updateAvailable: false,
      restartRequired: false,
    })
  })

  test("does not advertise npm latest as an update when installed is newer", async () => {
    const provider = createVersionProvider({
      installRoot: "/managed",
      scope: "user",
      readManifest: async () => JSON.stringify({ version: "9.9.9" }),
      fetcher: async () => Response.json({ version: "1.0.0" }),
    })
    expect(await provider()).toMatchObject({ updateAvailable: false, restartRequired: true })
  })
})
