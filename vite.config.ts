import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

/** Rewrite @tscircuit/3d-viewer CDN OCCT loads to same-origin vendored assets. */
function localOcctCdn(): Plugin {
  const fromBase = "https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23"
  const toBase = "/studio/vendor/occt-import-js"
  return {
    name: "local-occt-cdn",
    transform(code, id) {
      if (!id.includes("@tscircuit/3d-viewer") && !id.includes("3d-viewer")) return null
      if (!code.includes("cdn.jsdelivr.net")) return null
      return {
        code: code
          .replaceAll(`${fromBase}/dist`, toBase)
          .replaceAll(`${fromBase}/+esm`, `${toBase}/occt-import-js.js`)
          .replaceAll(fromBase, toBase),
        map: null,
      }
    },
  }
}

export default defineConfig({
  root: "ui",
  base: "/studio/",
  publicDir: "public",
  plugins: [react(), tailwindcss(), localOcctCdn()],
  resolve: {
    alias: {
      "@studios": path.resolve(import.meta.dirname, "studios"),
    },
  },
  optimizeDeps: {
    exclude: ["manifold-3d"],
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
    },
  },
})
