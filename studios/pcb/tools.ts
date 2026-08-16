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
import { CIRCUIT_CHECKS, checkCircuit } from "./circuit-check"
import { inspectCircuitJson, queryCircuitJson, readCircuitJson } from "./circuit-json"
import { importExactLcscComponent } from "./component-import"
import { attachDatasheetNotes } from "./datasheet"
import { projectCircuitReadiness } from "./readiness"
import { installProjectDeps, scaffoldProject } from "./scaffold"
import { publishPcbSpec } from "./spec"
import { renderSvgPreview, type SvgPreview } from "./svg-preview"
import {
  addComponentCandidate,
  classifyBuildDiagnostics,
  componentSearchEntryVerification,
  exportCircuit,
  partitionSearchEntries,
  runProjectBuild,
  searchComponents,
  smokeTestImportedComponent,
} from "./tsci"
import { lookupTscircuitReference } from "./tscircuit-reference"
import { TSX_SNIPPET_KINDS, tsxSnippet } from "./tsx-snippets"
import { discoverProjects, encodeProjectId, projectSummary, resolveProject } from "./workspace"

function compactInspection<T extends { errors: Array<{ targets?: unknown[] }>; warnings: Array<{ targets?: unknown[] }> }>(
  inspection: T,
): T {
  const compact = (groups: Array<{ targets?: unknown[] }>) =>
    groups.map(({ targets, ...group }) => ({ ...group, ...(targets?.length ? { targetCount: targets.length } : {}) }))
  return { ...inspection, errors: compact(inspection.errors), warnings: compact(inspection.warnings) } as T
}

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
  metadata: {
    projectId: string
    name: string
    path: string
    sourceBytes: number
    previewBytes: number
    previewWidth: number
    previewHeight: number
    previewMaxEdge: number
  }
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
  const svg = await readFile(svgPath)
  let preview: SvgPreview
  try {
    preview = renderSvgPreview(svg)
  } catch (error) {
    throw new Error(`Unable to render ${label} preview for '${project.name}': ${error instanceof Error ? error.message : String(error)}`)
  }
  return {
    title: `${project.name} — ${label}`,
    output: `${kind === "schematic" ? "Schematic" : "PCB layout"} PNG preview for ${project.name}; original SVG: ${svgPath}`,
    metadata: {
      projectId,
      name: project.name,
      path: svgPath,
      sourceBytes: svg.byteLength,
      previewBytes: preview.png.byteLength,
      previewWidth: preview.width,
      previewHeight: preview.height,
      previewMaxEdge: preview.maxEdge,
    },
    attachments: [
      {
        type: "file" as const,
        mime: "image/png",
        filename: `${label}-preview.png`,
        url: `data:image/png;base64,${preview.png.toString("base64")}`,
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

        pcb_tscircuit_reference: tool({
          description:
            "Look up one topic in the pinned official tscircuit reference corpus. Reference-only: runtime compatibility overrides and Studio fabrication gates remain authoritative.",
          args: {
            query: tool.schema
              .string()
              .min(1)
              .max(100)
              .describe("Element or syntax topic, e.g. 'chip', 'USB-C', 'keepout', or 'footprints'"),
          },
          async execute(args) {
            return formatToolJson(lookupTscircuitReference(args.query))
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
            "Search once for a component class. `candidates` are pinned tscircuit packages; call pcb_component_add with a candidateId. For an exact JLCPCB C-number from catalogOnly, call pcb_component_add with lcscPartNumber. Only smoke-tested packages appear in `usable`. Repeated equivalent queries are cached. KiCad and supplier results are not ready components.",
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
            "Add one part to the project. Pass candidateId from pcb_component_search for a tscircuit package, or lcscPartNumber (C…) for an exact JLCPCB footprint. Provide exactly one. Smoke-tests and rolls back on failure. On success, courtyard is the keep-out box in mm for pcbX/pcbY. JLCPCB adds also attach datasheet wiring notes when a PDF can be resolved.",
          args: {
            projectId: tool.schema.string().describe("Project ID from pcb_workspace_list"),
            candidateId: tool.schema.string().min(1).optional().describe("candidateId from pcb_component_search.candidates"),
            lcscPartNumber: tool.schema
              .string()
              .regex(/^C[1-9]\d*$/)
              .optional()
              .describe("Exact canonical LCSC number, e.g. C2049745"),
            expectedSha256: tool.schema
              .string()
              .regex(/^[a-fA-F\d]{64}$/)
              .optional()
              .describe("Optional generated TSX SHA-256; only valid with lcscPartNumber"),
          },
          async execute(args, ctx) {
            const project = await resolveProject(workspaceRoot, args.projectId)
            const hasCandidate = Boolean(args.candidateId)
            const hasLcsc = Boolean(args.lcscPartNumber)
            if (hasCandidate === hasLcsc) {
              return formatToolJson({
                projectId: args.projectId,
                name: project.name,
                success: false,
                reason: "invalid_input",
                message: "Provide exactly one of candidateId or lcscPartNumber",
              })
            }
            if (args.expectedSha256 && !hasLcsc) {
              return formatToolJson({
                projectId: args.projectId,
                name: project.name,
                success: false,
                reason: "invalid_input",
                message: "expectedSha256 is only valid with lcscPartNumber",
              })
            }
            if (hasCandidate) {
              const result = await addComponentCandidate(project.absolutePath, args.candidateId!, ctx.abort)
              return formatToolJson({
                ...(result.courtyard ? { courtyard: result.courtyard } : {}),
                projectId: args.projectId,
                name: project.name,
                source: "tscircuit",
                ...result,
              })
            }
            const result = await importExactLcscComponent(
              { projectDir: project.absolutePath, lcscPartNumber: args.lcscPartNumber!, expectedSha256: args.expectedSha256 },
              { smoke: (input) => smokeTestImportedComponent(input, ctx.abort) },
            )
            const datasheet =
              result.success && result.relativePath
                ? await attachDatasheetNotes({
                    projectDir: project.absolutePath,
                    lcscPartNumber: args.lcscPartNumber!,
                    relativeTsx: result.relativePath,
                    signal: ctx.abort,
                  })
                : undefined
            return formatToolJson({
              ...(result.success && result.courtyard ? { courtyard: result.courtyard } : {}),
              ...(datasheet?.ok && datasheet.notesMd ? { notesMd: datasheet.notesMd } : {}),
              projectId: args.projectId,
              name: project.name,
              source: "jlcpcb",
              ...result,
              importStatement: result.success
                ? `import { ${result.exportName} } from "../${result.relativePath.replace(/\.tsx$/i, "")}"`
                : null,
              exampleUsage: result.success ? `<${result.exportName} name="U1" />` : null,
              datasheet,
            })
          },
        }),

        // ── Build & export ────────────────────────────────────────────────────
        pcb_circuit_build: tool({
          description:
            "Build and validate a tscircuit project. Returns reconciled diagnostics with stale trace warnings removed, categorized actionableDiagnostics, and structured fabrication/assembly blockers with refdes and pin targets.",
          args: {
            projectId: tool.schema.string().describe("Project ID from pcb_workspace_list"),
          },
          async execute(args, ctx) {
            const project = await resolveProject(workspaceRoot, args.projectId)
            const result = await runProjectBuild(project.absolutePath, ctx.abort)
            const circuit = result.artifacts.circuitJsonPath ? await readCircuitJson(workspaceRoot, result.artifacts.circuitJsonPath) : null
            const readiness = circuit
              ? await projectCircuitReadiness(project.absolutePath, circuit, { inspection: result.inspection ?? undefined })
              : {
                  inspection: result.inspection ?? {
                    designValid: false,
                    errorCount: 0,
                    warningCount: 0,
                    errors: [],
                    warnings: [],
                  },
                  fabricationReady: false,
                  assemblyReady: false,
                  manufacturingBlockers: [] as const,
                  assemblyBlockers: [] as const,
                }
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
              diagnostics: compactInspection(readiness.inspection),
              artifacts: result.artifacts,
              stdout: result.stdout.slice(0, 8000),
              stderr: result.stderr.slice(0, 4000),
            })
          },
        }),

        pcb_circuit_check: tool({
          description:
            "Run bounded deterministic checks against a freshly built Circuit JSON. Netlist and placement run in-process; shorts uses the pinned bundled implementation without a CDN or shell.",
          args: {
            projectId: tool.schema.string().describe("Project ID from pcb_workspace_list"),
            checks: tool.schema.array(tool.schema.enum(CIRCUIT_CHECKS)).min(1).describe("Checks to run"),
            placementRefdes: tool.schema
              .string()
              .regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/)
              .optional()
              .describe("Optional component refdes; requires placement"),
          },
          async execute(args) {
            const project = await resolveProject(workspaceRoot, args.projectId)
            if (!project.circuitJsonPath) {
              throw new Error(project.artifactError ?? `Circuit JSON not found for project '${project.name}'. Run pcb_circuit_build first.`)
            }
            const result = await checkCircuit({
              projectDir: project.absolutePath,
              circuitJsonPath: project.circuitJsonPath,
              options: { checks: args.checks, placementRefdes: args.placementRefdes },
            })
            return formatToolJson({ projectId: args.projectId, name: project.name, ...result })
          },
        }),

        pcb_circuit_export: tool({
          description:
            "Export a freshly built tscircuit project. Gerber is blocked by Circuit errors, placeholders, unverified identities, supplier footprint mismatches, unconnected pins, or any declared package pin without a physical PCB pad. noConnect exempts routing only, never the package land.",
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
              diagnostics: compactInspection(readiness.inspection),
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
                diagnostics: compactInspection(readiness.inspection),
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
            const result = queryCircuitJson(json, args)
            const readiness = await projectCircuitReadiness(project.absolutePath, json)
            return formatToolJson({
              projectId: args.projectId,
              name: project.name,
              circuitJsonPath: project.circuitJsonPath,
              ...result,
              diagnostics: compactInspection(readiness.inspection),
              diagnosticNote:
                "Summary diagnostics reconcile stale source_pin_missing_trace_warning records; explicit type selections remain raw evidence.",
            })
          },
        }),

        pcb_schematic_svg: tool({
          description:
            "Render the exported schematic as a bounded PNG attachment for visual inspection. The schematic must be exported first with pcb_circuit_export.",
          args: {
            projectId: tool.schema.string().describe("Project ID from pcb_workspace_list"),
          },
          async execute(args) {
            return readProjectSvg(workspaceRoot, args.projectId, "schematic")
          },
        }),
        pcb_pcb_svg: tool({
          description:
            "Render the exported PCB layout as a bounded PNG attachment for visual inspection. The PCB must be exported first with pcb_circuit_export.",
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
