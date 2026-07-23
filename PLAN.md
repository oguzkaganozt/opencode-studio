# OpenCode Studio Consolidation Plan

## 1. Purpose

OpenCode Studio consolidates the existing CAD, Media, PCB, Startup, and Studio
Contract repositories into one configurable product.

The priorities, in order, are:

1. Prevent behavioral and visual drift between Studios.
2. Make a new Studio cheap to add and difficult to add incorrectly.
3. Preserve existing agent tools, skills, and domain safety rules.
4. Give users one coherent backend and web application.
5. Keep installation, configuration, CI, and release as small as possible.

This is a greenfield internal system used by three people. There are no active
external users, persisted installation contracts, independent release teams,
or backwards-compatibility requirements. We can replace the old architecture
directly rather than maintaining wrappers or migration layers.

## 2. Accepted decisions

### 2.1 One product

The final system has:

- One private GitHub repository: `opencode-studio`
- One npm package: `opencode-studio`
- One `package.json` and Bun lockfile
- One version and release tag, such as `v0.1.0`
- One primary OpenCode plugin registration, with a Media-owned auxiliary export
  only if the provider spike proves it necessary
- One CLI binary: `opencode-studio`
- One local backend process
- One shared Viewer application
- One CI workflow and one release workflow

CAD, Media, PCB, and Startup are first-party source modules. They are not
independently versioned packages or repositories.

### 2.2 Installed does not mean enabled

Installing `opencode-studio` only makes the code available. It must not expose
all tools and skills to every OpenCode session.

Each project explicitly chooses an exact set of enabled Studios:

```bash
opencode-studio configure cad pcb
```

The primary configuration experience is the OpenCode Studio home page. The CLI
uses the same configuration service for headless use and automation.

The canonical project configuration is:

```json
{
  "enabled": ["cad", "pcb"]
}
```

It lives at:

```text
<workspace>/.opencode/studio.json
```

Optional root overrides may be added when a Studio cannot use its default:

```json
{
  "enabled": ["cad", "media"],
  "roots": {
    "media": "/home/user/media-library"
  }
}
```

Configuration fails closed. If the file is missing or invalid, no Studio is
enabled. Unknown Studio IDs are errors, not ignored values.

### 2.3 One shared implementation, domain-owned behavior

The shared application owns lifecycle, process, HTTP, security, configuration,
Viewer shell, and composition behavior. A Studio owns its tools, skill, domain
logic, domain API, Viewer pages, external engines, and domain validation.

Studios must not import another Studio's domain code. Reusable behavior belongs
in the shared core only when at least two Studios require the same policy and a
single implementation reduces total maintenance cost.

### 2.4 Provider-agnostic core with explicit domain exceptions

The shared Studio model remains provider- and model-agnostic. PCB and Startup
contribute ordinary tools, skills, APIs, and Viewer pages. Do not add generic
provider or MCP frameworks to the common Studio contract for one domain's need.

Two explicit domain integrations are accepted:

- CAD owns a managed `build123d-mcp` OpenCode configuration contribution.
- Media owns its native-media provider adapter and the model/provider hooks
  required for `opencode` and `opencode-go`.

Media generation tools such as `fal_*` and `chatgpt_image_generate` remain
normal domain tools. They do not make the common Studio model provider-aware.

Before implementation, a focused Media test must prove whether both current
provider hooks are required. If the OpenCode hook API cannot represent both in
the central plugin, enabling Media may register an auxiliary plugin export from
the same `opencode-studio` package. This is a Media-owned exception, not a new
package or general extension mechanism.

### 2.5 No legacy architecture in the new repository

The following are not carried forward as active concepts:

- Separate Studio repositories or Git histories
- Separate npm packages, versions, CLIs, or release workflows
- `opencode-studio-contract` as a runtime or package contract
- OSC `contractVersion` and the old per-package manifest schema
- Per-Studio lifecycle, Companion host, Viewer shell, tokens, and ports
- Surface file copying, sync scripts, submodules, or cross-repository CI
- Reference Studio as a second application
- Media systemd or external-network deployment
- Dynamic third-party Studio discovery
- Microfrontends, module federation, Turborepo, or Changesets

