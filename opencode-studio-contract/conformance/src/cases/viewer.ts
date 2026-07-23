import { mkdir } from "node:fs/promises"
import path from "node:path"
import {
  type CheckResult,
  REFERENCE_ROOT,
  assert,
  readJson,
  startCompanion,
  tempDir,
  treeDigest,
  writeJson,
} from "../helpers"

export async function testViewer(): Promise<CheckResult[]> {
  const results: CheckResult[] = []

  try {
    const pkg = await readJson<{
      dependencies: Record<string, string>
      devDependencies?: Record<string, string>
    }>(path.join(REFERENCE_ROOT, "package.json"))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    for (const name of ["react", "react-dom", "react-router", "@tanstack/react-query", "vite", "tailwindcss"]) {
      assert(deps[name], `missing dependency ${name}`)
    }
    assert(deps.react.startsWith("19."), `react major: ${deps.react}`)

    const tokens = await Bun.file(path.join(REFERENCE_ROOT, "ui/src/tokens.css")).text()
    assert(tokens.includes("--osc-bg"), "tokens missing --osc-bg")
    assert(tokens.includes("--osc-accent-cad"), "tokens missing cad accent")
    assert(tokens.includes("--osc-font-ui"), "tokens missing font")

    const index = await Bun.file(path.join(REFERENCE_ROOT, "dist/ui/index.html")).text()
    assert(!/https?:\/\/cdn\./i.test(index), "runtime CDN in index.html")
    assert(!/fonts\.googleapis/i.test(index), "google fonts CDN")

    const uiAssets = path.join(REFERENCE_ROOT, "dist/ui/assets")
    const assetFiles = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: uiAssets }))
    const css = assetFiles.find((f) => f.endsWith(".css"))
    assert(css, "built css missing")
    const cssText = await Bun.file(path.join(uiAssets, css!)).text()
    assert(cssText.includes("--osc-bg") || cssText.includes("121417"), "built css missing OSC tokens")

    results.push({ name: "viewer.stack-tokens-no-cdn", ok: true })
  } catch (error) {
    results.push({
      name: "viewer.stack-tokens-no-cdn",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  const root = await tempDir("viewer")
  const dataRoot = path.join(root, "data")
  await mkdir(dataRoot, { recursive: true })
  await writeJson(path.join(dataRoot, "beta.note.json"), {
    id: "beta",
    title: "Beta",
    body: "Deep link target",
  })
  const before = await treeDigest(dataRoot)
  const companion = await startCompanion(dataRoot, 43104)

  try {
    const headers = { Host: `127.0.0.1:${companion.port}` }
    const home = await fetch(`${companion.baseUrl}/`, { headers })
    assert(home.ok, "viewer home")
    const html = await home.text()
    assert(html.includes("root") || html.includes("script"), "viewer html shell")

    const deep = await fetch(`${companion.baseUrl}/notes/beta`, { headers })
    assert(deep.ok, "deep link spa fallback")

    const after = await treeDigest(dataRoot)
    assert(before === after, "viewer must not mutate Data Root")
    results.push({ name: "viewer.load-deeplink-readonly", ok: true })
  } catch (error) {
    results.push({
      name: "viewer.load-deeplink-readonly",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  } finally {
    await companion.stop()
  }

  return results
}
