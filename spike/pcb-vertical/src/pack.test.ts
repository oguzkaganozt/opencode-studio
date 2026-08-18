import assert from "node:assert/strict"
import { accessSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const spike = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

test("PCB-only archive installs without CAD/Concept/Firmware", () => {
  const work = spawnSync("bash", [path.join(spike, "scripts", "pack.sh")], { encoding: "utf8" })
  assert.equal(work.status, 0, work.stderr)
  const archive = work.stdout.trim()
  const listing = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" })
  assert.equal(listing.status, 0, listing.stderr)
  assert.match(listing.stdout, /pcb\/src\/host\.ts/)
  assert.doesNotMatch(listing.stdout, /studios\/(cad|concept|fw)|design-system|merin/)
  const dest = path.join(tmpdir(), `pcb-install-${Date.now()}`)
  const installed = spawnSync("bash", [path.join(spike, "install.sh"), archive, dest], { encoding: "utf8" })
  assert.equal(installed.status, 0, installed.stderr)
  accessSync(path.join(dest, "src", "host.ts"))
  accessSync(path.join(dest, "engine", "run.mjs"))
  accessSync(path.join(dest, "install.sh"))
})