The old repositories may remain archived as historical source material after
the consolidated package passes parity checks. The new repository has no
runtime, build, CI, or documentation dependency on them.

## 3. Target repository structure

```text
opencode-studio/
|-- package.json
|-- bun.lock
|-- biome.json
|-- tsconfig.json
|-- vite.config.ts
|-- src/
|   |-- cli.ts
|   |-- plugin.ts
|   |-- server.ts
|   |-- config.ts
|   |-- lifecycle.ts
|   `-- core/
|       |-- plugin-compose.ts
|       |-- registry.ts
|       |-- security.ts
|       |-- paths.ts
|       `-- errors.ts
|-- studios/
|   |-- cad/
|   |   |-- studio.ts
|   |   |-- plugin.ts
|   |   |-- api.ts
|   |   |-- viewer/
|   |   |-- skill/SKILL.md
|   |   |-- test/
|   |   `-- forge/
|   |-- media/
|   |-- pcb/
|   `-- startup/
|-- ui/
|   |-- main.tsx
|   |-- app.tsx
|   |-- shell/
|   |-- tokens.css
|   `-- styles.css
|-- scripts/
|   |-- build.ts
|   |-- package-smoke.ts
|   `-- create-studio.ts
|-- test/
|   |-- registry.test.ts
|   |-- plugin-composition.test.ts
|   |-- lifecycle.test.ts
|   |-- server.test.ts
|   `-- browser/
|-- docs/
|   |-- architecture.md
|   `-- new-studio.md
`-- .github/workflows/
    |-- ci.yml
    `-- release.yml
```

This is a modular monolith, not a multi-package workspace. Separate package
boundaries would add versioning, dependency, build, and navigation overhead
without serving the accepted single-package distribution model.

## 4. Studio composition model

### 4.1 Studio contribution

Each Studio contributes a small, explicit set of surfaces:

```ts
type StudioDefinition = {
  id: string
  label: string
  description: string
  skill: string
  requiredEngines: string[]
  root: {
    default: "workspace" | "user-data"
    create: boolean
  }
  doctor?: StudioDoctorCheck[]
}
```

Target-specific loaders provide the executable surfaces:

- Plugin loader
- API router loader
- Viewer route loader
- Skill package entry

A single canonical catalog defines the available Studio IDs. Invariant tests
require every loader map and skill entry to contain exactly the same IDs. This
keeps browser-only code out of the Bun runtime build while preventing a Studio
from being registered in only one surface.

### 4.2 Plugin composition

The central OpenCode plugin initializes only configured Studios.

It must preserve the full OpenCode plugin surface, not only `tool` maps. Current
Studios contribute event hooks, config transforms, provider behavior, chat
transforms, and tool execution hooks in addition to tools.

Composition rules:

- Merge tool maps and reject duplicate tool names.
- Compose compatible hooks in deterministic catalog order.
- Preserve output mutation ordering for transform hooks.
- Reject conflicting singleton contributions such as providers or auth, except
  the proven Media provider exception defined in Section 2.4.
- Read Studio-specific options only from `.opencode/studio.json`.
- Do not import or initialize a disabled Studio's runtime behavior.
- Report composition errors during startup with the Studio IDs involved.

The tool inventory must remain stable during consolidation. Preserve every
existing tool name and argument schema, including unprefixed Media tools such as
`read_media` and `chatgpt_image_generate`, unless a deliberate product decision
says otherwise.

Hook composition must be explicit for every supported OpenCode hook key. Mutable
transforms run sequentially in catalog order, errors stop the chain, and dispose
handlers run in reverse order. Unknown future hook keys are rejected until their
composition semantics are defined.

### 4.3 Skill composition

Existing skill names and instructions are preserved:

- `cad-studio`
- `media-studio`
- `pcb-studio`
- `startup-studio`

