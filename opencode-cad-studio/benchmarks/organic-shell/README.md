# Manufactured Freeform Benchmark

This benchmark checks whether a CAD agent preserves a reference-driven dominant form instead of substituting a filleted prism.

## Run

```bash
bun run benchmark:organic
```

Defaults:

- model: `xai/grok-4.5`
- variant: `high`
- isolated temporary studio and OpenCode config
- repository `cad-studio` skill and source plugin

Override the model or retained workspace with `BENCHMARK_MODEL`, `BENCHMARK_VARIANT`, or `BENCHMARK_WORKSPACE`.

The runner prints the workspace path before starting and preserves it after completion. `run.jsonl` contains the agent trace and `stderr.log` contains OpenCode diagnostics. It copies only the packaged plugin, Forge runtime, current skill, and reference PNGs into the isolated workspace. The canonical `target.py`, benchmark README, and repository source are not exposed to the benchmark agent.

## Evidence

The run passes only when all of the following are evidenced:

- The agent states a form contract before modeling and uses station-driven or surface-driven construction for the dominant shell.
- `design_build("organic-shell-benchmark")` succeeds for exactly two one-solid parts: `upper-shell` and `base`.
- The assembled envelope remains within 4 mm of 112 x 69 x 39 mm.
- Final front, side, top, and isometric renders preserve the reference taper, asymmetric crown, and changing plan silhouette.
- The continuously smooth reference is not replaced by dense polyline sections, a ruled/faceted loft, or visible station bands; face inventory and highlights must support a smooth master skin.
- Sections normal to X near -40, -15, 10, and 35 mm report changing width/height and at least 3 mm of lateral centre drift across the body.
- The upper shell is hollow with at least 1.6 mm nominal wall thickness, and the base has a real locating interface rather than decorative geometry.
- The final report separates artifact build, printability, mechanical fit, and form-fidelity status.

Do not pass a run solely because it contains a BSpline face, a `loft()` token, or a valid solid.

Recorded model runs and independent verdicts are in [`RESULTS.md`](RESULTS.md).
