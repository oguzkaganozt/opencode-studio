import { tool } from "@opencode-ai/plugin"
import catalog from "./catalog.json" with { type: "json" }
import { CAD_SESSION_ALLOWLIST, cadSessionToolName } from "./names"
import { CAD_SESSION_STRUCTURED_TOOLS, formatCadToolResult, structureCadSessionResult } from "./result"
import { getCadRuntimeSession } from "./session"

type JsonSchema = {
  type?: string | string[]
  description?: string
  title?: string
  default?: unknown
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  anyOf?: JsonSchema[]
  additionalProperties?: boolean | JsonSchema
}

type CatalogTool = {
  name: string
  description: string
  inputSchema: JsonSchema
}

type Field = any

const CAD_SESSION_TOOL_GUIDANCE: Record<string, string> = {
  cad_execute:
    "build123d public names are preloaded. Active design params.py is bound as params and bare constants (e.g. BOX_L) after cad_design_create/read/build. Named registry shapes (show/import) bind as identifiers when valid, always via cad_objects[name]/cad_object(name). In-execute clearance() is exploratory; product-fit QC evidence requires cad_compare kind=fit.",
  cad_compare:
    'Returns structured JSON {ok, status, summary, data, next}. kind="fit": global min distance + fit_quality (gap|contact|clash|nested) + gap_verified. QC fit pass requires status=pass (positive gap or nested), not seat-contact touching. For snug lips, compare isolated mating solids so gap_verified=true. Prefer this over in-execute clearance() for fit QC.',
  cad_import_cad_file:
    "Registers the shape for named-object tools and binds it into the next cad_execute namespace (valid identifiers as bare names; always via cad_object(name)).",
  cad_validate: "Returns structured JSON {ok, status, summary, data, next}. Use data.passes_gate and status; do not re-parse free text.",
  cad_measure: "Returns structured JSON {ok, status, summary, data, next} with volume/bbox/topology in data.",
  cad_analyze_printability:
    "Returns structured JSON {ok, status, summary, data, next}. status is fail when any error-severity finding exists. The current world orientation is treated as the print orientation. Reorient the final source-built shape into its actual bed pose before analysis, and rerun this check after every geometry change.",
  cad_analyze_form:
    "Returns structured JSON {ok, status, summary, data, next}. Slices the solid into stations (width/depth/center). status=pass only with a numeric contract within tol. Diagnostic only in v1 — form is not a QC axis; the locked contract dimensions are. Prismatic designs should skip it.",
}

function schemaToZod(schema: JsonSchema | undefined): Field {
  if (!schema) return tool.schema.any()

  if (schema.anyOf?.length) {
    const nullable = schema.anyOf.some((entry) => entry.type === "null")
    const variants = schema.anyOf.filter((entry) => entry.type !== "null").map((entry) => schemaToZod(entry))
    let base: Field =
      variants.length === 0
        ? tool.schema.any()
        : variants.length === 1
          ? variants[0]
          : tool.schema.union(variants as [Field, Field, ...Field[]])
    if (nullable) base = base.nullable()
    if (schema.description) base = base.describe(schema.description)
    return base
  }

  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  const nonNull = types.filter((t) => t !== "null")
  const primary = nonNull[0]

  let base: Field
  switch (primary) {
    case "string":
      base = tool.schema.string()
      break
    case "integer":
      base = tool.schema.number().int()
      break
    case "number":
      base = tool.schema.number()
      break
    case "boolean":
      base = tool.schema.boolean()
      break
    case "array":
      base = tool.schema.array(schemaToZod(schema.items))
      break
    case "object": {
      const shape = jsonSchemaToShape(schema)
      base =
        Object.keys(shape).length === 0
          ? tool.schema.record(tool.schema.string(), tool.schema.any())
          : tool.schema.object(shape).passthrough()
      break
    }
    default:
      base = tool.schema.any()
  }

  if (types.includes("null")) base = base.nullable()
  if (schema.description) base = base.describe(schema.description)
  return base
}

function jsonSchemaToShape(schema: JsonSchema): Record<string, Field> {
  const props = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  const shape: Record<string, Field> = {}
  for (const [key, prop] of Object.entries(props)) {
    let field = schemaToZod(prop)
    if (!required.has(key)) field = field.optional()
    shape[key] = field
  }
  return shape
}

export function createCadSessionTools(options: { engineProjectDir: string; cwd: string }) {
  const tools: Record<string, ReturnType<typeof tool>> = {}

  for (const entry of catalog.tools as CatalogTool[]) {
    if (!(CAD_SESSION_ALLOWLIST as readonly string[]).includes(entry.name)) continue
    const toolName = cadSessionToolName(entry.name)
    const guidance = CAD_SESSION_TOOL_GUIDANCE[toolName]
    const description = guidance ? `${entry.description} ${guidance}` : entry.description
    const args = jsonSchemaToShape(entry.inputSchema ?? { type: "object", properties: {} })

    tools[toolName] = tool({
      description,
      args,
      async execute(rawArgs, context) {
        const cleaned: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(rawArgs as Record<string, unknown>)) {
          if (value === undefined) continue
          cleaned[key] = value
        }
        const runtime = getCadRuntimeSession(options.engineProjectDir, options.cwd, context.sessionID)
        const result = await runtime.callTool(entry.name, cleaned, { signal: context.abort })
        const attachments = result.images.map((image, index) => ({
          type: "file" as const,
          mime: image.mimeType,
          url: `data:${image.mimeType};base64,${image.data}`,
          filename: `${entry.name}-${index + 1}.${image.mimeType.includes("svg") ? "svg" : "png"}`,
        }))
        if (CAD_SESSION_STRUCTURED_TOOLS.has(entry.name)) {
          const envelope = structureCadSessionResult({
            entryName: entry.name,
            toolName,
            text: result.text,
            isError: result.isError,
            args: cleaned,
          })
          return {
            title: envelope.ok ? toolName : `${toolName} failed`,
            output: formatCadToolResult(envelope),
            metadata: {
              tool: toolName,
              ok: envelope.ok,
              status: envelope.status,
              summary: envelope.summary,
            },
            attachments: attachments.length > 0 ? attachments : undefined,
          }
        }
        if (result.isError) {
          throw new Error(result.text || `${toolName} failed`)
        }
        return {
          title: toolName,
          output: result.text,
          metadata: { tool: toolName },
          attachments: attachments.length > 0 ? attachments : undefined,
        }
      },
    })
  }

  return tools
}