All skill sources ship in the package, but configuration installs only selected
skills. Removing a Studio removes only an unchanged, Studio-managed skill. It
must never overwrite or delete an unmarked or user-modified skill.

### 4.4 Domain-owned OpenCode integrations

Enabling CAD also manages its pinned `build123d-mcp` entry in project OpenCode
configuration. Disabling CAD removes only the unchanged managed MCP entry. A
conflicting user-owned MCP entry blocks the configuration transition.

Enabling Media loads its native-media adapter and provider hooks. The package
must expose a stable Media provider subpath, such as
`opencode-studio/media-provider`, and packed-package tests must exercise both
`opencode` and `opencode-go` behavior.

No other Studio receives provider or MCP concepts unless a concrete domain need
is demonstrated later.

## 5. Configuration and activation

### 5.1 Workspace and configuration resolution

CLI, web server, lifecycle, and plugin code must use one `resolveWorkspace()`
implementation:

1. Use an explicit `--workspace` path when supplied.
2. Otherwise use the command's current working directory.
3. Require an existing directory and return its canonical absolute path.
4. Do not infer a different Git root or silently walk to a parent project.

Project state is always relative to that resolved workspace:

```text
<workspace>/.opencode/studio.json
<workspace>/.opencode/skills/
<workspace>/opencode.json or opencode.jsonc
```

When updating OpenCode configuration, use the existing `opencode.jsonc` or
`opencode.json`; fail if both exist; create `opencode.json` if neither exists.
The managed plugin specifier is the exact installed version,
`opencode-studio@<packageVersion>`. Studio activation, roots, and domain options
come only from `.opencode/studio.json`; plugin tuple options are not a second
configuration channel.

Implicit configuration as effective UID 0 is rejected. Tests and explicit
administrative tooling may provide isolated paths, but normal CLI and web use
must not create root-owned project state.

### 5.2 Web-first configuration

`opencode-studio serve --workspace .` always starts the shared shell, even when
no Studio is configured. The home page displays available Studios as selectable
cards with:

- Name and description
- Enabled or disabled state
- Effective root
- Required external engines
- Doctor status

Applying a selection calls the same `configureStudios()` operation used by the
CLI. It updates the project config, ensures the primary OpenCode plugin entry,
synchronizes managed skills, and applies domain-owned OpenCode contributions
such as CAD's managed MCP entry and any proven Media auxiliary provider entry.

The first release does not hot-load or unload Studio modules. After any enabled
set, root, option, plugin, MCP, or skill change, the UI must state clearly that
both OpenCode and `opencode-studio serve` must be restarted. The restarted host
mounts only the newly enabled routes and pages. This avoids dynamic router
replacement, leaked watchers, and module disposal complexity.

### 5.3 CLI configuration

The non-interactive equivalent is:

```bash
opencode-studio configure cad pcb
```

The arguments are the complete desired set, not additive changes. Re-running
the command is idempotent.

The initial CLI surface is intentionally small:

```text
opencode-studio configure <studio...> [--workspace <path>]
opencode-studio status
opencode-studio doctor
opencode-studio serve --workspace <path>
opencode-studio remove
```

Do not add aliases, migration commands, service managers, or update commands
without a demonstrated need.

### 5.4 Atomic configuration

`configureStudios()` treats the complete desired enabled set as one atomic
transition. It must preflight every affected plugin, MCP, skill, root, and config
change before publishing anything.

If an unmarked, user-modified, or conflicting managed item cannot be safely
changed, the entire transition fails. The previous enabled set and all OpenCode
integration state remain intact. Fixed internal validation commands such as
`opencode debug config` are allowed; user-controlled commands or shell strings
are not.

Writes reject unknown Studio IDs. Runtime reads of externally corrupted config
fail closed: the central plugin contributes no Studio behavior, the host exposes
only its configuration and diagnostic shell, and both report a useful error
rather than breaking OpenCode startup.

### 5.5 Activation effects

Only an enabled Studio receives:

