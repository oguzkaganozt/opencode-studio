import { EventType, type BaseEvent } from "@ag-ui/core"
import { EventEncoder } from "@ag-ui/encoder"

const encoder = new EventEncoder()

export function workflowToAguiEvents(result: {
  status: string
  runId?: string
  steps?: Record<string, { status: string }>
}): BaseEvent[] {
  const runId = result.runId ?? "unknown"
  const events: BaseEvent[] = [
    { type: EventType.RUN_STARTED, threadId: "pcb-spike", runId } as BaseEvent,
  ]
  for (const [stepName, step] of Object.entries(result.steps ?? {})) {
    events.push({ type: EventType.STEP_STARTED, stepName } as BaseEvent)
    events.push({ type: EventType.STEP_FINISHED, stepName } as BaseEvent)
    if (step.status === "failed") {
      events.push({ type: EventType.RUN_ERROR, message: `${stepName} failed` } as BaseEvent)
      return events
    }
  }
  events.push({
    type: EventType.RUN_FINISHED,
    result: result.status,
  } as BaseEvent)
  return events
}

export function encodeAguiSse(events: BaseEvent[]): string {
  return events.map((event) => encoder.encode(event)).join("")
}
