/**
 * HTTP + Chromium smoke for the Viewer shell and each studio route.
 * Catches Tailwind content-scan / shell-height regressions that HTTP alone misses.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { chromium, type Page } from "playwright"
import { STUDIO_IDS } from "../src/core/registry"
import { configureStudios } from "../src/lifecycle"
import { startHost } from "../src/server"

const root = path.resolve(import.meta.dir, "..")
const uiDirectory = path.join(root, "dist/ui")
const workspace = await mkdtemp(path.join(tmpdir(), "osc-browser-"))

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function httpSmoke(base: string) {
  const core = [`${base}/studio-api/health`, `${base}/studio`, `${base}/api/studios`]
  for (const url of core) {
    const res = await fetch(url)
    assert(res.ok, `${url} -> ${res.status}`)
  }
  for (const id of STUDIO_IDS) {
    const ui = await fetch(`${base}/studio/studios/${id}`)
    assert(ui.ok, `/studio/studios/${id} -> ${ui.status}`)
  }
  const filesUi = await fetch(`${base}/studio/files`)
  assert(filesUi.ok, `/studio/files -> ${filesUi.status}`)
  const apiProbes: Array<[string, string]> = [
    ["cad", "/api/studios/cad/designs"],
    ["pcb", "/api/studios/pcb/projects"],
    ["files", "/api/files/tree"],
  ]
  for (const [id, route] of apiProbes) {
    const res = await fetch(`${base}${route}`)
    assert(res.ok, `${id} ${route} -> ${res.status}`)
  }
  console.log("http-smoke ok")
}

/** Prove the utilities that broke the pre-fix UI are present in the cascade. */
async function assertTailwindUtilities(page: Page) {
  const result = await page.evaluate(() => {
    const probe = document.createElement("div")
    document.body.appendChild(probe)
    const check = (cls: string, prop: keyof CSSStyleDeclaration, expected: string) => {
      probe.className = cls
      return getComputedStyle(probe)[prop] === expected
    }
    const out = {
      hidden: check("hidden", "display", "none"),
      srOnly: check("sr-only", "position", "absolute"),
      w56: check("w-56", "width", "224px"),
      minHDvh: (() => {
        probe.className = "min-h-dvh"
        const v = getComputedStyle(probe).minHeight
        return v.endsWith("px") && Number.parseFloat(v) > 100
      })(),
    }
    probe.remove()
    return out
  })
  assert(result.hidden, "Tailwind utility .hidden missing from CSS")
  assert(result.srOnly, "Tailwind utility .sr-only missing from CSS")
  assert(result.w56, "Tailwind utility .w-56 missing from CSS")
  assert(result.minHDvh, "Tailwind utility .min-h-dvh missing from CSS")
}

async function assertShellFillsViewport(page: Page, studioId: string) {
  const metrics = await page.evaluate((id) => {
    const shell = document.querySelector(`.studio-shell[data-studio="${id}"]`) as HTMLElement | null
    const viewer = (document.querySelector(`.studio-shell [data-studio="${id}"]`) ??
      document.querySelector('[data-testid="studio-main"]')) as HTMLElement | null
    const shellRect = shell?.getBoundingClientRect()
    const viewerRect = viewer?.getBoundingClientRect()
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map((el) => {
      const style = getComputedStyle(el)
      return { display: style.display, visibility: style.visibility, width: el.getBoundingClientRect().width }
    })
    return {
      vh: window.innerHeight,
      shellH: shellRect?.height ?? 0,
      viewerH: viewerRect?.height ?? 0,
      fileInputs,
      title: document.title,
      bodyText: document.body.innerText.slice(0, 400),
    }
  }, studioId)

  assert(metrics.shellH >= metrics.vh * 0.9, `${studioId}: shell height ${metrics.shellH} < 90% of viewport ${metrics.vh}`)
  assert(metrics.viewerH >= metrics.vh * 0.7, `${studioId}: viewer height ${metrics.viewerH} < 70% of viewport ${metrics.vh}`)
  for (const input of metrics.fileInputs) {
    assert(
      input.display === "none" || input.visibility === "hidden" || input.width === 0,
      `${studioId}: file input is visible (display=${input.display}) — .hidden missing?`,
    )
  }
}

