# Design System Master — OpenCode Studio

> **LOGIC:** Check `pages/<area>.md` first; overrides win. Else follow this file.
> **Scope:** Host shell + Files + CAD + PCB **LOCKED**. See `LOCK.md`.

---

**Project:** OpenCode Studio  
**Surface:** App/SaaS tool (companion Viewer)  
**Dials:** Variance 3 · Motion 2 · Density 5 (mid)  
**Style spine:** Swiss Modernism 2.0 — rational hierarchy, high contrast, minimal decoration, single accent per studio context  
**Goal:** Polish existing structure; keep behavior/routes/copy unless noted

---

## Product identity (keep)

| Token / choice | Value |
| --- | --- |
| UI font | Barlow (`--osc-font-ui`) |
| Mono | IBM Plex Mono (`--osc-font-mono`) |
| Canvas | Dark `#0c0d10` / light `#f4f4f5` (`--osc-canvas-bg*`) |
| Studio accents | CAD `#b45309` · PCB `#0e7490` · Files `#e11d48` |
| Theme | Light + dark first-class (`html[data-theme]`) |
| Hairline | Warm OpenCode gradient under chrome (2px, no blur soup) |
| Radius | sm 4 · md 8 · lg 12 (`--osc-radius-*`) |
| Motion | `--osc-motion-duration: 180ms`; `0ms` under `prefers-reduced-motion` |

Canonical CSS: `ui/tokens.css`. Import only via `@import "@ui/tokens.css"`. No hex in components — use `--osc-*`.

---

## Color roles (shell)

Map to existing tokens — do not invent parallel palettes.

| Role | Token | Notes |
| --- | --- | --- |
| Page bg | `--osc-bg` | Zinc near-white / near-black |
| Elevated chrome | `--osc-bg-elevated` | TopBar, drawer, cards |
| Subtle well | `--osc-bg-subtle` | Code/pre, inset areas |
| Surface / hover | `--osc-surface`, `--osc-surface-hover` | Selected nav, chip active |
| Border | `--osc-border`, `--osc-border-strong` | Prefer hairlines; strong on hover |
| Text | `--osc-text` → muted → faint | Body ≥13px; labels 11–12 muted |
| Primary action | `--osc-primary` / `--osc-primary-fg` | High contrast ink, not green CTA |
| Status | success / warning / error / stale / invalid + `*-bg` | Badges, alerts |
| Focus | `--osc-focus-ring` | Always visible; never `outline-none` alone |
| Overlay | `--osc-overlay` | Drawer/dialog scrim; blur ≤2px if any |
| Studio accent | `--osc-accent` via `[data-studio]` | Dot + active rail only — not full chrome wash |

**Refinements for this polish:** slightly clearer elevated vs page separation in dark; borders that read on both themes; drop decorative backdrop-blur on chrome where solid elevated is enough.

---

## Typography

| Use | Size / weight | Color |
| --- | --- | --- |
| Section label | 10–11px, medium, uppercase, wide tracking | `--osc-text-faint` |
| Nav / chrome title | 13–15px, medium–semibold | `--osc-text` |
| Body / helper | 12–15px, regular, leading relaxed | `--osc-text-muted` |
| Chrome control | 11–12px, medium | muted → text on hover |
| Mono meta | 10–11px IBM Plex | faint (paths, version) |
| Badge | 10px mono uppercase | tone colors |

No oversized “fashion” display type. No Inter swap.

---

## Spacing & density (mid)

Base unit 4px. Chrome height **48px** (`h-12`) for TopBar and drawer header; agent chrome header matches.  
OpenCode home is full-bleed under TopBar (no content max-width). Viewer pages fill remaining height.  
Touch targets: interactive chrome ≥36px (prefer 36–40); icon-only ≥36×36.

---

## Motion (low)

- Duration: 150–200ms color/opacity/border; drawer transform uses `--osc-motion-duration` + ease `cubic-bezier(0.22, 1, 0.36, 1)`.
- Allowed: fade/opacity, short translate on drawer, subtle card border/shadow on hover.
- Forbidden: bounce, parallax, glow pulse, large lift (>2px), layout-animating width/height, decorative scroll choreography.
- `osc-reveal`: optional one-shot fade-up ≤12px y; respect reduced-motion (already).
- Active press: opacity or 1px translate — not scale jumps.

---

## Components (host)

### Button (`ui/components/button.tsx`)
- Variants: default (primary ink), outline, ghost, danger.
- Shape: **rounded-lg** (tool), not full pill — avoids consumer/playful.
- Sizes: sm h-8 / md h-9; full-width sticky footers OK.
- Focus: `focus-visible:ring` via tokens; disabled opacity ~40 + not-allowed.

### Badge
- Mono uppercase, compact; tones ok/warn/fail/neutral.
- No backdrop-blur (solid surface).

### Empty / Error states
- Dashed border well; title + optional description + action.
- Errors: `role="alert"`; recovery action when possible.

### Dialog
- Elevated panel, strong border, shadow token; focus trap retained.
- Overlay solid/low-blur; no heavy glass.

### TopBar
- Solid `--osc-bg-elevated` (no heavy frosted glass).
- Left: menu ≥36px + brand or surface label + accent dot (studios/files).
- Right: Agent toggle on Files/CAD/PCB only — outline chip. No leave-shell OpenCode link.
- `edge=flush` when content is full-bleed under chrome.

### SideDrawer
- 19.5rem max; focus trap + Escape; nav + settings panels.
- Nav: OpenCode + Files + domain studios.
- Active item: surface fill + 2px accent rail.
- Settings: repair CTA sticky bottom; theme segmented control; mono meta footer; update banner when available.

### Agent chrome
- Header aligns with TopBar rhythm (h-12, same border language).
- Status dot + label; Close chip only.
- Resize handle: visible on hover/focus only.
- Not shown on OpenCode home route (full-pane OpenCode instead).

### OpenCode home pane
- Same-origin iframe of parent UI; loading pulse + broken-frame detection shared with Agent.

---

## Anti-patterns

- Playful/consumer chrome, bubbly pills, marketing motion  
- Dense IDE clutter (too many borders, nested toolbars)  
- Heavy glass/neon/glow/blur soup  
- Raw hex in TSX; cross-studio CSS imports  
- Emoji as icons (inline SVG or lucide if already used)  
- Silent loading / empty main with no message  
- Removing focus rings  

---

## Implementation map

| Priority | Slice | Files |
| --- | --- | --- |
| 0 Foundation | tokens + global styles | `ui/tokens.css`, `ui/styles.css` |
| 1 Primitives | button, badge, empty, error, dialog | `ui/components/*` |
| 2 Shell | TopBar, drawer, home, agent actions, agent header | `ui/app.tsx`, `ui/native-agent-frame.tsx` |
| 3 Pass | a11y + motion + visual QA | skills below |

Out of scope: `studios/*/viewer/**`, `ui/files-explorer.tsx` interior (frame chrome only if shared).

---

## Pre-delivery checklist

- [ ] Tokens only; light + dark contrast OK  
- [ ] Focus visible; skip link works  
- [ ] Reduced motion respected  
- [ ] Loading / error / empty on touched flows  
- [ ] No glass/neon regression  
- [ ] Behavior and routes unchanged  
- [ ] `bun run check` (or typecheck + lint + ui tests) green  
