import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { Link, Navigate, Route, Routes, useParams } from "react-router"
import { claimAgentContext } from "@ui/agent-context"
import { requestAgentHandoff } from "@ui/agent-handoff"
import { Badge } from "@ui/components/badge"
import { EmptyState } from "@ui/components/empty-state"
import { ErrorState } from "@ui/components/error-state"
import { StudioHomeHeader } from "@ui/components/studio-home"
import { StudioNavLink, StudioShell } from "@ui/components/studio-shell"
import { eventsUrl, listProjects, readProject, readWorkspace, studioHref, type FwProjectDetail } from "./api"

function useFwEvents() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const es = new EventSource(eventsUrl())
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data as string) as { type?: string; projectId?: string }
        if (event.type === "projects-changed") {
          void queryClient.invalidateQueries({ queryKey: ["fw", "projects"] })
        }
        if (event.type === "artifacts-changed") {
          void queryClient.invalidateQueries({ queryKey: ["fw", "projects"] })
          if (event.projectId) void queryClient.invalidateQueries({ queryKey: ["fw", "project", event.projectId] })
        }
      } catch {
        // malformed event — ignore
      }
    }
    return () => es.close()
  }, [queryClient])
}

type ViewTab = "console" | "run" | "build" | "pins"

function isViewTab(value: string | undefined): value is ViewTab {
  return value === "console" || value === "run" || value === "build" || value === "pins"
}

function statusTone(value: boolean | null | undefined): "ok" | "fail" | "neutral" {
  if (value === true) return "ok"
  if (value === false) return "fail"
  return "neutral"
}

