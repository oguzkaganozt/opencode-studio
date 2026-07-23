import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { open, realpath, rm, stat } from "node:fs/promises"
import path from "node:path"
import { fileTypeFromBuffer, fileTypeFromFile } from "file-type"
import type { LibraryModality as MediaModality } from "./library"
import { type AskPermission, isInside, prepareNewOutput, readSecureFile, verifyOutputParent } from "./studio-path"

const DETECTION_BYTES = 64 * 1024

export function modalityFromMime(mime: string): MediaModality | undefined {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
}

export async function readMediaForUpload(input: {
  root: string
  filePath: string
  maxBytes: number
  signal: AbortSignal
  ask: AskPermission
}) {
  const file = await readSecureFile(input)
  const detected = await fileTypeFromBuffer(file.bytes)
  const modality = detected ? modalityFromMime(detected.mime) : undefined
  if (!detected || !modality) throw new Error(`Unsupported media file: ${file.filePath}`)
  return { ...file, mime: detected.mime, modality }
}

export async function openMediaAsset(input: { root: string; filePath: string; signal: AbortSignal; ask: AskPermission }) {
  const requested = path.isAbsolute(input.filePath) ? path.normalize(input.filePath) : path.resolve(input.root, input.filePath)
  const filePath = await realpath(requested)
  const inside = isInside(input.root, filePath)
  if (!inside) {
    await input.ask({ permission: "external_directory", patterns: [filePath], always: [], metadata: {} })
  }
  await input.ask({
    permission: "read",
    patterns: [inside ? path.relative(input.root, filePath) || path.basename(filePath) : filePath],
    always: ["*"],
    metadata: {},
  })

  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error(`Not a file: ${filePath}`)
    if (info.size === 0) throw new Error(`Media file is empty: ${filePath}`)
    const header = Buffer.alloc(Math.min(info.size, DETECTION_BYTES))
    if (input.signal.aborted) throw input.signal.reason ?? new Error("Media inspection aborted")
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    const detected = await fileTypeFromBuffer(header.subarray(0, bytesRead))
    const modality = detected ? modalityFromMime(detected.mime) : undefined
    if (!detected || !modality) throw new Error(`Unsupported media file: ${filePath}`)
    return { filePath, bytes: info.size, mime: detected.mime, modality, extension: detected.ext, inside, handle }
  } catch (error) {
    await handle.close()
    throw error
  }
}

export async function inspectMediaAsset(input: Parameters<typeof openMediaAsset>[0]) {
  const media = await openMediaAsset(input)
  try {
    const { handle: _handle, ...inspected } = media
    return inspected
  } finally {
    await media.handle.close()
  }
}

async function copyNewFile(input: { source: string; target: string; root: string; signal: AbortSignal }) {
  await verifyOutputParent(input.root, input.target)
  const source = await open(input.source, constants.O_RDONLY | constants.O_NOFOLLOW)
  const target = await open(input.target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    await target.chmod(0o660)
    let position = 0
    while (true) {
      if (input.signal.aborted) throw input.signal.reason ?? new Error("Media import aborted")
      const result = await source.read(buffer, 0, buffer.length, position)
      if (result.bytesRead === 0) break
      let offset = 0
      while (offset < result.bytesRead) {
        const written = await target.write(buffer, offset, result.bytesRead - offset)
        offset += written.bytesWritten
      }
      position += result.bytesRead
    }
  } catch (error) {
    await target.close()
    await rm(input.target, { force: true })
    throw error
  } finally {
    await source.close()
  }
  await target.close()
}

export async function importMediaAsset(input: {
  root: string
  filePath: string
  outputRoot: string
  outputDirectory: Record<MediaModality, string>
  signal: AbortSignal
  ask: AskPermission
}) {
  const inspected = await inspectMediaAsset(input)
  const originalExtension = path.extname(inspected.filePath)
  const stem = path.basename(inspected.filePath, originalExtension)
  if (path.dirname(inspected.filePath) === input.outputDirectory[inspected.modality]) return inspected
  const outputPath = path.join(input.outputDirectory[inspected.modality], `${stem}-${randomUUID().slice(0, 8)}.${inspected.extension}`)
  const target = await prepareNewOutput({ root: input.outputRoot, outputPath, ask: input.ask })
  await copyNewFile({ source: inspected.filePath, target: target.outputPath, root: input.outputRoot, signal: input.signal })
  try {
    const copiedType = await fileTypeFromFile(target.outputPath)
    const copiedModality = copiedType ? modalityFromMime(copiedType.mime) : undefined
    if (!copiedType || copiedModality !== inspected.modality) {
      throw new Error(`Imported content changed during copy: ${inspected.filePath}`)
    }
    const copiedInfo = await stat(target.outputPath)
    return {
      filePath: target.outputPath,
      bytes: copiedInfo.size,
      mime: copiedType.mime,
      modality: copiedModality,
      extension: copiedType.ext,
      inside: true,
    }
  } catch (error) {
    await rm(target.outputPath, { force: true })
    throw error
  }
}

export async function inspectCreatedMedia(filePath: string) {
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size === 0) throw new Error(`Output media is empty: ${filePath}`)
    const header = Buffer.alloc(Math.min(info.size, DETECTION_BYTES))
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    const detected = await fileTypeFromBuffer(header.subarray(0, bytesRead))
    const modality = detected ? modalityFromMime(detected.mime) : undefined
    if (!detected || !modality) throw new Error(`Output is not supported media: ${filePath}`)
    return { filePath, bytes: info.size, mime: detected.mime, modality, extension: detected.ext }
  } finally {
    await handle.close()
  }
}
