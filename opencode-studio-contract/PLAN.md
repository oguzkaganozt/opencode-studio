# OpenCode Studio Contract Plan

## 1. Purpose

OpenCode Studio Contract (OSC) defines the smallest useful common structure for
focused OpenCode Studio packages. A Studio gives an OpenCode agent a domain
capability through custom tools and a native skill, while an independent
companion viewer lets the user inspect domain content efficiently.

The first implementations are:

- `opencode-cad-studio`
- `opencode-media-studio`
- `opencode-pcb-studio`

OSC 1.0 is OpenCode-specific and Linux-only.

## 2. Goals

- Give every Studio the same OpenCode integration lifecycle.
- Give every Companion the same minimal host behavior.
- Align viewers on one frontend stack and inspection-oriented design language.
- Keep authoring, validation, storage, engines, and renderers domain-owned.
- Make compatibility testable through one black-box conformance suite.
- Keep each repository understandable without a shared runtime dependency.

OSC requires Studio-defined workflows, not an undefined promise of complete
domain coverage.

## 3. Non-Goals

OSC will not provide:

- A framework, SDK, or shared runtime package.
- A universal workspace, filesystem layout, or artifact schema.
- A shared database, catalog, job queue, workflow engine, or event bus.
- A central Studio dashboard, launcher, editor, or authoring surface.
- A shared React component package.
- A common domain renderer or engine interface.
- Cross-Studio resource relationships or transfers.
- Agent-agnostic abstractions in OSC 1.0.

## 4. Common Language

### Studio

An independently installed OpenCode package focused on one domain.

### Agent Capability

The Studio plugin, custom tools, native skill, and domain engines used by the
OpenCode agent.

### Workspace Root

The active OpenCode project directory.

### Data Root

The explicit, existing directory from which the Companion reads domain
content. OSC defines selection and confinement, not the layout below it.

### Source

Canonical domain input edited by the agent.

### Resource

Domain content that can be displayed by the Companion.

### Artifact

A Resource produced by a domain operation.

Source, Resource, and Artifact are communication roles, not a universal schema
or mandatory lifecycle. A Studio defines which roles apply and what validity
means in its domain.

### Companion

The independent local process that serves the read-only domain API and viewer.

### Viewer

The browser UI served by the Companion for inspecting domain content.

### Reference Studio

A minimal, private, working, and copyable example of OSC. It is not a runtime
dependency and does not define requirements.

### Conformance Suite

The executable black-box tests required to claim compatibility with OSC.

## 5. Normative Surface

OSC 1.0 standardizes only:

1. Package identity and the minimal Studio manifest.
2. OpenCode integration lifecycle and CLI behavior.
3. Companion Host behavior and security.
4. Viewer stack, design tokens, read-only behavior, and accessibility outcomes.
5. Cross-cutting tool, process, and output safety outcomes.
6. Black-box compatibility tests.

Internal module layout, domain APIs, tool sets, engines, storage, validation,
and release workflows remain Studio-owned.

## 6. Repository Structure

Start with one normative specification. Split it only after independent parts
create real maintenance pressure.

