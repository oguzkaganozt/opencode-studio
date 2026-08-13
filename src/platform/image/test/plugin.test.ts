import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createImageGeneratePlugin } from "../plugin"

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex",
)

type ImageTool = {
  execute: (
    args: Record<string, unknown>,
    context: { abort: AbortSignal; ask: () => Promise<void> },
  ) => Promise<{ metadata: { provider: string; mode?: string } }>
}

const temps: string[] = []

afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe("image_generate plugin", () => {
  test("writes a new file under cwd and refuses overwrite", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-image-"))
    temps.push(root)
    const plugin = createImageGeneratePlugin({
      loadChatGPTAuth: async () => ({ access: "tok" }),
      loadXaiAuth: async () => undefined,
      loadFalKey: () => undefined,
      generateChatGPTImage: async () => PNG,
    })
    const hooks = await plugin({ directory: root } as any, {})
    const tool = (hooks.tool as unknown as { image_generate: ImageTool }).image_generate
    const first = await tool.execute(
      { prompt: "cube", outputPath: "out.png" },
      { abort: new AbortController().signal, ask: async () => {} },
    )
    expect(first.metadata.provider).toBe("chatgpt")
    expect(await Bun.file(path.join(root, "out.png")).exists()).toBe(true)
    await expect(
      tool.execute({ prompt: "cube", outputPath: "out.png" }, { abort: new AbortController().signal, ask: async () => {} }),
    ).rejects.toThrow(/already exists/)
  })

  test("validates outputPath before calling a provider", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-image-precheck-"))
    temps.push(root)
    await writeFile(path.join(root, "out.png"), PNG)
    let generated = 0
    const plugin = createImageGeneratePlugin({
      loadChatGPTAuth: async () => ({ access: "tok" }),
      generateChatGPTImage: async () => {
        generated += 1
        return PNG
      },
    })
    const hooks = await plugin({ directory: root } as any, {})
    const tool = (hooks.tool as unknown as { image_generate: ImageTool }).image_generate
    await expect(
      tool.execute({ prompt: "cube", outputPath: "out.png" }, { abort: new AbortController().signal, ask: async () => {} }),
    ).rejects.toThrow(/already exists/)
    await expect(
      tool.execute({ prompt: "cube", outputPath: "out.txt" }, { abort: new AbortController().signal, ask: async () => {} }),
    ).rejects.toThrow(/outputPath must end/)
    await expect(
      tool.execute({ prompt: "cube", outputPath: "../escape.png" }, { abort: new AbortController().signal, ask: async () => {} }),
    ).rejects.toThrow(/inside the workspace/)
    expect(generated).toBe(0)
  })

  test("rejects paths outside the workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-image-jail-"))
    temps.push(root)
    const outside = await mkdtemp(path.join(tmpdir(), "osc-image-out-"))
    temps.push(outside)
    await writeFile(path.join(outside, "ref.png"), PNG)
    const plugin = createImageGeneratePlugin({
      loadChatGPTAuth: async () => ({ access: "tok" }),
      generateChatGPTImage: async () => PNG,
    })
    const hooks = await plugin({ directory: root } as any, {})
    const tool = (hooks.tool as unknown as { image_generate: ImageTool }).image_generate
    await expect(
      tool.execute({ prompt: "cube", outputPath: "../escape.png" }, { abort: new AbortController().signal, ask: async () => {} }),
    ).rejects.toThrow(/inside the workspace/)
    await expect(
      tool.execute(
        { prompt: "edit", images: [path.join(outside, "ref.png")] },
        { abort: new AbortController().signal, ask: async () => {} },
      ),
    ).rejects.toThrow(/inside the workspace/)
  })

  test("reads a workspace reference image for edit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-image-edit-"))
    temps.push(root)
    await mkdir(path.join(root, "refs"), { recursive: true })
    await writeFile(path.join(root, "refs", "src.png"), PNG)
    let seen = 0
    const plugin = createImageGeneratePlugin({
      loadChatGPTAuth: async () => ({ access: "tok" }),
      generateChatGPTImage: async (input) => {
        seen = input.referenceImages.length
        return PNG
      },
    })
    const hooks = await plugin({ directory: root } as any, {})
    const tool = (hooks.tool as unknown as { image_generate: ImageTool }).image_generate
    const result = await tool.execute(
      { prompt: "make blue", images: ["refs/src.png"], outputPath: "edited.png" },
      { abort: new AbortController().signal, ask: async () => {} },
    )
    expect(seen).toBe(1)
    expect(result.metadata.mode).toBe("edit")
  })
})
