import { describe, expect, test } from "bun:test"
import { renderUserUnit, resolveServeExecutable } from "../src/service"

describe("systemd user unit", () => {
  test("renderUserUnit pins workspace host port and PATH", () => {
    const unit = renderUserUnit({
      workspace: "/home/me/project",
      host: "127.0.0.1",
      port: 4173,
      allowNonLoopback: false,
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
      host: "127.0.0.1",
      port: 4199,
      allowNonLoopback: true,
      pathEnv: "/usr/bin",
      executable: { command: "/opt/bin/opencode-studio", argsPrefix: [] },
    })
    expect(unit).toContain('WorkingDirectory="/home/me/my project"')
    expect(unit).toContain("--allow-non-loopback")
    expect(unit).toContain("--port 4199")
  })

  test("resolveServeExecutable returns a command", () => {
    const exe = resolveServeExecutable()
    expect(exe.command.length).toBeGreaterThan(0)
  })
})