- Agent tools
- Installed skill
- Plugin hooks and provider contributions
- Managed OpenCode contributions such as CAD's MCP entry
- Backend routes
- Viewer routes and navigation
- Doctor checks
- Root initialization or access

Disabled Studio source code may exist in the installed bundle, but it is not
initialized and is not visible to the Agent or Viewer.

## 6. Backend architecture

The shared backend owns:

- Loopback-only binding
- Host-header validation
- Same-origin and CSRF protection for configuration writes
- Content Security Policy and `X-Content-Type-Options`
- Common JSON errors
- `GET /api/health`
- `GET /api/studios`
- Configuration reads and narrowly scoped writes
- Static Viewer hosting and SPA fallback
- Logging and graceful shutdown
- Canonical workspace and root handling

Studio APIs are mounted under stable namespaces:

```text
/api/studios/cad/*
/api/studios/media/*
/api/studios/pcb/*
/api/studios/startup/*
```

A Studio API must not own host validation, global security headers, common
health routes, static serving, or the final catch-all.

### 6.1 Configuration write boundary

The web application is allowed to change Studio configuration, but this is not
permission to mutate arbitrary project or domain data. Configuration endpoints
may write only:

- `.opencode/studio.json`
- The primary managed OpenCode plugin entry
- CAD's managed MCP entry when CAD is enabled
- A Media auxiliary provider entry only if the provider spike requires it
- Managed copies of known packaged skills
- Explicit, validated root settings

They may accept paths only through declared root fields and must canonicalize
them before publication. They may not execute user-controlled commands, mutate
domain resources, or overwrite user-modified skills. Requests require loopback,
a valid same-origin `Origin`, and a per-process CSRF token.

### 6.2 Root model

There is no universal filesystem layout. Defaults are:

| Studio | Default root |
| --- | --- |
| CAD | OpenCode workspace |
| PCB | OpenCode workspace |
| Startup | OpenCode workspace |
| Media | `$XDG_DATA_HOME/opencode-studio/media` |

Explicit project configuration may override these roots. Each root is
canonicalized and passed only to its Studio context. Viewer HTTP routes remain
read-only with respect to domain data; mutations continue through permission-
aware Agent tools.

CAD, PCB, and Startup require their workspace root to exist and never create it.
Media's user-data root is created during successful configuration with user-only
ownership when missing. If `XDG_DATA_HOME` is unset, Media defaults to
`~/.local/share/opencode-studio/media`. Existing root symlinks may resolve to a
canonical target, but all later access remains confined to that target.

The first release is local and loopback-only. Do not carry Media's current
systemd, wildcard-bind, reverse-proxy, or external-network deployment into the
shared host.

## 7. Viewer architecture

The shared Viewer owns:

- React application root
- Router and top-level Query client
- Navigation and Studio selection home page
- Fonts, design tokens, reset, and responsive shell
- Loading, error, empty, disabled, and doctor states
- Keyboard navigation, visible focus, and accessibility baseline

Studio pages remain free to implement domain-appropriate interfaces, subject to
these composition rules:

- Export relative routes or page components, not another `BrowserRouter`.
- Receive `uiBase` and `apiBase` from the host.
- Scope CSS to the Studio or use CSS Modules.
- Do not style global `body`, `main`, headings, links, or `:root`.
- Namespace Query keys by Studio ID.
- Lazy-load heavy renderers.
- Do not weaken global script security for one Studio.

Canonical Viewer and API bases are:

```text
/studios/<studioId>/*
/api/studios/<studioId>/*
```

All links, assets, SSE streams, downloads, redirects, and tool-returned Viewer
URLs must derive from the injected bases.

PCB's 3D runtime must be packaged locally. Remote executable JavaScript, inline
module injection, and global `unsafe-eval` allowances are not carried into the
shared document. Remote domain resources require a narrow allowlist or backend
proxy. Media and every other Studio must scope its CSS; fonts, Tailwind reset,
focus behavior, reduced motion, and tokens are owned once by the shell.