async function assertThemeTokens(page: Page) {
  const { light, dark, hasThemeAttr } = await page.evaluate(() => {
    const root = document.documentElement
    const prevTheme = root.dataset.theme
    const prevScheme = root.style.colorScheme
    const readBg = () => getComputedStyle(root).getPropertyValue("--osc-bg").trim()
    root.dataset.theme = "light"
    root.style.colorScheme = "light"
    const light = readBg()
    root.dataset.theme = "dark"
    root.style.colorScheme = "dark"
    const dark = readBg()
    if (prevTheme) root.dataset.theme = prevTheme
    else delete root.dataset.theme
    root.style.colorScheme = prevScheme
    return { light, dark, hasThemeAttr: Boolean(prevTheme) }
  })
  assert(hasThemeAttr, "html[data-theme] missing after theme probe")
  assert(light.length > 0 && dark.length > 0, `theme tokens empty light=${light} dark=${dark}`)
  assert(light !== dark, `--osc-bg should differ light vs dark (light=${light} dark=${dark})`)
}

async function assertAgentClosedLayout(page: Page, studioId: string) {
  const metrics = await page.evaluate(() => {
    const agent = document.querySelector('[aria-label="Agent"]') as HTMLElement | null
    const main = document.querySelector('[data-testid="studio-main"]') as HTMLElement | null
    return {
      agentOpen: agent?.getAttribute("data-agent-open") ?? null,
      agentDisplay: agent ? getComputedStyle(agent).display : null,
      mainWidth: main?.getBoundingClientRect().width ?? 0,
      vw: window.innerWidth,
    }
  })
  assert(metrics.agentOpen === "false", `${studioId}: agent should default closed, data-agent-open=${metrics.agentOpen}`)
  assert(metrics.agentDisplay === "none", `${studioId}: closed agent should be display:none, got ${metrics.agentDisplay}`)
  assert(metrics.mainWidth >= metrics.vw * 0.6, `${studioId}: studio main width ${metrics.mainWidth} < 60% of viewport ${metrics.vw}`)
}

async function assertNoHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
    }
  })
  assert(
    overflow.scrollWidth <= overflow.clientWidth + 1,
    `${label}: horizontal page scroll (scrollWidth=${overflow.scrollWidth} clientWidth=${overflow.clientWidth})`,
  )
}

