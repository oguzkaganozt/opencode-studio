import { useQuery } from "@tanstack/react-query"
import { requestAgentHandoff } from "@ui/agent-handoff"
import { Badge } from "@ui/components/badge"
import { EmptyState } from "@ui/components/empty-state"
import { ErrorState } from "@ui/components/error-state"
import { useState } from "react"
import { api, type SimulationExperiment, type SimulationSeries } from "./api"

const TRACE_COLORS = [
  "var(--osc-accent)",
  "var(--osc-success)",
  "var(--osc-warning)",
  "var(--osc-error)",
  "var(--osc-text-muted)",
] as const

function number(value: number) {
  const magnitude = Math.abs(value)
  if (magnitude !== 0 && (magnitude < 0.001 || magnitude >= 10_000)) return value.toExponential(3)
  return value.toLocaleString(undefined, { maximumFractionDigits: 5 })
}

function linePath(values: number[], times: number[], min: number, max: number, width: number, height: number) {
  const range = max - min || 1
  const start = times[0] ?? 0
  const timeRange = (times[times.length - 1] ?? start) - start
  return values
    .map((value, index) => {
      const x = timeRange === 0 ? (values.length === 1 ? 0 : (index / (values.length - 1)) * width) : (((times[index] ?? start) - start) / timeRange) * width
      const y = height - ((value - min) / range) * height
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(" ")
}

function WaveformChart({ experiment, kind }: { experiment: SimulationExperiment; kind: SimulationSeries["kind"] }) {
  const series = experiment.series.filter((item) => item.kind === kind)
  if (series.length === 0) return null
  const allValues = series.flatMap((item) => item.values)
  let min = Math.min(...allValues)
  let max = Math.max(...allValues)
  if (min === max) {
    const padding = Math.abs(min) * 0.05 || 1
    min -= padding
    max += padding
  }
  const width = 800
  const height = 220
  const unit = series[0]!.unit
  const axis = experiment.axis.values
  const title = kind === "voltage" ? "Voltage probes" : kind === "current" ? "Current probes" : "Phase probes"

  return (
    <section className="pcb-sim-chart" aria-label={`${kind} waveforms`}>
      <header className="pcb-sim-chart__header">
        <div>
          <p className="pcb-sim-eyebrow">{kind}</p>
          <h3>{title}</h3>
        </div>
        <span className="font-mono text-[10px] text-[var(--osc-text-muted)]">
          {number(min)}–{number(max)} {unit}
        </span>
      </header>
      <div className="pcb-sim-chart__legend" aria-label="Trace legend">
        {series.map((item, index) => (
          <span key={item.name}>
            <i style={{ background: TRACE_COLORS[index % TRACE_COLORS.length] }} aria-hidden />
            {item.name}
          </span>
        ))}
      </div>
      <div className="pcb-sim-chart__canvas">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${series.map((item) => item.name).join(", ")} over ${experiment.axis.name}`}>
          <g className="pcb-sim-grid" aria-hidden>
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
              <line key={`y-${ratio}`} x1="0" x2={width} y1={ratio * height} y2={ratio * height} />
            ))}
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
              <line key={`x-${ratio}`} y1="0" y2={height} x1={ratio * width} x2={ratio * width} />
            ))}
          </g>
          {series.map((item, index) => (
            <path
              key={item.name}
              d={linePath(item.values, axis, min, max, width, height)}
              fill="none"
              stroke={TRACE_COLORS[index % TRACE_COLORS.length]}
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        <div className="pcb-sim-chart__axis" aria-hidden>
          <span>
            {number(axis[0] ?? 0)} {experiment.axis.unit}
          </span>
          <span>
            {number(axis[axis.length - 1] ?? 0)} {experiment.axis.unit}
          </span>
        </div>
      </div>
    </section>
  )
}

function ProbeTable({ experiment }: { experiment: SimulationExperiment }) {
  return (
    <div className="pcb-table-wrap">
      <table className="pcb-sim-table">
        <thead>
          <tr>
            <th>Probe</th>
            <th>Type</th>
            <th>First</th>
            <th>Last</th>
            <th>Min</th>
            <th>Max</th>
            <th>Mean</th>
            <th>Peak-to-peak</th>
          </tr>
        </thead>
        <tbody>
          {experiment.series.map((item) => (
            <tr key={`${item.kind}-${item.name}`}>
              <td className="font-mono font-medium text-[var(--osc-text)]">{item.name}</td>
              <td className="capitalize text-[var(--osc-text-muted)]">{item.kind}</td>
              {(["first", "last", "min", "max", "mean", "peakToPeak"] as const).map((key) => (
                <td key={key} className="font-mono tabular-nums text-[var(--osc-text-muted)]">
                  {number(item.summary[key])} {item.unit}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function SimulationTab({ projectId, directory }: { projectId: string; directory: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["pcb", "simulation", projectId],
    queryFn: () => api.simulation(projectId),
    retry: false,
  })

  const runSimulation = () =>
    requestAgentHandoff({
      text: `Run pcb_sim_run for PCB project ${projectId}. Inspect every named probe series and summary, explain any simulation diagnostics, and iterate on src/circuit.tsx if the electrical behavior does not match the design intent. Keep simulationSuccess separate from fabricationReady and assemblyReady.`,
      source: "pcb",
      directory,
      paths: [directory],
      open: true,
      copyFallback: true,
    })

  if (isLoading) {
    return (
      <div className="space-y-3 p-4" role="status" aria-busy="true">
        <span className="sr-only">Loading simulation results…</span>
        <div className="osc-skeleton h-20 w-full" aria-hidden />
        <div className="osc-skeleton h-72 w-full" aria-hidden />
      </div>
    )
  }

  if (error || !data) {
    return (
      <EmptyState
        className="m-4 border-dashed py-16"
        title="No simulation results"
        description="Add an analog simulation and named voltage/current probes, then ask the PCB agent to run the simulation. Simulation remains separate from fabrication and assembly readiness."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className="pcb-chip pcb-chip--primary" onClick={runSimulation}>
              Run with agent
            </button>
            <button type="button" className="pcb-chip" onClick={() => void refetch()}>
              Retry
            </button>
          </div>
        }
      />
    )
  }

  const experiment = data.experiments.find((item) => item.id === selectedId) ?? data.experiments[0]
  const diagnostics = data.diagnostics ?? []
  if (!experiment) {
    return (
      <ErrorState
        className="m-4"
        title="Simulation failed"
        description={diagnostics.join(" ") || "Run the simulation again and inspect its diagnostics."}
      />
    )
  }

  const passed = data.simulationSuccess

  return (
    <div className="pcb-sim-view">
      <header className="pcb-sim-overview">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={passed ? "ok" : "fail"} dot>
              {passed ? "Simulation passed" : "Simulation failed"}
            </Badge>
            <span className="font-mono text-[10px] text-[var(--osc-text-muted)]">
              {experiment.pointsCount} points · {experiment.series.length} probes
            </span>
          </div>
          <p>Electrical feedback only. This status does not change fabrication or assembly readiness.</p>
          {data.caveat ? <p className="mt-1 text-[11px] text-[var(--osc-text-faint)]">{data.caveat}</p> : null}
          {diagnostics.length > 0 ? (
            <ul className="mt-2 space-y-1 text-[12px] text-[var(--osc-error)]">
              {diagnostics.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <button type="button" className="pcb-chip" onClick={runSimulation}>
          Re-run with agent
        </button>
      </header>

      {data.experiments.length > 1 ? (
        <div className="pcb-sim-experiments" role="tablist" aria-label="Simulation experiments">
          {data.experiments.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === experiment.id}
              className="pcb-chip"
              onClick={() => setSelectedId(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>
      ) : null}

      <WaveformChart experiment={experiment} kind="voltage" />
      <WaveformChart experiment={experiment} kind="current" />
      <WaveformChart experiment={experiment} kind="phase" />
      <ProbeTable experiment={experiment} />
    </div>
  )
}
