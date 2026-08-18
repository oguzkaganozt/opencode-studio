import assert from "node:assert/strict"
import { createServer } from "node:http"
import { test } from "node:test"
import { EventType } from "@ag-ui/core"
import { encodeAguiSse, workflowToAguiEvents } from "./agui.ts"

test("encodes official AG-UI SSE from a Mastra workflow result", async () => {
  const events = workflowToAguiEvents({
    status: "suspended",
    runId: "run-1",
    steps: {
      "lock-intent": { status: "success" },
      "approve-plan": { status: "suspended" },
    },
  })
  assert.equal(events[0]?.type, EventType.RUN_STARTED)
  assert.equal(events.some((event) => event.type === EventType.STEP_STARTED), true)
  const sse = encodeAguiSse(events)
  assert.match(sse, /event: RUN_STARTED|data: .*RUN_STARTED/)
  assert.match(sse, /STEP_STARTED|STEP_FINISHED|RUN_FINISHED/)

  const body = await new Promise<string>((resolve, reject) => {
    const server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.end(sse)
    })
    server.listen(0, "127.0.0.1", async () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("no port"))
        return
      }
      try {
        const res = await fetch(`http://127.0.0.1:${address.port}/`)
        resolve(await res.text())
      } catch (error) {
        reject(error)
      } finally {
        server.close()
      }
    })
  })
  assert.equal(body, sse)
})