```text
opencode-studio-contract/
|-- README.md
|-- PLAN.md
|-- SPEC.md
|-- schemas/
|   `-- opencode-studio.schema.json
|-- viewer/
|   `-- tokens.css
|-- docs/adr/
|-- reference-studio/
`-- conformance/
```

Authority is simple:

- `SPEC.md` is normative.
- The schema is the machine-readable form of the manifest section.
- Conformance verifies observable requirements from the specification.
- ADRs explain decisions but do not override the current specification.
- Reference Studio demonstrates one compliant implementation.

## 7. Versioning

OSC uses semantic versioning. These versions remain independent:

```text
Studio package version
OSC version
Minimum OpenCode version
```

A Studio may claim compatibility only when its CI passes the pinned conformance
suite for that OSC version.

## 8. Studio Package And Manifest

Every Studio package contains:

- An OpenCode plugin.
- A native OpenCode skill.
- A Studio CLI.
- A Companion server.
- A built viewer UI.
- Domain implementations and tests as needed.
- An `opencode-studio.json` manifest.

Naming conventions:

```text
Repository/package: opencode-<domain>-studio
CLI:                opencode-<domain>-studio
Skill:              <domain>-studio
Tool prefix:        <domain>_*
```

The package root does not have to export the plugin. The manifest declares the
plugin export specifier, allowing both bare and subpath package registrations.

Examples:

```text
opencode-cad-studio
opencode-media-studio/server
opencode-pcb-studio/server
```

The manifest contains only OSC-specific metadata. Package name, CLI binaries,
files, and normal exports remain sourced from `package.json`.

Provisional shape:

```json
{
  "schemaVersion": 1,
  "id": "media",
  "contractVersion": "1.0",
  "minimumOpenCode": "1.18.2",
  "plugin": "./server",
  "skill": "./skills/media-studio"
}
```

Additional capability metadata is deferred until it changes defined
conformance behavior.

Absolute `dist/plugin.js` paths are development-only integration paths.

## 9. Lifecycle And CLI

The package manager owns package installation, update, and physical removal.
The Studio CLI owns only OpenCode integration.

Every Studio exposes:

```text
opencode-<domain>-studio install
opencode-<domain>-studio remove
opencode-<domain>-studio doctor
opencode-<domain>-studio serve
```

Options are command-specific:

| Command | Required behavior and options |
| --- | --- |
| `install` | `--scope user\|project`, `--dry-run`, `--json` |
| `remove` | `--scope user\|project`, `--dry-run`, `--json` |
| `doctor` | `--scope user\|project`, `--json` |
| `serve` | required `--root`, optional `--host`, `--port` |

All commands support `--help`. Human-readable output is the default. Success
exits with code `0`; errors exit non-zero. Raw stack traces require explicit
debug mode.

Lifecycle rules:

- `user` is the default install, remove, and doctor scope.
- `install` is an idempotent synchronization operation.
- There is no core `update` command.
- `install` registers the manifest-declared package specifier and installs the
  native skill atomically.
- Existing non-OSC config is not silently adopted or replaced.
- Conflicts stop with a useful explanation.
- `remove` never deletes user Source, Resource, Artifact, or Data Root content.
- System dependencies are reported, not silently installed.

### Safe OpenCode Config Editing

Lifecycle commands modify only the Studio-owned config entry. They must:

- Preserve unrelated config fields, ordering where practical, and comments in
  supported OpenCode config formats.
- Parse and validate the complete result before replacing the original file.
- Write through a temporary file and publish with an atomic rename.
- Detect whether the source file changed between read and publish; concurrent
  changes stop the operation instead of being overwritten.
- Leave the original file unchanged after parse, validation, conflict, or write
  failure.
- Remove or replace only the exact manifest-declared package specifier.
- Never restore an entire historical config file during `remove`.

Persistent systemd operation is an optional Studio extension. It is not part of
core lifecycle conformance. Existing operational requirements may be retained
under separate service commands rather than changing the meaning of core
`install` and `remove`.

## 10. Skill Ownership

Safe synchronization across package versions requires minimal ownership
metadata. This is not an install history database.

An installed skill directory contains:

```text
<skill>/
|-- SKILL.md
`-- .osc-managed.json
```

The marker records Studio ID, installed package version, and the managed
content digest.

Rules:

- An unmarked existing skill is a conflict.
- `install` may replace a marked skill only when its current digest matches the
  recorded digest.
- A user-modified skill is preserved and reported.
- `remove` deletes only a recognized, unchanged managed skill and marker.
- Sibling user files and non-empty directories are preserved.

## 11. Doctor

Core `doctor` checks:

- OpenCode compatibility.
- Manifest and package resolution.
- Plugin registration.
- Skill ownership and version drift.
- Data Root existence and access.
- Companion reachability and port conflicts when configured.
- Required domain dependencies declared by the Studio.

Doctor reports pass, warning, or failure and identifies where each effective
configuration value came from. It gives repair instructions but does not
silently modify configuration or install dependencies.

## 12. Companion Host

The Companion is an independent local process. `serve --root <path>` receives
an explicit existing Data Root. Startup must not create or mutate that root.

Core endpoints:

```text
GET /api/health
GET /api/studio
```

Minimal responses:

```json
{ "status": "ok" }
```

```json
{
  "id": "pcb",
  "packageVersion": "0.1.0",
  "contractVersion": "1.0"
}
```

Host rules:

- Default bind is `127.0.0.1`.
- OSC 1.0 covers loopback serving only.
- UI and API use the same origin.
- The Data Root is read-only from the Companion's perspective.
- Domain endpoints are owned by the Studio.
- Polling and SSE are allowed only for observation.
- Browser routes may use SPA fallback.
- `SIGINT` and `SIGTERM` trigger graceful shutdown.
- Absolute filesystem paths, credentials, and secrets are not exposed over
  HTTP.
