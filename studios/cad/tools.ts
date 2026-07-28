import path from "node:path"
import type { Plugin, PluginOptions } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import manifest from "../../package.json" with { type: "json" }
import { buildDesign, defaultForgeRunner, type ForgeRunner, scaffoldDesign } from "./forge"
import { findDesign, initializeStudio, listRenders, scanDesigns } from "./library"
import { artifactRevision, ID_PATTERN, readArtifactManifest, readDesignManifest } from "./manifest"
import { buildDesignQcReport, type QcAxisStatus } from "./qc-report"

const PACKAGE_NAME = `${manifest.name}@${manifest.version}`
const MAX_TOOL_OUTPUT_BYTES = 60_000
const COMPANION_HEALTH_TIMEOUT_MS = 1_000

const BUILD123D_TOOL_GUIDANCE: Record<string, string> = {
  build123d_execute:
    "The execute Python namespace and the show()/import named-object registry are separate: only variables created by successful execute calls persist as Python variables. Do not assume imported names, objects, or current_shape exist inside execute().",
  build123d_import_cad_file:
    "The imported name is registered for named-object MCP tools but is not bound as a Python variable inside build123d_execute().",
  build123d_compare:
    'For kind="fit", clearance is the global minimum between complete shapes. An intended stop, detent, or other contact can therefore return clearance 0; this does not verify a nominal gap at a specific interface. Check staged poses for moving assemblies. Rigid overlap at a staged pose quantifies collision, not elastic accommodation, insertion force, or retention force.',
  build123d_analyze_printability:
    "The current world orientation is treated as the print orientation. Reorient the final source-built shape into its actual bed pose before analysis, and rerun this check after every geometry change.",
}

type Options = {
  studioRoot: string
  forgeProjectDir: string
  companionUrl?: string
  forgeRunner?: ForgeRunner
}

