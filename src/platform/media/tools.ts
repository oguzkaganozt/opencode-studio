import { randomUUID } from "node:crypto"
import { chmod, rm } from "node:fs/promises"
import path from "node:path"
import type { Plugin, PluginOptions } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import type { Part } from "@opencode-ai/sdk"
import manifest from "../../../package.json" with { type: "json" }
import { resolveFfmpeg, resolveFfprobe } from "../../core/engines"
import { importMediaAsset, inspectCreatedMedia } from "./assets"
import { loadChatGPTAuth } from "./chatgpt-auth"
import { decodeGeneratedPng, generateChatGPTImage, readReferenceImages } from "./chatgpt-image"
import { downloadMedia } from "./download"
import {
  createVideoClient,
  type FalClient,
  type FalPlatformFetcher,
  falEndpoint,
  falPlatformGet,
  falRequestID,
  formatToolJSON,
  requireFalKey,
  throwIfAborted,
} from "./fal"
import { type ConvertPreset, convertArguments, extractAudioArguments, probeMedia, runMediaProcess, trimArguments } from "./ffmpeg"
import { initializeLibrary, inspectManagedAsset, type LibraryModality, openManagedAsset, personalOutputPath, scanLibrary } from "./library"
import { formatBytes, hasPlausibleSignature, MAX_MEDIA_BYTES, mediaMime, mediaModality } from "./media"
import { type NativeSessionDescriptor, nativeCompatibilityError, shouldPatchNativeVideo } from "./native-compatibility"
import { canonicalStudioRoot, prepareNewOutput, verifyNewOutput, verifyOutputParent, writeNewFileAtomic } from "./studio-path"

const PROVIDER_PACKAGE = `${manifest.name}@${manifest.version}`
const READ_TOOL_NAME = "read_media"
const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024

type Options = {
  maxNativeBytes: number
  maxDownloadBytes: number
  maxUploadBytes: number
  libraryRoot?: string
  downloadHosts: string[]
  providerPackage: string
  ffmpegPath: string
  ffprobePath: string
}

function positiveInteger(value: unknown, fallback: number, name: string) {
  const output = value === undefined ? fallback : value
  if (typeof output !== "number" || !Number.isSafeInteger(output) || output <= 0) {
    throw new Error(`opencode-media: ${name} must be a positive integer`)
  }
  return output
}

function workspaceRootOption(value: unknown) {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) {
    throw new Error("opencode-media: workspaceRoot must be an absolute path")
  }
  return value
}

function options(input: PluginOptions | undefined): Options {
  const downloadHosts = Array.isArray(input?.downloadHosts)
    ? input.downloadHosts.filter((value): value is string => typeof value === "string" && value.length > 0)
    : ["fal.media"]
  if (downloadHosts.length === 0) throw new Error("opencode-media: downloadHosts must contain at least one hostname")
  return {
    maxNativeBytes: positiveInteger(input?.maxNativeBytes, MAX_MEDIA_BYTES, "maxNativeBytes"),
    maxDownloadBytes: positiveInteger(input?.maxDownloadBytes, MAX_DOWNLOAD_BYTES, "maxDownloadBytes"),
    maxUploadBytes: positiveInteger(input?.maxUploadBytes, MAX_UPLOAD_BYTES, "maxUploadBytes"),
    libraryRoot: workspaceRootOption(input?.libraryRoot ?? input?.workspaceRoot),
    downloadHosts: downloadHosts.map((value) => value.toLowerCase()),
    providerPackage: typeof input?.providerPackage === "string" ? input.providerPackage : PROVIDER_PACKAGE,
    ffmpegPath: typeof input?.ffmpegPath === "string" ? input.ffmpegPath : (resolveFfmpeg()?.path ?? "ffmpeg"),
    ffprobePath: typeof input?.ffprobePath === "string" ? input.ffprobePath : (resolveFfprobe()?.path ?? "ffprobe"),
  }
}

const PRESET_EXTENSION: Record<ConvertPreset, string> = {
  "video-mp4": "mp4",
  "video-webm": "webm",
  "audio-mp3": "mp3",
  "audio-wav": "wav",
  "image-png": "png",
  "image-webp": "webp",
}

