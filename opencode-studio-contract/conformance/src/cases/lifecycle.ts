import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { REFERENCE_ROOT, type CheckResult, assert, readJson, runCli, tempDir, writeJson } from "../helpers"

export async function testLifecycle(): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  const root = await tempDir("lifecycle")
  const configHome = path.join(root, "config")
  const projectRoot = path.join(root, "project")
  await mkdir(projectRoot, { recursive: true })

  try {
    const help = await runCli(["install", "--help"])
    assert(help.exitCode === 0, `install --help failed: ${help.stderr}`)
    assert(help.stdout.includes("install"), "help missing install")
    results.push({ name: "lifecycle.help", ok: true })
  } catch (error) {
    results.push({
      name: "lifecycle.help",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    const dry = await runCli([
      "install",
      "--scope",
      "user",
      "--dry-run",
      "--json",
      "--config-home",
      configHome,
    ])
    assert(dry.exitCode === 0, `dry-run failed: ${dry.stderr}`)
    const payload = JSON.parse(dry.stdout) as { dryRun: boolean; plugin: string }
    assert(payload.dryRun === true, "dryRun flag")
    assert(payload.plugin === "opencode-reference-studio/server", "plugin specifier")
    results.push({ name: "lifecycle.install-dry-run", ok: true })
  } catch (error) {
    results.push({
      name: "lifecycle.install-dry-run",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    await writeJson(path.join(configHome, "opencode", "opencode.json"), {
      $schema: "https://opencode.ai/config.json",
      model: "keep-me",
      plugin: ["unrelated-plugin"],
    })

    const install = await runCli(["install", "--scope", "user", "--json", "--config-home", configHome])
    assert(install.exitCode === 0, `install failed: ${install.stderr}\n${install.stdout}`)

    const config = await readJson<{ model: string; plugin: string[] }>(
      path.join(configHome, "opencode", "opencode.json"),
    )
    assert(config.model === "keep-me", "unrelated config lost")
    assert(config.plugin.includes("unrelated-plugin"), "unrelated plugin lost")
    assert(config.plugin.includes("opencode-reference-studio/server"), "plugin not registered")

    const skill = await readFile(path.join(configHome, "opencode/skills/reference-studio/SKILL.md"), "utf8")
    assert(skill.includes("reference-studio"), "skill missing")
    const marker = await readJson<{ studioId: string; digest: string }>(
      path.join(configHome, "opencode/skills/reference-studio/.osc-managed.json"),
    )
    assert(marker.studioId === "reference", "marker studioId")
    assert(marker.digest.length === 64, "marker digest")

    const again = await runCli(["install", "--scope", "user", "--json", "--config-home", configHome])
    assert(again.exitCode === 0, `idempotent install failed: ${again.stderr}`)
    const config2 = await readJson<{ plugin: string[] }>(path.join(configHome, "opencode", "opencode.json"))
    assert(
      config2.plugin.filter((p) => p === "opencode-reference-studio/server").length === 1,
      "duplicate plugin registration",
    )
    results.push({ name: "lifecycle.install-idempotent", ok: true })
  } catch (error) {
    results.push({
      name: "lifecycle.install-idempotent",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    await writeFile(
      path.join(configHome, "opencode/skills/reference-studio/SKILL.md"),
      "# user modified\n",
    )
    const conflict = await runCli(["install", "--scope", "user", "--json", "--config-home", configHome])
    assert(conflict.exitCode !== 0, "expected conflict on modified skill")
    assert(conflict.stderr.toLowerCase().includes("conflict") || conflict.stderr.includes("modified"), conflict.stderr)
    results.push({ name: "lifecycle.skill-user-modified-conflict", ok: true })
  } catch (error) {
    results.push({
      name: "lifecycle.skill-user-modified-conflict",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    // Restore managed skill for remove tests by re-writing original from package then marker match won't work —
    // remove should refuse modified skill.
    const removeModified = await runCli(["remove", "--scope", "user", "--json", "--config-home", configHome])
    assert(removeModified.exitCode !== 0, "remove must refuse user-modified skill")

    // Fresh install in project scope
    const projectInstall = await runCli([
      "install",
      "--scope",
      "project",
      "--json",
      "--project-root",
      projectRoot,
    ])
    assert(projectInstall.exitCode === 0, `project install failed: ${projectInstall.stderr}`)
    const projectConfig = await readJson<{ plugin: string[] }>(path.join(projectRoot, "opencode.json"))
    assert(projectConfig.plugin.includes("opencode-reference-studio/server"), "project plugin")

    await writeJson(path.join(projectRoot, "opencode.json"), {
      username: "keep-me",
      plugin: ["other", "opencode-reference-studio", "opencode-reference-studio/server"],
    })
    // Re-read marker is fine; reinstall to sync skill then remove
    // Skill already installed; remove should work
    const remove = await runCli([
      "remove",
      "--scope",
      "project",
      "--json",
      "--project-root",
      projectRoot,
    ])
    assert(remove.exitCode === 0, `remove failed: ${remove.stderr}`)
    const after = await readJson<{ username: string; plugin: string[] }>(path.join(projectRoot, "opencode.json"))
    assert(after.username === "keep-me", "remove must not restore whole config")
    assert(after.plugin.includes("other"), "unrelated plugin removed")
    assert(after.plugin.includes("opencode-reference-studio"), "bare package plugin removed")
    assert(!after.plugin.includes("opencode-reference-studio/server"), "plugin still registered")
    results.push({ name: "lifecycle.remove-preserves-unrelated", ok: true })
  } catch (error) {
    results.push({
      name: "lifecycle.remove-preserves-unrelated",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    const jsoncHome = path.join(root, "jsonc-config")
    const configFile = path.join(jsoncHome, "opencode", "opencode.json")
    await mkdir(path.dirname(configFile), { recursive: true })
    await writeFile(configFile, `{
  // This comment must survive lifecycle edits.
  "plugin": ["unrelated-plugin"],
}
`)
    const install = await runCli(["install", "--scope", "user", "--config-home", jsoncHome])
    assert(install.exitCode === 0, `JSONC install failed: ${install.stderr}`)
    const updated = await readFile(configFile, "utf8")
    assert(updated.includes("This comment must survive"), "config comment was removed")
    assert(updated.includes("opencode-reference-studio/server"), "plugin missing from JSONC config")
    results.push({ name: "lifecycle.jsonc-comments-preserved", ok: true })
  } catch (error) {
    results.push({
      name: "lifecycle.jsonc-comments-preserved",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    const invalidHome = path.join(root, "invalid-config")
    const configFile = path.join(invalidHome, "opencode", "opencode.json")
    await writeJson(configFile, { definitelyUnknownOption: true })
    const before = await readFile(configFile, "utf8")
    const install = await runCli(["install", "--scope", "user", "--config-home", invalidHome])
    assert(install.exitCode !== 0, "OpenCode-invalid config should be rejected")
    assert((await readFile(configFile, "utf8")) === before, "invalid config was modified")
    let skillExists = true
    try {
      await stat(path.join(invalidHome, "opencode/skills/reference-studio/SKILL.md"))
    } catch {
      skillExists = false
    }
    assert(!skillExists, "skill was not rolled back after config rejection")
    results.push({ name: "lifecycle.invalid-config-rolls-back", ok: true })
  } catch (error) {
    results.push({
      name: "lifecycle.invalid-config-rolls-back",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    const atomicHome = path.join(root, "atomic-remove")
    const install = await runCli(["install", "--scope", "user", "--config-home", atomicHome])
    assert(install.exitCode === 0, `atomic setup failed: ${install.stderr}`)
    const opencodeDir = path.join(atomicHome, "opencode")
    await chmod(opencodeDir, 0o555)
    const remove = await runCli(["remove", "--scope", "user", "--config-home", atomicHome])
    await chmod(opencodeDir, 0o755)
    assert(remove.exitCode !== 0, "remove should fail when config cannot be published")
    await stat(path.join(opencodeDir, "skills/reference-studio/SKILL.md"))
    const config = await readJson<{ plugin: string[] }>(path.join(opencodeDir, "opencode.json"))
    assert(config.plugin.includes("opencode-reference-studio/server"), "plugin changed after failed remove")
    results.push({ name: "lifecycle.remove-failure-restores-skill", ok: true })
  } catch (error) {
    results.push({
      name: "lifecycle.remove-failure-restores-skill",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    const fresh = await tempDir("doctor")
    const doctor = await runCli(["doctor", "--scope", "user", "--json", "--config-home", path.join(fresh, "cfg")])
    assert(doctor.exitCode === 0, `doctor failed: ${doctor.stderr}`)
    const payload = JSON.parse(doctor.stdout) as { status: string; checks: Array<{ id: string }> }
    assert(payload.checks.some((c) => c.id === "manifest"), "doctor missing manifest check")

    const fakeBin = path.join(fresh, "bin")
    const fakeOpenCode = path.join(fakeBin, "opencode")
    await mkdir(fakeBin)
    await writeFile(fakeOpenCode, "#!/bin/sh\nprintf '0.0.1\\n'\n")
    await chmod(fakeOpenCode, 0o755)
    const incompatible = await runCli(
      ["doctor", "--scope", "user", "--json", "--config-home", path.join(fresh, "old-version")],
      { env: { PATH: `${fakeBin}:${process.env.PATH ?? ""}` } },
    )
    assert(incompatible.exitCode !== 0, "doctor must fail for an incompatible OpenCode version")
    const incompatiblePayload = JSON.parse(incompatible.stdout) as {
      checks: Array<{ id: string; status: string }>
    }
    assert(
      incompatiblePayload.checks.some((c) => c.id === "opencode-compat" && c.status === "fail"),
      "doctor did not report incompatible OpenCode",
    )

    const fileRoot = await runCli([
      "doctor",
      "--scope",
      "user",
      "--json",
      "--config-home",
      path.join(fresh, "cfg"),
      "--root",
      path.join(REFERENCE_ROOT, "package.json"),
    ])
    assert(fileRoot.exitCode !== 0, "doctor must reject a file Data Root")
    results.push({ name: "lifecycle.doctor-json", ok: true })
  } catch (error) {
    results.push({
      name: "lifecycle.doctor-json",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  return results
}
