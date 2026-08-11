# Plan: Studio = agent + skills + tools

Status: **implemented** (OpenCode 1.18.16 isolation mechanism verified; automated matrix coverage shipped)
Scope: **OpenCode-studio only**
Date: 2026-08-11
Verified against: OpenCode `1.18.16` source (`dev`) + live `opencode serve` spike (`OPENCODE_CONFIG_DIR`)

---

## Goal

Each domain Studio is a closed capability bundle:

```text
Studio = dedicated agent
       + its domain skill(s) only
       + its domain tool(s) only
       + project / session context
```

| Surface | Agent | Skills | Tools |
| --- | --- | --- | --- |
| CAD | `studio-cad` | `studio-cad` | `design_*`, `build123d_*` |
| PCB | `studio-pcb` | `studio-pcb` | `pcb_*` |
| Media | `studio-media` | `studio-media` | `media_*`, `fal_*`, `chatgpt_image_generate`, `read_media` |
| Home / Files | `build` (stock OpenCode) | **no** Studio skills | **no** Studio tools |
| Future studio X | `studio-x` | `studio-x` | X tools only |

**No phased bridge.** Full isolation is the product model, not a later step.

Rules:

- Skill + tools for a domain are one **bundle** — never expose the skill without its tools, or the reverse.
- Agent bodies stay **thin**; workflow lives in `SKILL.md`.
- New studio registers agent + skill + tools + surface together; other agents do not grow.
- Domain work happens **inside** the Studio surface. Home/Files stays general coding (`build`); no handoff theater.
- There are **no cross-Studio tools or skills**. Shared UI/file-preview infrastructure may stay platform-level, but model capabilities belong to exactly one Studio.

---

## Why

Today every prompt hardcodes `build` (`ui/agent/client.ts`). Skills are managed; media + CAD + PCB tools are composed **globally**. The model sees every domain schema and must not wander.

As studios scale:

- One agent + full tool dump → selection noise and token cost (today: 72 studio tools; 35 are `build123d_*` alone)
- Quality hangs on skill-load luck, not a fixed role
- No place for per-domain policy

Dedicated agents fix **routing and surface**. Skills/tools still carry quality.

---

## OpenCode runtime (verified)

Spike + source read on OpenCode **1.18.16** (`packages/opencode` / `packages/core`).

### Schema drop is real

Tools offered to the model are filtered in `session/llm/request.ts` → `resolveTools()` via `Permission.disabled()`:

```ts
// packages/opencode/src/permission/index.ts
// A tool is HIDDEN from the model when the last matching rule has
// pattern === "*" AND action === "deny".
export function disabled(tools, ruleset) { /* … */ }
```

`fromConfig({ "pcb_*": "deny" })` emits `{ permission: "pcb_*", pattern: "*", action: "deny" }`.
Wildcard match is `*` → `.*` on the **tool name** (`pcb_workspace_list` matches `pcb_*`).

So **deny with string form (or object only if pattern is `*`) drops schemas** — not invoke-only soft deny.

Skill names use a different path: `Skill.available(agent)` filters with `evaluate("skill", name, …) !== "deny"`. Denied skills are omitted from `<available_skills>`. The `skill` **tool** itself stays visible unless `skill: deny` (whole tool).

### Isolation matrix

The live spike proved the filter semantics with CAD/PCB agents. Media uses the same verified mechanism; the target matrix is:

| Agent | PCB schemas | CAD schemas | Media schemas | `task` tool | Own skill |
| --- | --- | --- | --- | --- | --- |
| `studio-cad` (primary, hidden) | hidden | visible | hidden | hidden | `studio-cad` only |
| `studio-pcb` (primary, hidden) | visible | hidden | hidden | hidden | `studio-pcb` only |
| `studio-media` (primary, hidden) | hidden | hidden | visible | hidden | `studio-media` only |
| `build` / other agents | hidden | hidden | hidden | unchanged | no Studio skills |

`prompt_async` with `agent: "studio-cad"` on a hidden primary agent **works** (user + assistant messages stamped `studio-cad`).

### Config path note

OpenCode process reads `Flag.OPENCODE_CONFIG_DIR ?? $XDG_CONFIG_HOME/opencode`.
Studio lifecycle writes via `OPENCODE_CONFIG_HOME` (same default `~/.config/opencode`). Defaults align; tests that set only one of the two must set **both** or the path OpenCode actually reads.

### Registration stays global

