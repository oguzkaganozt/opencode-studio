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
- **No** Settings gear or settings drawer.
- **No** TopBar leave-shell link. Optional OpenCode web access lives on Status.

## Drawer
- Full-bleed on phones; 22rem max from `sm`.
- Nav only: Home (**Agent**, Files, Status) + Studios (CAD, PCB); `.osc-nav-item` + accent rail/dot; `aria-current="page"`.
- No Navigate/Settings tabs; health, repair, and supervised restart live on Status rather than in the drawer.

## Agent chrome (side panel on CAD/PCB)
- `.oc-panel__header`: API status, session selector, new-session/stop actions, and Close.
- Native thread and composer stay mounted while the panel is hidden so API/SSE status and pending permissions remain current.
- Mobile uses the existing focus-trapped panel; desktop keeps the bounded resize handle.
- Files does not mount Agent chrome. “Use in Agent” queues selected-file context, then navigates to Agent home.

## Status (`/status`)
- Show OpenCode API version/health and supervised versus attached process state.
- Show a fixed managed inventory: primary plugin, media-go, CAD/PCB/media skills, and build123d MCP.
- Repair uses the existing guarded configure endpoint; restart is available only for the supervised child.

## Do not
- Add marketing hero imagery or extra CTAs.
- Restyle Files / CAD / PCB viewer interiors (locked).
- Nest a second Agent panel on Agent home.