- Unknown API paths return a JSON `404` response.
- No shared auth, database, registry, queue, or event bus is introduced.

Common HTTP errors use a small envelope:

```json
{
  "error": {
    "code": "resource_not_found",
    "message": "Resource was not found."
  }
}
```

The Companion URL is explicit configuration. OSC does not add automatic
process discovery or a central launcher.

## 13. Companion Security

Loopback binding is necessary but not sufficient. Every Companion must include:

- Canonical Data Root confinement.
- Race-resistant, no-follow file access where supported by the runtime.
- Host validation or equivalent DNS-rebinding protection.
- `X-Content-Type-Options: nosniff`.
- A CSP that blocks framing, base rewriting, and undeclared application code.
- Redaction of credentials, tokens, and sensitive environment values.
- No telemetry by default.

Application JavaScript, CSS, fonts, and icons are packaged locally. Remote
domain Resources are a separate concern: a Studio may load them only through an
explicit domain policy and allowlist.

## 14. Viewer Profile

### Required Stack

The aligned viewer stack follows the existing majority implementation:

```text
React 19
TypeScript strict
Vite
React Router
TanStack Query
Tailwind CSS 4
OSC CSS custom-property tokens
```

Lucide and Studio unit-test libraries are optional. Browser and accessibility
verification live in the central conformance runner, which may use Playwright
and axe without forcing those dependencies into every Studio.

Domain renderers remain Studio-owned and are lazy-loaded.

### Design Language

The shared direction is a compact, content-first precision inspection
instrument rather than a dashboard or editor.

- Dark graphite application shell.
- Domain canvas may be dark or light when content requires it.
- Thin separators, low radii, and minimal shadows.
- No decorative gradients or card-heavy dashboard layouts.
- Large, uninterrupted viewport.
- Barlow for interface typography.
- IBM Plex Mono for measurements, coordinates, IDs, and technical metadata.
- Fonts packaged locally for offline operation.
- Amber CAD accent, coral Media accent, and cyan PCB accent.
- Shared semantic tokens for warning, error, stale, and invalid states.

The Contract provides canonical tokens. Studios implement them locally and do
not import a shared UI runtime package.

### Layout And Interaction

Desktop viewers may use:

```text
Studio Bar
Resource Rail | Viewport | Inspector
Status Strip
```

Regions are optional. The viewport remains dominant. Mobile is single-pane;
navigation and inspection become separate routes, drawers, or sheets rather
than compressed desktop columns.

Behavioral requirements:

- Resource selection is deep-linkable and survives refresh.
- Keyboard navigation and visible focus work.
- Color is never the only carrier of state.
- Motion respects `prefers-reduced-motion`.
- Heavy renderers are lazy-loaded.
- Hidden render loops and media work are suspended.
- Clipboard feedback requires explicit user action.
- UI assets work without a runtime CDN.

### Read-Only Boundary

The viewer may list, filter, inspect, measure, compare, play, download, control
local presentation state, and create clipboard feedback.

The viewer must not:

- Create or edit Data Root content.
- Start builds, generation, conversion, or provider jobs.
- Upload, rename, move, copy, or delete Data Root content.
- Reimplement domain validation policy.
- Act as an agent workflow or authoring surface.

Opening a local browser file in memory is allowed when it is not published to
the Data Root.

## 15. Agent And Engine Safety

OSC does not require a named `Domain Core` module or internal directory. It
requires only one authoritative owner for each domain policy so the plugin and
Companion cannot contradict each other. A Studio may share code, consume
published validation metadata, or expose read-only status as appropriate.

Tool baseline:

- Names use the declared domain prefix.
- Mutations request the real OpenCode permission set.
- Abort and timeout propagate to child processes.
- Process success, output availability, and domain validity remain distinct.
- Large data is accessed through summaries and targeted reads.
- Errors state the cause and a useful next action.

Each Studio documents external execution that can affect trust or cost:

- System binaries used.
- Project or workspace code executed.
- Runtime downloads and version pinning.
- Remote providers, credentials, and billing effects.
- Working directory and inherited environment.
- Timeout, process-tree termination, and output limits.

Implicit unpinned runtime downloads are not acceptable for production paths.
Doctor reports missing engines without silently downloading them.

## 16. Output Safety

OSC defines one cross-domain publication outcome:

> Failure, cancellation, or concurrency must not expose partial or stale output
> as current and valid.

A Studio may preserve a last-known-good output with explicit stale status or
remove obsolete output. OSC does not mandate one retention, locking, freshness,
or generation-directory model.

