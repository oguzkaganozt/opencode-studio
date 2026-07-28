import { describe, expect, test } from "bun:test"
import {
  allowedHost,
  assertNonLoopbackPassword,
  assertWebPassword,
  basicAuthMatches,
  createCsrfToken,
  csrfTokensEqual,
  DEFAULT_BASIC_USERNAME,
  hostnameForBindMode,
  isLoopbackHost,
  resolveBasicUsername,
  resolveBindMode,
  resolveEdgePassword,
  safeExternalHref,
  sameOrigin,
} from "../src/core/security"

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

  test("basicAuthMatches validates exact credentials", () => {
    const valid = `Basic ${Buffer.from("opencode-studio:secret").toString("base64")}`
    expect(basicAuthMatches(valid, "opencode-studio", "secret")).toBe(true)
    expect(basicAuthMatches(valid, "opencode-studio", "wrong")).toBe(false)
    expect(basicAuthMatches(undefined, "opencode-studio", "secret")).toBe(false)
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
    test("accepts any host when binding non-loopback", () => {
      expect(allowedHost("evil.com:9999", "0.0.0.0", 4173)).toBe(true)
      expect(allowedHost(undefined, "0.0.0.0", 4173)).toBe(true)
      expect(allowedHost("", "0.0.0.0", 4173)).toBe(true)
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

  describe("bind mode", () => {
    test("defaults to local", () => {
      expect(resolveBindMode({})).toBe("local")
      expect(resolveBindMode({ local: false, web: false })).toBe("local")
      expect(hostnameForBindMode("local")).toBe("127.0.0.1")
      expect(hostnameForBindMode("web")).toBe("0.0.0.0")
    })
    test("accepts exclusive flags", () => {
      expect(resolveBindMode({ local: true })).toBe("local")
      expect(resolveBindMode({ web: true })).toBe("web")
    })
    test("rejects both flags", () => {
      expect(() => resolveBindMode({ local: true, web: true })).toThrow(/either --local or --web/)
    })
    test("web requires password", () => {
      expect(() => assertWebPassword("web", {})).toThrow(/PASSWORD/)
      expect(() => assertWebPassword("web", { OPENCODE_STUDIO_PASSWORD: "   " })).toThrow(/PASSWORD/)
      expect(() => assertWebPassword("web", { OPENCODE_STUDIO_PASSWORD: "secret" })).not.toThrow()
      expect(() => assertWebPassword("web", { OPENCODE_SERVER_PASSWORD: "secret" })).not.toThrow()
      expect(() => assertWebPassword("local", {})).not.toThrow()
    })

    test("non-loopback bind requires edge password", () => {
      expect(() => assertNonLoopbackPassword("0.0.0.0", {})).toThrow(/PASSWORD/)
      expect(() => assertNonLoopbackPassword("0.0.0.0", { OPENCODE_SERVER_PASSWORD: "x" })).not.toThrow()
      expect(() => assertNonLoopbackPassword("127.0.0.1", {})).not.toThrow()
    })

    test("resolveEdgePassword prefers studio then server and trims", () => {
      expect(resolveEdgePassword({})).toBeUndefined()
      expect(resolveEdgePassword({ OPENCODE_SERVER_PASSWORD: "  a  " })).toBe("a")
      expect(resolveEdgePassword({ OPENCODE_STUDIO_PASSWORD: "s", OPENCODE_SERVER_PASSWORD: "x" })).toBe("s")
    })

    test("resolveBasicUsername defaults and overrides", () => {
      expect(resolveBasicUsername({})).toBe(DEFAULT_BASIC_USERNAME)
      expect(resolveBasicUsername({ OPENCODE_STUDIO_USERNAME: "   " })).toBe(DEFAULT_BASIC_USERNAME)
      expect(resolveBasicUsername({ OPENCODE_STUDIO_USERNAME: "admin" })).toBe("admin")
      expect(resolveBasicUsername({ OPENCODE_SERVER_PASSWORD: "x" })).toBe("opencode")
      expect(resolveBasicUsername({ OPENCODE_SERVER_PASSWORD: "x", OPENCODE_SERVER_USERNAME: "u" })).toBe("u")
    })
  })
})