function truncate(value: string, max = MAX_TOOL_OUTPUT_BYTES) {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n\n[truncated at ${max} bytes]`
}

function asJson(value: unknown) {
  return truncate(JSON.stringify(value, null, 2))
}

async function fileExists(filePath: string) {
  return Bun.file(filePath).exists()
}

async function companionReachable(companionUrl: string) {
  try {
    const response = await fetch(new URL("/studio-api/health", companionUrl), { signal: AbortSignal.timeout(COMPANION_HEALTH_TIMEOUT_MS) })
    return response.ok
  } catch {
    return false
  }
}

function resolvePathOption(value: unknown, fallback: string, base: string, name: string) {
  if (value !== undefined && (typeof value !== "string" || value.length === 0 || value.includes("\0"))) {
    throw new Error(`${PACKAGE_NAME}: ${name} must be a non-empty filesystem path`)
  }
  return path.resolve(base, typeof value === "string" ? value : fallback)
}

function options(input: PluginOptions | undefined, directory: string): Options {
  const studioRoot = resolvePathOption(input?.studioRoot, ".", directory, "studioRoot")
  const forgeProjectDir = resolvePathOption(input?.forgeProjectDir, path.resolve(import.meta.dir, "forge"), directory, "forgeProjectDir")
  const companionUrl = typeof input?.companionUrl === "string" && input.companionUrl.length > 0 ? input.companionUrl : undefined
  return { studioRoot, forgeProjectDir, companionUrl }
}

export type StudioPluginDependencies = {
  forgeRunner?: ForgeRunner
}

export function createStudioPlugin(dependencies: StudioPluginDependencies = {}): Plugin {
  return async (context, rawOptions) => {
    const config = options(rawOptions, context.directory)
    const layout = await initializeStudio(config.studioRoot)
    const forgeRunner = dependencies.forgeRunner ?? config.forgeRunner ?? defaultForgeRunner
    return {
      "tool.definition": async ({ toolID }, output) => {
        const guidance = BUILD123D_TOOL_GUIDANCE[toolID]
        if (guidance && !output.description.includes(guidance)) output.description = `${output.description} ${guidance}`
      },

      event: async ({ event }) => {
        if (event.type !== "session.deleted") return
      },

      tool: {
        design_list: tool({
          description:
            "List CAD designs discovered under the studio designs/ directory. Each entry reports id, build status, and part count.",
          args: {},
          async execute() {
            const designs = await scanDesigns(layout)
            return asJson({
              designs: designs.map((entry) => ({
                id: entry.id,
                buildStatus: entry.buildStatus,
                partCount: entry.partCount,
                revision: entry.revision,
                renderRevision: entry.renderRevision,
              })),
            })
          },
        }),

        design_create: tool({
          description:
            "Scaffold a new CAD design directory with design.json (schema 1), params.py, and parts/. Use this in Phase 0 after deciding the part decomposition. Source files for individual parts are written separately during Phase 1.",
          args: {
            id: tool.schema.string().min(1).describe("Lowercase design id matching ^[a-z0-9][a-z0-9_-]*$"),
            parts: tool.schema
              .array(
                tool.schema.object({
                  id: tool.schema.string().min(1).describe("Part id; must match ^[a-z0-9][a-z0-9_-]*$"),
                  source: tool.schema
                    .string()
                    .optional()
                    .describe("Optional source path under parts/ (defaults to parts/<id-underscored>.py)"),
                }),
              )
              .min(1)
              .describe("Initial part list; each part gets a placeholder source that must be modeled before design_build."),
          },
          async execute(args, context) {
            if (!ID_PATTERN.test(args.id)) throw new Error(`Invalid design id: ${args.id}`)
            for (const part of args.parts) {
              if (!ID_PATTERN.test(part.id)) throw new Error(`Invalid part id: ${part.id}`)
            }
            await context.ask({
              permission: "edit",
              patterns: [
                `designs/${args.id}/design.json`,
                `designs/${args.id}/params.py`,
                ...args.parts.map((part) => `designs/${args.id}/${part.source ?? `parts/${part.id.replace(/-/g, "_")}.py`}`),
              ],
              always: [],
              metadata: {},
            })
            const { designDir, manifest } = await scaffoldDesign(
              layout,
              args.id,
              args.parts.map((part) => ({ id: part.id, source: part.source })),
            )
            return {
              title: designDir,
              output: `Scaffolded design "${args.id}" at ${designDir}. design.json lists ${manifest.parts.length} part(s).`,
              metadata: {
                designDir,
                parts: manifest.parts,
              },
            }
          },
        }),

        design_read: tool({
          description:
            "Read the canonical design/build summary, resolved artifact paths with existence checks, metrics, revision, and render inventory. Use after design_build; do not follow it with raw manifest reads or artifact globs.",
          args: {
            id: tool.schema.string().min(1).describe("Design id."),
          },
          async execute(args) {
            const entry = await findDesign(layout, args.id)
            if (!entry) throw new Error(`Design not found: ${args.id}`)
            const design = await readDesignManifest(entry.directory, args.id)
            const artifact = await readArtifactManifest(entry.directory, args.id)
            const manifestPath = path.join(entry.directory, "manifest.json")
            return asJson({
              id: args.id,
              directory: entry.directory,
              buildStatus: entry.buildStatus,
              revision: entry.revision,
              design,
              artifact: artifact
                ? {
                    schema: artifact.schema,
                    id: artifact.id,
                    engine: artifact.build.engine,
                    manifestPath,
                    exists: true,
                    parts: await Promise.all(
                      artifact.parts.map(async (part) => ({
                        id: part.id,
                        files: Object.fromEntries(
                          await Promise.all(
                            Object.entries(part.files).map(async ([format, relativePath]) => {
                              const resolvedPath = path.resolve(entry.directory, relativePath)
                              return [format, { path: resolvedPath, exists: await fileExists(resolvedPath) }]
                            }),
                          ),
                        ),
                        metrics: part.metrics,
                      })),
                    ),
                  }
                : null,
              renders: await listRenders(entry.directory),
            })
          },
        }),

        design_build: tool({
          description:
            "Deterministically build a CAD design and validate source plus round-tripped STEP geometry as one valid solid before exporting STEP/STL/GLB and manifest.json. A failed build preserves the previous output. Build success does not verify assembly or printability. Do not revalidate or remeasure unchanged STEP artifacts solely to repeat build guarantees.",
          args: {
            id: tool.schema.string().min(1).describe("Design id to build."),
          },
          async execute(args, context) {
            const entry = await findDesign(layout, args.id)
            if (!entry) throw new Error(`Design not found: ${args.id}`)
            await context.ask({
              permission: "edit",
              patterns: [
                `designs/${args.id}/step/`,
                `designs/${args.id}/stl/`,
                `designs/${args.id}/glb/`,
                `designs/${args.id}/manifest.json`,
              ],
              always: [],
              metadata: {},
            })
            const result = await buildDesign(layout, args.id, config.forgeProjectDir, forgeRunner, context.abort)
            if (!result.ok) {
              return {
                title: `Design build failed: ${args.id}`,
                output: `Build failed (exit ${result.exitCode}).\n\nstdout:\n${truncate(result.stdout)}\n\nstderr:\n${truncate(result.stderr)}`,
                metadata: { ok: false, exitCode: result.exitCode, designDir: result.designDir },
              }
            }
            const artifact = await readArtifactManifest(entry.directory, args.id)
            if (!artifact || !result.manifestPath) throw new Error(`manifest.json not found after build: ${args.id}`)
            const summary = {
              revision: artifactRevision(artifact),
              manifestPath: path.resolve(result.manifestPath),
              parts: artifact.parts.map((part) => ({
                id: part.id,
                stepPath: path.resolve(entry.directory, part.files.step),
                metrics: part.metrics,
              })),
              message: "Build succeeded; design verification was not performed.",
            }
            return {
              title: `Built design: ${args.id}`,
              output: asJson(summary),
              metadata: {
                ok: true,
                exitCode: result.exitCode,
                designDir: result.designDir,
                revision: summary.revision,
                manifestPath: summary.manifestPath,
              },
            }
          },
        }),

        design_view: tool({
          description:
            "Return the companion viewer URL for the design. Open it in a browser to inspect the 3D assembly, click surfaces to get coordinate/normal feedback, and use the Prompt button to send a feedback prompt into the companion agent composer.",
          args: {
            id: tool.schema.string().min(1).describe("Design id to view."),
          },
          async execute(args) {
            if (!(await findDesign(layout, args.id))) throw new Error(`Design not found: ${args.id}`)
            if (!config.companionUrl) {
              const result = {
                reachable: false,
                error: "Studio host unavailable (ensure failed or OPENCODE_STUDIO_AUTOSTART=0). Run opencode serve and open a directory.",
              }
              return { title: "companion unavailable", output: asJson(result), metadata: result }
            }
            const url = `${config.companionUrl}/designs/${encodeURIComponent(args.id)}`
            const result = { url, reachable: await companionReachable(config.companionUrl) }
            return {
              title: url,
              output: asJson(result),
              metadata: result,
            }
          },
        }),

        design_qc_report: tool({
          description:
            "Multi-axis CAD QC report. Artifact status is computed from design_build outputs; printability, fit, and form statuses are supplied from prior build123d_* checks (default unverified). complete is true only when every axis is pass. Never claim design complete without this report.",
          args: {
            id: tool.schema.string().min(1).describe("Design id."),
            printability: tool.schema
              .object({
                status: tool.schema
                  .enum(["pass", "fail", "unverified"] as const)
                  .describe("From build123d_analyze_printability on bed poses."),
                findings: tool.schema.array(tool.schema.string()).optional().describe("Unresolved print findings."),
              })
              .optional(),
            fit: tool.schema
              .object({
                status: tool.schema
                  .enum(["pass", "fail", "unverified"] as const)
                  .describe("From build123d_compare fit/align and motion staging."),
                findings: tool.schema.array(tool.schema.string()).optional().describe("Fit/retention caveats."),
              })
              .optional(),
            form: tool.schema
              .object({
                status: tool.schema
                  .enum(["pass", "fail", "unverified"] as const)
                  .describe("Form fidelity for freeform; use pass + finding 'not applicable' for prismatic designs."),
                findings: tool.schema.array(tool.schema.string()).optional().describe("Station/multi-view evidence notes."),
              })
              .optional(),
          },
          async execute(args) {
            const entry = await findDesign(layout, args.id)
            if (!entry) throw new Error(`Design not found: ${args.id}`)
            const artifact = await readArtifactManifest(entry.directory, args.id)
            const report = await buildDesignQcReport({
              id: args.id,
              entry,
              artifact,
              printability: args.printability as { status: QcAxisStatus; findings?: string[] } | undefined,
              fit: args.fit as { status: QcAxisStatus; findings?: string[] } | undefined,
              form: args.form as { status: QcAxisStatus; findings?: string[] } | undefined,
            })
            return {
              title: report.complete ? `QC pass: ${args.id}` : `QC incomplete: ${args.id}`,
              output: asJson(report),
              metadata: {
                complete: report.complete,
                blockedBy: report.blockedBy,
                buildStatus: report.buildStatus,
                revision: report.revision,
              },
            }
          },
        }),
      },
    }
  }
}

const StudioPlugin = createStudioPlugin()

export default StudioPlugin
