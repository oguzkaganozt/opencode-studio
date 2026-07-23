# ADR 0004: Companion Data Root is read-only

- Status: Accepted
- Date: 2026-07-23

## Context

Media's Companion creates library layout and exposes upload/rename/delete APIs. PCB's Companion watches sources and rebuilds outputs. CAD's Companion is already read-only inspection. OSC needs one host model for security and Viewer boundaries.

## Decision

The Companion treats the Data Root as read-only. `serve --root` requires an existing directory and must not create or mutate it. HTTP mutations and build/generation triggers are out of core Companion behavior. Agent tools (and optional separate Studio service surfaces) own mutation. Observation-only polling/SSE is allowed.

## Consequences

- Media must move browser file management out of the Viewer/Companion core path.
- PCB must relocate companion-owned rebuild orchestration off the OSC Companion surface.
- CAD remains closest to the target host model.
