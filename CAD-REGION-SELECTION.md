# CAD Region Selection — Implementation Plan

Status: **ready to implement** · full tool, not a stripped release · keep the design lean

**Scope check:** ~same size as multi-pin (scene + app HUD + skill). No forge/API work. Reuse `pickAt` / face meshes / pins / HUD patterns in `assembly-scene.ts` (~526 lines) and `app.tsx`.

---

## 1. Goal

Freehand **closed zones on one face at a time**; multi-face = **multiple regions**. Agent gets structured face + boundary data. Annotation/handoff — not a B-rep sketcher.

| Tool | Data | Cap |
| --- | --- | --- |
| **Pick** (existing) | points | 8, oldest-drop |
| **Region** (new) | closed face polygons | 5, block + toast |

Do not build regions from pins. No cross-face single stroke.

---

## 2. Interaction (minimal complete)

**Pick | Region** input mode. Pins and committed regions **both stay visible**.

**Copy / Prompt = full annotation state** — every current pin **and** every committed region, always. Not mode-filtered, not “last only.” What you see is what the agent gets (simplest hybrid: points + zones in one handoff).

**Clear** stays **mode-scoped** (Pick Clear → pins; Region Clear → regions) so you can drop one kind without wiping the other. HUD should show both counts when both exist (e.g. `3 pins · 2 regions`) so leftovers aren’t invisible before Prompt.

```
Idle → pointerdown on faceId → lock + draw (same gesture)
     → move: sample locked face only
     → near-start or Done → commit, unlock
     → Escape / cancel stroke → unlock, keep committed set
```

| Rule | Spec |
| --- | --- |
| No `faceId` | Toast; no lock (local GLB without face split) |
| After commit | Always unlock (re-hit for next region) |
| Close | ≥3 verts after simplify; near-start ≈ 12px; Done on **HUD** |
| Tiny stroke | Reject if area ≲ 1 mm² (plane) |
| Stroke model | **One continuous gesture** (+ Done). No multi-stroke “continue polyline” state |
| Escape | Cancel stroke only; sheets keep priority when open |

### Orbit vs draw (must work — first to implement)

Today: 1-finger/LMB = OrbitControls rotate (`assembly-scene.ts`).

| State | Touch | Mouse |
| --- | --- | --- |
| Region idle | 1-finger orbit; tap face → lock+draw | LMB orbit; tap face → lock |
| Region locked/drawing | **1-finger draw**; 2-finger dolly/pan | **LMB draw**; RMB rotate; middle dolly |
| Pick | unchanged | unchanged |

While locked: disable one-finger/LMB rotate; restore on unlock. Reuse `multiTouchActive`. Set `mouseButtons` / `touches` explicitly.

### Chrome

- Toolbar: **Pick | Region** segment (compact, 44px)
- HUD while drawing: **Done** + hint
- HUD armed when **any** annotation exists (pins and/or regions): counts for both + last-relevant detail + Copy / Prompt
- **Clear** = clear that mode’s set only (one control, like picks)
- Empty Region (no stroke): “Tap a face, then draw a closed area”
- Copy/Prompt hidden only when **both** pins and regions are empty

---

## 3. Geometry (one sampling path)

**Always** sample by raycasting **locked face meshes only** (`userData.faceId`). Skip misses. That is the whole non-plane path and the plane validator.

**If `faceType === "plane"`** (from topo, already on picks): also keep lock plane (point + normal). Build orthonormal frame once; project samples → `boundary2d`; RDP in 2D; lift back to 3D. Payload gets `plane` + `boundary2d`.

**If not plane:** RDP in 3D; `approximation: "mesh-samples"`; no fake plane frame.

Do **not** maintain a separate infinite-plane-only sampler (off-face junk). Mesh hit is source of truth; plane math is for 2D handoff + stable simplify.

| Overlay | |
| --- | --- |
| In progress | Line strip, normal bias ~0.04, `raycast = () => {}` |
| Plane committed | Translucent fill + outline (`Shape`/`ShapeGeometry` in plane) |
| Non-plane committed | **Outline only** + face already amber via highlight (enough; no ribbon/decal/triangle-strip project) |

