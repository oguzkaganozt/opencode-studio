# OpenCode Studio Contract Specification

**Status:** OSC `1.0`  
**Normative:** This document  
**Authority:** On conflict, this specification overrides ADRs and PLAN.md. ADRs explain decisions; PLAN.md is design history.

OSC defines the smallest useful common structure for focused OpenCode Studio packages on Linux. It is a contract, not a framework or SDK. Studios MUST NOT take a shared OSC runtime dependency.

## 1. Conformance language

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as described in RFC 2119.

A Studio claims compatibility with a specific OSC version only when its CI passes the pinned conformance suite for that version.

Versions remain independent:

- Studio package version
- OSC contract version (`contractVersion` in the manifest)
- Minimum OpenCode version (`minimumOpenCode` in the manifest)

## 2. Common language

| Term | Meaning |
| --- | --- |
| Studio | Independently installed OpenCode package focused on one domain |
| Agent Capability | Studio plugin, custom tools, native skill, and domain engines |
| Workspace Root | Active OpenCode project directory |
| Data Root | Explicit existing directory from which the Companion reads domain content |
| Source | Canonical domain input edited by the agent |
| Resource | Domain content displayable by the Companion |
| Artifact | A Resource produced by a domain operation |
| Companion | Independent local process serving the read-only domain API and Viewer |
| Viewer | Browser UI served by the Companion for inspecting domain content |
| Reference Studio | Minimal private example of OSC; not a runtime dependency |
| Conformance Suite | Executable black-box tests required to claim OSC compatibility |

Source, Resource, and Artifact are communication roles, not a universal schema. A Studio defines which roles apply and what validity means in its domain.

## 3. Normative surface

OSC standardizes only:

1. Package identity and the minimal Studio manifest
2. OpenCode integration lifecycle and CLI behavior
3. Companion Host behavior and security
4. Viewer stack, design tokens, read-only behavior, and accessibility outcomes
5. Cross-cutting tool, process, and output safety outcomes
6. Black-box compatibility tests

Internal module layout, domain APIs, tool sets, engines, storage, validation, and release workflows remain Studio-owned.

## 4. Package and manifest

### 4.1 Naming

A Studio MUST use:

| Item | Pattern |
| --- | --- |
| Repository / package | `opencode-<domain>-studio` |
| CLI binary | `opencode-<domain>-studio` |
| Skill | `<domain>-studio` |
| Tool prefix | `<domain>_*` |

Provider-specific tools MAY use additional prefixes when documented by the Studio.

### 4.2 Package contents

Every Studio package MUST contain:

- An OpenCode plugin
- A native OpenCode skill
- A Studio CLI
- A Companion server
- A built Viewer UI
- An `opencode-studio.json` manifest at the package root

Domain implementations and tests are Studio-owned.

### 4.3 Manifest

The file `opencode-studio.json` MUST validate against
[`schemas/opencode-studio.schema.json`](schemas/opencode-studio.schema.json).

Required fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | integer | Manifest schema major version; currently `1` |
| `id` | string | Short domain id (e.g. `cad`, `media`, `pcb`) |
| `contractVersion` | string | OSC version this Studio targets |
| `minimumOpenCode` | string | Minimum compatible OpenCode version |
| `plugin` | string | Package export specifier for the OpenCode plugin |
| `skill` | string | Package-relative path to the skill directory |

Example:

```json
{
  "schemaVersion": 1,
  "id": "media",
  "contractVersion": "0.1.0",
  "minimumOpenCode": "1.18.2",
  "plugin": "./server",
  "skill": "./skills/media-studio"
}
```

Rules:

- Package name, CLI binaries, files, and normal exports MUST remain sourced from `package.json`.
- `plugin` MAY be a bare package name (`.`-equivalent consumer registration) or a subpath such as `./server`.
- Absolute `dist/plugin.js` paths are development-only and MUST NOT be required for published packages.
- Additional capability metadata is deferred until it changes defined conformance behavior.

## 5. Lifecycle and CLI

### 5.1 Commands

The package manager owns package installation, update, and physical removal. The Studio CLI owns only OpenCode integration.

Every Studio MUST expose:

```text
opencode-<domain>-studio install
opencode-<domain>-studio remove
opencode-<domain>-studio doctor
opencode-<domain>-studio serve
```

| Command | Required options |
| --- | --- |
| `install` | `--scope user\|project`, `--dry-run`, `--json` |
| `remove` | `--scope user\|project`, `--dry-run`, `--json` |
| `doctor` | `--scope user\|project`, `--json` |
| `serve` | required `--root <path>`; optional `--host`, `--port` |

All commands MUST support `--help`. Human-readable output is the default. Success exits `0`; errors exit non-zero. Raw stack traces MUST require an explicit debug mode.

There is no core `update` command. Persistent systemd or always-on deployment MAY exist as a Studio extension under separate service commands and MUST NOT redefine core `install` or `remove`.

### 5.2 Lifecycle rules

