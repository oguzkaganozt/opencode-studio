import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { $ } from "bun"
import {
  type CheckResult,
  type StudioTarget,
  SCHEMA_PATH,
  assert,
  packStudio,
  readJson,
  runStudioCli,
  startStudioCompanion,
  tempDir,
  treeDigest,
  writeJson,
} from "../helpers"

// OSC-common black-box checks that apply to any Studio package root, not just
// Reference Studio. Skips reference-only surfaces (notes API, nested error
// envelope, symlink escape tests) that are not part of the minimal contract.

function validateManifestShape(manifest: Record<string, unknown>) {
  const required = ["schemaVersion", "id", "contractVersion", "minimumOpenCode", "plugin", "skill"]
  for (const key of required) {
    if (!(key in manifest)) throw new Error(`Manifest missing required field: ${key}`)
  }
  for (const key of Object.keys(manifest)) {
    if (!required.includes(key)) throw new Error(`Manifest has unknown field: ${key}`)
  }
  if (manifest.schemaVersion !== 1) throw new Error("schemaVersion must be 1")
  if (typeof manifest.id !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(manifest.id)) {
    throw new Error("Invalid manifest id")
  }
  if (
    typeof manifest.contractVersion !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.contractVersion)
  ) {
    throw new Error("Invalid contractVersion")
  }
  if (typeof manifest.minimumOpenCode !== "string" || !manifest.minimumOpenCode) {
    throw new Error("Invalid minimumOpenCode")
  }
  if (typeof manifest.plugin !== "string" || !manifest.plugin) throw new Error("Invalid plugin")
  if (typeof manifest.skill !== "string" || !/^\.\.?\/.*/.test(manifest.skill)) {
    throw new Error("Invalid skill path")
  }
}

function portFor(studioId: string, offset: number) {
  let hash = 0
  for (const ch of studioId) hash = (hash * 31 + ch.charCodeAt(0)) % 5000
  return 44000 + hash * 5 + offset
}