Each Studio documents its canonical inputs, generated outputs, and validity
dimensions. Conformance does not impose one universal `verified` boolean.

## 17. Reference Studio

Reference Studio is built only after a provisional behavior matrix and
specification have been checked against all three existing Studios.

It is:

- Minimal, deterministic, private, and working.
- Copyable as the start of a new Studio.
- Built with the required Viewer stack and OSC tokens.
- Free of production CAD, Media, or PCB policy.
- Free of a universal Resource or filesystem model.
- Never imported by a Studio.

Reference Studio demonstrates requirements; it does not create them.

## 18. Conformance

The conformance runner is a pinned development and CI dependency, never a
Studio runtime dependency.

OSC requires one integration entry point:

```text
bun run test:conformance
```

The black-box suite verifies:

- Manifest validity and declared plugin loading from a packed package.
- CLI lifecycle effects, conflicts, dry-run behavior, and JSON diagnostics.
- Skill install, upgrade, user modification, and safe removal.
- Companion root selection, loopback binding, health, identity, and shutdown.
- Traversal, symlink, Host, and read-only protections.
- Viewer loading, responsive behavior, deep links, keyboard access, and basic
  accessibility.
- Required Viewer stack and packaged OSC tokens.
- Absence of runtime CDN dependencies and obvious packaged secrets.
- Data Root contents remain unchanged during Companion and Viewer tests.

Typecheck, lint, unit-test frameworks, build script names, and publication
workflows are Studio-owned. OSC tests packed behavior rather than repository
internals.

## 19. Migration Strategy

Migration is implementation work in each Studio repository. OSC records only
the shared target and validation order.

All migrations preserve user data and use a major release when changing an
existing public package or command contract.

Key migration intent:

- CAD keeps its read-only inspection model, gains the aligned Viewer stack, and
  adopts safe skill ownership metadata.
- PCB removes Companion-owned build orchestration and keeps manufacturing
  policy authoritative outside the Viewer.
- Media moves browser file management out of the Viewer, adds a native skill,
  and preserves any justified always-on deployment under separate optional
  service commands.
- Existing package exports remain valid where possible; manifest plugin
  specifiers avoid unnecessary export breaks.

Legacy config, service, symlink, and release cleanup procedures live in the
affected Studio repository, not in OSC.

## 20. Delivery Phases

### Phase 0: Behavior Matrix

- Record current package, lifecycle, skill, Companion, Viewer, engine, and
  security behavior for CAD, Media, and PCB.
- Identify common behavior and intentional domain differences.

### Phase 1: Provisional OSC 0.x

- Write `SPEC.md` and the minimal manifest schema.
- Record only load-bearing decisions as ADRs.
- Keep requirements provisional until exercised by real implementations.

### Phase 2: Reference And Conformance

- Build Reference Studio from the provisional specification.
- Prove declared package-specifier loading in a clean consumer.
- Build black-box package, lifecycle, Companion, security, and Viewer tests.

### Phase 3: Studio Migrations

- Migrate CAD, PCB, and Media incrementally.
- Revise OSC only where real implementations expose ambiguity.
- Keep OSC on `0.x` throughout migration.

### Phase 4: OSC 1.0 (complete)

- All three Studios pass the pinned studio-core suite (`test:conformance:studios`).
- Minimal manifest and observable lifecycle/host behavior frozen at OSC `1.0`.
- No Studio imports an OSC runtime implementation (`runtime.no-osc-dependency`).

## 21. OSC 1.0 Completion Criteria

OSC 1.0 is ready when:

- `SPEC.md` and the manifest schema are stable.
- Reference Studio passes conformance.
- Packed plugin loading works through each manifest-declared specifier.
- Install, remove, doctor, and serve behavior is proven on Linux.
- Companion and Viewer safety is proven with an unchanged Data Root.
- CAD, Media, and PCB independently pass conformance.
- External engine trust and network effects are documented by each Studio.
- No Studio takes a shared OSC runtime dependency.

## 22. Deferred Details

These details may be resolved while writing the provisional specification
without reopening the architecture:

- Exact schema property constraints.
- Studio-specific default ports.
- Exact JSON diagnostic field names.
- HTTP cache policy.
- Final token values and font subsets.
- Conformance runner packaging.
- Optional user-level systemd command shape.

Any proposal for a shared runtime framework, universal workspace, mutable base
Companion, or central Studio control plane requires an explicit ADR and is
outside this plan.
