import { describe, expect, test } from "bun:test"
import { main } from "../src/cli"

async function capture(fn: () => Promise<number>) {
  const logs: string[] = []
  const errs: string[] = []
  const log = console.log
  const error = console.error
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "))
  }
  console.error = (...args: unknown[]) => {
    errs.push(args.map(String).join(" "))
  }
  try {
    const code = await fn()
    return { code, logs: logs.join("\n"), errs: errs.join("\n") }
  } finally {
    console.log = log
    console.error = error
  }
}

describe("cli surface", () => {
  test("root help lists core commands", async () => {
    const { code, logs } = await capture(() => main([]))
    expect(code).toBe(0)
    expect(logs).toContain("serve")
    expect(logs).toContain("status")
    expect(logs).toContain("repair")
    expect(logs).toContain("upgrade")
    expect(logs).toContain("remove")
    expect(logs).not.toContain("configure")
    expect(logs).not.toContain("doctor")
    expect(logs).not.toContain("completion")
  })

  test("subcommand --help works", async () => {
    const { code, logs } = await capture(() => main(["upgrade", "--help"]))
    expect(code).toBe(0)
    expect(logs).toContain("opencode-studio upgrade")
    expect(logs).toContain("--check")
  })

  test("repair help describes reinstall", async () => {
    const { code, logs } = await capture(() => main(["repair", "--help"]))
    expect(code).toBe(0)
    expect(logs).toContain("Reinstall")
  })

  test("configure aliases to repair", async () => {
    const { errs } = await capture(() => main(["configure", "--help"]))
    expect(errs).toContain("repair")
  })

  test("--version prints a semver-like string", async () => {
    const { code, logs } = await capture(() => main(["--version"]))
    expect(code).toBe(0)
    expect(logs.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  test("status includes package and checks", async () => {
    const { logs } = await capture(() => main(["status"]))
    expect(logs).toContain("Package:")
    expect(logs).toContain("always on")
    expect(logs).toContain("Checks:")
  })
})