async function withResult(name: string, run: () => Promise<void>): Promise<CheckResult> {
  try {
    await run()
    return { name, ok: true }
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

async function checkManifest(target: StudioTarget): Promise<CheckResult> {
  return withResult("manifest", async () => {
    const schema = await readJson<Record<string, unknown>>(SCHEMA_PATH)
    assert(schema.title === "OpenCode Studio Manifest", "schema title mismatch")

    const manifest = await readJson<Record<string, unknown>>(path.join(target.root, "opencode-studio.json"))
    validateManifestShape(manifest)
    assert(manifest.id === target.studioId, "manifest id mismatch")
    assert(manifest.plugin === target.pluginManifestPath, "manifest plugin mismatch")

    const skillFile = path.join(target.root, target.skillRel, "SKILL.md")
    assert(await Bun.file(skillFile).exists(), `skill file missing: ${skillFile}`)

    const pkg = await readJson<{
      name: string
      exports?: Record<string, string>
      bin?: Record<string, string> | string
    }>(path.join(target.root, "package.json"))
    assert(pkg.name === target.packageName, "package name mismatch")

    const exportPath = pkg.exports?.[target.pluginManifestPath]
    assert(typeof exportPath === "string" && exportPath.length > 0, `package exports missing key ${target.pluginManifestPath}`)
    const resolvedExport = path.resolve(target.root, exportPath)
    assert(await Bun.file(resolvedExport).exists(), `plugin export target missing: ${resolvedExport}`)

    const binEntry = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[pkg.name]
    assert(typeof binEntry === "string" && binEntry.length > 0, "cli bin missing")
  })
}

async function checkInstallDryRun(target: StudioTarget): Promise<CheckResult> {
  return withResult("lifecycle.install-dry-run", async () => {
    const root = await tempDir(`${target.studioId}-dry`)
    const configHome = path.join(root, "config")
    const dry = await runStudioCli(target, ["install", "--scope", "user", "--dry-run", "--json", "--config-home", configHome])
    assert(dry.exitCode === 0, `dry-run failed: ${dry.stderr}`)
    const payload = JSON.parse(dry.stdout) as { dryRun: boolean; plugin: string }
    assert(payload.dryRun === true, "dryRun flag")
    assert(payload.plugin === target.pluginSpecifier, `plugin specifier mismatch: ${payload.plugin}`)
  })
}

async function checkInstallIdempotent(target: StudioTarget): Promise<CheckResult> {
  return withResult("lifecycle.install-idempotent", async () => {
    const root = await tempDir(`${target.studioId}-idempotent`)
    const configHome = path.join(root, "config")

    await writeJson(path.join(configHome, "opencode", "opencode.json"), {
      $schema: "https://opencode.ai/config.json",
      model: "keep-me",
      plugin: ["unrelated-plugin"],
    })

    const install = await runStudioCli(target, ["install", "--scope", "user", "--json", "--config-home", configHome])
    assert(install.exitCode === 0, `install failed: ${install.stderr}\n${install.stdout}`)

    const config = await readJson<{ model: string; plugin: string[] }>(path.join(configHome, "opencode", "opencode.json"))
    assert(config.model === "keep-me", "unrelated config lost")
    assert(config.plugin.includes("unrelated-plugin"), "unrelated plugin lost")
    assert(config.plugin.includes(target.pluginSpecifier), "plugin not registered")

    const skill = await readFile(path.join(configHome, "opencode/skills", target.skillName, "SKILL.md"), "utf8")
    assert(skill.length > 0, "skill missing")
    const marker = await readJson<{ studioId: string; digest: string }>(
      path.join(configHome, "opencode/skills", target.skillName, ".osc-managed.json"),
    )
    assert(marker.studioId === target.studioId, "marker studioId")
    assert(marker.digest.length === 64, "marker digest")

    const again = await runStudioCli(target, ["install", "--scope", "user", "--json", "--config-home", configHome])
    assert(again.exitCode === 0, `idempotent install failed: ${again.stderr}`)
    const config2 = await readJson<{ plugin: string[] }>(path.join(configHome, "opencode", "opencode.json"))
    assert(
      config2.plugin.filter((entry) => entry === target.pluginSpecifier).length === 1,
      "duplicate plugin registration",
    )
  })
}

async function checkSkillModifiedConflict(target: StudioTarget): Promise<CheckResult> {
  return withResult("lifecycle.skill-user-modified-conflict", async () => {
    const root = await tempDir(`${target.studioId}-conflict`)
    const configHome = path.join(root, "config")

    const install = await runStudioCli(target, ["install", "--scope", "user", "--json", "--config-home", configHome])
    assert(install.exitCode === 0, `initial install failed: ${install.stderr}`)

    await writeFile(path.join(configHome, "opencode/skills", target.skillName, "SKILL.md"), "# user modified\n")
    const conflict = await runStudioCli(target, ["install", "--scope", "user", "--json", "--config-home", configHome])
    assert(conflict.exitCode !== 0, "expected conflict on modified skill")
    assert(conflict.stderr.toLowerCase().includes("conflict") || conflict.stderr.toLowerCase().includes("modified"), conflict.stderr)
  })
}

async function checkRemove(target: StudioTarget): Promise<CheckResult> {
  return withResult("lifecycle.remove", async () => {
    const root = await tempDir(`${target.studioId}-remove`)
    const configHome = path.join(root, "config")

    await writeJson(path.join(configHome, "opencode", "opencode.json"), {
      plugin: ["other-unrelated-plugin"],
    })
    const install = await runStudioCli(target, ["install", "--scope", "user", "--json", "--config-home", configHome])
    assert(install.exitCode === 0, `install failed: ${install.stderr}`)

    const skillFile = path.join(configHome, "opencode/skills", target.skillName, "SKILL.md")
    const markerFile = path.join(configHome, "opencode/skills", target.skillName, ".osc-managed.json")
    assert(await Bun.file(skillFile).exists(), "skill not installed before remove")
    assert(await Bun.file(markerFile).exists(), "marker not installed before remove")

    const remove = await runStudioCli(target, ["remove", "--scope", "user", "--json", "--config-home", configHome])
    assert(remove.exitCode === 0, `remove failed: ${remove.stderr}`)

    assert(!(await Bun.file(skillFile).exists()), "managed skill was not deleted")
    assert(!(await Bun.file(markerFile).exists()), "managed marker was not deleted")

    const config = await readJson<{ plugin: string[] }>(path.join(configHome, "opencode", "opencode.json"))
    assert(config.plugin.includes("other-unrelated-plugin"), "unrelated plugin removed")
    assert(!config.plugin.includes(target.pluginSpecifier), "plugin still registered after remove")
  })
}

async function checkDoctorJson(target: StudioTarget): Promise<CheckResult> {
  return withResult("lifecycle.doctor-json", async () => {
    const root = await tempDir(`${target.studioId}-doctor`)
    const doctor = await runStudioCli(target, ["doctor", "--scope", "user", "--json", "--config-home", path.join(root, "cfg")])
    assert(doctor.exitCode === 0, `doctor failed: ${doctor.stderr}`)
    const payload = JSON.parse(doctor.stdout) as { status: string; checks: Array<{ id: string }> }
    assert(payload.checks.some((check) => check.id === "manifest"), "doctor missing manifest check")
  })
}

async function checkCompanionHealthIdentity(target: StudioTarget): Promise<CheckResult> {
  return withResult("companion.health-identity-readonly", async () => {
    const root = await tempDir(`${target.studioId}-companion`)
    const dataRoot = path.join(root, "data")
    await mkdir(dataRoot, { recursive: true })

    const before = await treeDigest(dataRoot)
    const companion = await startStudioCompanion(target, dataRoot, portFor(target.studioId, 0))
    try {
      const headers = { Host: `127.0.0.1:${companion.port}` }
      const health = await fetch(`${companion.baseUrl}/api/health`, { headers })
      assert(health.ok, "health not ok")
      assert((await health.json()).status === "ok", "health body")

      const studio = await fetch(`${companion.baseUrl}/api/studio`, { headers })
      assert(studio.ok, "studio not ok")
      const identity = (await studio.json()) as { id: string; packageVersion: string; contractVersion: string }
      assert(identity.id === target.studioId, `studio id mismatch: ${identity.id}`)
      assert(identity.packageVersion === target.packageVersion, `package version mismatch: ${identity.packageVersion}`)
      assert(identity.contractVersion === target.contractVersion, `contract version mismatch: ${identity.contractVersion}`)

      await fetch(`${companion.baseUrl}/api/health`, { headers })
      await fetch(`${companion.baseUrl}/api/studio`, { headers })

      const after = await treeDigest(dataRoot)
      assert(before === after, "Data Root mutated during companion tests")
    } finally {
      await companion.stop()
    }
  })
}

async function checkCompanionRequiresExistingRoot(target: StudioTarget): Promise<CheckResult> {
  return withResult("companion.requires-existing-root", async () => {
    const root = await tempDir(`${target.studioId}-missing-root`)
    const missingRoot = path.join(root, "missing")
    const result = await runStudioCli(target, ["serve", "--root", missingRoot, "--port", String(portFor(target.studioId, 1))])
    assert(result.exitCode !== 0, "serve must require existing root")
  })
}

async function checkSecurity(target: StudioTarget): Promise<CheckResult> {
  return withResult("security.host-csp-nosniff", async () => {
    const root = await tempDir(`${target.studioId}-security`)
    const dataRoot = path.join(root, "data")
    await mkdir(dataRoot, { recursive: true })

    const before = await treeDigest(dataRoot)
    const companion = await startStudioCompanion(target, dataRoot, portFor(target.studioId, 2))
    try {
      const headers = { Host: `127.0.0.1:${companion.port}` }

      const health = await fetch(`${companion.baseUrl}/api/health`, { headers })
      assert(health.headers.get("x-content-type-options") === "nosniff", "nosniff missing")
      const csp = health.headers.get("content-security-policy") ?? ""
      assert(csp.includes("frame-ancestors 'none'"), "csp framing")
      assert(csp.includes("base-uri 'none'"), "csp base-uri")

      const badHost = Bun.spawn(
        ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-H", "Host: evil.example", `${companion.baseUrl}/api/health`],
        { stdout: "pipe", stderr: "pipe" },
      )
      const badHostCode = await new Response(badHost.stdout).text()
      await badHost.exited
      assert(badHostCode.trim() === "400", `host validation got ${badHostCode}`)

      const postStudio = await fetch(`${companion.baseUrl}/api/studio`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ mutate: true }),
      })
      assert(postStudio.status < 200 || postStudio.status >= 300, "POST /api/studio must not succeed")

      const nonsense = await fetch(`${companion.baseUrl}/api/osc-conformance-nonsense-mutation`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ mutate: true }),
      })
      assert(nonsense.status === 404, "unknown mutation path should 404")

      const after = await treeDigest(dataRoot)
      assert(before === after, "Data Root mutated during security tests")
    } finally {
      await companion.stop()
    }
  })
}

