import { tool } from "@opencode-ai/plugin"
import { BUILD123D_TOOL_PREFIX, getBuild123dSession } from "./build123d-session"
import catalog from "./build123d-tools.json" with { type: "json" }

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

const BUILD123D_TOOL_GUIDANCE: Record<string, string> = {
  build123d_execute:
    "The execute Python namespace and the show()/import named-object registry are separate: only variables created by successful execute calls persist as Python variables. Do not assume imported names, objects, or current_shape exist inside execute().",
  build123d_import_cad_file:
    "The imported name is registered for named-object tools but is not bound as a Python variable inside build123d_execute().",
  build123d_compare:
    'For kind="fit", clearance is the global minimum between complete shapes. An intended stop, detent, or other contact can therefore return clearance 0; this does not verify a nominal gap at a specific interface. Check staged poses for moving assemblies. Rigid overlap at a staged pose quantifies collision, not elastic accommodation, insertion force, or retention force.',
  build123d_analyze_printability:
    "The current world orientation is treated as the print orientation. Reorient the final source-built shape into its actual bed pose before analysis, and rerun this check after every geometry change.",
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

export function createBuild123dTools(options: { forgeProjectDir: string; cwd: string }) {
  const session = getBuild123dSession(options.forgeProjectDir, options.cwd)
  const tools: Record<string, ReturnType<typeof tool>> = {}

  for (const entry of catalog.tools as CatalogTool[]) {
    const toolName = `${BUILD123D_TOOL_PREFIX}${entry.name}`
    const guidance = BUILD123D_TOOL_GUIDANCE[toolName]
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
        const result = await session.callTool(entry.name, cleaned, { signal: context.abort })
        const attachments = result.images.map((image, index) => ({
          type: "file" as const,
          mime: image.mimeType,
          url: `data:${image.mimeType};base64,${image.data}`,
          filename: `${entry.name}-${index + 1}.${image.mimeType.includes("svg") ? "svg" : "png"}`,
        }))
        if (result.isError) {
          throw new Error(result.text || `build123d_${entry.name} failed`)
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

export function build123dToolNames() {
  return (catalog.tools as CatalogTool[]).map((entry) => `${BUILD123D_TOOL_PREFIX}${entry.name}`)
}
