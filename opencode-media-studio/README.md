# opencode-media-studio

An OpenCode media plugin for native audio/video understanding, ChatGPT subscription image generation, and asynchronous fal.ai media generation.

The plugin sends original audio/video bytes to supported OpenCode models, generates PNG images directly through OpenCode's ChatGPT OAuth, and provides fal.ai discovery, pricing, queue lifecycle, result retrieval, and secure downloads. It does not transcribe, extract frames, or silently convert media.

## Requirements

- Bun 1.3.0 or newer
- OpenCode 1.18.2 or newer
- OpenCode Zen or OpenCode Go for `read_media`
- A selected model that accepts the media format
- OpenCode ChatGPT OAuth for `chatgpt_image_generate`
- `FAL_KEY` in the current OpenCode process environment for paid fal.ai generation
- Optional `ffmpeg` and `ffprobe` on `PATH` for local media operations
- A writable shared Library root; the default is `/srv/opencode-media-studio`

## Install

This package follows the OpenCode Studio Contract (OSC). Core CLI commands
register the OpenCode plugin and managed skill; optional always-on companion
deployment uses separate `service-*` commands.

```bash
npm install --global opencode-media-studio
# OpenCode plugin + skill (OSC)
opencode-media-studio install --scope user
opencode-media-studio doctor
```

Optional always-on systemd companion (immutable releases under
`~/.local/share/opencode-media-studio/app` or `/opt/...`):

```bash
opencode-media-studio service-install
# or without systemd:
opencode-media-studio service-install --no-service
mkdir -p ~/.local/share/opencode-media-studio/library
opencode-media-studio serve \
  --root ~/.local/share/opencode-media-studio/library \
  --host 127.0.0.1
```

`serve --root` requires an existing Library directory and does not create or
mutate it. The companion is a read-only viewer; Library writes happen through
agent tools.

Normal OpenCode CLI/TUI processes can load the npm package plugin specifier
`opencode-media-studio/server` (preferred after OSC install) or an absolute path
to a managed `current` release. Example with managed paths (replace `alice`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "/home/alice/.local/share/opencode-media-studio/app/current/node_modules/opencode-media-studio/dist/plugin.js",
      {
        "providerPackage": "file:///home/alice/.local/share/opencode-media-studio/app/current/node_modules/opencode-media-studio/dist/provider.js",
        "libraryRoot": "/home/alice/.local/share/opencode-media-studio/library"
      }
    ]
  ]
}
```

Update a managed companion release with:

```bash
opencode-media-studio service-update
```

The update is staged and validated before an atomic `current` switch. A managed
companion is restarted and rolled back if restart fails. Re-run OSC `install` to
refresh the managed skill after package upgrades.

During local development, load this directory and point the provider adapter at its source file:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "/absolute/path/to/opencode-media-studio/src/plugin.ts",
      {
        "providerPackage": "file:///absolute/path/to/opencode-media-studio/src/provider.ts"
      }
    ]
  ]
}
```

Remove `opencode-native-media` from the same configuration. This package already contains its `read_media` tool and provider adapters, so loading both would register competing implementations.

Restart OpenCode after changing plugin configuration.

The package root exports the native-media AI SDK provider adapter,
`opencode-media-studio/server` exports the installed OpenCode plugin, and
`opencode-media-studio/api` exports the companion Hono application factory.
Runtime JavaScript is built under `dist` with external runtime dependencies and
without source maps; published packages do not execute TypeScript source files.

## Configure fal.ai

Export the API key before starting OpenCode:

```bash
export FAL_KEY="your-key"
opencode
```

Do not put the key in prompts or tool arguments.

## Tools

