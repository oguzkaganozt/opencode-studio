import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { Link } from "react-router"
import { probeAgentHealth } from "./agent/client"
import { Button, buttonVariants } from "./components/button"
import { ErrorState } from "./components/error-state"
import { cn } from "./lib/cn"
import { fetchJson } from "./lib/fetch-json"

type StudiosResponse = {
  studioRoot: string
  packageVersion: string
  nativeOpenCodeAvailable: boolean
  studios: Array<{ id: string; skill: string; skillInstalled: boolean; root: string | null }>
  restartRequiredHint: string
}

type SupervisorResponse = {
  supervised: boolean
  pid?: number
  baseUrl?: string
  restartsInWindow: number
}

type DoctorCheck = {
  id: string
  status: "pass" | "warn" | "fail"
  message: string
  repair?: string
}

type LifecycleStatusResponse = {
  packageVersion: string
  workspace: string
  checks: DoctorCheck[]
}

const MANAGED_ROWS = [
  { group: "Plugins", id: "plugin-registration", label: "OpenCode Studio" },
  { group: "Plugins", id: "plugin-media-go", label: "media-go" },
  { group: "Skills", id: "skill:cad", label: "CAD · studio-cad" },
  { group: "Skills", id: "skill:pcb", label: "PCB · studio-pcb" },
  { group: "Skills", id: "skill:media", label: "Media · studio-media" },
  { group: "MCP", id: "mcp-build123d", label: "build123d" },
] as const

