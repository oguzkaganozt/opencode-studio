import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

/** Rewrite @tscircuit/3d-viewer CDN OCCT loads to same-origin vendored assets. */
function rewriteOcctCdn(code: string): string {
  const fromBase = "https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23"
  const toBase = "/studio/vendor/occt-import-js"
  return code
    .replaceAll(`${fromBase}/dist`, toBase)
    // UMD has no ESM exports — load via classic-script facade.
    .replaceAll(`${fromBase}/+esm`, `${toBase}/occt-import-js.esm.js`)
    .replaceAll(fromBase, toBase)
}

function localOcctCdn(): Plugin {
  return {
    name: "local-occt-cdn",
    // Apply before dep prebundle so `bun run dev:ui` does not keep jsDelivr URLs.
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("@tscircuit/3d-viewer") && !id.includes("3d-viewer")) return null
      if (!code.includes("cdn.jsdelivr.net")) return null
      return { code: rewriteOcctCdn(code), map: null }
    },
  }
}

export default defineConfig({
  root: "ui",
  base: "/studio/",
  publicDir: "public",
  plugins: [react(), tailwindcss(), localOcctCdn()],
  resolve: {
    // CAD assembly + @tscircuit/3d-viewer (and three-stdlib/troika) must share one Three.js.
    // Nested 0.165 under @tscircuit/3d-viewer + root 0.185 → Material.onBuild missing → freeze.
    dedupe: ["three", "react", "react-dom"],
    alias: {
      // Exact bare specifier only — keep three/addons/* on package exports.
      three$: path.resolve(import.meta.dirname, "node_modules/three"),
      // Bare `@opencode-ai/sdk` re-exports server/spawn — pin browser to client entry only.
      "@opencode-ai/sdk/v2/client": path.resolve(import.meta.dirname, "node_modules/@opencode-ai/sdk/dist/v2/client.js"),
      "@opencode-ai/sdk/client": path.resolve(import.meta.dirname, "node_modules/@opencode-ai/sdk/dist/client.js"),
      "@opencode-ai/sdk": path.resolve(import.meta.dirname, "node_modules/@opencode-ai/sdk/dist/client.js"),
      "@studios": path.resolve(import.meta.dirname, "studios"),
      "@ui": path.resolve(import.meta.dirname, "ui"),
    },
  },
  optimizeDeps: {
    // Keep 3d-viewer out of the prebundle so localOcctCdn transform rewrites CDN OCCT URLs.
    exclude: ["manifold-3d", "@tscircuit/3d-viewer"],
  },
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4173",
      "/studio-api": "http://127.0.0.1:4173",
      // OpenCode API (the host catch-all proxies these to the supervised instance).
      // Without this the Agent panel cannot run under dev:ui.
      "^/(global|event|session|permission|agent|config|app|doc|file|find|path|vcs|pty|mcp|tui|auth|provider|skill|command|instance|project|lsp|formatter)(/|\\?|$)":
        "http://127.0.0.1:4173",
    },
  },
})
