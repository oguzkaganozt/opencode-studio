/**
 * HTTP smoke (no browser automation).
 * Boots the host with all studios enabled and hits health, SPA shell, catalog,
 * and each studio UI + a representative API route.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { STUDIO_IDS } from "../src/core/registry"
import { configureStudios } from "../src/lifecycle"
import { createHostApp } from "../src/server"

const root = path.resolve(import.meta.dir, "..")
const workspace = await mkdtemp(path.join(tmpdir(), "osc-browser-"))
try {
  await configureStudios({
    workspace,
    enabled: [...STUDIO_IDS],
    packageRoot: root,
    validateOpenCode: false,
  })
  const { app } = await createHostApp({
    workspace,
    packageRoot: root,
    hostname: "127.0.0.1",
    port: 4173,
    uiDirectory: path.join(root, "dist/ui"),
  })
  const headers = { host: "127.0.0.1:4173" }

  const core = ["http://127.0.0.1:4173/api/health", "http://127.0.0.1:4173/", "http://127.0.0.1:4173/api/studios"]
  for (const url of core) {
    const res = await app.request(url, { headers })
    if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  }

  // Deep studio SPA routes (served as index.html by host)
  for (const id of STUDIO_IDS) {
    const ui = await app.request(`http://127.0.0.1:4173/studios/${id}`, { headers })
    if (!ui.ok) throw new Error(`/studios/${id} -> ${ui.status}`)
  }

  // Representative API probes per studio
  const apiProbes: Array<[string, string]> = [
    ["cad", "/api/studios/cad/designs"],
    ["media", "/api/studios/media/assets"],
    ["pcb", "/api/studios/pcb/projects"],
    ["startup", "/api/studios/startup/candidates"],
  ]
  for (const [id, route] of apiProbes) {
    const res = await app.request(`http://127.0.0.1:4173${route}`, { headers })
    if (!res.ok) throw new Error(`${id} ${route} -> ${res.status}`)
  }

  console.log("http-smoke ok (no browser)")
} finally {
  await rm(workspace, { recursive: true, force: true })
}
