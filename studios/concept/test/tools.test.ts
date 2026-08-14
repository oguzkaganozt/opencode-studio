import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { compileMoodboardPrompt, moodboardPromptHash } from "../moodboard"
import { applyUpdate, emptyConcept, isVagueMust, parseIntent } from "../schema"
import { createConceptStudioPlugin } from "../tools"
import { readBriefIfPresent, readReviewIfPresent, resolveConcept } from "../workspace"

const root = path.join(import.meta.dir, ".tmp-concept-tools")
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const ask = async () => {}
const weak = [{ id: "f1", severity: "weak", topic: "form", text: "Direction is generic" }]
const blocker = [{ id: "b1", severity: "blocker", topic: "cmf", text: "CMF is a cliché" }]

function parse(raw: unknown) {
  return JSON.parse(String(raw)) as { ok: boolean; error?: { code: string; message: string }; data: Record<string, unknown> | null }
}

async function plugin() {
  await mkdir(root, { recursive: true })
  return createConceptStudioPlugin({
    workspaceRoot: root,
    generateImage: async () => ({ bytes: PNG, mime: "image/png", extension: ".png", provider: "xai" }),
  })({ directory: root, worktree: root } as never, {})
}

const intent = { one_liner: "Pocket radio for commuters", product_type: "portable radio" }
const context = { user: "urban commuter", environment: "train carriage", scenarios: ["one-hand tune"] }
const constraints = { envelope_mm: [80, 40, 20], cost: null, process: "injection", brand: null, other: [] }
const requirements = {
  must: [
    { id: "m1", text: "Fits in a coat pocket", testable: true },
    { id: "m2", text: "Single analog tuner", testable: true },
    { id: "m3", text: "Runs 8 hours on two AA cells", testable: true },
  ],
  should: [],
  could: [],
  out: [],
}
const direction = {
  id: "slab",
  name: "Soft slab",
  form: "Rounded rectangular slab with a crowned face",
  cmf: "Matte charcoal ABS, brushed aluminum grille",
  rationale: "Reads as a radio without retro pastiche",
  chosen: true,
}

async function seed(hooks: Awaited<ReturnType<typeof plugin>>, id = "radio") {
  expect(parse(await hooks.tool!.concept_create.execute({ id }, { ask } as never)).ok).toBe(true)
  expect(parse(await hooks.tool!.concept_update.execute({ id, section: "intent", data: intent }, { ask } as never)).ok).toBe(true)
  expect(parse(await hooks.tool!.concept_update.execute({ id, section: "context", data: context }, { ask } as never)).ok).toBe(true)
  expect(parse(await hooks.tool!.concept_update.execute({ id, section: "constraints", data: constraints }, { ask } as never)).ok).toBe(true)
  expect(parse(await hooks.tool!.concept_update.execute({ id, section: "requirements", data: requirements }, { ask } as never)).ok).toBe(
    true,
  )
  expect(parse(await hooks.tool!.concept_update.execute({ id, section: "direction", data: direction }, { ask } as never)).ok).toBe(true)
}

describe("concept schema", () => {
  test("rejects unknown keys and vague musts", () => {
    expect(() => parseIntent({ one_liner: "x", product_type: "y", extra: true })).toThrow(/Unknown intent keys/)
    expect(isVagueMust("beautiful")).toBe(true)
    expect(isVagueMust("beautiful 200mm grip")).toBe(false)
    const concept = emptyConcept("demo")
    expect(() =>
      applyUpdate(concept, "requirements", {
        must: [{ id: "m1", text: "premium", testable: true }],
        should: [],
        could: [],
        out: [],
      }),
    ).toThrow(/Vague must/)
  })
})