async function browserSmoke(base: string) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

    await page.goto(`${base}/studio`, { waitUntil: "domcontentloaded" })
    await page.getByRole("heading", { name: "Agent", exact: true }).waitFor()
    await page.locator('[aria-label="Agent"][data-agent-open="true"]').waitFor({ state: "visible", timeout: 15_000 })
    await page.getByRole("textbox", { name: "Ask anything…" }).waitFor()
    await page.getByRole("button", { name: "Open menu" }).click()
    await page.getByRole("link", { name: /Agent/ }).waitFor()
    await page.getByRole("link", { name: /Files/ }).waitFor()
    await page.getByRole("link", { name: /Status/ }).waitFor()
    await page.getByRole("link", { name: /CAD Studio|CAD/ }).waitFor()
    await page.getByRole("link", { name: /PCB Studio|PCB/ }).waitFor()
    await page.getByRole("button", { name: "Close menu" }).click()
    const theme = page.locator("fieldset.osc-theme-toggle")
    await theme.waitFor()
    await theme.getByRole("button", { name: "Dark", exact: true }).click()
    await theme.getByRole("button", { name: "System", exact: true }).click()
    await assertTailwindUtilities(page)
    await assertThemeTokens(page)
    await assertShellFillsViewport(page, "opencode")

    const skipLink = page.getByRole("link", { name: "Skip to main content" })
    await skipLink.focus()
    const skipLinkColors = await skipLink.evaluate((element) => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, color: style.color }
    })
    assert(skipLinkColors.background !== skipLinkColors.color, `skip link text is unreadable: ${JSON.stringify(skipLinkColors)}`)

    const sessionButton = page.locator(".oc-panel__session-btn")
    const generatedLabel = (await sessionButton.innerText()).trim()
    assert(generatedLabel.startsWith("New session"), `generated session label missing: ${generatedLabel}`)
    assert(!generatedLabel.includes("T08:32:31.853Z"), `generated session label exposes raw ISO time: ${generatedLabel}`)
    const composer = page.getByRole("textbox", { name: "Ask anything…" })
    await composer.fill("Draft for generated session")
    await sessionButton.click()
    await page.getByRole("option", { name: "Existing session" }).click()
    assert((await composer.inputValue()) === "", "composer draft leaked into another session")
    await sessionButton.click()
    await page.getByRole("option", { name: /^New session/ }).click()
    assert((await composer.inputValue()) === "Draft for generated session", "composer draft was not restored with its session")
    console.log("agent home ok")

    const studioChecks: Record<string, { wait: string; extra?: (p: Page) => Promise<void> }> = {
      cad: {
        wait: "CAD Studio",
        extra: async (p) => {
          await p.getByRole("navigation", { name: "CAD sections" }).getByRole("link", { name: "Designs", exact: true }).waitFor()
          await p.getByRole("heading", { name: "Designs", exact: true }).waitFor()
          await p.waitForSelector("text=Studio Home")
          assert((await p.getByLabel("Open GLB file").count()) === 0, "cad: local GLB import must not be available")
          assert((await p.locator('input[type="file"]').count()) === 0, "cad: local file input must not be available")
        },
      },
      pcb: {
        wait: "PCB Studio",
        extra: async (p) => {
          await p.waitForSelector("text=Projects")
        },
      },
    }

    for (const id of STUDIO_IDS) {
      const check = studioChecks[id]
      assert(check, `missing studio check for ${id}`)
      // CAD/PCB open long-lived SSE; networkidle never settles.
      await page.goto(`${base}/studio/studios/${id}`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector(`text=${check.wait}`, { timeout: 15_000 })
      await page.getByLabel("Agent", { exact: true }).waitFor({ state: "attached" })
      await page.getByRole("button", { name: /^Agent/ }).waitFor()
      await assertAgentClosedLayout(page, id)
      const uiBase = await page.evaluate(() => (window as any).__OPENCODE_STUDIO__?.uiBase)
      assert(uiBase === `/studios/${id}`, `${id}: router uiBase should be basename-relative, got ${String(uiBase)}`)
      if (check.extra) await check.extra(page)
      await assertShellFillsViewport(page, id)
      assert((await page.title()) === `${id.toUpperCase()} · OpenCode Studio`, `${id}: unexpected document title ${await page.title()}`)
      await assertNoHorizontalScroll(page, `1280 ${id}`)
      // Studio utilities still present after lazy CSS load
      await assertTailwindUtilities(page)
      console.log(`studio ${id} ok`)
    }

    await page.goto(`${base}/studio/files`, { waitUntil: "networkidle" })
    await page.waitForSelector("text=Home", { timeout: 15_000 })
    const filesFilter = page.getByRole("searchbox", { name: "Filter files" })
    await filesFilter.focus()
    await filesFilter.fill("README")
    await filesFilter.press("ArrowDown")
    const focusedFile = await page.evaluate(() => document.activeElement?.textContent ?? "")
    assert(focusedFile.includes("README.md"), `files: ArrowDown should focus first row, got ${focusedFile}`)
    await page.keyboard.press("Enter")
    await page.getByText("README.md", { exact: true }).last().waitFor()
    const filesAgentButtons = await page.getByRole("button", { name: /^Agent/ }).count()
    const filesAgentFrames = await page.locator('[aria-label="Agent"]').count()
    assert(filesAgentButtons === 0, `files: agent button should not render, got ${filesAgentButtons}`)
    assert(filesAgentFrames === 0, `files: agent panel should not mount, got ${filesAgentFrames}`)
    await assertShellFillsViewport(page, "files")
    assert((await page.title()) === "Files · OpenCode Studio", `files: unexpected document title ${await page.title()}`)
    await assertNoHorizontalScroll(page, "1280 files")
    console.log("files explorer ok")

    // Phone posture: no forced horizontal page scroll on home + one studio
    await page.setViewportSize({ width: 360, height: 640 })
    await page.goto(`${base}/studio/files`, { waitUntil: "networkidle" })
    await page.getByRole("button", { name: "Open menu" }).click()
    await page.getByRole("link", { name: /Files/ }).waitFor()
    const mobileDrawerWidth = await page.locator("aside").evaluate((element) => element.getBoundingClientRect().width)
    assert(mobileDrawerWidth >= 359, `360 menu: drawer should be full width, got ${mobileDrawerWidth}`)
    await assertNoHorizontalScroll(page, "360 menu")
    await page.getByRole("button", { name: "Close menu" }).click()
    await page.goto(`${base}/studio`, { waitUntil: "domcontentloaded" })
    await page.getByRole("heading", { name: "Agent", exact: true }).waitFor()
    await assertNoHorizontalScroll(page, "360 agent")
    await page.goto(`${base}/studio/studios/cad`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector("text=CAD Studio", { timeout: 15_000 })
    await page.getByRole("heading", { name: "Designs", exact: true }).waitFor()
    await assertNoHorizontalScroll(page, "360 cad")
    const toolbarCount = await page.locator(".cad-toolbar").count()
    if (toolbarCount > 0) {
      const compactToolbar = await page.locator(".cad-toolbar").evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }))
      assert(
        compactToolbar.scrollHeight <= compactToolbar.clientHeight + 1,
        `360 cad: toolbar wrapped vertically (${compactToolbar.scrollHeight}px > ${compactToolbar.clientHeight}px)`,
      )
    }
    await page.goto(`${base}/studio/studios/pcb`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector("text=PCB Studio", { timeout: 15_000 })
    await page.getByRole("navigation").getByRole("link", { name: "Projects" }).waitFor()
    const pcbMainCount = await page.locator("main").count()
    assert(pcbMainCount === 1, `360 pcb: expected one main landmark, got ${pcbMainCount}`)
    await assertNoHorizontalScroll(page, "360 pcb")
    console.log("360 smoke ok")

    await page.goto(`${base}/studio/studios/pcb/catalog`, { waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: "TEST-1" }).click()
    await page.getByRole("dialog").waitFor()
    await page.getByRole("button", { name: "Close dialog" }).click()
    await page.waitForURL(`${base}/studio/studios/pcb/catalog`)
    await page.goBack({ waitUntil: "domcontentloaded" })
    assert(!page.url().includes("part="), `catalog: Back reopened the closed part modal (${page.url()})`)
    assert((await page.getByRole("dialog").count()) === 0, "catalog: Back should not reopen the closed part modal")
    console.log("catalog history ok")

    await page.goto(`${base}/studio/studios/cad`, { waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: /^Agent/ }).click()
    const mobileAgentPanel = page.locator('[aria-label="Agent"][data-agent-open="true"]')
    await mobileAgentPanel.waitFor({ state: "visible", timeout: 30_000 })
    const mobileAgentClose = page.getByRole("button", { name: "Close agent" })
    await mobileAgentClose.focus()
    await page.keyboard.press("Tab")
    const mobileAgentFocus = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      insidePanel: Boolean(document.querySelector('[aria-label="Agent"]')?.contains(document.activeElement)),
    }))
    assert(
      mobileAgentFocus.insidePanel && mobileAgentFocus.tag !== "BODY",
      `360 agent: focus should stay in the native panel, got ${JSON.stringify(mobileAgentFocus)}`,
    )
    await mobileAgentClose.click()
    console.log("360 agent focus ok")

    // Native agent panel: closed by default; open once and confirm bounded composer.
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`${base}/studio/studios/cad`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector("text=CAD Studio", { timeout: 15_000 })
    await assertAgentClosedLayout(page, "cad-pre-open")
    const iframeBefore = await page.locator('iframe[title="OpenCode agent"]').count()
    assert(iframeBefore === 0, `native agent must not render an iframe, got ${iframeBefore}`)
    await page.getByRole("button", { name: /^Agent/ }).click()
    const nativePanel = page.locator('[aria-label="Agent"][data-agent-open="true"]')
    await nativePanel.waitFor({ state: "visible", timeout: 10_000 })
    const nativeMetrics = await nativePanel.evaluate((panel) => {
      const dock = panel.querySelector(".oc-dock")?.getBoundingClientRect()
      return {
        panelBottom: panel.getBoundingClientRect().bottom,
        dockBottom: dock?.bottom ?? Number.POSITIVE_INFINITY,
        vh: window.innerHeight,
      }
    })
    assert(nativeMetrics.panelBottom <= nativeMetrics.vh + 1, `agent panel exceeds viewport: ${JSON.stringify(nativeMetrics)}`)
    assert(nativeMetrics.dockBottom <= nativeMetrics.vh + 1, `agent composer is clipped: ${JSON.stringify(nativeMetrics)}`)
    await page.getByRole("button", { name: "Close agent" }).click()
    await page.waitForSelector('[data-agent-open="false"]', { state: "attached", timeout: 5_000 })
    await assertAgentClosedLayout(page, "cad-post-close")
    const panelAfterClose = await page.locator('[aria-label="Agent"]').count()
    assert(panelAfterClose === 1, `agent panel should stay mounted after close, got ${panelAfterClose}`)
    console.log("native agent panel ok")
  } finally {
    await browser.close()
  }
  console.log("browser-smoke ok")
}

