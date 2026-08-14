import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  acquireBenchLock,
  BENCH_STUDIOS,
  benchEnvironment,
  listBenchCases,
  loadBenchCase,
  loadEvents,
  parseBenchCase,
  prepareIsolate,
  releaseBenchLock,
  scoreBench,
} from "../scripts/bench"

const temps: string[] = []

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const root = path.resolve(import.meta.dir, "..")

describe("bench cases", () => {
  test("isolates OpenCode config while sharing only the explicit data home needed for rotating auth", async () => {
    const sharedDataHome = await mkdtemp(path.join(tmpdir(), "osc-bench-data-"))
    temps.push(sharedDataHome)
    await mkdir(path.join(sharedDataHome, "opencode"))
    await writeFile(path.join(sharedDataHome, "opencode", "auth.json"), '{"xai":{"type":"oauth"}}\n')
    const isolate = await prepareIsolate(root, { xdgDataHome: sharedDataHome })
    temps.push(isolate.isolate)
    const env = benchEnvironment(isolate, {
      HOME: "/real-home",
      XDG_CONFIG_HOME: "/real-config",
      OPENCODE_CONFIG_DIR: "/real-opencode",
      OPENCODE_CONFIG_CONTENT: '{"plugin":["global"]}',
      XAI_API_KEY: "preserved",
    })

    expect(env.HOME).toBe(isolate.userHome)
    expect(env.XDG_CONFIG_HOME).toBe(isolate.xdgConfigHome)
    expect(env.XDG_DATA_HOME).toBe(sharedDataHome)
    expect(env.OPENCODE_CONFIG_DIR).toBeUndefined()
    expect(env.OPENCODE_CONFIG_CONTENT).toBeUndefined()
    expect(env.XAI_API_KEY).toBe("preserved")
    expect(await readFile(path.join(sharedDataHome, "opencode", "auth.json"), "utf8")).toContain("oauth")
    expect(await readFile(path.join(isolate.studioHome, ".opencode", "skills", "studio-pcb", "SKILL.md"), "utf8")).toContain(
      "pcb_component_add",
    )
  })

  test("lists isolated design cases for cad, pcb, and fw", async () => {
    const listed = Object.fromEntries(
      await Promise.all(BENCH_STUDIOS.map(async (studio) => [studio, (await listBenchCases(studio)).map((item) => item.id)])),
    )
    expect(listed.cad).toContain("project-box-v0")
    expect(listed.pcb).toEqual(["esp32-sensor-v0", "led-blink-v0"])
    expect(listed.fw).toEqual(["uart-c6-v0", "uart-hello-v0"])
  })

  test("parses the CAD prompt and reference image from working-tree markdown", async () => {
    const source = path.join(root, "studios/cad/test/benchmarks/speaker-organic-v0.md")
    const bench = parseBenchCase("cad", source, await readFile(source, "utf8"), root)
    expect(bench.agent).toBe("cad")
    expect(bench.prompt).toContain("Curved stone-look shell")
    expect(bench.files[0]?.endsWith("speaker-gold-cones.png")).toBe(true)
  })

  test("loadBenchCase rejects unknown ids", async () => {
    await expect(loadBenchCase("fw", "missing")).rejects.toThrow(/Unknown fw benchmark/)
  })
})

describe("bench score", () => {
  test("fw passes only with matching expect and reason expect", async () => {
    const events = loadEvents(
      [
        JSON.stringify({ type: "tool_use", part: { type: "tool", tool: "fw_project_create", state: { output: "{}" } } }),
        JSON.stringify({ type: "tool_use", part: { type: "tool", tool: "fw_build", state: { output: JSON.stringify({ ok: true }) } } }),
        JSON.stringify({
          type: "tool_use",
          part: {
            type: "tool",
            tool: "fw_sim_run",
            state: { input: { expect: "BENCH_UART_OK" }, output: JSON.stringify({ ok: true, reason: "expect" }) },
          },
        }),
      ].join("\n"),
    )
    expect((await scoreBench({ studio: "fw", events, studioHome: root, expect: "BENCH_UART_OK" })).ok).toBe(true)
    expect(
      (
        await scoreBench({
          studio: "fw",
          events: loadEvents(
            JSON.stringify({
              type: "tool_use",
              part: { type: "tool", tool: "fw_sim_run", state: { output: JSON.stringify({ ok: true, reason: "exit" }) } },
            }),
          ),
          studioHome: root,
          expect: "BENCH_UART_OK",
        })
      ).ok,
    ).toBe(false)
  })

  test("pcb passes with create and a valid build", async () => {
    const events = loadEvents(
      [
        JSON.stringify({ type: "tool_use", part: { type: "tool", tool: "pcb_project_create", state: { output: "{}" } } }),
        JSON.stringify({
          type: "tool_use",
          part: {
            type: "tool",
            tool: "pcb_circuit_build",
            state: { output: JSON.stringify({ designValid: true }) },
          },
        }),
      ].join("\n"),
    )
    expect((await scoreBench({ studio: "pcb", events, studioHome: root })).ok).toBe(true)
  })

  test("cad ok requires QC complete and STEP artifacts", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "osc-bench-cad-"))
    temps.push(home)
    const designDir = path.join(home, "studio", "designs", "box")
    await mkdir(path.join(designDir, "step"), { recursive: true })
    await writeFile(path.join(designDir, "design.json"), JSON.stringify({ parts: [{ id: "lid" }] }))
    await writeFile(path.join(designDir, "step", "lid.step"), "ISO-10303\n")
    const events = loadEvents(
      [
        JSON.stringify({
          type: "tool_use",
          part: { type: "tool", tool: "cad_design_create", state: { input: { id: "box" }, output: "{}" } },
        }),
        JSON.stringify({ type: "tool_use", part: { type: "tool", tool: "cad_design_build", state: { output: "{}" } } }),
        JSON.stringify({
          type: "tool_use",
          part: { type: "tool", tool: "cad_design_qc_report", state: { output: JSON.stringify({ complete: true }) } },
        }),
      ].join("\n"),
    )
    expect((await scoreBench({ studio: "cad", events, studioHome: home })).ok).toBe(true)
    expect(
      (
        await scoreBench({
          studio: "cad",
          events: loadEvents(
            JSON.stringify({ type: "tool_use", part: { type: "tool", tool: "cad_design_build", state: { output: "{}" } } }),
          ),
          studioHome: home,
        })
      ).ok,
    ).toBe(false)
  })
})

describe("bench lock", () => {
  test("refuses a second acquire while the first pid is alive", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "osc-bench-lock-"))
    temps.push(home)
    const lock = await acquireBenchLock(home, "cad project-box-v0")
    await expect(acquireBenchLock(home, "pcb led-blink-v0")).rejects.toThrow(/already running/)
    await releaseBenchLock(lock)
    const next = await acquireBenchLock(home, "pcb led-blink-v0")
    expect(next).toContain("osc-bench-")
    await releaseBenchLock(next)
  })
})
