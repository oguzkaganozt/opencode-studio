import { writeFile } from "node:fs/promises"
import path from "node:path"
import type { Plugin, PluginOptions } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import manifest from "../../../package.json" with { type: "json" }
import { formatToolJson } from "../../../src/core/format-tool-json"
import type { SpecRoots } from "../../../src/core/spec"
import { specFilePath } from "../../../src/core/spec"
import { buildDesign, type CadBuildRunner, createCadBuildRunner, scaffoldDesign } from "../host/build"
import { type CadPartDispatcher, createClientDispatcher, readPartSourceStatus, spawnCadParts } from "../host/dispatch"
import { findDesign, initializeStudio, listRenders, mapArtifactPartFiles, scanDesigns } from "../host/library"
import { artifactRevision, ID_PATTERN, readArtifactManifest, readDesignManifest } from "../host/manifest"
import { clearQcEvidenceForDesign, clearQcSession, qcEvidenceKey, qcSessionKey, setActiveQcDesign } from "../host/qc-evidence"
import { buildDesignQcReport, type QcAxisStatus } from "../host/qc-report"
import { publishCadSpec } from "../spec"
import { designBuildFailureResult, designBuildSuccessResult, designCreateResult, formatCadToolResult } from "./result"
import { closeAllCadRuntimeSessions, closeCadRuntimeSession, getCadRuntimeSession } from "./session"
import { createCadSessionTools } from "./session-tools"

const PACKAGE_NAME = `${manifest.name}@${manifest.version}`
const MAX_TOOL_OUTPUT_BYTES = 60_000
const COMPANION_HEALTH_TIMEOUT_MS = 1_000

type Options = {
  studioRoot: string
  engineProjectDir: string
  companionUrl?: string
  specRoots?: SpecRoots
}

function asJson(value: unknown) {
  return formatToolJson(value, { maxBytes: MAX_TOOL_OUTPUT_BYTES })
}

