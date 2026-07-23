import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, open, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { initializeLibrary, type LibraryLayout } from "../src/library"
import { allowedHost, createMediaStudioApp, type MediaStudioAppInput } from "../src/server"

const root = path.join(import.meta.dir, ".server-root")
const outside = path.join(import.meta.dir, ".server-outside")
const ui = path.join(import.meta.dir, ".server-ui")
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
const wav = Buffer.from("UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=", "base64")
const host = "127.0.0.1:4173"

let library: LibraryLayout
let imagePath: string

function refFor(relativePath: string) {
  return Buffer.from(relativePath).toString("base64url")
}

function testApp(rootPath: string, extras: Partial<MediaStudioAppInput> = {}) {
  return createMediaStudioApp({
    root: rootPath,
    hostname: "127.0.0.1",
    port: 4173,
    studioId: "media",
    packageVersion: "2.0.0",
    contractVersion: "1.0.0",
    ...extras,
  })
}

function appRequest(app: ReturnType<typeof createMediaStudioApp>, pathOrUrl: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  if (!headers.has("host")) headers.set("host", host)
  return app.request(pathOrUrl, { ...init, headers })
}

beforeEach(async () => {
  library = await initializeLibrary({ root, resolveUsername: () => "alice" })
  imagePath = path.join(library.personal.image, "alpha.jpg")
  await mkdir(path.join(library.root, "users", "bob", "images"), { recursive: true })
  await writeFile(imagePath, png)
  await writeFile(path.join(library.personal.audio, "room.wav"), wav)
  await writeFile(path.join(library.root, "users", "bob", "images", "bravo.png"), png)
  await writeFile(path.join(library.shared.image, "team-photo.png"), png)
  await writeFile(path.join(library.shared.image, "ignore.txt"), "not media")
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
  await rm(ui, { recursive: true, force: true })
})

