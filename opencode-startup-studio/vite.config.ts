import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  root: "ui",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true,
  },
  server: {
    port: 5190,
    proxy: {
      "/api": "http://127.0.0.1:4190",
    },
  },
})
