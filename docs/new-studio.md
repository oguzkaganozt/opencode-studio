# Adding a Studio

After the four first-party Studios are stable:

```bash
bun run create-studio robotics
```

Then:

1. Add the ID to `src/core/registry.ts` (`STUDIO_IDS`).
2. Register the definition in `src/studios.ts`.
3. Wire plugin + API loaders in `src/studio-loaders.ts` (not `plugin.ts` or `server.ts` — those consume the loader maps).
4. Add a lazy entry to `viewerLoaders` in `ui/app.tsx` (typed `Record<StudioId, …>`; the `assertViewerLoadersComplete` call enforces catalog parity).
5. Add skill, domain tests, and a Viewer summary page.
6. Extend parity fixtures if tools/skills change (`test/parity/tools.json`, `test/parity/skill-digests.json`).

Do not add a second host, package, CLI, or release pipeline.
