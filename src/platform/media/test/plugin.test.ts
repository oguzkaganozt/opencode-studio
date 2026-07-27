import { afterEach, describe, expect, test } from "bun:test"
import { chmod, lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import manifest from "../../../../package.json" with { type: "json" }
import { NATIVE_SUPPORT_MATRIX } from "../native-compatibility"

const providerPackage = `${manifest.name}@${manifest.version}`

import plugin, { AnthropicNativeMediaProviderPlugin, createMediaStudioPlugin } from "../tools"

const root = path.join(import.meta.dir, ".tmp")
const libraryRoot = path.join(import.meta.dir, ".tmp-library")
const outside = path.join(import.meta.dir, ".tmp-outside")
const originalAuth = process.env.OPENCODE_AUTH_CONTENT
const originalFalKey = process.env.FAL_KEY
const originalFetch = globalThis.fetch

function personal(_modality: "images" | "audio" | "video", filename: string) {
  return path.join(libraryRoot, "media", filename)
}

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(libraryRoot, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
  globalThis.fetch = originalFetch
  if (originalAuth === undefined) delete process.env.OPENCODE_AUTH_CONTENT
  else process.env.OPENCODE_AUTH_CONTENT = originalAuth
  if (originalFalKey === undefined) delete process.env.FAL_KEY
  else process.env.FAL_KEY = originalFalKey
})

function model(input: { id?: string; providerID?: string; audio?: boolean; video?: boolean; npm?: string } = {}) {
  return {
    id: input.id ?? "test-model",
    providerID: input.providerID ?? "test-provider",
    api: { id: input.id ?? "test-model", url: "https://example.test/v1", npm: input.npm ?? providerPackage },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, image: true, pdf: false, audio: input.audio ?? false, video: input.video ?? false },
      output: { text: true, image: false, pdf: false, audio: false, video: false },
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 1000, output: 1000 },
    status: "active" as const,
    options: {},
    headers: {},
  }
}

async function selectNativeModel(
  value: Awaited<ReturnType<typeof hooks>>,
  sessionID = "session",
  selected = model({
    providerID: "opencode",
    video: true,
    npm: "@ai-sdk/openai-compatible",
  }),
) {
  await value["experimental.chat.system.transform"]?.({ sessionID, model: selected } as never, { system: [] })
}

async function hooks(extraOptions: Record<string, unknown> = {}, implementation: typeof plugin = plugin) {
  await mkdir(root, { recursive: true })
  await mkdir(libraryRoot, { recursive: true })
  await mkdir(path.join(libraryRoot, "media"), { recursive: true })
  return implementation(
    {
      directory: root,
      worktree: root,
      client: { provider: { list: async () => ({ data: { all: [] } }) } },
    } as never,
    { libraryRoot, ...extraOptions },
  )
}

