# Repository Guide

## Product Model

- OpenCode Media Studio is an agent-first tool for image, audio, and video understanding, generation, and explicit non-destructive media operations.
- The filesystem is the only source of truth for media assets. Do not add a persistent asset catalog, job database, sidecar metadata system, lineage store, or edit event log.
- The companion is an always-on, filesystem-backed read-only media viewer. It is not a generation console, job monitor, digital asset manager, media editor, or browser file manager.
- v1 owns two generation paths: synchronous ChatGPT subscription image generation and asynchronous, directly billable fal.ai image/audio/video generation. Their authentication, billing, and lifecycle semantics remain separate; do not introduce a generic generation facade.
- Provider-specific tools keep names such as `chatgpt_image_generate` and `fal_submit`; provider-neutral filesystem operations use `media_*` names.
- Keep stable product and engineering rules here and user instructions in `README.md`. Git history is the record of completed work; do not retain a task checklist or speculative ideas without a concrete requirement.

## Domain Language

| Term | Meaning |
| --- | --- |
| **Workspace root** | The canonical OpenCode startup directory containing a user's code and project-local files. It is separate from the shared Library root. |
| **Library root** | The configured canonical VPS directory containing every managed media file, normally `/srv/opencode-media-studio`. |
| **Managed asset** | A regular detected image, audio, or video file beneath the Library root. Its filesystem presence and path are its complete identity. |
| **Personal space** | `users/<unix-user>/` beneath the Library root. New agent outputs and imports go here by default. |
| **Shared space** | `shared/` beneath the Library root. Personal assets may be moved here for team use. |
| **Modality** | Exactly one of `image`, `audio`, or `video`, represented by `images/`, `audio/`, and `video/` directories. |
| **Native attachment** | Original media bytes sent to a model without transcription, frame extraction, or transcoding. |
| **Provider endpoint** | A provider-specific callable route with its own input/output schema. |
| **Generation job** | One provider execution. Studio does not persist jobs; the provider and OpenCode session retain their normal lifecycle information. |
| **Pricing snapshot** | The billing unit and unit price fetched before paid submission; it is returned to the agent and is not persisted by Studio. |
| **Import** | Copy a server-local media file into the current Unix user's personal modality directory. |
| **Provider upload** | Stage a Library asset in provider storage and receive a remote URL. |
| **Download** | Materialize provider media in the current Unix user's personal modality directory. |
| **Derived asset** | A new file produced by a non-destructive local operation. Studio does not persist parent/child lineage. |

## Library Layout

```text
/srv/opencode-media-studio/
├── users/
│   ├── alice/
│   │   ├── images/
│   │   │   └── project1/          ← optional subfolders (max depth 3)
│   │   ├── audio/
│   │   └── video/
│   └── bob/
│       ├── images/
│       ├── audio/
│       └── video/
└── shared/
    ├── images/
    ├── audio/
    └── video/
```

- Derive the personal namespace from the process UID's Unix account, not from mutable environment variables or Git configuration.
- User directories are organizational, not authorization boundaries. Every teammate admitted by the external access layer may view and manage every managed asset.
- The Library root lives on the VPS's local filesystem and is shared through one Unix group. It is not an object-store mount or network database.
- Modality-internal subfolders (up to `LIBRARY_MAX_FOLDER_DEPTH = 3` levels) are supported for organization. `scanLibrary` recurses into them; `scanFolderContents` lists one level non-recursively; `createManagedFolder` creates them with setgid permissions and path-traversal guards.
- Do not classify files as generated, imported, downloaded, or derived in the directory hierarchy. Place every file according to scope and detected output modality.
- Files copied into or removed from the Library by normal filesystem tools must appear or disappear from the companion without registration or reconciliation.
- Agent tools may accept and return validated absolute Library paths. Browser APIs expose only Library-relative paths and opaque media URLs, never arbitrary server paths.

## Compatibility Language

Do not say a format is simply "supported." Name the relevant layer:

| Term | Question answered |
| --- | --- |
| **Detected format** | Can Studio identify and validate the file type? |
| **Previewable format** | Can the companion browser render it natively? |
| **Native-input compatible** | Can the selected model and provider transport accept it as a native attachment? |
| **Endpoint-compatible** | Does the selected generation endpoint accept it? |

Passing one layer never implies passing another.

## Entrypoints

