import { describe, expect, test } from "bun:test"
import {
  defaultLoopbackParentCandidates,
  defaultParentOpenCodeUrl,
  isHardParentUrl,
  resolveExplicitParentOpenCode,
  resolveOpenCodePort,
  resolveReportedServeUrl,
  resolveServeBind,
  resolveSuperviseSpawnBind,
} from "../src/core/opencode-bind"

describe("opencode-bind", () => {
  test("port defaults and invalid digits modes", () => {
    expect(resolveOpenCodePort({})).toEqual({ port: "4096", portNumber: 4096 })
    expect(resolveOpenCodePort({ OPENCODE_PORT: "5000" }).portNumber).toBe(5000)
    expect(resolveOpenCodePort({ OPENCODE_SERVER_PORT: "5001" }).portNumber).toBe(5001)
    expect(resolveOpenCodePort({ OPENCODE_PORT: "not-a-port" }, { invalidDigits: "default" })).toEqual({
      port: "4096",
      portNumber: 4096,
    })
    expect(resolveOpenCodePort({ OPENCODE_PORT: "not-a-port" }, { invalidDigits: "keep" }).port).toBe("not-a-port")
  })

  test("serve bind uses edge password for public host", () => {
    expect(resolveServeBind({})).toEqual({ hostname: "127.0.0.1", port: "4096" })
    expect(resolveServeBind({ OPENCODE_SERVER_PASSWORD: "x" }).hostname).toBe("0.0.0.0")
    expect(resolveServeBind({ OPENCODE_STUDIO_PASSWORD: "s" }).hostname).toBe("0.0.0.0")
    expect(resolveServeBind({ OPENCODE_STUDIO_BIND: "web" }).hostname).toBe("127.0.0.1")
    expect(resolveServeBind({ OPENCODE_HOSTNAME: "10.0.0.2" }).hostname).toBe("10.0.0.2")
  })

  test("supervise spawn is always loopback", () => {
    expect(resolveSuperviseSpawnBind({ OPENCODE_SERVER_PASSWORD: "x", OPENCODE_HOSTNAME: "0.0.0.0" })).toEqual({
      hostname: "127.0.0.1",
      port: 4096,
      baseUrl: "http://127.0.0.1:4096",
    })
  })

  test("parent URL mode chains", () => {
    expect(resolveExplicitParentOpenCode({ OPENCODE_URL: "http://a" }, "supervisor-no-supervise")?.source).toBe("OPENCODE_URL")
    expect(resolveExplicitParentOpenCode({ OPENCODE_PARENT_URL: "http://p" }, "supervisor-no-supervise")).toBeUndefined()
    expect(resolveExplicitParentOpenCode({ OPENCODE_PARENT_URL: "http://p" }, "supervisor-attach")?.source).toBe("OPENCODE_PARENT_URL")
    expect(resolveExplicitParentOpenCode({ OPENCODE_URL: "http://a", OPENCODE_PARENT_URL: "http://p" }, "supervisor-attach")?.source).toBe(
      "OPENCODE_URL",
    )
    expect(
      resolveExplicitParentOpenCode(
        { OPENCODE_STUDIO_PARENT: "http://s", OPENCODE_SERVER_URL: "http://srv", OPENCODE_URL: "http://u" },
        "bootstrap",
      )?.source,
    ).toBe("OPENCODE_STUDIO_PARENT")
    expect(resolveExplicitParentOpenCode({ OPENCODE_PARENT_URL: "http://p" }, "bootstrap")).toBeUndefined()
    expect(isHardParentUrl("OPENCODE_URL")).toBe(true)
    expect(isHardParentUrl("OPENCODE_PARENT_URL")).toBe(false)
  })

  test("bootstrap default parent URL", () => {
    expect(defaultParentOpenCodeUrl({})).toBe("http://127.0.0.1:4096")
    expect(defaultParentOpenCodeUrl({ OPENCODE_SERVER_PASSWORD: "x" })).toBe("http://0.0.0.0:4096")
    expect(defaultParentOpenCodeUrl({ OPENCODE_STUDIO_BIND: "web" })).toBe("http://0.0.0.0:4096")
    expect(defaultParentOpenCodeUrl({ OPENCODE_STUDIO_PARENT: "http://custom:9/" })).toBe("http://custom:9")
    expect(defaultLoopbackParentCandidates({ OPENCODE_PORT: "5000" })).toEqual(["http://127.0.0.1:5000"])
  })

  test("reported serve URL", () => {
    expect(resolveReportedServeUrl({}, { hostname: "0.0.0.0", port: "4096" })).toBe("http://127.0.0.1:4096")
    expect(resolveReportedServeUrl({ OPENCODE_URL: "http://explicit" }, { hostname: "0.0.0.0", port: "4096" })).toBe("http://explicit")
  })
})
