import path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { checkEvidenceUrls, listCandidates, loadRejects, poolStatus, readCandidate, rejectCandidate, upsertCandidate } from "./pool"
import { assertCandidateName, type PoolEntry } from "./schemas"
import { canonicalDataRoot } from "./studio-path"

function asJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function parseOptionalEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`Expected one of ${allowed.join("|")}, got ${String(value)}`)
  }
  return value as T
}

export const StartupStudioPlugin: Plugin = async (context, rawOptions) => {
  const dataRootOption =
    typeof rawOptions?.dataRoot === "string" && rawOptions.dataRoot.length > 0 ? rawOptions.dataRoot : context.directory
  const companionUrl =
    typeof rawOptions?.companionUrl === "string" && rawOptions.companionUrl.length > 0
      ? rawOptions.companionUrl.replace(/\/$/, "")
      : "http://127.0.0.1:4190"

  const dataRoot = await canonicalDataRoot(dataRootOption)

  return {
    tool: {
      startup_list: tool({
        description:
          "List idea candidates in the Data Root pool (pool.json), sorted by score. Optional filters: minTotal, signalClass (A|B), verdict.",
        args: {
          minTotal: tool.schema.number().optional(),
          signalClass: tool.schema.string().optional(),
          verdict: tool.schema.string().optional(),
        },
        async execute(args) {
          const signalClass = parseOptionalEnum(args.signalClass, ["A", "B"] as const)
          const verdict = parseOptionalEnum(args.verdict, ["verified", "partial", "unverified"] as const)
          const candidates = await listCandidates(dataRoot, {
            minTotal: typeof args.minTotal === "number" ? args.minTotal : undefined,
            signalClass,
            verdict,
          })
          return asJson({ count: candidates.length, candidates })
        },
      }),

      startup_read: tool({
        description: "Read one pool candidate by kebab-case name.",
        args: {
          name: tool.schema.string(),
        },
        async execute(args) {
          return asJson(await readCandidate(dataRoot, args.name))
        },
      }),

      startup_upsert: tool({
        description: "Create or replace a pool candidate. Requires edit permission on pool.json. Pass the full PoolEntry object fields.",
        args: {
          name: tool.schema.string(),
          problem: tool.schema.string(),
          buyer: tool.schema.string(),
          shelf: tool.schema.string(),
          signal_class: tool.schema.string(),
          evidence_json: tool.schema.string().describe("JSON array of {url, summary, date?, engagement?}"),
          verdict: tool.schema.string(),
          verify_summary: tool.schema.string().optional(),
          total: tool.schema.number().optional(),
          rubric_json: tool.schema.string().describe("JSON object {pain,payment,shelf,freshness,fit} each 0-2"),
          one_liner: tool.schema.string(),
          status: tool.schema.string().optional(),
          batch: tool.schema.string().optional(),
          first_seen: tool.schema.string().optional(),
          evaluation_json: tool.schema.string().optional().describe("JSON {pros,cons,risks,recommendation,updated_at}"),
        },
        async execute(args, toolContext) {
          assertCandidateName(args.name)
          await toolContext.ask({
            permission: "edit",
            patterns: [path.join(dataRoot, "pool.json")],
            always: [],
            metadata: {},
          })

          let evidence: unknown
          let rubric: unknown
          let evaluation: unknown
          try {
            evidence = JSON.parse(args.evidence_json)
          } catch {
            throw new Error("evidence_json must be valid JSON")
          }
          try {
            rubric = JSON.parse(args.rubric_json)
          } catch {
            throw new Error("rubric_json must be valid JSON")
          }
          if (args.evaluation_json) {
            try {
              evaluation = JSON.parse(args.evaluation_json)
            } catch {
              throw new Error("evaluation_json must be valid JSON")
            }
          }

          const today = new Date().toISOString().slice(0, 10)
          const payload: Record<string, unknown> = {
            name: args.name,
            problem: args.problem,
            buyer: args.buyer,
            shelf: args.shelf,
            signal_class: args.signal_class,
            evidence,
            verdict: args.verdict,
            rubric,
            one_liner: args.one_liner,
            status: args.status || "pool",
            batch: args.batch || `session-${today}`,
            first_seen: args.first_seen || today,
          }
          if (args.verify_summary) payload.verify_summary = args.verify_summary
          if (typeof args.total === "number") payload.total = args.total
          if (evaluation) payload.evaluation = evaluation

          const entry = await upsertCandidate(dataRoot, payload)
          return asJson({ ok: true, entry })
        },
      }),

      startup_reject: tool({
        description: "Move a pool candidate to rejects.json with a reason. Requests edit on pool.json and rejects.json.",
        args: {
          name: tool.schema.string(),
          reason: tool.schema.string(),
          batch: tool.schema.string().optional(),
        },
        async execute(args, toolContext) {
          await toolContext.ask({
            permission: "edit",
            patterns: [path.join(dataRoot, "pool.json"), path.join(dataRoot, "rejects.json")],
            always: [],
            metadata: {},
          })
          const result = await rejectCandidate(dataRoot, args.name, args.reason, args.batch)
          return asJson({ ok: true, ...result })
        },
      }),

      startup_check_evidence: tool({
        description:
          "HTTP liveness check for evidence URLs (no LLM). Pass urls_json as a JSON string array, or name to check a pool candidate's evidence.",
        args: {
          urls_json: tool.schema.string().optional(),
          name: tool.schema.string().optional(),
        },
        async execute(args) {
          let urls: string[] = []
          if (args.name) {
            const entry = await readCandidate(dataRoot, args.name)
            urls = entry.evidence.map((e) => e.url)
          }
          if (args.urls_json) {
            const parsed = JSON.parse(args.urls_json) as unknown
            if (!Array.isArray(parsed) || !parsed.every((u) => typeof u === "string")) {
              throw new Error("urls_json must be a JSON string array")
            }
            urls = [...urls, ...parsed]
          }
          if (urls.length === 0) throw new Error("Provide name and/or urls_json")
          const checks = await checkEvidenceUrls(urls)
          const live = checks.filter((c) => c.ok).length
          return asJson({
            total: checks.length,
            live,
            dead: checks.length - live,
            allLive: live === checks.length,
            checks,
          })
        },
      }),

      startup_status: tool({
        description: "Pool/rejects counts, score distribution, and top candidates.",
        args: {},
        async execute() {
          const status = await poolStatus(dataRoot)
          const rejects = await loadRejects(dataRoot)
          return asJson({
            ...status,
            rejectNames: rejects.slice(0, 20).map((r) => r.name),
            dataRootLabel: path.basename(dataRoot),
          })
        },
      }),

      startup_view: tool({
        description: "Return the companion viewer URL for the pool or a candidate deep link, plus health.",
        args: {
          name: tool.schema.string().optional(),
        },
        async execute(args) {
          if (args.name) assertCandidateName(args.name)
          const url = args.name ? `${companionUrl}/candidates/${args.name}` : companionUrl
          let healthy = false
          try {
            const response = await fetch(new URL("/api/health", companionUrl).toString(), {
              signal: AbortSignal.timeout(1000),
            })
            healthy = response.ok
          } catch {
            healthy = false
          }
          return asJson({
            companionUrl,
            url,
            healthy,
            hint: healthy
              ? "Open the URL in a browser (read-only)."
              : `Companion not reachable. Start: opencode-studio serve --workspace ${dataRoot}`,
          })
        },
      }),
    },
  }
}

export default StartupStudioPlugin

// re-export type for tests/docs
export type { PoolEntry }
