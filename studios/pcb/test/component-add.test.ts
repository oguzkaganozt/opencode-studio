import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  addComponentCandidate,
  classifyBuildDiagnostics,
  componentSearchFallbackQuery,
  normalizeComponentSearchQuery,
  parseComponentSearchOutput,
  partitionSearchEntries,
  type TsciResult,
} from "../tsci"

const temps: string[] = []

afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
})

function registryResult(name: string, version: string, exportName: string) {
  return parseComponentSearchOutput(
    JSON.stringify({
      query: exportName,
      results: [
        {
          source: "tscircuit",
          name,
          latest_version: version,
          ai_usage_instructions: `import { ${exportName} } from "@tsci/${name.replace("/", ".")}"\n<${exportName} name="U1" />`,
          public_dist_enabled: true,
          latest_package_release_id: "release-1",
        },
      ],
    }),
  ).results[0]!
}

async function project() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pcb-component-add-"))
  temps.push(dir)
  await mkdir(path.join(dir, "src"))
  await writeFile(path.join(dir, "package.json"), '{"name":"board","dependencies":{"tscircuit":"0.0.2306"}}\n')
  await writeFile(path.join(dir, "package-lock.json"), '{"lockfileVersion":3}\n')
  return dir
}

function installMock(version: string): (command: string[], cwd: string) => Promise<TsciResult> {
  return async (command, cwd) => {
    const spec = command.at(-1)
    const match = spec?.match(/^(@tsci\/[A-Za-z0-9._-]+)@(\d+\.\d+\.\d+)$/)
    if (match) {
      const packageSpec = match[1]!
      const manifest = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8"))
      manifest.dependencies[packageSpec] = `^${version}`
      await writeFile(path.join(cwd, "package.json"), `${JSON.stringify(manifest)}\n`)
      await writeFile(path.join(cwd, "package-lock.json"), '{"changed":true}\n')
      const packageDir = path.join(cwd, "node_modules", ...packageSpec.split("/"))
      await mkdir(packageDir, { recursive: true })
      await writeFile(path.join(packageDir, "package.json"), `${JSON.stringify({ name: packageSpec, version })}\n`)
    }
    return { success: true, stdout: "installed", stderr: "", exitCode: 0 }
  }
}

describe("component candidate flow", () => {
  test("broadens exact package variants for registry fallback", () => {
    expect(componentSearchFallbackQuery("ESP32-S3-WROOM-1-N8R8")).toBe("ESP32-S3-WROOM-1")
    expect(componentSearchFallbackQuery("SHT40 temperature sensor")).toBe("SHT40")
  })

  test("normalizes equivalent connector searches", () => {
    expect(normalizeComponentSearchQuery("USB-C connector")).toBe(normalizeComponentSearchQuery("SMD USB Type-C receptacle"))
  })

  test("does not offer registry packages without public distribution as install candidates", () => {
    const entry = parseComponentSearchOutput(
      JSON.stringify({
        query: "Sensor",
        results: [
          {
            source: "tscircuit",
            name: "vendor/Sensor",
            latest_version: "1.0.0",
            ai_usage_instructions: 'import { Sensor } from "@tsci/vendor.Sensor"',
            public_dist_enabled: false,
          },
        ],
      }),
    ).results[0]!
    expect(entry).toMatchObject({ source: "tscircuit", hasPublicDist: false, candidateId: null })
    expect(partitionSearchEntries([entry]).catalogOnly).toEqual([entry])
  })

  test("moves a candidate to usable only after a successful project smoke test", async () => {
    const entry = registryResult("vendor/GoodPart", "1.0.1", "GoodPart")
    const dir = await project()
    expect(partitionSearchEntries([entry], dir).candidates).toEqual([entry])
    const commands: string[][] = []
    const install = installMock("1.0.1")
    const result = await addComponentCandidate(dir, entry.source === "tscircuit" ? entry.candidateId! : "", undefined, {
      install: async (command, cwd) => {
        commands.push(command)
        return install(command, cwd)
      },
      smoke: async () => ({
        success: true,
        stdout: "rendered",
        stderr: "",
        exitCode: 0,
      }),
    })
    expect(result).toMatchObject({
      success: true,
      verified: true,
      rolledBack: false,
    })
    expect(partitionSearchEntries([entry], dir).usable).toEqual([entry])
    expect(commands[0]?.at(-1)).toBe("@tsci/vendor.GoodPart@1.0.1")
    expect(JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")).dependencies).toMatchObject({
      "@tsci/vendor.GoodPart": "1.0.1",
    })
  })

  test("restores package files when the smoke test fails", async () => {
    const entry = registryResult("vendor/BadPart", "1.0.2", "BadPart")
    const dir = await project()
    const beforeManifest = await readFile(path.join(dir, "package.json"), "utf8")
    const beforeLock = await readFile(path.join(dir, "package-lock.json"), "utf8")
    const result = await addComponentCandidate(dir, entry.source === "tscircuit" ? entry.candidateId! : "", undefined, {
      install: installMock("1.0.2"),
      smoke: async () => ({ success: false, stdout: "", stderr: "React is not defined", exitCode: 1 }),
    })
    expect(result).toMatchObject({ success: false, verified: false, rolledBack: true, reason: "smoke_test_failed" })
    expect(await readFile(path.join(dir, "package.json"), "utf8")).toBe(beforeManifest)
    expect(await readFile(path.join(dir, "package-lock.json"), "utf8")).toBe(beforeLock)
    expect(partitionSearchEntries([entry], dir).rejected).toEqual([entry])
  })
})

describe("build diagnostic classification", () => {
  test("separates package, footprint, and circuit failures", () => {
    expect(classifyBuildDiagnostics({ stderr: "Cannot find package '@tsci/bad'", inspection: null }).rootCause).toBe("package")
    expect(
      classifyBuildDiagnostics({ stderr: "", inspection: null }, [
        {
          type: "supplier_footprint_mismatch",
          count: 1,
          messages: ["footprint copper IoU mismatch"],
          issues: [{ message: "footprint copper IoU mismatch" }],
        },
      ]).rootCause,
    ).toBe("footprint")
    expect(
      classifyBuildDiagnostics({ stderr: "", inspection: null }, [
        { type: "unverified_part", count: 1, messages: ["U1 is unverified"], issues: [{ message: "U1 is unverified" }] },
      ]).rootCause,
    ).toBe("component_identity")
    expect(
      classifyBuildDiagnostics({ stderr: "", inspection: null }, [
        { type: "unconnected_pin", count: 1, messages: ["U1.IO8"], issues: [{ message: "U1.IO8", refdes: "U1", pin: "IO8" }] },
      ]).rootCause,
    ).toBe("connectivity")
    expect(classifyBuildDiagnostics({ stderr: "Trace selector is invalid", inspection: null }).rootCause).toBe("circuit")
  })
})
