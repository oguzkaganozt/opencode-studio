# ADR 0001: Contract, not framework

- Status: Accepted
- Date: 2026-07-23

## Context

Three domain Studios (CAD, Media, PCB) need shared lifecycle, Companion, Viewer, and security outcomes without coupling their engines, storage, or release pipelines.

## Decision

OSC is a normative contract (SPEC, schema, tokens, conformance). Studios MUST NOT depend on a shared OSC runtime, SDK, or React component package. Tokens and docs are copied or pinned for CI, not imported as a runtime library.

## Consequences

- Duplication of small host patterns is acceptable.
- Compatibility is proven by black-box conformance, not shared code.
- Proposals for a shared runtime require a new ADR and are outside OSC 1.0.
