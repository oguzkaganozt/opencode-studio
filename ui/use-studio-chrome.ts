import { useCallback, useEffect, useState } from "react"
import { subscribeAgentHandoff } from "./agent-handoff"
import { readAgentOpen, writeAgentOpen } from "./agent-open"
import { type AgentStatus, agentStatusDotClass, agentStatusLabel } from "./agent-status"

export function useStudioChrome() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(() => readAgentOpen())
  const [agentStatus, setAgentStatus] = useState<AgentStatus>(() => (readAgentOpen() ? "loading" : "closed"))

  useEffect(() => {
    if (!agentOpen) setAgentStatus("closed")
  }, [agentOpen])

  useEffect(() => {
    writeAgentOpen(agentOpen)
  }, [agentOpen])

  useEffect(() => {
    return subscribeAgentHandoff((request) => {
      if (request.open) setAgentOpen(true)
    })
  }, [])

  const setAgentOpenPersisted = useCallback((next: boolean | ((value: boolean) => boolean)) => {
    setAgentOpen((current) => {
      return typeof next === "function" ? next(current) : next
    })
  }, [])

  const toggleAgent = useCallback(() => {
    setAgentOpenPersisted((value) => !value)
  }, [setAgentOpenPersisted])

  const closeAgent = useCallback(() => {
    setAgentOpenPersisted(false)
  }, [setAgentOpenPersisted])

  return {
    drawerOpen,
    setDrawerOpen,
    agentOpen,
    agentStatus,
    setAgentStatus,
    setAgentOpenPersisted,
    toggleAgent,
    closeAgent,
    agentStatusLabel: agentStatusLabel(agentStatus),
    agentStatusDotClass: agentStatusDotClass(agentStatus),
  }
}
