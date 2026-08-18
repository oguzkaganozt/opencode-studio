# Product PCB vertical slice (Phase 0)

Isolated spike. It does not change the OpenCode Studio package.

```bash
pnpm install
pnpm --dir engine install
pnpm test
pnpm slice
```

Needs Node ≥22.13 and Bun (tscircuit CLI).

## Green

- locked intent, hashed apply, abort cannot publish
- Mastra workflow suspend/resume + LibSQL restart
- real tscircuit compile + `@tscircuit/checks` placement/netlist
- Mastra agent + `createTool` + model router (`openai/*`, `xai/*`)
- missing API key fails closed
- thin AG-UI event mapping from workflow steps

## Stack

Locked in `plans/adr/0001-phase-0-stack.md`.
