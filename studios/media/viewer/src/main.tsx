import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./app"
import "./styles.css"

// Standalone viewer default (host overrides via __OPENCODE_STUDIO__).
;(window as any).__OPENCODE_STUDIO__ = {
  studioId: "media",
  uiBase: "",
  apiBase: "/api/studios/media",
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
