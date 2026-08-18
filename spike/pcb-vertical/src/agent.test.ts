import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { createPcbAgent, createPcbTools, modelFor, seedBoard } from "./agent.ts"

test("Mastra model router accepts OpenAI and xAI ids", () => {
  assert.equal(modelFor("openai"), "openai/gpt-4o-mini")
  assert.equal(modelFor("xai"), "xai/grok-3")
  const openai = createPcbAgent({ provider: "openai", root: "/tmp", designId: "x" })
  const xai = createPcbAgent({ provider: "xai", root: "/tmp", designId: "x" })
  assert.ok(openai)
  assert.ok(xai)
})

test("Mastra generate fails closed without provider keys", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pcb-agent-"))
  const agent = createPcbAgent({ provider: "openai", root, designId: "board" })
  const previous = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY
  try {
    await assert.rejects(agent.generate("design the board"), /api key|OPENAI|authentication|Unauthorized/i)
  } finally {
    if (previous) process.env.OPENAI_API_KEY = previous
  }
})

test("PCB tools compile and DRC without the model", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pcb-tools-"))
  const baseHash = await seedBoard(root, "board")
  const tools = createPcbTools(root, "board")
  await tools.applyFail.execute({ baseHash })
  const failed = await tools.verify.execute({})
  assert.equal(failed.complete, false)
  await tools.applyPass.execute({ baseHash: failed.sourceHash })
  const passed = await tools.verify.execute({})
  assert.equal(passed.complete, true, passed.blockers.join("; "))
})
