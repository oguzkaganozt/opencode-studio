import type { Part } from "@opencode-ai/sdk/v2/client"
import { useState } from "react"
import { roleOf } from "./agent-types"
import type { AgentMessage } from "./client"
import { IconChevron, ToolIcon } from "./icons"
import { Markdown } from "./markdown"
import { summarizePart, textFromParts, toolDetail, toolLabel, toolPreview, toolStatus } from "./part-text"

export type AssistantBlock = { id: string; kind: "tools"; parts: Part[] } | { id: string; kind: "text"; text: string }

const USER_CLAMP_CHARS = 480
const USER_CLAMP_LINES = 12

/** Chronological blocks: consecutive tool parts group into one quiet list, text parts render as markdown. */
export function assistantBlocks(parts: Part[]): AssistantBlock[] {
  const blocks: AssistantBlock[] = []
  for (const part of parts) {
    if (part.type === "tool") {
      const last = blocks[blocks.length - 1]
      if (last?.kind === "tools") last.parts.push(part)
      else blocks.push({ id: part.id, kind: "tools", parts: [part] })
      continue
    }
    if (part.type === "text" && typeof (part as { text?: string }).text === "string") {
      const text = (part as { text: string }).text.trim()
      if (!text) continue
      const last = blocks[blocks.length - 1]
      if (last?.kind === "text") last.text = `${last.text}\n\n${text}`
      else blocks.push({ id: part.id, kind: "text", text })
    }
  }
  return blocks
}

export function MessageBubble({ message }: { message: AgentMessage }) {
  const role = roleOf(message.info)
  const text = textFromParts(message.parts)
  if (role === "user") {
    return <UserBubble key={message.info.id} text={text || "…"} />
  }
  const blocks = assistantBlocks(message.parts)
  const summaries = message.parts.map(summarizePart).filter((summary): summary is string => Boolean(summary))
  if (blocks.length === 0 && summaries.length === 0) return null
  return (
    <div className="oc-msg oc-msg--assistant">
      <div className="oc-msg__surface">
        {blocks.map((block) =>
          block.kind === "tools" ? (
            <div key={block.id} className="oc-msg__tools">
              {block.parts.map((part) => (
                <ToolCard key={part.id} part={part} />
              ))}
            </div>
          ) : (
            <Markdown key={block.id} text={block.text} />
          ),
        )}
        {blocks.length === 0
          ? summaries.map((summary, index) => (
              <p key={`${message.info.id}:summary:${index}`} className="oc-msg__meta">
                {summary}
              </p>
            ))
          : null}
      </div>
    </div>
  )
}

function UserBubble({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const longEnough = text.length > USER_CLAMP_CHARS || text.split("\n").length > USER_CLAMP_LINES
  const clamped = longEnough && !expanded

  return (
    <div className="oc-msg oc-msg--user">
      <div className="oc-msg__user-wrap">
        <div className={`oc-msg__bubble${clamped ? " oc-msg__bubble--clamp" : ""}`}>{text}</div>
        {longEnough ? (
          <button type="button" className="oc-msg__expand" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Show less" : "Show more"}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function ToolCard({ part }: { part: Part }) {
  const label = toolLabel(part) ?? "tool"
  const status = toolStatus(part)
  const detail = toolDetail(part)
  const preview = toolPreview(part)
  const statusClass = status === "error" ? " is-error" : status === "running" || status === "pending" ? " is-live" : ""
  const inner = (
    <>
      <span className="oc-tool__icon" aria-hidden>
        <ToolIcon tool={label} />
      </span>
      <span className="oc-tool__name">{label}</span>
      {preview ? <span className="oc-tool__preview">{preview}</span> : null}
      {status ? <span className={`oc-tool__status${statusClass}`}>{status}</span> : null}
    </>
  )
  if (!detail) {
    return <div className="oc-tool oc-tool--static">{inner}</div>
  }
  return (
    <details className={`oc-tool${status === "error" ? " oc-tool--error" : ""}`}>
      <summary>
        {inner}
        <span className="oc-tool__chevron" aria-hidden>
          <IconChevron />
        </span>
      </summary>
      <pre className="oc-tool__detail">{detail}</pre>
    </details>
  )
}