function png(width = 1024, height = 1024) {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

function mp4() {
  const bytes = Buffer.alloc(24)
  bytes.writeUInt32BE(24, 0)
  bytes.write("ftyp", 4, "ascii")
  bytes.write("isom", 8, "ascii")
  return bytes
}

function falSchema(endpoint: string) {
  return {
    models: [
      {
        endpoint_id: endpoint,
        openapi: {
          openapi: "3.0.0",
          paths: {
            "/run": {
              post: {
                requestBody: {
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: { prompt: { type: "string" } },
                        additionalProperties: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    ],
  }
}

describe("combined video plugin", () => {
  test("registers native reading and fal generation tools together", async () => {
    const value = await hooks()
    expect(Object.keys(value.tool ?? {})).toEqual([
      "read_media",
      "chatgpt_image_generate",
      "media_import",
      "media_list",
      "media_info",
      "media_probe",
      "media_convert",
      "media_trim",
      "media_extract_audio",
      "fal_upload",
      "fal_models",
      "fal_model_schema",
      "fal_pricing",
      "fal_submit",
      "fal_status",
      "fal_result",
      "fal_cancel",
      "media_download",
    ])
  })

  test("promotes the latest native tool attachment and strips it during compaction", async () => {
    const value = await hooks()
    const messages = (): any[] => [
      {
        info: { id: "user", sessionID: "session", role: "user", time: { created: 1 } },
        parts: [],
      },
      {
        info: { id: "assistant", sessionID: "session", role: "assistant", time: { created: 2 } },
        parts: [
          {
            type: "tool",
            tool: "read_media",
            state: {
              status: "completed",
              attachments: [
                { type: "file", mime: "video/mp4", filename: "clip.mp4", url: "data:video/mp4;base64,AAAA" },
                { type: "file", mime: "image/png", filename: "poster.png", url: "data:image/png;base64,BBBB" },
              ],
            },
          },
        ],
      },
    ]

    const promoted = messages()
    await value["experimental.chat.messages.transform"]?.({}, { messages: promoted } as never)
    expect(promoted).toHaveLength(3)
    expect(promoted[1]!.parts[0]!.state.attachments).toEqual([
      { type: "file", mime: "image/png", filename: "poster.png", url: "data:image/png;base64,BBBB" },
    ])
    expect(promoted[2]).toMatchObject({
      info: { role: "user", sessionID: "session" },
      parts: [
        { type: "text", synthetic: true },
        { type: "file", mime: "video/mp4", synthetic: true },
      ],
    })

    const compacted = messages()
    await value["experimental.session.compacting"]?.({ sessionID: "session" }, { context: [] })
    await value["experimental.chat.messages.transform"]?.({}, { messages: compacted } as never)
    expect(compacted).toHaveLength(2)
    expect(compacted[1]!.parts[0]!.state.attachments).toEqual([
      { type: "file", mime: "image/png", filename: "poster.png", url: "data:image/png;base64,BBBB" },
    ])
  })

  test("patches only declared video models", async () => {
    const value = await hooks()
    const video = model({ video: true, npm: "@ai-sdk/openai-compatible" })
    const text = model({ npm: "@ai-sdk/openai-compatible" })
    const result = await value.provider!.models!(
      { id: "opencode", name: "OpenCode", source: "config", env: [], options: {}, models: { video, text } } as never,
      {},
    )

    expect(result.video!.api.npm).toBe(providerPackage)
    expect(result.video!.options.nativeMediaProtocol).toBe("openai-compatible")
    expect(result.video!.options.nativeMediaAdapter).toBe("@ai-sdk/openai-compatible")
    expect(result.text!.api.npm).toBe("@ai-sdk/openai-compatible")
  })

  test("leaves Google and undeclared video routes on their existing adapters", async () => {
    const value = await hooks()
    const google = model({ video: true, npm: "@ai-sdk/google" })
    const undeclared = model({ npm: "@ai-sdk/anthropic" })
    const result = await value.provider!.models!(
      { id: "opencode", name: "OpenCode", source: "config", env: [], options: {}, models: { google, undeclared } } as never,
      {},
    )
    expect(result.google!.api.npm).toBe("@ai-sdk/google")
    expect(result.undeclared!.api.npm).toBe("@ai-sdk/anthropic")
  })

  test("leaves normal OpenCode permission configuration unchanged", async () => {
    const value = await hooks()
    const config = {
      permission: "allow",
      agent: {
        build: { permission: { "*": "allow" } },
        asking: { permission: "ask" },
        denied: { permission: "deny" },
      },
    } as never
    await value.config?.(config)

    expect((config as any).permission).toBe("allow")
    expect((config as any).agent).toEqual({
      build: { permission: { "*": "allow" } },
      asking: { permission: "ask" },
      denied: { permission: "deny" },
    })
  })

  test("patches Anthropic video models on OpenCode Go", async () => {
    const value = await AnthropicNativeMediaProviderPlugin({} as never)
    const video = model({ video: true, npm: "@ai-sdk/anthropic" })
    const result = await value.provider!.models!(
      { id: "opencode-go", name: "OpenCode Go", source: "custom", env: [], options: {}, models: { video } } as never,
      {},
    )

    expect(result.video!.api.npm).toBe(providerPackage)
    expect(result.video!.options.nativeMediaProtocol).toBe("anthropic")
    expect(result.video!.options.nativeMediaAdapter).toBe("@ai-sdk/anthropic")
  })

  test("rejects read_media on unsupported providers before reading", async () => {
    const value = await hooks()
    await selectNativeModel(value, "session", model({ providerID: "other", video: true, npm: "@ai-sdk/openai-compatible" }))

    await expect(
      value["tool.execute.before"]?.({ tool: "read_media", sessionID: "session", callID: "call" }, { args: { filePath: "clip.mp4" } }),
    ).rejects.toThrow("on other")
  })

  test("accepts every matrix row and rejects unsupported boundaries before file permission", async () => {
    const value = await hooks()
    const extensionByMime: Record<string, string> = {
      "audio/wav": "wav",
      "audio/mp3": "mp3",
      "video/mp4": "mp4",
      "video/webm": "webm",
      "video/quicktime": "mov",
    }
    for (const [index, row] of NATIVE_SUPPORT_MATRIX.entries()) {
      const sessionID = `matrix-${index}`
      await selectNativeModel(
        value,
        sessionID,
        model({
          id: `model-${index}`,
          providerID: row.providerID,
          audio: row.capability === "audio",
          video: row.capability === "video",
          npm: row.adapter,
        }),
      )
      await expect(
        value["tool.execute.before"]?.(
          { tool: "read_media", sessionID, callID: "call" },
          { args: { filePath: `asset.${extensionByMime[row.mime]}` } },
        ),
      ).resolves.toBeUndefined()
    }

    await selectNativeModel(value, "no-video", model({ providerID: "opencode", npm: "@ai-sdk/openai-compatible" }))
    await expect(
      value["tool.execute.before"]?.({ tool: "read_media", sessionID: "no-video", callID: "call" }, { args: { filePath: "missing.mp4" } }),
    ).rejects.toThrow("does not declare video")

    await selectNativeModel(value, "google", model({ providerID: "opencode", video: true, npm: "@ai-sdk/google" }))
    await expect(
      value["tool.execute.before"]?.({ tool: "read_media", sessionID: "google", callID: "call" }, { args: { filePath: "missing.mp4" } }),
    ).rejects.toThrow("@ai-sdk/google")

    await selectNativeModel(value, "convertible", model({ providerID: "opencode", audio: true, npm: "@ai-sdk/openai-compatible" }))
    await expect(
      value["tool.execute.before"]?.(
        { tool: "read_media", sessionID: "convertible", callID: "call" },
        { args: { filePath: "missing.flac" } },
      ),
    ).rejects.toThrow("media_convert preset audio-wav")
  })

  test("reads validated absolute managed Library paths instead of tool-worktree paths", async () => {
    await mkdir(root, { recursive: true })
    const value = await hooks()
    const filePath = personal("video", "clip.mp4")
    const bytes = mp4()
    await writeFile(filePath, bytes)
    await selectNativeModel(value)
    const result = await value.tool!.read_media.execute(
      { filePath },
      {
        sessionID: "session",
        messageID: "message",
        agent: "build",
        directory: import.meta.dir,
        worktree: import.meta.dir,
        abort: new AbortController().signal,
        metadata() {},
        async ask() {},
      },
    )

    expect(typeof result).not.toBe("string")
    if (typeof result === "string") throw new Error("Expected structured tool result")
    expect(result.metadata).toEqual({ filePath, mime: "video/mp4", bytes: bytes.length, native: true })
    expect(result.attachments).toEqual([
      {
        type: "file",
        mime: "video/mp4",
        filename: "clip.mp4",
        url: `data:video/mp4;base64,${bytes.toString("base64")}`,
      },
    ])
  })

  test("validates maxNativeBytes and the configured Library root", async () => {
    await mkdir(root, { recursive: true })
    await mkdir(outside, { recursive: true })
    await expect(hooks({ maxNativeBytes: 0 })).rejects.toThrow("maxNativeBytes must be a positive integer")
    await expect(hooks({ maxNativeBytes: "20" })).rejects.toThrow("maxNativeBytes must be a positive integer")
    await expect(hooks({ libraryRoot: "relative" })).rejects.toThrow("workspaceRoot must be an absolute path")

    const bytes = mp4()
    const value = await hooks({ maxNativeBytes: bytes.length - 1 })
    const bounded = personal("video", "bounded.mp4")
    await writeFile(bounded, bytes)
    await selectNativeModel(value)
    await expect(
      value.tool!.read_media.execute(
        { filePath: bounded },
        {
          sessionID: "session",
          messageID: "message",
          agent: "build",
          directory: root,
          worktree: root,
          abort: new AbortController().signal,
          metadata() {},
          async ask() {},
        },
      ),
    ).rejects.toThrow("maximum")
  })

  test("rejects unmanaged and outside-symlink paths before permission", async () => {
    await mkdir(root, { recursive: true })
    await mkdir(outside, { recursive: true })
    const outsideFile = path.join(outside, "outside.mp4")
    const bytes = mp4()
    await writeFile(outsideFile, bytes)
    const value = await hooks()
    const linked = personal("video", "linked.mp4")
    await symlink(outsideFile, linked)
    await selectNativeModel(value)
    let permissions = 0
    const context = {
      sessionID: "session",
      messageID: "message",
      agent: "build",
      directory: import.meta.dir,
      worktree: import.meta.dir,
      abort: new AbortController().signal,
      metadata() {},
      async ask() {
        permissions += 1
      },
    }

    await expect(value.tool!.read_media.execute({ filePath: outsideFile }, context)).rejects.toThrow("Path must be inside the workspace")
    await expect(value.tool!.read_media.execute({ filePath: "../outside.mp4" }, context)).rejects.toThrow(
      "Path must be inside the workspace",
    )
    await expect(value.tool!.read_media.execute({ filePath: linked }, context)).rejects.toThrow("not a regular file")
    expect(permissions).toBe(0)
  })

  test("rejects a read_media file replaced by a symlink after permission", async () => {
    await mkdir(root, { recursive: true })
    await mkdir(outside, { recursive: true })
    const value = await hooks()
    const filePath = personal("video", "replace.mp4")
    const outsideFile = path.join(outside, "outside.mp4")
    const bytes = mp4()
    await writeFile(filePath, bytes)
    await writeFile(outsideFile, bytes)
    await selectNativeModel(value)

    await expect(
      value.tool!.read_media.execute(
        { filePath },
        {
          sessionID: "session",
          messageID: "message",
          agent: "build",
          directory: root,
          worktree: root,
          abort: new AbortController().signal,
          metadata() {},
          async ask() {
            await rm(filePath)
            await symlink(outsideFile, filePath)
          },
        },
      ),
    ).rejects.toThrow()
  })

  test("allows fal_upload only for validated managed Library assets", async () => {
    process.env.FAL_KEY = "test-key"
    const uploads: File[] = []
    const implementation = createMediaStudioPlugin({
      createFalClient: () =>
        ({
          storage: {
            upload: async (file: File) => {
              uploads.push(file)
              return "https://fal.media/upload.png"
            },
          },
        }) as never,
    })
    const value = await hooks({}, implementation)
    const managed = personal("images", "upload.png")
    await writeFile(managed, png(1, 1))
    const unmanaged = path.join(root, "upload.png")
    await writeFile(unmanaged, png(1, 1))
    const context = {
      sessionID: "session",
      messageID: "message",
      agent: "build",
      directory: root,
      worktree: root,
      abort: new AbortController().signal,
      metadata() {},
      async ask() {},
    }

    await expect(value.tool!.fal_upload.execute({ filePath: unmanaged, expiresIn: "1d" }, context)).rejects.toThrow(
      "Path must be inside the workspace",
    )
    const result = await value.tool!.fal_upload.execute({ filePath: managed, expiresIn: "1d" }, context)
    expect(uploads).toHaveLength(1)
    expect(uploads[0]!.name).toBe("upload.png")
    expect(result).toMatchObject({ title: managed, metadata: { filePath: managed } })
  })

  test("uses only injected fal schema, pricing, queue, and provider-error boundaries", async () => {
    process.env.FAL_KEY = "test-key"
    const platformRequests: string[] = []
    const submissions: Array<{ endpoint: string; input: unknown }> = []
    let failSubmit = false
    const platformFetch = async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      platformRequests.push(`${url.pathname}${url.search}`)
      const body = url.pathname.endsWith("/pricing")
        ? { unit: "image", price: 0.1 }
        : falSchema(url.searchParams.get("endpoint_id") ?? "fal-ai/test")
      return Response.json(body)
    }
    const implementation = createMediaStudioPlugin({
      platformFetch,
      createFalClient: () =>
        ({
          queue: {
            submit: async (endpoint: string, options: { input: unknown }) => {
              submissions.push({ endpoint, input: options.input })
              if (failSubmit) throw new Error("injected provider failure")
              return { request_id: "request_12345678", status: "IN_QUEUE" }
            },
          },
        }) as never,
    })
    const value = await hooks({}, implementation)
    let permissionRequests = 0
    const context = {
      sessionID: "session",
      messageID: "message",
      agent: "build",
      directory: root,
      worktree: root,
      abort: new AbortController().signal,
      metadata() {},
      async ask() {
        permissionRequests += 1
      },
    }

    expect(JSON.parse(String(await value.tool!.fal_model_schema.execute({ endpoint: "fal-ai/test" }, context)))).toHaveProperty("models")
    expect(JSON.parse(String(await value.tool!.fal_pricing.execute({ endpoint: "fal-ai/test" }, context)))).toEqual({
      unit: "image",
      price: 0.1,
    })
    expect(
      JSON.parse(String(await value.tool!.fal_submit.execute({ endpoint: "fal-ai/test", input: { prompt: "safe" } }, context))),
    ).toMatchObject({ request_id: "request_12345678" })
    failSubmit = true
    await expect(value.tool!.fal_submit.execute({ endpoint: "fal-ai/failure", input: {} }, context)).rejects.toThrow(
      "injected provider failure",
    )

    expect(platformRequests).toHaveLength(6)
    expect(platformRequests).toEqual([
      expect.stringContaining("/models?"),
      expect.stringContaining("/models/pricing?"),
      expect.stringContaining("/models?"),
      expect.stringContaining("/models/pricing?"),
      expect.stringContaining("/models?"),
      expect.stringContaining("/models/pricing?"),
    ])
    expect(submissions).toEqual([
      { endpoint: "fal-ai/test", input: { prompt: "safe" } },
      { endpoint: "fal-ai/failure", input: {} },
    ])
    expect(permissionRequests).toBe(0)
  })

  test("runs the complete stateless mocked fal tool lifecycle and download", async () => {
    process.env.FAL_KEY = "test-key"
    const endpoint = "fal-ai/lifecycle"
    const requestId = "request_lifecycle"
    const calls: string[] = []
    const implementation = createMediaStudioPlugin({
      platformFetch: async (input) =>
        Response.json(
          input.pathname.endsWith("/pricing")
            ? { unit: "image", price: 0.1 }
            : falSchema(input.searchParams.get("endpoint_id") ?? endpoint),
        ),
      createFalClient: () =>
        ({
          queue: {
            submit: async () => {
              calls.push("submit")
              return { request_id: requestId, status: "IN_QUEUE" }
            },
            status: async () => {
              calls.push("status")
              return { status: "IN_PROGRESS", logs: [{ message: "safe" }] }
            },
            result: async () => {
              calls.push("result")
              return { image: { url: "https://fal.media/lifecycle.png" } }
            },
            cancel: async () => {
              calls.push("cancel")
            },
          },
        }) as never,
    })
    const value = await hooks({}, implementation)
    const context = {
      sessionID: "session",
      messageID: "message",
      agent: "build",
      directory: root,
      worktree: root,
      abort: new AbortController().signal,
      metadata() {},
      async ask() {},
    }

    expect(JSON.parse(String(await value.tool!.fal_model_schema.execute({ endpoint }, context)))).toHaveProperty("models")
    expect(JSON.parse(String(await value.tool!.fal_pricing.execute({ endpoint }, context)))).toEqual({ unit: "image", price: 0.1 })
    const submitted = JSON.parse(String(await value.tool!.fal_submit.execute({ endpoint, input: { prompt: "test" } }, context)))
    expect(submitted).toEqual({ request_id: requestId, status: "IN_QUEUE" })
    expect(submitted).not.toHaveProperty("catalog_job_id")
    expect(JSON.parse(String(await value.tool!.fal_status.execute({ endpoint, requestId, logs: true }, context)))).toMatchObject({
      status: "IN_PROGRESS",
    })
    expect(JSON.parse(String(await value.tool!.fal_result.execute({ endpoint, requestId }, context)))).toMatchObject({
      image: { url: "https://fal.media/lifecycle.png" },
    })
    expect(await value.tool!.fal_cancel.execute({ endpoint, requestId }, context)).toContain("Cancellation requested")

    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
    globalThis.fetch = (async () => new Response(image, { headers: { "content-type": "image/png" } })) as unknown as typeof fetch
    const downloaded = await value.tool!.media_download.execute(
      {
        url: "https://fal.media/lifecycle.png",
      },
      context,
    )
    expect(typeof downloaded).not.toBe("string")
    expect(calls).toEqual(["submit", "status", "result", "cancel"])
    expect((downloaded as { metadata: unknown }).metadata).not.toHaveProperty("provider")
  })

  test("does not submit when schema lookup, pricing, or an early abort fails", async () => {
    process.env.FAL_KEY = "test-key"
    let submissions = 0
    const client = {
      queue: {
        submit: async () => {
          submissions += 1
          return { request_id: "request_12345678", status: "IN_QUEUE" }
        },
      },
    } as never
    const context = (abort: AbortSignal) => ({
      sessionID: "session",
      messageID: "message",
      agent: "build",
      directory: root,
      worktree: root,
      abort,
      metadata() {},
      async ask() {},
    })

    const pricingFailure = await hooks(
      {},
      createMediaStudioPlugin({
        createFalClient: () => client,
        platformFetch: async (input) =>
          input.pathname.endsWith("/pricing")
            ? new Response("pricing unavailable", { status: 503 })
            : Response.json(falSchema(input.searchParams.get("endpoint_id") ?? "fal-ai/pricing")),
      }),
    )
    await expect(
      pricingFailure.tool!.fal_submit.execute({ endpoint: "fal-ai/pricing", input: {} }, context(new AbortController().signal)),
    ).rejects.toThrow("503")

    const schemaFailure = await hooks(
      {},
      createMediaStudioPlugin({
        createFalClient: () => client,
        platformFetch: async () => new Response("schema unavailable", { status: 503 }),
      }),
    )
    await expect(
      schemaFailure.tool!.fal_submit.execute({ endpoint: "fal-ai/schema", input: {} }, context(new AbortController().signal)),
    ).rejects.toThrow("503")

    let abortedFetches = 0
    const aborted = new AbortController()
    aborted.abort(new Error("submission aborted"))
    const abortFailure = await hooks(
      {},
      createMediaStudioPlugin({
        createFalClient: () => client,
        platformFetch: async () => {
          abortedFetches += 1
          return Response.json({ unit: "image", price: 0.1 })
        },
      }),
    )
    await expect(abortFailure.tool!.fal_submit.execute({ endpoint: "fal-ai/abort", input: {} }, context(aborted.signal))).rejects.toThrow(
      /aborted/i,
    )

    expect(abortedFetches).toBe(0)
    expect(submissions).toBe(0)
  })

  test("leaves model-specific input validation to the fal provider", async () => {
    process.env.FAL_KEY = "test-key"
    let pricingCalls = 0
    let submittedInput: unknown
    const requiredSchema = falSchema("fal-ai/required") as any
    requiredSchema.models[0].openapi.paths["/run"].post.requestBody.content["application/json"].schema.required = ["prompt"]
    const implementation = createMediaStudioPlugin({
      platformFetch: async (input) => {
        if (input.pathname.endsWith("/pricing")) {
          pricingCalls += 1
          return Response.json({ unit: "image", price: 0.1 })
        }
        return Response.json(requiredSchema)
      },
      createFalClient: () =>
        ({
          queue: {
            submit: async (_endpoint: string, options: { input: unknown }) => {
              submittedInput = options.input
              throw new Error("fal provider rejected missing prompt")
            },
          },
        }) as never,
    })
    const value = await hooks({}, implementation)
    const context = {
      sessionID: "session",
      messageID: "message",
      agent: "build",
      directory: root,
      worktree: root,
      abort: new AbortController().signal,
      metadata() {},
      async ask() {},
    }

    const input = {}
    await expect(value.tool!.fal_submit.execute({ endpoint: "fal-ai/required", input }, context)).rejects.toThrow(
      "fal provider rejected missing prompt",
    )
    expect(pricingCalls).toBe(1)
    expect(submittedInput).toBe(input)
  })

  test("honors aborts at every asynchronous fal submit boundary", async () => {
    process.env.FAL_KEY = "test-key"
    const context = (controller: AbortController) => ({
      sessionID: "session",
      messageID: "message",
      agent: "build",
      directory: root,
      worktree: root,
      abort: controller.signal,
      metadata() {},
      async ask() {},
    })

    const schemaController = new AbortController()
    const schemaAbort = await hooks(
      {},
      createMediaStudioPlugin({
        platformFetch: async (input) => {
          schemaController.abort(new Error("schema aborted"))
          return Response.json(falSchema(input.searchParams.get("endpoint_id") ?? "fal-ai/schema-abort"))
        },
        createFalClient: () =>
          ({
            queue: {
              submit: async () => {
                throw new Error("must not submit")
              },
            },
          }) as never,
      }),
    )
    await expect(
      schemaAbort.tool!.fal_submit.execute({ endpoint: "fal-ai/schema-abort", input: {} }, context(schemaController)),
    ).rejects.toThrow("schema aborted")

    const pricingController = new AbortController()
    const pricingAbort = await hooks(
      {},
      createMediaStudioPlugin({
        platformFetch: async (input) => {
          if (input.pathname.endsWith("/pricing")) {
            pricingController.abort(new Error("pricing aborted"))
            return Response.json({ unit: "image", price: 0.1 })
          }
          return Response.json(falSchema(input.searchParams.get("endpoint_id") ?? "fal-ai/pricing-abort"))
        },
        createFalClient: () =>
          ({
            queue: {
              submit: async () => {
                throw new Error("must not submit")
              },
            },
          }) as never,
      }),
    )
    await expect(
      pricingAbort.tool!.fal_submit.execute({ endpoint: "fal-ai/pricing-abort", input: {} }, context(pricingController)),
    ).rejects.toThrow("pricing aborted")

    const queueController = new AbortController()
    const queueAbort = await hooks(
      {},
      createMediaStudioPlugin({
        platformFetch: async (input) =>
          Response.json(
            input.pathname.endsWith("/pricing")
              ? { unit: "image", price: 0.1 }
              : falSchema(input.searchParams.get("endpoint_id") ?? "fal-ai/queue-abort"),
          ),
        createFalClient: () =>
          ({
            queue: {
              submit: async () => {
                queueController.abort(new Error("queue aborted"))
                throw queueController.signal.reason
              },
            },
          }) as never,
      }),
    )
    await expect(
      queueAbort.tool!.fal_submit.execute({ endpoint: "fal-ai/queue-abort", input: {} }, context(queueController)),
    ).rejects.toThrow("queue aborted")
  })

  test("generates a validated PNG with ChatGPT subscription auth", async () => {
    const bytes = png()
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({
      openai: { type: "oauth", access: "test-access", accountId: "account" },
    })
    let request: Request | undefined
    globalThis.fetch = (async (input, init) => {
      request = new Request(input, init)
      return new Response(
        `data: ${JSON.stringify({ type: "response.output_item.done", item: { type: "image_generation_call", result: bytes.toString("base64") } })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      )
    }) as typeof fetch

    const value = await hooks()
    const permissions: string[] = []
    const result = await value.tool!.chatgpt_image_generate.execute(
      { prompt: "A precise test image", outputPath: "test.png", quality: "auto" },
      {
        sessionID: "session",
        messageID: "message",
        agent: "build",
        directory: root,
        worktree: root,
        abort: new AbortController().signal,
        metadata() {},
        async ask(input) {
          permissions.push(input.permission)
        },
      },
    )

    const generatedPath = personal("images", "test.png")
    expect(await readFile(generatedPath)).toEqual(bytes)
    expect((await lstat(generatedPath)).mode & 0o777).toBe(0o660)
    expect(permissions).toEqual(["edit"])
    expect(request?.url).toBe("https://chatgpt.com/backend-api/codex/responses")
    expect(request?.headers.get("authorization")).toBe("Bearer test-access")
    expect(request?.headers.get("chatgpt-account-id")).toBe("account")
    expect(typeof result).not.toBe("string")
    if (typeof result === "string") throw new Error("Expected structured tool result")
    expect(result.metadata).toMatchObject({ provider: "chatgpt", billing: "subscription", width: 1024, height: 1024 })

    const toolContext = {
      sessionID: "session",
      messageID: "message",
      agent: "build",
      directory: root,
      worktree: root,
      abort: new AbortController().signal,
      metadata() {},
      async ask() {},
    }
    const listed = await value.tool!.media_list.execute({}, toolContext)
    expect(JSON.parse(String(listed))[0]).toMatchObject({ filePath: generatedPath, modality: "image" })
    const info = await value.tool!.media_info.execute({ filePath: generatedPath }, toolContext)
    expect(JSON.parse(String(info))).toMatchObject({ filePath: generatedPath, mime: "image/png" })
  })

  test("probes and converts media through configured FFmpeg binaries", async () => {
    await mkdir(root, { recursive: true })
    const fakeBinary = path.join(root, "fake-media-tool")
    await writeFile(
      fakeBinary,
      `#!/usr/bin/env bun
import { copyFile } from "node:fs/promises"
const args = process.argv.slice(2)
if (args.includes("-show_streams")) {
  console.log(JSON.stringify({ streams: [{ codec_type: "video", width: 1, height: 1 }], format: { duration: "1.0" } }))
} else {
  const source = args[args.indexOf("-i") + 1]
  const output = args.at(-1)
  await copyFile(source, output)
}
`,
    )
    await chmod(fakeBinary, 0o700)
    const value = await hooks({ ffmpegPath: fakeBinary, ffprobePath: fakeBinary })
    const source = personal("images", "source.png")
    await writeFile(
      source,
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
    )
    const toolContext = {
      sessionID: "session",
      messageID: "message",
      agent: "build",
      directory: root,
      worktree: root,
      abort: new AbortController().signal,
      metadata() {},
      async ask() {},
    }

    const probe = await value.tool!.media_probe.execute({ filePath: source }, toolContext)
    expect(JSON.parse(String(probe))).toMatchObject({ streams: [{ codec_type: "video" }] })
    const converted = await value.tool!.media_convert.execute(
      {
        filePath: source,
        preset: "image-png",
        outputPath: "converted.png",
      },
      toolContext,
    )
    expect(typeof converted).not.toBe("string")
    const convertedPath = personal("images", "converted.png")
    expect(await readFile(convertedPath)).toEqual(await readFile(source))
    const info = await value.tool!.media_info.execute({ filePath: convertedPath }, toolContext)
    expect(JSON.parse(String(info))).toMatchObject({ filePath: convertedPath, modality: "image", mime: "image/png" })
  })

  test("routes every default output class to the current user's modality directory", async () => {
    await mkdir(root, { recursive: true })
    await mkdir(outside, { recursive: true })
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
    const externalImage = path.join(outside, "reference.png")
    await writeFile(externalImage, image)
    const video = Buffer.alloc(24)
    video.writeUInt32BE(24, 0)
    video.write("ftyp", 4, "ascii")
    video.write("isom", 8, "ascii")
    const fakeBinary = path.join(root, "fake-media-tool")
    await writeFile(
      fakeBinary,
      `#!/usr/bin/env bun
import { copyFile, writeFile } from "node:fs/promises"
const args = process.argv.slice(2)
if (args.includes("-show_streams")) {
  console.log(JSON.stringify({ streams: [], format: {} }))
} else {
  const output = args.at(-1)
  if (output.endsWith(".wav")) {
    const wav = Buffer.alloc(44)
    wav.write("RIFF", 0); wav.writeUInt32LE(36, 4); wav.write("WAVEfmt ", 8)
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32)
    wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(0, 40)
    await writeFile(output, wav)
  } else {
    await copyFile(args[args.indexOf("-i") + 1], output)
  }
}
`,
    )
    await chmod(fakeBinary, 0o700)
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ openai: { type: "oauth", access: "test-access" } })
    globalThis.fetch = (async () =>
      new Response(
        `data: ${JSON.stringify({ type: "response.output_item.done", item: { type: "image_generation_call", result: png().toString("base64") } })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      )) as unknown as typeof fetch
    const value = await hooks({ ffmpegPath: fakeBinary, ffprobePath: fakeBinary })
    const sourceImage = personal("images", "source.png")
    const sourceVideo = personal("video", "source.mp4")
    await writeFile(sourceImage, image)
    await writeFile(sourceVideo, video)
    const context = {
      sessionID: "session",
      messageID: "message",
      agent: "build",
      directory: root,
      worktree: root,
      abort: new AbortController().signal,
      metadata() {},
      async ask() {},
    }

    const imported = await value.tool!.media_import.execute({ filePath: externalImage }, context)
    const generated = await value.tool!.chatgpt_image_generate.execute({ prompt: "test", quality: "auto" }, context)
    const converted = await value.tool!.media_convert.execute({ filePath: sourceImage, preset: "image-png" }, context)
    const trimmed = await value.tool!.media_trim.execute({ filePath: sourceVideo, startSeconds: 0, endSeconds: 1 }, context)
    const extracted = await value.tool!.media_extract_audio.execute({ filePath: sourceVideo, format: "wav" }, context)
    globalThis.fetch = (async () => new Response(image, { headers: { "content-type": "image/png" } })) as unknown as typeof fetch
    const downloaded = await value.tool!.media_download.execute(
      {
        url: "https://fal.media/download.png",
        outputPath: "download.png",
      },
      context,
    )

    for (const result of [imported, generated, converted, downloaded]) {
      expect(typeof result).not.toBe("string")
      if (typeof result !== "string") expect(result.title).toStartWith(personal("images", ""))
    }
    expect((trimmed as any).title).toStartWith(personal("video", ""))
    expect((extracted as any).title).toStartWith(personal("audio", ""))
  })

  test("downloads with unique defaults and no provider provenance contract", async () => {
    await mkdir(root, { recursive: true })
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
    let fetches = 0
    globalThis.fetch = (async () => {
      fetches += 1
      return new Response(image, { headers: { "content-type": "image/png" } })
    }) as unknown as typeof fetch
    const value = await hooks()
    const context = {
      sessionID: "session",
      messageID: "message",
      agent: "build",
      directory: root,
      worktree: root,
      abort: new AbortController().signal,
      metadata() {},
      async ask() {},
    }

    const first = await value.tool!.media_download.execute({ url: "https://fal.media/output.png" }, context)
    const second = await value.tool!.media_download.execute({ url: "https://fal.media/output.png" }, context)
    expect(typeof first).not.toBe("string")
    expect(typeof second).not.toBe("string")
    if (typeof first === "string" || typeof second === "string") throw new Error("Expected structured downloads")
    expect(first.title).toStartWith(personal("images", "download-"))
    expect(second.title).toStartWith(personal("images", "download-"))
    expect(second.title).not.toBe(first.title)
    expect(first.metadata).not.toHaveProperty("id")
    expect(first.metadata).not.toHaveProperty("provider")
    expect(first.metadata).not.toHaveProperty("billing")

    const collision = personal("images", "existing.png")
    await writeFile(collision, "existing")
    await expect(
      value.tool!.media_download.execute(
        {
          url: "https://fal.media/collision.png",
          outputPath: "existing.png",
        },
        context,
      ),
    ).rejects.toThrow("already exists")
    expect(await readFile(collision, "utf8")).toBe("existing")
    expect(fetches).toBe(3)
  })

  test("rejects output parent replacement and collisions without deleting attacker files", async () => {
    await mkdir(root, { recursive: true })
    await mkdir(outside, { recursive: true })
    const source = personal("images", "source.png")
    const output = personal("images", "output.png")
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
    let mode: "parent" | "collision" = "parent"
    const implementation = createMediaStudioPlugin({
      async beforeMediaSpawn() {
        if (mode === "parent") {
          await rm(path.dirname(output), { recursive: true, force: true })
          await symlink(outside, path.dirname(output))
        } else {
          await writeFile(output, "attacker collision")
        }
      },
    })
    const value = await hooks({ ffmpegPath: process.execPath }, implementation)
    await writeFile(source, image)
    const context = {
      sessionID: "session",
      messageID: "message",
      agent: "build",
      directory: root,
      worktree: root,
      abort: new AbortController().signal,
      metadata() {},
      async ask() {},
    }

    await expect(
      value.tool!.media_convert.execute({ filePath: source, preset: "image-png", outputPath: "output.png" }, context),
    ).rejects.toThrow("no longer safe")
    await expect(readFile(path.join(outside, "output.png"))).rejects.toThrow()
    await rm(path.dirname(output), { force: true })
    await mkdir(path.dirname(output), { recursive: true })
    await writeFile(source, image)
    mode = "collision"
    await expect(
      value.tool!.media_convert.execute({ filePath: source, preset: "image-png", outputPath: "output.png" }, context),
    ).rejects.toThrow("already exists")
    expect(await readFile(output, "utf8")).toBe("attacker collision")
  })

  test("removes partial local-operation output after child failure and abort", async () => {
    await mkdir(root, { recursive: true })
    const source = personal("images", "source.png")
    const fakeBinary = path.join(root, "partial-tool")
    await writeFile(
      fakeBinary,
      `#!/usr/bin/env bun
import { writeFile } from "node:fs/promises"
const output = process.argv.at(-1)
await writeFile(output, "partial")
if (output.includes("aborted")) await Bun.sleep(10_000)
else process.exit(1)
`,
    )
    await chmod(fakeBinary, 0o700)
    const context = (abort: AbortSignal) => ({
      sessionID: "session",
      messageID: "message",
      agent: "build",
      directory: root,
      worktree: root,
      abort,
      metadata() {},
      async ask() {},
    })

    const failed = await hooks({ ffmpegPath: fakeBinary })
    await writeFile(
      source,
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
    )
    const failedOutput = personal("images", "failed.png")
    await expect(
      failed.tool!.media_convert.execute(
        { filePath: source, preset: "image-png", outputPath: "failed.png" },
        context(new AbortController().signal),
      ),
    ).rejects.toThrow("exited with code 1")
    await expect(readFile(failedOutput)).rejects.toThrow()

    const aborted = await hooks({ ffmpegPath: fakeBinary })
    const controller = new AbortController()
    const abortedOutput = personal("images", "aborted.png")
    const execution = aborted.tool!.media_convert.execute(
      { filePath: source, preset: "image-png", outputPath: "aborted.png" },
      context(controller.signal),
    )
    await Bun.sleep(50)
    controller.abort(new Error("operation aborted"))
    await expect(execution).rejects.toThrow("operation aborted")
    await expect(readFile(abortedOutput)).rejects.toThrow()
  })
})
