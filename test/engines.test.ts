import { describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { ensureUv, resolveUv, type UvEnvironment, uvCachePath } from "../src/core/engines"

async function sandbox() {
  const root = await mkdtemp(path.join(tmpdir(), "osc-engines-"))
  const cacheDir = path.join(root, "cache", "bin")
  await mkdir(cacheDir, { recursive: true })
  return {
    root,
    cacheDir,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

function envFor(box: Awaited<ReturnType<typeof sandbox>>, overrides: Partial<UvEnvironment> = {}): UvEnvironment {
  return {
    which: () => null,
    fetch: async () => new Response("unused", { status: 404 }),
    cacheDir: box.cacheDir,
    ...overrides,
  }
}

async function hasTar() {
  const result = Bun.spawnSync(["tar", "--version"], { stdout: "ignore", stderr: "ignore" })
  return result.exitCode === 0
}

/** Build a gzipped tar archive containing a single executable file named `uv`. */
async function uvArchive(box: Awaited<ReturnType<typeof sandbox>>) {
  const staging = path.join(box.root, "staging")
  await mkdir(staging, { recursive: true })
  await writeFile(path.join(staging, "uv"), "#!/bin/sh\necho fake-uv\n")
  await chmod(path.join(staging, "uv"), 0o755)
  const archive = path.join(box.root, "uv.tar.gz")
  const result = Bun.spawnSync(["tar", "-czf", archive, "-C", staging, "uv"], { stdout: "ignore", stderr: "ignore" })
  if (result.exitCode !== 0) throw new Error("tar failed to build fixture archive")
  return archive
}

describe("resolveUv", () => {
  test("returns null when uv is on neither PATH nor cache", async () => {
    const box = await sandbox()
    try {
      expect(resolveUv(envFor(box))).toBeNull()
    } finally {
      await box.cleanup()
    }
  })

  test("returns the cached binary when uv is not on PATH", async () => {
    const box = await sandbox()
    try {
      const cached = path.join(box.cacheDir, "uv")
      await writeFile(cached, "#!/bin/sh\n")
      const resolved = resolveUv(envFor(box))
      expect(resolved).not.toBeNull()
      expect(resolved!.path).toBe(cached)
      expect(resolved!.source).toBe("cache")
    } finally {
      await box.cleanup()
    }
  })

  test("prefers uv on PATH over the cached binary", async () => {
    const box = await sandbox()
    try {
      await writeFile(path.join(box.cacheDir, "uv"), "#!/bin/sh\n")
      const resolved = resolveUv(envFor(box, { which: () => "/usr/local/bin/uv" }))
      expect(resolved!.path).toBe("/usr/local/bin/uv")
      expect(resolved!.source).toBe("path")
    } finally {
      await box.cleanup()
    }
  })
})

describe("ensureUv", () => {
  test("short-circuits when uv is already on PATH", async () => {
    const box = await sandbox()
    try {
      const fetch = envFor(box).fetch
      const resolved = await ensureUv(
        envFor(box, { which: () => "/usr/local/bin/uv", fetch: async () => new Response("must not be called") }),
      )
      expect(resolved.source).toBe("path")
      expect(fetch).toBeDefined()
    } finally {
      await box.cleanup()
    }
  })

  test("rejects on download HTTP error", async () => {
    const box = await sandbox()
    try {
      await expect(ensureUv(envFor(box, { fetch: async () => new Response("nope", { status: 404 }) }))).rejects.toThrow(/HTTP 404/)
    } finally {
      await box.cleanup()
    }
  })

  test("rejects on extraction failure", async () => {
    const box = await sandbox()
    try {
      await expect(ensureUv(envFor(box, { fetch: async () => new Response("not a tar archive", { status: 200 }) }))).rejects.toThrow(
        /Failed to extract/,
      )
    } finally {
      await box.cleanup()
    }
  })

  test("rejects when the release archive lacks the uv binary", async () => {
    const box = await sandbox()
    try {
      if (!(await hasTar())) return
      const archive = path.join(box.root, "empty.tar.gz")
      await mkdir(path.join(box.root, "empty"), { recursive: true })
      const result = Bun.spawnSync(["tar", "-czf", archive, "-C", path.join(box.root, "empty"), "."], {
        stdout: "ignore",
        stderr: "ignore",
      })
      if (result.exitCode !== 0) return
      const bytes = await Bun.file(archive).arrayBuffer()
      await expect(ensureUv(envFor(box, { fetch: async () => new Response(bytes, { status: 200 }) }))).rejects.toThrow(
        /missing from release archive/,
      )
    } finally {
      await box.cleanup()
    }
  })

  test("installs the downloaded binary into the cache", async () => {
    const box = await sandbox()
    try {
      if (!(await hasTar())) return
      const archive = await uvArchive(box)
      const bytes = await Bun.file(archive).arrayBuffer()
      const resolved = await ensureUv(envFor(box, { fetch: async () => new Response(bytes, { status: 200 }) }))
      expect(resolved.source).toBe("cache")
      expect(resolved.path).toBe(path.join(box.cacheDir, "uv"))
      expect(await Bun.file(resolved.path).exists()).toBe(true)
    } finally {
      await box.cleanup()
    }
  })
})

describe("uvCachePath", () => {
  test("resolves under the cache dir", () => {
    expect(uvCachePath()).toContain("opencode-studio")
  })
})
