import { describe, expect, test } from "bun:test"
import { checkPackageUpgrade, OPENCODE_RESTART_HINT, renderUserUnit, resolveServeExecutable } from "../src/service"

describe("systemd user unit", () => {
  test("renderUserUnit pins workspace host port and PATH", () => {
    const unit = renderUserUnit({
      workspace: "/home/me/project",
      host: "127.0.0.1",
      port: 4173,
      pathEnv: "/usr/bin:/bin",
      executable: { command: "/usr/bin/opencode-studio", argsPrefix: [] },
    })
    expect(unit).toContain("WorkingDirectory=/home/me/project")
    expect(unit).toContain("Environment=PATH=/usr/bin:/bin")
    expect(unit).toContain("ExecStart=/usr/bin/opencode-studio serve --workspace /home/me/project --host 127.0.0.1 --port 4173")
    expect(unit).toContain("WantedBy=default.target")
    expect(unit).toContain("ExecStart=/usr/bin/opencode-studio serve --workspace /home/me/project --host 127.0.0.1 --port 4173\n")
  })

  test("renderUserUnit quotes paths with spaces", () => {
    const unit = renderUserUnit({
      workspace: "/home/me/my project",
      host: "0.0.0.0",
      port: 4199,
      pathEnv: "/usr/bin",
      agentPassword: "%h test password",
      executable: { command: "/opt/bin/opencode-studio", argsPrefix: [] },
    })
    expect(unit).toContain('WorkingDirectory="/home/me/my project"')
    expect(unit).toContain("--host 0.0.0.0")
    expect(unit).toContain("--port 4199")
    expect(unit).toContain('Environment=OPENCODE_STUDIO_PASSWORD="%%h test password"')
  })

  test("resolveServeExecutable returns a command", () => {
    const exe = resolveServeExecutable()
    expect(exe.command.length).toBeGreaterThan(0)
  })
})

describe("upgrade check", () => {
  test("OPENCODE_RESTART_HINT mentions OpenCode", () => {
    expect(OPENCODE_RESTART_HINT.toLowerCase()).toContain("opencode")
  })

  test("checkPackageUpgrade reports installed version", async () => {
    const result = await checkPackageUpgrade({ packageRoot: process.cwd(), ttlMs: 1 })
    expect(result.action).toBe("check")
    expect(result.current.length).toBeGreaterThan(0)
    expect(result.message.length).toBeGreaterThan(0)
    // Network may fail in sandbox; still a structured result.
    expect(["check"]).toContain(result.action)
  })
})