Plugin still registers all tools once. Isolation is **agent permission filter**, not per-agent plugin load. That is enough on 1.18.16 because deny drops schemas. If a future OpenCode regresses `Permission.disabled`, re-verify before ship.

---

## Decisions (locked)

| Topic | Decision |
| --- | --- |
| Agent ids | `studio-cad`, `studio-pcb`, `studio-media` (same family as skills) |
| Agent format | OpenCode markdown → managed install `…/agents/<id>.md` |
| **Mode** | **`primary` + `hidden: true`** — `promptAsync({ agent })` works; hidden from TUI Tab / default-agent pool (same pattern as compaction/title/summary) |
| Selection | Every `promptAsync`: `studioId` → matching `studio-<id>`; else `build` |
| Isolation mechanism | Agent + global `permission` rules that **drop** tool schemas (`Permission.disabled`) and hide skills (`Skill.available`) |
| Soft-only deny as end state | **No** — and on 1.18.16 string `deny` **is** schema drop when `pattern === "*"` (the default for string form) |
| Tool registration | Keep global plugin compose; do **not** split plugins per studio for isolation |
| Permission style | Prefer `permission:` (not deprecated agent `tools:`). String form `"pcb_*": deny` → hide. Object form for skill **names** and task **types** |
| **Domain surface on non-studio agents** | **Global managed denylist** of all Studio tool names/prefixes + Studio skill names, so `build`, `plan`, `general`, `explore`, and custom agents are Studio-blind without per-agent sprawl |
| **Studio agent re-allow** | Each studio agent **re-allows only** its own tool names/prefixes + its own skill; denies all other Studio domains; denies `task: { "*": deny }` (no subagent escape) |
| `build` | Stock primary — domain-blind via global denylist (no separate “fake build agent” file) |
| Also domain-blind | `plan`, `general`, `explore` (covered by global denylist) |
| **Media** | **Full catalog Studio**, same as CAD/PCB: own surface, hidden primary agent, skill, tools, API/viewer ownership, root, tests, and lifecycle |
| Media tool names | `media_*`, `fal_*`, `chatgpt_image_generate`, `read_media` — denied globally, re-allowed only on `studio-media` |
| Domain tool prefixes | CAD: `design_*`, `build123d_*`. PCB: `pcb_*`. Media: list above. Source of truth: `test/parity/tools.json` |
| Domain skills | `studio-cad`, `studio-pcb`, `studio-media` denied globally; re-allowed only on matching studio agent |
| Platform media remainder | Shared file preview/download transport and `media-go` provider plumbing may remain platform infrastructure; they expose **no model tool or skill** outside Media Studio |
| Sticky session agent | No. Each prompt resolves agent from current context |
| Agent picker UI | No. Optional: show resolved agent id in AgentPanel chrome (debug, not picker) |
| Home handoff | No special path |
| Platforms | OpenCode-studio only |
| Branching | Plan file only until scheduled on main |

### Agent resolution

- CAD claim (`studioId: "cad"`) → `studio-cad`
- PCB claim (`studioId: "pcb"`) → `studio-pcb`
- Media claim (`studioId: "media"`) → `studio-media`
- Home / Files / no `studioId` → `build`

### Permission matrix (canonical)

**Global managed block** (in `opencode.json` / `opencode.jsonc` via lifecycle merge):

```jsonc
{
  "permission": {
    "pcb_*": "deny",
    "design_*": "deny",
    "build123d_*": "deny",
    "media_*": "deny",
    "fal_*": "deny",
    "chatgpt_image_generate": "deny",
    "read_media": "deny",
    "skill": {
      "studio-cad": "deny",
      "studio-pcb": "deny",
      "studio-media": "deny"
    }
  }
}
```

**`studios/cad/agent/studio-cad.md` frontmatter** (shape):

```yaml
---
description: CAD Studio — mechanical design (design_* / build123d_*). Load studio-cad before domain work.
mode: primary
hidden: true
permission:
  design_*: allow
  build123d_*: allow
  pcb_*: deny
  task:
    "*": deny
  skill:
    "*": deny
    studio-cad: allow
---
```

**`studio-pcb.md`**: mirror with `pcb_*: allow`; deny CAD + Media; allow only skill `studio-pcb`.

**`studio-media.md`**: allow `media_*`, `fal_*`, `chatgpt_image_generate`, `read_media`; deny CAD + PCB; allow only skill `studio-media`.