| Tool | Purpose |
| --- | --- |
| `read_media` | Attach a local audio or video file natively to the selected model |
| `chatgpt_image_generate` | Generate a PNG directly through the user's ChatGPT subscription |
| `media_import` | Copy server-local media into the current user's personal Library space |
| `media_list` | Scan managed assets in the shared Library filesystem |
| `media_info` | Inspect current filesystem and detected-format information for one managed asset |
| `media_probe` | Inspect streams and container metadata through FFprobe |
| `media_convert` | Create a converted asset with typed FFmpeg presets |
| `media_trim` | Create an accurately trimmed audio/video asset |
| `media_extract_audio` | Extract a new MP3 or WAV asset |
| `fal_upload` | Upload local media to temporary fal storage |
| `fal_models` | Search current active fal.ai endpoints |
| `fal_model_schema` | Retrieve a model's current OpenAPI input/output schema |
| `fal_pricing` | Retrieve the current billing unit and unit price |
| `fal_submit` | Submit an asynchronous paid generation job |
| `fal_status` | Poll queue status and logs |
| `fal_result` | Retrieve a completed job's model-specific result |
| `fal_cancel` | Request cancellation |
| `media_download` | Download provider media into the current user's personal Library space |

Recommended agentic flow:

```text
fal_models
-> fal_model_schema
-> fal_pricing
-> optional fal_upload
-> fal_submit
-> fal_status
-> fal_result
-> media_download
-> read_media
```

The queue tools deliberately keep submission and status separate so a long generation does not block an OpenCode tool call.
Every `fal_submit` execution re-fetches the endpoint's current OpenAPI schema,
then fetches current pricing before submitting. Studio passes model-specific
input directly to the fal queue so fal performs authoritative validation against
the current endpoint contract. Normal OpenCode tool permissions control
`fal_submit`; Studio does not rewrite global or per-agent rules and does not add
an approval prompt inside tool execution.

`media_download` creates a unique file in the current user's matching modality
directory when `outputPath` is omitted. It accepts only the provider URL and an
optional output path; Studio does not accept or persist provenance, provider job
identity, billing identity, or job-output links.

## ChatGPT subscription images

`chatgpt_image_generate` is implemented directly in this package. It uses the ChatGPT OAuth credentials already managed by OpenCode and the hosted Codex image-generation flow; no external image-generation plugin or OpenAI API key is required. The complete provider stream must contain exactly one successful image result. Outputs are validated PNG files confined to the current user's Library images directory and never overwrite existing files. This subscription-backed path depends on a private hosted ChatGPT service that may drift without notice. ChatGPT plan limits, account quotas, and OpenAI policies still apply.

Managed asset identity comes only from its current filesystem path. Files copied
into or removed from the Library by normal filesystem tools appear or disappear
from `media_list` without registration or reconciliation. Agent-facing asset
responses contain validated absolute Library paths and no source, lineage, or
persisted probe metadata.

ChatGPT and fal generation tools do not persist jobs, provider payloads,
pricing, results, request IDs, or credentials. Generation state remains with the
provider and the active OpenCode session; generated and downloaded media files
are the only local outputs.

Local operations use system `ffmpeg`/`ffprobe` binaries without a shell or wrapper library. Validated managed input file descriptors are passed directly to child processes, and output parents and collisions are re-checked immediately before spawn. Operations never overwrite source files, accept raw FFmpeg arguments, or persist lineage and probe data.

## Companion UI

Start the local or VPN-accessible Library companion against an **existing**
Library root (`--root` is required; `--directory` is a deprecated alias):

```bash
opencode-media-studio serve --root /srv/opencode-media-studio --host 127.0.0.1 --port 4173
```

Startup does not create or mutate the Data Root. Agent tools may still
initialize personal modality directories when writing. The packaged CLI serves
the bundled UI directly; a separate OpenCode server process is not required.

When running directly from a source checkout, build the UI first with
`bun run build:ui`. Published packages include this build automatically.

Open the printed URL to browse the responsive filesystem Library and inspect a
single image, audio, or video asset. The UI is a read-only OSC Viewer: filters,
folder navigation, preview, and original download. It has no generation
console, job monitor, provider metadata, lineage view, editor, arbitrary path
access, or browser file-management mutations. Import, generate, rename, move,
and delete through agent tools, then refresh the viewer. The UI and API are
served from the same origin with Host allowlisting, `nosniff`, and CSP.

The initial page contains at most 24 assets. Image cards lazy-load their
originals; video and audio cards are static until the asset detail page opens.

