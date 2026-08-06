---
name: studio-media
description: >
  Load before workspace image, audio, or video work — generate/edit/import/convert/trim
  thumbnails or clips, chatgpt_image_generate, fal_* paid generation, media_download,
  media_list/info/probe, or Files explorer media paths. Not for mechanical CAD product
  renders (studio-cad + build123d_render_view into designs/<id>/renders/) or PCB artifacts
  (studio-pcb).
license: proprietary
compatibility: opencode
---

# Media (platform)

Use media tools for image, audio, and video under the **workspace**
(`serve --workspace` / OpenCode project directory). Media is always on — not a
toggleable studio. Load this skill before `media_*`, `fal_*`, or
`chatgpt_image_*` product work.

Do **not** use this skill for CAD evidence PNGs or PCB exports — those stay under
`studio-cad` / `studio-pcb` domain roots and their tools.

The Files explorer (`/studio/files`) is a read-only browser for the whole
workspace (preview + download). All media mutations happen through agent tools,
not the browser.

## Paths (important)

- Default output when a path is omitted: `media/` under the workspace.
- Explicit workspace-relative paths are allowed **anywhere inside the workspace**.
- Tools can overwrite CAD/PCB sources, configs, and other project files if you
  pass those paths. Prefer `media/` for generated assets. Never write secrets
  into the tree casually.
- `media_list` scans the workspace for image/audio/video (depth and entry caps
  apply; very large trees may need a filename filter).

## Tool map

| Need | Tools (order) |
| --- | --- |
| See what exists | `media_list` → `media_info` / `media_probe` / `read_media` |
| Copy server-local file in | `media_import` |
| Ordinary still image | `chatgpt_image_generate` first (subscription OAuth) |
| Paid fal model | `fal_models` → `fal_model_schema` → `fal_pricing` → optional `fal_upload` → `fal_submit` → poll `fal_status` → `fal_result` → `media_download` |
| Abort fal job | `fal_cancel` (on user abort or wrong submit) |
| Transform local AV | `media_convert`, `media_trim`, `media_extract_audio` |
| Confirm on disk | `media_list` or `media_info` at the expected path |

Prefer ChatGPT image for simple PNGs before paid fal. Do not start bulk fal jobs
without explicit user intent. After `fal_submit`, poll `fal_status` until done or
failed; download only from a completed result URL.

## Workflow

1. Call `media_list` (and `media_info` / `read_media` when you need detail)
   before claiming what media already exists.
2. Inspect candidates with `read_media`, `media_probe`, or `media_info`.
3. Add or transform assets using the tool map above.
4. Re-list or re-read paths to confirm files landed before reporting success.

## Billing

- ChatGPT image uses the user's OpenCode ChatGPT OAuth (subscription).
- fal tools are **paid** when `FAL_KEY` is present. Always call `fal_pricing`
  before `fal_submit`. Do not start bulk jobs without explicit user intent.

## Files explorer

Open the host UI Files page at `/studio/files` (default host
`http://127.0.0.1:4173` unless `OPENCODE_STUDIO_PORT` overrides) to browse the
workspace tree and preview image/audio/video/text. It does not upload, generate,
or delete. On non-loopback hosts (`serve --web`), Files API requires the same
HTTP Basic password as OpenCode.

## Readiness checks

- Verify paths with `media_list` or `media_info` after imports, downloads, or
  generation. Provider tools may return success before files are fully written.
- Treat missing, empty, or wrong-path files as incomplete even when a provider
  job reports success.
- Never claim readiness from tool success alone — confirm the file exists at the
  expected workspace path.