function truncate(value: string, max = MAX_TOOL_OUTPUT_BYTES) {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n\n[truncated at ${max} bytes]`
}

/** Bind design_dir into the CAD execute session so params.py is available (best-effort). */
async function bindActiveDesign(engineProjectDir: string, cwd: string, designDir: string, signal?: AbortSignal, sessionID?: string) {
  try {
    await getCadRuntimeSession(engineProjectDir, cwd, sessionID).callTool(
      "bind_design",
      { design_dir: designDir },
      { signal, resetSessionOnFailure: false },
    )
  } catch {
    /* session may not be up yet; first execute/build will bind again */
  }
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
  const engineProjectDir = resolvePathOption(
    input?.engineProjectDir,
    path.resolve(import.meta.dir, "..", "engine"),
    directory,
    "engineProjectDir",
  )
  const companionUrl = typeof input?.companionUrl === "string" && input.companionUrl.length > 0 ? input.companionUrl : undefined
  const specRoots = input?.specRoots as SpecRoots | undefined
  return { studioRoot, engineProjectDir, companionUrl, specRoots }
}

export type StudioPluginDependencies = {
  buildRunner?: CadBuildRunner
  dispatcher?: CadPartDispatcher
}

export function createStudioPlugin(dependencies: StudioPluginDependencies = {}): Plugin {
  return async (context, rawOptions) => {
    const config = options(rawOptions, context.directory)
    const layout = await initializeStudio(config.studioRoot)
    const buildRunner = dependencies.buildRunner ?? createCadBuildRunner(context.directory)
    const dispatcher = dependencies.dispatcher ?? createClientDispatcher(context.client)
    const build123dTools = createCadSessionTools({
      engineProjectDir: config.engineProjectDir,
      cwd: context.directory,
    })
    return {
      event: async ({ event }) => {
        if (event.type !== "session.deleted") return
        const info = event.properties.info
        const directory = info.directory
        if (!directory) return
        await closeCadRuntimeSession(config.engineProjectDir, directory, info.id)
        if (!info.parentID) clearQcSession(qcSessionKey(config.engineProjectDir, directory))
      },

      dispose: async () => {
        // Runtime children are detached; on host shutdown they would outlive
        // this process. Close everything this module spawned.
        await closeAllCadRuntimeSessions()
      },

      tool: {
        ...build123dTools,

        cad_design_create: tool({
          description:
            "Scaffold a CAD design (design.json, params.py, parts/). parts[].qty is required: 1 = one body, 2 = one worker plus a YZ mirror at build. Two or more unique ids spawn cad-part workers. Pass params and a short brief. Then cad_design_join and cad_design_build.",
          args: {
            id: tool.schema.string().min(1).describe("Lowercase design id matching ^[a-z0-9][a-z0-9_-]*$"),
            parts: tool.schema
              .array(
                tool.schema.object({
                  id: tool.schema.string().min(1).describe("Unique printable design (side_trim, not left+right ids)."),
                  qty: tool.schema
                    .number()
                    .int()
                    .min(1)
                    .max(2)
                    .describe("How many in the assembly. 2 = one worker; build mirrors across YZ."),
                  source: tool.schema
                    .string()
                    .optional()
                    .describe("Optional source path under parts/ (defaults to parts/<id-underscored>.py)"),
                }),
              )
              .min(1)
              .describe("Unique designs with qty. Two or more ids spawn cad-part workers."),
            params: tool.schema.string().optional().describe("Full params.py body (shared dimensions). Required for useful workers."),
            brief: tool.schema.string().optional().describe("One or two sentences of product intent forwarded to workers."),
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
              args.parts.map((part) => ({ id: part.id, source: part.source, qty: part.qty === 2 ? 2 : 1 })),
            )
            if (args.params?.trim())
              await writeFile(path.join(designDir, "params.py"), args.params.endsWith("\n") ? args.params : `${args.params}\n`, "utf8")
            await bindActiveDesign(config.engineProjectDir, context.directory || "", designDir, context.abort, context.sessionID)
            const dispatch = await spawnCadParts({
              designId: args.id,
              designDir,
              parts: manifest.parts,
              dispatcher,
              directory: context.directory || context.worktree,
              parentSessionID: context.sessionID,
              brief: args.brief,
              params: args.params,
            })
            const envelope = designCreateResult({
              id: args.id,
              designDir,
              parts: manifest.parts,
              dispatch,
            })
            return {
              title: designDir,
              output: formatCadToolResult(envelope),
              metadata: {
                ok: true,
                designDir,
                parts: manifest.parts,
                dispatch,
              },
            }
          },
        }),

        cad_design_read: tool({
          description:
            "Without id: list designs (id, build status, part count). With id: design/build summary, artifact paths, renders, and companion viewer URL. Do not follow with raw manifest reads.",
          args: {
            id: tool.schema.string().min(1).optional().describe("Design id. Omit to list designs."),
          },
          async execute(args, context) {
            if (!args.id) {
              const designs = await scanDesigns(layout)
              return asJson({
                designs: designs.map((entry) => ({
                  id: entry.id,
                  buildStatus: entry.buildStatus,
                  partCount: entry.partCount,
                  revision: entry.revision,
                })),
              })
            }
            setActiveQcDesign(qcSessionKey(config.engineProjectDir, context.directory || ""), args.id)
            const entry = await findDesign(layout, args.id)
            if (!entry) throw new Error(`Design not found: ${args.id}`)
            await bindActiveDesign(config.engineProjectDir, context.directory || "", entry.directory, context.abort, context.sessionID)
            const design = await readDesignManifest(entry.directory, args.id)
            const artifact = await readArtifactManifest(entry.directory, args.id)
            const manifestPath = path.join(entry.directory, "manifest.json")
            const viewer =
              config.companionUrl != null
                ? {
                    url: `${config.companionUrl}/designs/${encodeURIComponent(args.id)}`,
                    reachable: await companionReachable(config.companionUrl),
                  }
                : { url: null, reachable: false }
            return asJson({
              id: args.id,
              directory: entry.directory,
              buildStatus: entry.buildStatus,
              revision: entry.revision,
              viewer,
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
              context.sessionID,
            )
            const sessionKey = qcSessionKey(config.engineProjectDir, context.directory || "")
            setActiveQcDesign(sessionKey, args.id)
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
            const bound: string[] = []
            const bindErrors: string[] = []
            if (!dependencies.buildRunner) {
              await bindActiveDesign(config.engineProjectDir, context.directory || "", entry.directory, context.abort, context.sessionID)
              const runtime = getCadRuntimeSession(config.engineProjectDir, context.directory || "", context.sessionID)
              for (const part of artifact.parts) {
                const stepPath = path.resolve(entry.directory, part.files.step)
                const name = part.id.replace(/-/g, "_")
                const imported = await runtime.callTool("import_cad_file", { path: stepPath, name }, { signal: context.abort })
                if (imported.isError) bindErrors.push(`${part.id}: ${imported.text || "import failed"}`)
                else bound.push(name)
              }
            }
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
              bound,
              bindErrors,
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

        cad_design_join: tool({
          description:
            "Check whether cad-part sources are no longer stubs. Call after create spawned workers, before cad_design_build. Does not build or fit.",
          args: {
            id: tool.schema.string().min(1).describe("Design id to join."),
          },
          async execute(args) {
            const entry = await findDesign(layout, args.id)
            if (!entry) throw new Error(`Design not found: ${args.id}`)
            const design = await readDesignManifest(entry.directory, args.id)
            const parts = await Promise.all(
              design.parts.map(async (part) => ({
                partId: part.id,
                ...(await readPartSourceStatus(entry.directory, part.source)),
              })),
            )
            const ready = parts.filter((part) => part.ready).map((part) => part.partId)
            const pending = parts.filter((part) => !part.ready).map((part) => part.partId)
            return asJson({
              ok: pending.length === 0,
              id: args.id,
              ready,
              pending,
              next: pending.length === 0 ? ["cad_design_build"] : ["Wait for workers or model pending parts", "cad_design_join"],
            })
          },
        }),

        cad_design_qc_report: tool({
          description:
            "Multi-axis CAD QC report (design-scoped evidence). Artifact from cad_design_build. printability pass needs cad_analyze_printability evidence covering parts. fit pass needs cad_compare kind=fit (multi-part) or finding 'not applicable' (single-part). form pass: exact finding 'not applicable' (prismatic) or cad_analyze_form pass (contract match). Bare pass without evidence is rejected. complete only when every axis is pass. Writes SPEC.json when complete.",
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
                  .describe("Prismatic: pass + finding 'not applicable'. Freeform: after cad_analyze_form contract pass."),
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
            let specPath: string | undefined
            let specError: string | undefined
            if (report.complete) {
              try {
                await publishCadSpec(config.specRoots ?? { cad: layout.root, pcb: layout.root, fw: layout.root }, args.id)
                specPath = specFilePath(entry.directory)
              } catch (error) {
                specError = error instanceof Error ? error.message : String(error)
              }
            }
            return {
              title: report.complete ? `QC pass: ${args.id}` : `QC incomplete: ${args.id}`,
              output: asJson({ ...report, specPath, specError }),
              metadata: {
                complete: report.complete,
                blockedBy: report.blockedBy,
                buildStatus: report.buildStatus,
                revision: report.revision,
                specPath,
                specError,
              },
            }
          },
        }),
      },
    }
  }
}
