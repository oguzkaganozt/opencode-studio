import { useCallback, useEffect, useState } from "react"
import { subscribeAgentHandoff } from "./agent-handoff"
import { readAgentOpen, writeAgentOpen } from "./agent-open"
import { type AgentStatus, agentStatusDotClass, agentStatusLabel } from "./agent-status"

export function useStudioChrome(options?: { openAgentOnHandoff?: boolean }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(() => readAgentOpen())
  const [agentStatus, setAgentStatus] = useState<AgentStatus>(() => (agentOpen ? "loading" : "closed"))

  useEffect(() => {
    if (!agentOpen) setAgentStatus("closed")
  }, [agentOpen])

  useEffect(() => {
    writeAgentOpen(agentOpen)
  }, [agentOpen])

  useEffect(() => {
    if (!options?.openAgentOnHandoff) return
    return subscribeAgentHandoff((request) => {
      if (request.open) setAgentOpen(true)
      return undefined
    })
  }, [options?.openAgentOnHandoff])

  const toggleAgent = useCallback(() => {
    setAgentOpen((value) => !value)
  }, [])

  const closeAgent = useCallback(() => {
    setAgentOpen(false)
  }, [])

  const openDrawer = useCallback(() => {
    setDrawerOpen(true)
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
  }, [])

  return {
    drawerOpen,
    openDrawer,
    closeDrawer,
    agentOpen,
    agentStatus,
    setAgentStatus,
    toggleAgent,
    closeAgent,
    agentStatusLabel: agentStatusLabel(agentStatus),
    agentStatusDotClass: agentStatusDotClass(agentStatus),
  }
}
