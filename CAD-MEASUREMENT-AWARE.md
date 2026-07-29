# CAD Measurement-Aware Annotations — Spec

Status: **Phase 0–1 shipped** · Phase 2 Ref **removed** (overlay edge guides instead) · Phase 3 gated  
Shipped: Δ · snap (+ live edge mm guides on canvas) · Rect · Link

**Product one-liner:** Make Pick + Region a **measurement-aware workspace** — the user sees mm while placing, and Copy/Prompt carries dimensions the agent can use — without turning the viewer into a full CAD sketcher or loading a B-rep kernel in the browser.

**Truth model (do not invert):**

| Layer | Role |
| --- | --- |
| Viewer annotations | **Intent + working dimensions** (what the user marked) |
| STEP + `build123d_*` session | **Engineering truth** (verify / edit geometry) |
| Prompt footer | Always: map face ids on STEP; viewer mm are working dims — verify before manufacturing claims |

---

## 0. Problem

Today:

- **Pick** drops pins with `point_mm` + `normal` + optional `face` — no distance to anything.
- **Region** is freehand only — no width/height, no snap, easy to be sloppy.
- User cannot answer: “how far is this pin from that?” or “is this zone ~20×30 mm?”

Out of scope as *primary* solution: world/face **grid** as the measurement system (optional last; never “exact”).

---

## 1. Goals / non-goals

### Goals

1. **See mm while working** (HUD live readouts).
2. **Emit mm in Copy/Prompt** (structured fields + honest `quality`).
3. **Prefer construction dimensions** (explicit pin pairs; rect W×H; optional typed size) over inferred magic.
4. **Snap aids placement** before confident size labels — OSNAP-style, not grid-first.
5. **Stay lean:** three.js + forge OCP only; no OCCT-in-browser; no new CAD framework.
6. **Ship in slices** — each slice alone is useful; dogfood gates later phases.

### Non-goals

- Full drawing dimension stack (witness lines, tolerances, GD&T).
- Multi-body mate / clearance dashboard (may note cross-part pin pairs as distance-only).
- Editing STEP from the viewer.
- Grid as default snap.
- Automatic “nearest edge” as the *only* offset story.
- Big-bang topo + snap + rect + grid in one PR.
- Circle/poly region toolkit before Rect is excellent.

---

## 2. Design principles

1. **Construction-first** — numbers the user creates beat silent nearest-feature.
2. **Honesty over false precision** — free mesh hits are approximate; do not cosplay BREP.
3. **Snap before confident rect sizes** — unsnapped drag may show live W×H, but prompt `quality` must not read as manufacturing truth.
4. **Explicit measure pairs** — not only last↔previous when N&gt;2.
5. **Edge distances for the user on canvas** (snap overlay guides) — not a Ref chip; **not** copied into the agent prompt.
6. **BREP edge ids last** (Phase 3) — only if mesh path fails dogfood.
7. **One annotation payload** — Copy/Prompt = full state; Clear = mode-scoped.
8. **`quality` enum** — `construction | mesh-approx | brep` on every numeric claim that could mislead.

---

## 3. Precision & quality policy

| Source | HUD display | Prompt decimals | `quality` |
| --- | --- | --- | --- |
| Free face hit (no snap) | **1 dp** mm | 1 dp + `quality=mesh-approx` | `mesh-approx` |
| Mesh vertex/edge/mid/center snap | 1–2 dp | 2 dp + `snap=…` | `mesh-approx` |
| Typed W/H or typed distance | as entered | 3 dp | `construction` |
| Pin–pin Euclidean (any snap state) | 1 dp live; 2 dp if both snapped | 2 dp | `construction` (user-chosen pair) but points still carry their own snap/quality |
| BREP snap / edge id (Phase 3) | 2–3 dp | 3 dp | `brep` |

**Rules**

- Never imply viewer mm replace STEP `measure()`.
- Skill **must** say: treat `measures` / `size_mm` as **targets to verify** on STEP (`import` / `measure` / `compare`), not as already-true manufacturing dims.
- Prefer `boundary2d` + plane frame for geometric intent; `size_mm` is a convenience label for rects.

---

## 4. Phased delivery (revised order)

Implement **in this order**. Do not start Phase 3 before Phases 0–1 are dogfooded.