Merge order in OpenCode: defaults → global user/managed → agent markdown. **Last matching rule wins.** Studio allow rules must come after global deny (agent merge is appended — OK).

Body (short): role; load matching skill before domain work; QC lives in skill. **Do not** paste `SKILL.md`.

---

## Current code anchors

| Concern | Location |
| --- | --- |
| Hardcoded agent | `ui/agent/client.ts` — `promptAsync({ agent: "build" })` |
| Context | `ui/agent-context.ts` — catalog-derived `StudioId` includes CAD, PCB, and Media |
| Studio claims | CAD/PCB/Media viewers claim root and project contexts |
| Home | `homeAgentContext()` — no `studioId` |
| Skill install | `src/lifecycle.ts` — managed skills, markers, doctor |
| Config | `src/core/opencode-config.ts` — plugin (+ legacy mcp scrub); **extend for managed permission merge** |
| Tool compose | `src/plugin-factory.ts` + `src/core/plugin-compose.ts` (registration stays global; ownership moves to Media Studio) |
| Platform media remainder | `src/platform/media/` — native provider plumbing and shared Files API only |
| Browser smoke | `scripts/browser-smoke.ts` — home asserts `agent === "build"` |
| Packaged skills | `package.json` `files` — skills only; **no agents yet** |
| Tool name inventory | `test/parity/tools.json` (72 tools) |

---

## Implementation

### 0. Preconditions (done for 1.18.16)

- [x] Confirm `Permission.disabled` drops schemas on deny + `pattern: "*"`
- [x] Confirm agent markdown `permission` wildcards load
- [x] Confirm `mode: primary` + `hidden: true` + `promptAsync({ agent })`
- [x] Confirm skill name deny hides from `available_skills`
- [x] Confirm global denylist + agent re-allow
- [ ] Re-run isolation unit test against installed OpenCode on every CI (pin behavior, catch regressions)

### A. Agent sources (package)

- `studios/cad/agent/studio-cad.md`
- `studios/pcb/agent/studio-pcb.md`
- `studios/media/agent/studio-media.md`

Frontmatter per matrix above. Body thin.

### B. Managed lifecycle (mirror skills + permission block)

| Piece | Work |
| --- | --- |
| `src/core/package-meta.ts` | `agentSourcePath`, agent digests |
| `src/core/user-paths.ts` | `resolveOpenCodeAgentsHome` → `…/agents` |
| `src/lifecycle.ts` | install/remove/preflight/conflict/doctor for agents |
| Marker | `.opencode-studio-managed.json` beside each agent file (skill pattern) |
| `src/core/opencode-config.ts` | **Managed permission merge**: write/update only Studio-owned tool/prefix keys + `skill.studio-*`; on `remove`, delete only those keys; never clobber unrelated user `permission` |
| `package.json` `files` | ship `studios/*/agent/**` |
| `remove` / status / CLI | managed agents + permission keys + restart note |
| `create-studio` | scaffold `agent/studio-<id>.md` with prefix placeholders |

Install targets:

```text
~/.config/opencode/agents/studio-cad.md
~/.config/opencode/agents/studio-pcb.md
~/.config/opencode/agents/studio-media.md
# + managed keys in opencode.json[c] permission
```

### C. Promote Media to a catalog Studio

Media is currently an always-on platform special case and even appears in `LEGACY_STUDIO_IDS`. Remove that exception:

- Add `media` to `STUDIO_IDS`; remove it from `LEGACY_STUDIO_IDS`.
- Add `studios/media/studio.ts`, `plugin.ts`, `api.ts`, `tools.ts`, `skill/SKILL.md`, `agent/studio-media.md`, `viewer/`, and tests.
- Register Media in `src/studios.ts`, `src/studio-loaders.ts` (plugin + API), and `ui/app.tsx` (`viewerLoaders`).
- Move the agent-facing media skill and tool ownership from `src/platform/media/` into `studios/media/`.
- Remove `loadPlatformMediaPlugin` and `PLATFORM_MEDIA_SKILL_ID`; Media follows the same generic catalog/lifecycle paths as CAD/PCB.
- Keep only genuinely shared transport/provider pieces (Files preview/download endpoints and `media-go` singleton/provider wiring) under platform/core. They must not register Media model tools or skills.
- Give Media the default root `$STUDIO_HOME/studio/media`; projects live at `studio/media/<id>/`, matching CAD/PCB project semantics.
- Change media tools/skill from arbitrary OpenCode-workspace scope to the open Media project root. Default generated assets remain under `<media-project>/media/`.
- Add a Media Studio surface for project selection, asset browsing/preview, and agent work. It may reuse shared viewer primitives from `ui/`; no cross-Studio imports.

