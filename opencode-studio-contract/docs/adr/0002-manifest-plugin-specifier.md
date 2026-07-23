# ADR 0002: Manifest plugin specifier

- Status: Accepted
- Date: 2026-07-23

## Context

CAD registers its plugin from the package root export. Media and PCB register from a `./server` subpath. Forcing one export shape would break existing consumers.

## Decision

`opencode-studio.json` declares a `plugin` string that is the package export specifier consumers register with OpenCode. Package name, binaries, files, and normal exports remain in `package.json`. Absolute `dist/plugin.js` paths are development-only.

## Consequences

- Manifest stays OSC-specific and small.
- Conformance loads the packed package through the declared specifier.
- Studios may keep current export maps while adding the manifest.
