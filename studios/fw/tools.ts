import { readFile } from "node:fs/promises"
import path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { formatToolJson } from "../../src/core/format-tool-json"
import { canonicalExistingDirectory } from "../../src/core/paths"
import { FW_CHIPS, type FwChip, fwChipPublic, fwChipSpec, isFwChip, listFwChips } from "./chips"
import { describeEngine } from "./engines"
import { buildFwProject, type RunCommand, simulateFwProject } from "./runner"
import { scaffoldFwProject } from "./scaffold"
import {
  buildRecordPath,
  type FwBuildRecord,
  type FwRunRecord,
  listFwProjects,
  readJsonIfPresent,
  resolveFwProject,
  runRecordPath,
  uartLogPath,
} from "./workspace"

const LOG_TOOL_CAP = 16_000

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

function projectSummary(project: Awaited<ReturnType<typeof resolveFwProject>>) {
  return {
    projectId: project.id,
    chip: project.chip,
    engine: project.engine,
    capabilities: project.capabilities,
    directory: project.directory,
  }
}

async function readTail(filePath: string, maxBytes: number) {
  try {
    const text = await readFile(filePath, "utf8")
    return text.length <= maxBytes ? text : text.slice(text.length - maxBytes)
  } catch {
    return ""
  }
}

export function createFwStudioPlugin(options?: { workspaceRoot?: string; runCommand?: RunCommand }): Plugin {
  return async (context) => {
    const workspaceRoot = await canonicalWorkspaceRoot(options?.workspaceRoot ?? context.directory)

    return {
      tool: {
        fw_workspace_list: tool({
          description: "List Firmware Studio projects under the firmware domain root. Returns chip, engine, and capabilities.",
          args: {},
          async execute() {
            const projects = await listFwProjects(workspaceRoot)
            return formatToolJson({
              workspaceRoot,
              projects: projects.map(projectSummary),
              total: projects.length,
            })
          },
        }),

        fw_project_create: tool({
          description:
            "Create an ESP-IDF Firmware Studio project (project.json, CMakeLists, hello-world main.c). chip must be a supported enum value.",
          args: {
            id: tool.schema.string().describe("Project id: lowercase letters, digits, dashes"),
            chip: tool.schema.string().describe(`Target chip. Must be one of: ${FW_CHIPS.join(", ")}. Call fw_caps first.`),
          },
          async execute(args) {
            if (!isFwChip(args.chip)) throw new Error(`Unsupported chip '${args.chip}'. Call fw_caps for the supported list.`)
            const spec = fwChipSpec(args.chip)
            const created = await scaffoldFwProject(workspaceRoot, args.id, args.chip as FwChip)
            return formatToolJson({
              ...created,
              engine: spec.engine,
              capabilities: spec.capabilities,
              nextSteps: [
                "Edit main/main.c",
                `Run fw_build with projectId '${created.id}'`,
                `Run fw_sim_run with projectId '${created.id}' and an expect string`,
              ],
            })
          },
        }),

        fw_project_read: tool({
          description: "Read a Firmware Studio project: chip, engine, capabilities, last build, last sim.",
          args: {
            projectId: tool.schema.string().describe("Project id"),
          },
          async execute(args) {
            const project = await resolveFwProject(workspaceRoot, args.projectId)
            const build = await readJsonIfPresent<FwBuildRecord>(buildRecordPath(project.directory))
            const run = await readJsonIfPresent<FwRunRecord>(runRecordPath(project.directory))
            return formatToolJson({
              ...projectSummary(project),
              name: project.manifest.name,
              build,
              run,
            })
          },
        }),

        fw_caps: tool({
          description:
            "List every Firmware Studio chip the agent may use: engine (qemu|esp-emu) and capabilities. Call before fw_project_create. Unknown chips hard-fail.",
          args: {
            chip: tool.schema.string().optional().describe("Optional chip to inspect; omit to list all"),
          },
          async execute(args) {
            if (args.chip) {
              const spec = fwChipSpec(args.chip)
              return formatToolJson({
                ...fwChipPublic(spec),
                engineLabel: describeEngine(spec.engine),
                note: spec.engine === "qemu" ? "UART expect/fail only" : "UART plus listed capabilities",
              })
            }
            return formatToolJson({
              chips: listFwChips().map((spec) => ({
                ...fwChipPublic(spec),
                engineLabel: describeEngine(spec.engine),
              })),
            })
          },
        }),

        fw_build: tool({
          description: "Run idf.py set-target and idf.py build. Downloads ESP-IDF into the Studio cache on first use.",
          args: {
            projectId: tool.schema.string().describe("Project id"),
          },
          async execute(args, ctx) {
            const project = await resolveFwProject(workspaceRoot, args.projectId)
            const { record, log } = await buildFwProject(project, { signal: ctx.abort, runCommand: options?.runCommand })
            return formatToolJson({
              projectId: project.id,
              chip: project.chip,
              ...record,
              logTail: log.slice(-LOG_TOOL_CAP),
            })
          },
        }),

        fw_sim_run: tool({
          description:
            "Run the project in QEMU (esp32/esp32s3) or esp-emu (c3/c6/h2/p4). Passes when expect appears on UART, fails on fail text, timeout, or non-zero exit. GPIO/Wi-Fi are not available on QEMU chips.",
          args: {
            projectId: tool.schema.string().describe("Project id"),
            expect: tool.schema.string().optional().describe("Substring that must appear on UART for pass"),
            fail: tool.schema.string().optional().describe("Substring that fails the run immediately"),
            timeoutMs: tool.schema.number().optional().describe("Sim timeout in milliseconds (default 20000)"),
          },
          async execute(args, ctx) {
            const project = await resolveFwProject(workspaceRoot, args.projectId)
            const { record, log } = await simulateFwProject(project, {
              expect: args.expect,
              fail: args.fail,
              timeoutMs: args.timeoutMs,
              signal: ctx.abort,
              runCommand: options?.runCommand,
            })
            return formatToolJson({
              projectId: project.id,
              ...record,
              logTail: log.slice(-LOG_TOOL_CAP),
            })
          },
        }),

        fw_sim_log: tool({
          description: "Read the last UART log written by fw_sim_run.",
          args: {
            projectId: tool.schema.string().describe("Project id"),
            maxBytes: tool.schema.number().optional().describe("Max bytes from the end of the log (default 16000)"),
          },
          async execute(args) {
            const project = await resolveFwProject(workspaceRoot, args.projectId)
            const maxBytes = args.maxBytes && args.maxBytes > 0 ? Math.min(args.maxBytes, 100_000) : LOG_TOOL_CAP
            const log = await readTail(uartLogPath(project.directory), maxBytes)
            const run = await readJsonIfPresent<FwRunRecord>(runRecordPath(project.directory))
            if (!run) throw new Error(`No sim log for '${project.id}'. Run fw_sim_run first.`)
            return formatToolJson({
              projectId: project.id,
              ...run,
              log,
            })
          },
        }),
      },
    }
  }
}
