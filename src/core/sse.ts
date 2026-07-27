export function createSseResponse(input: {
  signal: AbortSignal
  subscribe: (emit: (data: unknown) => void) => () => void
  heartbeatMs?: number
}): Response {
  const encoder = new TextEncoder()
  const heartbeatMs = input.heartbeatMs ?? 5000
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "connected", at: Date.now() })}\n\n`))
      let heartbeat: ReturnType<typeof setInterval> | undefined
      let unsubscribe: (() => void) | undefined
      const cleanup = () => {
        if (heartbeat) clearInterval(heartbeat)
        heartbeat = undefined
        unsubscribe?.()
        unsubscribe = undefined
      }
      unsubscribe = input.subscribe((event) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          cleanup()
        }
      })
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"))
        } catch {
          cleanup()
        }
      }, heartbeatMs)
      heartbeat.unref()
      input.signal.addEventListener("abort", () => {
        cleanup()
        try {
          controller.close()
        } catch {
          // already closed
        }
      })
    },
  })
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