| Phase | Name | Forge? | Ships alone? | Effort |
| --- | --- | --- | --- | --- |
| **0a** | Pin–pair distance | No | **Yes — first PR** | S |
| **0b** | Mesh vertex snap (Pick + future rect corners) | No | Yes | M |
| **0c** | Plane Rect + W×H (+ optional typed size) | No | Yes | M |
| **1** | Explicit measure pairs + edge snap/midpoint polish | No | Yes | M |
| **2** | Reference offset (“from this edge”) | No | Yes | M |
| **3** | Topo v2 BREP wires | **Yes** | Only if needed | L |
| **4** | Optional face grid | No | Skip if unused | S |

**MVP bar:** 0a + 0c (with at least vertex snap from 0b on rect corners) = “measurement-aware.”  
**Lean cut allowed:** ship **0a alone** immediately; 0b then 0c. Do not block 0a on Rect.

**Was wrong in v1 spec:** Rect before snap; last↔previous as the whole measure model; Phase 3 as default path.

---

## 5. Phase 0a — Pin–pair distance (first ship)

### 5.1 Behavior

- **Derived at format/HUD time** from `picks[]` — no need to persist measures in scene unless overlay needs it.
- **Default live HUD:** distance **last pin ↔ previous pin** when `picks.length >= 2` (cheap continuous feedback).
- **Prompt measures block:**  
  - If exactly **2** pins → one `pin_distance` for pair (1,2).  
  - If **&gt;2** pins → still emit **last↔previous** as one measure **and** (Phase 1) any **linked pairs**; until Phase 1, document in HUD that Δ is “last pair only” so users are not misled.
- **Cross-part:** allowed — Euclidean 3D distance; prompt includes both part names via point indices.
- **Pin remove/reorder:** indices are **1-based prompt order** at format time; removing a pin drops measures that referenced it (recompute from current array).
- **Overlay (optional in 0a):** if exactly 2 pins, thin segment + midpoint label. Skip complete graph for 8 pins.

### 5.2 Data

```ts
type PinPairMeasure = {
  fromIndex: number // 1-based, current prompt order
  toIndex: number
  distance_mm: number
  quality: "construction"
}
```

### 5.3 Prompt

```text
measures (1):
  1) kind=pin_distance from_point=1 to_point=2 distance_mm=12.40 quality=construction
```

### 5.4 Acceptance

- [x] ≥2 pins → HUD `Δ last=… mm` (1 dp).
- [x] Copy/Prompt includes `measures` when ≥2 pins.
- [x] Pin delete updates/removes stale Δ. (derived from `picks[]`)
- [x] Unit test: distance helper.
- [x] Skill + digest + cad.md: distance field + verify-on-STEP language.
- [x] No forge change.

### 5.5 Files

| Path | Change |
| --- | --- |
| `studios/cad/viewer/src/measure-geometry.ts` (+ test) | `distance3` |
| `studios/cad/viewer/src/app.tsx` | HUD Δ; `formatAnnotationText` measures |
| `studios/cad/viewer/src/assembly-scene.ts` | optional 2-pin segment overlay |
| `studios/cad/skill/SKILL.md` + `test/parity/skill-digests.json` | handoff + verify |
| `design-system/opencode-studio/pages/cad.md` | lock text |

---

## 6. Phase 0b — Mesh vertex snap (before confident Rect)

### 6.1 Why before Rect

Unsnapped rect corners produce **confident wrong W×H**. Vertex snap first (Pick + rect corners share `resolveSnap`).

### 6.2 Targets (v1)

| Priority | Target | Screen tol |
| --- | --- | --- |
| 1 | **Vertex** (face mesh) | ~14 px |
| 2 | Free face hit | — |

Edge nearest + midpoint → Phase 1 polish (same SnapIndex).

### 6.3 Implementation

- Per-face `SnapIndex` on **first lock/hit** of that face (lazy): unique verts quantize ~0.05 mm.
- Resolve in **camera pixel space**.
- Invalidate on `clear` / `loadParts` (`loadGeneration`).
- Face-local only (`face_*` meshes). Cross-face shared BREP verts are duplicated after forge remap — OK for face-local snap.
- Perf: no full brute force over huge clouds every move without culling; budget move path for phone.

```ts
type SnappedPoint = {
  position: Vec3
  normal: Vec3
  snap: "vertex" | "edge" | "midpoint" | "free"
  quality: "mesh-approx" | "brep" // brep only Phase 3
}
```

Extend `ClickInfo` with optional `snap` + `quality`.

### 6.4 Acceptance

- [x] Box face corners catch vertex snap reliably. (screen-space; face mesh verts)
- [x] Prompt pin lines include `snap=` + `quality=`.
- [ ] No jank on phone dogfood for typical parts.

