import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  type ExactLcscImportCommand,
  type ExactLcscImportCommandResult,
  type ExactLcscSmokeInput,
  importExactLcscComponent,
} from "../component-import"

const temps: string[] = []

afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function project(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pcb-lcsc-project-"))
  temps.push(dir)
  return dir
}

function component(cNumber = "C2049745", mpn = "DFE201210U_2R2M_P2"): string {
  return `import type { InductorProps } from "@tscircuit/props"

export const DFE201210U_2R2M_P2 = (props: Omit<InductorProps, "inductance">) => (
  <inductor
    inductance="2.2uH"
    supplierPartNumbers={{ jlcpcb: ["${cNumber}"] }}
    manufacturerPartNumber="${mpn}"
    footprint={<footprint><smtpad portHints={["1"]} shape="rect" width="1mm" height="1mm" /></footprint>}
    {...props}
  />
)
`
}

function importer(
  source: string,
  smoke: (input: ExactLcscSmokeInput) => Promise<{ success: boolean; stderr?: string }> = async () => ({ success: true }),
) {
  const commands: ExactLcscImportCommand[] = []
  const run = async (command: ExactLcscImportCommand): Promise<ExactLcscImportCommandResult> => {
    commands.push(command)
    await mkdir(path.join(command.cwd, "imports"))
    await writeFile(path.join(command.cwd, "imports", "DFE201210U_2R2M_P2.tsx"), source)
    return { success: true, stdout: "Imported", stderr: "", exitCode: 0 }
  }
  return { commands, dependencies: { run, smoke } }
}

describe("exact LCSC component import", () => {
  test("imports one validated component with pinned exact-footprint argv", async () => {
    const dir = await project()
    const source = component()
    const mock = importer(source, async () => ({ success: true, courtyard: { widthMm: 2.4, heightMm: 1.2 } }))
    const expectedSha256 = createHash("sha256").update(source).digest("hex")

    const result = await importExactLcscComponent({ projectDir: dir, lcscPartNumber: "C2049745", expectedSha256 }, mock.dependencies)

    expect(result).toMatchObject({
      success: true,
      rolledBack: false,
      relativePath: "imports/DFE201210U_2R2M_P2.tsx",
      exportName: "DFE201210U_2R2M_P2",
      manufacturerPartNumber: "DFE201210U_2R2M_P2",
      sha256: expectedSha256,
      courtyard: { widthMm: 2.4, heightMm: 1.2 },
    })
    expect(mock.commands).toHaveLength(1)
    expect(mock.commands[0]!.argv.slice(-4)).toEqual(["import", "--jlcpcb", "--use-exact-footprint", "C2049745"])
    expect(mock.commands[0]!.timeoutMs).toBeGreaterThan(0)
    expect(await readFile(path.join(dir, "imports", "DFE201210U_2R2M_P2.tsx"), "utf8")).toBe(source)
    expect(access(mock.commands[0]!.cwd)).rejects.toThrow()
  })

  test("rejects non-canonical numbers before invoking the CLI", async () => {
    const dir = await project()
    const mock = importer(component())
    const result = await importExactLcscComponent({ projectDir: dir, lcscPartNumber: "c2049745" }, mock.dependencies)
    expect(result).toMatchObject({ success: false, reason: "invalid_input", rolledBack: false })
    expect(mock.commands).toHaveLength(0)
  })

  test("rejects a generated component with a different supplier identity", async () => {
    const dir = await project()
    const mock = importer(component("C20497450"))
    const result = await importExactLcscComponent({ projectDir: dir, lcscPartNumber: "C2049745" }, mock.dependencies)
    expect(result).toMatchObject({ success: false, reason: "supplier_identity_mismatch", rolledBack: false })
    expect(access(path.join(dir, "imports"))).rejects.toThrow()
  })

  test("does not overwrite an existing import", async () => {
    const dir = await project()
    const imports = path.join(dir, "imports")
    await mkdir(imports)
    const target = path.join(imports, "DFE201210U_2R2M_P2.tsx")
    await writeFile(target, "existing")
    const mock = importer(component())
    const result = await importExactLcscComponent({ projectDir: dir, lcscPartNumber: "C2049745" }, mock.dependencies)
    expect(result).toMatchObject({ success: false, reason: "destination_exists", rolledBack: false })
    expect(await readFile(target, "utf8")).toBe("existing")
  })

  test("rolls back only the newly published file when smoke fails", async () => {
    const dir = await project()
    const sibling = path.join(dir, "imports", "keep.tsx")
    await mkdir(path.dirname(sibling))
    await writeFile(sibling, "keep")
    const mock = importer(component(), async () => ({ success: false, stderr: "build failed" }))
    const result = await importExactLcscComponent({ projectDir: dir, lcscPartNumber: "C2049745" }, mock.dependencies)
    expect(result).toMatchObject({ success: false, reason: "smoke_test_failed", rolledBack: true, stderr: "build failed" })
    expect(await readFile(sibling, "utf8")).toBe("keep")
    expect(readFile(path.join(dir, "imports", "DFE201210U_2R2M_P2.tsx"))).rejects.toThrow()
  })

  test("rejects hash mismatches without publishing", async () => {
    const dir = await project()
    const mock = importer(component())
    const result = await importExactLcscComponent(
      {
        projectDir: dir,
        lcscPartNumber: "C2049745",
        expectedSha256: "0".repeat(64),
      },
      mock.dependencies,
    )
    expect(result).toMatchObject({ success: false, reason: "sha256_mismatch", rolledBack: false })
  })
})
