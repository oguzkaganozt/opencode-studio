import { describe, expect, test } from "bun:test"
import { composeStudioPlugins, listComposedToolNames } from "../src/core/plugin-compose"

describe("plugin composition", () => {
  test("merges tools and rejects duplicates", () => {
    const composed = composeStudioPlugins([
      { studioId: "cad", hooks: { tool: { cad_design_list: { id: "a" } } } as any },
      { studioId: "pcb", hooks: { tool: { pcb_workspace_list: { id: "b" } } } as any },
    ])
    expect(listComposedToolNames(composed)).toEqual(["cad_design_list", "pcb_workspace_list"])
    expect(() =>
      composeStudioPlugins([
        { studioId: "cad", hooks: { tool: { shared: { id: "a" } } } as any },
        { studioId: "pcb", hooks: { tool: { shared: { id: "b" } } } as any },
      ]),
    ).toThrow(/Duplicate tool/)
  })

  test("runs mutable transforms in catalog order", async () => {
    const order: string[] = []
    const composed = composeStudioPlugins([
      {
        studioId: "pcb",
        hooks: {
          "tool.definition": async () => {
            order.push("pcb")
          },
        } as any,
      },
      {
        studioId: "cad",
        hooks: {
          "tool.definition": async () => {
            order.push("cad")
          },
        } as any,
      },
      {
        studioId: "fw",
        hooks: {
          "tool.definition": async () => {
            order.push("fw")
          },
        } as any,
      },
    ])
    await (composed as any)["tool.definition"]()
    expect(order).toEqual(["cad", "pcb", "fw"])
  })

  test("rejects unknown hooks", () => {
    expect(() => composeStudioPlugins([{ studioId: "cad", hooks: { "future.hook": async () => {} } as any }])).toThrow(
      /Unknown OpenCode hook/,
    )
  })
})
