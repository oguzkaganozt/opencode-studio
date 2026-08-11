---
name: studio-media
description: >
  Load before Media Studio image, audio, or video work — generate/edit/import/convert/trim
  thumbnails or clips, chatgpt_image_generate, fal_* paid generation, media_download,
  media_list/info/probe, or Media project asset paths. Not for mechanical CAD product
  renders (studio-cad + build123d_render_view into designs/<id>/renders/) or PCB artifacts
  (studio-pcb).
license: proprietary
compatibility: opencode
---

# Media Studio

Use media tools for image, audio, and video inside the **open Media project**.
Media projects are immediate directories under `$STUDIO_HOME/studio/media/`
(or configured `roots.media`). Load this skill before `media_*`, `fal_*`,
`chatgpt_image_generate`, or `read_media` work.

Do **not** use this skill for CAD evidence PNGs or PCB exports — those stay under
`studio-cad` / `studio-pcb` domain roots and their tools.

The Media project viewer is a read-only asset browser. All mutations happen
through Media agent tools, not the browser.

## Paths (important)

- Default output when a path is omitted: `<media-project>/media/`.
- Explicit project-relative paths must remain inside the open Media project.
- Media tools reject the Media domain root, sibling projects, CAD/PCB roots,
  and arbitrary OpenCode workspaces.
- `media_list` scans only the open project for image/audio/video (depth and entry caps
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

Open the Media Studio project view to browse and preview image/audio/video/text.
The global Files page remains a Studio Home browser and is not the Media project
scope. Neither browser uploads, generates, or deletes assets.

## Readiness checks

- Verify paths with `media_list` or `media_info` after imports, downloads, or
  generation. Provider tools may return success before files are fully written.
- Treat missing, empty, or wrong-path files as incomplete even when a provider
  job reports success.
- Never claim readiness from tool success alone — confirm the file exists at the
   expected project path.
