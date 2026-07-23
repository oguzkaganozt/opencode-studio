import { afterEach, describe, expect, test } from "bun:test"
import { lstat, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  classifyManagedPath,
  createManagedFolder,
  currentUnixUsername,
  ensurePersonalLibraryLayout,
  initializeLibrary,
  inspectManagedAsset,
  personalOutputPath,
  resolveManagedPath,
  scanFolderContents,
  scanLibrary,
  validateFolderName,
  validateLibraryUser,
  validateSubfolderPath,
} from "../library"

const root = path.join(import.meta.dir, ".library-root")
const outside = path.join(import.meta.dir, ".library-outside")
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe("Library filesystem", () => {
  test("derives the username from the process UID and creates the fixed setgid layout", async () => {
    let receivedUID = -1
    const layout = await initializeLibrary({
      root,
      resolveUsername(uid) {
        receivedUID = uid
        return "test-user"
      },
    })

    expect(receivedUID).toBe(process.getuid!())
    expect(currentUnixUsername(() => "test-user")).toBe("test-user")
    for (const directory of [...Object.values(layout.personal), ...Object.values(layout.shared)]) {
      expect((await lstat(directory)).mode & 0o2770).toBe(0o2770)
    }
    expect(layout.personal.image).toBe(path.join(root, "users/test-user/images"))
    expect(layout.shared.video).toBe(path.join(root, "shared/video"))
  })

  test("classifies only regular files at fixed managed paths and rejects symlinks", async () => {
    const layout = await initializeLibrary({ root, resolveUsername: () => "tester" })
    const image = path.join(layout.personal.image, "asset.png")
    await writeFile(image, png)
    expect(classifyManagedPath(layout.root, image)).toMatchObject({ scope: "personal", user: "tester", modality: "image" })
    expect(await inspectManagedAsset(layout.root, image)).toMatchObject({ filePath: image, mime: "image/png", modality: "image" })

    const nested = path.join(layout.personal.image, "nested", "asset.png")
    await mkdir(path.dirname(nested), { recursive: true })
    await writeFile(nested, png)
    expect(classifyManagedPath(layout.root, nested)).toMatchObject({
      scope: "personal",
      user: "tester",
      modality: "image",
      subfolder: "nested",
    })

    await mkdir(outside, { recursive: true })
    await writeFile(path.join(outside, "asset.png"), png)
    await symlink(path.join(outside, "asset.png"), path.join(layout.personal.image, "linked.png"))
    await expect(resolveManagedPath(layout.root, path.join(layout.personal.image, "linked.png"))).rejects.toThrow("regular managed")
  })

  test("validates selected browser users and creates only their fixed setgid personal layout", async () => {
    const layout = await initializeLibrary({ root, resolveUsername: () => "alice" })
    const personal = await ensurePersonalLibraryLayout(layout.root, "browser-user")
    expect(personal).toEqual({
      image: path.join(root, "users/browser-user/images"),
      audio: path.join(root, "users/browser-user/audio"),
      video: path.join(root, "users/browser-user/video"),
    })
    for (const directory of Object.values(personal)) expect((await lstat(directory)).mode & 0o2770).toBe(0o2770)
    expect(() => validateLibraryUser("../outside")).toThrow("Invalid Library user")
    expect(() => validateLibraryUser("bad\nname")).toThrow("Invalid Library user")
  })

  test("scans deterministically with user, scope, modality, filename, pagination, and a hard bound", async () => {
    const layout = await initializeLibrary({ root, resolveUsername: () => "alice" })
    const bobImages = path.join(layout.root, "users/bob/images")
    await mkdir(bobImages, { recursive: true })
    await mkdir(path.join(layout.personal.image, "project1"), { recursive: true })
    await writeFile(path.join(layout.personal.image, "Zulu.PNG"), png)
    await writeFile(path.join(layout.personal.image, "project1", "nested.png"), png)
    await writeFile(path.join(bobImages, "alpha.png"), png)
    await writeFile(path.join(layout.shared.image, "Team-PHOTO.png"), png)
    await writeFile(path.join(layout.shared.image, "not-media.txt"), "text")

    const all = await scanLibrary({ root: layout.root, limit: 10, offset: 0 })
    expect(all.map((asset) => path.relative(layout.root, asset.filePath)).sort()).toEqual(
      [
        "shared/images/Team-PHOTO.png",
        "users/alice/images/Zulu.PNG",
        "users/alice/images/project1/nested.png",
        "users/bob/images/alpha.png",
      ].sort(),
    )
    expect(await scanLibrary({ root: layout.root, scope: "shared", filename: "photo", limit: 10, offset: 0 })).toHaveLength(1)
    expect(await scanLibrary({ root: layout.root, user: "bob", scope: "personal", modality: "image", limit: 10, offset: 0 })).toMatchObject(
      [{ user: "bob", scope: "personal", filePath: path.join(bobImages, "alpha.png") }],
    )
    expect(
      (await scanLibrary({ root: layout.root, user: "bob", modality: "image", limit: 10, offset: 0 })).map((a) =>
        path.relative(layout.root, a.filePath),
      ),
    ).toEqual(["shared/images/Team-PHOTO.png", "users/bob/images/alpha.png"].sort())
    expect(await scanLibrary({ root: layout.root, limit: 1, offset: 1 })).toMatchObject([{ user: "alice" }])
    await expect(scanLibrary({ root: layout.root, limit: 10, offset: 0, scanLimit: 2 })).rejects.toThrow("exceeds 2")
  })

  test("scans folder contents non-recursively and returns both files and subfolders", async () => {
    const layout = await initializeLibrary({ root, resolveUsername: () => "alice" })
    await mkdir(path.join(layout.personal.image, "project1"), { recursive: true })
    await mkdir(path.join(layout.personal.image, "project1", "screenshots"), { recursive: true })
    await writeFile(path.join(layout.personal.image, "top.png"), png)
    await writeFile(path.join(layout.personal.image, "project1", "nested.png"), png)
    await writeFile(path.join(layout.personal.image, "project1", "screenshots", "deep.png"), png)

    const rootContents = await scanFolderContents({
      root: layout.root,
      scope: "personal",
      modality: "image",
      user: "alice",
      limit: 50,
      offset: 0,
    })
    expect(rootContents.folders.map((f) => f.name)).toEqual(["project1"])
    expect(rootContents.assets.map((a) => path.basename(a.filePath))).toEqual(["top.png"])

    const projectContents = await scanFolderContents({
      root: layout.root,
      scope: "personal",
      modality: "image",
      user: "alice",
      subfolder: "project1",
      limit: 50,
      offset: 0,
    })
    expect(projectContents.folders.map((f) => f.name)).toEqual(["screenshots"])
    expect(projectContents.assets.map((a) => path.basename(a.filePath))).toEqual(["nested.png"])
  })

  test("creates managed folders with depth limit and collision detection", async () => {
    const layout = await initializeLibrary({ root, resolveUsername: () => "alice" })

    const folderPath = await createManagedFolder({
      root: layout.root,
      scope: "personal",
      modality: "image",
      user: "alice",
      name: "project1",
    })
    expect(await lstat(folderPath)).toMatchObject({ isDirectory: () => true })

    const subfolderPath = await createManagedFolder({
      root: layout.root,
      scope: "personal",
      modality: "image",
      user: "alice",
      parent: "project1",
      name: "screenshots",
    })
    expect(await lstat(subfolderPath)).toMatchObject({ isDirectory: () => true })

    await expect(
      createManagedFolder({
        root: layout.root,
        scope: "personal",
        modality: "image",
        user: "alice",
        name: "project1",
      }),
    ).rejects.toThrow("already exists")

    expect(() => validateFolderName("bad/name")).toThrow("Invalid folder name")
    expect(() => validateFolderName("")).toThrow("Invalid folder name")
    expect(validateSubfolderPath("a/b/c")).toBe("a/b/c")
    expect(() => validateSubfolderPath("a/b/c/d")).toThrow("depth exceeds 3")
    expect(validateSubfolderPath("")).toBe("")
    expect(validateSubfolderPath(undefined)).toBe("")
  })

  test("confines personal outputs to the current user's matching modality directory", async () => {
    const layout = await initializeLibrary({ root, resolveUsername: () => "alice" })
    expect(personalOutputPath(layout, "audio", "clip.wav", "unused.wav")).toBe(path.join(layout.personal.audio, "clip.wav"))
    expect(personalOutputPath(layout, "video", undefined, "clip.mp4")).toBe(path.join(layout.personal.video, "clip.mp4"))
    expect(() => personalOutputPath(layout, "image", "shared/images/escape.png", "unused.png")).toThrow("current user's images")
  })
})
