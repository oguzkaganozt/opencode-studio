# Plan: Startup removal + Media → platform

Single-shot cutover. Catalog becomes CAD + PCB only. Media demotes from studio to always-on platform. Media viewer becomes a workspace file explorer.

Status: **implemented**.

---

## 1. Goals

1. Delete **startup** studio entirely.
2. Keep **cad** and **pcb** as the only catalog studios (deep, outcome-clear toolchains).
3. Demote **media** from studio identity to **core platform** (tools + skill + host API + explorer always available).
4. Replace the media library companion with a **workspace-scoped file explorer** (read / preview / download).
5. Drop XDG global media library and `users/…/{images,audio,video}` + `shared/` layout; all paths are workspace-relative.

Non-goals:

- Automated XDG → workspace data migration (single user; move files by hand if needed).
- Full VPS filesystem browser.
- UI mutate (upload / delete / rename) in the explorer.
- Deep-link from explorer into CAD/PCB viewers (v1).
- Renaming `media_*` / `fal_*` / `chatgpt_image_*` tools or `media-go` / `media-provider` package exports.

---

## 2. Locked decisions

### 2.1 Catalog

| Item | Decision |
| --- | --- |
| Remaining studios | `cad` \| `pcb` only |
| Startup | Delete code, loaders, UI, skill, parity, docs |
| Media studio id | Gone — not in `STUDIO_IDS`, not toggleable |
| `studio.json.enabled` | Only `cad` / `pcb` |

### 2.2 Platform (former media)

| Item | Decision |
| --- | --- |
| When active | Always when opencode-studio plugin/host runs |
| `enabled: []` | Domain studios off; **platform still on** |
| Config unreadable/invalid | **Platform still loads**; domains off; log/warn |
| Tools | Keep names: `media_*`, `fal_*`, `chatgpt_image_*`, `read_media` |
| ChatGPT image + fal | Always registered; missing auth/key → **call-time error**, not hidden registration |
| ffmpeg presets | Stay (convert / trim / extract-audio / probe) |
| Package exports | Keep `./media-provider`, `./media-go` |
| media-go registration | Always, unversioned, when opencode-studio is configured (not gated on a studio id) |
| Code home | `src/platform/media/` |
| Host API | `/api/files/*` (not `/api/studios/media`) |
| Shell UI | `/studio/files` — always reachable global entry |

### 2.3 `remove` / enablement semantics

| Command / state | Effect |
| --- | --- |
| `configure cad pcb` | Enable those studios + ensure unversioned platform registrations and media skill |
| `configure` with empty / `remove` | **Domain only**: disable cad/pcb; **keep** main plugin/media-go registrations, media skill, explorer |
| Full uninstall | Out of scope for this cutover (document that remove ≠ uninstall) |

Fail-closed new meaning: empty/invalid enablement → **no domain studios**, not “empty plugin.”

### 2.4 Legacy config

| Input | Runtime | configure / doctor |
| --- | --- | --- |
| `enabled` contains `media` or `startup` | **Strip + warn**; do not fail the whole config | Persist scrub on write |
| `roots.media` | Ignore | Scrub on write |
| Unknown other ids | Same strip + warn policy | Scrub |

### 2.5 Storage & tool paths

| Item | Decision |
| --- | --- |
| XDG `~/.local/share/opencode-studio/media` | Abandoned |
| `users/<user>/{images,audio,video}` + `shared/` | Abandoned |
| Path scope | `serve --workspace` / OpenCode `context.directory` only |
| Output path omitted (generate / import / convert / download) | Default under workspace **`media/`** with auto name |
| Explicit path | Any workspace-relative path allowed |
| Mandatory `media/` for all assets | No — free paths; `media/` is default only |
| Migration script | None |

### 2.6 Tools after library death

| Tool area | Decision |
| --- | --- |
| `media_list` | **Workspace media scan** (image/audio/video by MIME/type), with depth/entry caps |
| `media_info` / probe / convert / trim / extract | Workspace-relative paths; jail to workspace |
| `media_import` / download / generate outputs | Prefer explicit path; else default `media/<auto-name>` |
| `read_media` + provider hooks | Stay; paths workspace-scoped |
| fal_* / chatgpt_image_* | Stay; always registered |