No microfrontend framework is needed. All modules are first-party source in one
repository and are composed at build time.

## 8. What must be preserved

The consolidation may freely change file layout, package names, CLI names,
ports, configuration formats, and UI routes. It must preserve these behavioral
surfaces unless a change is explicitly approved:

- Tool names
- Tool argument schemas and important descriptions
- Tool cancellation, timeout, permission, and error semantics
- Skill names and domain instructions
- Domain filesystem and validation rules
- CAD artifact publication guarantees
- Media credential, billing, download, and no-overwrite guarantees
- PCB fabrication and assembly blockers
- Startup evidence and candidate validation rules
- Media provider and native attachment hooks

Before moving code, generate the checked-in parity fixtures defined in
Section 9.1. Those fixtures are migration parity tests, not permanent external
compatibility contracts.

## 9. Testing strategy

### 9.1 Migration parity

- Commit `test/parity/tools.json` with every tool name and complete argument
  schema, including unprefixed Media tools.
- Commit `test/parity/plugin-hooks.json` with hook/provider keys and ordering.
- Commit `test/parity/skill-digests.json` with SHA-256 skill source digests.
- Commit `test/parity/source-commits.json` with the imported source revisions.
- Make CI compare the consolidated implementation to these fixtures without
  reading the old repositories.
- Exercise Media provider and hook composition for `opencode` and `opencode-go`.
- Port every existing domain test before deleting its source repository.

### 9.2 Shared core

- Registry ID uniqueness and complete loader coverage
- Plugin hook ordering and collision detection
- Exact enabled-Studio filtering
- Configuration validation and atomic publication
- Managed skill preservation and removal
- Root confinement and symlink handling
- Loopback, Host, same-origin, and CSRF checks
- Graceful shutdown and common error behavior

### 9.3 Product integration

- Start with no configuration and expose no Studio behavior.
- Enable one Studio and expose only its tools, skill, API, and pages.
- Enable multiple Studios and verify deterministic composition.
- Disable a Studio and remove only managed integration state.
- Verify CAD MCP activation, conflict handling, and removal.
- Open deep links for every Viewer.
- Exercise keyboard, focus, mobile viewport, and a basic axe scan.
- Pack the npm tarball and test plugin, CLI, UI, skills, and Media provider from
  an empty consumer project.

The old conformance suite should be mined for useful cases, not copied as an
unchanged framework. Tests must describe the new single-product architecture.

## 10. Build, CI, and release

The root package owns all commands. Local and CI validation must use the same
scripts.

Expected release gate:

```text
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun test
uv sync --locked --project studios/cad/forge
bun run test:python
bun run test:pcb-fixture
bun run build
bun run test:package
bun run test:browser
```

Specialized locks remain where required:

- One root `bun.lock`
- CAD's `uv.lock`
- The retained PCB authoring fixture's `package-lock.json`

The release workflow publishes one `opencode-studio` package from a matching
`v*` tag using npm trusted publishing and provenance. Do not add independent
Studio versions or release automation.

The package manifest must declare Bun as a required engine and explicitly define
`bin`, `exports`, and `files`, including the Media provider subpath and packaged
CAD Forge project. CAD's uv environment must live in a writable XDG cache path,
not inside a global npm installation. Packed-package tests install the tarball
globally in an isolated environment, execute the Bun CLI, exercise both Media
provider paths, and run one minimal real CAD build.

Retain the PCB authoring fixture as `test:pcb-fixture` in the initial release
gate. Remove it only through a deliberate decision with equivalent replacement
coverage. Release CI must reject any tag other than
`v${package.json.version}`.

## 11. Implementation sequence

This sequence is for verification and fault isolation, not backwards
compatibility. Work may land as one coordinated implementation because there
are no active users.

### Step 1: Freeze the preserved surface

- Generate and commit the parity JSON fixtures defined in Section 9.1.
- Enumerate every tool name and complete argument schema.
- Hash existing skill source files and record source commit IDs.
- Identify all plugin hooks, provider contributions, and CAD MCP behavior.
- Prove whether Media requires both current provider hooks and select its final
  package exports before composing the central plugin.
