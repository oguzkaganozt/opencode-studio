import { useQuery } from "@tanstack/react-query"
import { api } from "./api"

export function useCircuitJson(projectId: string) {
  return useQuery({
    queryKey: ["circuitJson", projectId],
    queryFn: async () => {
      const res = await fetch(api.circuitJsonUrl(projectId))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
  })
}
