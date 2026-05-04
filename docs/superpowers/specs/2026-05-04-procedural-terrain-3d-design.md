# Procedural Terrain 3D — Design

Date: 2026-05-04
Status: Draft (awaiting user review)

## 1. Overview

A procedurally generated 3D terrain with snow-capped mountains, valleys, lakes, rivers, and trees. The player flies a free-fly camera over a vast, deterministic world. Ships in two layers:

- **`terrain` module** — a reusable, vanilla-JS Three.js library that future JSGames (flight sim, racer, exploration game) can drop in. Genre-agnostic; no input, no UI, no game state.
- **Standalone deploy** — a polished "fly around the world" deploy on play.nitzan.games (`/play/procedural-terrain`) that uses the module via a thin game shell (camera controller, HUD, settings, `meta.json`, thumbnail).

## 2. Locked-in decisions

| Topic | Decision |
|---|---|
| Visual styles | All 3 (low-poly faceted, stylized painterly, semi-realistic) — runtime-switchable via uniform; **`lowpoly` default**. Faceted look uses fragment-shader screen-space derivatives so all 3 styles share one indexed mesh topology |
| World extent | **64 km × 64 km** (±32,000 m on X/Z). 1 unit = 1 m. Outside that → ocean fading into fog. No floating-origin (Float32 precision is safe at this scale) |
| World scale | Sea level Y = 0. Snow line ≈ Y > 22. Max peak ≈ Y ≈ 38 |
| Streaming | Chunk-based, generated on demand from a single world seed. 256 m × 256 m chunks |
| Rivers / lakes | Procedural river graph built once at world load (steepest-descent on a 256×256 low-res heightfield over the whole world). Chunks carve a small valley + draw a flat water ribbon for any river segment crossing them. Lakes form at confluences and dead-ends |
| Camera | Free-fly noclip. Desktop: WASD + mouse + scroll-throttle. Mobile: drag-to-look + virtual stick + pinch-throttle. Boost button on both |
| Perf target | 60 FPS desktop / 30 FPS mobile baseline + auto-downscale (view distance + tree density + LOD vertex grid) on detected weak GPU |
| Trees | Single low-poly conifer with two color tints. Biome-placed: none above snow line, sparser on rock/sand, denser mid-elevation. Full mesh inside ~400 m, billboard beyond |
| Determinism | Every random in the chain is `hash(world_seed, ...)`, never `Math.random()`. Same seed → same world every load. Trees in the same place on revisit is automatic |
| Seed source | URL `?seed=...` → `localStorage` → random fallback. Persisted on first run so reloads land in the same world |

## 3. Architecture

```
Standalone shell (index.html)         ◄── deployable game on play.nitzan.games
├── PlaySDK + meta.json + thumbnail.png
├── HUD (compass, altitude, FPS)
├── Settings flyout (style picker, persisted to localStorage)
├── Loading screen
└── FlyController  ◄── free-fly camera input (desktop + mobile)

Terrain Module (lib/, vanilla JS, no build step)
├── createTerrain({ seed, style, viewDistance, perfMode, ... }) → controller
├── Controller API:
│     .update(cameraPos)             per-frame: stream/unload chunks
│     .getHeight(x, z)                world-space height query
│     .getRiverWidthAt(x, z)         0 if not over a river
│     .setStyle('lowpoly'|'stylized'|'realistic')
│     .setPerfMode('high'|'low'|'auto')
│     .dispose()
├── ChunkManager      LOD ring around camera, in-flight queue
├── StyleSystem       single MeshLambertMaterial + onBeforeCompile shader injection
├── RiverGraph        built once at load from the global low-res heightfield
├── TreePlacer        per-chunk deterministic placement, InstancedMesh
└── ChunkWorker       Web Worker: noise + carve → transferable ArrayBuffers
```

**Why these splits.** The shell is throwaway code (input, HUD, deploy meta). The module is the asset that survives into other JSGames. The shell never touches Three.js objects the module owns; it only calls the controller API. The module never imports an input library.

## 4. Data flow

### 4.1 Coordinates & chunk grid