async function checkViewerStackTokens(target: StudioTarget): Promise<CheckResult> {
  return withResult("viewer.stack-tokens", async () => {
    const pkg = await readJson<{ dependencies: Record<string, string>; devDependencies?: Record<string, string> }>(
      path.join(target.root, "package.json"),
    )
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    for (const name of ["react", "react-dom", "react-router", "@tanstack/react-query", "vite", "tailwindcss"]) {
      assert(deps[name], `missing dependency ${name}`)
    }
    assert(deps.react.startsWith("19."), `react major: ${deps.react}`)

    const tokens = await Bun.file(target.tokensPath).text()
    assert(tokens.includes("--osc-bg"), "tokens missing --osc-bg")
    assert(/--osc-accent-(cad|media|pcb)/.test(tokens), "tokens missing an --osc-accent-* value")

    const indexPath = path.join(target.uiDist, "index.html")
    assert(await Bun.file(indexPath).exists(), `built UI index.html missing: ${indexPath}`)
    const index = await Bun.file(indexPath).text()
    assert(!/https?:\/\/cdn\./i.test(index), "runtime CDN in index.html")
    assert(!/fonts\.googleapis/i.test(index), "google fonts CDN")
  })
}

async function checkViewerLoadReadonly(target: StudioTarget): Promise<CheckResult> {
  return withResult("viewer.load-readonly", async () => {
    const root = await tempDir(`${target.studioId}-viewer`)
    const dataRoot = path.join(root, "data")
    await mkdir(dataRoot, { recursive: true })

    const before = await treeDigest(dataRoot)
    const companion = await startStudioCompanion(target, dataRoot, portFor(target.studioId, 3))
    try {
      const headers = { Host: `127.0.0.1:${companion.port}` }
      const home = await fetch(`${companion.baseUrl}/`, { headers })
      assert(home.ok, "viewer home")
      const homeHtml = await home.text()
      assert(/<html/i.test(homeHtml), "viewer home is not HTML")

      const deep = await fetch(`${companion.baseUrl}/osc-spa-fallback-path`, { headers })
      assert(deep.ok, "deep link spa fallback")
      const deepHtml = await deep.text()
      assert(/<html/i.test(deepHtml), "spa fallback is not HTML")

      const after = await treeDigest(dataRoot)
      assert(before === after, "viewer must not mutate Data Root")
    } finally {
      await companion.stop()
    }
  })
}

