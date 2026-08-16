import { describe, expect, test } from "bun:test"
import { opaqueEasyedaObjModels, stripEmbeddedObjMaterials } from "./cad-models"

describe("stripEmbeddedObjMaterials", () => {
  test("removes EasyEDA embedded MTL so the mesh stays opaque", () => {
    const obj = [
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "newmtl 1",
      "Kd 0.2 0.2 0.2",
      "d 0.0",
      "endmtl",
      "usemtl 1",
      "f 1 2 3",
      "",
    ].join("\n")
    const stripped = stripEmbeddedObjMaterials(obj)
    expect(stripped).toContain("v 0 0 0")
    expect(stripped).toContain("f 1 2 3")
    expect(stripped).not.toContain("newmtl")
    expect(stripped).not.toContain("d 0.0")
    expect(stripped).not.toContain("usemtl")
  })
})

describe("opaqueEasyedaObjModels", () => {
  test("rewrites EasyEDA OBJ urls to material-free data urls", async () => {
    const source = "https://modelcdn.tscircuit.com/easyeda_models/assets/C2838502.obj?uuid=abc"
    const json = [
      { type: "source_component", source_component_id: "sc1", name: "U1" },
      {
        type: "cad_component",
        source_component_id: "sc1",
        model_obj_url: source,
        model_step_url: source.replace(".obj", ".step"),
      },
    ]
    const result = (await opaqueEasyedaObjModels(json, async () => {
      return new Response("v 0 0 0\nnewmtl 1\nd 0.0\nendmtl\nusemtl 1\nf 1 1 1\n")
    })) as Array<Record<string, unknown>>
    const cad = result[1]!
    expect(String(cad.model_obj_url)).toStartWith("data:model/obj;base64,")
    expect(cad.model_step_url).toBeUndefined()
    expect(atob(String(cad.model_obj_url).slice("data:model/obj;base64,".length))).not.toContain("d 0.0")
  })
})
