import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { link, open, rm } from "node:fs/promises"
import path from "node:path"
import { fileTypeFromFile } from "file-type"
import { type LibraryLayout, type LibraryModality as MediaModality, personalOutputPath } from "./library"
import { type AskPermission, prepareNewOutput, verifyOutputParent } from "./studio-path"

function allowedHost(hostname: string, allowedHosts: string[]) {
  const host = hostname.toLowerCase()
  return allowedHosts.some((entry) => host === entry || host.endsWith(`.${entry}`))
}

export async function downloadMedia(input: {
  url: string
  outputPath?: string
  library: LibraryLayout
  allowedHosts: string[]
  maxBytes: number
  signal: AbortSignal
  ask: AskPermission
  fetcher?: typeof fetch
}) {
  const url = new URL(input.url)
  if (url.protocol !== "https:" || !allowedHost(url.hostname, input.allowedHosts)) {
    throw new Error(`Media URL host is not allowed: ${url.hostname}`)
  }

  const response = await (input.fetcher ?? fetch)(url, { signal: input.signal, redirect: "error" })
  if (!response.ok || !response.body) throw new Error(`Media download returned ${response.status}: ${response.statusText}`)
  const declaredBytes = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredBytes) && declaredBytes > input.maxBytes) {
    throw new Error(`Media download is ${declaredBytes} bytes; maximum is ${input.maxBytes} bytes`)
  }

  const stagingPath = path.join(path.dirname(input.library.personal.image), `.download-${randomUUID()}.tmp`)
  await verifyOutputParent(input.library.root, stagingPath)
  const handle = await open(stagingPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
  let bytes = 0
  try {
    try {
      await handle.chmod(0o660)
      for await (const chunk of response.body) {
        if (input.signal.aborted) throw input.signal.reason ?? new Error("Media download aborted")
        bytes += chunk.byteLength
        if (bytes > input.maxBytes) throw new Error(`Media download exceeded ${input.maxBytes} bytes`)
        let offset = 0
        while (offset < chunk.byteLength) {
          const result = await handle.write(chunk, offset, chunk.byteLength - offset)
          offset += result.bytesWritten
        }
      }
      await handle.sync()
    } finally {
      await handle.close()
    }
    const detected = await fileTypeFromFile(stagingPath)
    const modality: MediaModality | undefined = detected?.mime.startsWith("image/")
      ? "image"
      : detected?.mime.startsWith("audio/")
        ? "audio"
        : detected?.mime.startsWith("video/")
          ? "video"
          : undefined
    if (!detected || !modality) throw new Error("Downloaded content is not supported media")

    const defaultName = `download-${Date.now()}-${randomUUID().slice(0, 8)}.${detected.ext}`
    const outputPath = personalOutputPath(input.library, modality, input.outputPath, defaultName)
    const target = await prepareNewOutput({ root: input.library.root, outputPath, ask: input.ask })
    await verifyOutputParent(input.library.root, target.outputPath)
    try {
      await link(stagingPath, target.outputPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Output file already exists: ${target.outputPath}`)
      throw error
    }
    return {
      filePath: target.outputPath,
      relativePath: target.relativePath,
      bytes,
      mime: detected.mime,
      modality,
      contentType: response.headers.get("content-type"),
    }
  } finally {
    await rm(stagingPath, { force: true })
  }
}
