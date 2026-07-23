# opencode-cad-studio

[![CI](https://github.com/oguzkaganozt/opencode-cad-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/oguzkaganozt/opencode-cad-studio/actions/workflows/ci.yml)

Agentic CAD design harness — opencode plugin + web UI companion 3D viewer.
LLM/VLM kullanarak bir objeyi mantıksal olarak parçalara ayırır, parçaları build123d (OpenCASCADE) ile tasarlar, tek tek modeller, ve montajlanmış halde 3D görüntüler.

## Mimari

- **CAD elleri**: External `build123d-mcp` MCP server (Python/OpenCASCADE) — agent'ın interaktif CAD sculpting tool'ları (`execute`, `render_view`, `validate`, `measure`, snapshot, feature recognition, assembly QC).
- **Agent skill**: `skills/cad-studio/SKILL.md` — manufacturing-engineer workflow, ordered production pipeline, FDM design rules, and build123d selector reference. Yalnız ilgili CAD görevlerinde yüklenir.
- **Plugin**: `src/plugin.ts` — opencode plugin (`@opencode-ai/plugin` Hooks + `tool()`). `design_build`, `design_list`, `design_create`, `design_read`, `design_view` tool'larını expose eder.
- **Build motoru**: `forge/forge_cli.py` (Python, build123d + trimesh) — deterministic build: her `parts/*.py`'yi dynamic import, `build()` çağır, Shape validate, STEP/STL/GLB export + `manifest.json` (atomik temp-dir-swap, failure önceki output'u korur).
- **Companion**: `src/server.ts` (Hono, ayrı `Bun.serve` süreci) — artifact API + built UI same-origin serve.
- **Viewer**: `ui/` (React 19 + Vite + React Router + TanStack Query + Tailwind 4 + OSC tokens; Three.js canvas) — manifest-backed GLB render, deep links `/designs/:id`, click-to-prompt feedback, 2s polling.
- **Render loop**: Agent `render_view` PNG'lerini `renders/<part>-<view>.png` olarak kaydeder; companion güvenli `/api/render` endpoint'i ve viewer paneliyle gösterir.

**Filesystem tek bus.** Agent `design_build` ile yazar, companion on-demand scan eder. Websocket/DB/catalog yok. Human→agent feedback: viewer'da click → prompt clipboard → agent chat'e paste.

## Kurulum

```bash
# Published package
bun add --global opencode-cad-studio

# OpenCode entegrasyonu: plugin kaydı + managed native skill
opencode-cad-studio install

# Sağlık kontrolü
opencode-cad-studio doctor

# Dep ve UI build (geliştirme)
bun install
bun run build

# Python build motoru bağımlılıkları (uv ile)
cd forge && uv sync && cd ..
```

`install` / `remove` / `doctor` OSC lifecycle komutlarıdır. Skill sahipliği `.osc-managed.json` marker ile takip edilir; kullanıcı tarafından değiştirilmiş unmarked skill üzerine yazılmaz.

## Çalıştırma

İki terminal açın:

```bash
# Terminal 1 — companion viewer (Data Root zorunlu ve mevcut olmalı)
bun run serve
# paket kurulumu sonrası: opencode-cad-studio serve --root .

# Terminal 2 — opencode (agent)
opencode
```

Viewer: `http://127.0.0.1:4173`

## Consumer opencode.json

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "build123d": {
      "type": "local",
      "command": ["uv", "tool", "run", "--python", "3.12", "build123d-mcp@0.3.77"],
      "timeout": 120000,
      "enabled": true
    }
  },
  "plugin": [
    [
      "opencode-cad-studio",
      {
        "studioRoot": ".",
        "companionUrl": "http://127.0.0.1:4173"
      }
    ]
  ]
}
```

Plugin system prompt'u değiştirmez. `install`, paketlenmiş `cad-studio` skill'ini `${XDG_CONFIG_HOME:-~/.config}/opencode/skills/cad-studio/` altına kurar ve `opencode.json` içine plugin kaydını ekler. OpenCode skill'i yalnız ilgili CAD görevlerinde yükler. Plugin kendi paketlenmiş `forge/` motorunu kullanır. Local source geliştirmede repo kökündeki `opencode.json` kullanılabilir. Paket kimliği `opencode-studio.json` (OSC 0.x) ile tanımlanır.

## Design lifecycle

```
designs/<object>/
├── design.json
├── params.py
├── parts/*.py
├── README.md
├── step/ (generated)
├── stl/  (generated)
├── glb/  (generated)
├── renders/ (generated PNG views)
└── manifest.json (generated)
```

`design.json` schema 1:
```json
{"schema": 1, "id": "box-lid-demo", "params": "params.py", "parts": [
  {"id": "box", "source": "parts/box.py"},
  {"id": "lid", "source": "parts/lid.py"}
]}
```

## Tool envanteri (plugin)

| Tool | İş |
|---|---|
| `design_list` | `designs/` altındaki tasarımları listele |
| `design_create` | Yeni design scaffold (design.json + params.py + parts/) |
| `design_read` | design.json + manifest.json oku |
| `design_build` | Deterministic build → STEP/STL/GLB/manifest |
| `design_view` | Tasarım için companion viewer URL'si |

## Geliştirme

```bash
bun run dev:ui      # Vite dev server :5173, /api → :4173 proxy
bun run typecheck   # tsc --noEmit
bun test            # bun:test
bun run lint        # biome check
bun run build       # runtime + UI
```

Forge Python test'leri:
```bash
bun run test:python
```

Packed consumer doğrulaması:
```bash
bun run test:package
```

Skill ve plugin kaydını kaldırmak için `opencode-cad-studio remove` kullanın.

## Sorun giderme

- Viewer tasarım göstermiyorsa önce `design_build` çalıştırın ve `GET /api/designs` çıktısını kontrol edin.
- Forge build için her `build()` tam olarak bir geçerli solid döndürmelidir. Build motoru exported STEP'i yeniden açıp validity, hacim, solid sayısı ve bounds değerlerini doğrular.
- Forge hatalarını doğrudan görmek için `uv --project forge run forge build <design-dir>` çalıştırın.
- build123d-mcp başlamıyorsa `uv tool run --python 3.12 build123d-mcp@0.3.77` komutunu doğrulayın.
- Companion portu doluysa `serve --port 4180` kullanın ve `companionUrl` değerini aynı porta ayarlayın.
- Plugin, config veya skill değişikliğinden sonra OpenCode'u; companion değişikliğinden sonra companion sürecini yeniden başlatın.
- `forge/` bağımlılıkları değiştiğinde `uv sync --project forge` çalıştırın.

Kalan işler: [`docs/ROADMAP.md`](docs/ROADMAP.md).
