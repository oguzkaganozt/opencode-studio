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
  test("root help lists commands", async () => {
    const { code, logs } = await capture(() => main([]))
    expect(code).toBe(0)
    expect(logs).toContain("configure")
    expect(logs).toContain("upgrade")
    expect(logs).toContain("version")
  })

  test("subcommand --help works", async () => {
    const { code, logs } = await capture(() => main(["upgrade", "--help"]))
    expect(code).toBe(0)
    expect(logs).toContain("opencode-studio upgrade")
    expect(logs).toContain("--check")
  })

  test("configure without studios is rejected", async () => {
    const { code, errs } = await capture(() => main(["configure"]))
    expect(code).toBe(2)
    expect(errs).toContain("remove")
  })

  test("--version prints a semver-like string", async () => {
    const { code, logs } = await capture(() => main(["--version"]))
    expect(code).toBe(0)
    expect(logs.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  test("status includes package line", async () => {
    const { code, logs } = await capture(() => main(["status"]))
    expect(code).toBe(0)
    expect(logs).toContain("Package:")
    expect(logs).toContain("Enabled:")
  })
})
