import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router"
import { App } from "./app"
import "./styles.css"

// Standalone viewer default (host overrides via __OPENCODE_STUDIO__).
;(window as any).__OPENCODE_STUDIO__ = {
  studioId: "cad",
  uiBase: "",
  apiBase: "/api/studios/cad",
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 2_000 } },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
