const KICAD_MODEL_CACHE = "https://kicad-mod-cache.tscircuit.com/"

type CircuitElement = Record<string, unknown>

export type CadAssetIssue = {
  component: string
  reason: "no-model" | "unreachable"
  url?: string
}

export type CadAssetHealth = {
  status: "complete" | "partial"
  total: number
  available: number
  missing: number
  issues: CadAssetIssue[]
}

const EASYEDA_OBJ = /modelcdn\.tscircuit\.com\/easyeda_models\/.*\.obj/i

export function stripEmbeddedObjMaterials(obj: string): string {
  return obj
    .replace(/newmtl[\s\S]*?endmtl\s*/g, "")
    .replace(/^usemtl.*(?:\r?\n|$)/gm, "")
    .replace(/^mtllib.*(?:\r?\n|$)/gm, "")
}

function objDataUrl(obj: string): string {
  return `data:model/obj;base64,${btoa(obj)}`
}

export async function opaqueEasyedaObjModels(circuitJson: unknown, fetchModel: typeof fetch = fetch): Promise<unknown> {
  if (!Array.isArray(circuitJson)) return circuitJson
  const urls = [
    ...new Set(
      circuitJson.flatMap((element) => {
        if (!element || typeof element !== "object" || Array.isArray(element)) return []
        const url = (element as CircuitElement).model_obj_url
        return typeof url === "string" && EASYEDA_OBJ.test(url) ? [url] : []
      }),
    ),
  ]
  const rewritten = new Map<string, string>()
  await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetchModel(url)
        if (!response.ok) return
        rewritten.set(url, objDataUrl(stripEmbeddedObjMaterials(await response.text())))
      } catch {
        // Keep the original EasyEDA URL if the rewrite fetch fails.
      }
    }),
  )
  if (rewritten.size === 0) return circuitJson
  return circuitJson.map((element) => {
    if (!element || typeof element !== "object" || Array.isArray(element)) return element
    const record = element as CircuitElement
    if (record.type !== "cad_component" || typeof record.model_obj_url !== "string") return element
    const next = rewritten.get(record.model_obj_url)
    if (!next) return element
    const { model_step_url: _step, ...rest } = record
    return { ...rest, model_obj_url: next }
  })
}

export function preferKicadStepModels(circuitJson: unknown): unknown {
  if (!Array.isArray(circuitJson)) return circuitJson

  return circuitJson.map((element) => {
    if (
      element === null ||
      typeof element !== "object" ||
      !("type" in element) ||
      element.type !== "cad_component" ||
      !("model_wrl_url" in element) ||
      typeof element.model_wrl_url !== "string" ||
      !element.model_wrl_url.startsWith(KICAD_MODEL_CACHE) ||
      !("model_step_url" in element) ||
      typeof element.model_step_url !== "string" ||
      !element.model_step_url.startsWith(KICAD_MODEL_CACHE)
    ) {
      return element
    }

    const { model_wrl_url: _unavailableWrl, ...stepModel } = element
    return stepModel
  })
}

function modelUrl(component: CircuitElement): string | null {
  for (const key of ["model_glb_url", "model_gltf_url", "model_wrl_url", "model_stl_url", "model_obj_url", "model_step_url"]) {
    const value = component[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return null
}

function cadAssets(circuitJson: unknown) {
  const elements = preferKicadStepModels(circuitJson)
  if (!Array.isArray(elements)) return []

  const names = new Map(
    elements
      .filter(
        (element): element is CircuitElement => element !== null && typeof element === "object" && element.type === "source_component",
      )
      .map((element) => [element.source_component_id, element.name]),
  )

  return elements
    .filter((element): element is CircuitElement => element !== null && typeof element === "object" && element.type === "cad_component")
    .map((component, index) => ({
      component:
        (typeof names.get(component.source_component_id) === "string" && (names.get(component.source_component_id) as string)) ||
        (typeof component.source_component_id === "string" && component.source_component_id) ||
        `cad_component_${index}`,
      url: modelUrl(component),
      embedded: Boolean(component.model_jscad || component.footprinter_string),
    }))
}

async function urlAvailable(url: string, fetchModel: typeof fetch): Promise<boolean> {
  if (url.startsWith("data:") || url.startsWith("blob:")) return true
  try {
    const head = await fetchModel(url, { method: "HEAD" })
    if (head.ok) return true
    if (head.status !== 405 && head.status !== 501) return false
  } catch {
    // Some model hosts allow GET but reject HEAD or its CORS preflight.
  }

  try {
    return (await fetchModel(url, { cache: "force-cache" })).ok
  } catch {
    return false
  }
}

export async function checkCadAssetHealth(circuitJson: unknown, fetchModel: typeof fetch = fetch): Promise<CadAssetHealth> {
  const assets = cadAssets(circuitJson)
  const urls = [...new Set(assets.flatMap((asset) => (asset.url ? [asset.url] : [])))]
  const availability = new Map(await Promise.all(urls.map(async (url) => [url, await urlAvailable(url, fetchModel)] as const)))
  const issues: CadAssetIssue[] = []

  for (const asset of assets) {
    if (asset.embedded && !asset.url) continue
    if (!asset.url) {
      issues.push({ component: asset.component, reason: "no-model" })
    } else if (!availability.get(asset.url)) {
      issues.push({ component: asset.component, reason: "unreachable", url: asset.url })
    }
  }

  return {
    status: issues.length === 0 ? "complete" : "partial",
    total: assets.length,
    available: assets.length - issues.length,
    missing: issues.length,
    issues,
  }
}
