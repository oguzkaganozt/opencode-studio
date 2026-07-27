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
    const viewer = document.querySelector(`.studio-shell [data-studio="${id}"]`) as HTMLElement | null
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
    const agent = document.querySelector('[aria-label="OpenCode agent"]') as HTMLElement | null
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

    await page.goto(`${base}/studio`, { waitUntil: "networkidle" })
    await page.waitForSelector("text=Studios")
    await page.waitForSelector("text=CAD Studio")
    await page.getByRole("button", { name: "Open menu" }).click()
    await page.getByRole("button", { name: "Settings" }).click()
    await page.waitForSelector("text=Repair install")
    await page.getByRole("button", { name: "Close menu" }).click()
    await assertTailwindUtilities(page)
    await assertThemeTokens(page)
    console.log("home ok")

    const studioChecks: Record<string, { wait: string; extra?: (p: Page) => Promise<void> }> = {
      cad: {
        wait: "CAD Studio",
        extra: async (p) => {
          await p.waitForSelector("text=Designs")
          await p.waitForSelector("text=Parts")
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
      await page.getByLabel("OpenCode agent").waitFor({ state: "attached" })
      await page.getByRole("button", { name: "Agent", exact: true }).waitFor()
      await assertAgentClosedLayout(page, id)
      const uiBase = await page.evaluate(() => (window as any).__OPENCODE_STUDIO__?.uiBase)
      assert(uiBase === `/studios/${id}`, `${id}: router uiBase should be basename-relative, got ${String(uiBase)}`)
      if (check.extra) await check.extra(page)
      await assertShellFillsViewport(page, id)
      await assertNoHorizontalScroll(page, `1280 ${id}`)
      // Studio utilities still present after lazy CSS load
      await assertTailwindUtilities(page)
      console.log(`studio ${id} ok`)
    }

    await page.goto(`${base}/studio/files`, { waitUntil: "networkidle" })
    await page.waitForSelector("text=workspace", { timeout: 15_000 })
    await page.getByRole("button", { name: "Agent", exact: true }).waitFor()
    await assertShellFillsViewport(page, "files")
    await assertNoHorizontalScroll(page, "1280 files")
    console.log("files explorer ok")

    // Phone posture: no forced horizontal page scroll on home + one studio
    await page.setViewportSize({ width: 360, height: 640 })
    await page.goto(`${base}/studio`, { waitUntil: "networkidle" })
    await page.waitForSelector("text=Studios")
    await assertNoHorizontalScroll(page, "360 home")
    await page.goto(`${base}/studio/studios/cad`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector("text=CAD Studio", { timeout: 15_000 })
    await assertNoHorizontalScroll(page, "360 cad")
    console.log("360 smoke ok")

    // Native agent iframe: closed by default; open once and confirm same-origin frame
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`${base}/studio/studios/cad`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector("text=CAD Studio", { timeout: 15_000 })
    await assertAgentClosedLayout(page, "cad-pre-open")
    const iframeBefore = await page.locator('iframe[title="OpenCode agent"]').count()
    assert(iframeBefore === 0, `agent iframe should not mount while closed, got ${iframeBefore}`)
    await page.getByRole("button", { name: "Agent", exact: true }).click()
    await page.waitForSelector('[data-agent-open="true"]', { timeout: 10_000 })
    const frame = page.frameLocator('iframe[title="OpenCode agent"]')
    await frame.locator("body").waitFor({ timeout: 30_000 })
    const frameUrl = await page.locator('iframe[title="OpenCode agent"]').getAttribute("src")
    assert(frameUrl === "/" || frameUrl?.startsWith("/"), `unexpected agent iframe src=${String(frameUrl)}`)
    await page.getByRole("button", { name: "Close agent" }).click()
    await page.waitForSelector('[data-agent-open="false"]', { state: "attached", timeout: 5_000 })
    await assertAgentClosedLayout(page, "cad-post-close")
    const iframeAfterClose = await page.locator('iframe[title="OpenCode agent"]').count()
    assert(iframeAfterClose === 1, `agent iframe should stay mounted after close, got ${iframeAfterClose}`)
    console.log("native agent iframe ok")
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
await import("node:fs/promises").then(({ mkdir }) => mkdir(domain, { recursive: true }))

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
  const { url, stop } = await startHost({
    workspace: domain,
    studioConfigHome,
    openCodeHome,
    packageRoot: root,
    hostname: "127.0.0.1",
    port,
    uiDirectory,
  })
  try {
    await httpSmoke(url)
    await browserSmoke(url)
  } finally {
    stop()
  }
} finally {
  await rm(workspace, { recursive: true, force: true })
}
