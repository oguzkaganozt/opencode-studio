# Page override — Host shell

Overrides MASTER for TopBar, SideDrawer, Home, Settings, Agent chrome.

## Intent
Calm companion chrome. Studio work (viewers) stays quiet behind the shell; chrome never competes with canvas.
Mobile is first-class for shell chrome (safe areas, ≥40px icon targets, compact chips).

## Home
- Eyebrow “Companion” + H1 “Studios” + one-line value prop (keep copy).
- 2-col card grid ≥sm; single column mobile; `.osc-home-card` + rail on hover/focus.
- Update banner: elevated card + mono upgrade command (keep).
- Loading: short skeleton cards (2), not bare “Loading…”.
- Error: `ErrorState` + Retry.
- Empty (success, zero studios): `EmptyState` → Open settings.

## TopBar / Agent actions
- `.osc-topbar-inner` / `.osc-topbar-actions`; safe-area top padding.
- Outline chips h-8, 11–12px; OpenCode collapses to “OC” &lt;480px.
- Menu button: `aria-expanded` + `aria-haspopup="dialog"` when drawer open.
- Settings gear (radial) opens drawer on Settings panel.
- Agent toggle: status dot + “Agent”; `aria-pressed` + `aria-label` with status.
- OpenCode link only when `nativeOpenCodeAvailable`.

## Drawer
- Width 19.5rem; full-bleed on narrow phones.
- Shared `.osc-segmented` for **Navigate | Settings** and theme.
- Nav: Workspace (Home, Files) + Studios groups; `.osc-nav-item` + accent rail/dot; `aria-current="page"`.
- Settings order: Appearance → Studios (on badges) → Install (paths + per-studio details) → sticky Repair footer with helper line.

## Agent chrome
- `.osc-agent-header`: status + dual-line label; Open / Close chips h-8.
- Loading overlay (pulse dot) while iframe connects; error banner retained.
- Unavailable copy kept; slightly larger type on mobile.

## Do not
- Add marketing hero imagery or extra CTAs.
- Change route structure or API wiring.
- Restyle Files / CAD / PCB viewer interiors (locked).
