# Page override — Host shell

Overrides MASTER for TopBar, SideDrawer, Home, Settings, Agent chrome.

## Intent
Calm companion chrome. Studio work (viewers) stays quiet behind the shell; chrome never competes with canvas.

## Home
- Eyebrow “Companion” + H1 “Studios” + one-line value prop (keep copy).
- 2-col card grid ≥sm; single column mobile.
- Update banner: elevated card + mono upgrade command (keep).
- Loading: short skeleton cards (2), not bare “Loading…”.
- Error: alert role + message (keep).

## TopBar / Agent actions
- Outline chips h-8–9, 11–12px label, gap-2.
- Agent toggle: status dot + “Agent”; `aria-pressed`.
- OpenCode external-ish link only when `nativeOpenCodeAvailable`.

## Drawer Settings
- Segmented Studios | Settings.
- Theme: System / Light / Dark segmented (keep behavior).
- Repair install full-width primary sticky; success/warn status blocks.

## Do not
- Add marketing hero imagery or extra CTAs.
- Change route structure or API wiring.
