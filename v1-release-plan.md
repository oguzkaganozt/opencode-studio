# Internal server readiness

**Audience:** our team, one (or few) Linux servers — **not** a public product release.  
**Package pin:** `@oguzkaganozt/opencode-studio@1.0.5` (bump this line when we pin a new build).
**Done means:** someone on the team can bring up Studio on the box, open CAD/PCB/Files, and run real agent work without tribal knowledge.

Does not replace `AGENTS.md` security rules.

---

## 1. What “ready” means

| In | Out |
| --- | --- |
| Sole-operator / small team on our VPS or desktop | Multi-tenant SaaS, public npm “1.0” marketing |
| One `opencode serve` + one fixed Studio Home | Multi-user Studio Home selection in the browser |
| CAD + PCB + media-core + Files + loadable media-go registration | Flaky optional stubs |
| Loopback or LAN + Basic + SSH tunnel / our reverse-proxy | In-app TLS, IAM, rate limits |
| Pin + **repair** + restart + open Studio | Clean-machine CI matrix, arm64 first-class, air-gap seed kit |

**Internal v1 exit:** §5 checklist green on the **real** team server (or a clone of it). Package version **1.0.1** = this readiness bar.

---

## 2. Server prerequisites

Install these **before** Studio (greenfield):

| Need | Notes |
| --- | --- |
| Non-root Linux user | UID 0 refused unless `OPENCODE_STUDIO_ALLOW_ROOT=1` |
| **Bun ≥ 1.3** | On PATH for the OpenCode user |
| **OpenCode ≥ 1.18.2** | `opencode --version`; model auth already works |
| **Node + npm** on PATH | Required for PCB project build (`status` checks `engine:pcb:npm`) |
| linux/amd64 preferred | arm64: system **ffprobe** on PATH |
| Disk ≥ ~10 GiB free | bun store + uv + forge/OCP + MCP |
| RAM ≥ ~4 GiB | forge sync/build |
| Outbound HTTPS (cold) | npm/bun, GitHub (uv), PyPI — or pre-seeded `~/.cache/opencode-studio` |
| Symlinks under CAD root | forge artifact layout |
| glibc ≥ ~2.31 for CAD | old LTS may fail OCP wheels |

---

## 3. Topology

```
opencode serve          ← you supervise this (systemd user unit, etc.)
  └── ensure-host companion → :4173
        /studio  Viewer
        /api/*   domain APIs
        /*       proxy → parent OpenCode (Agent iframe)
```

- **No** `opencode-studio serve`. Host dies when OpenCode process dies.
- **:4173 starts** with `opencode serve` when the PATH wrapper is installed and autostart is enabled.
- **Studio Home is fixed** to `$HOME` for the serve lifetime. OpenCode project selection is request-scoped and never changes Studio Home.
- Default Studio port **4173**; busy → hard fail (set `OPENCODE_STUDIO_PORT`).

### Env we actually use

| Variable | When |
| --- | --- |
| `OPENCODE_SERVER_PASSWORD` | Preferred sole password (OpenCode + Studio edge + Agent proxy) |
| `OPENCODE_SERVER_USERNAME` | Default `opencode` when server password set |
| `OPENCODE_STUDIO_PORT` | If 4173 taken |
| `OPENCODE_STUDIO_HOSTNAME` / `OPENCODE_STUDIO_BIND=web` | Non-loopback Studio (needs password) |
| `OPENCODE_STUDIO_ALLOWED_ORIGINS` | Browser Origin ≠ Host (reverse-proxy / WS) |
| `OPENCODE_STUDIO_WORKSPACE` | Explicit fixed Studio Home override (default `$HOME`) |
| `OPENCODE_STUDIO_AUTOSTART=0` | Tools only, no host (rare) |
| `OPENCODE_CONFIG_HOME` / `OPENCODE_STUDIO_CONFIG_HOME` | Isolation (absolute paths) |

Do **not** set only `OPENCODE_STUDIO_PASSWORD` while parent has Basic — Agent proxy breaks.

Export the same password in the shell you use for `curl -u` checks (service `Environment=` does not inject into your interactive shell).

---

## 4. Bring-up (greenfield box)

### 4.1 Install + wire

```bash
# Prereqs already on PATH: bun, opencode, node, npm
bun add -g @oguzkaganozt/opencode-studio@1.0.5
hash -r
command -v opencode-studio

# Postinstall is soft — always repair on a new box
opencode-studio repair

opencode-studio status --workspace /abs/project
# exit 0; plugin-registration + mcp-build123d + skills must be pass (not merely "no fail")
# cad-forge may warn until first design_build; engine:pcb:npm should pass
```

### 4.2 Spot-check after repair

- [ ] Sole `~/.config/opencode/opencode.json` **or** `.jsonc` (not both)
- [ ] Plugin list includes unversioned `"@oguzkaganozt/opencode-studio"`
- [ ] MCP `build123d`: absolute `uv` + `build123d-mcp@0.3.80` (matches package-meta / skill)
- [ ] Skills: `studio-cad`, `studio-pcb`, `studio-media` + managed markers
- [ ] Engines: ffmpeg, ffprobe, uv, tsci, **npm** — no `fail`
- [ ] `cad-forge` pass (after first design_build)

### 4.3 Supervise OpenCode

