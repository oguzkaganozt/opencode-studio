import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import plugin from "../tools"

const root = path.join(import.meta.dir, ".tmp")
const libraryRoot = path.join(import.meta.dir, ".tmp-library")
const projectRoot = path.join(libraryRoot, "demo")
const outside = path.join(import.meta.dir, ".tmp-outside")

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(libraryRoot, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

async function hooks() {
  await mkdir(root, { recursive: true })
  await mkdir(path.join(projectRoot, "media"), { recursive: true })
  return plugin(
    {
      directory: projectRoot,
      worktree: root,
      client: { provider: { list: async () => ({ data: { all: [] } }) } },
    } as never,
    { libraryRoot },
  )
}

describe("media plugin smoke", () => {
  test("registers Media Studio tools", async () => {
    const value = await hooks()
    expect(Object.keys(value.tool ?? {}).sort()).toEqual(
      [
        "chatgpt_image_generate",
        "fal_cancel",
        "fal_model_schema",
        "fal_models",
        "fal_pricing",
        "fal_result",
        "fal_status",
        "fal_submit",
        "fal_upload",
        "media_convert",
        "media_download",
        "media_extract_audio",
        "media_image_crop",
        "media_image_edit",
        "media_import",
        "media_info",
        "media_list",
        "media_probe",
        "media_trim",
        "media_video_concat",
        "read_media",
      ].sort(),
    )
  })

  test("rejects files outside the open Media project", async () => {
    const value = await hooks()
    await mkdir(outside, { recursive: true })
    const target = path.join(outside, "secret.png")
    await writeFile(target, "x")
    await expect((value.tool as any).media_info.execute({ filePath: target }, { directory: projectRoot } as any)).rejects.toThrow()
  })

  test("rejects files through a symlink escape", async () => {
    const value = await hooks()
    await mkdir(outside, { recursive: true })
    const target = path.join(outside, "secret.png")
    await writeFile(target, "x")
    const link = path.join(projectRoot, "media", "escape.png")
    await symlink(target, link)
    await expect((value.tool as any).media_info.execute({ filePath: link }, { directory: projectRoot } as any)).rejects.toThrow()
  })

  test("rejects an arbitrary OpenCode workspace", async () => {
    const value = await hooks()
    await expect((value.tool as any).media_list.execute({}, { directory: root } as any)).rejects.toThrow(/directly under/)
  })
})
