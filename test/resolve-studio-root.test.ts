import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { resolveStudioRoot, studioDomainRootPath } from "../src/config"

const temps: string[] = []

afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe("resolveStudioRoot", () => {
  test("defaults every Studio under Studio Home", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "osc-root-home-"))
    temps.push(home)

    const cad = await resolveStudioRoot({ studioId: "cad", studioRoot: home })
    const pcb = await resolveStudioRoot({ studioId: "pcb", studioRoot: home })
    const fw = await resolveStudioRoot({ studioId: "fw", studioRoot: home })

    expect(cad).toBe(await realpath(path.join(home, "studio", "designs")))
    expect(pcb).toBe(await realpath(path.join(home, "studio", "circuits")))
    expect(fw).toBe(await realpath(path.join(home, "studio", "firmware")))
  })

  test("absolute roots overrides win over relative defaults", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "osc-root-home-"))
    const cadLib = await mkdtemp(path.join(tmpdir(), "osc-root-cad-"))
    const pcbLib = await mkdtemp(path.join(tmpdir(), "osc-root-pcb-"))
    temps.push(home, cadLib, pcbLib)

    const cad = await resolveStudioRoot({
      studioId: "cad",
      studioRoot: home,
      roots: { cad: cadLib, pcb: pcbLib },
    })
    const pcb = await resolveStudioRoot({
      studioId: "pcb",
      studioRoot: home,
      roots: { cad: cadLib, pcb: pcbLib },
    })

    expect(cad).toBe(await realpath(cadLib))
    expect(pcb).toBe(await realpath(pcbLib))
  })

  test("create:false does not mkdir and fails when missing", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "osc-root-home-"))
    temps.push(home)
    const intended = studioDomainRootPath({ studioId: "cad", studioRoot: home })
    expect(intended).toBe(path.join(home, "studio", "designs"))
    await expect(resolveStudioRoot({ studioId: "cad", studioRoot: home, create: false })).rejects.toThrow(/does not exist/)
    const { access } = await import("node:fs/promises")
    await expect(access(path.join(home, "studio", "designs"))).rejects.toThrow()
  })
})