```ini
# ~/.config/systemd/user/opencode-serve.service
[Unit]
Description=OpenCode serve
After=network.target

[Service]
Type=simple
WorkingDirectory=/abs/project
Environment=OPENCODE_SERVER_PASSWORD=change-me-long-random
# Use absolute paths from `command -v opencode` / bun
ExecStart=/usr/local/bin/opencode serve --hostname 127.0.0.1 --port 4096
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

On a headless VPS, enable linger so the user unit survives logout:

```bash
loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable --now opencode-serve
```

Confirm OpenCode and Studio listen (e.g. `:4096` and `:4173`).

### 4.4 Verify Studio

```bash
# journalctl --user -u opencode-serve -f
# expect: [opencode-studio] Studio host ready: http://127.0.0.1:4173/studio

curl -fsS http://127.0.0.1:4173/studio-api/health
# → {"status":"ok","parentOpenCodeUrl":"...","studioRoot":"/home/<user>"}

# Basic only required when Studio is non-loopback; harmless on loopback
export OPENCODE_SERVER_PASSWORD=change-me-long-random   # same value as the unit
curl -fsS -o /dev/null -w '%{http_code}\n' \
  -u "opencode:${OPENCODE_SERVER_PASSWORD}" \
  http://127.0.0.1:4173/studio
# → 200
```

Browser: `http://127.0.0.1:4173/studio` (or SSH tunnel). Open CAD, PCB, Files once.

**Negative:** `systemctl --user stop opencode-serve` → `:4173` stops.

### 4.5 Upgrade / rollback

```bash
opencode-studio upgrade   # or bun add -g @…@<new>
opencode-studio repair

opencode-studio status
# restart OpenCode

# Rollback
opencode-studio remove
bun add -g @oguzkaganozt/opencode-studio@<previous>
opencode-studio repair && 
# restart OpenCode
```

When bumping the pin, update the version line at the top of **this file**.

### 4.6 Common fixes

| Symptom | Action |
| --- | --- |
| status fail after bun add | `repair`; check postinstall skip |
| plugin/MCP/skill `fail` | `repair`, restart OpenCode |
| `cad-forge` warn | `
| `engine:pcb:npm` fail | Install Node/npm on PATH |
| Unmarked / edited managed skill | Backup, delete skill dir, `repair` |
| Port busy / foreign health | Free port or `OPENCODE_STUDIO_PORT` |
| Tools ≠ Viewer paths | Check persistent CAD/PCB roots in `studio.json`; restart serve |
| Agent / parent broken | `OPENCODE_SERVER_PASSWORD` on OpenCode process |
| Dual json + jsonc | Keep one, `repair` |
| Proxy WS / Origin issues | `OPENCODE_STUDIO_ALLOWED_ORIGINS`; enable WS upgrade |

---

## 5. Team server done checklist

Run on the **actual** host we will use.

### Core

- [ ] Prereqs: Bun, OpenCode, Node/npm
- [ ] Pinned package; `opencode-studio` on PATH
- [ ] `repair` + `status` → exit 0
  - [ ] `plugin-registration` **pass**  
  - [ ] `mcp-build123d` **pass**  
  - [ ] domain + media skills **pass**  
  - [ ] `engine:pcb:npm` **pass**  
  - [ ] `cad-forge` **pass**
- [ ] OpenCode restarted after repair
- [ ] User unit (or equivalent) running; Studio Home is the intended `$HOME` or explicit override
- [ ] Host ready log; `/studio-api/health` 200; `/studio` 200
- [ ] CAD + PCB + Files UI load
- [ ] Agent iframe reaches parent (one trivial chat/tool round-trip)
- [ ] Stop serve → `:4173` down

### CAD

- [ ] `design_create` → part source → `design_build` → STEP/STL/GLB
- [ ] `design_view` opens
- [ ] build123d MCP answers (e.g. version / trivial execute)

### PCB

- [ ] List; create + build (+ export if we care)

### Media

- [ ] ffmpeg/ffprobe pass; one `media_probe` or convert
- [ ] `plugin-media-go` **pass** (package `dist/media-go.js`, not stub)

### Edge

- [ ] Tunnel or TLS at our proxy; WS upgrade; origins if needed
- [ ] Remote UI Repair may be off-loopback — CLI `repair` on the box

---

## 6. Engineering backlog

| Item | Status |
| --- | --- |
| G4 skill MCP pin `@0.3.80` | shipped |
| G2 status fail-closed (plugin/MCP/skills) | shipped |
| G3 forge auto-sync + `cad-forge` | shipped |
| G5 npm status + ENOENT/tsci fallback | shipped |
| G1 media-go via package `dist/` + loadable status | shipped |
| G7 Gerber GET/UI fab-ready gate | shipped |
| G8 CPL MPN column | shipped |
| G6 scaffold tscircuit pin lag | residual OK |
| Public cert matrix | out of scope |

---

## 7. References

- `AGENTS.md` — layout, security, configure/repair  
- `README.md` — install / quick start  
- This file — greenfield SoT for our server  

---

## 8. Changelog

| Date | Note |
| --- | --- |
| 2026-07-30 | Initial public-style pre-deploy plan (0.5.17) |
| 2026-07-30 | Dual DoD / profiles / G* ranking |
| 2026-07-31 | Rewrite: internal server readiness |
| 2026-07-31 | Polish: warm CLI, status fail-closed, npm/forge checks, G4 pin, runbook greenfield fixes (0.5.18) |
| 2026-07-31 | **1.0.0:** media-go dist load, Gerber GET/UI gate, CPL MPN, npm→tsci fallback |
| 2026-07-31 | **1.0.1:** forge uv sync outside build timer; remove `warm` CLI |
| 2026-07-31 | Pre-release polish: fileURLToPath, MCP pin enforce, Gerber/npm tests, README pin/install |
