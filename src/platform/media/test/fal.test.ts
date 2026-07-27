import { afterEach, describe, expect, test } from "bun:test"
import { falEndpoint, falJobStatus, falPlatformGet, falRequestID, formatToolJSON, requireFalKey } from "../fal"

const originalKey = process.env.FAL_KEY

afterEach(() => {
  if (originalKey === undefined) delete process.env.FAL_KEY
  else process.env.FAL_KEY = originalKey
})

describe("fal integration", () => {
  test("validates endpoint IDs and request IDs", () => {
    expect(falEndpoint("fal-ai/veo3.1")).toBe("fal-ai/veo3.1")
    expect(falRequestID("request_12345678")).toBe("request_12345678")
    expect(() => falEndpoint("https://example.test/model")).toThrow("Invalid fal endpoint")
    expect(() => falEndpoint("fal-ai/../secret")).toThrow("Invalid fal endpoint")
    expect(() => falRequestID("short")).toThrow("Invalid fal request")
  })

  test("maps provider queue states without collapsing terminal failures", () => {
    expect(falJobStatus({ status: "COMPLETED" })).toBe("completed")
    expect(falJobStatus({ status: "FAILED" })).toBe("failed")
    expect(falJobStatus({ status: "CANCELLED" })).toBe("cancelled")
    expect(falJobStatus({ status: "CANCELED" })).toBe("cancelled")
    expect(falJobStatus({ status: "IN_PROGRESS" })).toBe("running")
  })

  test("requires FAL_KEY only for paid operations", () => {
    delete process.env.FAL_KEY
    expect(() => requireFalKey()).toThrow("FAL_KEY is not set")
    process.env.FAL_KEY = "test-key"
    expect(requireFalKey()).toBe("test-key")
  })

  test("queries the fal platform API with authentication", async () => {
    process.env.FAL_KEY = "test-key"
    let request: Request | undefined
    const fetcher = (async (input, init) => {
      request = new Request(input, init)
      return Response.json({ models: [] })
    }) as typeof fetch
    const result = await falPlatformGet("/models", { q: "video", limit: 3 }, fetcher)

    expect(result).toEqual({ models: [] })
    expect(request?.url).toBe("https://api.fal.ai/v1/models?q=video&limit=3")
    expect(request?.headers.get("authorization")).toBe("Key test-key")
  })

  test("caps large tool output", () => {
    expect(formatToolJSON({ value: "x".repeat(100) }, 20)).toContain("truncated by opencode-studio media")
  })
})
