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
  const apiProbes: Array<[string, string]> = [
    ["cad", "/api/studios/cad/designs"],
    ["media", "/api/studios/media/assets"],
    ["pcb", "/api/studios/pcb/projects"],
    ["startup", "/api/studios/startup/candidates"],
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
    await page.waitForSelector("text=Apply selection")
    await page.getByRole("button", { name: "Close menu" }).click()
    await assertTailwindUtilities(page)
    console.log("home ok")

    const studioChecks: Record<string, { wait: string; extra?: (p: Page) => Promise<void> }> = {
      cad: {
        wait: "CAD Studio",
        extra: async (p) => {
          await p.waitForSelector("text=Designs")
          await p.waitForSelector("text=Parts")
        },
      },
      media: {
        wait: "Media Library",
      },
      pcb: {
        wait: "PCB Studio",
        extra: async (p) => {
          await p.waitForSelector("text=Projects")
        },
      },
      startup: {
        wait: "Startup Studio",
        extra: async (p) => {
          await p.waitForSelector("text=Pool")
          await p.waitForSelector("text=Candidates")
        },
      },
    }

    for (const id of STUDIO_IDS) {
      const check = studioChecks[id]
      assert(check, `missing studio check for ${id}`)
      await page.goto(`${base}/studio/studios/${id}`, { waitUntil: "networkidle" })
      await page.waitForSelector(`text=${check.wait}`, { timeout: 15_000 })
      await page.getByLabel("OpenCode agent").waitFor()
      await page.getByRole("button", { name: "Agent", exact: true }).waitFor()
      const uiBase = await page.evaluate(() => (window as any).__OPENCODE_STUDIO__?.uiBase)
      assert(uiBase === `/studios/${id}`, `${id}: router uiBase should be basename-relative, got ${String(uiBase)}`)
      if (check.extra) await check.extra(page)
      await assertShellFillsViewport(page, id)
      // Studio utilities still present after lazy CSS load
      await assertTailwindUtilities(page)
      console.log(`studio ${id} ok`)
    }
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
    enabled: [...STUDIO_IDS],
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