- `user` is the default scope for `install`, `remove`, and `doctor`.
- `install` MUST be an idempotent synchronization operation.
- `install` MUST register the manifest-declared package specifier and install the native skill atomically.
- Existing non-OSC config MUST NOT be silently adopted or replaced.
- Conflicts MUST stop with a useful explanation.
- `remove` MUST NEVER delete user Source, Resource, Artifact, or Data Root content.
- System dependencies MUST be reported, not silently installed.

### 5.3 Safe OpenCode config editing

Lifecycle commands that modify OpenCode configuration MUST:

- Modify only the Studio-owned config entry
- Preserve unrelated config fields, ordering where practical, and comments in supported OpenCode config formats
- Parse and validate the complete result before replacing the original file
- Write through a temporary file and publish with an atomic rename
- Detect whether the source file changed between read and publish; concurrent changes MUST stop the operation
- Leave the original file unchanged after parse, validation, conflict, or write failure
- Remove or replace only the exact manifest-declared package specifier
- NEVER restore an entire historical config file during `remove`

## 6. Skill ownership

An installed skill directory MUST contain:

```text
<skill>/
|-- SKILL.md
`-- .osc-managed.json
```

`.osc-managed.json` MUST record:

- Studio `id`
- Installed package version
- Managed content digest of the skill payload

Rules:

- An unmarked existing skill is a conflict.
- `install` MAY replace a marked skill only when its current digest matches the recorded digest.
- A user-modified skill MUST be preserved and reported.
- `remove` MUST delete only a recognized, unchanged managed skill and marker.
- Sibling user files and non-empty directories MUST be preserved.

## 7. Doctor

Core `doctor` MUST check:

- OpenCode compatibility against `minimumOpenCode`
- Manifest and package resolution
- Plugin registration
- Skill ownership and version drift
- Data Root existence and access when a root is configured or supplied
- Companion reachability and port conflicts when configured
- Required domain dependencies declared by the Studio

Doctor MUST report pass, warning, or failure and identify where each effective configuration value came from. It MUST give repair instructions and MUST NOT silently modify configuration or install dependencies.

## 8. Companion host

### 8.1 Process model

The Companion is an independent local process. `serve --root <path>` MUST receive an explicit existing Data Root. Startup MUST NOT create or mutate that root.

Default bind MUST be `127.0.0.1`. OSC `1.0` covers loopback serving only. UI and API MUST use the same origin.

### 8.2 Core endpoints

| Endpoint | Response |
| --- | --- |
| `GET /api/health` | `{ "status": "ok" }` |
| `GET /api/studio` | `{ "id", "packageVersion", "contractVersion" }` |

Example identity response:

```json
{
  "id": "pcb",
  "packageVersion": "0.1.0",
  "contractVersion": "0.1.0"
}
```

### 8.3 Host rules

- The Data Root is read-only from the Companion's perspective.
- Domain endpoints are owned by the Studio.
- Polling and SSE are allowed only for observation of existing state; they MUST NOT trigger domain builds, generation, conversion, or Data Root mutation.
- Browser routes MAY use SPA fallback.
- `SIGINT` and `SIGTERM` MUST trigger graceful shutdown.
- Absolute filesystem paths, credentials, and secrets MUST NOT be exposed over HTTP.
- Unknown API paths MUST return a JSON `404` response.
- No shared auth, database, registry, queue, or event bus is introduced by OSC.
- The Companion URL is explicit configuration. OSC does not add automatic process discovery or a central launcher.

### 8.4 Error envelope

Common HTTP errors SHOULD use:

```json
{
  "error": {
    "code": "resource_not_found",
    "message": "Resource was not found."
  }
}
```

## 9. Companion security

Every Companion MUST include:

- Canonical Data Root confinement
- Race-resistant, no-follow file access where supported by the runtime
- Host validation or equivalent DNS-rebinding protection
- `X-Content-Type-Options: nosniff` on responses
- A Content-Security-Policy that blocks framing, base rewriting, and undeclared application code
- Redaction of credentials, tokens, and sensitive environment values from HTTP responses and default logs
- No telemetry by default

Application JavaScript, CSS, fonts, and icons MUST be packaged locally. Remote domain Resources are a separate concern: a Studio MAY load them only through an explicit domain policy and allowlist.

## 10. Viewer profile

### 10.1 Required stack

The Viewer MUST use:

- React 19
- TypeScript strict
- Vite
- React Router
- TanStack Query
- Tailwind CSS 4
- OSC CSS custom-property tokens copied from [`viewer/tokens.css`](viewer/tokens.css)

Lucide and Studio unit-test libraries are optional. Browser and accessibility verification live in the central conformance runner and MAY use Playwright and axe without forcing those dependencies into every Studio.

Domain renderers remain Studio-owned and MUST be lazy-loaded when heavy.

### 10.2 Design language

The shared direction is a compact, content-first precision inspection instrument.

Studios MUST:

- Use a dark graphite application shell
- Allow a dark or light domain canvas when content requires it
- Prefer thin separators, low radii, and minimal shadows
- Avoid decorative gradients and card-heavy dashboard layouts
- Keep a large, uninterrupted viewport
- Use Barlow for interface typography
- Use IBM Plex Mono for measurements, coordinates, IDs, and technical metadata
- Package fonts locally for offline operation
- Apply domain accents via tokens: amber CAD, coral Media, cyan PCB
- Use shared semantic tokens for warning, error, stale, and invalid states

Studios implement tokens locally and MUST NOT import a shared UI runtime package from OSC.

### 10.3 Layout and interaction

Desktop viewers MAY use:

```text
Studio Bar
Resource Rail | Viewport | Inspector
Status Strip
```

Regions are optional. The viewport MUST remain dominant. Mobile MUST be single-pane; navigation and inspection become separate routes, drawers, or sheets.

Behavioral requirements:

- Resource selection MUST be deep-linkable and survive refresh
- Keyboard navigation and visible focus MUST work
- Color MUST NEVER be the only carrier of state
- Motion MUST respect `prefers-reduced-motion`
- Heavy renderers MUST be lazy-loaded
- Hidden render loops and media work MUST be suspended
- Clipboard feedback requires explicit user action
- UI assets MUST work without a runtime CDN

### 10.4 Read-only boundary

The Viewer MAY list, filter, inspect, measure, compare, play, download, control local presentation state, and create clipboard feedback.

The Viewer MUST NOT:

- Create or edit Data Root content
- Start builds, generation, conversion, or provider jobs
- Upload, rename, move, copy, or delete Data Root content
- Reimplement domain validation policy
- Act as an agent workflow or authoring surface

Opening a local browser file in memory is allowed when it is not published to the Data Root.

## 11. Agent and engine safety

OSC does not require a named Domain Core module. It requires one authoritative owner for each domain policy so the plugin and Companion cannot contradict each other.

Tool baseline:

- Names MUST use the declared domain prefix (or a documented provider prefix)
- Mutations MUST request the real OpenCode permission set
- Abort and timeout MUST propagate to child processes
- Process success, output availability, and domain validity MUST remain distinct
- Large data SHOULD be accessed through summaries and targeted reads
- Errors MUST state the cause and a useful next action

Each Studio MUST document external execution that can affect trust or cost:

- System binaries used
- Project or workspace code executed
- Runtime downloads and version pinning
- Remote providers, credentials, and billing effects
- Working directory and inherited environment
- Timeout, process-tree termination, and output limits

Implicit unpinned runtime downloads are not acceptable for production paths. Doctor MUST report missing engines without silently downloading them.

## 12. Output safety

OSC defines one cross-domain publication outcome:

> Failure, cancellation, or concurrency MUST NOT expose partial or stale output as current and valid.

A Studio MAY preserve a last-known-good output with explicit stale status or remove obsolete output. OSC does not mandate one retention, locking, freshness, or generation-directory model.

Each Studio MUST document its canonical inputs, generated outputs, and validity dimensions. Conformance does not impose one universal `verified` boolean.

## 13. Conformance

The conformance runner is a pinned development and CI dependency, never a Studio runtime dependency.

OSC requires one integration entry point against the Reference Studio:

```text
bun run test:conformance
```

and one black-box, studio-agnostic entry point that a Studio runs against its own package root to claim compatibility:

```text
bun run test:conformance --studio <path-to-studio>
```

The black-box suite verifies:

- Manifest validity and declared plugin loading from a packed package
- CLI lifecycle effects, conflicts, dry-run behavior, and JSON diagnostics
- Skill install, upgrade, user modification, and safe removal
- Companion root selection, loopback binding, health, identity, and shutdown
- Traversal, symlink, Host, and read-only protections
- Viewer loading, responsive behavior, deep links, keyboard access, and basic accessibility
- Required Viewer stack and packaged OSC tokens
- Absence of runtime CDN dependencies and obvious packaged secrets
- Data Root contents remain unchanged during Companion and Viewer tests

Typecheck, lint, unit-test frameworks, build script names, and publication workflows are Studio-owned. OSC tests packed behavior rather than repository internals.

Reference Studio and the conformance runner live in this repository under
`reference-studio/` and `conformance/`. Phase 4 is complete once CAD, Media,
and PCB each independently pass `bun run test:conformance:studios` against
their own package root.

## 14. Non-requirements

OSC does not provide and a conforming Studio MUST NOT require:

- A framework, SDK, or shared runtime package
- A universal workspace, filesystem layout, or artifact schema
- A shared database, catalog, job queue, workflow engine, or event bus
- A central Studio dashboard, launcher, editor, or authoring surface
- A shared React component package
- A common domain renderer or engine interface
- Cross-Studio resource relationships or transfers
- Agent-agnostic abstractions in OSC 1.0

## 15. Deferred details

These may be resolved while evolving OSC `1.x` without reopening architecture:

- Exact schema property constraints beyond the minimal manifest
- Studio-specific default ports
- Exact JSON diagnostic field names
- HTTP cache policy
- Final token values and font subsets
- Conformance runner packaging
- Optional user-level systemd command shape
