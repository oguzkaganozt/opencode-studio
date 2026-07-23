# ADR 0003: Skill ownership markers

- Status: Accepted
- Date: 2026-07-23

## Context

CAD can overwrite an installed skill without detecting user edits. Media has no skill. Safe `install`/`remove` across package versions needs ownership without building an install-history database.

## Decision

Installed skills include `.osc-managed.json` recording Studio id, package version, and managed content digest. Unmarked skills are conflicts. Replacement is allowed only when the digest still matches. User-modified skills are preserved and reported. `remove` deletes only an unchanged managed skill and marker.

## Consequences

- Lifecycle remains idempotent and non-destructive to user edits.
- Studios must compute a stable digest over managed skill content.
- Sibling user files and non-empty directories are preserved.
