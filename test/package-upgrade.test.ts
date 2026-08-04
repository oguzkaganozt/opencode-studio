import { describe, expect, test } from "bun:test"
import { parseOpenCodeServePids, parsePidsFromSs } from "../src/package-upgrade"

describe("parseOpenCodeServePids", () => {
  test("matches real and wrapper serve lines, skips self and TUI", () => {
    const ps = `
  100 /home/u/.opencode/bin/opencode serve --hostname 0.0.0.0 --port 4096
  101 /home/u/.local/bin/opencode serve --port 4096
  102 opencode --continue
  103 opencode-studio ensure-host
  104 /usr/bin/opencode serve
  105 bun /tmp/studio-host.mjs
`
    expect(parseOpenCodeServePids(ps, 999)).toEqual([100, 101, 104])
    expect(parseOpenCodeServePids(ps, 100)).toEqual([101, 104])
  })
})

describe("parsePidsFromSs", () => {
  test("extracts pid= tokens", () => {
    const ss = `LISTEN 0 512 0.0.0.0:4173 0.0.0.0:* users:(("bun",pid=705582,fd=18))
LISTEN 0 512 0.0.0.0:4096 0.0.0.0:* users:(("opencode",pid=705581,fd=17))`
    expect(parsePidsFromSs(ss, 999).sort()).toEqual([705581, 705582])
    expect(parsePidsFromSs(ss, 705582)).toEqual([705581])
  })
})
