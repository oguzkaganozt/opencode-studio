#!/usr/bin/env bun

import path from "node:path"
import { testCompanion, testSecurity } from "./cases/companion"
import { testLifecycle } from "./cases/lifecycle"
import { testManifest } from "./cases/manifest"
import { testPluginLoad } from "./cases/plugin-load"
import { testStudioCore } from "./cases/studio-core"
import { testViewer } from "./cases/viewer"
import { type CheckResult, REPO_ROOT, ensureReferenceBuilt, ensureStudioBuilt, loadStudioTarget } from "./helpers"

const SIBLING_STUDIOS = ["../opencode-cad-studio", "../opencode-media-studio", "../opencode-pcb-studio"]

function report(results: CheckResult[]) {
  let failed = 0
  for (const result of results) {
    const mark = result.ok ? "PASS" : "FAIL"
    if (!result.ok) failed += 1
    console.log(`${mark}  ${result.name}${result.detail ? ` — ${result.detail}` : ""}`)
  }
  console.log(`\n${results.length - failed}/${results.length} checks passed`)
  return failed
}

async function runReferenceSuite() {
  console.log("OSC conformance — building reference studio if needed…")
  await ensureReferenceBuilt()

  const suites: Array<() => Promise<CheckResult[]>> = [
    testManifest,
    testLifecycle,
    testCompanion,
    testSecurity,
    testViewer,
    testPluginLoad,
  ]

  const results: CheckResult[] = []
  for (const suite of suites) {
    results.push(...(await suite()))
  }
  return results
}

async function runStudioCoreSuite(studioPath: string) {
  const target = await loadStudioTarget(studioPath)
  console.log(`\nOSC studio-core conformance — target: ${target.packageName} (${target.root})`)
  await ensureStudioBuilt(target)
  return testStudioCore(target)
}

async function main() {
  const args = process.argv.slice(2)
  const studioIndex = args.indexOf("--studio")
  const runStudios = args.includes("--studios")

  let failed = 0

  if (studioIndex !== -1) {
    const studioPath = args[studioIndex + 1]
    if (!studioPath) {
      console.error("--studio requires a path argument")
      process.exit(1)
    }
    const results = await runStudioCoreSuite(path.resolve(process.cwd(), studioPath))
    failed += report(results)
  } else if (runStudios) {
    for (const relative of SIBLING_STUDIOS) {
      const studioPath = path.resolve(REPO_ROOT, relative)
      const results = await runStudioCoreSuite(studioPath)
      failed += report(results)
    }
  } else {
    console.log("OSC conformance — target: reference-studio")
    const results = await runReferenceSuite()
    failed += report(results)
  }

  if (failed > 0) process.exit(1)
}

await main()