describe("companion Library API", () => {
  test("scans the fixed Library layout with bounded pagination and filters", async () => {
    const app = testApp(library.root)
    const first = (await (await appRequest(app, "/api/assets?limit=2")).json()) as { assets: Array<{ path: string }>; hasMore: boolean }
    const second = (await (await appRequest(app, "/api/assets?limit=2&offset=2")).json()) as {
      assets: Array<{ path: string }>
      hasMore: boolean
    }

    expect(first.assets).toHaveLength(2)
    expect(first.hasMore).toBe(true)
    expect(second.assets).toHaveLength(2)
    expect(second.hasMore).toBe(false)
    expect([...first.assets, ...second.assets].map((asset) => asset.path)).toEqual([
      "shared/images/team-photo.png",
      "users/alice/audio/room.wav",
      "users/alice/images/alpha.jpg",
      "users/bob/images/bravo.png",
    ])

    const shared = (await (await appRequest(app, "/api/assets?scope=shared&filename=PHOTO")).json()) as { assets: Array<{ path: string }> }
    expect(shared.assets).toEqual([expect.objectContaining({ path: "shared/images/team-photo.png" })])
    const personal = (await (await appRequest(app, "/api/assets?scope=personal&user=alice&modality=audio")).json()) as {
      assets: Array<{ path: string }>
    }
    expect(personal.assets).toEqual([expect.objectContaining({ path: "users/alice/audio/room.wav" })])

    expect((await appRequest(app, "/api/assets?scope=shared&user=alice")).status).toBe(400)
    expect((await appRequest(app, "/api/assets?scope=team")).status).toBe(400)
    expect((await appRequest(app, "/api/assets?modality=document")).status).toBe(400)
    expect((await appRequest(app, "/api/assets?user=..")).status).toBe(400)
    expect((await appRequest(app, "/api/assets?limit=201")).status).toBe(400)
    expect((await appRequest(app, "/api/assets?offset=bad")).status).toBe(400)
  })

  test("returns only opaque filesystem DTOs and resolves asset detail from current bytes", async () => {
    const app = testApp(library.root)
    const list = (await (await appRequest(app, "/api/assets?filename=alpha")).json()) as {
      assets: Array<Record<string, unknown>>
      hasMore: boolean
    }
    const asset = list.assets[0]!
    const body = JSON.stringify(list)

    expect(Object.keys(asset).sort()).toEqual(
      ["bytes", "downloadUrl", "mediaUrl", "mime", "modality", "modifiedAt", "path", "ref", "scope", "user"].sort(),
    )
    expect(asset).toMatchObject({
      path: "users/alice/images/alpha.jpg",
      scope: "personal",
      user: "alice",
      modality: "image",
      mime: "image/png",
    })
    expect(body).not.toContain(library.root)
    expect(asset).not.toHaveProperty("source")
    expect(asset).not.toHaveProperty("provider")
    expect(asset).not.toHaveProperty("lineage")

    const detail = await appRequest(app, `/api/assets/${asset.ref}`)
    expect(detail.status).toBe(200)
    expect(await detail.json()).toMatchObject({ ref: asset.ref, mime: "image/png", downloadUrl: `/api/media/${asset.ref}/download` })

    await rm(imagePath)
    expect((await appRequest(app, `/api/assets/${asset.ref}`)).status).toBe(404)
    expect((await appRequest(app, "/api/assets/invalid.ref")).status).toBe(404)
    expect((await appRequest(app, `/api/assets/${refFor("../outside.png")}`)).status).toBe(404)
  })

  test("streams detected current media as full, one range, or a full attachment download", async () => {
    const app = testApp(library.root)
    const ref = refFor("users/alice/images/alpha.jpg")

    const full = await appRequest(app, `/api/media/${ref}`)
    expect(full.status).toBe(200)
    expect(full.headers.get("content-type")).toBe("image/png")
    expect(Buffer.from(await full.arrayBuffer())).toEqual(png)

    const partial = await appRequest(app, `/api/media/${ref}`, { headers: { Range: "bytes=0-7" } })
    expect(partial.status).toBe(206)
    expect(partial.headers.get("content-range")).toBe(`bytes 0-7/${png.length}`)
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(png.subarray(0, 8))
    expect((await appRequest(app, `/api/media/${ref}`, { headers: { Range: "bytes=0-7,9-10" } })).status).toBe(416)
    expect((await appRequest(app, `/api/media/${ref}`, { headers: { Range: "bytes=9999-" } })).status).toBe(416)

    const download = await appRequest(app, `/api/media/${ref}/download`, { headers: { Range: "bytes=0-7" } })
    expect(download.status).toBe(200)
    expect(download.headers.get("content-disposition")).toContain('attachment; filename="alpha.jpg"')
    expect(Buffer.from(await download.arrayBuffer())).toEqual(png)
  })

  test("rejects stale, symlinked, wrong-modality, and replaced files without exposing paths", async () => {
    const ref = refFor("users/alice/images/alpha.jpg")
    const wrongRef = refFor("users/alice/audio/wrong.wav")
    await writeFile(path.join(library.personal.audio, "wrong.wav"), png)
    const app = testApp(library.root)
    expect((await appRequest(app, `/api/media/${wrongRef}`)).status).toBe(404)

    await mkdir(outside, { recursive: true })
    const outsideFile = path.join(outside, "outside.png")
    await writeFile(outsideFile, png)
    await rm(imagePath)
    await symlink(outsideFile, imagePath)
    const symlinkResponse = await appRequest(app, `/api/media/${ref}`)
    expect(symlinkResponse.status).toBe(404)
    expect(JSON.stringify(await symlinkResponse.json())).not.toContain(library.root)
  })

  test("rejects a regular file replacement during the no-follow open sequence", async () => {
    const ref = refFor("users/alice/images/alpha.jpg")
    const app = testApp(library.root, {
      async mediaFileOpener(filePath, flags) {
        const handle = await open(filePath, flags)
        await rm(imagePath)
        await writeFile(imagePath, png)
        return handle
      },
    })

    expect((await appRequest(app, `/api/media/${ref}`)).status).toBe(404)
  })

  test("does not expose removed job or event APIs and still serves production static and SPA routes", async () => {
    await mkdir(path.join(ui, "assets"), { recursive: true })
    await writeFile(path.join(ui, "index.html"), "<!doctype html><main>Studio UI</main>")
    await writeFile(path.join(ui, "assets", "app.js"), "console.log('studio')")
    const app = testApp(library.root, { uiDirectory: ui })

    expect((await appRequest(app, "/api/jobs")).status).toBe(404)
    expect((await appRequest(app, "/api/events")).status).toBe(404)
    const index = await appRequest(app, "/")
    expect(index.headers.get("content-type")).toContain("text/html")
    expect(index.headers.get("content-security-policy")).toBeTruthy()
    expect(index.headers.get("x-content-type-options")).toBe("nosniff")
    expect(await index.text()).toContain("Studio UI")
    const assetResponse = await appRequest(app, "/assets/app.js")
    expect(assetResponse.headers.get("cache-control")).toContain("immutable")
    expect(await assetResponse.text()).toContain("studio")
    expect(await (await appRequest(app, "/assets/missing")).text()).toContain("Studio UI")
    expect(await (await appRequest(app, "/api/missing")).json()).toEqual({ error: "Not found" })
  })

  test("rejects bad Host headers, sets security headers, exposes studio identity, and returns 404 for removed mutation routes", async () => {
    const app = testApp(library.root)
    const imageRef = refFor("users/alice/images/alpha.jpg")
    const sharedRef = refFor("shared/images/team-photo.png")

    expect((await app.request("/api/health")).status).toBe(400)
    expect((await app.request("/api/health", { headers: { host: "evil.example" } })).status).toBe(400)

    const health = await appRequest(app, "/api/health")
    expect(health.status).toBe(200)
    expect(health.headers.get("x-content-type-options")).toBe("nosniff")
    expect(health.headers.get("content-security-policy")).toContain("default-src 'self'")

    const studio = await appRequest(app, "/api/studio")
    expect(studio.status).toBe(200)
    expect(await studio.json()).toEqual({
      id: "media",
      packageVersion: "2.0.0",
      contractVersion: "1.0.0",
    })

    for (const [method, url] of [
      ["POST", "/api/folders"],
      ["POST", "/api/assets/upload"],
      ["POST", `/api/assets/${imageRef}/rename`],
      ["DELETE", `/api/assets/${imageRef}`],
      ["POST", `/api/assets/${imageRef}/move-to-shared`],
      ["POST", `/api/assets/${sharedRef}/copy-to-personal`],
    ] as const) {
      const response = await appRequest(app, url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "DELETE" ? JSON.stringify({ confirm: true }) : JSON.stringify({ name: "x", user: "alice" }),
      })
      expect(response.status).toBe(404)
    }
  })

  test("wildcard bind accepts tunnel Host headers while still requiring a Host value", async () => {
    const app = testApp(library.root, { hostname: "0.0.0.0" })
    expect((await app.request("/api/health")).status).toBe(400)
    expect((await app.request("/api/health", { headers: { host: "media.example.com" } })).status).toBe(200)
    expect((await app.request("/api/health", { headers: { host: "127.0.0.1:4173" } })).status).toBe(200)
    expect(allowedHost(undefined, "0.0.0.0", 4173)).toBe(false)
    expect(allowedHost("media.example.com", "0.0.0.0", 4173)).toBe(true)
    expect(allowedHost("evil.example\n", "0.0.0.0", 4173)).toBe(false)
    expect(allowedHost("evil.example", "127.0.0.1", 4173)).toBe(false)
  })
})
