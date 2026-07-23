---
name: reference-studio
description: Use for OSC reference notes inspection and the reference_* tools. Demonstrates OpenCode Studio Contract behavior without CAD, Media, or PCB policy.
license: MIT
compatibility: opencode
---

# Reference Studio

This skill belongs to the OSC Reference Studio. It is a minimal, copyable
example of a conforming Studio.

## Tools

- `reference_list` — list `*.note.json` resources under the Data Root
- `reference_read` — read one note by id
- `reference_write` — create or replace a note (requests edit permission)

## Companion

Serve the read-only Viewer with:

```text
opencode-reference-studio serve --root /absolute/data/root
```

The Companion never mutates the Data Root. Note files use the shape:

```json
{ "id": "hello", "title": "Hello", "body": "World" }
```
