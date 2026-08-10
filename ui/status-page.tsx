import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { probeAgentHealth } from "./agent/client"
import { Button } from "./components/button"
import { Dialog, DialogHeader } from "./components/dialog"
import { fetchJson } from "./lib/fetch-json"
import { closeStatusDialog, isStatusDialogOpen, subscribeStatusDialog } from "./status-dialog-state"

type StudiosResponse = {
  packageVersion: string
  nativeOpenCodeAvailable: boolean
  restartRequiredHint: string
}

type SupervisorResponse = {
  supervised: boolean
  pid?: number
}

type DoctorCheck = {
  id: string
  status: "pass" | "warn" | "fail"
  message: string
}

type LifecycleStatusResponse = {
  packageVersion: string
  checks: DoctorCheck[]
}

const MANAGED_IDS = ["plugin-registration", "plugin-media-go", "skill:cad", "skill:pcb", "skill:media", "mcp-build123d"] as const

function toneOf(status: "pass" | "warn" | "fail" | undefined): "pass" | "warn" | "fail" | undefined {
  return status
}

export function StatusDialogHost() {
  const open = useSyncExternalStore(subscribeStatusDialog, isStatusDialogOpen, () => false)
  return <StatusDialog open={open} onClose={closeStatusDialog} />
}

function StatusDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState<"repair" | "restart" | undefined>()
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "error" } | undefined>()
  const openRef = useRef(open)
  openRef.current = open
  const actionGen = useRef(0)

  const studiosQuery = useQuery({
    queryKey: ["host", "studios", "status"],
    queryFn: () => fetchJson<StudiosResponse>("/api/studios"),
    enabled: open,
  })
  const healthQuery = useQuery({
    queryKey: ["agent", "health"],
    queryFn: probeAgentHealth,
    enabled: open,
    refetchInterval: open ? 10_000 : false,
  })
  const statusQuery = useQuery({
    queryKey: ["host", "lifecycle-status"],
    queryFn: () => fetchJson<LifecycleStatusResponse>("/api/status"),
    enabled: open,
  })
  const supervisorQuery = useQuery({
    queryKey: ["agent", "supervisor"],
    queryFn: () => fetchJson<SupervisorResponse>("/api/agent/supervisor"),
    enabled: open,
    refetchInterval: open ? 10_000 : false,
  })

  useEffect(() => {
    if (open) {
      setNotice(undefined)
      setBusy(undefined)
      return
    }
    actionGen.current += 1
    setNotice(undefined)
    setBusy(undefined)
  }, [open])

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
    const gen = ++actionGen.current
    setBusy("repair")
    setNotice(undefined)
    try {
      const body = await withCsrf("/api/config", { method: "PUT", body: "{}" })
      if (!openRef.current || gen !== actionGen.current) return
      setNotice({ text: body?.message || "Repair complete. Restart agent if plugins did not reload.", tone: "success" })
      void statusQuery.refetch()
      void studiosQuery.refetch()
    } catch (error) {
      if (!openRef.current || gen !== actionGen.current) return
      setNotice({ text: error instanceof Error ? error.message : String(error), tone: "error" })
    } finally {
      if (openRef.current && gen === actionGen.current) setBusy(undefined)
    }
  }

  const restartAgent = async () => {
    const gen = ++actionGen.current
    setBusy("restart")
    setNotice(undefined)
    try {
      const body = await withCsrf("/api/agent/restart", { method: "POST", body: "{}" })
      if (!openRef.current || gen !== actionGen.current) return
      setNotice({ text: body?.message || "Agent restarted.", tone: "success" })
      void healthQuery.refetch()
      void supervisorQuery.refetch()
    } catch (error) {
      if (!openRef.current || gen !== actionGen.current) return
      setNotice({ text: error instanceof Error ? error.message : String(error), tone: "error" })
    } finally {
      if (openRef.current && gen === actionGen.current) setBusy(undefined)
    }
  }

  const checks = statusQuery.data?.checks ?? []
  const managed = MANAGED_IDS.map((id) => {
    const check = checks.find((item) => item.id === id)
    return check ?? { id, status: "fail" as const, message: "Status check unavailable" }
  })
  const managedReady = managed.filter((check) => check.status === "pass").length
  const managedTotal = MANAGED_IDS.length
  const failed = managed.filter((check) => check.status !== "pass")
  const needsRepair = failed.length > 0 || statusQuery.isError
  const agentOk = healthQuery.data?.ok === true
  const agentTone = healthQuery.isLoading ? undefined : agentOk ? "pass" : "fail"
  const installTone: "pass" | "warn" | "fail" | undefined = statusQuery.isLoading
    ? undefined
    : statusQuery.isError || failed.some((check) => check.status === "fail")
      ? "fail"
      : failed.some((check) => check.status === "warn")
        ? "warn"
        : "pass"

  const version = statusQuery.data?.packageVersion ?? studiosQuery.data?.packageVersion
  const supervisor = supervisorQuery.data
  const processLabel = supervisor
    ? supervisor.supervised
      ? supervisor.pid
        ? `Supervised · ${supervisor.pid}`
        : "Supervised"
      : "Attached"
    : undefined

  return (
    <Dialog open={open} onClose={onClose} title="Status" className="max-w-md">
      <DialogHeader title="Status" onClose={onClose} />
      <div className="flex flex-col gap-4 px-5 py-4">
        <ul className="flex flex-col gap-3">
          <li className="flex items-start gap-2.5">
            <span className="osc-status-dot mt-1" data-status={toneOf(agentTone)} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-[var(--osc-text)]">
                {healthQuery.isLoading ? "Agent…" : agentOk ? "Agent healthy" : "Agent unavailable"}
              </p>
              <p className="mt-0.5 text-[12px] text-[var(--osc-text-muted)]">
                {agentOk && healthQuery.data?.version
                  ? `OpenCode ${healthQuery.data.version}${processLabel ? ` · ${processLabel}` : ""}`
                  : healthQuery.data?.error || (healthQuery.isLoading ? "Checking…" : "Not responding")}
              </p>
            </div>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="osc-status-dot mt-1" data-status={toneOf(installTone)} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-[var(--osc-text)]">
                {statusQuery.isLoading ? "Install…" : needsRepair ? "Install needs attention" : "Install OK"}
              </p>
              <p className="mt-0.5 text-[12px] text-[var(--osc-text-muted)]">
                {version ? `v${version}` : "…"}
                {statusQuery.isLoading ? "" : ` · ${managedReady}/${managedTotal} checks`}
              </p>
              {failed.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1 border-t border-[var(--osc-border)] pt-2">
                  {failed.slice(0, 4).map((check) => (
                    <li key={check.id} className="text-[11px] text-[var(--osc-text-muted)]">
                      <span className="font-medium text-[var(--osc-text)]">{check.id}</span>
                      {" · "}
                      {check.message}
                    </li>
                  ))}
                  {failed.length > 4 ? <li className="text-[11px] text-[var(--osc-text-faint)]">+{failed.length - 4} more</li> : null}
                </ul>
              ) : null}
            </div>
          </li>
        </ul>

        <div className="flex flex-wrap gap-2 border-t border-[var(--osc-border)] pt-3">
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
            title={supervisor?.supervised === false ? "Only when this host spawned OpenCode" : undefined}
            onClick={() => void restartAgent()}
          >
            {busy === "restart" ? "Restarting…" : "Restart agent"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={Boolean(busy)}
            onClick={() => {
              void healthQuery.refetch()
              void supervisorQuery.refetch()
              void statusQuery.refetch()
            }}
          >
            Refresh
          </Button>
        </div>

        {notice ? (
          <p className="osc-settings-alert" data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>
            {notice.text}
          </p>
        ) : null}
        {studiosQuery.data?.restartRequiredHint ? (
          <p className="text-[11px] text-[var(--osc-text-muted)]">{studiosQuery.data.restartRequiredHint}</p>
        ) : null}
      </div>
    </Dialog>
  )
}
