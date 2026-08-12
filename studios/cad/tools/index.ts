import path from "node:path"
import type { Plugin, PluginOptions } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import manifest from "../../../package.json" with { type: "json" }
import { formatToolJson } from "../../../src/core/format-tool-json"
import { createCadSessionTools } from "./session-tools"
import { buildDesign, createCadBuildRunner, type CadBuildRunner, scaffoldDesign } from "../host/build"
import { findDesign, initializeStudio, listRenders, mapArtifactPartFiles, scanDesigns } from "../host/library"
import { artifactRevision, ID_PATTERN, readArtifactManifest, readDesignManifest } from "../host/manifest"
import { buildDesignQcReport, type QcAxisStatus } from "../host/qc-report"
import {
  clearQcEvidenceForDesign,
  qcEvidenceKey,
  qcSessionKey,
  setActiveQcDesign,
} from "../host/qc-evidence"
import {
  designBuildFailureResult,
  designBuildSuccessResult,
  designCreateResult,
  formatCadToolResult,
} from "./result"

const PACKAGE_NAME = `${manifest.name}@${manifest.version}`
const MAX_TOOL_OUTPUT_BYTES = 60_000
const COMPANION_HEALTH_TIMEOUT_MS = 1_000

type Options = {
  studioRoot: string
  engineProjectDir: string
  companionUrl?: string
}

function asJson(value: unknown) {
  return formatToolJson(value, { maxBytes: MAX_TOOL_OUTPUT_BYTES })
}