function sessionID(messages: Array<{ info: { sessionID: string } }>) {
  return messages[0]?.info.sessionID
}

function isNativeMediaPart(part: Part) {
  return part.type === "file" && (part.mime.startsWith("audio/") || part.mime.startsWith("video/"))
}

function promoteToolMedia(messages: Array<{ info: any; parts: Part[] }>, strip: boolean) {
  const output: typeof messages = []
  const latest = messages.at(-1)

  for (const message of messages) {
    output.push(message)
    if (message.info.role !== "assistant") continue

    const attachments: Part[] = []
    for (const part of message.parts) {
      if (part.type !== "tool" || part.tool !== READ_TOOL_NAME || part.state.status !== "completed") continue
      const media = (part.state.attachments ?? []).filter(isNativeMediaPart)
      if (media.length === 0) continue
      part.state.attachments = (part.state.attachments ?? []).filter((item) => !isNativeMediaPart(item))
      if (!strip && message === latest) attachments.push(...media)
    }

    if (strip || attachments.length === 0) continue
    const source = [...output].reverse().find((item) => item.info.role === "user")
    if (!source) continue
    const id = `${message.info.id}_native_media`
    output.push({
      info: {
        ...source.info,
        id,
        role: "user",
        time: { created: message.info.time?.created ?? Date.now() },
      },
      parts: [
        {
          id: `${id}_text`,
          sessionID: message.info.sessionID,
          messageID: id,
          type: "text",
          synthetic: true,
          text: "Native media returned by read_media:",
        },
        ...attachments.map((part, index) => ({
          ...part,
          id: `${id}_file_${index}`,
          sessionID: message.info.sessionID,
          messageID: id,
          synthetic: true,
        })),
      ] as Part[],
    })
  }

  messages.splice(0, messages.length, ...output)
}

function patchModels(provider: any, providerPackage: string, providerID: string) {
  return Object.fromEntries(
    Object.entries(provider.models).map(([id, value]) => {
      const model = value as any
      const npm = model.api.npm
      if (!shouldPatchNativeVideo({ providerID, adapter: npm, video: model.capabilities.input.video })) return [id, model]
      return [
        id,
        {
          ...model,
          capabilities: {
            ...model.capabilities,
            input: { ...model.capabilities.input, video: true },
          },
          api: { ...model.api, npm: providerPackage },
          options: {
            ...model.options,
            nativeMediaAdapter: npm,
            nativeMediaProtocol: npm === "@ai-sdk/anthropic" ? "anthropic" : "openai-compatible",
          },
        },
      ]
    }),
  )
}

export type MediaStudioPluginDependencies = {
  createFalClient?: () => FalClient
  platformFetch?: FalPlatformFetcher
  beforeMediaSpawn?: () => Promise<void>
  resolveUsername?: (uid: number) => string
}

