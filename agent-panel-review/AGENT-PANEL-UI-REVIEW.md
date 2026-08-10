# Agent Panel UI/UX Review

**Scope:** Full page, top bar, chat + composer (light theme).  
**Method:** Screenshot-only audit against general UI/UX guidelines.  
**Date:** 2026-08-10  
**Mode:** Audit only — no fixes applied.

---

## Overall

Calm, readable chat surface. Clear turn structure, restrained chrome, good breathing room. Main gaps: weak primary action, dense/ambiguous header, low message-role contrast, and sparse feedback affordances.

---

## Top bar

### Works

- Single horizontal band; status → session → context reads left-to-right.
- Green status dot is an immediate “ready” signal.
- Session title is the focal label; chevron implies switcher.
- Theme control is compact and scannable (System / Light / Dark).

### Issues

| Sev | Finding |
| --- | --- |
| Med | **Header overcrowded on the right.** Theme segment + gear compete with session identity. Session title loses primacy once the row fills. |
| Med | **Gear icon is ambiguous.** Looks like Settings; no visible label. If it means Status/health, iconography fights expectation. |
| Med | **“+” hit target is tiny** next to the title. Easy to miss; poor touch/precision target. |
| Low | **Context line (“Home”)** is quiet and useful, but competes with session title for vertical space in a short header — two lines of identity for one task. |
| Low | **No clear “Agent” product label** in the bar; identity is only the session name. Fine for power users, weaker for orientation. |
| Low | Menu (☰) is standard; OK if it opens nav. |

---

## Chat / messages

### Works

- User right / assistant left is familiar and fast to parse.
- Assistant cards: white surface, soft radius, comfortable line length and leading.
- Inline code chip (`docker-compose.yml`) is clear and non-noisy.
- Short threads sit near the composer (not stranded mid-page) — good empty-space handling.
- Vertical rhythm between turns is even.

### Issues

| Sev | Finding |
| --- | --- |
| High | **User vs assistant contrast is weak.** User bubbles are mid-gray on light gray canvas; they feel secondary/disabled, not “my messages.” Role scanning relies mostly on alignment. |
| Med | **Short user pings** (`asdasfasf`) become tiny pills while assistant spans full width — visual imbalance and uneven column edge. |
| Med | **No per-message actions** (copy, retry, edit). Long assistant answers become hard to reuse; recovery after a bad turn is unclear. |
| Med | **No timestamps / turn markers.** In longer threads, “when was this?” and grouping get hard. |
| Low | **Assistant full-bleed cards** vs user max-width bubbles: hierarchy favors the model (good for reading) but can feel like two different products glued together. |
| Low | **No streaming / typing state** in this capture — can’t judge busy feedback from screenshots alone. |

---

## Composer (dock)

### Works

- Carded dock, clear separation from thread.
- Placeholder “Ask anything…” is friendly and correct.
- Model + Effort as secondary controls under the field is a solid pattern (ChatGPT/Claude-like).
- Usage strip (`TPS · tokens · $`) is useful for a coding agent; mono/tabular feel fits.

### Issues

| Sev | Finding |
| --- | --- |
| High | **Send control is a small gray circle with ↑.** Low affordance as the primary action: easy to read as disabled or decorative. Primary CTA should read as “submit” at a glance (filled/high-contrast, larger target). |
| Med | **Meta row above the input** (usage + `~`) adds a second mini-toolbar inside the card. Useful data, but it steals attention from typing and can look like another message bar. |
| Med | **`~` path label is cryptic** without hover/context. Folder icon helps little if the label is only a tilde. |
| Med | **Disabled-looking send** when empty is correct behavior, but the *enabled* state must jump clearly; current gray circle doesn’t. |
| Low | Model / Effort look like plain text + chevron — good de-emphasis, but may under-communicate that they’re interactive until hover. |
| Low | No visible attach / @ / stop-in-composer in this state — fine if elsewhere; empty dock feels slightly bare for a tool-heavy agent. |

---

## Hierarchy & layout

| Area | Assessment |
| --- | --- |
| Page bg | Soft neutral; content floats cleanly. |
| Column width | Comfortable reading width; not full-bleed chaos. |
| Focus order (visual) | Thread → composer is correct; header is a separate concern. |
| Density | Mid-low — calm, not IDE-cluttered. Good. |
| Hairline under header | Subtle separation; works. |

---

## Accessibility / operability (from pixels only)

- Status dot alone is color-only unless there’s a text alternative (not visible in UI).
- Icon-only controls (menu, +, gear, send) need discoverable names — gear especially.
- Theme segment labels are readable; good.
- Contrast of user bubble text on gray fill looks OK; bubble-on-canvas contrast is the weaker pair.
- Touch targets on +, send, and likely gear look **&lt; 40px** — weak for touch/mobile.

---

## Prioritized recommendations

1. **Strengthen user bubble identity** — higher contrast fill/border so “me” vs “agent” is instant without relying on side.
2. **Make Send the obvious primary** — larger target, high-contrast filled button; gray only when truly disabled.
3. **Simplify or clarify header trailing** — gear label/purpose; reduce competition with session title (theme can stay, but secondary).
4. **Enlarge + / icon hits** to comfortable click/tap size.
5. **Soften composer meta** — quieter usage/path, or collapse path to tooltip so typing stays primary.
6. **Replace bare `~`** with a short human label (e.g. Home / project name).
7. **Add light message utilities** at least on hover/focus for assistant turns (copy minimum).
8. **Optional:** subtle turn grouping or time for long sessions.

---

## What’s already strong

- Restrained, professional chat aesthetic (not toy/marketing).
- Clear conversational layout and readable assistant prose.
- Composer structure (field → model/effort → send) matches mental models.
- Session + status + context triad is the right information architecture; it mainly needs visual prioritization and clearer icons.

---

## Verdict

Solid foundation — calm and legible. Biggest UX wins: **role contrast**, **send affordance**, and **header clarity** (especially the gear). Everything else is polish.
