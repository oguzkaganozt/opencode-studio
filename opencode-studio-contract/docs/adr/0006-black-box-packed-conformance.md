# ADR 0006: Black-box packed conformance

- Status: Accepted
- Date: 2026-07-23

## Context

Studios use different internal layouts, test runners, and build scripts. Testing repository internals would freeze accidental structure and encourage a shared framework.

## Decision

Compatibility is proven by a pinned black-box suite invoked as `bun run test:conformance`. The suite exercises packed package behavior: manifest, plugin loading via the declared specifier, CLI lifecycle, Companion security, Viewer outcomes, and unchanged Data Root contents. The runner is a CI/dev dependency only, never a Studio runtime dependency.

## Consequences

- Reference Studio and the runner land in Phase 2.
- Studio-owned unit tests remain free to vary.
- OSC moves to `1.0` once CAD, Media, and PCB each independently pass the
  studio-agnostic `studio-core` suite (`bun run test:conformance:studios`).