export function createMediaStudioPlugin(dependencies: MediaStudioPluginDependencies = {}): Plugin {
  const createFalClient = dependencies.createFalClient ?? createVideoClient
  const platformFetch: FalPlatformFetcher = dependencies.platformFetch ?? ((input, init) => globalThis.fetch(input, init))

  return async (context, rawOptions) => {
    const config = options(rawOptions)
    const workspaceRoot = await canonicalStudioRoot(config.libraryRoot ?? context.directory)
    const library = await initializeLibrary({ root: workspaceRoot, resolveUsername: dependencies.resolveUsername })
    const studioRoot = library.root
    const fal = createFalClient()
    const compacting = new Set<string>()
    const sessionModels = new Map<string, NativeSessionDescriptor>()

    const assertNativeCompatibility = (sessionID: string, filePath: string) => {
      const error = nativeCompatibilityError(sessionModels.get(sessionID), mediaMime(filePath))
      if (error) throw error
    }

    return {
      config(input) {
        for (const providerID of ["opencode", "opencode-go"]) {
          const provider = input.provider?.[providerID]
          if (!provider) continue
          for (const model of Object.values(provider.models ?? {})) {
            const npm = model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible"
            if (
              !shouldPatchNativeVideo({
                providerID,
                adapter: npm,
                video: model.modalities?.input?.includes("video") ?? false,
              })
            )
              continue
            model.provider = { ...model.provider, npm: config.providerPackage }
            model.options = {
              ...model.options,
              nativeMediaAdapter: npm,
              nativeMediaProtocol: npm === "@ai-sdk/anthropic" ? "anthropic" : "openai-compatible",
            }
          }
        }
        return Promise.resolve()
      },

      provider: {
        id: "opencode",
        async models(provider) {
          return patchModels(provider, config.providerPackage, "opencode")
        },
      },

      event: async ({ event }) => {
        if (event.type !== "session.deleted") return
        const id = event.properties.info.id
        compacting.delete(id)
        sessionModels.delete(id)
      },

      "experimental.chat.system.transform": async (input) => {
        if (!input.sessionID) return
        const adapter =
          typeof input.model.options.nativeMediaAdapter === "string" ? input.model.options.nativeMediaAdapter : input.model.api.npm
        sessionModels.set(input.sessionID, {
          providerID: input.model.providerID,
          modelID: input.model.id,
          adapter,
          input: {
            audio: input.model.capabilities.input.audio,
            video: input.model.capabilities.input.video,
          },
        })
      },

      "tool.execute.before": async (input, output) => {
        if (input.tool !== READ_TOOL_NAME) return
        assertNativeCompatibility(input.sessionID, typeof output.args?.filePath === "string" ? output.args.filePath : "")
      },

      "experimental.session.compacting": async (input) => {
        compacting.add(input.sessionID)
      },

      "experimental.chat.messages.transform": async (_input, output) => {
        const id = sessionID(output.messages)
        const strip = id ? compacting.delete(id) : false
        promoteToolMedia(output.messages, strip)
      },

      tool: {
        [READ_TOOL_NAME]: tool({
          description:
            "Read an audio or video file as a native model attachment. Provider support is determined when the attachment is sent.",
          args: {
            filePath: tool.schema.string().describe("Absolute or workspace-relative media file path"),
          },
          async execute(args, context) {
            assertNativeCompatibility(context.sessionID, args.filePath)
            const media = await openManagedAsset({
              root: studioRoot,
              workspaceRoot,
              filePath: args.filePath,
              signal: context.abort,
              ask: context.ask,
            })
            const mime = mediaMime(media.filePath)
            const modality = mime ? mediaModality(mime) : undefined
            if (!mime || !modality) {
              await media.handle.close()
              throw new Error(`Unsupported media file extension: ${path.extname(media.filePath) || "(none)"}`)
            }
            const bytes = await (async () => {
              try {
                if (media.bytes > config.maxNativeBytes) {
                  throw new Error(
                    `Media file is ${formatBytes(media.bytes)}; maximum is ${formatBytes(config.maxNativeBytes)}: ${media.filePath}`,
                  )
                }

                const buffer = Buffer.allocUnsafe(media.bytes)
                let offset = 0
                while (offset < buffer.length) {
                  if (context.abort.aborted) throw context.abort.reason ?? new Error("Media read aborted")
                  const result = await media.handle.read(buffer, offset, buffer.length - offset, offset)
                  if (result.bytesRead === 0) break
                  offset += result.bytesRead
                }
                return buffer.subarray(0, offset)
              } finally {
                await media.handle.close()
              }
            })()
            if (!hasPlausibleSignature(mime, bytes.subarray(0, 4096)))
              throw new Error(`File content does not match ${mime}: ${media.filePath}`)

            const output = `${modality === "video" ? "Video" : "Audio"} attached natively: ${path.basename(media.filePath)}`
            return {
              title: media.filePath,
              output,
              metadata: { filePath: media.filePath, mime, bytes: bytes.length, native: true },
              attachments: [
                {
                  type: "file",
                  mime,
                  filename: path.basename(media.filePath),
                  url: `data:${mime};base64,${bytes.toString("base64")}`,
                },
              ],
            }
          },
        }),

        chatgpt_image_generate: tool({
          description:
            "Generate one PNG directly through the user's ChatGPT subscription and OpenCode OAuth. Use for ordinary image generation before paid fal.ai image endpoints. Supports optional reference images and never overwrites an existing file.",
          args: {
            prompt: tool.schema.string().min(1).describe("Description of the image to generate"),
            outputPath: tool.schema.string().optional().describe("Optional PNG path under the workspace (default: media/<auto>.png)"),
            quality: tool.schema.enum(["low", "medium", "high", "auto"]).default("auto"),
            size: tool.schema
              .string()
              .optional()
              .describe("Optional 'auto' or WIDTHxHEIGHT; dimensions must satisfy the hosted image tool limits"),
            images: tool.schema
              .array(tool.schema.string())
              .max(10)
              .optional()
              .describe("Optional local reference image paths, resolved from the workspace root"),
          },
          async execute(args, toolContext) {
            const quality = args.quality ?? "auto"
            const outputPath = personalOutputPath(
              library,
              "image",
              args.outputPath,
              `chatgpt-${Date.now()}-${randomUUID().slice(0, 8)}.png`,
            )
            if (path.extname(outputPath).toLowerCase() !== ".png") throw new Error("ChatGPT image outputPath must end in .png")
            const auth = await loadChatGPTAuth()
            if (!auth) throw new Error("OpenCode is not authenticated with ChatGPT OAuth")
            const referenceImages = await readReferenceImages({
              paths: args.images,
              root: workspaceRoot,
              signal: toolContext.abort,
              ask: toolContext.ask,
            })
            const target = await prepareNewOutput({ root: studioRoot, outputPath, ask: toolContext.ask })
            const base64 = await generateChatGPTImage({
              auth,
              args: { prompt: args.prompt, quality, size: args.size, images: args.images },
              referenceImages,
              signal: toolContext.abort,
            })
            const image = decodeGeneratedPng(base64)
            await verifyOutputParent(studioRoot, target.outputPath)
            await writeNewFileAtomic(target.outputPath, image.bytes)
            return {
              title: target.outputPath,
              output: `Generated image with ChatGPT subscription: ${target.outputPath}`,
              metadata: {
                filePath: target.outputPath,
                mime: "image/png",
                bytes: image.bytes.length,
                width: image.width,
                height: image.height,
                provider: "chatgpt",
                billing: "subscription",
              },
            }
          },
        }),

        media_import: tool({
          description: "Copy a server-local image, audio, or video file into the workspace (default: media/).",
          args: {
            filePath: tool.schema.string().describe("Absolute path, or path relative to the workspace root"),
            outputPath: tool.schema.string().optional().describe("Optional workspace-relative output path"),
          },
          async execute(args, toolContext) {
            const media = await importMediaAsset({
              root: workspaceRoot,
              filePath: args.filePath,
              outputRoot: studioRoot,
              mediaDir: library.mediaDir,
              outputPath: args.outputPath,
              signal: toolContext.abort,
              ask: toolContext.ask,
            })
            return {
              title: media.filePath,
              output: `Imported media asset: ${media.filePath}`,
              metadata: await inspectManagedAsset(studioRoot, media.filePath),
            }
          },
        }),

        media_list: tool({
          description: "Scan image, audio, and video files under the workspace.",
          args: {
            modality: tool.schema.enum(["image", "audio", "video"]).optional(),
            filename: tool.schema.string().optional().describe("Case-insensitive filename substring"),
            limit: tool.schema.number().int().min(1).max(200).default(50),
            offset: tool.schema.number().int().min(0).default(0),
          },
          async execute(args) {
            const assets = await scanLibrary({
              root: studioRoot,
              modality: args.modality as LibraryModality | undefined,
              filename: args.filename,
              limit: args.limit ?? 50,
              offset: args.offset ?? 0,
            })
            return formatToolJSON(assets)
          },
        }),

        media_info: tool({
          description: "Inspect filesystem and detected-format information for one workspace media file.",
          args: {
            filePath: tool.schema.string().describe("Absolute or workspace-relative media file path"),
          },
          async execute(args) {
            return formatToolJSON(await inspectManagedAsset(studioRoot, args.filePath))
          },
        }),

        media_probe: tool({
          description: "Inspect a workspace media file with ffprobe without persisting probe data.",
          args: {
            filePath: tool.schema.string().describe("Absolute or workspace-relative media file path"),
          },
          async execute(args, toolContext) {
            const media = await openManagedAsset({
              root: studioRoot,
              workspaceRoot,
              filePath: args.filePath,
              signal: toolContext.abort,
              ask: toolContext.ask,
            })
            try {
              const probe = await probeMedia({
                binary: config.ffprobePath,
                filePath: media.filePath,
                signal: toolContext.abort,
                inputFd: media.handle.fd,
                beforeSpawn: dependencies.beforeMediaSpawn,
              })
              return formatToolJSON(probe)
            } finally {
              await media.handle.close()
            }
          },
        }),

        media_convert: tool({
          description:
            "Create a converted media asset with a typed FFmpeg preset. Never overwrites the source or accepts raw FFmpeg arguments.",
          args: {
            filePath: tool.schema.string().describe("Workspace media input path"),
            preset: tool.schema.enum(["video-mp4", "video-webm", "audio-mp3", "audio-wav", "image-png", "image-webp"]),
            outputPath: tool.schema.string().optional().describe("Optional workspace-relative output path (default: media/)"),
            width: tool.schema.number().int().min(16).max(3840).optional(),
            height: tool.schema.number().int().min(16).max(3840).optional(),
            quality: tool.schema.number().int().min(0).max(100).optional(),
            videoBitrateKbps: tool.schema.number().int().min(1).max(200_000).optional(),
            audioBitrateKbps: tool.schema.number().int().min(8).max(1_536).optional(),
          },
          async execute(args, toolContext) {
            const source = await openManagedAsset({
              root: studioRoot,
              workspaceRoot,
              filePath: args.filePath,
              signal: toolContext.abort,
              ask: toolContext.ask,
            })
            try {
              if (args.preset.startsWith("video-") && source.modality !== "video") throw new Error(`${args.preset} requires video input`)
              if (args.preset.startsWith("image-") && source.modality !== "image") throw new Error(`${args.preset} requires image input`)
              if (args.preset.startsWith("audio-") && source.modality === "image")
                throw new Error(`${args.preset} requires audio or video input`)
              if (args.quality !== undefined) {
                if (args.preset === "video-mp4" && args.quality > 51) throw new Error("video-mp4 quality must be between 0 and 51")
                if (args.preset === "video-webm" && args.quality > 63) throw new Error("video-webm quality must be between 0 and 63")
                if (args.preset.startsWith("image-") && args.quality < 1) throw new Error("image quality must be between 1 and 100")
              }
              const extension = PRESET_EXTENSION[args.preset]
              const stem = path.basename(source.filePath, path.extname(source.filePath))
              const outputModality: LibraryModality = args.preset.startsWith("video-")
                ? "video"
                : args.preset.startsWith("audio-")
                  ? "audio"
                  : "image"
              const outputPath = personalOutputPath(
                library,
                outputModality,
                args.outputPath,
                `${stem}-convert-${randomUUID().slice(0, 8)}.${extension}`,
              )
              if (path.extname(outputPath).toLowerCase() !== `.${extension}`) throw new Error(`Output path must end in .${extension}`)
              const target = await prepareNewOutput({ root: studioRoot, outputPath, ask: toolContext.ask })
              let outputMayBePartial = false
              try {
                await runMediaProcess({
                  binary: config.ffmpegPath,
                  args: convertArguments({
                    source: "/dev/fd/3",
                    output: target.outputPath,
                    preset: args.preset,
                    width: args.width,
                    height: args.height,
                    quality: args.quality,
                    videoBitrateKbps: args.videoBitrateKbps,
                    audioBitrateKbps: args.audioBitrateKbps,
                  }),
                  signal: toolContext.abort,
                  inputFd: source.handle.fd,
                  beforeSpawn: async () => {
                    await dependencies.beforeMediaSpawn?.()
                    await verifyNewOutput(studioRoot, target.outputPath)
                    outputMayBePartial = true
                  },
                })
                await chmod(target.outputPath, 0o660)
                const output = await inspectCreatedMedia(target.outputPath)
                return {
                  title: output.filePath,
                  output: `Converted media to ${output.filePath}`,
                  metadata: await inspectManagedAsset(studioRoot, output.filePath),
                }
              } catch (error) {
                if (outputMayBePartial) await rm(target.outputPath, { force: true })
                throw error
              }
            } finally {
              await source.handle.close()
            }
          },
        }),

        media_trim: tool({
          description: "Create an accurately trimmed audio or video asset without modifying the source.",
          args: {
            filePath: tool.schema.string().describe("Workspace media input path"),
            startSeconds: tool.schema.number().min(0),
            endSeconds: tool.schema.number().positive(),
            outputPath: tool.schema.string().optional().describe("Optional .mp4 or .mp3 path in the current user's modality directory"),
          },
          async execute(args, toolContext) {
            if (args.endSeconds <= args.startSeconds) throw new Error("endSeconds must be greater than startSeconds")
            const source = await openManagedAsset({
              root: studioRoot,
              workspaceRoot,
              filePath: args.filePath,
              signal: toolContext.abort,
              ask: toolContext.ask,
            })
            try {
              if (source.modality === "image") throw new Error("media_trim requires audio or video input")
              const extension = source.modality === "video" ? "mp4" : "mp3"
              const stem = path.basename(source.filePath, path.extname(source.filePath))
              const outputPath = personalOutputPath(
                library,
                source.modality,
                args.outputPath,
                `${stem}-trim-${randomUUID().slice(0, 8)}.${extension}`,
              )
              if (path.extname(outputPath).toLowerCase() !== `.${extension}`) throw new Error(`Output path must end in .${extension}`)
              const target = await prepareNewOutput({ root: studioRoot, outputPath, ask: toolContext.ask })
              let outputMayBePartial = false
              try {
                await runMediaProcess({
                  binary: config.ffmpegPath,
                  args: trimArguments({
                    source: "/dev/fd/3",
                    output: target.outputPath,
                    modality: source.modality,
                    startSeconds: args.startSeconds,
                    endSeconds: args.endSeconds,
                  }),
                  signal: toolContext.abort,
                  inputFd: source.handle.fd,
                  beforeSpawn: async () => {
                    await dependencies.beforeMediaSpawn?.()
                    await verifyNewOutput(studioRoot, target.outputPath)
                    outputMayBePartial = true
                  },
                })
                await chmod(target.outputPath, 0o660)
                const output = await inspectCreatedMedia(target.outputPath)
                return {
                  title: output.filePath,
                  output: `Trimmed media to ${output.filePath}`,
                  metadata: await inspectManagedAsset(studioRoot, output.filePath),
                }
              } catch (error) {
                if (outputMayBePartial) await rm(target.outputPath, { force: true })
                throw error
              }
            } finally {
              await source.handle.close()
            }
          },
        }),

        media_extract_audio: tool({
          description: "Extract a new MP3 or WAV audio asset from local video or audio without modifying the source.",
          args: {
            filePath: tool.schema.string().describe("Workspace media input path"),
            format: tool.schema.enum(["mp3", "wav"]).default("mp3"),
            outputPath: tool.schema.string().optional().describe("Optional output path in the current user's audio directory"),
          },
          async execute(args, toolContext) {
            const format = args.format ?? "mp3"
            const source = await openManagedAsset({
              root: studioRoot,
              workspaceRoot,
              filePath: args.filePath,
              signal: toolContext.abort,
              ask: toolContext.ask,
            })
            try {
              if (source.modality === "image") throw new Error("media_extract_audio requires audio or video input")
              const stem = path.basename(source.filePath, path.extname(source.filePath))
              const outputPath = personalOutputPath(
                library,
                "audio",
                args.outputPath,
                `${stem}-audio-${randomUUID().slice(0, 8)}.${format}`,
              )
              if (path.extname(outputPath).toLowerCase() !== `.${format}`) throw new Error(`Output path must end in .${format}`)
              const target = await prepareNewOutput({ root: studioRoot, outputPath, ask: toolContext.ask })
              let outputMayBePartial = false
              try {
                await runMediaProcess({
                  binary: config.ffmpegPath,
                  args: extractAudioArguments({ source: "/dev/fd/3", output: target.outputPath, format }),
                  signal: toolContext.abort,
                  inputFd: source.handle.fd,
                  beforeSpawn: async () => {
                    await dependencies.beforeMediaSpawn?.()
                    await verifyNewOutput(studioRoot, target.outputPath)
                    outputMayBePartial = true
                  },
                })
                await chmod(target.outputPath, 0o660)
                const output = await inspectCreatedMedia(target.outputPath)
                return {
                  title: output.filePath,
                  output: `Extracted audio to ${output.filePath}`,
                  metadata: await inspectManagedAsset(studioRoot, output.filePath),
                }
              } catch (error) {
                if (outputMayBePartial) await rm(target.outputPath, { force: true })
                throw error
              }
            } finally {
              await source.handle.close()
            }
          },
        }),

        fal_upload: tool({
          description:
            "Upload a local image, audio, or video file to fal storage for use as generation input. Returns a temporary HTTPS URL.",
          args: {
            filePath: tool.schema.string().describe("Absolute or workspace-relative media file path"),
            expiresIn: tool.schema.enum(["1h", "1d", "7d", "30d"]).default("1d"),
          },
          async execute(args, toolContext) {
            requireFalKey()
            const expiresIn = args.expiresIn ?? "1d"
            const media = await openManagedAsset({
              root: studioRoot,
              workspaceRoot,
              filePath: args.filePath,
              signal: toolContext.abort,
              ask: toolContext.ask,
            })
            let bytes: Buffer
            try {
              if (media.bytes > config.maxUploadBytes) throw new Error(`File exceeds ${config.maxUploadBytes} bytes: ${media.filePath}`)
              bytes = Buffer.allocUnsafe(media.bytes)
              let offset = 0
              while (offset < bytes.length) {
                throwIfAborted(toolContext.abort)
                const result = await media.handle.read(bytes, offset, bytes.length - offset, offset)
                if (result.bytesRead === 0) break
                offset += result.bytesRead
              }
              bytes = bytes.subarray(0, offset)
            } finally {
              await media.handle.close()
            }
            if (toolContext.abort.aborted) throw toolContext.abort.reason ?? new Error("fal upload aborted")
            const url = await fal.storage.upload(new File([new Uint8Array(bytes)], path.basename(media.filePath), { type: media.mime }), {
              lifecycle: { expiresIn },
            })
            if (toolContext.abort.aborted) throw toolContext.abort.reason ?? new Error("fal upload aborted")
            return {
              title: media.filePath,
              output: `Uploaded media to fal storage: ${url}`,
              metadata: { filePath: media.filePath, url, expiresIn },
            }
          },
        }),

        fal_models: tool({
          description: "Search active fal.ai model endpoints for image, audio, or video generation.",
          args: {
            query: tool.schema.string().optional().describe("Free-text model search, for example 'text to video' or 'Veo 3.1'"),
            category: tool.schema.string().optional().describe("Optional fal category, for example text-to-video or image-to-video"),
            limit: tool.schema.number().int().min(1).max(20).default(10),
          },
          async execute(args, toolContext) {
            const result = await falPlatformGet(
              "/models",
              {
                q: args.query,
                category: args.category,
                status: "active",
                limit: args.limit ?? 10,
              },
              platformFetch,
              toolContext.abort,
            )
            return formatToolJSON(result)
          },
        }),

        fal_model_schema: tool({
          description: "Get current fal.ai metadata and OpenAPI input/output schema for one model endpoint before submitting a request.",
          args: {
            endpoint: tool.schema.string().describe("fal endpoint ID returned by fal_models"),
          },
          async execute(args, toolContext) {
            const result = await falPlatformGet(
              "/models",
              {
                endpoint_id: falEndpoint(args.endpoint),
                expand: "openapi-3.0",
                limit: 1,
              },
              platformFetch,
              toolContext.abort,
            )
            return formatToolJSON(result)
          },
        }),

        fal_pricing: tool({
          description: "Get the current fal.ai billing unit and unit price for a model endpoint. Call before paid generation.",
          args: {
            endpoint: tool.schema.string().describe("fal endpoint ID"),
          },
          async execute(args, toolContext) {
            requireFalKey()
            return formatToolJSON(
              await falPlatformGet("/models/pricing", { endpoint_id: falEndpoint(args.endpoint) }, platformFetch, toolContext.abort),
            )
          },
        }),

        fal_submit: tool({
          description:
            "Submit an asynchronous paid fal.ai generation job. First call fal_model_schema and fal_pricing, then pass input matching that endpoint's schema.",
          args: {
            endpoint: tool.schema.string().describe("fal model endpoint ID"),
            input: tool.schema
              .record(tool.schema.string(), tool.schema.unknown())
              .describe("Model-specific input matching fal_model_schema"),
          },
          async execute(args, toolContext) {
            requireFalKey()
            const endpoint = falEndpoint(args.endpoint)
            throwIfAborted(toolContext.abort)
            await falPlatformGet(
              "/models",
              {
                endpoint_id: endpoint,
                expand: "openapi-3.0",
                limit: 1,
              },
              platformFetch,
              toolContext.abort,
            )
            throwIfAborted(toolContext.abort)
            await falPlatformGet("/models/pricing", { endpoint_id: endpoint }, platformFetch, toolContext.abort)
            throwIfAborted(toolContext.abort)
            const result = await fal.queue.submit(endpoint, { input: args.input, abortSignal: toolContext.abort })
            return formatToolJSON(result)
          },
        }),

        fal_status: tool({
          description: "Check an asynchronous fal.ai generation job without blocking OpenCode.",
          args: {
            endpoint: tool.schema.string().describe("The endpoint used for submission"),
            requestId: tool.schema.string().describe("fal request_id returned by fal_submit"),
            logs: tool.schema.boolean().default(true),
          },
          async execute(args, toolContext) {
            requireFalKey()
            const endpoint = falEndpoint(args.endpoint)
            const requestId = falRequestID(args.requestId)
            const result = await fal.queue.status(endpoint, {
              requestId,
              logs: args.logs ?? true,
              abortSignal: toolContext.abort,
            })
            return formatToolJSON(result)
          },
        }),

        fal_result: tool({
          description: "Retrieve the model-specific result of a completed fal.ai generation job.",
          args: {
            endpoint: tool.schema.string().describe("The endpoint used for submission"),
            requestId: tool.schema.string().describe("fal request_id returned by fal_submit"),
          },
          async execute(args, toolContext) {
            requireFalKey()
            const endpoint = falEndpoint(args.endpoint)
            const requestId = falRequestID(args.requestId)
            const result = await fal.queue.result(endpoint, {
              requestId,
              abortSignal: toolContext.abort,
            })
            return formatToolJSON(result)
          },
        }),

        fal_cancel: tool({
          description: "Request cancellation of a queued or running fal.ai generation job.",
          args: {
            endpoint: tool.schema.string().describe("The endpoint used for submission"),
            requestId: tool.schema.string().describe("fal request_id returned by fal_submit"),
          },
          async execute(args, toolContext) {
            requireFalKey()
            const endpoint = falEndpoint(args.endpoint)
            const requestId = falRequestID(args.requestId)
            await fal.queue.cancel(endpoint, {
              requestId,
              abortSignal: toolContext.abort,
            })
            return `Cancellation requested for ${requestId}; the job remains active until fal confirms status`
          },
        }),

        media_download: tool({
          description: "Download generated media into the workspace (default: media/).",
          args: {
            url: tool.schema.string().url().describe("HTTPS media URL returned by a generation provider"),
            outputPath: tool.schema.string().optional().describe("Optional workspace-relative output path (default: media/)"),
          },
          async execute(args, context) {
            const result = await downloadMedia({
              url: args.url,
              outputPath: args.outputPath,
              library,
              allowedHosts: config.downloadHosts,
              maxBytes: config.maxDownloadBytes,
              signal: context.abort,
              ask: context.ask,
            })
            return {
              title: result.filePath,
              output: `Downloaded generated media to ${result.filePath}`,
              metadata: await inspectManagedAsset(studioRoot, result.filePath),
            }
          },
        }),
      },
    }
  }
}

const MediaStudioPlugin = createMediaStudioPlugin()

export const AnthropicNativeMediaProviderPlugin: Plugin = async (_context, rawOptions) => {
  const config = options(rawOptions)
  return {
    provider: {
      id: "opencode-go",
      async models(provider) {
        return patchModels(provider, config.providerPackage, "opencode-go")
      },
    },
  }
}

export default MediaStudioPlugin