- 1 unit = 1 m. World ±32,000 m on X/Z. Sea level Y = 0.
- Chunks are 256 m × 256 m, indexed by `(cx, cz)` integers.
- Three LOD levels, picked by chunk-center distance to the camera.

| LOD | Range | Vertex grid (desktop / mobile) | Tris/chunk | Trees |
|---|---|---|---|---|
| 0 | 0–768 m | 128² / 64² | 32 k / 8 k | full mesh |
| 1 | 768–1536 m | 64² / 32² | 8 k / 2 k | billboards only |
| 2 | 1536–3072 m | 32² / 16² | 2 k / 0.5 k | none |

On mobile, the LOD grid is the smaller column by default; `viewDistance` is stepped down to 1500 m only if the perf probe (§9) detects sustained low FPS. "Mobile" in this table refers to the LOD grid, not a fixed view distance.

Resident triangles at full view distance: ~1.7 M desktop / ~400 k mobile. Seam cracks between adjacent LOD chunks are hidden with **vertical skirts** — chunk-edge vertices are duplicated and pushed 4 m down. Cheap, no stitching.

### 4.2 Init flow (one-time, on load)

1. Resolve seed: URL `?seed=` → `localStorage.getItem('terrain.seed')` → `crypto.getRandomValues()` fallback. Persist to `localStorage`.
2. Generate **256×256 low-res heightfield** for the entire world on the main thread (~30 ms at this resolution). Sample spacing: 250 m.
3. **Build river graph:**
   - D8 flow direction: each cell points to its lowest 8-neighbor (or to ocean if it sits below sea level).
   - Flow accumulation: sort cells by descending elevation, then walk that order propagating each cell's count to its downstream neighbor. O(n log n) once.
   - Trace river paths: from any cell with accumulation > threshold, walk downstream until reaching ocean or an interior basin (lake).
   - Output: `Array<RiverSegment>` where each segment has `{ x0, z0, x1, z1, width }`. Width scales with `sqrt(accum)`. Total payload ≈ 8 KB.
4. Spawn `ChunkWorker`, transfer `{ seed, riverGraph }` once.
5. Build sky color, water plane (one large quad at Y=0), lighting, style system, fog.
6. Stream initial 5×5 ring of chunks around spawn before revealing the world (loading screen).

### 4.3 Per-frame `controller.update(cameraPos)`