### 2.7 File explorer

| Item | Decision |
| --- | --- |
| Tree | **Entire workspace** |
| Actions | Read + preview + download only |
| Preview types | image, audio, video, text (md, txt, json, yaml, …) |
| Unknown / binary | Metadata + download; no fake preview |
| CAD/PCB artifacts | Preview only — **no** “open in studio” deep-link (v1) |
| Security | **Simple**: workspace realpath jail (no escape via `..` / symlinks). No aggressive size/depth product policy required beyond basic safety to avoid trivial DoS if cheap to add. |
| Not in scope | Full disk, multi-root VPS, UI mutate |

### 2.8 Skill

| Item | Decision |
| --- | --- |
| Name / dir | `media` → `~/.config/opencode/skills/media/` |
| Install | Always managed when plugin lifecycle runs (not gated on enabled studios) |
| Old `media-studio` | If managed marker matches, delete on configure |
| Content | Drop Library/Companion/XDG doctrine; workspace paths + explorer + tool list |

### 2.9 Process

- Single implementation pass (no staged migration theater).
- Update parity, lifecycle fixtures, package-smoke, browser-smoke, docs in the same change set.

---

## 3. Architecture target

```
opencode-studio
├── platform (always on)
│   ├── media tools + provider hooks + unversioned media-go registration
│   ├── media skill
│   ├── GET /api/files/*          workspace tree + file bytes (range for AV)
│   └── UI /studio/files          explorer
└── studios (enablement-gated)
    ├── cad
    └── pcb
```

### 3.1 Plugin composition

1. Always compose **platform media** (tools + provider singleton hooks).
2. Then compose **enabled** domain studios (`cad`, `pcb`) in catalog order.
3. Config error or `enabled: []`: step 1 only; log enablement error if any.
4. `composeStudioPlugins` (or successor) must allow a non-`StudioId` platform lane so media is not keyed as a catalog studio.

### 3.2 Config surface

```json
{ "enabled": ["cad", "pcb"] }
```

- Optional `roots.cad` / `roots.pcb` absolute paths unchanged in spirit.
- No `roots.media`.
- No `user-data` studio root default in registry for catalog entries (or only if still needed elsewhere — media no longer uses it).

### 3.3 Host routes

| Route | Role |
| --- | --- |
| `/studio/files` | Explorer shell page (always in nav when host UI is up) |
| `/api/files/...` | List/stat/read/download workspace files |
| `/studio/studios/cad/*` | CAD viewer (if enabled) |
| `/studio/studios/pcb/*` | PCB viewer (if enabled) |
| `/api/studios/cad/*`, `/api/studios/pcb/*` | Domain APIs when enabled |

Remove `/studio/studios/media`, `/studio/studios/startup`, `/api/studios/media/*`, `/api/studios/startup/*`.

### 3.4 UI shell

- Global **Files** (or equivalent always-visible entry) → explorer.
- Studio nav only for enabled cad/pcb.
- Home enablement UI: cad/pcb toggles only; no media/startup.
- Agent handoff sources: drop `startup`; media handoff → `shell` or `files` if needed.

---

## 4. Implementation workstreams

### 4.1 Delete startup

- Remove `studios/startup/**`.
- Drop from `registry.ts`, `studios.ts`, `studio-loaders.ts`, `ui/app.tsx`, agent panel/handoff, tokens if unused.
- Parity: tools, skill-digests, plugin-hooks composition order.
- Retarget fixtures that used startup as the cheap studio:
  - `test/lifecycle.test.ts`
  - `scripts/package-smoke.ts`
  - `test/server.test.ts` (if startup-mounted)
  - `scripts/browser-smoke.ts`

### 4.2 Registry & config

- `STUDIO_IDS = ["cad", "pcb"]`.
- Parse: strip unknown legacy ids (`media`, `startup`) + unknown roots keys with warn.
- `remove` / empty configure: keep platform plugin/media-go registrations and media skill.
- lifecycle: always register main plugin + media-go without versions; always install `media` skill; install cad/pcb skills only when enabled.
- Doctor: platform checks (ffmpeg, media skill, media-go registration) whenever main plugin is registered; domain checks per enabled studio.