async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") })
  const port = probe.port
  probe.stop(true)
  assert(typeof port === "number" && port > 0, "failed to allocate free port")
  return port
}

const studioConfigHome = path.join(workspace, "studio-config")
const openCodeHome = path.join(workspace, "opencode-config")
const domain = path.join(workspace, "domain")
await import("node:fs/promises").then(async ({ mkdir, writeFile }) => {
  await mkdir(domain, { recursive: true })
  await writeFile(path.join(domain, "README.md"), "# Browser smoke fixture\n")
  const catalogDir = path.join(domain, "studio", "circuits", "catalog", "parts")
  await mkdir(catalogDir, { recursive: true })
  await writeFile(
    path.join(catalogDir, "TEST-1.yml"),
    "mpn: TEST-1\nmanufacturer: Studio QA\ndescription: Browser history fixture\ncategory: test\n",
  )
})

let exitCode = 0
try {
  await configureStudios({
    workspace: domain,
    studioConfigHome,
    openCodeHome,
    packageRoot: root,
    validateOpenCode: false,
  })
  // Bind a concrete loopback port so Host-header allowlisting matches the browser.
  const port = await freePort()
  const parent = Bun.serve({
    port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname
      if (pathname === "/global/health") return Response.json({ healthy: true, version: "smoke" })
      if (pathname === "/session") {
        return Response.json([
          {
            id: "session-generated",
            title: "New session - 2026-08-09T08:32:31.853Z",
            time: { created: 1_786_264_351_853, updated: 1_786_264_351_853 },
          },
          {
            id: "session-existing",
            title: "Existing session",
            time: { created: 1_786_264_300_000, updated: 1_786_264_300_000 },
          },
        ])
      }
      if (/^\/session\/[^/]+\/(?:message|diff)$/.test(pathname)) return Response.json([])
      if (pathname === "/config/providers") {
        return Response.json({
          providers: [{ id: "smoke", key: "test", source: "api", models: { "smoke-model": {} } }],
          default: { smoke: "smoke-model" },
        })
      }
      if (pathname === "/event") return new Response("", { headers: { "Content-Type": "text/event-stream" } })
      return new Response("<!doctype html><title>OpenCode</title><div id='root'>stub parent</div>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    },
  })
  const { url, stop } = await startHost({
    studioRoot: domain,
    studioConfigHome,
    openCodeHome,
    packageRoot: root,
    hostname: "127.0.0.1",
    port,
    uiDirectory,
    parentOpenCodeUrl: `http://127.0.0.1:${parent.port}`,
  })
  try {
    await httpSmoke(url)
    await browserSmoke(url)
  } finally {
    stop()
    parent.stop(true)
  }
} catch (error) {
  exitCode = 1
  console.error(error instanceof Error ? (error.stack ?? error.message) : error)
} finally {
  await rm(workspace, { recursive: true, force: true })
}
// Force exit: residual OpenCode/watch handles must not hang release:check.
process.exit(exitCode)