1. Compute current chunk index `(cx, cz) = floor(cameraPos / 256)`.
2. Build the desired chunk set: all chunks within LOD0/1/2 rings around `(cx, cz)`.
3. Diff against resident chunks:
   - Resident at correct LOD → keep.
   - Resident at wrong LOD → mark for replacement (don't unload until replacement arrives).
   - Absent → enqueue worker request `{ cx, cz, lod }`.
4. Outside the outer ring → unload (return geometry buffers to a fixed-size pool, dispose tree InstancedMesh).
5. Worker queue is bounded (4 jobs in flight). Pending requests are sorted by distance to camera; if the camera has moved, drop now-irrelevant pending requests.

### 4.4 Worker chunk job

```
input  : { cx, cz, lod }
output : { positions, indices, normals, colors, trees }   — all transferable

steps:
  1. Sample heights at lod-dependent vertex resolution
  2. River carve: for each RiverSegment in the chunk's AABB,
     for each vertex within `width` of the segment,
     subtract a smooth bowl: depth × max(0, 1 - d/width)²
     (also flatten near-bank vertices for a clean ribbon)
  3. computeVertexNormals
  4. Per-vertex tint by height band (sand / grass-low / grass-mid / rock / snow)
  5. If LOD == 0: generate tree list — deterministic jittered grid, reject:
        - under water (y < 0.5)
        - above snow line (y > 22)
        - on rock/steep slope (face normal Y < 0.7)
        - within river width + 1 m
        - density biased toward mid-elevation (peak around y = 8)
     If LOD == 1: same algorithm at lower density, output as billboard list
     If LOD == 2: skip trees
  6. Append skirt vertices/indices around chunk edges
  7. Transfer ArrayBuffers back
```

Heightfield function (worker-side):

```
height(x, z) =
  (fbm(x*F, z*F, seed₁) * 2 - 1) * 6                              // base hills, centered ±6
+ ridge(x*F*0.7, z*F*0.7, seed₂)^1.6 * 32                          // mountains
+ ridge(x*F*0.25 + 5, z*F*0.25 - 9, seed₃)^3 * (-10)               // basins / lakes
- 6                                                                 // bias so some areas dip under sea level
```
F = 0.012 m⁻¹. `fbm` = 5-octave value noise with persistence 0.5. `ridge(n) = 1 − |2n − 1|`. `seed₁ = 1 ^ worldSeed`, `seed₂ = 7 ^ worldSeed`, `seed₃ = 23 ^ worldSeed`. Empirical range across many seeds: about [-14, 30].

### 4.5 Main-thread chunk receive (~1 ms)

- Wrap returned `Float32Array`s in `THREE.BufferAttribute`s, set on a fresh `BufferGeometry`.
- Build chunk `Mesh` using the shared style material.
- If a tree list is present, build one `InstancedMesh` (conifer base mesh, instance count = list length, per-instance: matrix + tint index in custom attribute).
- Far billboards: maintain a single global `InstancedMesh` of screen-aligned quads with a small atlas texture; per-chunk billboard lists update its instance buffer.
- Add chunk + trees to a `THREE.Group`. Fade material opacity 0 → 1 over 200 ms.
- If replacing an old LOD: tween old chunk's opacity 1 → 0 in parallel, then dispose.

## 5. Rendering & style system

**One shared `MeshLambertMaterial`** patched via `onBeforeCompile`. Three styles share the *same* indexed geometry; only uniforms and shader behavior change. No chunk rebuild on style switch.

Uniforms:

```
uStyle       int      0 = lowpoly, 1 = stylized, 2 = realistic
uSnowLine    float
uFogNear     float
uFogFar      float
uFogColor    vec3
uWaterY      float
```

Per-vertex attributes: `position`, `normal`, `color` (height-band tint, same for all styles).

Vertex shader:
- Standard transform.
- Pass `vWorldPos`, `vColor`, `vNormal` to fragment.

Fragment shader (style branches):

- **`uStyle == 0` (low-poly faceted):**
  - Compute face normal via screen-space derivatives: `N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)))`.
  - Snap `vColor` to the nearest of 6 palette entries (sand / low grass / mid grass / rock / snow / water-edge) — gives crisp banded regions instead of the gradient that B/C show. Does not affect B or C, which use `vColor` as-is.
  - Lambert with hard ambient floor.

- **`uStyle == 1` (stylized painterly):**
  - Use smooth `vNormal`.
  - Use `vColor` as-is (already smoothly graded by height).
  - Soft ambient via hemisphere light, gentle linear fog.

- **`uStyle == 2` (semi-realistic):**
  - Use smooth `vNormal`.
  - Slope = `1 - vNormal.y`. Blend `vColor` toward rock based on slope, toward snow above `uSnowLine` minus `slope × 6`.
  - Exponential fog (`exp(-d² × density²)`).

Sky / water / lights swap per style:

| | A lowpoly | B stylized | C realistic |
|---|---|---|---|
| `scene.background` | sharp blue | warm cyan | desaturated grey-blue |
| Fog | none (or hard fog cutoff) | linear, near 110, far 260 | exp², density 0.0085 |
| Water | flat opaque | semi-transparent | dark, soft caustic shimmer (animated UV) |
| Sun temp | white | warm cream | cooler |
| Hemi tint | bright sky / green ground | sky / green | grey / mud |

## 6. Module API contract

```js
import { createTerrain } from './lib/terrain/index.js';

const terrain = createTerrain({
  seed: 12345,                  // optional; default = persisted or random
  style: 'lowpoly',             // 'lowpoly' | 'stylized' | 'realistic'
  perfMode: 'auto',             // 'high' | 'low' | 'auto' (default)
  viewDistance: 3000,           // m; ignored if perfMode='auto'
  scene: threeScene,            // THREE.Scene to add chunks/water/sky to
  renderer: threeRenderer,      // for capability checks
});

// per frame
terrain.update(camera.position);

// height query (e.g. for collision, spawn placement)
const y = terrain.getHeight(x, z);

// over a river? (0 if not)
const w = terrain.getRiverWidthAt(x, z);

// runtime style switch
terrain.setStyle('stylized');

// teardown
terrain.dispose();
```

Module **does not** create or own a camera, controller, HUD, audio, or pointer-lock. Those live in the standalone shell or in downstream games.

## 7. File layout

```
ProceduralTerrain3D/
├── index.html                         standalone game shell
├── meta.json                          slug, title, thumbnail, etc.
├── thumbnail.png                      generated from actual 3D screenshot
├── .zipignore
├── package.json
├── lib/
│   └── terrain/
│       ├── index.js                   createTerrain factory, controller
│       ├── chunk-manager.js           LOD rings, in-flight queue, dispose
│       ├── chunk-worker.js            Web Worker entrypoint
│       ├── noise.js                   shared seeded value noise + fbm + ridge
│       ├── height.js                  terrain height function
│       ├── river-graph.js             D8 flow + accumulation + path tracing
│       ├── carve.js                   river/lake carving applied to chunk verts
│       ├── trees.js                   placement, conifer mesh, billboard atlas
│       ├── style-system.js            material patch + uniform sets per style
│       └── water.js                   flat water plane + per-style settings
├── shell/
│   ├── fly-controller.js              desktop + mobile free-fly input
│   ├── hud.js                         compass, altitude, FPS, style toggle
│   ├── settings.js                    style picker, localStorage
│   └── perf-probe.js                  detect weak GPU on first frames
├── docs/
│   └── superpowers/specs/2026-05-04-procedural-terrain-3d-design.md
└── tests/
    ├── noise.test.js                  determinism: same seed → same output
    ├── river-graph.test.js            graph reaches ocean from every peak
    ├── carve.test.js                  river bowl falloff math
    └── height.test.js                 known seeds produce expected ranges
```

## 8. Edge cases & error handling

- **Worker fails to load** (CDN block, COOP/COEP issues): fall back to main-thread chunk gen with a warning in console + an FPS-aware downscale to compensate. Game still playable.
- **WebGL2 not available:** detect at boot; if WebGL1, the `dFdx/dFdy` path needs the `OES_standard_derivatives` extension. If neither is available, force `style='stylized'` (smooth shading is a safe baseline) and disable the lowpoly toggle in the settings UI with a tooltip explaining why.
- **Camera teleport / large jump:** detect `cameraPos` jumping > 1 chunk in a single frame. Flush the entire chunk pool, mark all resident chunks for unload next frame, re-stream around the new position. (Important for the standalone's "respawn" / mobile app resume.)
- **Tab backgrounded / `visibilitychange`:** pause the worker queue, stop animation frame loop. Resume on focus. Fits platform `GAME_DEV_NOTES` battery guidance.
- **Resize:** standard renderer.setSize + camera.aspect update; no chunk impact.
- **Seed collision in `localStorage`:** scoped to `terrain.seed` key on the iframe origin; PlaySDK guarantees per-game isolation.
- **River reaches a basin with no outlet:** the trace stops; the basin becomes a lake. The water plane is still flat at Y=0, so lakes use a per-river-segment local water mesh at the basin's lake level (not Y=0). Stored on the river segment.
- **Pop-in:** masked by 200 ms opacity fade-in on chunk add; further smoothed by fog at the LOD2 boundary.
- **GPU memory growth on long sessions:** chunk pool is bounded (~80 buffers max); old buffers reused, not re-allocated. Verify with a 30-minute fly test.

## 9. Performance budget

Per-frame budget at 30 FPS mobile: 33 ms.

| Stage | Budget |
|---|---|
| Worker (off main thread) | up to 80 ms per chunk; doesn't block frames |
| Chunk receive (geometry build) | < 2 ms |
| Style update (per-frame uniform writes) | negligible |
| Render pass | 18–24 ms target |
| Camera + input + HUD | < 2 ms |
| Headroom | ≥ 5 ms |

GC discipline (per platform `GAME_DEV_NOTES`): pre-allocated typed arrays in the worker; pooled `BufferGeometry` and `InstancedMesh` instances on the main thread; no per-frame allocations in `update()`.

Mobile auto-downscale (perf probe over first 60 frames):
- < 25 FPS: drop to `viewDistance = 1500 m`, mobile LOD grid, tree density × 0.5, fog cutoff at LOD2.
- 25–45 FPS: mobile LOD grid, full tree density.
- > 45 FPS: desktop LOD grid.

## 10. Testing strategy

**Unit (Vitest, no DOM):**
- `noise.test.js` — same seed produces identical output across runs; output range is bounded.
- `river-graph.test.js` — for a fixed seed, every traced river either reaches the ocean (`y < 0`) or terminates at a documented basin. No infinite loops.
- `carve.test.js` — bowl falloff is monotonic and reaches zero at radius `width`.
- `height.test.js` — for fixed `(x, z, seed)` inputs, height matches expected fixtures.

**Integration (headless Three.js, optional):**
- ChunkManager: from a fake camera path, verify chunks stream in / out at expected ring boundaries; resident set never leaks.
- Style switch: setStyle does not trigger geometry rebuild (asserted via a spy on `BufferGeometry` constructor count).

**Visual (Puppeteer, per platform `GAME_DEV_NOTES`):**
- Take screenshots in all 3 styles at the same camera pose with a fixed seed; commit the screenshots as visual fixtures. Future PRs diff against them.
- Verify HUD doesn't overlap Style picker on mobile viewport (540×960).

**Manual smoke (must pass before declaring done):**
- Fly forward for 60 s on desktop and on a real phone (iPhone 13). FPS holds target.
- Toggle style mid-flight three times — no stutter, no missing chunks.
- Reload with same URL `?seed=` — exact same trees on the same hill.
- Fly to the world edge; ocean + fog read clearly, no visible "wall."

## 11. Success criteria

1. Standalone deploys to play.nitzan.games and shows a complete world within 2 s of load on desktop.
2. Free-fly works smoothly on mobile (touch) and desktop (mouse + WASD).
3. Visible mountains with snow caps, valleys, lakes connected by visible rivers, scattered conifer forests.
4. All 3 visual styles selectable at runtime; switching is instant.
5. 60 FPS on a mid-range desktop, 30 FPS on iPhone 13 / equivalent Android, throughout a 60 s fly test.
6. Seeded determinism: `?seed=hello` produces the same world for everyone, and trees are in the same place on revisit.
7. Module is importable by a sibling JSGame with no platform-specific assumptions: `createTerrain({ scene, renderer })` works in any Three.js scene.

## 12. Out of scope (not v1)

- Hydraulic erosion (deferred; B/river-graph is sufficient).
- Multiple tree species, undergrowth, rocks, grass clumps.
- Wind sway / vegetation animation.
- Day/night cycle.
- Weather (rain, snow particles, clouds).
- Animals or any moving entities.
- Saved screenshots / "share this world" feature.
- Plane physics / flight model.
- Floating origin (only needed past 64 km — out of v1 extent).
- WebGPU rendering path.

## 13. Risks

- **Style C (semi-realistic) on weak phones.** Mitigation: perf probe + auto-downgrade to mobile LOD grid + view distance cap. Document in settings if user manually re-enables C on a low-end device.
- **River graph traversal cost on huge seeds.** 256² grid → 65k cells; the D8 + accumulation pass is O(n log n) once. Stays under 100 ms even on a phone. If we ever bump grid resolution, profile first.
- **Worker not available in some sandboxed iframes.** Main-thread fallback exists; expect FPS hit. Test on play.nitzan.games sandbox flags before declaring done.
- **Visual style preview drift.** The brainstorming-time 3D mockups used a placeholder noise function; the final terrain may look slightly different. Take fresh per-style screenshots once the worker pipeline lands and compare to the mockups.

## 14. Dependencies

- Three.js (CDN, r128 — same version other JSGames use).
- PlaySDK (auto-injected at deploy time per platform convention).
- No build tooling. Vanilla ES modules.