- Copy existing domain tests into a migration checklist.

### Step 2: Establish the single package

- Create the root Bun/TypeScript/Vite/Biome setup.
- Add the runtime build and packed-package check. The unified Viewer build lands
  with Step 6 after existing application roots become composable routes.
- Move domain source into `studios/*` without redesigning domain behavior.
- Keep generated outputs, `node_modules`, media, workspaces, and artifacts out
  of Git.

### Step 3: Implement configuration and lifecycle

- Define the Studio catalog and validated project config.
- Implement the fail-closed config loader.
- Implement `configureStudios()` as the single CLI/API operation.
- Implement atomic managed plugin, MCP, and skill synchronization.
- Require restart of both OpenCode and the Studio host after changes.
- Add `status`, `doctor`, and `remove`.

### Step 4: Compose the OpenCode plugin

- Add target-specific plugin loaders.
- Merge tool maps with collision checks.
- Compose hooks and preserve Media provider behavior.
- Add the stable Media provider package export and its focused tests.
- Initialize only configured Studios.
- Make tool and skill parity tests pass.

### Step 5: Consolidate the backend

- Extract the common secure host.
- Convert each Studio server into a relative domain router.
- Add namespace and root-isolation tests.
- Remove per-Studio host, lifecycle, CLI, and static-serving copies.

### Step 6: Consolidate the Viewer

- Build the shared shell and Studio management home page.
- Convert each application root into relative lazy routes.
- Inject `apiBase` and `uiBase`.
- Scope Media CSS and resolve PCB CSP/remote-script behavior.
- Package the PCB 3D runtime locally and remove remote executable scripts.
- Add browser and accessibility smoke coverage.

### Step 7: Complete package and release verification

- Build and install the packed package in an empty project.
- Execute the packed CLI with Bun and run a minimal packed CAD build.
- Configure zero, one, and multiple Studios.
- Exercise CLI and web configuration paths.
- Run every domain and integration test.
- Publish the first release only after parity succeeds.

### Step 8: Retire old repositories

- Confirm the new repository has no relative or remote dependency on them.
- Confirm tool and skill parity.
- Archive or remove the old repositories and workflows.
- Deprecate old npm packages and remove their publish credentials/workflows.
- Do not import their Git histories into this repository.

### Step 9: Add the new-Studio generator

After the Studio shape is proven by all four migrations, implement:

```bash
bun run create-studio robotics
```

It should create the minimal domain files, register every loader surface, create
a skill skeleton and test, and verify the result in a temporary project. Do not
generate framework layers or speculative capabilities.

## 12. Definition of done

The consolidation is complete when:

1. `opencode-studio` is the only active repository and npm package.
2. Installing the package enables no Studio by default.
3. CLI and web configuration produce the same project state.
4. Only selected Studio tools, skills, hooks, APIs, and pages are active.
5. CAD MCP and Media provider integrations activate only with their Studios.
6. Existing tool names and approved behavior pass parity tests.
7. Existing skills retain their names and domain instructions.
8. One backend and Viewer serve all selected Studios.
9. All common lifecycle, security, token, shell, and CI code has one owner.
10. A new Studio can be generated, registered, tested, and displayed without
   copying another Studio's host or Viewer application.
11. One CI and release pipeline builds and verifies the complete product.

## 13. Guardrails for contributors

Before adding a new abstraction, package, process, config file, or compatibility
path, ask whether it makes a common change touch fewer places and removes more
maintenance surface than it adds.

Prefer:

- One direct implementation over synchronized copies
- Explicit first-party registries over dynamic discovery
- Build-time composition over runtime plugin frameworks
- Domain-local code over generic helpers without repeated use
- Tests that enforce user-visible outcomes over prose-only standards
- Project configuration that fails closed

Do not reintroduce the multi-repository architecture through internal packages,
vendored files, separate release jobs, or compatibility wrappers.