describe("concept tools", () => {
  test("update rejects frozen writes and unknown sections", async () => {
    const hooks = await plugin()
    await seed(hooks)
    expect(
      parse(await hooks.tool!.concept_moodboard.execute({ id: "radio" }, { ask, abort: new AbortController().signal } as never)).ok,
    ).toBe(true)
    expect(parse(await hooks.tool!.concept_review.execute({ id: "radio", findings: weak }, { ask } as never)).ok).toBe(true)
    expect(parse(await hooks.tool!.concept_freeze.execute({ id: "radio" }, { ask } as never)).ok).toBe(true)
    const frozen = parse(await hooks.tool!.concept_update.execute({ id: "radio", section: "intent", data: intent }, { ask } as never))
    expect(frozen.ok).toBe(false)
    expect(frozen.error?.message).toMatch(/frozen/i)
    const bad = parse(await hooks.tool!.concept_update.execute({ id: "radio", section: "architecture", data: {} }, { ask } as never))
    expect(bad.ok).toBe(false)
  })

  test("moodboard prompt is a pure function of json", async () => {
    const concept = applyUpdate(applyUpdate(emptyConcept("radio"), "intent", intent), "direction", direction)
    const prompt = compileMoodboardPrompt(concept, concept.directions[0]!)
    expect(prompt).toContain("portable radio")
    expect(prompt).toContain("Soft slab")
    expect(moodboardPromptHash(prompt)).toBe(moodboardPromptHash(compileMoodboardPrompt(concept, concept.directions[0]!)))
  })

  test("blocker without waive fails freeze; waive writes BRIEF.md", async () => {
    const hooks = await plugin()
    await seed(hooks)
    expect(
      parse(await hooks.tool!.concept_moodboard.execute({ id: "radio" }, { ask, abort: new AbortController().signal } as never)).ok,
    ).toBe(true)
    expect(parse(await hooks.tool!.concept_review.execute({ id: "radio", findings: blocker }, { ask } as never)).ok).toBe(true)
    const blocked = parse(await hooks.tool!.concept_freeze.execute({ id: "radio" }, { ask } as never))
    expect(blocked.ok).toBe(false)
    const frozen = parse(
      await hooks.tool!.concept_freeze.execute({ id: "radio", waive: [{ id: "b1", reason: "Brand wants the familiar CMF" }] }, {
        ask,
      } as never),
    )
    expect(frozen.ok).toBe(true)
    const entry = await resolveConcept(root, "radio")
    expect(entry.concept.status).toBe("frozen")
    expect(entry.concept.source_hash).toHaveLength(64)
    expect(await readBriefIfPresent(entry.directory)).toContain("Pocket radio")
    const review = await readReviewIfPresent(entry.directory)
    expect(review?.concept_hash).toHaveLength(64)
    expect(review?.concept_id).toBe("radio")
  })

  test("stale review blocks freeze", async () => {
    const hooks = await plugin()
    await seed(hooks)
    expect(
      parse(await hooks.tool!.concept_moodboard.execute({ id: "radio" }, { ask, abort: new AbortController().signal } as never)).ok,
    ).toBe(true)
    expect(parse(await hooks.tool!.concept_review.execute({ id: "radio", findings: weak }, { ask } as never)).ok).toBe(true)
    expect(
      parse(
        await hooks.tool!.concept_update.execute(
          { id: "radio", section: "intent", data: { ...intent, one_liner: "Changed after review" } },
          { ask } as never,
        ),
      ).ok,
    ).toBe(true)
    const stale = parse(await hooks.tool!.concept_freeze.execute({ id: "radio" }, { ask } as never))
    expect(stale.ok).toBe(false)
    expect(stale.error?.code).toBe("lint_failed")
  })

  test("bad from does not leave a leftover folder", async () => {
    const hooks = await plugin()
    const failed = parse(await hooks.tool!.concept_create.execute({ id: "fork", from: "missing" }, { ask } as never))
    expect(failed.ok).toBe(false)
    expect(await Bun.file(path.join(root, "fork", "concept.json")).exists()).toBe(false)
    expect(await Bun.file(path.join(root, "fork")).exists()).toBe(false)
  })

  test("moodboard uses the generated image extension", async () => {
    await mkdir(root, { recursive: true })
    const hooks = await createConceptStudioPlugin({
      workspaceRoot: root,
      generateImage: async () => ({ bytes: PNG, mime: "image/jpeg", extension: ".jpg", provider: "xai" }),
    })({ directory: root, worktree: root } as never, {})
    await seed(hooks)
    const result = parse(
      await hooks.tool!.concept_moodboard.execute({ id: "radio" }, { ask, abort: new AbortController().signal } as never),
    )
    expect(result.ok).toBe(true)
    expect((result.data?.moodboard as { path?: string })?.path).toBe("moodboards/slab-01.jpg")
    expect(await Bun.file(path.join(root, "radio", "moodboards", "slab-01.jpg")).exists()).toBe(true)
  })
})