- `src/plugin.ts` is the OpenCode plugin: its default export registers native media, generation, transfer, inspection, and local-operation tools.
- `src/provider.ts` is a separate AI SDK provider adapter. Package export `.` points here; export `./server` points to the plugin. Preserve this split when changing package exports.
- `src/cli.ts` owns OSC lifecycle (`install`/`remove`/`doctor`/`serve --root`) and optional `service-install`/`service-update`. `src/deployment.ts` owns immutable system/user companion releases, atomic updates, rollback, and systemd integration. `src/server.ts` contains the read-only Companion API. `opencode-studio.json` declares the OSC manifest; `skills/media-studio/` is the packaged skill.
- Local plugin configs must set `providerPackage` to an absolute `file:///.../src/provider.ts`; the default `${name}@${version}` is for an installed package.

## Native Media

- `read_media` sends original audio/video bytes as native model input; it does not transcode, sample frames, or transcribe. The default limit is 20 MiB.
- Image understanding remains OpenCode's built-in `read` behavior; do not duplicate it. Agent-facing Library listings must provide a validated path that built-in `read` can use.
- Native media is intentionally enabled only for compatible OpenCode Zen (`opencode`) and OpenCode Go (`opencode-go`) models using the OpenAI-compatible or Anthropic adapters. Do not broaden this globally without provider-level integration tests.
- Validate the selected model and transport before loading full media bytes. Native attachment never transforms content silently; recommend an explicit `media_convert` operation when needed.
- `promoteToolMedia()` converts the latest tool attachment into a synthetic user media part. Compaction strips native attachments instead of replaying their base64 payloads.
- Preserve canonical-path checks, `O_NOFOLLOW`, file signatures, permissions, abort propagation, and size limits when changing media reads.
- `read_media` accepts only validated managed assets. Import project-local or external media into the Library before native reading.
- Do not load the archived `opencode-native-media` plugin alongside this package; both register and patch `read_media`.

## fal.ai Flow

- Keep paid inference asynchronous: `fal_models -> fal_model_schema -> fal_pricing -> optional fal_upload -> fal_submit -> fal_status -> fal_result -> media_download`. Do not replace submit/status with one long blocking tool.
- `FAL_KEY` is inherited from the current process. Never accept it in prompts, tool arguments, browser input, or persisted files. The team VPS uses one shared key across user processes.
- Model IDs and schemas are discovered from fal Platform APIs; avoid hardcoding a model catalogue that will drift.
- Respect normal OpenCode permission configuration for `fal_submit`. Do not rewrite broad or per-agent permissions to force approval; trusted agents may be configured for unattended paid submission.
- Do not implement a partial local JSON Schema engine. Return current endpoint schemas to the agent and let fal perform authoritative request validation.
- fal submit, status, result, and cancellation tools remain stateless. Do not persist request IDs, provider payloads, logs, pricing, or job status in Studio.
- Downloads remain HTTPS-only, host-allowlisted, redirect-denied, byte-limited, no-overwrite, and confined to the Library root. Add provider CDN hosts explicitly rather than weakening these checks.
- Never run `fal_submit` in tests or manual verification without explicit billing approval. Model search is safe to exercise without a key.

## ChatGPT Images

- `chatgpt_image_generate` is implemented directly in this package and uses OpenCode's ChatGPT OAuth plus the hosted Codex image-generation flow. Do not add a runtime dependency on another image-generation plugin.
- Prefer this subscription path for ordinary image generation when ChatGPT OAuth is available; fal.ai remains available for alternate image models, endpoint capabilities, audio, and video.
- Keep OAuth tokens out of tool arguments, logs, filenames, and browser code.
- Reference images and generated PNGs retain permission checks, Library-root confinement for outputs, byte limits, content validation, abort propagation, and no-overwrite writes.
- Generated images go to the current Unix user's personal `images/` directory.
- Live subscription generation consumes account quota. Keep it opt-in for end-to-end tests; normal tests mock OAuth and Codex responses.

## Filesystem Operations

- `media_import` copies detected server-local media into the current user's personal modality directory. It does not register metadata.
- `media_list` scans the filesystem recursively (including modality-internal subfolders) and may filter by user, scope, modality, and case-insensitive filename substring. It must not depend on persistent indexing.
- `media_info` reports current filesystem and detected-format information. `media_probe` returns current FFprobe output without persisting it.
- FFmpeg and FFprobe are optional system binaries. Invoke them with direct argument arrays through `Bun.spawn`; never use a shell or accept raw provider arguments.
- Convert, trim, and extraction operations are explicit, synchronous, non-destructive, no-overwrite, abortable, and remove partial outputs after failure.
- Place local-operation output by its detected modality in the current user's personal space. Do not create or persist lineage.
- Validate output content after the process exits.
- Unit tests use fake executable binaries; normal verification must not require FFmpeg to be installed.