async function checkPluginPackedLoad(target: StudioTarget): Promise<CheckResult> {
  return withResult("plugin.packed-load", async () => {
    const root = await tempDir(`${target.studioId}-plugin-load`)
    const packDir = path.join(root, "pack")
    const consumer = path.join(root, "consumer")
    await mkdir(consumer, { recursive: true })

    const tarball = await packStudio(target, packDir)
    await writeFile(
      path.join(consumer, "package.json"),
      JSON.stringify({ name: "osc-consumer", private: true, type: "module" }, null, 2),
    )
    await $`bun add ${tarball}`.cwd(consumer)

    const installedRoot = path.join(consumer, "node_modules", target.packageName)
    const manifest = await readJson<{ plugin: string }>(path.join(installedRoot, "opencode-studio.json"))
    assert(manifest.plugin === target.pluginManifestPath, "packed manifest plugin mismatch")

    const pkg = await readJson<{ exports: Record<string, string> }>(path.join(installedRoot, "package.json"))
    const exportPath = pkg.exports[target.pluginManifestPath]
    assert(typeof exportPath === "string" && exportPath.length > 0, `export map missing key ${target.pluginManifestPath}`)

    const resolved = await import(path.join(installedRoot, exportPath))
    assert(typeof resolved.default === "function", "resolved plugin export is not a function")
  })
}

async function checkRuntimeNoOscDependency(target: StudioTarget): Promise<CheckResult> {
  return withResult("runtime.no-osc-dependency", async () => {
    const pkg = await readJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(
      path.join(target.root, "package.json"),
    )
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    for (const name of Object.keys(deps)) {
      assert(name !== "opencode-studio-contract", `runtime dependency on ${name}`)
      assert(!name.startsWith("@opencode-studio/"), `runtime dependency on ${name}`)
    }
  })
}

export async function testStudioCore(target: StudioTarget): Promise<CheckResult[]> {
  const checks = [
    checkManifest,
    checkInstallDryRun,
    checkInstallIdempotent,
    checkSkillModifiedConflict,
    checkRemove,
    checkDoctorJson,
    checkCompanionHealthIdentity,
    checkCompanionRequiresExistingRoot,
    checkSecurity,
    checkViewerStackTokens,
    checkViewerLoadReadonly,
    checkPluginPackedLoad,
    checkRuntimeNoOscDependency,
  ]

  const results: CheckResult[] = []
  for (const check of checks) {
    results.push(await check(target))
  }
  return results
}
