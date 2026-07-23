import { mkdir, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { REFERENCE_ROOT, type CheckResult, assert, readJson, startCompanion, tempDir, treeDigest, writeJson } from "../helpers"

export async function testCompanion(): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  const [pkg, manifest] = await Promise.all([
    readJson<{ version: string }>(path.join(REFERENCE_ROOT, "package.json")),
    readJson<{ contractVersion: string }>(path.join(REFERENCE_ROOT, "opencode-studio.json")),
  ])
  const root = await tempDir("companion")
  const dataRoot = path.join(root, "data")
  await mkdir(dataRoot, { recursive: true })
  await writeJson(path.join(dataRoot, "alpha.note.json"), {
    id: "alpha",
    title: "Alpha",
    body: "First note",
  })

  const before = await treeDigest(dataRoot)
  const companion = await startCompanion(dataRoot, 43101)
  try {
    const health = await fetch(`${companion.baseUrl}/api/health`, {
      headers: { Host: `127.0.0.1:${companion.port}` },
    })
    assert(health.ok, "health not ok")
    assert((await health.json()).status === "ok", "health body")

    const studio = await fetch(`${companion.baseUrl}/api/studio`, {
      headers: { Host: `127.0.0.1:${companion.port}` },
    })
    assert(studio.ok, "studio not ok")
    const identity = (await studio.json()) as {
      id: string
      packageVersion: string
      contractVersion: string
    }
    assert(identity.id === "reference", "studio id")
    assert(identity.packageVersion === pkg.version, "package version")
    assert(identity.contractVersion === manifest.contractVersion, "contract version")

    const notes = await fetch(`${companion.baseUrl}/api/notes`, {
      headers: { Host: `127.0.0.1:${companion.port}` },
    })
    assert(notes.ok, "notes list")
    const listed = (await notes.json()) as { notes: Array<{ id: string }> }
    assert(listed.notes.some((n) => n.id === "alpha"), "alpha missing")

    const missing = await fetch(`${companion.baseUrl}/api/does-not-exist`, {
      headers: { Host: `127.0.0.1:${companion.port}` },
    })
    assert(missing.status === 404, "unknown api should 404")
    const missingBody = (await missing.json()) as { error: { code: string } }
    assert(missingBody.error?.code === "not_found", "error envelope")

    const after = await treeDigest(dataRoot)
    assert(before === after, "Data Root mutated during companion tests")
    results.push({ name: "companion.health-identity-readonly", ok: true })
  } catch (error) {
    results.push({
      name: "companion.health-identity-readonly",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  } finally {
    await companion.stop()
  }

  try {
    const missingRoot = path.join(root, "missing")
    const { runCli } = await import("../helpers")
    const result = await runCli(["serve", "--root", missingRoot, "--port", "43102"])
    assert(result.exitCode !== 0, "serve must require existing root")
    results.push({ name: "companion.requires-existing-root", ok: true })
  } catch (error) {
    results.push({
      name: "companion.requires-existing-root",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  return results
}

export async function testSecurity(): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  const root = await tempDir("security")
  const dataRoot = path.join(root, "data")
  const outside = path.join(root, "outside.txt")
  await mkdir(dataRoot, { recursive: true })
  await writeFile(outside, "secret")
  await writeJson(path.join(dataRoot, "safe.note.json"), {
    id: "safe",
    title: "Safe",
    body: "ok",
  })
  await symlink(outside, path.join(dataRoot, "escape.note.json"))

  const before = await treeDigest(dataRoot)
  const companion = await startCompanion(dataRoot, 43103)
  try {
    const headers = { Host: `127.0.0.1:${companion.port}` }

    const nosniff = await fetch(`${companion.baseUrl}/api/health`, { headers })
    assert(nosniff.headers.get("x-content-type-options") === "nosniff", "nosniff missing")
    const csp = nosniff.headers.get("content-security-policy") ?? ""
    assert(csp.includes("frame-ancestors 'none'"), "csp framing")
    assert(csp.includes("base-uri 'none'"), "csp base-uri")

    const badHost = Bun.spawn(
      [
        "curl",
        "-s",
        "-o",
        "/dev/null",
        "-w",
        "%{http_code}",
        "-H",
        "Host: evil.example",
        `${companion.baseUrl}/api/health`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    )
    const badHostCode = await new Response(badHost.stdout).text()
    await badHost.exited
    assert(badHostCode.trim() === "400", `host validation got ${badHostCode}`)

    const escape = await fetch(`${companion.baseUrl}/api/notes/escape`, { headers })
    assert(escape.status === 404, "symlink escape should not serve")

    const traversal = await fetch(`${companion.baseUrl}/api/notes/../outside`, { headers })
    assert(traversal.status === 404 || traversal.status === 400, "traversal rejected")

    // Mutation methods should not exist for notes create
    const post = await fetch(`${companion.baseUrl}/api/notes`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "x", title: "x", body: "x" }),
    })
    assert(post.status === 404, "POST notes must not mutate")

    const after = await treeDigest(dataRoot)
    assert(before === after, "Data Root mutated during security tests")
    results.push({ name: "security.host-csp-symlink-readonly", ok: true })
  } catch (error) {
    results.push({
      name: "security.host-csp-symlink-readonly",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  } finally {
    await companion.stop()
  }

  return results
}