---

## 7. Phase 0c — Plane rectangle region

### 7.1 Scope

- **Planar faces only:** topo `faceType === "plane"`, or (topo type unknown) mesh verts within ~0.35 mm of the hit plane. Explicit curved topo types toast and refuse.
- Freehand **kept** via compact **Free | Rect** under Region (Rect default for measurement path).
- Caps unchanged: `MAX_REGIONS = 5`.
- **Do not** run freehand close-gate (`CLOSE_START_PX`, etc.) on Rect path.

### 7.2 UV / size honesty (critical)

Current `buildPlaneFrame` uses a **world-helper axis** (`region-geometry.ts`) — **not** feature-edge-aligned.

| Term | Meaning |
| --- | --- |
| **Frame** | Orthonormal frame from hit origin + face normal (existing helper) unless Phase 3 supplies topo plane axes |
| **Axis-aligned rect** | Rectangle sides parallel to **that frame’s u/v**, not necessarily part edges |
| **W / H** | `abs(Δu)`, `abs(Δv)` in mm in that frame |

**Prompt must not claim edge-aligned.** Skill: sizes are in viewer plane frame; verify on STEP; agent may re-orient to design params.

Later (Phase 1+): optional **edge-align** first side to snapped edge direction — out of 0c.

### 7.3 State machine

```
Idle (Region+Rect)
  pointerdown on faceId + plane → lock face, corner0 = snapped hit, draft active
  pointermove → corner1 = snapped hit on locked face only; live W/H HUD
  pointerup → if min size ok → commit 4-corner region, unlock; else cancel draft
  2nd finger / Escape → cancel draft (same spirit as freehand cancelRegionStroke)
```

- Separate from freehand `stroke[]` path.
- Extend `RegionDraft` (or parallel draft): `{ kind:"rect", width_mm, height_mm, active, part, faceId }`.
- Auto-commit on pointerup (no Done, no loop-close).

### 7.4 Typed size (recommended in 0c if cheap)

After commit (or on lift): optional HUD **W / H number fields** to override drag size keeping center or corner0 fixed — sets `quality=construction` on `size`. If deferred, note as Phase 1 follow-up; drag-only ships with `quality=mesh-approx` unless both corners vertex-snapped then still `mesh-approx` (tessellation) unless typed.

**Policy for rect `size` quality:**

- Drag only → `mesh-approx`
- User typed W or H → `construction`

### 7.5 Data

```ts
type RegionInfo = {
  // existing fields...
  kind: "freehand" | "rect" // required on new commits; readers default missing → freehand
  size?: {
    width_mm: number
    height_mm: number
    quality: "construction" | "mesh-approx"
    frame: "viewer-plane" // explicit: not edge-aligned
  }
}
```

`boundary` length 4, CCW in plane frame vs outward normal; `plane.boundary2d` four corners.

### 7.6 Prompt

```text
regions (1):
  1) part=… face=… kind=rect approximation=plane-projected
     size_mm=width=20.0 height=12.5 quality=mesh-approx frame=viewer-plane
     …
```

### 7.7 Acceptance

- [x] Plane rect drag → live W×H; commit `kind=rect` + 4 corners + size.
- [x] Non-plane → toast, no lock.
- [x] Multi-touch cancel works.
- [x] Freehand path unchanged when Free selected.
- [x] Unit tests: rect from two UV corners; CCW; min size reject.
- [x] Skill + digest + cad.md.

### 7.8 Files

| Path | Change |
| --- | --- |
| `measure-geometry.ts` / `region-geometry.ts` | rect from corner0/corner1 UV |
| `assembly-types.ts` | `kind`, `size`, draft fields |
| `assembly-scene.ts` | rect FSM; no freehand close-gate |
| `app.tsx` | Free\|Rect; live W×H; format |
| `styles.css` | preview + measure chips |

---

## 8. Phase 1 — Measure pairs + edge snap polish

### 8.1 Explicit pairs (fixes last↔previous gap)

- **Link mode (Pick):** tap pin A (select — does not remove), tap pin B → add `linkedPairs` entry; HUD shows that Δ; segment overlay for linked pairs (cap e.g. 4 pairs).
- **Tap-near-pin remove** must not fire when in link arm; use short HUD **Link** chip vs remove.
- Prompt emits all linked pairs + optional last↔previous only if not already linked.

```ts
// app or scene state
linkedPairs: Array<{ fromId: string; toId: string }> // pin stable ids if introduced, else indices at link time revalidated
```

