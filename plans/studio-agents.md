# Plan: Studio = agent + skills + tools

Status: **planned** (not implemented)  
Scope: **OpenCode-studio only**  
Date: 2026-08-10

Cross-platform notes (Claude Code, Pi, Codex, Cursor) informed the portable surface (skills + MCP-shaped tools) but are **out of scope** for this plan.

---

## Goal

Make each domain Studio a capability bundle:

```text
Studio = dedicated primary agent
       + domain skill(s)
       + domain tool(s)
       + project / session context
```

Examples:

```text
CAD Studio  = agent studio-cad  + skill studio-cad  + design_* / build123d_*
PCB Studio  = agent studio-pcb  + skill studio-pcb  + pcb_*
Home/Files  = agent build       (general coding fallback; see phases)
```

---

## Why

Today every Studio prompt hardcodes OpenCode’s built-in `build` agent (`ui/agent/client.ts`). Skills are managed and discoverable; tools from media + CAD + PCB are composed **globally**. The model must choose the right skill and not wander into the wrong domain tool surface.

Problems as more studios land:

- One primary agent sees every domain tool schema → selection noise and token cost
- Workflow quality depends on skill load reliability, not on a fixed role
- No clean place for domain-specific model/permission policy

Dedicated agents fix **routing and policy**. Skill and tool quality remain the main quality drivers; agents do not replace them.

---

## End-state architecture (target B — full isolation)

| Surface | Agent | Skills | Tools |
| --- | --- | --- | --- |
| CAD context | `studio-cad` | `studio-cad` only (for domain work) | CAD tools only |
| PCB context | `studio-pcb` | `studio-pcb` only | PCB tools only |
| Home / general | `build` | **no** CAD/PCB domain skills | **no** CAD/PCB domain tools |
| Future studio X | `studio-x` | `studio-x` | X tools only |

Rules:

- Skill and tools for a domain are a **capability bundle** — do not leave an operational skill visible while denying its tools (or the reverse).
- Agent prompt bodies stay **thin**; full workflow lives in `SKILL.md`.
- New studios register agent + skill + tools together; other agents do not bloat.

---

## Migration path (correct order)

Jumping straight to full isolation breaks Home/Files (“design a box” with no CAD context) unless handoff exists.

| Step | What | Build agent |
| --- | --- | --- |
| **1** | Managed primary agents `studio-cad` / `studio-pcb`; auto-select from `AgentContext.studioId` | Unchanged (full tools + skills) |
| **2** | Soft scope on dedicated agents: deny opposite-domain tools (and align skill policy) | Still full — temporary bridge |
| **3** | Explicit Home/Files guidance or handoff into CAD/PCB context when domain work is requested | Still full |
| **4** | **Full isolation (B):** strip domain skills + tools from `build` | Domain-blind general agent |

**Recommended first implementation slice = steps 1–2.**  
**Recommended destination = step 4.**  
Do not treat step 1–2 as the final product model.

---

## Decisions (locked)

| Topic | Decision |
| --- | --- |
| Agent ids | `studio-cad`, `studio-pcb` (same family as skill names) |
| Agent format | OpenCode markdown under managed install (`~/.config/opencode/agents/`) |
| Selection | Every `promptAsync`: map `activeContext.studioId` → agent; else `build` |
| Sticky session agent | No (MVP). Context change ⇒ next prompt may use a different agent |
| Agent picker UI | No (MVP) |
| Tool registration | Stay global in the plugin compose layer for steps 1–2; use agent `permission` for soft deny |
| Build isolation | Deferred until handoff/routing is solid |
| Platforms | OpenCode-studio only in this plan |
| Branching | Implement on main when scheduled; this file is the plan only |

### How agent “changes”

OpenCode accepts `agent` per prompt. Studio does **not** need Tab-cycling in its UI:

- CAD viewer claim → `studioId: "cad"` → prompts use `studio-cad`
- PCB viewer claim → `studioId: "pcb"` → `studio-pcb`
- Agent home / no `studioId` → `build`

---

## Current code anchors

| Concern | Location |
| --- | --- |
| Hardcoded agent | `ui/agent/client.ts` — `promptAsync({ agent: "build" })` |
| Context | `ui/agent-context.ts` — optional `studioId?: "cad" \| "pcb"` |
| CAD/PCB claims | `studios/cad/viewer/src/app.tsx`, `studios/pcb/viewer/src/app.tsx` |
| Home context | `homeAgentContext()` — no `studioId` |
| Skill install | `src/lifecycle.ts` — `writeManagedSkill`, markers, doctor |
| Config writes | `src/core/opencode-config.ts` — today only `plugin` + `mcp` |
| Global tools | `src/plugin-factory.ts` + `src/core/plugin-compose.ts` |
| Browser smoke | `scripts/browser-smoke.ts` — asserts `agent === "build"` on home |
| Packaged skills | `package.json` `"files"` — three `SKILL.md` paths; **no agents yet** |

OpenCode already supports:

- Global agents: `~/.config/opencode/agents/<name>.md`
- Per-prompt / session `agent`
- Agent-level `permission` (tool wildcards; preferred over deprecated `tools` bool map)

---

## Implementation sketch (when building)

### A. Agent sources (package)

