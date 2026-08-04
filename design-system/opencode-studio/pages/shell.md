# Page override — Host shell

Overrides MASTER for TopBar, SideDrawer, OpenCode home, Agent chrome.

## Intent
Calm companion chrome. Studio work (viewers) stays quiet behind the shell; chrome never competes with canvas.
Mobile is first-class for shell chrome (safe areas, ≥40px icon targets, compact chips).
Studio is the chrome; OpenCode is a first-class surface (not a leave-studio escape hatch).

## OpenCode home (`/`)
- Full-bleed same-origin iframe of parent OpenCode (`src="/"` via host reverse proxy).
- TopBar label “OpenCode”; **no** Agent side panel (avoids nested OpenCode iframes).
- Loading: skeleton chrome; error: `ErrorState` + Retry; unavailable: short recovery copy.
- Title on iframe: `OpenCode` (distinct from Agent panel title `OpenCode agent`).

## TopBar / Agent actions
- `.osc-topbar-inner` / `.osc-topbar-actions`; safe-area top padding.
- Outline chips h-8, 11–12px.
- Menu button: `aria-expanded` + `aria-haspopup="dialog"` when drawer open.
- Theme control: compact `.osc-segmented.osc-theme-toggle` (System | Light | Dark) in the top-right actions.
- Agent toggle (CAD/PCB only): status dot + “Agent”; `aria-pressed` + `aria-label` with status.
- **No** Settings gear or settings drawer.
- **No** TopBar “OpenCode” / leave-shell link — use drawer → OpenCode.

## Drawer
- Full-bleed on phones; 22rem max from `sm`.
- Nav only: Home (**OpenCode**, Files) + Studios (CAD, PCB); `.osc-nav-item` + accent rail/dot; `aria-current="page"`.
- No Navigate/Settings tabs; no health/repair UI in the drawer (CLI: `opencode-studio repair`).
- OpenCode iframe error: banner + Retry (reload frame).

## Agent chrome (side panel on CAD/PCB)
- `.osc-agent-header`: status + dual-line label; Close chip only (no pop-out Open).
- Loading overlay (pulse dot) while iframe connects; error banner retained.
- Unavailable copy kept; slightly larger type on mobile.
- Files does not mount Agent chrome; it remains a focused read-only explorer.

## Do not
- Add marketing hero imagery or extra CTAs.
- Restyle Files / CAD / PCB viewer interiors (locked).
- Nest Agent panel on the OpenCode home route.
