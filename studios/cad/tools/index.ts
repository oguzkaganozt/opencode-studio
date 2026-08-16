import { rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type { Plugin, PluginOptions } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import manifest from "../../../package.json" with { type: "json" }
import { formatToolJson } from "../../../src/core/format-tool-json"
import type { SpecRoots } from "../../../src/core/spec"
import { specFilePath } from "../../../src/core/spec"
import { type AcceptanceContract, normalizeAcceptanceContract, readAcceptance } from "../host/acceptance"
import { buildDesign, type CadBuildRunner, createCadBuildRunner, scaffoldDesign } from "../host/build"
import { currentEvidence, latestByKey } from "../host/evidence"
import { applyIrPatch, type CadIrV2, IR_DOCS, type IrPatch, irPathFor, validateIrDocument } from "../host/ir"
import { findDesign, initializeStudio, listRenders, mapArtifactPartFiles, scanDesigns } from "../host/library"
import {
  artifactRevision,
  emptyIrDocument,
  ID_PATTERN,
  readArtifactManifest,
  readDesignManifest,
  sha256File,
  writeDesignManifest,
} from "../host/manifest"
import { buildPrintPlan, readPrintPlan } from "../host/print-plan"
import { buildDesignQcReport } from "../host/qc-report"
import { type CadVerifyKind, runCadVerify } from "../host/verify"
import { publishCadSpec } from "../spec"
import {
  designBuildFailureResult,
  designBuildSuccessResult,
  designCreateResult,
  formatCadToolResult,
  irApplyResult,
  printPlanApplyResult,
  sourceApplyResult,
  verifyResult,
} from "./result"
import { closeAllCadRuntimeSessions, closeCadRuntimeSession, getCadRuntimeSession } from "./session"
import { createCadSessionTools } from "./session-tools"

const PACKAGE_NAME = `${manifest.name}@${manifest.version}`
const MAX_TOOL_OUTPUT_BYTES = 60_000
const COMPANION_HEALTH_TIMEOUT_MS = 1_000
const MAX_DESIGN_QTIES = 8

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
      event: async ({ event }) => {
        if (event.type !== "session.deleted") return
        const info = event.properties.info
        const directory = info.directory
        if (!directory) return
        await closeCadRuntimeSession(config.engineProjectDir, directory, info.id)
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
            "Scaffold a locked CAD design: locked acceptance.json, design.json, params.py, ir/<part>.json drafts, parts/ stubs. New parts default to IR (cad_ir_apply). The parent models every part. acceptance is required: {schema:1, state:'locked', authority, manufacturing, dimensions:[{kind:bbox|hole_diameter|wall|station,...}], interfaces:[...]}. contractHash is computed by the host. parts[].qty: 1 = one body, 2 = one source plus a YZ mirror at build.",
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
                    .describe("How many in the assembly. 2 = one source; build mirrors across YZ."),
                  source: tool.schema
                    .string()
                    .optional()
                    .describe("Optional source path under parts/ (defaults to parts/<id-underscored>.py)"),
                }),
              )
              .min(1)
              .describe("Unique designs with qty. Total qty across parts is capped at 8."),
            params: tool.schema.string().optional().describe("Full params.py body (shared dimensions)."),
            acceptance: tool.schema
              .string()
              .min(1)
              .describe("Locked acceptance contract JSON (schema 1, no contractHash field). The host computes and pins the hash."),
          },
          async execute(args, context) {
            if (!ID_PATTERN.test(args.id)) throw new Error(`Invalid design id: ${args.id}`)
            for (const part of args.parts) {
              if (!ID_PATTERN.test(part.id)) throw new Error(`Invalid part id: ${part.id}`)
            }
            if (args.parts.reduce((sum, part) => sum + part.qty, 0) > MAX_DESIGN_QTIES) {
              throw new Error(`Total qty across parts exceeds ${MAX_DESIGN_QTIES}`)
            }
            let contract: AcceptanceContract
            try {
              contract = normalizeAcceptanceContract(JSON.parse(args.acceptance))
            } catch (error) {
              throw new Error(`Invalid acceptance contract: ${error instanceof Error ? error.message : String(error)}`)
            }
            // Contract artifact refs must be declared parts (or *_mirror for qty 2).
            const declared = new Set<string>()
            for (const part of args.parts) {
              declared.add(part.id)
              if (part.qty === 2) declared.add(`${part.id}_mirror`)
            }
            for (const dim of contract.dimensions) {
              if (!declared.has(dim.artifactId)) {
                throw new Error(`Dimension ${dim.id} references unknown artifact ${dim.artifactId}; declare it in parts`)
              }
            }
            for (const iface of contract.interfaces) {
              if (!declared.has(iface.a) || !declared.has(iface.b)) {
                throw new Error(`Interface ${iface.id} references unknown artifact ${iface.a}/${iface.b}; declare both in parts`)
              }
            }
            const { contractHashOf } = await import("../host/acceptance")
            await context.ask({
              permission: "cad_mutate",
              patterns: [
                `studio/designs/${args.id}/acceptance.json`,
                `studio/designs/${args.id}/acceptance/`,
                `studio/designs/${args.id}/design.json`,
                `studio/designs/${args.id}/params.py`,
                ...args.parts.map((part) => `studio/designs/${args.id}/${part.source ?? `parts/${part.id.replace(/-/g, "_")}.py`}`),
                ...args.parts.map((part) => `studio/designs/${args.id}/ir/${part.id.replace(/-/g, "_")}.json`),
              ],
              always: [],
              metadata: {
                contractHash: contractHashOf(contract),
                dimensions: contract.dimensions.length,
                interfaces: contract.interfaces.length,
                buildVolumeMm: contract.manufacturing.buildVolumeMm,
              },
            })
            const { designDir, manifest, acceptanceFile } = await scaffoldDesign(
              layout,
              args.id,
              args.parts.map((part) => ({ id: part.id, source: part.source, qty: part.qty === 2 ? 2 : 1 })),
              contract,
            )
            if (args.params?.trim())
              await writeFile(path.join(designDir, "params.py"), args.params.endsWith("\n") ? args.params : `${args.params}\n`, "utf8")
            await bindActiveDesign(config.engineProjectDir, context.directory || "", designDir, context.abort, context.sessionID)
            const envelope = designCreateResult({
              id: args.id,
              designDir,
              acceptanceFile,
              parts: manifest.parts,
            })
            return {
              title: designDir,
              output: formatCadToolResult(envelope),
              metadata: {
                ok: true,
                designDir,
                acceptanceFile,
                parts: manifest.parts,
              },
            }
          },
        }),

        cad_design_read: tool({
          description:
            "Without id: list designs. With id: locked contract, source hashes, IR hashes + stale/compile flags, artifact paths, print plan, latest QC evidence, viewer URL.",
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
            const acceptance = await readAcceptance(entry.directory).catch(() => null)
            const printPlan = await readPrintPlan(entry.directory)
            const sources: Record<string, string> = {}
            for (const name of [
              "design.json",
              "params.py",
              ...design.parts.map((part) => part.source),
              ...design.parts.map((part) => part.ir).filter(Boolean),
            ]) {
              if (!name) continue
              try {
                sources[name] = await sha256File(path.join(entry.directory, name))
              } catch {
                // missing file: no hash
              }
            }
            const ir: Record<string, { path: string; hash: string | null; stale: boolean }> = {}
            for (const part of design.parts) {
              if (!part.ir) continue
              const hash = sources[part.ir] ?? null
              const published = artifact?.build.inputs[part.ir]
              ir[part.id] = { path: part.ir, hash, stale: !hash || !published || published !== hash }
            }
            const evidence = artifact
              ? await currentEvidence(entry.directory, artifactRevision(artifact), acceptance?.contractHash ?? "")
              : []
            return asJson({
              id: args.id,
              directory: entry.directory,
              buildStatus: entry.buildStatus,
              revision: entry.revision,
              viewer,
              design,
              acceptance,
              sources,
              ir,
              printPlan: printPlan && printPlan.buildRevision === entry.revision ? printPlan : null,
              evidence: latestByKey(evidence, (record) => record.id),
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
                        bodyHash: part.body_hash ?? null,
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
            "Deterministically build a CAD design in a killable child process and validate source plus round-tripped STEP geometry as one valid solid before exporting STEP/STL/GLB and manifest.json. Returns structured JSON {ok, status, summary, data, next, error?}. A failed build preserves the previous output. Build success does not verify acceptance, printability, or fit. Do not revalidate or remeasure unchanged STEP artifacts solely to repeat build guarantees.",
          args: {
            id: tool.schema.string().min(1).describe("Design id to build."),
          },
          async execute(args, context) {
            const entry = await findDesign(layout, args.id)
            if (!entry) throw new Error(`Design not found: ${args.id}`)
            await context.ask({
              permission: "cad_mutate",
              patterns: [
                `studio/designs/${args.id}/step/`,
                `studio/designs/${args.id}/stl/`,
                `studio/designs/${args.id}/glb/`,
                `studio/designs/${args.id}/topo/`,
                `studio/designs/${args.id}/manifest.json`,
                `studio/designs/${args.id}/.artifacts/`,
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
            const artifact = await readArtifactManifest(entry.directory, args.id)
            if (!artifact || !result.manifestPath) throw new Error(`manifest.json not found after build: ${args.id}`)
            const revision = artifactRevision(artifact)
            const bound: string[] = []
            const bindErrors: string[] = []
            if (!dependencies.buildRunner) {
              await bindActiveDesign(config.engineProjectDir, context?.directory || "", entry.directory, context?.abort, context?.sessionID)
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
                bodyHash: part.body_hash ?? null,
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

        cad_source_apply: tool({
          description:
            "Hand-escape write for params.py or parts/*.py. Prefer cad_ir_apply for new parts. Writing a part source drops that part's IR until cad_ir_apply is used again. base_hash must match the current file.",
          args: {
            id: tool.schema.string().min(1).describe("Design id."),
            part: tool.schema.string().min(1).describe("Part id (or 'params' for params.py)."),
            path: tool.schema.string().min(1).describe("Relative path: params.py or parts/<id>.py exactly as declared."),
            contents: tool.schema.string().describe("Full new file contents."),
            base_hash: tool.schema.string().describe("Expected current SHA-256 of the file being replaced (from cad_design_read sources)."),
          },
          async execute(args, context) {
            const entry = await findDesign(layout, args.id)
            if (!entry) throw new Error(`Design not found: ${args.id}`)
            const design = await readDesignManifest(entry.directory, args.id)
            const normalized = args.path.replaceAll("\\", "/")
            const isParams = args.part === "params"
            const declared = design.parts.find((part) => part.id === args.part)
            const expectedPath = isParams ? "params.py" : declared?.source
            if (isParams ? normalized !== "params.py" : normalized !== expectedPath) {
              throw new Error(
                `cad_source_apply path ${normalized} does not match ${isParams ? "params.py" : `part ${args.part} source ${expectedPath}`}`,
              )
            }
            const target = path.resolve(entry.directory, normalized)
            if (!target.startsWith(entry.directory)) throw new Error("cad_source_apply path escapes the design")
            await context.ask({
              permission: "cad_mutate",
              patterns: [`studio/designs/${args.id}/${normalized}`, `studio/designs/${args.id}/design.json`],
              always: [],
              metadata: {},
            })
            const currentHash = await sha256File(target).catch(() => null)
            if (currentHash !== args.base_hash) {
              throw new Error(`cad_source_apply base_hash mismatch for ${normalized}: file changed since the read hash`)
            }
            const temporary = `${target}.${Math.random().toString(16).slice(2)}.tmp`
            await writeFile(temporary, args.contents.endsWith("\n") ? args.contents : `${args.contents}\n`, "utf8")
            await rename(temporary, target)
            if (!isParams && declared?.ir) {
              const next = {
                ...design,
                parts: design.parts.map((part) => (part.id === args.part ? { id: part.id, source: part.source, qty: part.qty } : part)),
              }
              await writeDesignManifest(entry.directory, next)
            }
            const envelope = sourceApplyResult({ id: args.id, path: normalized, hash: await sha256File(target) })
            return {
              title: `Updated ${normalized}: ${args.id}`,
              output: formatCadToolResult(envelope),
              metadata: { ok: true, path: normalized },
            }
          },
        }),

        cad_ir_docs: tool({
          description: "Frozen CAD IR op list. Nothing else.",
          args: {},
          async execute() {
            return asJson(IR_DOCS)
          },
        }),

        cad_ir_apply: tool({
          description:
            "Write ir/<part>.json for a schema 2 part. Pass document (full CadIrV2) or patch. base_hash is the current IR file SHA-256 from cad_design_read. Build compiles IR to parts/*.py. This is the default write for new parts.",
          args: {
            id: tool.schema.string().min(1).describe("Design id."),
            part: tool.schema.string().min(1).describe("Part id."),
            base_hash: tool.schema.string().describe("Current SHA-256 of ir/<part>.json (empty-scaffold hash on first write)."),
            document: tool.schema.any().optional().describe("Full CadIrV2 document."),
            patch: tool.schema.any().optional().describe("Patch: params/show/ops insert_after|replace|delete."),
          },
          async execute(args, context) {
            if ((args.document === undefined) === (args.patch === undefined)) {
              throw new Error("cad_ir_apply requires exactly one of document or patch")
            }
            const entry = await findDesign(layout, args.id)
            if (!entry) throw new Error(`Design not found: ${args.id}`)
            const design = await readDesignManifest(entry.directory, args.id)
            const declared = design.parts.find((part) => part.id === args.part)
            if (!declared) throw new Error(`Unknown part ${args.part}`)
            const relative = declared.ir ?? irPathFor(args.part)
            const target = path.resolve(entry.directory, relative)
            if (!target.startsWith(entry.directory)) throw new Error("cad_ir_apply path escapes the design")
            await context.ask({
              permission: "cad_mutate",
              patterns: [`studio/designs/${args.id}/${relative}`, `studio/designs/${args.id}/design.json`],
              always: [],
              metadata: {},
            })
            const currentHash = await sha256File(target).catch(async () => {
              await writeFile(target, `${JSON.stringify(emptyIrDocument(args.part), null, 2)}\n`, "utf8")
              return sha256File(target)
            })
            if (currentHash !== args.base_hash) {
              throw new Error(`cad_ir_apply base_hash mismatch for ${relative}: file changed since the read hash`)
            }
            let nextDoc: CadIrV2
            try {
              if (args.document !== undefined) nextDoc = validateIrDocument(args.document)
              else {
                const raw = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(target, "utf8")))
                const loose = raw && typeof raw === "object" ? raw : {}
                nextDoc = applyIrPatch(
                  {
                    part: args.part,
                    params: Array.isArray(loose.params) ? loose.params : [],
                    ops: Array.isArray(loose.ops) ? loose.ops : [],
                    show: typeof loose.show === "string" ? loose.show : "",
                  },
                  args.patch as IrPatch,
                )
              }
            } catch (error) {
              throw new Error(`Invalid IR: ${error instanceof Error ? error.message : String(error)}`)
            }
            if (nextDoc.part !== args.part) throw new Error(`IR part ${nextDoc.part} does not match ${args.part}`)
            const temporary = `${target}.${Math.random().toString(16).slice(2)}.tmp`
            await writeFile(temporary, `${JSON.stringify(nextDoc, null, 2)}\n`, "utf8")
            await rename(temporary, target)
            if (!declared.ir) {
              await writeDesignManifest(entry.directory, {
                ...design,
                parts: design.parts.map((part) => (part.id === args.part ? { ...part, ir: relative } : part)),
              })
            }
            const envelope = irApplyResult({ id: args.id, part: args.part, path: relative, hash: await sha256File(target) })
            return {
              title: `Updated ${relative}: ${args.id}`,
              output: formatCadToolResult(envelope),
              metadata: { ok: true, path: relative },
            }
          },
        }),

        cad_print_plan_apply: tool({
          description:
            "Lock a print plan for the current build: one entry per final artifact (mirrors included). Host fills bodyHash and posed bounds, then checks bed contact (minZ within bed tolerance) and build-volume fit. print-plan.json is written with the current buildRevision. Required before cad_verify kind=printability.",
          args: {
            id: tool.schema.string().min(1).describe("Design id."),
            entries: tool.schema
              .array(
                tool.schema.object({
                  artifactId: tool.schema.string().min(1).describe("Final artifact id, including *_mirror."),
                  rotateDeg: tool.schema
                    .array(tool.schema.number())
                    .length(3)
                    .describe("Rotation in degrees about world X, Y, Z in that order."),
                  translateMm: tool.schema.array(tool.schema.number()).length(3).describe("Translation in mm."),
                }),
              )
              .min(1)
              .describe("Exactly one entry per final artifact."),
          },
          async execute(args, context) {
            const entry = await findDesign(layout, args.id)
            if (!entry) throw new Error(`Design not found: ${args.id}`)
            const artifact = await readArtifactManifest(entry.directory, args.id)
            if (!artifact) throw new Error(`Design ${args.id} has no built artifacts; run cad_design_build first`)
            const acceptance = await readAcceptance(entry.directory)
            const requested = args.entries.map((entryArg) => ({
              artifactId: entryArg.artifactId,
              rotateDeg: entryArg.rotateDeg as [number, number, number],
              translateMm: entryArg.translateMm as [number, number, number],
            }))
            await context.ask({
              permission: "cad_mutate",
              patterns: [`studio/designs/${args.id}/print-plan.json`],
              always: [],
              metadata: {},
            })
            const plan = buildPrintPlan({ id: args.id, artifact, acceptance, entries: requested })
            const { writePrintPlan } = await import("../host/print-plan")
            await writePrintPlan(entry.directory, plan)
            const envelope = printPlanApplyResult({ id: args.id, plan })
            return {
              title: `Print plan locked: ${args.id}`,
              output: formatCadToolResult(envelope),
              metadata: { ok: true, entries: plan.entries.length },
            }
          },
        }),

        cad_verify: tool({
          description:
            "Verify a design axis against the locked contract using the exact built STEP bodies, and write disk evidence records bound to the current buildRevision and contractHash. kind=requirements: bbox, hole_diameter, wall, and station. kind=printability: posed print plan + profile. kind=interfaces: declared pair fits. Rebuild or contract change makes records stale.",
          args: {
            id: tool.schema.string().min(1).describe("Design id."),
            kind: tool.schema
              .enum(["requirements", "printability", "interfaces"] as const)
              .describe("Axis to verify against the locked acceptance contract."),
          },
          async execute(args, context) {
            const entry = await findDesign(layout, args.id)
            if (!entry) throw new Error(`Design not found: ${args.id}`)
            const artifact = await readArtifactManifest(entry.directory, args.id)
            if (!artifact) throw new Error(`Design ${args.id} has no built artifacts; run cad_design_build first`)
            const acceptance = await readAcceptance(entry.directory)
            await context.ask({
              permission: "cad_mutate",
              patterns: [`studio/designs/${args.id}/evidence/`],
              always: [],
              metadata: {},
            })
            const { records } = await runCadVerify({
              designDir: entry.directory,
              id: args.id,
              engineProjectDir: config.engineProjectDir,
              cwd: context.directory || "",
              sessionID: context.sessionID,
              artifact,
              acceptance,
              kind: args.kind as CadVerifyKind,
              signal: context.abort,
            })
            const envelope = verifyResult({ id: args.id, kind: args.kind, records })
            return {
              title: `Verified ${args.kind}: ${args.id}`,
              output: formatCadToolResult(envelope),
              metadata: { ok: true, kind: args.kind, records: records.length },
            }
          },
        }),

        cad_design_qc_report: tool({
          description:
            "Claim-free CAD QC report from disk evidence bound to the current buildRevision and contractHash: artifact, requirements (bbox/hole/wall/station), manufacturing, interfaces, findings. Takes no status fields. Writes SPEC.json when complete.",
          args: {
            id: tool.schema.string().min(1).describe("Design id."),
          },
          async execute(args, context) {
            const entry = await findDesign(layout, args.id)
            if (!entry) throw new Error(`Design not found: ${args.id}`)
            const artifact = await readArtifactManifest(entry.directory, args.id)
            const report = await buildDesignQcReport({
              id: args.id,
              entry,
              artifact,
              designDir: entry.directory,
            })
            let specPath: string | undefined
            let specError: string | undefined
            if (report.complete) {
              try {
                await publishCadSpec(config.specRoots ?? { cad: layout.root, pcb: layout.root, fw: layout.root }, args.id, {
                  revision: report.revision ?? undefined,
                  contractHash: report.contractHash ?? undefined,
                })
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
                contractHash: report.contractHash,
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