The server API exposes:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Server health |
| `GET /api/studio` | OSC identity (`id`, `packageVersion`, `contractVersion`) |
| `GET /api/version` | Running, installed, and npm-latest versions plus the applicable `service-update` command |
| `GET /api/assets` | Filtered, paginated Library list; accepts `scope`, `user`, `modality`, case-insensitive `filename`, optional modality-relative `folder`, `limit`, and `offset` |
| `GET /api/assets/:ref` | Current detail for one opaque Library reference |
| `GET /api/media/:ref` | Root-confined, no-follow original media stream with either the full file or exactly one HTTP byte range |
| `GET /api/media/:ref/download` | Full original download with an attachment disposition |

Asset responses contain only an opaque reference derived from the Library-relative
path, that relative path, scope/user/modality, detected current MIME type, byte
size, modification time, and same-origin media/download URLs. They never expose
absolute paths, catalog IDs, sources, provider data, jobs, metadata, or lineage.
The server re-resolves the path as a regular managed file and detects its content
from the opened current bytes for every detail, stream, and download request.
References remain opaque and the server never accepts browser-supplied
filesystem paths.

Browser uploads stream into a no-follow staging file after the manually entered
user field, reject bodies and file bytes over 256 MiB, detect the actual media
type rather than trusting MIME type or filename extension, and publish with an
exclusive no-overwrite link. The multipart parser retains only headers and a
small boundary window in memory while writing file chunks to disk. Unsupported,
aborted, and failed uploads remove their own staging file. Rename, delete, move,
and copy re-check current canonical confinement, regular-file identity, fixed
destination parent, and collisions immediately before their filesystem change.
Moves and renames use no-overwrite link-and-unlink publication; copies are
independent files rather than hardlinks to the shared source.

The companion intentionally has no application authentication or TLS. It binds
to `127.0.0.1:4173` by default. Binding to another interface requires an
authenticated access layer such as Cloudflare Access and a private or
firewalled origin. It does not read `FAL_KEY`, call fal.ai, retain a catalog,
open a database, run an SSE stream, or poll provider jobs. Browser user fields
select fixed Library directories only; they do not map Cloudflare identities to
Unix accounts or grant per-user authorization.

## Native media

Studio detects `.mp4`, `.m4v`, `.mov`, `.webm`, `.wav`, `.mp3`, `.aac`,
`.aif`, `.aiff`, `.flac`, `.ogg`, `.oga`, and `.m4a`. Detection does not imply
native-input compatibility. `read_media` accepts a route only when it matches
this finite matrix:

| Provider IDs | Required model declaration | Underlying adapter | Modality | Detected formats | Request shape |
| --- | --- | --- | --- | --- | --- |
| `opencode`, `opencode-go` | `audio: true` | `@ai-sdk/openai-compatible` | Audio | WAV, MP3 | `input_audio` with `wav` or `mp3` format |
| `opencode`, `opencode-go` | `video: true` | `@ai-sdk/openai-compatible` | Video | MP4/M4V, WebM, QuickTime/MOV | Package adapter emits `video_url` |
| `opencode`, `opencode-go` | `video: true` | `@ai-sdk/anthropic` | Video | MP4/M4V, WebM, QuickTime/MOV | Package adapter emits Anthropic `video` block |

The selected model ID is retained for diagnostics, but compatibility is driven
by its declared input capability, provider ID, underlying adapter, modality, and
detected format. Unsupported combinations are rejected before file permission or
complete-file loading. A `media_convert` recommendation is returned only when an
available preset can produce a format supported by the same route.

Pinned contract tests run against `@ai-sdk/openai-compatible@2.0.41`,
`@ai-sdk/anthropic@3.0.82`, and the model hook contract from the minimum OpenCode
release, 1.18.2. The OpenAI-compatible adapter accepts standalone audio only as
WAV or MP3. Official Anthropic Messages rejects standalone audio file parts.
A video's audio track does not establish standalone-audio support.

Google media routes remain owned by OpenCode's existing Google adapter. This
package neither replaces that adapter nor broadens `read_media` to Google routes;
only the matrix-approved OpenCode Zen/Go OpenAI-compatible and Anthropic video
gateways are patched to this package's provider adapter.

`read_media`, `media_info`, `media_probe`, local operations, and `fal_upload`
accept only regular managed assets at validated absolute or Library-relative
paths. Symlinks and paths outside the fixed Library layout are rejected before
file bytes are loaded. Reference-image and import sources remain workspace-relative
or absolute server paths under normal OpenCode external-directory permissions.

