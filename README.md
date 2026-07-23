# OpenCode Studio

OpenCode Studio is one configurable OpenCode package for focused CAD, media,
PCB, and startup workflows. It provides one plugin, CLI, local backend, and web
application while keeping each domain behind an explicit Studio module.

This is a greenfield internal project for a small team. There are no legacy
users or compatibility requirements. Existing Studio repositories are source
material only; their Git histories, package boundaries, CLIs, and release
pipelines will not be carried forward.

The compatibility surface that must be preserved during consolidation is:

- Existing agent tool names, argument schemas, and core behavior
- Existing skill names, instructions, and domain rules
- Media provider and OpenCode hook behavior
- Domain safety, validation, cancellation, and output guarantees

Installing the package does not activate every Studio. A project explicitly
selects its enabled Studios from the web application or CLI. Disabled Studios
must not expose tools, skills, hooks, API routes, or Viewer pages to OpenCode.

## Target experience

```bash
npm install --global opencode-studio
opencode-studio serve --workspace .
```

The home page then lets the user enable the Studios needed by the current
project. The equivalent non-interactive command is:

```bash
opencode-studio configure cad pcb
```

Configuration is project-local in `.opencode/studio.json`. Missing or invalid
configuration fails closed: no Studio is enabled automatically.

## Architecture at a glance

```text
opencode-studio/
|-- src/                 shared CLI, plugin, server, config, and core
|-- studios/             cad, media, pcb, and startup modules
|-- ui/                  shared Viewer shell and navigation
|-- scripts/             build, package checks, and Studio scaffolding
|-- test/                cross-cutting and browser tests
|-- docs/                durable architecture and onboarding documentation
`-- .github/workflows/   one CI and one release pipeline
```

There is one Git repository, one `package.json`, one lockfile, one npm package,
one version, and one release pipeline. Studio modules are source directories,
not separately versioned workspace packages.

## Start here

Read [PLAN.md](PLAN.md) before implementing or moving code. It records the
accepted product model, architecture boundaries, migration plan, validation
requirements, and definition of done.