Prefer **stable pin ids** (`id: string` on each pick) when implementing multi-pair — avoids index churn. Additive on `ClickInfo`.

### 8.2 Snap polish

- Boundary **edge nearest** + optional **midpoint** on long edges.
- Rect corners use full snap stack.
- Optional: first rect side **align to snapped edge** direction (nice-to-have).

### 8.3 Acceptance

- [x] User can dimension pin 1↔3 while pin 2 exists.
- [x] Edge snap works on box outline.
- [x] Skill documents linked measures.

---

## 9. Phase 2 — dropped (was Ref chip)

**Product cut:** HUD **Ref** + prompt `offset_mm` removed as too heavy for users. Nearest-edge mm is shown only on the **snap overlay** (viewer-only). Agent still gets `point_mm` / `face` / pin–pin `measures` / rect `size_mm` and verifies on STEP.

**Shipped instead**

- [x] Snap overlay: dashed guides + mm to up to 2 nearest face boundary edges  
- [x] No Ref chip, no pin `offset` field, no prompt offset lines  
- [x] Face **center** snap (`snap=center`, vertex-mean centroid, mesh-approx)

---

## 10. Phase 3 — Forge topo v2 (gated)

**Gate:** ship only if mesh snap + canvas edge guides are too weak for agent mapping in dogfood.

### 10.1 Viewer compatibility (mandatory before forge ship)

Today `loadTopo` **rejects** `schema !== 1` and requires `triangleFaceIds`. Before writing schema 2:

- Accept `schema` **1 | 2**.
- If `face_*` meshes present, `triangleFaceIds` may be omitted on v2.
- Missing/failed topo → mesh path only (no hard fail load).

### 10.2 Schema sketch

```ts
type PartTopoV2 = {
  schema: 2
  partId: string
  faceCount: number
  faces: Array<{
    id: number
    type?: string
    plane?: { origin: Vec3; normal: Vec3; xAxis: Vec3; yAxis: Vec3 }
    wires: Array<{
      id: number
      outer: boolean
      points: Vec3[]
      edges: Array<{
        id: number // **face-local**, stable within single part export
        a: number
        b: number
        length_mm: number
        curve?: "line" | "circle" | "other"
      }>
    }>
  }>
}
```

**edge id namespace:** face-local; prompt `face=… edge_id=…`. Not stable across redesigns that change topology — skill says re-verify.

### 10.3 Acceptance

- [ ] Dual-load schema 1|2; old artifacts work.
- [ ] Forge test: box → 6 faces, 4 outer edges each.
- [ ] Snap/offset `quality=brep` when v2 used.
- [ ] `bun run test:python` green.

---

## 11. Phase 4 — Optional grid

- Planar lock only; HUD Grid chip + spacing `1|2|5|10` mm.
- Priority: vertex/edge **beat** grid.
- Skip if 0–2 satisfy users.

---

## 12. Copy / Prompt contract (cumulative)

Full annotation state always. Example after 0a–0c + snap:

```text
design=box-lid-demo revision=abc123def456
User marked annotations in the CAD viewer (2 point(s), 1 region(s), 1 measure(s)).

points (2):
  1) part=lid face=2 (plane) point_mm=(10.00, 0.00, 5.00) normal=(0,0,1) direction=top snap=vertex quality=mesh-approx
  2) part=lid face=2 (plane) point_mm=(30.00, 0.00, 5.00) normal=(0,0,1) direction=top snap=free quality=mesh-approx

measures (1):
  1) kind=pin_distance from_point=1 to_point=2 distance_mm=20.00 quality=construction

regions (1):
  1) part=lid face=2 type=plane kind=rect approximation=plane-projected
     size_mm=width=20.0 height=12.5 quality=mesh-approx frame=viewer-plane
     normal=(0,0,1)
     centroid_mm=(…)
     plane_origin_mm=(…) plane_x=(…) plane_y=(…)
     boundary2d_mm=[…]
     boundary_mm=[…]

Working dimensions from the viewer are intent only — verify on STEP with build123d measure/compare before manufacturing claims. Map face ids on STEP, edit part sources, then design_build. Prefer STEP under step/ for: lid.step (design box-lid-demo).
```

**Additive fields only** — never drop `point_mm` / `boundary_*`.

---

## 13. Skill contract (required with any phase that touches prompt)

Update `studios/cad/skill/SKILL.md` (and digest) to include:

1. New fields: `measures`, `kind=rect`, `size_mm`, `snap`, `quality`, `frame=viewer-plane`, later `offset`.
2. **Mandatory agent behavior:** import/prefer STEP → verify critical dims with `build123d_measure` / `compare` — do not treat viewer mm as final.
3. Rect sizes are in **viewer plane frame**, not necessarily design-edge-aligned.
4. Points = locations; regions = zones; measures = requested distances/sizes.
5. No inventing manufacturing wires from freehand/mesh-approx boundaries.

---

## 14. Interaction chrome

| Control | Where | Phase |
| --- | --- | --- |
| Pick \| Region | Toolbar | existing |
| Free \| Rect | Under Region | 0c |
| Δ last / pair | Surface HUD | 0a / 1 |
| Live W×H | HUD while rect drag | 0c |
| Typed W/H | HUD after rect (if shipped) | 0c/1 |
| Link | HUD chip in Pick | 1 |
| snap glyph | Canvas | 0b |
| Ref | HUD chip (not long-press) | 2 |
| Grid | HUD | 4 |
| Clear | HUD mode-scoped | existing |
| Copy / Prompt | HUD full state | existing |

Mobile: one compact measure strip; 44px targets; sheets outside canvas `inert`; never inline `position:relative` on viewport root.

---

## 15. Libraries / architecture

| Choice | Decision |
| --- | --- |
| Browser B-rep | **No** |
| New measure framework | **No** |
| three.js + pure TS | **Yes** (`measure-geometry.ts`, `region-geometry.ts`) |
| Forge OCP wires | Phase 3 only |
| three-mesh-bvh | Optional perf later |

---

## 16. Testing

| Layer | What |
| --- | --- |
| Unit | distance; rect UV→W/H; point-segment; snap fixture |
| Manual | box corners snap; 2-pin Δ; plane rect; phone 2-finger cancel |
| Forge | Phase 3 box wires |
| Parity | skill digest on SKILL.md change |
| Gate | `bun run check`; forge → `bun run test:python` |

---

## 17. Implementation checklist

1. [x] **0a** — distance helper + HUD Δ + measures in prompt + skill/digest/cad.md  
2. [x] **0b** — vertex SnapIndex + pin `snap`/`quality`  
3. [x] **0c** — plane Rect FSM + size + Free\|Rect + frame honesty in prompt  
4. [x] **1** — linked pairs + edge/mid snap  
5. [x] **2** — Ref chip **dropped**; nearest-edge mm shown on snap overlay only (not in prompt)  
6. [ ] Dogfood on live host  
7. [ ] **3** only if gated need — dual schema load first, then forge wires  
8. [ ] **4** grid only on request  

---

## 18. Open decisions (defaults)

| Topic | Default |
| --- | --- |
| Freehand after Rect | **Free \| Rect** toggle; Rect default |
| Rect non-plane | Toast disable |
| Pin stable ids | Add `id` when Phase 1 pairs land; 0a may use indices only |
| Typed W/H in 0c | **Yes if &lt;0.5d extra**; else Phase 1 |
| Cross-part distance | **Allowed** (Euclidean) |
| Phase 3 | **Gated** — not on default roadmap commit |

---

## 19. Success criteria

1. Two pins → read distance in mm in-viewer + in Prompt.  
2. Plane rect → agent gets W×H with honest `quality` + `frame=viewer-plane`.  
3. Vertex snap → corners land reliably; prompt carries `snap`.  
4. (Later) Linked pairs + edge ref offset with honest quality.  
5. Agent skill mandates STEP verification.

**0a alone** is a valid interim ship. **0a+0b+0c** = measurement-aware MVP.

---

## 20. Explicitly rejected

- Grid-first exact positioning  
- Auto-nearest-edge as sole offset UX  
- Browser OCCT  
- Rect-before-snap as the measurement path  
- last↔previous as the only multi-pin measure model (beyond 0a interim)  
- Phase 3 without dual-schema viewer support and dogfood gate  
- Parallel multi-shape region toolkit  

---

## 21. Review changelog (this revision)

From dual agent review (product + engineering):

- Reordered: **0a distance → 0b vertex snap → 0c rect** (snap before confident sizes).  
- Precision/quality policy; footer verify language.  
- Explicit pairs in Phase 1; 0a last↔previous documented as interim.  
- Rect UV = viewer-plane frame, not edge-aligned; FSM + multi-touch cancel specified.  
- Ref = HUD chip, not long-press.  
- Phase 3 gated; `loadTopo` schema 1\|2 requirement called out.  
- Lean MVP and skill contract tightened.  

*Implement Phase 0a next; update status line when each phase ships.*
