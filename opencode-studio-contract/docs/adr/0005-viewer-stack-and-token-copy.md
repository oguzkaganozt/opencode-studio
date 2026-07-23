# ADR 0005: Viewer stack and token copy

- Status: Accepted
- Date: 2026-07-23

## Context

Media and PCB already use React 19, Vite, React Router, TanStack Query, and Tailwind CSS 4. CAD uses vanilla JS and Three.js. Design language diverges (no shared tokens; fonts inconsistent).

## Decision

OSC requires the Media/PCB majority stack plus copyable CSS custom properties from `viewer/tokens.css` (graphite shell, semantic states, domain accents, Barlow / IBM Plex Mono variables). Studios copy tokens locally. OSC does not publish a shared UI component package.

## Consequences

- CAD migrates its Viewer to the aligned stack while keeping read-only inspection.
- Conformance can check for token presence and stack dependencies in packed artifacts.
- Visual refinement of token values remains allowed on `0.x`.
