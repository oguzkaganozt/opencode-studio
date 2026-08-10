# Page override — Host shell

Overrides MASTER for TopBar, SideDrawer, Agent home, Agent chrome, and Status.

## Intent
Calm companion chrome. Studio work (viewers) stays quiet behind the shell; chrome never competes with canvas.
Mobile is first-class for shell chrome (safe areas, ≥40px icon targets, compact chips).
Studio is the chrome; OpenCode remains the runtime behind the native Agent surface.

## Agent home (`/`)
- Full-bleed native `AgentPanel`; no iframe and no nested side panel.
- TopBar label “Agent”. Sessions, messages, permissions, model/reasoning-effort selection, and abort use the same-origin OpenCode API/SSE proxy; prompts always use the `build` agent.
- Loading: skeleton chrome and thread status; error/unavailable: `ErrorState` or inline recovery with Retry.
- API and SSE state determine health. Never infer health from rendered DOM.

## TopBar / Agent actions
- `.osc-topbar-inner` / `.osc-topbar-actions`; safe-area top padding.
- Outline chips h-8, 11–12px.
- Menu button: `aria-expanded` + `aria-haspopup="dialog"` when drawer open.
- Theme control: compact `.osc-segmented.osc-theme-toggle` (System | Light | Dark) in the top-right actions.
- Agent toggle (CAD/PCB only): status dot + “Agent”; `aria-pressed` + `aria-label` with status.
- **No** Settings gear, Status control, or settings drawer on TopBar.
- **No** TopBar leave-shell link.

## Drawer
- Full-bleed on phones; 22rem max from `sm`.
- Nav: Home (**Agent**, Files) + Studios (CAD, PCB); `.osc-nav-item` + accent rail/dot; `aria-current="page"`.
- **Status** is a footer control (bottom-right), not a nav row — opens the Status dialog.
- No Navigate/Settings tabs; health, repair, and supervised restart live in the Status dialog.

## Agent chrome (side panel on CAD/PCB)
- `.oc-panel__header`: API status, session selector, new-session/stop actions, and Close.
- Native thread and composer stay mounted while the panel is hidden so API/SSE status and pending permissions remain current.
- Mobile uses the existing focus-trapped panel; desktop keeps the bounded resize handle.
- Files does not mount Agent chrome. “Use in Agent” queues selected-file context, then navigates to Agent home.

## Status (modal, not a route)
- Open only from drawer footer **Status** (dialog, not a full page / not TopBar).
- Compact summary only: Agent API health + install check count; list failed checks when any.
- Actions: Repair, Restart agent (supervised only), Refresh.
- Legacy `/status` opens the dialog and redirects home.

## Do not
- Add marketing hero imagery or extra CTAs.
- Restyle Files / CAD / PCB viewer interiors (locked).
- Nest a second Agent panel on Agent home.