function ProjectsPage() {
  useFwEvents()
  const projects = useQuery({ queryKey: ["fw", "projects"], queryFn: listProjects })
  const workspace = useQuery({ queryKey: ["fw", "workspace"], queryFn: () => readWorkspace() })

  useEffect(() => {
    if (!workspace.data?.root) return
    return claimAgentContext("fw-root", {
      key: "fw-root",
      kind: "fw-root",
      studioId: "fw",
      label: "Firmware Studio",
      directory: workspace.data.root,
      historicalDirectory: workspace.data.root,
      status: "available",
    })
  }, [workspace.data?.root])

  return (
    <StudioShell studioId="fw" label="Firmware">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
        <StudioHomeHeader
          eyebrow="Firmware Studio"
          title="Projects"
          count={projects.data ? `${projects.data.length} project${projects.data.length === 1 ? "" : "s"}` : undefined}
        />
        {projects.isLoading ? <div className="osc-skeleton h-24 w-full" role="status" aria-label="Loading Firmware projects" /> : null}
        {projects.error ? <ErrorState title="Failed to load Firmware projects" description={String(projects.error)} /> : null}
        {projects.data?.length === 0 ? (
          <EmptyState
            title="No Firmware projects yet"
            description="Ask the Firmware agent to create an ESP-IDF project with fw_project_create."
            action={
              <button
                type="button"
                className="osc-chip"
                onClick={() =>
                  requestAgentHandoff({
                    text: "Create a new Firmware Studio project here with fw_project_create. Pick a supported chip from fw_caps.",
                    source: "fw",
                    open: true,
                  })
                }
              >
                Draft project request
              </button>
            }
          />
        ) : null}
        {projects.data?.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {projects.data.map((project) => (
              <Link key={project.id} to={studioHref(`projects/${encodeURIComponent(project.id)}/console`)} className="fw-project-card">
                <span className="fw-project-card__rail" aria-hidden />
                <p className="truncate text-[14px] font-semibold">{project.id}</p>
                <p className="mt-1 truncate font-mono text-[11px] text-[var(--osc-text-muted)]">
                  {project.chip} · {project.engine}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone={statusTone(project.buildOk)} dot>
                    {project.buildOk == null ? "no build" : project.buildOk ? "build ok" : "build fail"}
                  </Badge>
                  <Badge tone={statusTone(project.runOk)} dot>
                    {project.runOk == null ? "no sim" : project.runOk ? "sim ok" : "sim fail"}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </StudioShell>
  )
}

function splitLog(log: string) {
  if (!log) return []
  return log.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
}

function ConsoleView({ project, selected, onSelect }: { project: FwProjectDetail; selected: string | null; onSelect: (line: string) => void }) {
  const lines = useMemo(() => splitLog(project.uart), [project.uart])
  const fail = project.run?.fail

  if (lines.length === 0) {
    return (
      <EmptyState
        title="No UART log yet"
        description="Ask the Firmware agent to run fw_sim_run. The serial output lands here."
        action={
          <button
            type="button"
            className="osc-chip"
            onClick={() =>
              requestAgentHandoff({
                text: `Run fw_build then fw_sim_run for project ${project.id} with an expect string the firmware should print.`,
                source: "fw",
                directory: project.directory,
                open: true,
              })
            }
          >
            Request sim
          </button>
        }
      />
    )
  }

  return (
    <div className="fw-console" role="log" aria-label="UART log">
      {lines.map((line, index) => {
        const key = `${index}:${line}`
        return (
          <button
            key={key}
            type="button"
            className={`fw-console__line${selected === line ? " is-selected" : ""}${fail && line.includes(fail) ? " is-fail" : ""}`}
            onClick={() => onSelect(line)}
          >
            {line || " "}
          </button>
        )
      })}
    </div>
  )
}

function RunView({ project }: { project: FwProjectDetail }) {
  if (!project.run) {
    return <EmptyState title="No simulation yet" description="fw_sim_run writes the last expect/fail result here." />
  }
  return (
    <div className="space-y-3">
      <div className="fw-meta">
        <Badge tone={project.run.ok ? "ok" : "fail"} dot>
          {project.run.ok ? "passed" : "failed"}
        </Badge>
        <span>reason {project.run.reason}</span>
        <span>{project.run.engine}</span>
        <span>{project.run.durationMs} ms</span>
        {project.run.expect ? <span>expect {project.run.expect}</span> : null}
        {project.run.matched ? <span>matched {project.run.matched}</span> : null}
      </div>
    </div>
  )
}

function BuildView({ project }: { project: FwProjectDetail }) {
  if (!project.build) {
    return <EmptyState title="No build yet" description="fw_build writes compiler output here." />
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="fw-meta">
        <Badge tone={project.build.ok ? "ok" : "fail"} dot>
          {project.build.ok ? "build ok" : "build fail"}
        </Badge>
        <span>exit {project.build.exitCode ?? "—"}</span>
        <span>{project.build.finishedAt}</span>
      </div>
      <pre className="fw-console">{project.buildLog || "No build log."}</pre>
    </div>
  )
}

function PinsView({ project }: { project: FwProjectDetail }) {
  if (!project.capabilities.includes("gpio")) {
    return (
      <EmptyState
        title="GPIO not available on this chip"
        description={`${project.chip} runs on ${project.engine}. Pin probe is only offered when fw_caps lists gpio.`}
      />
    )
  }
  return (
    <EmptyState
      title="GPIO probe not recorded"
      description="This chip can expose GPIO in esp-emu. v1 records UART only — do not invent pin state."
    />
  )
}

function ProjectPage() {
  useFwEvents()
  const { projectId = "", tab: rawTab } = useParams()
  const tab: ViewTab = isViewTab(rawTab) ? rawTab : "console"
  const project = useQuery({
    queryKey: ["fw", "project", projectId],
    queryFn: () => readProject(projectId),
    enabled: Boolean(projectId),
  })
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (!project.data) return
    return claimAgentContext(`fw:${project.data.id}`, {
      key: `fw:${project.data.id}`,
      kind: "fw-project",
      studioId: "fw",
      projectId: project.data.id,
      relativePath: project.data.path,
      label: `FW · ${project.data.id}`,
      directory: project.data.directory,
      historicalDirectory: project.data.directory,
      status: "available",
    })
  }, [project.data])

  if (project.isLoading) return <div className="osc-skeleton m-4 min-h-48 flex-1" role="status" aria-label="Loading Firmware project" />
  if (project.error || !project.data) {
    return <ErrorState className="m-4 flex-1" title="Firmware project unavailable" description={String(project.error ?? "Not found")} />
  }

  const detail = project.data
  const showPins = detail.capabilities.includes("gpio")
  const tabs: ViewTab[] = showPins ? ["console", "run", "build", "pins"] : ["console", "run", "build"]

  return (
    <StudioShell
      studioId="fw"
      label="Firmware"
      fill
      nav={tabs.map((item) => (
        <StudioNavLink key={item} to={studioHref(`projects/${encodeURIComponent(detail.id)}/${item}`)} className="fw-tab">
          {item === "console" ? "Console" : item === "run" ? "Run" : item === "build" ? "Build" : "Pins"}
        </StudioNavLink>
      ))}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-medium tracking-[0.08em] text-[var(--osc-text-faint)] uppercase">
              <Link to={studioHref("")} className="hover:text-[var(--osc-text)]">
                ← Projects
              </Link>
            </p>
            <h1 className="text-[16px] font-semibold">{detail.name}</h1>
          </div>
          <div className="fw-meta">
            <span>{detail.chip}</span>
            <span>{detail.engine}</span>
            <Badge tone={statusTone(detail.build?.ok ?? null)} dot>
              build
            </Badge>
            <Badge tone={statusTone(detail.run?.ok ?? null)} dot>
              sim
            </Badge>
          </div>
        </div>
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label={`${tab} view`}>
          {tab === "console" ? <ConsoleView project={detail} selected={selected} onSelect={setSelected} /> : null}
          {tab === "run" ? <RunView project={detail} /> : null}
          {tab === "build" ? <BuildView project={detail} /> : null}
          {tab === "pins" ? <PinsView project={detail} /> : null}
        </section>
        <div className="fw-selection-bar">
          <span className="text-[10px] font-medium tracking-[0.06em] text-[var(--osc-text-faint)] uppercase">Line</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--osc-text-muted)]">{selected ?? "Select a UART line"}</span>
          <button
            type="button"
            className="osc-chip"
            disabled={!selected}
            onClick={() => {
              if (!selected) return
              requestAgentHandoff({
                text: `UART line from ${detail.id}: ${selected}`,
                source: "fw",
                directory: detail.directory,
                open: true,
              })
            }}
          >
            Fix with agent
          </button>
        </div>
      </div>
    </StudioShell>
  )
}

export function App() {
  return (
    <Routes>
      <Route index element={<ProjectsPage />} />
      <Route path="projects/:projectId" element={<Navigate to="console" replace />} />
      <Route path="projects/:projectId/:tab" element={<ProjectPage />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  )
}
