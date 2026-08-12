import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { buildFwProject, type RunCommand, simulateFwProject } from "../runner"
import { scaffoldFwProject } from "../scaffold"
import { resolveFwProject } from "../workspace"

const temps: string[] = []

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("fw runner", () => {
  test("records UART expect as a pass", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-fw-run-"))
    temps.push(root)
    await scaffoldFwProject(root, "blink", "esp32c6")
    const project = await resolveFwProject(root, "blink")
    const runCommand: RunCommand = async (input) => {
      if (input.command.some((part) => String(part).includes("merge-bin"))) {
        return { code: 0, stdout: "merged\n", stderr: "", reason: "exit" }
      }
      return { code: 0, stdout: "boot\nHello from Firmware Studio\n", stderr: "", reason: "expect", matched: input.expect }
    }

    const { record, log } = await simulateFwProject(project, {
      expect: "Hello from Firmware Studio",
      runCommand,
      engines: {
        idf: () => ({ id: "idf", path: path.join(root, "idf.py"), source: "path" }),
        sim: () => ({ id: "esp-emu", path: path.join(root, "esp-emu"), source: "path" }),
      },
    })
    expect(record.ok).toBe(true)
    expect(record.reason).toBe("expect")
    expect(record.engine).toBe("esp-emu")
    expect(log).toContain("Hello from Firmware Studio")
    expect(await readFile(record.logPath, "utf8")).toContain("Hello")
  })

  test("does not build after set-target fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-fw-run-"))
    temps.push(root)
    await scaffoldFwProject(root, "blink", "esp32")
    const project = await resolveFwProject(root, "blink")
    const commands: string[] = []
    const runCommand: RunCommand = async (input) => {
      commands.push(input.command.join(" "))
      return { code: 1, stdout: "", stderr: "set-target failed", reason: "exit" }
    }
    const { record } = await buildFwProject(project, {
      runCommand,
      engines: { idf: () => ({ id: "idf", path: path.join(root, "idf.py"), source: "path" }) },
    })
    expect(record.ok).toBe(false)
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain("set-target")
  })

  test("timeoutMs 0 uses the default window", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "osc-fw-run-"))
    temps.push(root)
    await scaffoldFwProject(root, "blink", "esp32c6")
    const project = await resolveFwProject(root, "blink")
    let seen: number | undefined
    const runCommand: RunCommand = async (input) => {
      seen = input.timeoutMs
      if (input.command.some((part) => String(part).includes("merge-bin"))) {
        return { code: 0, stdout: "merged\n", stderr: "", reason: "exit" }
      }
      return { code: 0, stdout: "Hello from Firmware Studio\n", stderr: "", reason: "expect", matched: input.expect }
    }
    await simulateFwProject(project, {
      expect: "Hello from Firmware Studio",
      timeoutMs: 0,
      runCommand,
      engines: {
        idf: () => ({ id: "idf", path: path.join(root, "idf.py"), source: "path" }),
        sim: () => ({ id: "esp-emu", path: path.join(root, "esp-emu"), source: "path" }),
      },
    })
    expect(seen).toBe(20_000)
  })
})
