# OpenCode Studio Contract

OpenCode Studio Contract (OSC) defines the shared language, package shape,
lifecycle, companion host, viewer profile, security baseline, and conformance
requirements for focused OpenCode Studio plugins.

Initial implementations:

- `opencode-cad-studio`
- `opencode-media-studio`
- `opencode-pcb-studio`

OSC is a contract, not a framework or SDK. Studios remain independent and do
not take a shared runtime dependency.

## Documents

| Document | Role |
| --- | --- |
| [SPEC.md](SPEC.md) | **Normative** OSC `1.0` specification |
| [schemas/opencode-studio.schema.json](schemas/opencode-studio.schema.json) | Machine-readable manifest schema |
| [viewer/tokens.css](viewer/tokens.css) | Canonical Viewer CSS tokens (copy into Studios) |
| [docs/behavior-matrix.md](docs/behavior-matrix.md) | Phase 0 cross-Studio behavior matrix |
| [docs/adr/](docs/adr/) | Load-bearing architecture decisions |
| [PLAN.md](PLAN.md) | Design history and delivery phases |
| [reference-studio/](reference-studio/) | Minimal conforming example (not a runtime dependency) |
| [conformance/](conformance/) | Black-box compatibility suite |

On conflict, `SPEC.md` wins.

## Conformance

```bash
bun run build:reference   # once, or when reference-studio changes
bun run test:conformance
```

The suite packs Reference Studio and checks manifest, lifecycle CLI, Companion
host/security, Viewer stack/tokens, and plugin loading via the declared
specifier.

To prove a Studio package independently conforms to the same OSC-common
behavior, run the studio-agnostic suite against its package root:

```bash
bun run test:conformance --studio ../opencode-cad-studio
bun run test:conformance:studios   # runs cad, media, and pcb siblings
```

## Repository layout

```text
opencode-studio-contract/
|-- README.md
|-- PLAN.md
|-- SPEC.md
|-- schemas/
|   `-- opencode-studio.schema.json
|-- viewer/
|   `-- tokens.css
|-- docs/
|   |-- behavior-matrix.md
|   `-- adr/
|-- reference-studio/
`-- conformance/
```

## Status

**OSC 1.0.** Phases 0–4 are complete: behavior matrix, SPEC, Reference Studio,
pinned conformance, CAD/Media/PCB migrations, and independent studio-core
passes via `bun run test:conformance:all`.