## Companion Server

- The companion is independent of OpenCode and OSC-aligned: `serve --root` requires an existing Data Root and MUST NOT create or mutate it. Agent tools may still call `initializeLibrary` when writing.
- OSC `install`/`remove`/`doctor` register the plugin specifier and managed skill with `.osc-managed.json`. Optional always-on deployment stays under `service-install` / `service-update` and MUST NOT redefine core install/remove.
- System companion releases live under `/opt/opencode-media-studio`; user releases under `~/.local/share/opencode-media-studio/app`. Prefer the shared `current` symlink on VPS.
- `service-update` stages npm into a versioned release, validates manifests and runtime/UI files without executing downloaded code as the installer, then atomically switches `current`. It restarts and health-checks only a managed companion.
- Companion security baseline: Host allowlist, `X-Content-Type-Options: nosniff`, CSP, and `GET /api/studio`. `/api/version` remains for deployment versioning.
- Keep API and UI same-origin. Protect VPS deployments with Cloudflare Access. Do not add application-managed users, sessions, TLS, or passwords.
- Scan the Library filesystem directly with bounded pagination; no SQLite, sidecar metadata, search index, or persistent cache.
- The Viewer is read-only: filters, folder navigation, preview, and original download. No browser upload, rename, delete, move, copy, or folder creation.
- Library mutations belong to agent tools (`media_import`, downloads, generation outputs, convert/trim). Never overwrite an existing file from tools.
- Keep compact video cards static; load original video only on detail/open. Manual refresh only — no watchers or thumbnails.
- Keep the interface utility-first: filters and assets appear in the first viewport. Use OSC tokens (`ui/src/tokens.css`) and `data-studio="media"`.

## Scope Boundaries

Do not add these without a concrete requirement:

- a persistent catalog, SQLite database, job monitor, provider log, pricing history, provenance graph, lineage store, sidecar metadata, or stable asset UUID;
- automatic transcoding, compression, transcription, frame extraction, cloud synchronization, or backup management;
- synchronous long-running cloud generation calls or a generic provider facade;
- companion generation, trim, conversion, resize, extraction, arbitrary project-file operations, or folders outside the modality-internal organization model;
- a full digital asset manager, tags, advanced search index, edit history, trash/restore workflow, undo, timeline editing, cached thumbnails/posters/waveforms, or a custom media player;
- direct browser access to provider credentials, ChatGPT OAuth, OpenCode sessions, or unrestricted absolute filesystem paths;
- another image-generation plugin or OpenAI API-key billing for ChatGPT image generation;
- application-managed users, authorization roles, authentication, or TLS.

## Release

- Push a `v*` tag matching `package.json` version to trigger `.github/workflows/publish.yml` automatically: it runs `release:check`, publishes to npm via OIDC Trusted Publishing (no long-lived `NPM_TOKEN`), and creates a GitHub Release with generated notes.
- `workflow_dispatch` with an existing tag is a manual fallback; the normal path is tag push.
- Bump `package.json` version, commit, tag, and push both (`main` + tag) — the workflow only triggers on tag push, not on `main` push.
- npm Trusted Publishing is configured for repo `oguzkaganozt/opencode-media-studio`, workflow `publish.yml`, environment `npm`, with `publish` permission.

## Verification

- Install exact locked dependencies with `bun install`.
- Run normal validation with `bun run check`; run packed-package validation with `bun run test:package` or the complete release gate with `bun run release:check`.
- Run one file with `bun test test/provider.test.ts`; filter one test with `bun test -t "test name"`.
- Tests use temporary Library roots and never write to `/srv` or developer application-data directories.
- Media files are gitignored and no real fixture is committed. Unit fixtures validate format and transport boundaries without requiring FFmpeg.
- Live end-to-end verification is opt-in. Before release, verify standalone audio understanding, native video understanding, ChatGPT image generation, and explicitly approved fal image/audio/video generation.
- Any OpenCode plugin/config change is loaded on process startup, so restart the affected OpenCode process. Companion changes require restarting only the independent companion service.
