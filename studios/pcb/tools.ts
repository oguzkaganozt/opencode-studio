import { readFile } from "node:fs/promises"
import path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { formatToolJson } from "../../src/core/format-tool-json"
import { canonicalExistingDirectory } from "../../src/core/paths"
import type { SpecRoots } from "../../src/core/spec"
import { createSpecTools } from "../../src/core/spec-tools"
import { toCplCsv } from "./assembly"
import {
  filterCatalogParts,
  findCatalogPart,
  inspectCatalog,
  loadCatalogParts,
  partDetail,
  partSummary,
  upsertCatalogPart,
} from "./catalog"
import { inspectCircuitJson, queryCircuitJson, readCircuitJson } from "./circuit-json"
import { projectCircuitReadiness } from "./readiness"
import { installProjectDeps, scaffoldProject } from "./scaffold"
import { publishPcbSpec } from "./spec"
import {
  addComponentCandidate,
  classifyBuildDiagnostics,
  componentSearchEntryVerification,
  exportCircuit,
  partitionSearchEntries,
  runProjectBuild,
  searchComponents,
} from "./tsci"
import { TSX_SNIPPET_KINDS, tsxSnippet } from "./tsx-snippets"
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

export function createPcbStudioPlugin(options?: { workspaceRoot?: string; specRoots?: SpecRoots }): Plugin {
  return async (context) => {
    const workspaceRoot = await canonicalWorkspaceRoot(options?.workspaceRoot ?? context.directory)
    const specRoots = options?.specRoots ?? { cad: workspaceRoot, pcb: workspaceRoot, fw: workspaceRoot }

    return {
      tool: {
        ...createSpecTools({
          owner: "pcb",
          publish: (id, summary) => publishPcbSpec(specRoots, id, summary),
        }),
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

        pcb_tsx_snippet: tool({
          description:
            "Return a short tscircuit TSX stub and pin names for one built-in kind. Does not write files or search parts. Use this instead of reading tscircuit source or node_modules types.",
          args: {
            kind: tool.schema.enum(TSX_SNIPPET_KINDS).describe("Built-in element to stub"),
          },
          async execute(args) {
            return formatToolJson(tsxSnippet(args.kind))
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

        pcb_component_search: tool({
          description:
            "Search once for a component class. `candidates` are pinned tscircuit packages; call pcb_component_add with a candidateId before importing one. Only smoke-tested packages appear in `usable`. Repeated equivalent queries are cached. KiCad and supplier results are not ready components.",
          args: {
            projectId: tool.schema.string().describe("Project ID from pcb_workspace_list; create the project before searching"),
            query: tool.schema.string().min(1).describe("Exact MPN or focused component query, e.g. 'ESP32-S3-WROOM-1-N8R8' or 'BME280'"),
            source: tool.schema.enum(["all", "jlcpcb", "tscircuit", "kicad"]).optional().describe("Search source (default 'all')"),
          },
          async execute(args, ctx) {
            const project = await resolveProject(workspaceRoot, args.projectId)
            const result = await searchComponents(args.query, args.source ?? "all", ctx.abort)
            const { usable, candidates, rejected, footprintOnly, catalogOnly } = partitionSearchEntries(
              result.results,
              project.absolutePath,
            )
            const view = (entry: (typeof result.results)[number]) => ({
              ...entry,
              verification: componentSearchEntryVerification(entry, project.absolutePath),
            })
            return formatToolJson({
              projectId: args.projectId,
              query: result.query,
              resolvedQuery: result.resolvedQuery,
              attemptedQueries: result.attemptedQueries,
              fallbackUsed: result.fallbackUsed,
              source: result.scope,
              cacheHit: result.cacheHit,
              success: result.success,
              processSuccess: result.processSuccess,
              exitCode: result.exitCode,
              usable: usable.slice(0, 3).map(view),
              candidates: candidates.slice(0, 3).map(view),
              rejected: rejected.slice(0, 3).map(view),
              footprintOnly: footprintOnly.slice(0, 3),
              catalogOnly: catalogOnly.slice(0, 3),
              total: usable.length,
              candidateCount: candidates.length,
              rejectedCount: rejected.length,
              footprintOnlyCount: footprintOnly.length,
              catalogOnlyCount: catalogOnly.length,
              stdout: result.success ? undefined : result.stdout.slice(0, 8000),
              stderr: result.stderr.slice(0, 4000),
            })
          },
        }),

        pcb_component_add: tool({
          description:
            "Install one candidate returned by pcb_component_search at its pinned version. Runs a minimal tscircuit render smoke test. On failure restores package files and rejects the candidate; on success returns the exact import and JSX usage.",
          args: {
            projectId: tool.schema.string().describe("Project ID from pcb_workspace_list"),
            candidateId: tool.schema.string().min(1).describe("candidateId from pcb_component_search.candidates"),
          },
          async execute(args, ctx) {
            const project = await resolveProject(workspaceRoot, args.projectId)
            const result = await addComponentCandidate(project.absolutePath, args.candidateId, ctx.abort)
            return formatToolJson({ projectId: args.projectId, name: project.name, ...result })
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
            const diagnosticSummary = classifyBuildDiagnostics(result, readiness.manufacturingBlockers)
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
              rootCause: diagnosticSummary.rootCause,
              actionableDiagnostics: diagnosticSummary,
              diagnostics: result.inspection,
              artifacts: result.artifacts,
              stdout: result.stdout.slice(0, 8000),
              stderr: result.stderr.slice(0, 4000),
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