export function StatusPage() {
  const [busy, setBusy] = useState<"repair" | "restart" | undefined>()
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "error" } | undefined>()
  const studiosQuery = useQuery({
    queryKey: ["host", "studios", "status"],
    queryFn: () => fetchJson<StudiosResponse>("/api/studios"),
  })
  const healthQuery = useQuery({
    queryKey: ["agent", "health"],
    queryFn: probeAgentHealth,
    refetchInterval: 10_000,
  })
  const statusQuery = useQuery({
    queryKey: ["host", "lifecycle-status"],
    queryFn: () => fetchJson<LifecycleStatusResponse>("/api/status"),
  })
  const supervisorQuery = useQuery({
    queryKey: ["agent", "supervisor"],
    queryFn: () => fetchJson<SupervisorResponse>("/api/agent/supervisor"),
    refetchInterval: 10_000,
  })

  const withCsrf = async (path: string, init?: RequestInit) => {
    const csrf = await fetchJson<{ token: string }>("/api/csrf")
    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrf.token,
        ...(init?.headers ?? {}),
      },
    })
    const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null
    if (!response.ok) throw new Error(body?.error || body?.message || `HTTP ${response.status}`)
    return body
  }

  const repair = async () => {
    setBusy("repair")
    setNotice(undefined)
    try {
      const body = await withCsrf("/api/config", { method: "PUT", body: "{}" })
      setNotice({ text: body?.message || "Repair complete. Restart agent if plugins did not reload.", tone: "success" })
      void studiosQuery.refetch()
      void statusQuery.refetch()
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : String(error), tone: "error" })
    } finally {
      setBusy(undefined)
    }
  }

  const restartAgent = async () => {
    setBusy("restart")
    setNotice(undefined)
    try {
      const body = await withCsrf("/api/agent/restart", { method: "POST", body: "{}" })
      setNotice({ text: body?.message || "Agent restarted.", tone: "success" })
      void healthQuery.refetch()
      void supervisorQuery.refetch()
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : String(error), tone: "error" })
    } finally {
      setBusy(undefined)
    }
  }

  if (studiosQuery.isError) {
    return (
      <div className="p-6">
        <ErrorState title="Status unavailable" description={(studiosQuery.error as Error).message} />
      </div>
    )
  }

  const data = studiosQuery.data
  const supervisor = supervisorQuery.data
  const checks = new Map((statusQuery.data?.checks ?? []).map((check) => [check.id, check]))
  const managedChecks = MANAGED_ROWS.map((row) => ({ ...row, check: checks.get(row.id) }))
  const needsRepair = managedChecks.some(({ check }) => check?.status !== "pass")
  const healthStatus = healthQuery.isLoading ? undefined : healthQuery.data?.ok ? "pass" : "fail"
  const studioStatus = statusQuery.isLoading
    ? undefined
    : managedChecks.some(({ check }) => !check || check.status === "fail") || statusQuery.isError
      ? "fail"
      : managedChecks.some(({ check }) => check?.status === "warn")
        ? "warn"
        : "pass"
  const connectionLabel = supervisor
    ? supervisor.supervised
      ? `Supervised${supervisor.pid ? ` · PID ${supervisor.pid}` : ""}`
      : "Attached to external OpenCode"
    : "Checking process…"

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-4 sm:p-8">
      <header>
        <p className="osc-drawer-label">System</p>
        <h1 className="mt-1 text-[18px] font-semibold tracking-tight text-[var(--osc-text)]">Status</h1>
        <p className="mt-1 text-[13px] text-[var(--osc-text-muted)]">OpenCode runtime and Studio installation health.</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <section className="osc-setting-card">
          <div className="flex items-start gap-3">
            <span className="osc-status-dot" data-status={healthStatus} aria-hidden />
            <div className="min-w-0">
              <p className="osc-drawer-label">Agent API</p>
              <h2 className="mt-1 text-[14px] font-semibold text-[var(--osc-text)]">
                {healthQuery.isLoading ? "Checking…" : healthQuery.data?.ok ? "Healthy" : "Unavailable"}
              </h2>
              <p className="mt-0.5 font-mono text-[11px] text-[var(--osc-text-muted)]">
                {healthQuery.data?.ok && healthQuery.data.version
                  ? `OpenCode ${healthQuery.data.version}`
                  : healthQuery.data?.error || "Waiting for health response"}
              </p>
            </div>
          </div>
          <dl className="mt-4 grid gap-2 border-t border-[var(--osc-border)] pt-3 text-[11px]">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--osc-text-faint)]">Native bridge</dt>
              <dd className="m-0 text-right text-[var(--osc-text-muted)]">{data?.nativeOpenCodeAvailable ? "Available" : "Unavailable"}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--osc-text-faint)]">Process</dt>
              <dd className="m-0 text-right text-[var(--osc-text-muted)]">{connectionLabel}</dd>
            </div>
          </dl>
        </section>

        <section className="osc-setting-card">
          <div className="flex items-start gap-3">
            <span className="osc-status-dot" data-status={studioStatus} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="osc-drawer-label">Studio</p>
              <h2 className="mt-1 font-mono text-[14px] font-medium text-[var(--osc-text)]">
                v{statusQuery.data?.packageVersion ?? data?.packageVersion ?? "…"}
              </h2>
              <p
                className="mt-0.5 truncate font-mono text-[10px] text-[var(--osc-text-muted)]"
                title={statusQuery.data?.workspace ?? data?.studioRoot}
              >
                {statusQuery.data?.workspace ?? data?.studioRoot ?? "Resolving Studio Home…"}
              </p>
            </div>
          </div>
          <ul className="mt-4 grid gap-3 border-t border-[var(--osc-border)] pt-3 text-[11px]">
            {managedChecks.map(({ group, id, label, check }) => (
              <li key={id} className="flex items-start gap-2">
                <span className="osc-status-dot !mt-1 !size-1.5" data-status={check?.status ?? "fail"} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-[var(--osc-text)]">{label}</span>
                    <span className="shrink-0 text-[9px] tracking-[0.08em] text-[var(--osc-text-faint)] uppercase">{group}</span>
                  </span>
                  <span className="mt-0.5 block text-[var(--osc-text-muted)]">{check?.message ?? "Status check unavailable"}</span>
                  {check?.repair && check.status !== "pass" ? (
                    <span className="mt-0.5 block text-[var(--osc-text-faint)]">{check.repair}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="osc-setting-card">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--osc-text)]">Maintenance</h2>
          <p className="mt-0.5 text-[11px] text-[var(--osc-text-muted)]">
            Repair installation state, restart a supervised runtime, or refresh health.
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant={needsRepair ? "default" : "outline"}
            size="sm"
            disabled={Boolean(busy)}
            onClick={() => void repair()}
          >
            {busy === "repair" ? "Repairing…" : "Repair"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={Boolean(busy) || supervisor?.supervised === false}
            title={supervisor?.supervised === false ? "Only available when this host spawned OpenCode" : undefined}
            onClick={() => void restartAgent()}
          >
            {busy === "restart" ? "Restarting…" : "Restart agent"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void healthQuery.refetch()
              void supervisorQuery.refetch()
              void statusQuery.refetch()
            }}
          >
            Recheck status
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--osc-border)] pt-3">
          <a href="/opencode" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            OpenCode web
          </a>
          <Link to="/" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Agent home
          </Link>
        </div>
      </section>

      {notice ? (
        <p className="osc-settings-alert" data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      ) : null}
      {data?.restartRequiredHint ? <p className="text-[11px] text-[var(--osc-text-muted)]">{data.restartRequiredHint}</p> : null}
    </div>
  )
}
