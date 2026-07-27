import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { DesignEntry } from "../library"
import type { ArtifactManifest } from "../manifest"
import { buildDesignQcReport } from "../qc-report"

function entry(partial: Partial<DesignEntry> & Pick<DesignEntry, "directory" | "buildStatus">): DesignEntry {
  return {
    id: "demo",
    partCount: 1,
    revision: "rev",
    renderRevision: null,
    ...partial,
  }
}

function baseArtifact(): ArtifactManifest {
  return {
    schema: 1,
    id: "demo",
    parts: [
      {
        id: "body",
        files: { step: "step/body.step", stl: "stl/body.stl", glb: "glb/body.glb" },
        metrics: { volume_mm3: 100, size_mm: { x: 1, y: 1, z: 1 } },
      },
    ],
    build: { engine: "forge-cad/1", inputs: {} },
  }
}

async function withParts(directory: string, writeFiles: boolean) {
  for (const format of ["step", "stl", "glb"]) {
    await mkdir(path.join(directory, format), { recursive: true })
    if (writeFiles) await writeFile(path.join(directory, format, `body.${format}`), format)
  }
}

describe("buildDesignQcReport", () => {
  test("fails artifact when unbuilt", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "cad-qc-unbuilt-"))
    const report = await buildDesignQcReport({
      id: "demo",
      entry: entry({ directory, buildStatus: "unbuilt", revision: null }),
      artifact: null,
      printability: { status: "pass" },
      fit: { status: "pass" },
      form: { status: "pass", findings: ["not applicable"] },
    })
    expect(report.artifact.status).toBe("fail")
    expect(report.complete).toBe(false)
    expect(report.blockedBy).toContain("artifact")
  })

  test("fails artifact when stale", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "cad-qc-stale-"))
    await withParts(directory, true)
    const report = await buildDesignQcReport({
      id: "demo",
      entry: entry({ directory, buildStatus: "stale" }),
      artifact: baseArtifact(),
      printability: { status: "pass" },
      fit: { status: "pass" },
      form: { status: "pass", findings: ["not applicable"] },
    })
    expect(report.artifact.status).toBe("fail")
    expect(report.artifact.findings.join(" ")).toMatch(/stale/)
    expect(report.complete).toBe(false)
  })

  test("fails artifact when files missing", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "cad-qc-missing-"))
    await withParts(directory, false)
    const report = await buildDesignQcReport({
      id: "demo",
      entry: entry({ directory, buildStatus: "built" }),
      artifact: baseArtifact(),
      printability: { status: "pass" },
      fit: { status: "pass" },
      form: { status: "pass", findings: ["not applicable"] },
    })
    expect(report.artifact.status).toBe("fail")
    expect(report.artifact.missingFiles.length).toBe(3)
    expect(report.complete).toBe(false)
  })

  test("complete only when every axis passes", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "cad-qc-ok-"))
    await withParts(directory, true)
    const report = await buildDesignQcReport({
      id: "demo",
      entry: entry({ directory, buildStatus: "built" }),
      artifact: baseArtifact(),
      printability: { status: "pass" },
      fit: { status: "pass", findings: ["retention not required"] },
      form: { status: "pass", findings: ["not applicable"] },
    })
    expect(report.complete).toBe(true)
    expect(report.blockedBy).toEqual([])
    expect(report.artifact.status).toBe("pass")
  })
})
