import { useCallback, useEffect, useState } from "react"
import { subscribeAgentHandoff } from "./agent-handoff"
import { readAgentOpen, writeAgentOpen } from "./agent-open"
import { type AgentStatus, agentStatusDotClass, agentStatusLabel } from "./agent-status"

export type DrawerPanel = "nav" | "settings"

export function useStudioChrome() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerPanel, setDrawerPanel] = useState<DrawerPanel>("nav")
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

  const toggleAgent = useCallback(() => {
    setAgentOpen((value) => !value)
  }, [])

  const closeAgent = useCallback(() => {
    setAgentOpen(false)
  }, [])

  const openDrawer = useCallback((panel: DrawerPanel = "nav") => {
    setDrawerPanel(panel)
    setDrawerOpen(true)
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
  }, [])

  return {
    drawerOpen,
    drawerPanel,
    setDrawerOpen,
    setDrawerPanel,
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
