import { describe, expect, test } from "bun:test"
import {
  designBuildFailureResult,
  designBuildSuccessResult,
  designCreateResult,
  extractFirstJson,
  structureCadSessionResult,
} from "../tools/result"

describe("extractFirstJson", () => {
  test("parses JSON after prose prefix", () => {
    const text = 'Validity gate: PASS\n{\n  "passes_gate": true,\n  "reasons": []\n}'
    const got = extractFirstJson(text)
    expect(got?.prefix).toContain("PASS")
    expect((got?.value as { passes_gate: boolean }).passes_gate).toBe(true)
  })

  test("returns null without JSON", () => {
    expect(extractFirstJson("no structured payload")).toBeNull()
  })
})

describe("structureCadSessionResult", () => {
  test("normalize validate pass/fail", () => {
    const pass = structureCadSessionResult({
      entryName: "validate",
      toolName: "cad_validate",
      text: 'Validity gate: PASS\n{"passes_gate":true,"reasons":[],"warnings":[]}',
      isError: false,
    })
    expect(pass.ok).toBe(true)
    expect(pass.status).toBe("pass")
    expect(pass.data?.passes_gate).toBe(true)

    const fail = structureCadSessionResult({
      entryName: "validate",
      toolName: "cad_validate",
      text: 'Validity gate: FAIL — open shell\n{"passes_gate":false,"reasons":["open shell"],"warnings":[]}',
      isError: false,
    })
    expect(fail.ok).toBe(false)
    expect(fail.status).toBe("fail")
    expect(fail.next?.[0]).toContain("locate_gate")
  })

  test("normalize measure", () => {
    const got = structureCadSessionResult({
      entryName: "measure",
      toolName: "cad_measure",
      text: JSON.stringify({
        volume: 1000,
        area: 600,
        topology: { faces: 6, edges: 12, vertices: 8 },
        bbox: { xsize: 10, ysize: 10, zsize: 10 },
      }),
      isError: false,
    })
    expect(got.ok).toBe(true)
    expect(got.summary).toContain("volume=1000")
    expect(got.data?.volume).toBe(1000)
  })

  test("normalize compare fit", () => {
    const got = structureCadSessionResult({
      entryName: "compare",
      toolName: "cad_compare",
      text: JSON.stringify({
        clearance: 0.3,
        status: "apart",
        containment: "neither",
        intersection_volume: 0,
        gap_verified: true,
        fit_quality: "gap",
      }),
      isError: false,
      args: { kind: "fit", a: "body", b: "lid" },
    })
    expect(got.ok).toBe(true)
    expect(got.status).toBe("pass")
    expect(got.summary).toContain("apart")

    const seat = structureCadSessionResult({
      entryName: "compare",
      toolName: "cad_compare",
      text: JSON.stringify({
        clearance: 0,
        status: "touching",
        containment: "neither",
        intersection_volume: 0,
        gap_verified: false,
        fit_quality: "contact",
      }),
      isError: false,
      args: { kind: "fit", a: "body", b: "lid" },
    })
    expect(seat.ok).toBe(true)
    expect(seat.status).toBe("unverified")
    expect(seat.warnings.some((w) => /gap_verified=false|seat contact/i.test(w))).toBe(true)

    const clash = structureCadSessionResult({
      entryName: "compare",
      toolName: "cad_compare",
      text: JSON.stringify({
        clearance: 0,
        status: "interpenetrating",
        containment: "neither",
        intersection_volume: 12,
        gap_verified: false,
        fit_quality: "clash",
      }),
      isError: false,
      args: { kind: "fit" },
    })
    expect(clash.status).toBe("fail")
    expect(clash.ok).toBe(false)
    expect(clash.warnings.some((w) => /interpenetrat/i.test(w))).toBe(true)
  })

  test("normalize printability", () => {
    const pass = structureCadSessionResult({
      entryName: "analyze_printability",
      toolName: "cad_analyze_printability",
      text: '0 findings — part looks printable\n\n{"findings":[]}',
      isError: false,
    })
    expect(pass.ok).toBe(true)
    expect(pass.status).toBe("pass")
    expect(pass.data?.error_count).toBe(0)

    const fail = structureCadSessionResult({
      entryName: "analyze_printability",
      toolName: "cad_analyze_printability",
      text: JSON.stringify({
        findings: [{ kind: "manifold", severity: "error", message: "not manifold" }],
      }),
      isError: false,
    })
    expect(fail.ok).toBe(false)
    expect(fail.status).toBe("fail")
    expect(fail.data?.error_count).toBe(1)
  })

  test("tool error becomes structured envelope", () => {
    const got = structureCadSessionResult({
      entryName: "measure",
      toolName: "cad_measure",
      text: "boom",
      isError: true,
    })
    expect(got.ok).toBe(false)
    expect(got.status).toBe("error")
    expect(got.error?.code).toBe("tool_error")
  })
})

describe("design lifecycle envelopes", () => {
  test("create/build success/fail shapes", () => {
    const created = designCreateResult({
      id: "box",
      designDir: "/tmp/box",
      parts: [{ id: "body", source: "parts/body.py" }],
    })
    expect(created.ok).toBe(true)
    expect(created.next?.[0]).toContain("params.py")

    const built = designBuildSuccessResult({
      id: "box",
      revision: "abc",
      manifestPath: "/tmp/box/manifest.json",
      designDir: "/tmp/box",
      parts: [{ id: "body", stepPath: "/tmp/box/step/body.step", metrics: { solid_count: 1 } }],
    })
    expect(built.ok).toBe(true)
    expect(built.warnings[0]).toMatch(/not run/i)

    const failed = designBuildFailureResult({
      id: "box",
      exitCode: 1,
      designDir: "/tmp/box",
      stdout: "",
      stderr: "ValueError: Part body build() must return a build123d Shape",
    })
    expect(failed.ok).toBe(false)
    expect(failed.data?.preservedPrevious).toBe(true)
    expect(failed.error?.message).toMatch(/Shape/)
  })
})