### 4.3 Move media → `src/platform/media`

- Relocate tools, provider, ffmpeg, fal, chatgpt-image, path helpers.
- Delete or gut `library.ts` layout (personal/shared/modality enforcement).
- Rewrite path resolution: workspace root + contain + realpath jail (reuse `src/core/paths` patterns).
- Default output helper: `media/<generated-name>` under workspace.
- `media_list`: scan workspace for media MIME/types with caps.
- Build entrypoints for media-provider / media-go unchanged in public export paths.
- Package `files` globs, test globs, imports (`@/*`).

### 4.4 Host files API + explorer UI

- Mount files API independent of `enabled` studios.
- Explorer page under `ui/` (not under a studio viewer loader).
- Preview: img / audio / video / text; download action.
- Simple jail only.

### 4.5 Skill

- Author `src/platform/media/skill/SKILL.md` (or packaged path used by lifecycle) as skill name `media`.
- Update parity skill digest.
- Configure: write managed skill; remove old managed `media-studio` when marker matches.

### 4.6 Docs & meta

- `AGENTS.md`, `README.md`, `docs/architecture.md`, CLI help strings.
- `package.json` description/keywords/test paths.
- Drop media/startup from “four studios” narrative; describe platform + two studios.

### 4.7 Tests

- Parity fixtures regenerated/updated.
- Lifecycle: platform always; domain optional; legacy scrub; remove keeps platform.
- Media/platform unit tests rewritten off library layout.
- Browser smoke: `/api/files` + explorer UI instead of media assets / startup candidates.
- `bun run check` (and media-related tests) green.

---

## 5. Security notes

- **Workspace jail** on all platform file reads/writes and explorer API (no `..`, no symlink escape).
- Free workspace write paths increase blast radius (CAD/PCB sources, env files). Rely on OpenCode tool permissions + skill warnings; no separate media sandbox.
- Explorer is read-mostly surface; still can expose secrets that live in the workspace — acceptable on loopback single-user posture; do not weaken CSRF/origin rules on writes elsewhere.
- Always-on fal/ChatGPT: billing risk if keys present — skill must state that clearly.

---

## 6. Explicit defaults (implementation)

| Gap | Default |
| --- | --- |
| Unnamed output | `media/<timestamp>-<slug>.<ext>` (create `media/` as needed) |
| `media_list` caps | Reasonable depth + entry limit (implementer picks; document in skill) |
| Text preview size | Soft cap as needed for simple safety; not a product feature |
| Explorer nav label | “Files” |
| Skill marker | platform/media identity (not a catalog `StudioId` loop) |
| Parity owner field | `platform` \| `cad` \| `pcb` (or equivalent) |
| Composition order | platform first, then cad, then pcb |

---

## 7. Acceptance checklist

- [ ] `STUDIO_IDS` is only cad, pcb; no startup/media studio modules in catalog.
- [ ] `enabled: []` → media tools still present; cad/pcb tools absent.
- [ ] Invalid/legacy `enabled: ["media","startup"]` strips and still loads platform.
- [ ] `remove` leaves plugin + media-go + `media` skill installed.
- [ ] No XDG media root usage; tools write/read under workspace; default dir `media/`.
- [x] Explorer at `/studio/files` lists workspace, previews supported types, downloads; no mutate.
- [x] Host API under `/api/files`; old media/startup studio routes gone.
- [ ] ChatGPT image + fal tools registered without studio enable.
- [ ] Parity, lifecycle, package-smoke, browser-smoke, `bun run check` pass.
- [ ] Docs/AGENTS/CLI match the new model.

---

## 8. Decision log (conversation)

1. Startup out — text CRM, not a continuous toolchain peer.
2. Media not a peer manufacturing studio — broad feature bag; real value is agent media I/O + gen.
3. Tools stay (including ChatGPT + fal); studio chrome goes away.
4. Viewer → general workspace explorer (media + text), not a third domain studio.
5. Workspace-only data; XDG library abandoned; free paths with default `media/`.
6. Platform always on; remove = domains only; legacy strip+warn; skill name `media`.
7. Code under `src/platform/media`; simple explorer jail.
)