- `studios/cad/agent/studio-cad.md`
- `studios/pcb/agent/studio-pcb.md`

Frontmatter sketch:

```yaml
---
description: OpenCode Studio primary agent for mechanical/FDM CAD (design_* / build123d_*).
mode: primary
permission:
  "pcb_*": deny
---
```

```yaml
---
description: OpenCode Studio primary agent for electronics/PCB (pcb_*).
mode: primary
permission:
  "design_*": deny
  "build123d_*": deny
---
```

Body (short): role line; load matching skill before domain work; do not use the other domain; point at skill for QC/readiness. **Do not** paste full `SKILL.md`.

Media tools: leave allowed on CAD/PCB agents in step 2 unless a concrete conflict appears (CAD product renders stay on `build123d_render_view` per skill).

### B. Managed lifecycle (mirror skills)

| Piece | Work |
| --- | --- |
| `src/core/package-meta.ts` | `agentSourcePath`, name helpers, digests |
| `src/core/user-paths.ts` | `resolveOpenCodeAgentsHome` → `…/agents` |
| `src/lifecycle.ts` | install / remove / preflight / conflict / doctor (`agent:cad`, `agent:pcb`) |
| Marker | `.opencode-studio-managed.json` (same pattern as skills) |
| `package.json` `files` | ship both agent markdown files |
| `remove` / status / CLI copy | mention managed agents + OpenCode restart |

Install targets:

```text
~/.config/opencode/agents/studio-cad.md
~/.config/opencode/agents/studio-pcb.md
```

(plus managed markers per chosen layout — match skill conventions as closely as possible)

### C. UI selection

| File | Change |
| --- | --- |
| `ui/agent/resolve-prompt-agent.ts` (new) | pure `studioId → "studio-cad" \| "studio-pcb" \| "build"` |
| `ui/agent/client.ts` | `promptSessionAsync({ agent })` — remove hardcode |
| `ui/agent/AgentPanel.tsx` | pass resolved agent on send |

Unit-test the resolver; update browser smoke:

- Home → `build`
- CAD panel send → `studio-cad`
- PCB panel send → `studio-pcb`

### D. Tests / docs

- `test/lifecycle.test.ts` — agent install/remove/conflict
- `test/parity/agent-digests.json` (+ parity test)
- `scripts/package-smoke.ts` — agents present after configure
- Status/doctor IDs for agents
- `AGENTS.md` — managed agent paths, restart note, Studio = agent + skills + tools

Verify: `bun run check` (and `release:check` before release-shaped cuts).

### E. Explicit non-goals (this plan file’s first build)

- Splitting plugin tool registration by studio
- Removing CAD/PCB tools/skills from `build` (step 4 only)
- Agent picker chrome
- Session-sticky agent metadata
- Files-native agent panel
- Claude / Pi / Codex / Cursor host adapters
- Publishing domain tools as MCP for other harnesses (future portable track)

---

## Portable surface (future, not this plan)

If multi-harness support is revisited later, keep domain value in:

1. **Agent Skills** (`studio-cad` / `studio-pcb` SKILL.md) — already standard-shaped  
2. **Tools as MCP** (optional export) — Claude Code / Codex / Cursor / Pi consume MCP  
3. **Thin agent wrappers** per host (OpenCode md, Claude `.claude/agents`, Codex TOML, Pi session profile)

SDK embed strength (reference only): OpenCode, Claude Agent SDK, Pi SDK strong; Codex usable; Cursor weakest as a product host.

---

## Risks

1. **OpenCode restart** after repair — agents won’t load until restart (same as plugins/skills).  
2. **Permission wildcards** must match real tool names (`pcb_*`, `design_*`, `build123d_*`).  
3. **Extra primaries** appear in OpenCode TUI Tab cycle; Studio UI hides picker — acceptable.  
4. **Mid-thread agent switch** if context changes on a reused session — rare; document.  
5. **User-edited managed agents** — conflict like skills.  
6. **Treating step 1–2 as done** leaves Build bloated forever — schedule step 4 deliberately.

---

## Acceptance criteria

### After steps 1–2

- [ ] `opencode-studio repair` installs managed `studio-cad` / `studio-pcb` agent files  
- [ ] Doctor reports agent health  
- [ ] CAD context prompts use agent `studio-cad`  
- [ ] PCB context prompts use agent `studio-pcb`  
- [ ] Home prompts use `build`  
- [ ] CAD agent cannot usefully invoke `pcb_*` (permission deny)  
- [ ] PCB agent cannot usefully invoke `design_*` / `build123d_*`  
- [ ] `build` still has full domain tools (bridge)  
- [ ] `bun run check` (and browser/package smokes) green  

### After step 4 (later)

- [ ] `build` has no CAD/PCB domain tools and no domain skill invocation path for those studios  
- [ ] Domain work from Home/Files has an explicit path into the right Studio context/agent  
- [ ] Adding a new studio does not enlarge unrelated agents’ tool/skill surfaces  

---

## One-line summary

**Destination:** each Studio owns a dedicated agent with only its skills and tools; Build is domain-blind.  
**First ship:** dedicated agents + context auto-select + opposite-domain deny on those agents; keep Build as a full temporary bridge until handoff makes stripping it safe.
