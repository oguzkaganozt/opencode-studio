import { describe, expect, test } from "bun:test"
import {
  mergeRestartEnv,
  parseListenHostPort,
  parseOpenCodeServePids,
  parsePidsFromSs,
  parseProcEnviron,
  resolveUpgradeBinds,
  selectOwnedStackPids,
} from "../src/package-upgrade"

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

describe("parseListenHostPort", () => {
  test("reads 0.0.0.0 and loopback binds", () => {
    const ss = `LISTEN 0 512 0.0.0.0:4096 0.0.0.0:* users:(("opencode",pid=1,fd=17))
LISTEN 0 512 127.0.0.1:4173 0.0.0.0:* users:(("bun",pid=2,fd=18))`
    expect(parseListenHostPort(ss, 4096)).toEqual({ hostname: "0.0.0.0", port: "4096" })
    expect(parseListenHostPort(ss, 4173)).toEqual({ hostname: "127.0.0.1", port: "4173" })
    expect(parseListenHostPort(ss, 9999)).toBeNull()
  })
})

describe("parseProcEnviron", () => {
  test("keeps only snapshot OPENCODE keys", () => {
    const raw = [
      "PATH=/bin",
      "OPENCODE_SERVER_PASSWORD=secret",
      "OPENCODE_HOSTNAME=0.0.0.0",
      "OPENCODE_STUDIO_WORKSPACE=/srv/studio",
      "OPENCODE_STUDIO_CONFIG_HOME=/srv/config/studio",
      "OPENCODE_CONFIG_HOME=/srv/config/opencode",
      "FOO=bar",
      "",
    ].join("\0")
    expect(parseProcEnviron(raw)).toEqual({
      OPENCODE_SERVER_PASSWORD: "secret",
      OPENCODE_HOSTNAME: "0.0.0.0",
      OPENCODE_STUDIO_WORKSPACE: "/srv/studio",
      OPENCODE_STUDIO_CONFIG_HOME: "/srv/config/studio",
      OPENCODE_CONFIG_HOME: "/srv/config/opencode",
    })
  })
})

describe("upgrade stack bind and ownership", () => {
  test("uses custom Studio port for health URLs and listener selection", () => {
    const env = { OPENCODE_STUDIO_PORT: "5317" }
    expect(resolveUpgradeBinds(env).studio.localUrl).toBe("http://127.0.0.1:5317")

    const ps = `
  100 /usr/bin/bun /pkg/dist/studio-host.mjs
  101 /usr/bin/python unrelated-server.py
  102 /usr/bin/opencode serve --port 4096
`
    const ss = `LISTEN 0 512 127.0.0.1:5317 0.0.0.0:* users:(("bun",pid=100,fd=18),("python",pid=101,fd=19))`
    expect(selectOwnedStackPids(ps, ss, env, 999)).toEqual({
      pids: [102, 100],
      studioPort: 5317,
      ownedListeners: [100],
    })
  })

  test("never treats an unknown default-port listener as owned", () => {
    const ps = "  201 /usr/bin/python unrelated-server.py"
    const ss = `LISTEN 0 512 127.0.0.1:4173 0.0.0.0:* users:(("python",pid=201,fd=18))`
    expect(selectOwnedStackPids(ps, ss, {}, 999).pids).toEqual([])
  })
})

describe("mergeRestartEnv", () => {
  test("caller env wins; snapshot fills gaps", () => {
    const { env, fromSnapshot } = mergeRestartEnv(
      { OPENCODE_SERVER_PASSWORD: "from-caller", HOME: "/home/u" },
      {
        serveHostname: "0.0.0.0",
        servePort: "4096",
        studioHostname: "0.0.0.0",
        env: {
          OPENCODE_SERVER_PASSWORD: "from-snap",
          OPENCODE_STUDIO_PASSWORD: "studio-secret",
          OPENCODE_SERVER_USERNAME: "opencode",
          OPENCODE_STUDIO_WORKSPACE: "/srv/studio",
        },
      },
    )
    expect(env.OPENCODE_SERVER_PASSWORD).toBe("from-caller")
    expect(env.OPENCODE_STUDIO_PASSWORD).toBe("studio-secret")
    expect(env.OPENCODE_HOSTNAME).toBe("0.0.0.0")
    expect(env.OPENCODE_PORT).toBe("4096")
    expect(env.OPENCODE_STUDIO_HOSTNAME).toBe("0.0.0.0")
    expect(env.OPENCODE_STUDIO_WORKSPACE).toBe("/srv/studio")
    expect(fromSnapshot).toContain("OPENCODE_STUDIO_PASSWORD")
    expect(fromSnapshot).toContain("OPENCODE_HOSTNAME")
    expect(fromSnapshot).not.toContain("OPENCODE_SERVER_PASSWORD")
  })
})
