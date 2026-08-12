export type ConvertPreset = "video-mp4" | "video-webm" | "audio-mp3" | "audio-wav" | "image-png" | "image-webp"

const OUTPUT_LIMIT = 2 * 1024 * 1024

export async function runMediaProcess(input: {
  binary: string
  args: string[]
  signal: AbortSignal
  inputFd?: number
  beforeSpawn?: () => Promise<void>
}) {
  await input.beforeSpawn?.()
  let process: Bun.Subprocess<"ignore", "pipe", "pipe">
  try {
    process = Bun.spawn([input.binary, ...input.args], {
      stdio: input.inputFd === undefined ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "pipe", input.inputFd],
      signal: input.signal,
      maxBuffer: OUTPUT_LIMIT,
    })
  } catch (error) {
    throw new Error(`Could not start ${input.binary}; install FFmpeg or configure its path`, { cause: error })
  }

  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  if (input.signal.aborted) throw input.signal.reason ?? new Error(`${input.binary} operation aborted`)
  if (exitCode !== 0) {
    const detail = stderr.trim().slice(-4000)
    throw new Error(`${input.binary} exited with code ${exitCode}${detail ? `: ${detail}` : ""}`)
  }
  return { stdout, stderr }
}

export async function probeMedia(input: {
  binary: string
  filePath: string
  signal: AbortSignal
  inputFd?: number
  beforeSpawn?: () => Promise<void>
}) {
  const result = await runMediaProcess({
    binary: input.binary,
    args: ["-v", "error", "-show_format", "-show_streams", "-of", "json", input.inputFd === undefined ? input.filePath : "/dev/fd/3"],
    signal: input.signal,
    inputFd: input.inputFd,
    beforeSpawn: input.beforeSpawn,
  })
  try {
    return JSON.parse(result.stdout) as Record<string, unknown>
  } catch (error) {
    throw new Error(`${input.binary} returned invalid JSON`, { cause: error })
  }
}

function scaleFilter(width?: number, height?: number) {
  if (width && height) return `scale=${width}:${height}`
  if (width) return `scale=${width}:-2`
  if (height) return `scale=-2:${height}`
}

export function convertArguments(input: {
  source: string
  output: string
  preset: ConvertPreset
  width?: number
  height?: number
  quality?: number
  videoBitrateKbps?: number
  audioBitrateKbps?: number
}) {
  const args = ["-nostdin", "-hide_banner", "-n", "-i", input.source]
  const scale = scaleFilter(input.width, input.height)
  if (scale) args.push("-vf", scale)

  switch (input.preset) {
    case "video-mp4":
      args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", String(input.quality ?? 23))
      if (input.videoBitrateKbps) args.push("-b:v", `${input.videoBitrateKbps}k`)
      args.push("-c:a", "aac", "-b:a", `${input.audioBitrateKbps ?? 192}k`, "-movflags", "+faststart")
      break
    case "video-webm":
      args.push(
        "-c:v",
        "libvpx-vp9",
        "-crf",
        String(input.quality ?? 32),
        "-b:v",
        input.videoBitrateKbps ? `${input.videoBitrateKbps}k` : "0",
      )
      args.push("-c:a", "libopus", "-b:a", `${input.audioBitrateKbps ?? 128}k`)
      break
    case "audio-mp3":
      args.push("-vn", "-c:a", "libmp3lame", "-b:a", `${input.audioBitrateKbps ?? 192}k`)
      break
    case "audio-wav":
      args.push("-vn", "-c:a", "pcm_s16le")
      break
    case "image-png":
      args.push("-frames:v", "1", "-c:v", "png")
      break
    case "image-webp":
      args.push("-frames:v", "1", "-c:v", "libwebp", "-quality", String(input.quality ?? 80))
      break
  }
  args.push(input.output)
  return args
}

export function trimArguments(input: {
  source: string
  output: string
  modality: "audio" | "video"
  startSeconds: number
  endSeconds: number
}) {
  const args = ["-nostdin", "-hide_banner", "-n", "-i", input.source, "-ss", String(input.startSeconds), "-to", String(input.endSeconds)]
  if (input.modality === "video") {
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-c:a", "aac", "-movflags", "+faststart")
  } else {
    args.push("-vn", "-c:a", "libmp3lame", "-b:a", "192k")
  }
  args.push(input.output)
  return args
}

export function extractAudioArguments(input: { source: string; output: string; format: "mp3" | "wav" }) {
  const args = ["-nostdin", "-hide_banner", "-n", "-i", input.source, "-vn"]
  if (input.format === "wav") args.push("-c:a", "pcm_s16le")
  else args.push("-c:a", "libmp3lame", "-b:a", "192k")
  args.push(input.output)
  return args
}

export function cropImageArguments(input: {
  source: string
  output: string
  x: number
  y: number
  width: number
  height: number
  format: "png" | "webp"
}) {
  const filter = `crop=${Math.floor(input.width)}:${Math.floor(input.height)}:${Math.floor(input.x)}:${Math.floor(input.y)}`
  const args = ["-nostdin", "-hide_banner", "-n", "-i", input.source, "-vf", filter, "-frames:v", "1"]
  if (input.format === "webp") args.push("-c:v", "libwebp", "-quality", "90")
  else args.push("-c:v", "png")
  args.push(input.output)
  return args
}

/** Concat demuxer list body; paths must be absolute and already validated. */
export function concatListBody(paths: string[]) {
  return `${paths.map((filePath) => `file '${filePath.replaceAll("'", "'\\''")}'`).join("\n")}\n`
}

export function concatVideoArguments(input: { listPath: string; output: string }) {
  return [
    "-nostdin",
    "-hide_banner",
    "-n",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    input.listPath,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    input.output,
  ]
}