### D. UI selection

| File | Change |
| --- | --- |
| `ui/agent/resolve-prompt-agent.ts` (new) | `studioId → "studio-cad" \| "studio-pcb" \| "studio-media" \| "build"` |
| `ui/agent/client.ts` | `promptSessionAsync({ agent })` — drop hardcode |
| `ui/agent/AgentPanel.tsx` | pass resolved agent on send; optional read-only agent label |

Tests / smoke:

- Home / Files → `build`
- CAD send → `studio-cad`
- PCB send → `studio-pcb`
- Media send → `studio-media`

### E. Isolation verification (automated)

1. **Unit (no OpenCode process):** pure port of `fromConfig` + `disabled` + skill `evaluate` against `test/parity/tools.json` and the committed agent frontmatter + managed permission block. Assert hidden/visible sets.
2. **Integration (optional / CI when `opencode` on PATH):** temp `OPENCODE_CONFIG_DIR` + `OPENCODE_CONFIG_HOME`, `repair`-equivalent install, `GET /agent`, recompute disabled sets from returned `permission` rulesets; assert same matrix as spike.
3. **Do not** ship without (1). (2) is strongly preferred in CI.

### F. Tests / docs

- `test/lifecycle.test.ts` — agent install/remove/conflict; permission merge/unmerge
- `test/parity/agent-digests.json` + parity test
- `test/agent-isolation.test.ts` — schema-hide matrix from tools.json
- Package / browser smokes (agent id on send)
- Doctor IDs for agents + managed permission
- `AGENTS.md` — Studio = agent + skills + tools; managed agent paths; restart note; `OPENCODE_CONFIG_DIR` vs `OPENCODE_CONFIG_HOME`

Verify: `bun run check` (`release:check` before release-shaped cuts).

### G. Non-goals

- Agent picker chrome
- Session-sticky agent metadata
- Home → Studio auto-handoff flows
- Claude / Pi / Codex / Cursor adapters
- Publishing domain tools as MCP for other hosts
- Per-studio plugin registration / dynamic tool compose

---

## Risks

1. **OpenCode restart** after repair — agents + permission load only after restart (same as plugins/skills).
2. **OpenCode version drift** — isolation depends on `Permission.disabled` semantics; pin a unit test; re-spike if upgrading OpenCode major.
3. **Wildcard / prefix accuracy** — generate expected sets from `test/parity/tools.json`; new tool names/prefixes must update managed deny + matching agent allow.
4. **Hidden primary still listed by `GET /agent`** — fine; TUI Tab skips `hidden`. Studio UI has no picker.
5. **Mid-thread agent change** on reused session when context switches — rare; each prompt re-resolves; optional UI label.
6. **User-edited managed agents** — conflict like skills.
7. **Home cannot do CAD/PCB/Media** by design — do not re-bloat `build`; user opens the matching Studio.
8. **Managed `permission` merge** — must be surgical (only studio keys) so user bash/edit rules survive `repair`/`remove`.
9. **`task` denied on studio agents only** — `build` may still spawn `general`/`explore`, but those stay domain-blind via global denylist.

---

## Acceptance

- [x] `repair` installs managed `studio-cad` / `studio-pcb` / `studio-media` agents + managed permission keys; doctor healthy
- [x] CAD prompts → `studio-cad`; PCB → `studio-pcb`; Media → `studio-media`; Home/Files → `build`
- [x] Each Studio agent has **only** its own Studio skill and Studio tools
- [x] `build` / `plan` / `general` / `explore` have **no** CAD/PCB/Media Studio skills or tool schemas
- [x] Media is a normal catalog Studio, not a platform special case (`STUDIO_IDS`, loaders, viewer, lifecycle all generic)
- [x] New studio does not enlarge unrelated agents’ surfaces (global denylist + new agent allow)
- [x] Isolation verified by automated test (tools.json × permission rules → hidden set), not assume-deny
- [x] `bun run check` (+ browser/package smokes) green

---

## One-line

**CAD, PCB, and Media are equal Studios; each owns one hidden primary agent with only its own skill and tools, while Home/Files keeps stock `build` Studio-blind.**
