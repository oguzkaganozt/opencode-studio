# Page override — Files explorer

Overrides MASTER for `/files` list + preview.

## Intent
Read-only workspace browser. Mid density, keyboard-first, quiet chrome. Rose accent (`data-studio="files"`) only on selection rail / crumbs current — not full wash.

## Layout
- Breadcrumb bar: h-10–12, elevated, border-b; up control + path crumbs + “read-only” faint meta
- Split: list ~18rem (md+) | preview flex-1; mobile stacks (list ↔ preview)
- List rows: 32–36px hit; dir/file glyph; name truncate; bytes mono faint
- Filter: search input, `/` focus, Escape clear
- Keyboard list: roving focus; Arrow/j/k moves focus; selected preview keeps the rose rail
- Deep breadcrumbs stay single-line and horizontally scroll; refresh is always available

## States
- Loading: skeleton rows (list) / skeleton well (preview)
- Mobile preview header (Back + file identity) persists through loading and error states
- Empty dir / no filter matches: EmptyState
- Preview error: ErrorState + recovery copy
- No selection: EmptyState “Select a file…”

## Motion
- Row hover/selected: color only (180ms)
- No card lift, no glass

## Keep
- All keyboard (j/k, Enter, Backspace up, type-to-filter)
- API paths and download links
- Behavior/copy meaning
