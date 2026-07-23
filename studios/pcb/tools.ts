import { readFile } from "node:fs/promises"
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { generatePickAndPlace, toCplCsv } from "./assembly"
import { bomIdentityBlocker, generateBom } from "./bom"
import { getCatalogPart, inspectCatalog, loadCatalogParts, partSummary } from "./catalog"
import { inspectCircuitJson, manufacturingBlockers, queryCircuitJson, readCircuitJson } from "./circuit-json"
import { installProjectDeps, scaffoldProject } from "./scaffold"
import { canonicalWorkspaceRoot } from "./studio-path"
import { exportCircuit, runProjectBuild, searchComponents } from "./tsci"
import { discoverProjects, encodeProjectId, projectSummary, resolveProject } from "./workspace"

function formatToolJSON(value: unknown): string {
  return JSON.stringify(value, null, 2)
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
            return formatToolJSON({
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
              return formatToolJSON({
                ...result,
                projectId,
                install: "skipped",
                nextSteps: ["Run npm install in the project directory", `Run pcb_circuit_build with projectId '${projectId}'`],
              })
            }

            const install = await installProjectDeps(result.absolutePath, ctx.abort)
            if (!install.success) {
              return formatToolJSON({
                ...result,
                projectId,
                install: { success: false, exitCode: install.exitCode, stderr: install.stderr.slice(0, 4000) },
                nextSteps: ["Fix the npm install failure, then run pcb_circuit_build"],
              })
            }

            return formatToolJSON({
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
            const q = args.query?.toLowerCase()
            const filtered = q ? catalog.parts.filter((p) => JSON.stringify(p).toLowerCase().includes(q)) : catalog.parts
            return formatToolJSON({
              available: catalog.available,
              scope: catalog.scope,
              catalogPath: catalog.catalogPath,
              reason: catalog.reason ?? (q && filtered.length === 0 ? "no_matches" : null),
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
            const [catalog, part] = await Promise.all([inspectCatalog(workspaceRoot), getCatalogPart(workspaceRoot, args.mpn)])
            return formatToolJSON({
              available: catalog.available,
              scope: catalog.scope,
              catalogPath: catalog.catalogPath,
              reason: part ? null : (catalog.reason ?? "part_not_found"),
              malformedCount: catalog.malformedCount,
              skippedCount: catalog.skippedCount,
              part,
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
            return formatToolJSON({
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
            const circuit = result.artifacts.circuitJsonPath ? await readCircuitJson(result.artifacts.circuitJsonPath) : null
            const blockers = circuit ? manufacturingBlockers(circuit) : []
            const fabricationReady = result.inspection !== null && blockers.length === 0
            const assemblyReady = fabricationReady && circuit !== null && generateBom(circuit).bomComplete
            return formatToolJSON({
              projectId: args.projectId,
              name: project.name,
              success: result.success,
              processSuccess: result.processSuccess,
              exitCode: result.exitCode,
              designValid: result.inspection?.designValid ?? null,
              fabricationReady,
              assemblyReady,
              debugOnly: result.inspection ? !result.inspection.designValid : false,
              manufacturingBlockers: blockers,
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
            const circuit = result.artifacts.circuitJsonPath ? await readCircuitJson(result.artifacts.circuitJsonPath) : null
            const fabricationReady = result.manufacturingBlockers.length === 0
            return formatToolJSON({
              projectId: args.projectId,
              name: project.name,
              success: result.success,
              processSuccess: result.processSuccess,
              artifactGenerationSucceeded: result.artifactGenerationSucceeded,
              exitCode: result.exitCode,
              designValid: result.designValid,
              fabricationReady,
              assemblyReady: fabricationReady && circuit !== null && generateBom(circuit).bomComplete,
              debugOnly: result.debugOnly,
              generatedFormats: result.generatedFormats,
              blockedFormats: result.blockedFormats,
              manufacturingBlockers: result.manufacturingBlockers,
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
              throw new Error(`Circuit JSON not found for project '${project.name}'. Run pcb_circuit_build first.`)
            }
            const { readCircuitJson } = await import("./circuit-json")
            const json = await readCircuitJson(project.circuitJsonPath)
            const inspection = inspectCircuitJson(json)
            const catalogParts = await loadCatalogParts(workspaceRoot)
            const bom = generateBom(json, catalogParts)
            const fabricationReady = manufacturingBlockers(json).length === 0
            return formatToolJSON({
              projectId: args.projectId,
              name: project.name,
              success: true,
              artifactGenerationSucceeded: true,
              designValid: inspection.designValid,
              fabricationReady,
              assemblyReady: fabricationReady && bom.bomComplete,
              debugOnly: false,
              ...bom,
            })
          },
        }),

        // ── Assembly (Pick & Place) ────────────────────────────────────────
        pcb_assembly_export: tool({
          description:
            "Generate Pick & Place (CPL) CSV from a built project's Circuit JSON. Blocked by fabrication issues or BOM entries without manufacturer or supplier part identities.",
          args: {
            projectId: tool.schema.string().describe("Project ID from pcb_workspace_list"),
            format: tool.schema.enum(["cpl"]).optional().describe("Output format (default 'cpl')"),
          },
          async execute(args) {
            const project = await resolveProject(workspaceRoot, args.projectId)
            if (!project.circuitJsonPath) {
              throw new Error(`Circuit JSON not found for project '${project.name}'. Run pcb_circuit_build first.`)
            }
            const { readCircuitJson } = await import("./circuit-json")
            const json = await readCircuitJson(project.circuitJsonPath)
            const inspection = inspectCircuitJson(json)
            const fabricationBlockers = manufacturingBlockers(json)
            const bomBlocker = bomIdentityBlocker(generateBom(json))
            const assemblyBlockers = [...fabricationBlockers, ...(bomBlocker ? [bomBlocker] : [])]
            if (assemblyBlockers.length > 0) {
              return formatToolJSON({
                projectId: args.projectId,
                name: project.name,
                format: args.format ?? "cpl",
                success: false,
                artifactGenerationSucceeded: false,
                designValid: inspection.designValid,
                fabricationReady: fabricationBlockers.length === 0,
                assemblyReady: false,
                debugOnly: false,
                reason: assemblyBlockers[0].type,
                manufacturingBlockers: fabricationBlockers,
                assemblyBlockers,
                diagnostics: inspection,
              })
            }
            const result = generatePickAndPlace(json)
            const csv = toCplCsv(result.entries)
            return formatToolJSON({
              projectId: args.projectId,
              name: project.name,
              format: args.format ?? "cpl",
              success: inspection.designValid,
              artifactGenerationSucceeded: true,
              designValid: inspection.designValid,
              fabricationReady: true,
              assemblyReady: true,
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
              throw new Error(`Circuit JSON not found for project '${project.name}'. Run pcb_circuit_build first.`)
            }
            const json = await readCircuitJson(project.circuitJsonPath)
            return formatToolJSON({
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
            const project = await resolveProject(workspaceRoot, args.projectId)
            if (!project.schematicSvgPath) {
              throw new Error(`Schematic SVG not found for project '${project.name}'. Run pcb_circuit_export with format 'schematic'.`)
            }
            const svg = await readFile(project.schematicSvgPath, "utf8")
            return {
              title: `${project.name} — schematic`,
              output: `Schematic SVG for ${project.name} (${project.schematicSvgPath})`,
              metadata: { projectId: args.projectId, name: project.name, path: project.schematicSvgPath, bytes: svg.length },
              attachments: [
                {
                  type: "file" as const,
                  mime: "image/svg+xml",
                  filename: "schematic.svg",
                  url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
                },
              ],
            }
          },
        }),
        pcb_pcb_svg: tool({
          description:
            "Read the PCB layout SVG export of a built project as a text attachment so the model can inspect the visual design. The PCB SVG must be exported first with pcb_circuit_export.",
          args: {
            projectId: tool.schema.string().describe("Project ID from pcb_workspace_list"),
          },
          async execute(args) {
            const project = await resolveProject(workspaceRoot, args.projectId)
            if (!project.pcbSvgPath) {
              throw new Error(`PCB SVG not found for project '${project.name}'. Run pcb_circuit_export with format 'pcb'.`)
            }
            const svg = await readFile(project.pcbSvgPath, "utf8")
            return {
              title: `${project.name} — pcb`,
              output: `PCB layout SVG for ${project.name} (${project.pcbSvgPath})`,
              metadata: { projectId: args.projectId, name: project.name, path: project.pcbSvgPath, bytes: svg.length },
              attachments: [
                {
                  type: "file" as const,
                  mime: "image/svg+xml",
                  filename: "pcb.svg",
                  url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
                },
              ],
            }
          },
        }),
      },
    }
  }
}

export default createPcbStudioPlugin()
