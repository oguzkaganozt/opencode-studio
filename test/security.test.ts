import { describe, expect, test } from "bun:test"
import { allowedHost, createCsrfToken, csrfTokensEqual, isLoopbackHost, safeExternalHref, sameOrigin } from "../src/core/security"

describe("security", () => {
  describe("sameOrigin", () => {
    const host = "127.0.0.1"
    const port = 4173
    test("accepts exact bind origin", () => {
      expect(sameOrigin("http://127.0.0.1:4173", host, port)).toBe(true)
    })
    test("accepts localhost alias on bind port", () => {
      expect(sameOrigin("http://localhost:4173", host, port)).toBe(true)
    })
    test("accepts vite dev port on loopback", () => {
      expect(sameOrigin("http://127.0.0.1:5173", host, port)).toBe(true)
      expect(sameOrigin("http://localhost:5173", host, port)).toBe(true)
    })
    test("rejects bare loopback without port (default 80)", () => {
      expect(sameOrigin("http://127.0.0.1", host, port)).toBe(false)
      expect(sameOrigin("http://127.0.0.1:80", host, port)).toBe(false)
    })
    test("rejects foreign origin", () => {
      expect(sameOrigin("http://evil.com:4173", host, port)).toBe(false)
      expect(sameOrigin("http://evil.com", host, port)).toBe(false)
    })
    test("rejects missing origin", () => {
      expect(sameOrigin(undefined, host, port)).toBe(false)
    })
    test("rejects non-http origins", () => {
      expect(sameOrigin("javascript:alert(1)", host, port)).toBe(false)
      expect(sameOrigin("data:text/html,foo", host, port)).toBe(false)
    })
    test("accepts extra allowed origins from env", () => {
      expect(sameOrigin("http://my-dev.test:3000", host, port, { OPENCODE_STUDIO_ALLOWED_ORIGINS: "http://my-dev.test:3000" })).toBe(true)
    })
  })

  describe("csrfTokensEqual", () => {
    test("equal tokens", () => {
      const a = createCsrfToken()
      expect(csrfTokensEqual(a, a)).toBe(true)
    })
    test("different tokens", () => {
      expect(csrfTokensEqual(createCsrfToken(), createCsrfToken())).toBe(false)
    })
    test("different lengths", () => {
      expect(csrfTokensEqual("short", "muchlongertokenvalue")).toBe(false)
    })
    test("empty", () => {
      expect(csrfTokensEqual("", "")).toBe(true)
    })
  })

  describe("safeExternalHref", () => {
    test("accepts http(s)", () => {
      expect(safeExternalHref("https://example.com/path")).toBe("https://example.com/path")
      expect(safeExternalHref("http://example.com")).toBe("http://example.com/")
    })
    test("rejects javascript", () => {
      expect(safeExternalHref("javascript:alert(1)")).toBeNull()
    })
    test("rejects data", () => {
      expect(safeExternalHref("data:text/html,<script>")).toBeNull()
    })
    test("rejects empty/null", () => {
      expect(safeExternalHref("")).toBeNull()
      expect(safeExternalHref(null)).toBeNull()
      expect(safeExternalHref(undefined)).toBeNull()
    })
  })

  describe("allowedHost", () => {
    test("accepts bind host:port", () => {
      expect(allowedHost("127.0.0.1:4173", "127.0.0.1", 4173)).toBe(true)
    })
    test("rejects wrong port", () => {
      expect(allowedHost("127.0.0.1:5173", "127.0.0.1", 4173)).toBe(false)
    })
    test("rejects foreign host", () => {
      expect(allowedHost("evil.com", "127.0.0.1", 4173)).toBe(false)
    })
    test("rejects missing host", () => {
      expect(allowedHost(undefined, "127.0.0.1", 4173)).toBe(false)
    })
  })

  test("isLoopbackHost", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true)
    expect(isLoopbackHost("localhost")).toBe(true)
    expect(isLoopbackHost("::1")).toBe(true)
    expect(isLoopbackHost("[::1]")).toBe(true)
    expect(isLoopbackHost("127.1.2.3")).toBe(true)
    expect(isLoopbackHost("10.0.0.1")).toBe(false)
    expect(isLoopbackHost("evil.com")).toBe(false)
  })
})
