---
name: media-studio
description: Use for image, audio, and video Library operations, fal_* tools, chatgpt_image_*, and media_* tools. Guides agent-owned Library mutations and honest readiness checks.
---

# Media Studio

Use Media Studio for managed image, audio, and video assets in the shared
Library filesystem. The Companion is a read-only Viewer for browsing and
previewing assets; it does not upload, import, generate, or delete Library
content. All Library mutations happen through agent tools (`media_import`,
`media_download`, `chatgpt_image_generate`, `fal_submit` → `fal_result` →
`media_download`, `media_convert`, and related `media_*` tools), not through
the browser.

## Workflow

1. Call `media_list` (and `media_info` / `read_media` when you need detail)
   before claiming what is already in the Library.
2. Inspect candidates with `read_media`, `media_probe`, or `media_info` as
   needed. Use the Companion only to preview assets after you know their
   managed paths.
3. Add or transform assets with tools:
   - `media_import` for server-local files into the current user's personal
     Library space
   - `chatgpt_image_generate` for subscription-backed PNG generation
   - `fal_models` → `fal_model_schema` → `fal_pricing` → optional `fal_upload`
     → `fal_submit` → `fal_status` → `fal_result` → `media_download` for paid
     fal.ai generation
   - `media_convert`, `media_trim`, and other `media_*` local operations
4. Re-list or re-read managed paths to confirm files landed in the expected
   modality directories before reporting success.

## Companion

Start the read-only Viewer with `opencode-studio serve --workspace <path>`
pointing at an existing Library root. The Companion serves health, browse, and
preview endpoints; it must not be treated as an upload or generation surface.

## Readiness Checks

- Verify managed Library paths with `media_list` or `media_info` after imports,
  downloads, or generation. Provider tools may return success before files are
  fully written or before `media_download` completes.
- Confirm scope (personal vs shared), modality directory, filename, and byte
  size where relevant.
- Treat missing, empty, or mis-placed files as incomplete even when a provider
  job reports success.
- Never claim Library readiness from tool success alone. Confirm the asset exists
  at the expected managed path before telling the user it is available.
