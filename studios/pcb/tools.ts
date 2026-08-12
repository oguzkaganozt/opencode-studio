import { readFile } from "node:fs/promises"
import path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { formatToolJson } from "../../src/core/format-tool-json"
import { canonicalExistingDirectory } from "../../src/core/paths"
import { toCplCsv } from "./assembly"
import {
  filterCatalogParts,
  findCatalogPart,
  inspectCatalog,
  loadCatalogParts,
  partDetail,
  partSummary,
  spiceModelSnippet,
  upsertCatalogPart,
} from "./catalog"
import { inspectCircuitJson, queryCircuitJson, readCircuitJson } from "./circuit-json"
import { projectCircuitReadiness } from "./readiness"
import { installProjectDeps, scaffoldProject } from "./scaffold"
import { exportCircuit, runProjectBuild, searchComponents, simulateAnalogCircuit, SIMULATION_ESTIMATE_CAVEAT } from "./tsci"
import { discoverProjects, encodeProjectId, projectSummary, resolveProject } from "./workspace"

async function canonicalWorkspaceRoot(rawPath: string): Promise<string> {
  if (!path.isAbsolute(rawPath)) throw new Error(`workspaceRoot must be an absolute path: ${rawPath}`)
  try {
    return await canonicalExistingDirectory(rawPath, "workspaceRoot")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("does not exist")) throw new Error(`workspaceRoot does not exist: ${rawPath}`)
    if (message.includes("not a directory")) throw new Error(`workspaceRoot is not a directory: ${rawPath}`)
    throw new Error(message)
  }
}

async function readProjectSvg(
  workspaceRoot: string,
  projectId: string,
  kind: "schematic" | "pcb",
): Promise<{
  title: string
  output: string
  metadata: { projectId: string; name: string; path: string; bytes: number }
  attachments: Array<{ type: "file"; mime: string; filename: string; url: string }>
}> {
  const project = await resolveProject(workspaceRoot, projectId)
  const svgPath = kind === "schematic" ? project.schematicSvgPath : project.pcbSvgPath
  const label = kind === "schematic" ? "schematic" : "pcb"
  const missing =
    kind === "schematic"
      ? `Schematic SVG not found for project '${project.name}'. Run pcb_circuit_export with format 'schematic'.`
      : `PCB SVG not found for project '${project.name}'. Run pcb_circuit_export with format 'pcb'.`
  if (project.artifactError) throw new Error(project.artifactError)
  if (!svgPath) throw new Error(missing)
  const svg = await readFile(svgPath, "utf8")
  return {
    title: `${project.name} — ${label}`,
    output: `${kind === "schematic" ? "Schematic" : "PCB layout"} SVG for ${project.name} (${svgPath})`,
    metadata: { projectId, name: project.name, path: svgPath, bytes: svg.length },
    attachments: [
      {
        type: "file" as const,
        mime: "image/svg+xml",
        filename: `${label}.svg`,
        url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
      },
    ],
  }
}

