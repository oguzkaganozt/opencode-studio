---
name: media
description: Use for image, audio, and video workspace operations, fal_* tools, chatgpt_image_*, and media_* tools. Guides agent-owned media mutations and honest path checks.
---

# Media (platform)

Use media tools for image, audio, and video under the **workspace**
(`serve --workspace` / OpenCode project directory). Media is always on — not a
toggleable studio. The Files explorer (`/studio/files`) is a read-only browser
for the whole workspace (preview + download). All media mutations happen through
agent tools, not the browser.

## Paths (important)

- Default output when a path is omitted: `media/` under the workspace.
- Explicit workspace-relative paths are allowed **anywhere inside the workspace**.
- Tools can overwrite CAD/PCB sources, configs, and other project files if you
  pass those paths. Prefer `media/` for generated assets. Never write secrets
  into the tree casually.
- `media_list` scans the workspace for image/audio/video (depth and entry caps
  apply; very large trees may need a filename filter).

## Workflow

1. Call `media_list` (and `media_info` / `read_media` when you need detail)
   before claiming what media already exists.
2. Inspect candidates with `read_media`, `media_probe`, or `media_info`.
3. Add or transform assets with tools:
   - `media_import` for server-local files into the workspace
   - `chatgpt_image_generate` for subscription-backed PNG generation
   - `fal_models` → `fal_model_schema` → `fal_pricing` → optional `fal_upload`
     → `fal_submit` → `fal_status` → `fal_result` → `media_download` for paid
     fal.ai generation
   - `media_convert`, `media_trim`, and other `media_*` local operations
4. Re-list or re-read paths to confirm files landed before reporting success.

## Billing

- ChatGPT image uses the user's OpenCode ChatGPT OAuth (subscription).
- fal tools are **paid** when `FAL_KEY` is present. Always call `fal_pricing`
  before `fal_submit`. Do not start bulk jobs without explicit user intent.

## Files explorer

Open the host UI Files page to browse the workspace tree and preview
image/audio/video/text. It does not upload, generate, or delete. On non-loopback
hosts (`serve --web`), Files API requires the same HTTP Basic password as OpenCode.

## Readiness checks

- Verify paths with `media_list` or `media_info` after imports, downloads, or
  generation. Provider tools may return success before files are fully written.
- Treat missing, empty, or wrong-path files as incomplete even when a provider
  job reports success.
- Never claim readiness from tool success alone — confirm the file exists at the
  expected workspace path.