## Shared Library

The Library root is independent of the OpenCode workspace and defaults to
`/srv/opencode-media-studio`. The plugin derives the personal namespace from the
process UID's Unix account and enforces this layout:

```text
/srv/opencode-media-studio/
├── users/<unix-user>/{images,audio,video}/
└── shared/{images,audio,video}/
```

Directories created by the plugin are group-writable and setgid (`2770`), and
plugin-created files are mode `0660`. Configure the root to a pre-created path
owned by the team's shared Unix group. `libraryRoot` must be absolute. A temporary
absolute root can be used for tests and isolated development.

Imports, ChatGPT images, provider downloads, conversions, trims, and extracted
audio are written directly to the current user's matching modality directory.
Optional output paths may be a filename or an absolute/Library-relative path,
but must name a file directly in that directory. Existing files are never
overwritten.

`media_list` scans the filesystem deterministically with bounded work. It accepts
`user`, `scope` (`personal` or `shared`), `modality`, case-insensitive `filename`,
`limit`, and `offset` filters. `media_info` detects the current file content each
time it is called.

The minimal plugin configuration surface controls the Library root plus native,
upload, and download limits. Defaults are `/srv/opencode-media-studio`, 20 MiB,
256 MiB, and 256 MiB respectively:

```json
{
  "plugin": [
    [
      "opencode-media-studio/server",
      {
        "maxNativeBytes": 31457280,
        "maxUploadBytes": 268435456,
        "maxDownloadBytes": 268435456,
        "libraryRoot": "/srv/opencode-media-studio"
      }
    ]
  ]
}
```

`downloadHosts`,
`providerPackage`, `ffmpegPath`, and `ffprobePath` remain advanced integration
overrides.

Generated downloads are restricted to the canonical Library root, HTTPS, configured hostnames, and the configured byte limit. The default host allowlist accepts `fal.media` and its subdomains.

## Verified native models

These results were inherited from direct MP4-with-audio tests performed by `opencode-native-media` on July 18, 2026. They are a snapshot, not a hardcoded allowlist.

The snapshot does not expand the matrix above. In particular, “video and audio”
may describe audio tracks inside a video container rather than standalone audio
input.

| Model | Verified behavior |
| --- | --- |
| MiMo 2.5 | Video and audio |
| Gemini 3 Flash / 3.5 Flash / 3.1 Pro | Video and audio |
| MiniMax M3 | Video only on OpenCode Go |
| Kimi K2.7 Code / Kimi K3 | Video only |

## VPS deployment

This package is shipped as one npm artifact that every teammate installs the
same way. The team VPS runs one shared Library root, one always-on companion
service, and one independent `opencode serve` process per teammate. The plugin
filesystem, the Companion UI, and the agent tools all read and write the same
Library root through the rules below.

### Shared media Unix group and setgid Library directories

Create one team-wide Unix group that owns the Library root and every teammate's
OpenCode process plus the dedicated companion service account:

```bash
sudo groupadd --system opencode-media
sudo usermod -aG opencode-media alice
sudo usermod -aG opencode-media bob
sudo useradd --system --shell /usr/sbin/nologin --no-create-home \
  --ingroup opencode-media opencode-companion
sudo mkdir -p /srv/opencode-media-studio
sudo chown root:opencode-media /srv/opencode-media-studio
sudo chmod 2770 /srv/opencode-media-studio
```

`sudo install -d -m 2770 -o root -g opencode-media /srv/opencode-media-studio`
is equivalent. Studio creates every missing parent directory (`users/<name>/`,
`shared/`, and the three modality subdirectories) as `02770` and every managed
file as `0660`. New files inherit the shared group through the setgid bit, so
every teammate and the companion service can read and write the same Library
without filesystem permission errors and without giving either side world
access. Teammates remain organisational namespaces, not authorisation
boundaries: every admitted teammate has the same management capabilities over
every managed asset.

### Dedicated companion service account

Run the always-on companion under `opencode-companion`, the dedicated service
account, never under a teammate's user account or `root`. Bootstrap the CLI from
a system Bun installation, then install one root-owned immutable release tree
under `/opt/opencode-media-studio`. The generated unit executes
`/opt/opencode-media-studio/current`, not the bootstrap npm path:

```bash
sudo npm install --global opencode-media-studio
sudo opencode-media-studio service-install \
  --directory /srv/opencode-media-studio \
  --host 127.0.0.1 \
  --port 4173 \
  --user opencode-companion \
  --group opencode-media
```

Use `--dry-run` to preview the generated unit without writing anything:

```bash
opencode-media-studio service-install --dry-run
```

The companion binds to `127.0.0.1:4173` so only an authenticated reverse proxy
on the same host can reach it. OpenCode CLI, TUI, and `opencode serve` processes
remain independent of the companion. No OpenCode process is required for the
companion UI and filesystem API.

### Per-user OpenCode plugin configuration

Every teammate loads the same root-owned `current` release; do not install a
separate package copy per user:

```jsonc
// ~/.config/opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "/opt/opencode-media-studio/current/node_modules/opencode-media-studio/dist/plugin.js",
      {
        "providerPackage": "file:///opt/opencode-media-studio/current/node_modules/opencode-media-studio/dist/provider.js",
        "libraryRoot": "/srv/opencode-media-studio"
      }
    ]
  ]
}
```

The plugin picks up `FAL_KEY` from the
calling teammate's process environment. The team shares one billing identity
through one `FAL_KEY` value that the team maintainer places in a shared
environment file outside source control, for example
`/etc/opencode-media-studio/fal.env`:

```bash
sudo install -d -m 0750 -o root -g opencode-media /etc/opencode-media-studio
sudo tee /etc/opencode-media-studio/fal.env >/dev/null <<'EOF'
FAL_KEY=replace-with-the-team-fal-key
EOF
sudo chmod 0640 /etc/opencode-media-studio/fal.env
sudo chown root:opencode-media /etc/opencode-media-studio/fal.env
```

Each teammate's shell sources that file before starting OpenCode:

```bash
set -a; . /etc/opencode-media-studio/fal.env; set +a
opencode
```

The key is never placed inside the Library root, never written to plugin
arguments, never logged, and never sent to the browser. OpenCode OAuth tokens
stay inside OpenCode's own credential store; the companion never sees them.

### Always-on companion service, Cloudflare Access, and firewall

The companion has no application-managed users, sessions, TLS, or passwords.
Expose it to the team only through Cloudflare Access (or an equivalent
authenticated reverse proxy) and keep the origin port private. The companion's
own startup warning states the same constraint:

> Warning: this server has no application authentication; expose it only
> through your trusted VPN or reverse proxy.

Bind the companion to `127.0.0.1` and front it with Cloudflare Tunnel so the
public hostname requires an authenticated Cloudflare Access session before
Cloudflare forwards traffic to the local origin. Reject any direct connection
to the host with the host firewall. The companion's `Origin` header check
rejects every cross-origin browser mutation, but that check is a defence in
depth, not the primary access control.

Example `nftables` rules that accept loopback, allow established traffic, and
drop direct public connections to the origin port:

```nft
table inet opencode-media-studio {
  chain input {
    type filter hook input priority 0; policy drop;

    ct state established,related accept
    iif lo accept

    # SSH from the operator's bastion only
    tcp dport 22 ip saddr 203.0.113.10 accept

    # Cloudflare edge IPs only reach the tunnel daemon, never the origin port.
    # Replace 4173 with the local origin port; do not expose it to the public.
    tcp dport 4173 drop

    # ICMP for diagnostics, log everything else.
    ip protocol icmp accept
    log prefix "opencode-media-studio-drop: " drop
  }
}
```

Reload the rules and verify the origin port is not reachable from the public
Internet before opening it to the team:

```bash
sudo nft -f /etc/nftables.conf
sudo ss -ltnp | grep ':4173'   # should show 127.0.0.1:4173 only
```

The companion scans the Library filesystem on every page load and refresh; it
never persists a catalog, sessions, SQLite, thumbnails, or job history. Cloudflare
identities are not mapped to Unix accounts in the browser; teammates manually
select their personal space, and every admitted teammate sees the same Library
contents with the same management capabilities.

### Restart boundaries

Studio splits work across independent processes so a restart in one tier does
not interrupt the others:

| Change | Restart |
| --- | --- |
| OpenCode plugin or per-user plugin config | Only the affected teammate's `opencode serve` process. Companion and other teammates keep running. |
| Companion UI or API code | Only the systemd-managed companion service. Per-user OpenCode processes keep running and their `media_*` tools remain live. |
| Shared `FAL_KEY` rotation | Each teammate's `opencode serve` process, after re-sourcing `/etc/opencode-media-studio/fal.env`. The companion never reads `FAL_KEY`. |

The companion only reads Library paths on the local filesystem; restarting it
never aborts an in-flight OpenCode tool call in another teammate's process.
The companion never imports files on the teammate's behalf; uploads happen
through the browser against the same authenticated origin, and downloads stay
inside the teammate's `opencode serve` process.

## v1.0.0 release verification

The filesystem-only release candidate was verified live on July 20, 2026, in
addition to the mocked and packed-package test suites:

| Path | Model or endpoint | Adapter | Format and modality | Result |
| --- | --- | --- | --- | --- |
| Native input | `opencode-go/mimo-v2.5` | `@ai-sdk/openai-compatible@2.0.41` through this package's provider adapter | WAV audio | `read_media` attached the original 12,392-byte file and the model described its clock and bell sounds |
| Native input | `opencode-go/mimo-v2.5` | `@ai-sdk/openai-compatible@2.0.41` through this package's provider adapter | MP4 video | `read_media` attached the original 1,815-byte file and the model correctly identified its black frames |
| ChatGPT subscription | Hosted Codex image generation through OpenCode ChatGPT OAuth | Direct package integration, not an AI SDK provider adapter | PNG image | Low-quality generation produced a validated 1,254x1,254 PNG in personal Library space with mode `0660` |
| fal.ai paid image queue | `fal-ai/flux-1/schnell` | fal.ai queue client | JPEG image, 256x256 | Schema and pricing lookup, submit, status, result, secure download, detection, and personal-space placement completed |
| fal.ai paid audio queue | `fal-ai/qwen-3-tts/text-to-speech/1.7b` | fal.ai queue client | MP3 audio, 24 kHz, 2.06 seconds | Schema and pricing lookup, submit, status, result, secure download, detection, and native understanding completed |
| fal.ai paid video queue | `bytedance/seedance-2.0/mini/text-to-video` | fal.ai queue client | MP4 video, 480p, 4 seconds, no generated audio | Schema and pricing lookup, submit, status, result, secure download, detection, and native understanding completed |
| Companion | Packaged filesystem API and browser UI | Hono and React | PNG image operations | Upload, rename, move to shared, copy to selected personal space, filename search, preview, one-range streaming, byte-identical original download, and confirmed permanent delete completed |

The live fal pricing snapshots were USD 0.003 per megapixel for FLUX Schnell,
USD 0.09 per 1,000 characters for Qwen TTS, and USD 0.007 per 1,000 tokens for
Seedance Mini. The image used 0.065536 megapixels and the TTS input used 22
characters. These snapshots document the approval decision and are not
final-charge receipts. Provider request IDs and temporary output URLs are not
persisted.

## Release publishing

Tag-triggered npm releases use GitHub-hosted Actions and npm Trusted Publishing
with OIDC. The publish job has `id-token: write`, uses the protected `npm`
environment, and does not require a long-lived npm publish token. npm generates
provenance automatically for public releases. A brand-new npm package must be
created once with interactive 2FA before its Trusted Publisher relationship can
be configured; subsequent releases use only the `publish.yml` workflow.

## Development

```bash
bun install
bun run check         # typecheck, unit tests, lint, build
bun run test:package  # pack and smoke-test the packed companion and UI
bun run release:check # check + packed-package smoke
```

`bun run test:package` packs the workspace into a temporary tarball, installs
it in an isolated consumer project, and starts the bundled companion against a
temporary `--directory` (never `/srv`). It confirms the bundled UI serves, the
`/api/health` and `/api/assets` endpoints respond, no jobs/events/catalog
endpoints exist, mutation routes enforce same-origin, and the packed `dist`
contains no SQLite, catalog, or development paths. The smoke test does not
require Cloudflare, a real `FAL_KEY`, system `ffmpeg`, or any write under
`/srv`.
