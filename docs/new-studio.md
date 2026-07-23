# Adding a Studio

After the four first-party Studios are stable:

```bash
bun run create-studio robotics
```

Then:

1. Add the ID to `src/core/registry.ts` (`STUDIO_IDS`).
2. Register the definition in `src/studios.ts`.
3. Wire plugin + API loaders in `src/plugin.ts` and `src/server.ts`.
4. Add skill, domain tests, and a Viewer summary page.
5. Extend parity fixtures if tools/skills change.

Do not add a second host, package, CLI, or release pipeline.