Simplify: RDP ≤ **64** verts on commit (and light throttle on move if needed). Pure helpers in `region-geometry.ts` for unit tests.

**Skip (bloat):** self-intersection repair, UV paint, edge snap, mesh triangle fill selection, winding perfectionism beyond a simple CCW fix when plane frame exists.

---

## 4. Data + Prompt

```ts
type RegionInfo = {
  id: string
  part: string
  partIndex: number
  faceId: number
  faceType: string | null
  boundary: Array<{ x: number; y: number; z: number }> // mm, open ring (no dup end)
  normal: { x: number; y: number; z: number }
  centroid: { x: number; y: number; z: number } // mean of boundary
  approximation: "plane-projected" | "mesh-samples"
  plane?: {
    origin: { x: number; y: number; z: number }
    xAxis: { x: number; y: number; z: number }
    yAxis: { x: number; y: number; z: number }
    boundary2d: Array<{ u: number; v: number }>
  }
}
```

**Single Copy/Prompt payload** when any annotations exist:

```text
design=… revision=…
User marked annotations in the CAD viewer.

points (N):
  1) part=… point_mm=… normal=… face=… …
  …

regions (M):
  1) part=… face=… type=… approximation=…
     normal=… centroid_mm=… [plane + boundary2d if plane]
     boundary_mm=[…]
  …

Prefer STEP under step/. Points = locations; regions = face zones (not exact wires until verified).
Edit sources, then design_build.
```

Omit the `points` or `regions` block if that list is empty. Floats @ 3 decimals. Skill + `skill-digests.json` document combined handoff.

---

## 5. Code map

| Touch | Path |
| --- | --- |
| Types/caps | `assembly-types.ts` |
| Mode, stroke, overlays, controls, clear | `assembly-scene.ts` |
| RDP / plane frame / close / area | `region-geometry.ts` + small unit test |
| Mode + HUD + text | `app.tsx` |
| Callbacks / clear on load | `assembly-viewport.tsx` |
| CSS segment/Done | `styles.css` |
| Docs | `cad.md`, skill, LOCK unlock when editing locked CAD UI |

Forge/host: **no change**.

`SceneHandle`: `setInteractionMode`, region clear/get, mirror pick callbacks.

---

## 6. Non-goals

Pin-hull regions · cross-face one stroke · edge snap · browser OCCT · auto build123d features · region without faceId · mode-filtered / last-only Prompt · fancy curved fill meshes

---

## 7. Done when

1. Pick unchanged in Pick mode  
2. Same-gesture draw → close → overlay; Prompt includes all pins + regions  

3. Plane payload includes `plane` + `boundary2d`  
4. Curved: outline on face, no planar fill through solid  
5. Phone: 1-finger draw / 2-finger navigate  
6. No faceId toast; Clear; Escape; reload clears  
7. typecheck/lint/tests + skill digest  

---

## 8. Build order

1. Controls matrix (mode + locked orbit/draw)  
2. Types + `RegionInfo`  
3. Face-scoped hit helper (extract from `pickAt`)  
4. Lock + sample + live line  
5. Close / RDP / commit + plane frame when plane  
6. Overlays (plane fill / non-plane outline) + highlight  
7. App chrome + Prompt + skill  
8. Unit tests + check + dogfood  

---

## 9. Efficiency notes (vs codebase)

| Lean | Why |
| --- | --- |
| One raycast sampler | `pickAt` already builds mesh list + faceId; filter by lock |
| Outline-only curves | Face tint already communicates surface; ribbon is a project alone |
| One Clear | Matches picks; less toolbar density on &lt;640 |
| No self-intersect engine | Min verts + min area catches accidents |
| Single continuous stroke | Avoids FaceLocked-with-open-polyline continuation states |
| Plane frame only when topo says plane | Cheap; high agent value |
| No forge work | `face_*` + topo already exist |

**Estimated size:** M — roughly +150–250 LOC scene, +80–120 app, +~80 geometry helpers/tests. Riskiest slice: OrbitControls vs draw (small code, easy to get wrong on touch).

---

*End of plan.*
