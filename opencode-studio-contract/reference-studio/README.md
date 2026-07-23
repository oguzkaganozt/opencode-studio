# OpenCode Reference Studio

Minimal, private OSC example. Copy it to start a new Studio. Do not import it
as a runtime dependency from CAD, Media, or PCB Studios.

## Commands

```text
opencode-reference-studio install [--scope user|project] [--dry-run] [--json]
opencode-reference-studio remove  [--scope user|project] [--dry-run] [--json]
opencode-reference-studio doctor  [--scope user|project] [--json]
opencode-reference-studio serve --root /absolute/data/root
```

## Domain

Notes are plain `*.note.json` files in the Data Root. The Companion is
read-only; only agent tools write notes.