function truncate(value: string, max = MAX_TOOL_OUTPUT_BYTES) {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n\n[truncated at ${max} bytes]`
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
  const engineProjectDir = resolvePathOption(input?.engineProjectDir, path.resolve(import.meta.dir, "..", "engine"), directory, "engineProjectDir")
  const companionUrl = typeof input?.companionUrl === "string" && input.companionUrl.length > 0 ? input.companionUrl : undefined
  return { studioRoot, engineProjectDir, companionUrl }
}

export type StudioPluginDependencies = {
  buildRunner?: CadBuildRunner
}

export function createStudioPlugin(dependencies: StudioPluginDependencies = {}): Plugin {
  return async (context, rawOptions) => {
    const config = options(rawOptions, context.directory)
    const layout = await initializeStudio(config.studioRoot)
    const buildRunner = dependencies.buildRunner ?? createCadBuildRunner(context.directory)
    const build123dTools = createCadSessionTools({
      engineProjectDir: config.engineProjectDir,
      cwd: context.directory,
    })
    return {
      tool: {
        ...build123dTools,
        cad_design_list: tool({
          description:
            "List CAD designs discovered under the CAD domain root (default studio/designs/). Each entry reports id, build status, and part count.",
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

        cad_design_create: tool({
          description:
            "Scaffold a new CAD design directory with design.json (schema 1), params.py, and parts/. Returns structured JSON {ok, status, summary, data, next}. Use in Phase 0 after deciding the part decomposition. Source files for individual parts are written separately during Phase 1.",
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
              .describe("Initial part list; each part gets a placeholder source that must be modeled before cad_design_build."),
          },
          async execute(args, context) {
            if (!ID_PATTERN.test(args.id)) throw new Error(`Invalid design id: ${args.id}`)
            for (const part of args.parts) {
              if (!ID_PATTERN.test(part.id)) throw new Error(`Invalid part id: ${part.id}`)
            }
            await context.ask({
              permission: "edit",
              patterns: [
                `studio/designs/${args.id}/design.json`,
                `studio/designs/${args.id}/params.py`,
                ...args.parts.map((part) => `studio/designs/${args.id}/${part.source ?? `parts/${part.id.replace(/-/g, "_")}.py`}`),
              ],
              always: [],
              metadata: {},
            })
            setActiveQcDesign(qcSessionKey(config.engineProjectDir, context.directory || ""), args.id)
            const { designDir, manifest } = await scaffoldDesign(
              layout,
              args.id,
              args.parts.map((part) => ({ id: part.id, source: part.source })),
            )
            const envelope = designCreateResult({
              id: args.id,
              designDir,
              parts: manifest.parts,
            })
            return {
              title: designDir,
              output: formatCadToolResult(envelope),
              metadata: {
                ok: true,
                designDir,
                parts: manifest.parts,
              },
            }
          },
        }),

        cad_design_read: tool({
          description:
            "Read the canonical design/build summary, resolved artifact paths with existence checks, metrics, revision, and render inventory. Use after cad_design_build; do not follow it with raw manifest reads or artifact globs.",
          args: {
            id: tool.schema.string().min(1).describe("Design id."),
          },
          async execute(args, context) {
            setActiveQcDesign(qcSessionKey(config.engineProjectDir, context.directory || ""), args.id)
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
                        files: await mapArtifactPartFiles(entry.directory, part.files),
                        metrics: part.metrics,
                      })),
                    ),
                  }
                : null,
              renders: await listRenders(entry.directory),
            })
          },
        }),

        cad_design_build: tool({
          description:
            "Deterministically build a CAD design and validate source plus round-tripped STEP geometry as one valid solid before exporting STEP/STL/GLB and manifest.json. Returns structured JSON {ok, status, summary, data, next, error?}. A failed build preserves the previous output. Build success does not verify assembly or printability. Do not revalidate or remeasure unchanged STEP artifacts solely to repeat build guarantees.",
          args: {
            id: tool.schema.string().min(1).describe("Design id to build."),
          },
          async execute(args, context) {
            const entry = await findDesign(layout, args.id)
            if (!entry) throw new Error(`Design not found: ${args.id}`)
            await context.ask({
              permission: "edit",
              patterns: [
                `studio/designs/${args.id}/step/`,
                `studio/designs/${args.id}/stl/`,
                `studio/designs/${args.id}/glb/`,
                `studio/designs/${args.id}/manifest.json`,
              ],
              always: [],
              metadata: {},
            })
            const result = await buildDesign(
              layout,
              args.id,
              config.engineProjectDir,
              buildRunner,
              context.abort,
              context.directory,
            )
            const sessionKey = qcSessionKey(config.engineProjectDir, context.directory || "")
            setActiveQcDesign(sessionKey, args.id)
            const evidenceKey = qcEvidenceKey(config.engineProjectDir, context.directory || "", args.id)
            if (!result.ok) {
              const envelope = designBuildFailureResult({
                id: args.id,
                exitCode: result.exitCode,
                designDir: result.designDir,
                stdout: truncate(result.stdout),
                stderr: truncate(result.stderr),
              })
              return {
                title: `Design build failed: ${args.id}`,
                output: formatCadToolResult(envelope),
                metadata: { ok: false, exitCode: result.exitCode, designDir: result.designDir, status: "fail" },
              }
            }
            // New artifacts invalidate prior session QC evidence for this runtime key.
            clearQcEvidenceForDesign(sessionKey, args.id)
            const artifact = await readArtifactManifest(entry.directory, args.id)
            if (!artifact || !result.manifestPath) throw new Error(`manifest.json not found after build: ${args.id}`)
            const revision = artifactRevision(artifact)
            const envelope = designBuildSuccessResult({
              id: args.id,
              revision,
              manifestPath: path.resolve(result.manifestPath),
              designDir: result.designDir,
              parts: artifact.parts.map((part) => ({
                id: part.id,
                stepPath: path.resolve(entry.directory, part.files.step),
                metrics: part.metrics,
              })),
            })
            return {
              title: `Built design: ${args.id}`,
              output: formatCadToolResult(envelope),
              metadata: {
                ok: true,
                exitCode: result.exitCode,
                designDir: result.designDir,
                revision: envelope.data?.revision,
                manifestPath: envelope.data?.manifestPath,
                status: "pass",
              },
            }
          },
        }),

        cad_design_view: tool({
          description:
            "Return the companion viewer URL for the design. Open it in a browser to inspect the 3D assembly, click surfaces to get coordinate/normal feedback, and use the Prompt button to send a feedback prompt into the companion agent composer.",
          args: {
            id: tool.schema.string().min(1).describe("Design id to view."),
          },
          async execute(args, context) {
            setActiveQcDesign(qcSessionKey(config.engineProjectDir, context.directory || ""), args.id)
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

        cad_design_qc_report: tool({
          description:
            "Multi-axis CAD QC report (design-scoped evidence). Artifact from cad_design_build. printability pass needs cad_analyze_printability evidence covering parts. fit pass needs cad_compare kind=fit (multi-part) or finding 'not applicable' (single-part). form pass: exact finding 'not applicable' (prismatic) or substantive freeform notes. Bare pass without evidence is rejected. complete only when every axis is pass.",
          args: {
            id: tool.schema.string().min(1).describe("Design id."),
            printability: tool.schema
              .object({
                status: tool.schema
                  .enum(["pass", "fail", "unverified"] as const)
                  .describe("Claim only after cad_analyze_printability; pass needs ledger evidence."),
                findings: tool.schema.array(tool.schema.string()).optional().describe("Unresolved print findings."),
              })
              .optional(),
            fit: tool.schema
              .object({
                status: tool.schema
                  .enum(["pass", "fail", "unverified"] as const)
                  .describe("Multi-part: after cad_compare kind=fit. Single-part: pass + finding 'not applicable'."),
                findings: tool.schema.array(tool.schema.string()).optional().describe("Fit/retention caveats."),
              })
              .optional(),
            form: tool.schema
              .object({
                status: tool.schema
                  .enum(["pass", "fail", "unverified"] as const)
                  .describe("Prismatic: pass + finding 'not applicable'. Freeform: substantive station/view notes."),
                findings: tool.schema.array(tool.schema.string()).optional().describe("Form notes; exact 'not applicable' for prismatic."),
              })
              .optional(),
          },
          async execute(args, context) {
            setActiveQcDesign(qcSessionKey(config.engineProjectDir, context.directory || ""), args.id)
            const entry = await findDesign(layout, args.id)
            if (!entry) throw new Error(`Design not found: ${args.id}`)
            const artifact = await readArtifactManifest(entry.directory, args.id)
            const report = await buildDesignQcReport({
              id: args.id,
              entry,
              artifact,
              evidenceKey: qcEvidenceKey(config.engineProjectDir, context.directory || "", args.id),
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