export function createPcbStudioPlugin(options?: { workspaceRoot?: string }): Plugin {
  return async (context) => {
    const workspaceRoot = await canonicalWorkspaceRoot(options?.workspaceRoot ?? context.directory)

    return {
      tool: {
        // ── Workspace discovery ───────────────────────────────────────────────
        pcb_workspace_list: tool({
          description:
            "List all tscircuit circuit projects discovered in the PCB workspace. Returns project IDs, artifact status, and Circuit JSON design health for built projects.",
          args: {},
          async execute() {
            const projects = await discoverProjects(workspaceRoot)
            return formatToolJson({
              workspaceRoot,
              projects: projects.map(projectSummary),
              total: projects.length,
            })
          },
        }),

        // ── Project scaffolding ───────────────────────────────────────────────
        pcb_project_create: tool({
          description:
            "Create a new minimal tscircuit project (package.json, tsconfig.json, src/circuit.tsx with a starter circuit) inside the workspace. Installs dependencies unless install=false. After creation, edit src/circuit.tsx, then use pcb_circuit_build and pcb_circuit_export to produce outputs.",
          args: {
            name: tool.schema.string().describe("Project name: lowercase letters, digits, dashes (e.g. 'motor-driver-rev-a')"),
            directory: tool.schema
              .string()
              .optional()
              .describe("Workspace-relative directory to create the project in (defaults to the project name)"),
            install: tool.schema.boolean().optional().describe("Run npm install after scaffolding (default true)"),
          },
          async execute(args, ctx) {
            const result = await scaffoldProject(workspaceRoot, args.name, args.directory)
            const projectId = encodeProjectId(result.relativePath)

            if (args.install === false) {
              return formatToolJson({
                ...result,
                projectId,
                install: "skipped",
                nextSteps: ["Run npm install in the project directory", `Run pcb_circuit_build with projectId '${projectId}'`],
              })
            }

            const install = await installProjectDeps(result.absolutePath, ctx.abort)
            if (!install.success) {
              return formatToolJson({
                ...result,
                projectId,
                install: { success: false, exitCode: install.exitCode, stderr: install.stderr.slice(0, 4000) },
                nextSteps: ["Fix the npm install failure, then run pcb_circuit_build"],
              })
            }

            return formatToolJson({
              ...result,
              projectId,
              install: { success: true },
              nextSteps: [
                "Edit src/circuit.tsx to design the circuit",
                `Run pcb_circuit_build with projectId '${projectId}'`,
                "Run pcb_circuit_export with formats ['schematic', 'pcb', 'gerber'] to generate outputs",
              ],
            })
          },
        }),

        // ── Catalog ───────────────────────────────────────────────────────────
        pcb_catalog_list: tool({
          description:
            "Inspect the optional workspace-local PCB part catalog and list matching parts. Distinguishes a missing directory, empty catalog, malformed/skipped files, and a populated catalog with no query matches.",
          args: {
            query: tool.schema.string().optional().describe("Case-insensitive substring filter applied across all fields"),
          },
          async execute(args) {
            const catalog = await inspectCatalog(workspaceRoot)
            const filtered = filterCatalogParts(catalog.parts, args.query)
            return formatToolJson({
              available: catalog.available,
              scope: catalog.scope,
              catalogPath: catalog.catalogPath,
              reason: catalog.reason ?? (args.query && filtered.length === 0 ? "no_matches" : null),
              malformedCount: catalog.malformedCount,
              skippedCount: catalog.skippedCount,
              parts: filtered.map(partSummary),
              total: filtered.length,
            })
          },
        }),

        pcb_catalog_get: tool({
          description: "Get a part by exact MPN from the optional workspace-local catalog, including catalog availability state.",
          args: {
            mpn: tool.schema.string().describe("Manufacturer part number, e.g. ESP32-S3-WROOM-1-N8R8"),
          },
          async execute(args) {
            const catalog = await inspectCatalog(workspaceRoot)
            const part = findCatalogPart(catalog.parts, args.mpn)
            return formatToolJson({
              available: catalog.available,
              scope: catalog.scope,
              catalogPath: catalog.catalogPath,
              reason: part ? null : (catalog.reason ?? "part_not_found"),
              malformedCount: catalog.malformedCount,
              skippedCount: catalog.skippedCount,
              part: part ? partDetail(part) : null,
            })
          },
        }),

        pcb_catalog_upsert: tool({
          description:
            "Write or merge a verified part into the workspace-local catalog at catalog/parts/<mpn>.yaml. Use only after an exact MPN is confirmed (circuit identity, JLCPCB/tsci match, or datasheet). Creates the catalog directory if missing. Does not invent footprints or approve unverified substitutes.",
          args: {
            mpn: tool.schema.string().min(1).describe("Exact manufacturer part number, e.g. ESP32-S3-WROOM-1-N16R8"),
            manufacturer: tool.schema.string().optional().describe("Manufacturer name"),
            description: tool.schema.string().optional().describe("Short part description"),
            datasheet: tool.schema.string().optional().describe("https datasheet URL"),
            category: tool.schema.string().optional().describe("Category label, e.g. MCU module"),
            replace: tool.schema.boolean().optional().describe("Replace existing file fields instead of merging (default false)"),
          },
          async execute(args) {
            const result = await upsertCatalogPart(workspaceRoot, {
              mpn: args.mpn,
              manufacturer: args.manufacturer,
              description: args.description,
              datasheet: args.datasheet,
              category: args.category,
              replace: args.replace === true,
            })
            if (!result.ok) {
              return formatToolJson({ success: false, error: result.error, code: result.code })
            }
            return formatToolJson({
              success: true,
              created: result.created,
              path: result.path,
              part: partSummary(result.part),
            })
          },
        }),

        pcb_spice_model_get: tool({
          description:
            "Get the verified SPICE model for an exact catalog MPN. Returns the self-contained model source, provenance, pin mapping, SHA-256, and a tscircuit <spicemodel> snippet. Does not modify circuit source.",
          args: {
            mpn: tool.schema.string().min(1).describe("Exact catalog MPN"),
          },
          async execute(args) {
            const catalog = await inspectCatalog(workspaceRoot)
            const part = findCatalogPart(catalog.parts, args.mpn)
            if (!part) return formatToolJson({ success: false, reason: "part_not_found", mpn: args.mpn })
            if (!part.spiceModel) return formatToolJson({ success: false, reason: "spice_model_missing", mpn: part.mpn })
            return formatToolJson({
              success: true,
              mpn: part.mpn,
              model: part.spiceModel,
              tscircuitSnippet: spiceModelSnippet(part),
            })
          },
        }),

        pcb_spice_model_upsert: tool({
          description:
            "Attach or replace a verified, self-contained SPICE model on an exact catalog MPN. Sources may retain helper .SUBCKT blocks, but the top-level subcircuit must be selected explicitly when more than one exists. Requires a credential-free HTTPS provenance URL and a complete one-to-one selected-model-pin to tscircuit-pin mapping. Rejects .include/.lib/control/shell directives; never invent or auto-select a model.",
          args: {
            mpn: tool.schema.string().min(1).describe("Exact catalog MPN; the part must already exist in the workspace catalog"),
            source: tool.schema.string().min(1).describe("Self-contained SPICE source containing valid .SUBCKT blocks with matching .ENDS"),
            sourceUrl: tool.schema.string().url().describe("Official credential-free HTTPS URL where the model was obtained"),
            subcircuit: tool.schema
              .string()
              .optional()
              .describe("Top-level .SUBCKT name; required when source contains multiple subcircuits"),
            pinMapping: tool.schema
              .record(tool.schema.string(), tool.schema.string())
              .describe("Complete map from every selected top-level .SUBCKT pin name/number to a tscircuit chip pin/alias"),
          },
          async execute(args) {
            const catalog = await inspectCatalog(workspaceRoot)
            const part = findCatalogPart(catalog.parts, args.mpn)
            if (!part) return formatToolJson({ success: false, reason: "part_not_found", mpn: args.mpn })
            const result = await upsertCatalogPart(workspaceRoot, {
              mpn: part.mpn,
              spiceModel: {
                source: args.source,
                sourceUrl: args.sourceUrl,
                subcircuit: args.subcircuit,
                pinMapping: args.pinMapping,
              },
            })
            if (!result.ok) return formatToolJson({ success: false, error: result.error, code: result.code })
            return formatToolJson({
              success: true,
              created: result.created,
              path: result.path,
              part: partDetail(result.part),
              tscircuitSnippet: spiceModelSnippet(result.part),
            })
          },
        }),

        pcb_component_search: tool({
          description:
            "Search JLCPCB, the tscircuit registry, and KiCad through separate official tsci CLI searches before using a generic footprint for a named complex part. Exact matches are first. JLCPCB packageDescription is metadata, not a usable tscircuit footprint; only tscircuit usageInstructions or a KiCad footprint identify an implementation candidate. A zero-result descriptive query is retried once with its focused part token. Results are candidates, not workspace approval. If no exact MPN and footprint match exists, use a PCB_STUDIO_PLACEHOLDER instead of inventing a substitute.",
          args: {
            query: tool.schema.string().min(1).describe("Exact MPN or focused component query, e.g. 'ESP32-S3-WROOM-1-N8R8' or 'BME280'"),
            source: tool.schema.enum(["all", "jlcpcb", "tscircuit", "kicad"]).optional().describe("Search source (default 'all')"),
          },
          async execute(args, ctx) {
            const result = await searchComponents(args.query, args.source ?? "all", ctx.abort)
            return formatToolJson({
              query: result.query,
              resolvedQuery: result.resolvedQuery,
              attemptedQueries: result.attemptedQueries,
              fallbackUsed: result.fallbackUsed,
              source: result.scope,
              success: result.success,
              processSuccess: result.processSuccess,
              exitCode: result.exitCode,
              results: result.results,
              total: result.results.length,
              stdout: result.success ? undefined : result.stdout.slice(0, 8000),
              stderr: result.stderr.slice(0, 4000),
            })
          },
        }),

        // ── Build & export ────────────────────────────────────────────────────
        pcb_circuit_build: tool({
          description:
            "Build and validate a tscircuit project. success requires both a successful process and designValid=true. Returns separate fabricationReady and assemblyReady states plus compact blockers.",
          args: {
            projectId: tool.schema.string().describe("Project ID from pcb_workspace_list"),
          },
          async execute(args, ctx) {
            const project = await resolveProject(workspaceRoot, args.projectId)
            const result = await runProjectBuild(project.absolutePath, ctx.abort)
            const circuit = result.artifacts.circuitJsonPath ? await readCircuitJson(workspaceRoot, result.artifacts.circuitJsonPath) : null
            const readiness = circuit
              ? await projectCircuitReadiness(project.absolutePath, circuit, { inspection: result.inspection ?? undefined })
              : { fabricationReady: false, assemblyReady: false, manufacturingBlockers: [] as const, assemblyBlockers: [] as const }
            const fabricationReady = result.inspection !== null && readiness.fabricationReady
            return formatToolJson({
              projectId: args.projectId,
              name: project.name,
              success: result.success,
              processSuccess: result.processSuccess,
              exitCode: result.exitCode,
              designValid: result.inspection?.designValid ?? null,
              fabricationReady,
              assemblyReady: fabricationReady && readiness.assemblyReady,
              debugOnly: result.inspection ? !result.inspection.designValid : false,
              manufacturingBlockers: readiness.manufacturingBlockers,
              assemblyBlockers: readiness.assemblyBlockers,
              diagnostics: result.inspection,
              artifacts: result.artifacts,
              stdout: result.stdout.slice(0, 8000),
              stderr: result.stderr.slice(0, 4000),
            })
          },
        }),

        // ── Simulation ───────────────────────────────────────────────────────
        pcb_sim_run: tool({
          description:
            'Run the analog simulation declared by <analogsimulation> and probe elements in src/circuit.tsx. Returns named numeric time-series data and summaries for agent inspection. Simulation success is independent of designValid, fabricationReady, and assemblyReady. Missing models or invalid topology are returned as simulation diagnostics. Results are directional estimates, not engineering-grade. Declare <analogsimulation spiceEngine="ngspice" ... /> for the ngspice engine; the default spicey engine only emits voltage probes, so current probes require ngspice and may otherwise report empty series.',
          args: {
            projectId: tool.schema.string().describe("Project ID from pcb_workspace_list"),
            maxPoints: tool.schema
              .number()
              .int()
              .min(2)
              .max(2000)
              .optional()
              .describe(
                "Requested maximum points per series (default 500; endpoints preserved; total output is also budgeted across probes)",
              ),
          },
          async execute(args, ctx) {
            const project = await resolveProject(workspaceRoot, args.projectId)
            const result = await simulateAnalogCircuit(project.absolutePath, ctx.abort, args.maxPoints)
            return formatToolJson({
              projectId: args.projectId,
              name: project.name,
              success: result.success,
              simulationSuccess: result.success,
              processSuccess: result.processSuccess,
              exitCode: result.exitCode,
              experiments: result.experiments,
              caveat: SIMULATION_ESTIMATE_CAVEAT,
              diagnostics:
                result.diagnostics.length > 0
                  ? result.diagnostics
                  : result.success
                    ? undefined
                    : result.stderr || result.stdout.slice(0, 8000),
            })
          },
        }),

        pcb_circuit_export: tool({
          description:
            "Export a freshly built tscircuit project. Schematic and PCB SVGs remain available for debugging. Gerber export is blocked by Circuit errors, PCB_STUDIO_PLACEHOLDER notes, unverified part identities, supplier footprint mismatches, or pins that are neither connected nor explicitly noConnect.",
          args: {
            projectId: tool.schema.string().describe("Project ID from pcb_workspace_list"),
            formats: tool.schema
              .array(tool.schema.enum(["schematic", "pcb", "gerber"]))
              .min(1)
              .describe("Export formats to generate"),
          },
          async execute(args, ctx) {
            const project = await resolveProject(workspaceRoot, args.projectId)
            const formats = args.formats as Array<"schematic" | "pcb" | "gerber">
            const result = await exportCircuit(project.absolutePath, formats, ctx.abort)
            const circuit = result.artifacts.circuitJsonPath ? await readCircuitJson(workspaceRoot, result.artifacts.circuitJsonPath) : null
            const readiness = await projectCircuitReadiness(project.absolutePath, circuit ?? [])
            const fabricationReady = result.manufacturingBlockers.length === 0
            const assemblyReady = fabricationReady && readiness.assemblyReady === true
            return formatToolJson({
              projectId: args.projectId,
              name: project.name,
              success: result.success,
              processSuccess: result.processSuccess,
              artifactGenerationSucceeded: result.artifactGenerationSucceeded,
              exitCode: result.exitCode,
              designValid: result.designValid,
              fabricationReady,
              assemblyReady,
              debugOnly: result.debugOnly,
              generatedFormats: result.generatedFormats,
              blockedFormats: result.blockedFormats,
              manufacturingBlockers: result.manufacturingBlockers,
              assemblyBlockers: readiness.assemblyBlockers,
              diagnostics: result.inspection,
              artifacts: result.artifacts,
              stdout: result.stdout.slice(0, 8000),
              stderr: result.stderr.slice(0, 4000),
            })
          },
        }),

        // ── BOM ────────────────────────────────────────────────────────────────
        pcb_bom_generate: tool({
          description:
            "Generate a Bill of Materials from a built project's Circuit JSON. Groups components by manufacturer or supplier part numbers, cross-references catalog MPNs for metadata, and reports components without either identity separately.",
          args: {
            projectId: tool.schema.string().describe("Project ID from pcb_workspace_list"),
          },
          async execute(args) {
            const project = await resolveProject(workspaceRoot, args.projectId)
            if (!project.circuitJsonPath) {
              throw new Error(project.artifactError ?? `Circuit JSON not found for project '${project.name}'. Run pcb_circuit_build first.`)
            }
            const json = await readCircuitJson(workspaceRoot, project.circuitJsonPath)
            const inspection = inspectCircuitJson(json)
            const catalogParts = await loadCatalogParts(workspaceRoot)
            const readiness = await projectCircuitReadiness(project.absolutePath, json, { inspection, catalogParts })
            return formatToolJson({
              projectId: args.projectId,
              name: project.name,
              success: true,
              artifactGenerationSucceeded: true,
              designValid: inspection.designValid,
              fabricationReady: readiness.fabricationReady,
              assemblyReady: readiness.assemblyReady,
              debugOnly: false,
              manufacturingBlockers: readiness.manufacturingBlockers,
              assemblyBlockers: readiness.assemblyBlockers,
              ...readiness.bom,
            })
          },
        }),

        // ── Assembly (Pick & Place) ────────────────────────────────────────
        pcb_assembly_export: tool({
          description:
            "Generate Pick & Place (CPL) CSV from a built project's Circuit JSON. Blocked by fabrication issues, incomplete BOM identity, missing or malformed placements, and unknown source mappings; intentional do_not_place components are reported separately.",
          args: {
            projectId: tool.schema.string().describe("Project ID from pcb_workspace_list"),
          },
          async execute(args) {
            const project = await resolveProject(workspaceRoot, args.projectId)
            if (!project.circuitJsonPath) {
              throw new Error(project.artifactError ?? `Circuit JSON not found for project '${project.name}'. Run pcb_circuit_build first.`)
            }
            const json = await readCircuitJson(workspaceRoot, project.circuitJsonPath)
            const inspection = inspectCircuitJson(json)
            const readiness = await projectCircuitReadiness(project.absolutePath, json, { inspection })
            if (readiness.assemblyBlockers.length > 0) {
              return formatToolJson({
                projectId: args.projectId,
                name: project.name,
                format: "cpl",
                success: false,
                artifactGenerationSucceeded: false,
                designValid: inspection.designValid,
                fabricationReady: readiness.fabricationReady,
                assemblyReady: false,
                debugOnly: false,
                reason: readiness.assemblyBlockers[0].type,
                manufacturingBlockers: readiness.manufacturingBlockers,
                assemblyBlockers: readiness.assemblyBlockers,
                diagnostics: inspection,
              })
            }
            const result = readiness.placement
            const csv = toCplCsv(result.entries)
            return formatToolJson({
              projectId: args.projectId,
              name: project.name,
              format: "cpl",
              success: inspection.designValid,
              artifactGenerationSucceeded: true,
              designValid: inspection.designValid,
              fabricationReady: true,
              debugOnly: false,
              manufacturingBlockers: [],
              assemblyBlockers: [],
              ...result,
              csv,
            })
          },
        }),

        // ── Read outputs ──────────────────────────────────────────────────────
        pcb_circuit_read: tool({
          description:
            "Inspect a built project's Circuit JSON. By default returns summary, compact diagnostics, and element type counts. Query exact diagnostic types with types/offset/limit for complete raw records; includeFullJson=true returns the complete document.",
          args: {
            projectId: tool.schema.string().describe("Project ID from pcb_workspace_list"),
            types: tool.schema.array(tool.schema.string()).optional().describe("Exact Circuit JSON element types to return"),
            offset: tool.schema.number().int().min(0).optional().describe("Filtered result offset (default 0)"),
            limit: tool.schema.number().int().min(1).max(1000).optional().describe("Filtered result limit (default 100, max 1000)"),
            includeFullJson: tool.schema.boolean().optional().describe("Include the complete Circuit JSON document (default false)"),
          },
          async execute(args) {
            const project = await resolveProject(workspaceRoot, args.projectId)
            if (!project.circuitJsonPath) {
              throw new Error(project.artifactError ?? `Circuit JSON not found for project '${project.name}'. Run pcb_circuit_build first.`)
            }
            const json = await readCircuitJson(workspaceRoot, project.circuitJsonPath)
            return formatToolJson({
              projectId: args.projectId,
              name: project.name,
              circuitJsonPath: project.circuitJsonPath,
              ...queryCircuitJson(json, args),
            })
          },
        }),

        pcb_schematic_svg: tool({
          description:
            "Read the schematic SVG export of a built project as a text attachment so the model can inspect the visual design. The schematic must be exported first with pcb_circuit_export.",
          args: {
            projectId: tool.schema.string().describe("Project ID from pcb_workspace_list"),
          },
          async execute(args) {
            return readProjectSvg(workspaceRoot, args.projectId, "schematic")
          },
        }),
        pcb_pcb_svg: tool({
          description:
            "Read the PCB layout SVG export of a built project as a text attachment so the model can inspect the visual design. The PCB SVG must be exported first with pcb_circuit_export.",
          args: {
            projectId: tool.schema.string().describe("Project ID from pcb_workspace_list"),
          },
          async execute(args) {
            return readProjectSvg(workspaceRoot, args.projectId, "pcb")
          },
        }),
      },
    }
  }
}
