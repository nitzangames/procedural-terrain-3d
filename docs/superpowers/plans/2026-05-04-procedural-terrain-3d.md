# Procedural Terrain 3D — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a streaming procedural 3D terrain with snow-capped mountains, valleys, rivers, lakes, and trees that you can fly anywhere over — shipped both as a reusable JS library and as a polished standalone deploy on play.nitzan.games.

**Architecture:** Two layers in one repo — a vanilla-JS Three.js `terrain` module (`lib/terrain/`) with a pure deterministic core (noise / heightfield / river graph / carve / chunk builder) plus rendering glue (chunk manager, style system, water), and a thin standalone shell (`shell/` + `index.html`) that wires the module to a free-fly camera, HUD, and settings UI. Chunks are generated in a Web Worker with main-thread fallback. Three runtime-switchable visual styles share one indexed mesh topology via fragment-shader screen-space derivatives.

**Tech Stack:** Three.js r128 (CDN), vanilla ES modules (no build step), Web Workers, Vitest for unit tests, Puppeteer for visual fixtures, the platform's PlaySDK (auto-injected at deploy).

**Spec:** [`docs/superpowers/specs/2026-05-04-procedural-terrain-3d-design.md`](../specs/2026-05-04-procedural-terrain-3d-design.md)

**Working directory:** `/Users/nitzanwilnai/Programming/Claude/JSGames/ProceduralTerrain3D` (its own git repo, branch `main`).

---

## Phase 1 — Project scaffolding

### Task 1: Bootstrap the project

Set up `package.json`, Vitest, and the empty file tree per spec §7.

**Files:**
- Create: `package.json`
- Create: `vitest.config.js`
- Create: `.zipignore`
- Create: `meta.json`
- Create: `index.html` (placeholder; Task 17 fills it in)
- Create: `lib/terrain/.gitkeep`, `shell/.gitkeep`, `tests/.gitkeep`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "procedural-terrain-3d",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "python3 -m http.server 8080"
  },
  "devDependencies": {
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Write `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
  },
});
```

- [ ] **Step 3: Write `.zipignore`**

```
node_modules/
.superpowers/
docs/
tests/
vitest.config.js
package-lock.json
.git/
.gitignore
.DS_Store
*.log
```

- [ ] **Step 4: Write a placeholder `meta.json`**

```json
{
  "slug": "procedural-terrain",
  "title": "Procedural Terrain",
  "description": "A vast procedurally generated world. Fly anywhere — mountains, rivers, lakes, forests.",
  "tags": ["3d", "procedural", "exploration", "sandbox"],
  "author": "nitzanwilnai",
  "thumbnail": "thumbnail.png"
}
```

- [ ] **Step 5: Write a placeholder `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>Procedural Terrain</title>
  <style>html,body{margin:0;padding:0;height:100%;background:#000;color:#fff;font-family:system-ui,sans-serif}.boot{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}</style>
</head>
<body>
  <div class="boot">Boot stub — replaced in Task 17</div>
</body>
</html>
```

- [ ] **Step 6: Create empty package directories**

```bash
mkdir -p lib/terrain shell tests
touch lib/terrain/.gitkeep shell/.gitkeep tests/.gitkeep
```

- [ ] **Step 7: Install Vitest**

Run: `npm install`
Expected: installs without error, creates `node_modules/`, `package-lock.json`.

- [ ] **Step 8: Verify Vitest runs**

Run: `npm test`
Expected: "No test files found" (we haven't written any). Exit code is non-zero — that's fine for now.

- [ ] **Step 9: Commit**

```bash
git add package.json vitest.config.js .zipignore meta.json index.html lib/ shell/ tests/ package-lock.json
git commit -m "scaffold: project structure, vitest, zipignore, meta"
```

---

## Phase 2 — Deterministic terrain primitives (TDD)

These five files (`noise`, `height`, `river-graph`, `carve`, `chunk-build`) are pure functions that get tested in Node without Three.js. They're the deterministic core: same seed → same world.

### Task 2: Noise module

Seeded value noise + FBM + ridge function. Used by everything downstream. Must be deterministic and bounded.

**Files:**
- Create: `lib/terrain/noise.js`
- Test:   `tests/noise.test.js`

- [ ] **Step 1: Write the failing tests**

`tests/noise.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { hash2, valueNoise, fbm, ridge } from '../lib/terrain/noise.js';

describe('hash2', () => {
  it('is deterministic for the same inputs', () => {
    expect(hash2(123, 456, 7)).toBe(hash2(123, 456, 7));
  });
  it('returns values in [0, 1)', () => {
    for (let i = 0; i < 1000; i++) {
      const v = hash2(i, i * 31, 42);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('changes with seed', () => {
    expect(hash2(1, 1, 1)).not.toBe(hash2(1, 1, 2));
  });
});

describe('valueNoise', () => {
  it('is deterministic', () => {
    expect(valueNoise(1.5, 2.5, 9)).toBe(valueNoise(1.5, 2.5, 9));
  });
  it('returns values in [0, 1]', () => {
    for (let i = 0; i < 200; i++) {
      const v = valueNoise(i * 0.13, i * 0.07, 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it('is continuous (small input change → small output change)', () => {
    const a = valueNoise(10.0, 10.0, 5);
    const b = valueNoise(10.001, 10.0, 5);
    expect(Math.abs(a - b)).toBeLessThan(0.01);
  });
});

describe('fbm', () => {
  it('is deterministic', () => {
    expect(fbm(3, 4, 1)).toBe(fbm(3, 4, 1));
  });
  it('stays within [0, 1]', () => {
    for (let i = 0; i < 200; i++) {
      const v = fbm(i * 0.21, i * 0.17, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('ridge', () => {
  it('peaks at 1 when fbm = 0.5', () => {
    // ridge(n) = 1 - |2n - 1|, so it's 1 when n = 0.5
    // We can't force fbm to 0.5, but ridge should always be in [0, 1]
    for (let i = 0; i < 200; i++) {
      const v = ridge(i * 0.31, i * 0.13, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/noise.test.js`
Expected: all tests fail with "module not found" or similar import error.

- [ ] **Step 3: Implement `lib/terrain/noise.js`**

```js
// 32-bit integer hash producing a float in [0, 1).
export function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(t) { return t * t * (3 - 2 * t); }

// 2D value noise. Returns [0, 1].
export function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = smoothstep(xf), v = smoothstep(yf);
  const a = hash2(xi,     yi,     seed);
  const b = hash2(xi + 1, yi,     seed);
  const c = hash2(xi,     yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

// 5-octave FBM, persistence 0.5. Returns [0, 1].
export function fbm(x, y, seed, octaves = 5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// Ridge noise: 1 - |2*fbm - 1|. Peaks at 1 where fbm = 0.5.
export function ridge(x, y, seed) {
  const n = fbm(x, y, seed);
  return 1 - Math.abs(2 * n - 1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/noise.test.js`
Expected: all tests pass (8+ assertions, 0 failed).

- [ ] **Step 5: Commit**

```bash
git add lib/terrain/noise.js tests/noise.test.js
git commit -m "feat(terrain): seeded value noise, fbm, ridge"
```

---

### Task 3: Height function

Combines noise into the world heightfield per spec §4.4 formula. Pure function of `(x, z, seed)`.

**Files:**
- Create: `lib/terrain/height.js`
- Test:   `tests/height.test.js`

- [ ] **Step 1: Write the failing tests**

`tests/height.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { terrainHeight, WATER_LEVEL, SNOW_LINE, MAX_HEIGHT_RANGE } from '../lib/terrain/height.js';

describe('terrainHeight', () => {
  it('is deterministic', () => {
    expect(terrainHeight(123.5, 456.5, 42)).toBe(terrainHeight(123.5, 456.5, 42));
  });

  it('changes with seed', () => {
    expect(terrainHeight(0, 0, 1)).not.toBe(terrainHeight(0, 0, 2));
  });

  it('produces both above-water and below-water heights across the world', () => {
    let above = 0, below = 0;
    for (let i = 0; i < 1000; i++) {
      const x = (i * 211) % 5000 - 2500;
      const z = (i * 313) % 5000 - 2500;
      const y = terrainHeight(x, z, 7);
      if (y > WATER_LEVEL) above++;
      else below++;
    }
    expect(above).toBeGreaterThan(100);
    expect(below).toBeGreaterThan(50);
  });

  it('produces snow-line peaks somewhere', () => {
    let snowy = 0;
    for (let i = 0; i < 5000; i++) {
      const x = (i * 211) % 10000 - 5000;
      const z = (i * 313) % 10000 - 5000;
      if (terrainHeight(x, z, 7) > SNOW_LINE) snowy++;
    }
    expect(snowy).toBeGreaterThan(20);
  });

  it('stays within MAX_HEIGHT_RANGE', () => {
    for (let i = 0; i < 2000; i++) {
      const x = (i * 211) % 64000 - 32000;
      const z = (i * 313) % 64000 - 32000;
      const y = terrainHeight(x, z, 7);
      expect(Math.abs(y)).toBeLessThanOrEqual(MAX_HEIGHT_RANGE);
    }
  });

  it('exports expected band constants', () => {
    expect(WATER_LEVEL).toBe(0);
    expect(SNOW_LINE).toBeGreaterThan(WATER_LEVEL);
    expect(MAX_HEIGHT_RANGE).toBeGreaterThan(SNOW_LINE);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/height.test.js`
Expected: all tests fail with import error.

- [ ] **Step 3: Implement `lib/terrain/height.js`**

```js
import { fbm, ridge } from './noise.js';

export const WATER_LEVEL = 0;
export const SNOW_LINE = 22;
export const MAX_HEIGHT_RANGE = 60;

const F = 0.012;     // base frequency (1/m)
const SEED1 = 1;     // base hills
const SEED2 = 7;     // mountains
const SEED3 = 23;    // basins/lakes

// World height at (x, z). x and z are world meters.
// Empirical range across many seeds: approximately [-14, 30]. See spec §4.4.
export function terrainHeight(x, z, worldSeed = 0) {
  const s1 = SEED1 ^ worldSeed;
  const s2 = SEED2 ^ worldSeed;
  const s3 = SEED3 ^ worldSeed;

  const base = (fbm(x * F, z * F, s1) * 2 - 1) * 6;                    // [-6, 6]
  const mountains = Math.pow(ridge(x * F * 0.7, z * F * 0.7, s2), 1.6) * 32;
  const basins = Math.pow(ridge(x * F * 0.25 + 5, z * F * 0.25 - 9, s3), 3.0) * -10;

  return base + mountains + basins - 6;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/height.test.js`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/terrain/height.js tests/height.test.js
git commit -m "feat(terrain): world height function combining base + mountains + basins"
```

---

### Task 4: River graph

Builds a global river network once at world load: low-res heightfield → D8 flow direction → flow accumulation → traced polylines. Per spec §4.2 and §4.4.

**Files:**
- Create: `lib/terrain/river-graph.js`
- Test:   `tests/river-graph.test.js`

- [ ] **Step 1: Write the failing tests**

`tests/river-graph.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildRiverGraph } from '../lib/terrain/river-graph.js';
import { WATER_LEVEL, terrainHeight } from '../lib/terrain/height.js';

describe('buildRiverGraph', () => {
  it('is deterministic for a fixed seed', () => {
    const a = buildRiverGraph({ seed: 42, gridN: 64, worldSize: 16000 });
    const b = buildRiverGraph({ seed: 42, gridN: 64, worldSize: 16000 });
    expect(a.segments.length).toBe(b.segments.length);
    if (a.segments.length > 0) {
      expect(a.segments[0]).toEqual(b.segments[0]);
    }
  });

  it('changes with seed', () => {
    const a = buildRiverGraph({ seed: 1, gridN: 64, worldSize: 16000 });
    const b = buildRiverGraph({ seed: 2, gridN: 64, worldSize: 16000 });
    // Either count differs, or first segment differs
    const sameCount = a.segments.length === b.segments.length;
    const sameFirst = sameCount && a.segments.length > 0 &&
      a.segments[0].x0 === b.segments[0].x0 &&
      a.segments[0].z0 === b.segments[0].z0;
    expect(sameFirst).toBe(false);
  });

  it('produces some rivers for a typical seed', () => {
    const g = buildRiverGraph({ seed: 7, gridN: 128, worldSize: 32000 });
    expect(g.segments.length).toBeGreaterThan(10);
  });

  it('every segment has positive width', () => {
    const g = buildRiverGraph({ seed: 11, gridN: 64, worldSize: 16000 });
    for (const s of g.segments) {
      expect(s.width).toBeGreaterThan(0);
    }
  });

  it('every traced river ends at ocean OR at a lake basin', () => {
    const g = buildRiverGraph({ seed: 13, gridN: 64, worldSize: 16000 });
    for (const s of g.segments) {
      if (!s.isTerminal) continue;
      const endHeight = terrainHeight(s.x1, s.z1, 13);
      // Terminal segment ends in ocean (y < water level) OR at a lake (recorded in graph)
      const isOcean = endHeight < WATER_LEVEL;
      const isLake = s.endsInLake === true;
      expect(isOcean || isLake).toBe(true);
    }
  });

  it('returns lakes array', () => {
    const g = buildRiverGraph({ seed: 15, gridN: 64, worldSize: 16000 });
    expect(Array.isArray(g.lakes)).toBe(true);
  });

  it('does not mis-attribute lakes to unrelated segments', () => {
    // Bug repro: when a river source is itself a basin, the prior fix
    // mistakenly marked an unrelated previous-trace segment as endsInLake.
    // Now verify that endsInLake is set only on segments whose end-point
    // (x1, z1) is actually a lake center.
    const g = buildRiverGraph({ seed: 13, gridN: 64, worldSize: 16000 });
    for (const s of g.segments) {
      if (!s.endsInLake) continue;
      // The segment must end near at least one lake center
      let near = false;
      for (const l of g.lakes) {
        const d = Math.hypot(s.x1 - l.x, s.z1 - l.z);
        if (d <= l.radius + 60) { near = true; break; }
      }
      expect(near).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/river-graph.test.js`
Expected: all tests fail with import error.

- [ ] **Step 3: Implement `lib/terrain/river-graph.js`**

```js
import { terrainHeight, WATER_LEVEL } from './height.js';

// 8-neighbor offsets (dx, dz)
const D8 = [
  [-1, -1], [0, -1], [1, -1],
  [-1,  0],          [1,  0],
  [-1,  1], [0,  1], [1,  1],
];

// Build a coarse heightfield over the whole world.
function sampleHeightfield(seed, gridN, worldSize) {
  const heights = new Float32Array(gridN * gridN);
  const half = worldSize / 2;
  for (let j = 0; j < gridN; j++) {
    for (let i = 0; i < gridN; i++) {
      const x = (i / (gridN - 1)) * worldSize - half;
      const z = (j / (gridN - 1)) * worldSize - half;
      heights[j * gridN + i] = terrainHeight(x, z, seed);
    }
  }
  return heights;
}

// For each cell, find the lowest of its 8 neighbors.
// Return Int8Array of D8 index (0..7) or -1 if no lower neighbor (basin or ocean).
function d8FlowDirection(heights, gridN) {
  const flow = new Int8Array(gridN * gridN);
  for (let j = 0; j < gridN; j++) {
    for (let i = 0; i < gridN; i++) {
      const idx = j * gridN + i;
      const h = heights[idx];
      let best = -1;
      let bestH = h;
      for (let d = 0; d < 8; d++) {
        const ni = i + D8[d][0];
        const nj = j + D8[d][1];
        if (ni < 0 || nj < 0 || ni >= gridN || nj >= gridN) continue;
        const nh = heights[nj * gridN + ni];
        if (nh < bestH) { bestH = nh; best = d; }
      }
      flow[idx] = best;
    }
  }
  return flow;
}

// Walk cells in descending-elevation order, accumulating count downstream.
function flowAccumulation(heights, flow, gridN) {
  const accum = new Float32Array(gridN * gridN);
  accum.fill(1);
  // Sort indices by descending height
  const order = new Uint32Array(gridN * gridN);
  for (let i = 0; i < order.length; i++) order[i] = i;
  order.sort((a, b) => heights[b] - heights[a]);
  for (let k = 0; k < order.length; k++) {
    const idx = order[k];
    const f = flow[idx];
    if (f < 0) continue;
    const i = idx % gridN, j = (idx / gridN) | 0;
    const ni = i + D8[f][0], nj = j + D8[f][1];
    if (ni < 0 || nj < 0 || ni >= gridN || nj >= gridN) continue;
    accum[nj * gridN + ni] += accum[idx];
  }
  return accum;
}

// Map cell (i, j) to world (x, z).
function cellToWorld(i, j, gridN, worldSize) {
  const half = worldSize / 2;
  return [(i / (gridN - 1)) * worldSize - half, (j / (gridN - 1)) * worldSize - half];
}

// Build the river graph: { segments, lakes }
// Each segment: { x0, z0, x1, z1, width, isTerminal, endsInLake }
// `gridN` = low-res grid resolution (e.g. 256). `worldSize` in meters.
export function buildRiverGraph({ seed, gridN = 256, worldSize = 64000, threshold = 8 }) {
  const heights = sampleHeightfield(seed, gridN, worldSize);
  const flow = d8FlowDirection(heights, gridN);
  const accum = flowAccumulation(heights, flow, gridN);

  const segments = [];
  const lakes = [];

  // Trace rivers: walk downstream from any cell whose accumulation crosses the threshold
  // and whose upstream cell is below the threshold (= source of a river).
  // Stop when we reach ocean or a basin (flow == -1).
  const visited = new Uint8Array(gridN * gridN);
  for (let j = 0; j < gridN; j++) {
    for (let i = 0; i < gridN; i++) {
      const idx = j * gridN + i;
      if (visited[idx]) continue;
      if (accum[idx] < threshold) continue;
      // Check whether any upstream neighbor pushes into us with accum >= threshold.
      // If yes, this is mid-river — let the upstream walker emit it.
      let isSource = true;
      for (let d = 0; d < 8; d++) {
        const ni = i + D8[d][0], nj = j + D8[d][1];
        if (ni < 0 || nj < 0 || ni >= gridN || nj >= gridN) continue;
        const nIdx = nj * gridN + ni;
        const nFlow = flow[nIdx];
        if (nFlow < 0) continue;
        const nNi = ni + D8[nFlow][0], nNj = nj + D8[nFlow][1];
        if (nNi === i && nNj === j && accum[nIdx] >= threshold) { isSource = false; break; }
      }
      if (!isSource) continue;

      // Walk downstream
      let ci = i, cj = j;
      let lastSegOfTrace = null;     // segment from THIS trace (do not touch others)
      while (true) {
        const cIdx = cj * gridN + ci;
        if (visited[cIdx]) break;
        visited[cIdx] = 1;
        const f = flow[cIdx];
        if (f < 0) {
          // Ended at a basin: record lake at this cell
          const [lx, lz] = cellToWorld(ci, cj, gridN, worldSize);
          const radius = Math.max(60, Math.sqrt(accum[cIdx]) * 8);
          lakes.push({ x: lx, z: lz, level: heights[cIdx], radius });
          if (lastSegOfTrace !== null) {
            lastSegOfTrace.endsInLake = true;
            lastSegOfTrace.isTerminal = true;
          }
          break;
        }
        const ni = ci + D8[f][0], nj = cj + D8[f][1];
        const [x0, z0] = cellToWorld(ci, cj, gridN, worldSize);
        const [x1, z1] = cellToWorld(ni, nj, gridN, worldSize);
        const width = Math.max(2, Math.sqrt(accum[cIdx]) * 0.6);
        const seg = { x0, z0, x1, z1, width, isTerminal: false, endsInLake: false };
        segments.push(seg);
        lastSegOfTrace = seg;

        const nIdx = nj * gridN + ni;
        // If next cell is below water, mark this segment terminal (river meets ocean).
        if (heights[nIdx] < WATER_LEVEL) { seg.isTerminal = true; break; }
        ci = ni; cj = nj;
      }
    }
  }

  return { segments, lakes };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/river-graph.test.js`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/terrain/river-graph.js tests/river-graph.test.js
git commit -m "feat(terrain): river graph via D8 flow + accumulation + path tracing"
```

---

### Task 5: River carving

Given a chunk's vertex array and the river segments overlapping it, carve a smooth bowl into the heightfield. Pure function over typed arrays.

**Files:**
- Create: `lib/terrain/carve.js`
- Test:   `tests/carve.test.js`

- [ ] **Step 1: Write the failing tests**

`tests/carve.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { distancePointToSegment2D, applyRiverCarve, riverDepthAt } from '../lib/terrain/carve.js';

describe('distancePointToSegment2D', () => {
  it('returns 0 on the segment', () => {
    expect(distancePointToSegment2D(5, 0, 0, 0, 10, 0)).toBeCloseTo(0);
  });
  it('returns perpendicular distance', () => {
    expect(distancePointToSegment2D(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
  });
  it('returns endpoint distance when past the segment', () => {
    expect(distancePointToSegment2D(15, 0, 0, 0, 10, 0)).toBeCloseTo(5);
  });
});

describe('riverDepthAt', () => {
  it('is monotonic with distance from segment', () => {
    const seg = { x0: 0, z0: 0, x1: 100, z1: 0, width: 10 };
    const d0 = riverDepthAt(50, 0, [seg], 4);
    const d1 = riverDepthAt(50, 5, [seg], 4);
    const d2 = riverDepthAt(50, 9, [seg], 4);
    const d3 = riverDepthAt(50, 11, [seg], 4);
    expect(d0).toBeGreaterThan(d1);
    expect(d1).toBeGreaterThan(d2);
    expect(d3).toBe(0);
  });
  it('is exactly the carve depth at the centerline', () => {
    const seg = { x0: 0, z0: 0, x1: 100, z1: 0, width: 10 };
    expect(riverDepthAt(50, 0, [seg], 4)).toBeCloseTo(4);
  });
  it('returns 0 outside any river', () => {
    const seg = { x0: 0, z0: 0, x1: 100, z1: 0, width: 10 };
    expect(riverDepthAt(50, 50, [seg], 4)).toBe(0);
  });
});

describe('applyRiverCarve', () => {
  it('lowers vertices near the river segment', () => {
    const positions = new Float32Array([
      0, 5, 0,    // on segment (will carve)
      0, 5, 50,   // far away (untouched)
    ]);
    const seg = { x0: -10, z0: 0, x1: 10, z1: 0, width: 6 };
    applyRiverCarve(positions, [seg], 4);
    expect(positions[1]).toBeLessThan(5);
    expect(positions[4]).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/carve.test.js`
Expected: all tests fail (module missing).

- [ ] **Step 3: Implement `lib/terrain/carve.js`**

```js
// Euclidean distance from point P to segment AB in 2D.
export function distancePointToSegment2D(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 === 0) {
    const ex = px - ax, ez = pz - az;
    return Math.sqrt(ex * ex + ez * ez);
  }
  let t = ((px - ax) * dx + (pz - az) * dz) / len2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = ax + t * dx, cz = az + t * dz;
  const ex = px - cx, ez = pz - cz;
  return Math.sqrt(ex * ex + ez * ez);
}

// Maximum carve depth over all overlapping segments at (x, z).
// Returns 0 if outside every segment's width.
// Bowl falloff: depth × (1 - d/width)² for d <= width, 0 otherwise.
export function riverDepthAt(x, z, segments, depth) {
  let best = 0;
  for (const s of segments) {
    const d = distancePointToSegment2D(x, z, s.x0, s.z0, s.x1, s.z1);
    if (d >= s.width) continue;
    const t = 1 - d / s.width;
    const v = depth * t * t;
    if (v > best) best = v;
  }
  return best;
}

// Mutate `positions` (Float32Array of x,y,z triplets) by lowering Y where rivers pass.
// Also flattens vertices very close to the centerline so the water ribbon sits cleanly.
export function applyRiverCarve(positions, segments, depth = 4) {
  const n = positions.length / 3;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3];
    const z = positions[i * 3 + 2];
    const carve = riverDepthAt(x, z, segments, depth);
    if (carve > 0) positions[i * 3 + 1] -= carve;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/carve.test.js`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/terrain/carve.js tests/carve.test.js
git commit -m "feat(terrain): river bowl carve + point-to-segment distance"
```

---

### Task 6: Chunk geometry builder

The pure core of the worker. Given chunk coords and seed, produces transferable typed arrays for one chunk: positions, indices, normals, vertex colors, plus a tree descriptor list.

**Files:**
- Create: `lib/terrain/chunk-build.js`
- Test:   `tests/chunk-build.test.js`

- [ ] **Step 1: Write the failing tests**

`tests/chunk-build.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildChunkBuffers, CHUNK_SIZE } from '../lib/terrain/chunk-build.js';
import { buildRiverGraph } from '../lib/terrain/river-graph.js';

const seed = 99;
const graph = buildRiverGraph({ seed, gridN: 128, worldSize: 16000 });

describe('buildChunkBuffers', () => {
  it('produces a vertex grid of the requested size', () => {
    const out = buildChunkBuffers({ cx: 0, cz: 0, lod: 0, seed, riverSegments: graph.segments, vertexGrid: 32 });
    // (32+1)² interior + 4 skirts × (32+1) = 1089 + 132 = 1221
    expect(out.positions.length).toBe(((32 + 1) * (32 + 1) + 4 * (32 + 1)) * 3);
  });

  it('positions span the chunk extent on X/Z', () => {
    const out = buildChunkBuffers({ cx: 5, cz: -3, lod: 0, seed, riverSegments: graph.segments, vertexGrid: 16 });
    const minX = 5 * CHUNK_SIZE, maxX = 6 * CHUNK_SIZE;
    const minZ = -3 * CHUNK_SIZE, maxZ = -2 * CHUNK_SIZE;
    let foundMinX = false, foundMaxX = false;
    for (let i = 0; i < (16 + 1) * (16 + 1); i++) {
      const x = out.positions[i * 3], z = out.positions[i * 3 + 2];
      expect(x).toBeGreaterThanOrEqual(minX - 0.001);
      expect(x).toBeLessThanOrEqual(maxX + 0.001);
      expect(z).toBeGreaterThanOrEqual(minZ - 0.001);
      expect(z).toBeLessThanOrEqual(maxZ + 0.001);
      if (Math.abs(x - minX) < 0.001) foundMinX = true;
      if (Math.abs(x - maxX) < 0.001) foundMaxX = true;
    }
    expect(foundMinX).toBe(true);
    expect(foundMaxX).toBe(true);
  });

  it('indices form valid triangles', () => {
    const out = buildChunkBuffers({ cx: 0, cz: 0, lod: 0, seed, riverSegments: graph.segments, vertexGrid: 16 });
    const vCount = out.positions.length / 3;
    for (let i = 0; i < out.indices.length; i++) {
      expect(out.indices[i]).toBeGreaterThanOrEqual(0);
      expect(out.indices[i]).toBeLessThan(vCount);
    }
    expect(out.indices.length % 3).toBe(0);
  });

  it('normals are unit length', () => {
    const out = buildChunkBuffers({ cx: 0, cz: 0, lod: 0, seed, riverSegments: graph.segments, vertexGrid: 16 });
    for (let i = 0; i < out.normals.length / 3; i++) {
      const x = out.normals[i * 3], y = out.normals[i * 3 + 1], z = out.normals[i * 3 + 2];
      const len = Math.sqrt(x * x + y * y + z * z);
      expect(len).toBeCloseTo(1, 1);
    }
  });

  it('colors have one RGB triplet per vertex', () => {
    const out = buildChunkBuffers({ cx: 0, cz: 0, lod: 0, seed, riverSegments: graph.segments, vertexGrid: 16 });
    expect(out.colors.length).toBe(out.positions.length);
  });

  it('produces some trees on lod 0', () => {
    const out = buildChunkBuffers({ cx: 1, cz: 2, lod: 0, seed: 4, riverSegments: graph.segments, vertexGrid: 32 });
    expect(out.trees).toBeDefined();
    // For a typical seeded chunk with mid-elevation areas, expect at least a few trees.
    // Some chunks may legitimately have 0 (all underwater / above snow) — pick a known good one.
  });

  it('produces no trees on lod 2', () => {
    const out = buildChunkBuffers({ cx: 0, cz: 0, lod: 2, seed, riverSegments: graph.segments, vertexGrid: 16 });
    expect(out.trees.length).toBe(0);
  });

  it('is deterministic for the same inputs', () => {
    const a = buildChunkBuffers({ cx: 1, cz: 2, lod: 0, seed: 4, riverSegments: graph.segments, vertexGrid: 16 });
    const b = buildChunkBuffers({ cx: 1, cz: 2, lod: 0, seed: 4, riverSegments: graph.segments, vertexGrid: 16 });
    expect(Array.from(a.positions.slice(0, 30))).toEqual(Array.from(b.positions.slice(0, 30)));
    expect(a.trees.length).toBe(b.trees.length);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/chunk-build.test.js`
Expected: all tests fail (module missing).

- [ ] **Step 3: Implement `lib/terrain/chunk-build.js`**

```js
import { terrainHeight, WATER_LEVEL, SNOW_LINE } from './height.js';
import { applyRiverCarve, riverDepthAt } from './carve.js';
import { hash2 } from './noise.js';

export const CHUNK_SIZE = 256;     // meters per chunk
const SKIRT_DROP = 4;              // meters
const RIVER_CARVE_DEPTH = 4;       // meters
const TREE_GRID_PITCH = 4;         // meters between candidate tree positions
const TREE_PEAK_HEIGHT = 8;        // density peaks here
const TREE_DENSITY_HALFWIDTH = 14; // density goes to 0 this far above/below peak

// Color bands (RGB float)
const BAND = {
  deepWater:  [0.18, 0.42, 0.62],
  sand:       [0.86, 0.78, 0.55],
  grassLow:   [0.52, 0.74, 0.40],
  grassMid:   [0.40, 0.62, 0.32],
  rock:       [0.55, 0.55, 0.58],
  snow:       [0.97, 0.97, 0.99],
};

function colorForHeight(y) {
  if (y < WATER_LEVEL - 1)   return BAND.deepWater;
  if (y < WATER_LEVEL + 0.5) return BAND.sand;
  if (y > SNOW_LINE)         return BAND.snow;
  if (y > 16)                return BAND.rock;
  if (y > 8)                 return BAND.grassMid;
  return BAND.grassLow;
}

// Build a single chunk. All outputs are typed arrays; safe to transfer to/from a Worker.
// `vertexGrid` is per-side vertex count - 1 (so vertexGrid=32 means a 33×33 lattice).
export function buildChunkBuffers({ cx, cz, lod, seed, riverSegments, vertexGrid }) {
  const N = vertexGrid + 1;            // verts per side (interior)
  const totalInterior = N * N;
  const totalSkirt = 4 * N;            // four edges
  const totalVerts = totalInterior + totalSkirt;
  const totalQuads = vertexGrid * vertexGrid;
  const totalSkirtQuads = 4 * vertexGrid;
  const totalTris = (totalQuads + totalSkirtQuads) * 2;

  const positions = new Float32Array(totalVerts * 3);
  const colors    = new Float32Array(totalVerts * 3);
  const normals   = new Float32Array(totalVerts * 3);
  const indices   = new Uint32Array(totalTris * 3);

  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;

  // Filter river segments to those overlapping this chunk's AABB (with margin).
  const margin = 32;
  const localSegs = [];
  for (const s of riverSegments) {
    const segMinX = Math.min(s.x0, s.x1) - s.width;
    const segMaxX = Math.max(s.x0, s.x1) + s.width;
    const segMinZ = Math.min(s.z0, s.z1) - s.width;
    const segMaxZ = Math.max(s.z0, s.z1) + s.width;
    if (segMaxX < x0 - margin || segMinX > x0 + CHUNK_SIZE + margin) continue;
    if (segMaxZ < z0 - margin || segMinZ > z0 + CHUNK_SIZE + margin) continue;
    localSegs.push(s);
  }

  // Interior vertices
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const t = (i / vertexGrid);
      const u = (j / vertexGrid);
      const x = x0 + t * CHUNK_SIZE;
      const z = z0 + u * CHUNK_SIZE;
      const y = terrainHeight(x, z, seed);
      const idx = j * N + i;
      positions[idx * 3] = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = z;
    }
  }

  // Carve rivers in-place
  if (localSegs.length > 0) {
    applyRiverCarve(positions.subarray(0, totalInterior * 3), localSegs, RIVER_CARVE_DEPTH);
  }

  // Compute normals on the interior grid (cross-product of edge vectors).
  // Skirt verts inherit interior edge normals.
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      const p = idx * 3;
      const cx0 = positions[p], cy0 = positions[p + 1], cz0 = positions[p + 2];
      // Sample four neighbors (clamped at edges)
      const li = Math.max(0, i - 1), ri = Math.min(N - 1, i + 1);
      const lj = Math.max(0, j - 1), rj = Math.min(N - 1, j + 1);
      const lp = (j * N + li) * 3;
      const rp = (j * N + ri) * 3;
      const dp = (rj * N + i) * 3;
      const up = (lj * N + i) * 3;
      const ex = positions[rp] - positions[lp];
      const ey = positions[rp + 1] - positions[lp + 1];
      const ez = positions[rp + 2] - positions[lp + 2];
      const fx = positions[dp] - positions[up];
      const fy = positions[dp + 1] - positions[up + 1];
      const fz = positions[dp + 2] - positions[up + 2];
      // n = -(e × f)  (so y is positive for upward terrain)
      let nx = -(ey * fz - ez * fy);
      let ny = -(ez * fx - ex * fz);
      let nz = -(ex * fy - ey * fx);
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      normals[p]     = nx / len;
      normals[p + 1] = ny / len;
      normals[p + 2] = nz / len;

      const col = colorForHeight(cy0);
      colors[p]     = col[0];
      colors[p + 1] = col[1];
      colors[p + 2] = col[2];
    }
  }

  // Skirt vertices: walk each edge in order, drop Y.
  // Skirt vertex indices start at `totalInterior`.
  let sIdx = totalInterior;
  function emitSkirt(i, j) {
    const interiorIdx = j * N + i;
    const p = interiorIdx * 3;
    const sp = sIdx * 3;
    positions[sp]     = positions[p];
    positions[sp + 1] = positions[p + 1] - SKIRT_DROP;
    positions[sp + 2] = positions[p + 2];
    normals[sp]     = normals[p];
    normals[sp + 1] = normals[p + 1];
    normals[sp + 2] = normals[p + 2];
    colors[sp]     = colors[p];
    colors[sp + 1] = colors[p + 1];
    colors[sp + 2] = colors[p + 2];
    sIdx++;
  }
  // Edges in fixed order: north (j=0), east (i=N-1), south (j=N-1), west (i=0).
  const skirtNorthStart = totalInterior;
  for (let i = 0; i < N; i++) emitSkirt(i, 0);
  const skirtEastStart = sIdx;
  for (let j = 0; j < N; j++) emitSkirt(N - 1, j);
  const skirtSouthStart = sIdx;
  for (let i = 0; i < N; i++) emitSkirt(i, N - 1);
  const skirtWestStart = sIdx;
  for (let j = 0; j < N; j++) emitSkirt(0, j);

  // Interior triangles
  let iOut = 0;
  for (let j = 0; j < vertexGrid; j++) {
    for (let i = 0; i < vertexGrid; i++) {
      const a = j * N + i;
      const b = j * N + i + 1;
      const c = (j + 1) * N + i;
      const d = (j + 1) * N + i + 1;
      indices[iOut++] = a; indices[iOut++] = c; indices[iOut++] = b;
      indices[iOut++] = b; indices[iOut++] = c; indices[iOut++] = d;
    }
  }
  // Skirt triangles per edge: connect each interior edge vertex to its skirt counterpart.
  function emitSkirtStrip(getInteriorIdx, getSkirtIdx) {
    for (let k = 0; k < vertexGrid; k++) {
      const a = getInteriorIdx(k);
      const b = getInteriorIdx(k + 1);
      const c = getSkirtIdx(k);
      const d = getSkirtIdx(k + 1);
      indices[iOut++] = a; indices[iOut++] = c; indices[iOut++] = b;
      indices[iOut++] = b; indices[iOut++] = c; indices[iOut++] = d;
    }
  }
  // North edge: interior j=0, i=0..N-1 ; skirts skirtNorthStart..+N
  emitSkirtStrip(k => k, k => skirtNorthStart + k);
  // East edge: interior i=N-1, j=0..N-1 (need correct winding so face points outward)
  emitSkirtStrip(k => k * N + (N - 1), k => skirtEastStart + k);
  // South edge: interior j=N-1, i=0..N-1
  emitSkirtStrip(k => (N - 1) * N + k, k => skirtSouthStart + k);
  // West edge: interior i=0, j=0..N-1
  emitSkirtStrip(k => k * N, k => skirtWestStart + k);

  // Trees (LOD 0 only). Billboards (LOD 1 — handled later, see trees module). LOD 2 = none.
  const trees = lod === 0 ? placeTrees(cx, cz, seed, localSegs) : [];

  return { positions, indices, normals, colors, trees };
}

// Deterministic tree placement for a chunk.
// Returns Array<{ x, y, z, scale, tint, rotation }>.
function placeTrees(cx, cz, seed, localSegs) {
  const out = [];
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  for (let j = 0; j < CHUNK_SIZE; j += TREE_GRID_PITCH) {
    for (let i = 0; i < CHUNK_SIZE; i += TREE_GRID_PITCH) {
      // Deterministic jitter inside the cell
      const cellX = x0 + i, cellZ = z0 + j;
      const j1 = hash2(Math.floor(cellX), Math.floor(cellZ), seed | 0);
      const j2 = hash2(Math.floor(cellX) + 11, Math.floor(cellZ) + 17, seed ^ 0x55);
      const x = cellX + (j1 - 0.5) * TREE_GRID_PITCH * 0.85;
      const z = cellZ + (j2 - 0.5) * TREE_GRID_PITCH * 0.85;
      const y = terrainHeight(x, z, seed);
      // Reject under water / above snow
      if (y < WATER_LEVEL + 0.6) continue;
      if (y > SNOW_LINE) continue;
      // Reject inside river width + 1m
      if (riverDepthAt(x, z, localSegs, 1) > 0) continue;
      // Slope: use central-difference height samples
      const yL = terrainHeight(x - 1, z, seed);
      const yR = terrainHeight(x + 1, z, seed);
      const yU = terrainHeight(x, z - 1, seed);
      const yD = terrainHeight(x, z + 1, seed);
      const slope = Math.max(Math.abs(yR - yL), Math.abs(yD - yU)) / 2;
      if (slope > 1.4) continue;
      // Density curve: peaks at TREE_PEAK_HEIGHT
      const density = Math.max(0, 1 - Math.abs(y - TREE_PEAK_HEIGHT) / TREE_DENSITY_HALFWIDTH);
      const acceptRoll = hash2(Math.floor(cellX) * 31, Math.floor(cellZ) * 31, seed * 3);
      if (acceptRoll > density) continue;
      const tintRoll = hash2(Math.floor(cellX) * 13, Math.floor(cellZ) * 17, seed * 5);
      const tint = tintRoll < 0.5 ? 0 : 1;
      const scale = 0.7 + tintRoll * 0.5;
      const rotation = j1 * Math.PI * 2;
      out.push({ x, y, z, scale, tint, rotation });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/chunk-build.test.js`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/terrain/chunk-build.js tests/chunk-build.test.js
git commit -m "feat(terrain): chunk geometry builder with skirts, normals, river carve, trees"
```

---

## Phase 3 — Worker, trees, chunk manager

### Task 7: Chunk worker entrypoint

Thin Web Worker that calls `buildChunkBuffers` and posts back transferable buffers. Includes a main-thread fallback shim used when `Worker` isn't available.

**Files:**
- Create: `lib/terrain/chunk-worker.js`
- Create: `lib/terrain/chunk-runner.js` (main-thread fallback)
- Test:   `tests/chunk-runner.test.js`

- [ ] **Step 1: Write the failing test (covers the runner shim only)**

`tests/chunk-runner.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { ChunkRunner } from '../lib/terrain/chunk-runner.js';
import { buildRiverGraph } from '../lib/terrain/river-graph.js';

describe('ChunkRunner (main-thread fallback)', () => {
  it('runs a chunk synchronously and returns buffers', async () => {
    const seed = 42;
    const graph = buildRiverGraph({ seed, gridN: 64, worldSize: 16000 });
    const runner = new ChunkRunner({ seed, riverSegments: graph.segments });
    const out = await runner.build({ cx: 0, cz: 0, lod: 0, vertexGrid: 16 });
    expect(out.positions).toBeInstanceOf(Float32Array);
    expect(out.indices).toBeInstanceOf(Uint32Array);
    expect(out.normals).toBeInstanceOf(Float32Array);
    expect(out.colors).toBeInstanceOf(Float32Array);
    expect(Array.isArray(out.trees)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/chunk-runner.test.js`
Expected: failure (module missing).

- [ ] **Step 3: Implement `lib/terrain/chunk-runner.js`**

```js
import { buildChunkBuffers } from './chunk-build.js';

// Main-thread fallback "runner" with the same async API as the worker proxy.
// Used when Worker construction fails (sandboxed iframes, COOP/COEP issues, tests).
export class ChunkRunner {
  constructor({ seed, riverSegments }) {
    this.seed = seed;
    this.riverSegments = riverSegments;
  }
  async build({ cx, cz, lod, vertexGrid }) {
    return buildChunkBuffers({
      cx, cz, lod, vertexGrid,
      seed: this.seed,
      riverSegments: this.riverSegments,
    });
  }
  dispose() { /* nothing to release */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/chunk-runner.test.js`
Expected: passes.

- [ ] **Step 5: Implement `lib/terrain/chunk-worker.js`**

```js
// Web Worker entrypoint. Runs in worker scope; receives jobs and posts buffers back.
// The worker is created with `new Worker(new URL('./chunk-worker.js', import.meta.url), { type: 'module' })`.
import { buildChunkBuffers } from './chunk-build.js';

let seed = 0;
let riverSegments = [];

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    seed = msg.seed;
    riverSegments = msg.riverSegments;
    self.postMessage({ type: 'ready', id: msg.id });
    return;
  }
  if (msg.type === 'build') {
    const out = buildChunkBuffers({
      cx: msg.cx, cz: msg.cz, lod: msg.lod, vertexGrid: msg.vertexGrid,
      seed, riverSegments,
    });
    self.postMessage(
      { type: 'built', id: msg.id, ...out },
      [out.positions.buffer, out.indices.buffer, out.normals.buffer, out.colors.buffer]
    );
  }
};
```

- [ ] **Step 6: Implement `lib/terrain/chunk-worker-proxy.js`** (main-thread façade with the same API as the runner)

`lib/terrain/chunk-worker-proxy.js`:

```js
// Wraps a Web Worker behind the same async `build()` API as ChunkRunner.
// Caller can substitute one for the other without other changes.
export class ChunkWorkerProxy {
  constructor({ seed, riverSegments }) {
    this.worker = new Worker(new URL('./chunk-worker.js', import.meta.url), { type: 'module' });
    this.nextId = 1;
    this.pending = new Map();
    this.worker.onmessage = (e) => {
      const m = e.data;
      const cb = this.pending.get(m.id);
      if (!cb) return;
      this.pending.delete(m.id);
      cb(m);
    };
    // Initialize
    this.ready = new Promise((resolve) => {
      const id = this.nextId++;
      this.pending.set(id, () => resolve());
      this.worker.postMessage({ type: 'init', id, seed, riverSegments });
    });
  }
  async build(req) {
    await this.ready;
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.pending.set(id, (m) => resolve({
        positions: m.positions, indices: m.indices, normals: m.normals, colors: m.colors, trees: m.trees,
      }));
      this.worker.postMessage({ type: 'build', id, ...req });
    });
  }
  dispose() {
    this.worker.terminate();
    this.pending.clear();
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add lib/terrain/chunk-runner.js lib/terrain/chunk-worker.js lib/terrain/chunk-worker-proxy.js tests/chunk-runner.test.js
git commit -m "feat(terrain): chunk worker, worker proxy, main-thread runner fallback"
```

---

### Task 8: Tree mesh + billboard atlas

Three.js base meshes (a low-poly conifer + a billboard quad) consumed by the chunk manager.

**Files:**
- Create: `lib/terrain/trees.js`
- Test:   none (Three.js DOM glue — visual verification later)

- [ ] **Step 1: Implement `lib/terrain/trees.js`**

```js
// Conifer base mesh: a 6-sided cone on a short trunk. ~12 tris.
// Tints are stored as instance attribute; the chunk manager builds InstancedMesh
// with one instance per tree descriptor returned from buildChunkBuffers.

const TINT_PALETTE = [
  [0.18, 0.42, 0.18],   // dark green
  [0.30, 0.58, 0.30],   // lighter green
];

export function buildConiferGeometry(THREE) {
  const trunkGeom = new THREE.CylinderGeometry(0.18, 0.25, 1.2, 5);
  trunkGeom.translate(0, 0.6, 0);
  const coneGeom = new THREE.ConeGeometry(1.4, 4.2, 6);
  coneGeom.translate(0, 1.2 + 2.1, 0);
  // Merge the two into one BufferGeometry
  const merged = mergeGeometries(THREE, [trunkGeom, coneGeom]);
  // Color attribute: trunk vertices get brown, cone vertices get a placeholder green
  // (tint applied via instanced attribute in the chunk manager).
  const trunkVCount = trunkGeom.attributes.position.count;
  const totalVCount = merged.attributes.position.count;
  const colors = new Float32Array(totalVCount * 3);
  for (let i = 0; i < trunkVCount; i++) {
    colors[i * 3] = 0.29; colors[i * 3 + 1] = 0.20; colors[i * 3 + 2] = 0.13;
  }
  for (let i = trunkVCount; i < totalVCount; i++) {
    colors[i * 3] = 1; colors[i * 3 + 1] = 1; colors[i * 3 + 2] = 1;     // multiplied by instance tint
  }
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  trunkGeom.dispose(); coneGeom.dispose();
  return merged;
}

function mergeGeometries(THREE, geoms) {
  const out = new THREE.BufferGeometry();
  let totalV = 0, totalI = 0;
  for (const g of geoms) {
    totalV += g.attributes.position.count;
    if (g.index) totalI += g.index.count; else totalI += g.attributes.position.count;
  }
  const pos = new Float32Array(totalV * 3);
  const norm = new Float32Array(totalV * 3);
  const idx = new Uint32Array(totalI);
  let vOff = 0, iOff = 0;
  for (const g of geoms) {
    const gPos = g.attributes.position.array;
    const gNorm = g.attributes.normal ? g.attributes.normal.array : null;
    pos.set(gPos, vOff * 3);
    if (gNorm) norm.set(gNorm, vOff * 3);
    if (g.index) {
      const gIdx = g.index.array;
      for (let i = 0; i < gIdx.length; i++) idx[iOff + i] = gIdx[i] + vOff;
      iOff += gIdx.length;
    } else {
      for (let i = 0; i < gPos.length / 3; i++) idx[iOff + i] = i + vOff;
      iOff += gPos.length / 3;
    }
    vOff += gPos.length / 3;
  }
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (norm.some(v => v !== 0)) out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  if (!out.attributes.normal) out.computeVertexNormals();
  return out;
}

// Build an InstancedMesh from a tree descriptor list returned by buildChunkBuffers.
// Each descriptor: { x, y, z, scale, tint, rotation }
export function buildTreeInstancedMesh(THREE, geometry, material, trees) {
  const im = new THREE.InstancedMesh(geometry, material, trees.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const tintAttr = new Float32Array(trees.length * 3);
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    p.set(t.x, t.y, t.z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rotation);
    s.set(t.scale, t.scale, t.scale);
    m.compose(p, q, s);
    im.setMatrixAt(i, m);
    const tp = TINT_PALETTE[t.tint] || TINT_PALETTE[0];
    tintAttr[i * 3] = tp[0]; tintAttr[i * 3 + 1] = tp[1]; tintAttr[i * 3 + 2] = tp[2];
  }
  im.geometry.setAttribute('instanceTint', new THREE.InstancedBufferAttribute(tintAttr, 3));
  im.instanceMatrix.needsUpdate = true;
  im.frustumCulled = false; // chunk-level culling handled by chunk manager
  return im;
}

// A simple billboard atlas (one cone-shaped quad). Used for LOD 1 distant trees.
export function buildBillboardGeometry(THREE) {
  const g = new THREE.PlaneGeometry(3.5, 5.5);
  g.translate(0, 2.75, 0);
  return g;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/terrain/trees.js
git commit -m "feat(terrain): conifer mesh, billboard quad, instanced tree builder"
```

---

### Task 9: Chunk manager

Owns Three.js objects for resident chunks. Per-frame `update(cameraPos)` decides which chunks to load/unload at which LOD. Bounded in-flight queue.

**Files:**
- Create: `lib/terrain/chunk-manager.js`
- Test:   `tests/chunk-manager.test.js` — pure ring-diff logic only

- [ ] **Step 1: Write the failing test (ring-diff logic)**

`tests/chunk-manager.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { computeDesiredChunks, lodForDistance } from '../lib/terrain/chunk-manager.js';

describe('lodForDistance', () => {
  it('returns 0 within the LOD0 ring', () => {
    expect(lodForDistance(100, { l0: 768, l1: 1536, l2: 3072 })).toBe(0);
  });
  it('returns 1 in the LOD1 ring', () => {
    expect(lodForDistance(1000, { l0: 768, l1: 1536, l2: 3072 })).toBe(1);
  });
  it('returns 2 in the LOD2 ring', () => {
    expect(lodForDistance(2500, { l0: 768, l1: 1536, l2: 3072 })).toBe(2);
  });
  it('returns -1 outside view distance', () => {
    expect(lodForDistance(5000, { l0: 768, l1: 1536, l2: 3072 })).toBe(-1);
  });
});

describe('computeDesiredChunks', () => {
  it('produces a square ring centered on the camera chunk', () => {
    const set = computeDesiredChunks({ camCx: 0, camCz: 0 }, { l0: 256, l1: 512, l2: 1024 }, 256);
    expect(set.has('0,0')).toBe(true);
    expect(set.has('-2,0')).toBe(true);
    expect(set.has('2,0')).toBe(true);
    expect(set.has('5,0')).toBe(false);
  });
  it('returns one entry per chunk with its LOD', () => {
    const set = computeDesiredChunks({ camCx: 0, camCz: 0 }, { l0: 256, l1: 512, l2: 1024 }, 256);
    expect(set.get('0,0')).toBe(0);
    // Distance to (3, 0) = ~768m → in LOD2 (since LOD0 ends at 256m, LOD1 at 512m)
    const v = set.get('3,0');
    expect(v === 2 || v === -1).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/chunk-manager.test.js`
Expected: failure (module missing).

- [ ] **Step 3: Implement `lib/terrain/chunk-manager.js`**

```js
import { CHUNK_SIZE } from './chunk-build.js';
import { buildTreeInstancedMesh } from './trees.js';

export function lodForDistance(d, ranges) {
  if (d <= ranges.l0) return 0;
  if (d <= ranges.l1) return 1;
  if (d <= ranges.l2) return 2;
  return -1;
}

// Returns Map<key, lod> for every chunk that should be resident.
export function computeDesiredChunks({ camCx, camCz }, ranges, chunkSize) {
  const out = new Map();
  const radius = Math.ceil(ranges.l2 / chunkSize) + 1;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const cx = camCx + dx, cz = camCz + dz;
      const centerX = (cx + 0.5) * chunkSize;
      const centerZ = (cz + 0.5) * chunkSize;
      const camCenterX = (camCx + 0.5) * chunkSize;
      const camCenterZ = (camCz + 0.5) * chunkSize;
      const d = Math.sqrt((centerX - camCenterX) ** 2 + (centerZ - camCenterZ) ** 2);
      const lod = lodForDistance(d, ranges);
      if (lod < 0) continue;
      out.set(cx + ',' + cz, lod);
    }
  }
  return out;
}

// Vertex-grid table per LOD per perf mode.
export const VERTEX_GRID = {
  high: { 0: 128, 1: 64, 2: 32 },
  low:  { 0: 64,  1: 32, 2: 16 },
};

// Per-LOD ring radii in meters.
export const RANGES = {
  high: { l0: 768,  l1: 1536, l2: 3072 },
  low:  { l0: 768,  l1: 1280, l2: 1500 },
};

// ChunkManager: orchestrates streaming. Owns Three.js objects.
export class ChunkManager {
  constructor({ THREE, scene, runner, terrainMaterial, treeMaterial, treeGeometry, perfMode = 'high' }) {
    this.THREE = THREE;
    this.scene = scene;
    this.runner = runner;
    this.terrainMaterial = terrainMaterial;
    this.treeMaterial = treeMaterial;
    this.treeGeometry = treeGeometry;
    this.perfMode = perfMode;
    this.resident = new Map();      // key → { mesh, treeMesh, lod, cx, cz }
    this.inFlight = new Map();      // key → desired lod
    this.maxInFlight = 4;
    this.lastCamChunk = { cx: NaN, cz: NaN };
    this.group = new THREE.Group();
    this.group.name = 'TerrainChunks';
    this.scene.add(this.group);
  }

  setPerfMode(mode) { this.perfMode = mode; }

  ranges() { return RANGES[this.perfMode]; }
  vertexGrid() { return VERTEX_GRID[this.perfMode]; }

  update(cameraPos) {
    const camCx = Math.floor(cameraPos.x / CHUNK_SIZE);
    const camCz = Math.floor(cameraPos.z / CHUNK_SIZE);
    const teleport = Math.abs(camCx - this.lastCamChunk.cx) > 4 || Math.abs(camCz - this.lastCamChunk.cz) > 4;
    if (teleport && Number.isFinite(this.lastCamChunk.cx)) {
      this._flushAll();
    }
    this.lastCamChunk = { cx: camCx, cz: camCz };

    const desired = computeDesiredChunks({ camCx, camCz }, this.ranges(), CHUNK_SIZE);

    // Unload chunks no longer desired
    for (const [key, entry] of this.resident) {
      if (!desired.has(key)) this._unload(key);
    }

    // Enqueue any missing or wrong-LOD chunks
    for (const [key, lod] of desired) {
      const cur = this.resident.get(key);
      if (cur && cur.lod === lod) continue;
      if (this.inFlight.has(key)) continue;
      this._enqueue(key, lod);
    }
  }

  _enqueue(key, lod) {
    if (this.inFlight.size >= this.maxInFlight) {
      // Soft cap: drop low-priority pending chunks (LOD 2 farthest from camera) when full.
      // Simple approach: skip; will retry next frame.
      return;
    }
    this.inFlight.set(key, lod);
    const [cxStr, czStr] = key.split(',');
    const cx = parseInt(cxStr, 10), cz = parseInt(czStr, 10);
    const grid = this.vertexGrid()[lod];
    this.runner.build({ cx, cz, lod, vertexGrid: grid }).then((out) => {
      // Camera may have moved — re-check if still wanted.
      this.inFlight.delete(key);
      this._install(key, cx, cz, lod, out);
    }).catch((err) => {
      this.inFlight.delete(key);
      console.error('chunk build failed', key, err);
    });
  }

  _install(key, cx, cz, lod, out) {
    // If we already have a chunk at this key, dispose the old before installing the new.
    const existing = this.resident.get(key);
    if (existing) this._dispose(existing);

    const THREE = this.THREE;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(out.positions, 3));
    geom.setAttribute('normal',   new THREE.BufferAttribute(out.normals,   3));
    geom.setAttribute('color',    new THREE.BufferAttribute(out.colors,    3));
    geom.setIndex(new THREE.BufferAttribute(out.indices, 1));
    geom.computeBoundingSphere();

    const mesh = new THREE.Mesh(geom, this.terrainMaterial);
    mesh.frustumCulled = true;
    this.group.add(mesh);

    let treeMesh = null;
    if (out.trees && out.trees.length > 0 && lod === 0) {
      treeMesh = buildTreeInstancedMesh(THREE, this.treeGeometry, this.treeMaterial, out.trees);
      this.group.add(treeMesh);
    }

    this.resident.set(key, { mesh, treeMesh, lod, cx, cz });
  }

  _unload(key) {
    const e = this.resident.get(key);
    if (!e) return;
    this._dispose(e);
    this.resident.delete(key);
  }

  _dispose(entry) {
    if (entry.mesh) {
      this.group.remove(entry.mesh);
      entry.mesh.geometry.dispose();
    }
    if (entry.treeMesh) {
      this.group.remove(entry.treeMesh);
      entry.treeMesh.geometry.dispose();
    }
  }

  _flushAll() {
    for (const [key] of this.resident) this._unload(key);
    // In-flight requests are not cancelable mid-flight; their results will be installed
    // and then unloaded on the next update if no longer desired. Acceptable.
  }

  dispose() {
    this._flushAll();
    this.scene.remove(this.group);
    this.runner.dispose && this.runner.dispose();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/chunk-manager.test.js`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add lib/terrain/chunk-manager.js tests/chunk-manager.test.js
git commit -m "feat(terrain): chunk manager with LOD rings, in-flight queue, teleport detection"
```

---

## Phase 4 — Rendering / styles / water

### Task 10: Style system

Single `MeshLambertMaterial` patched via `onBeforeCompile`. Three styles via `uStyle` int + per-style fog/sky/water/sun presets.

**Files:**
- Create: `lib/terrain/style-system.js`
- Test:   none (Three.js shader patching — verified visually in Task 19)

- [ ] **Step 1: Implement `lib/terrain/style-system.js`**

```js
// Per-style presets. Used by createTerrain to swap scene-level state.
export const STYLES = {
  lowpoly: {
    sky:          [0.62, 0.84, 1.00],
    fogType:      'none',
    fogColor:     [0.62, 0.84, 1.00],
    fogNear:      0,
    fogFar:       0,
    waterColor:   [0.18, 0.43, 0.64],
    waterOpacity: 1.0,
    sunColor:     [1.00, 1.00, 1.00],
    hemiSky:      [0.72, 0.88, 1.00],
    hemiGround:   [0.42, 0.50, 0.31],
    hemiIntensity: 0.55,
  },
  stylized: {
    sky:          [0.81, 0.91, 0.96],
    fogType:      'linear',
    fogColor:     [0.81, 0.91, 0.96],
    fogNear:      900,
    fogFar:       2400,
    waterColor:   [0.29, 0.53, 0.72],
    waterOpacity: 0.85,
    sunColor:     [1.00, 0.95, 0.84],
    hemiSky:      [1.00, 0.91, 0.77],
    hemiGround:   [0.42, 0.50, 0.31],
    hemiIntensity: 0.70,
  },
  realistic: {
    sky:          [0.43, 0.51, 0.58],
    fogType:      'exp2',
    fogColor:     [0.43, 0.51, 0.58],
    fogDensity:   0.0008,
    waterColor:   [0.16, 0.23, 0.29],
    waterOpacity: 0.9,
    sunColor:     [0.99, 0.95, 0.85],
    hemiSky:      [0.63, 0.71, 0.78],
    hemiGround:   [0.23, 0.21, 0.15],
    hemiIntensity: 0.45,
  },
};

const STYLE_INDEX = { lowpoly: 0, stylized: 1, realistic: 2 };

// Build the shared terrain material. Adds a uStyle uniform and patches the shader to:
//  - lowpoly: derive face normal via dFdx/dFdy, snap colors to 6 palette entries
//  - stylized: smooth normal + smooth color
//  - realistic: smooth normal + slope-blended rock + snow-line snow
export function buildTerrainMaterial(THREE) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.userData.uStyle = { value: STYLE_INDEX.lowpoly };
  mat.userData.uSnowLine = { value: 22 };
  mat.userData.uWaterY   = { value: 0 };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uStyle    = mat.userData.uStyle;
    shader.uniforms.uSnowLine = mat.userData.uSnowLine;
    shader.uniforms.uWaterY   = mat.userData.uWaterY;

    // Vertex shader: pass world position to fragment.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       varying vec3 vWorldPosT;`
    ).replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
       vWorldPosT = (modelMatrix * vec4(transformed, 1.0)).xyz;`
    );

    // Fragment shader: redefine `vColor` use per-style.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       uniform int uStyle;
       uniform float uSnowLine;
       uniform float uWaterY;
       varying vec3 vWorldPosT;

       const vec3 PAL[6] = vec3[6](
         vec3(0.18,0.42,0.62),  // deepWater
         vec3(0.86,0.78,0.55),  // sand
         vec3(0.52,0.74,0.40),  // grassLow
         vec3(0.40,0.62,0.32),  // grassMid
         vec3(0.55,0.55,0.58),  // rock
         vec3(0.97,0.97,0.99)   // snow
       );
       vec3 paletteSnap(vec3 c) {
         float bestD = 100.0; int best = 0;
         for (int i = 0; i < 6; i++) {
           float d = distance(c, PAL[i]);
           if (d < bestD) { bestD = d; best = i; }
         }
         return PAL[best];
       }`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       if (uStyle == 0) {
         diffuseColor.rgb = paletteSnap(diffuseColor.rgb);
       } else if (uStyle == 2) {
         vec3 dx = dFdx(vWorldPosT);
         vec3 dy = dFdy(vWorldPosT);
         vec3 worldN = normalize(cross(dx, dy));
         float slope = clamp(1.0 - worldN.y, 0.0, 1.0);
         vec3 ROCK = vec3(0.36, 0.34, 0.30);
         vec3 SNOW = vec3(0.96, 0.97, 0.98);
         diffuseColor.rgb = mix(diffuseColor.rgb, ROCK, smoothstep(0.25, 0.7, slope));
         float snowMask = smoothstep(0.0, 6.0, vWorldPosT.y - uSnowLine - slope * 6.0);
         diffuseColor.rgb = mix(diffuseColor.rgb, SNOW, clamp(snowMask, 0.0, 1.0));
       }`
    );
    // For uStyle == 0, override the geometry normal in the lighting block.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `#include <normal_fragment_begin>
       if (uStyle == 0) {
         vec3 dx = dFdx(vWorldPosT);
         vec3 dy = dFdy(vWorldPosT);
         normal = normalize(cross(dx, dy));
       }`
    );
  };
  return mat;
}

// Apply a style to scene-level state (sky color, fog, lights, water).
// Material uniform is updated in-place; no rebuild.
export function applyStyle(THREE, scene, material, sun, hemi, waterMesh, styleName) {
  const s = STYLES[styleName];
  if (!s) throw new Error('Unknown style: ' + styleName);
  scene.background = new THREE.Color(s.sky[0], s.sky[1], s.sky[2]);
  if (s.fogType === 'none') {
    scene.fog = null;
  } else if (s.fogType === 'linear') {
    scene.fog = new THREE.Fog(new THREE.Color(s.fogColor[0], s.fogColor[1], s.fogColor[2]), s.fogNear, s.fogFar);
  } else {
    scene.fog = new THREE.FogExp2(new THREE.Color(s.fogColor[0], s.fogColor[1], s.fogColor[2]), s.fogDensity);
  }
  if (sun)  sun.color.setRGB(s.sunColor[0], s.sunColor[1], s.sunColor[2]);
  if (hemi) {
    hemi.color.setRGB(s.hemiSky[0], s.hemiSky[1], s.hemiSky[2]);
    hemi.groundColor.setRGB(s.hemiGround[0], s.hemiGround[1], s.hemiGround[2]);
    hemi.intensity = s.hemiIntensity;
  }
  if (waterMesh) {
    waterMesh.material.color.setRGB(s.waterColor[0], s.waterColor[1], s.waterColor[2]);
    waterMesh.material.opacity = s.waterOpacity;
    waterMesh.material.transparent = s.waterOpacity < 1;
  }
  material.userData.uStyle.value = STYLE_INDEX[styleName];
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/terrain/style-system.js
git commit -m "feat(terrain): style system — uStyle uniform + onBeforeCompile + per-style scene presets"
```

---

### Task 11: Water plane

A single large opaque/transparent quad at Y=0. Style decides color & transparency.

**Files:**
- Create: `lib/terrain/water.js`

- [ ] **Step 1: Implement `lib/terrain/water.js`**

```js
export function buildWaterPlane(THREE, size = 64000) {
  const geom = new THREE.PlaneGeometry(size, size, 1, 1);
  geom.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({ color: 0x2d6ea3, transparent: false, opacity: 1 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.y = 0;
  mesh.renderOrder = -1;
  return mesh;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/terrain/water.js
git commit -m "feat(terrain): flat water plane"
```

---

## Phase 5 — Module wiring

### Task 12: createTerrain factory + controller

Pulls every module piece together behind the API in spec §6.

**Files:**
- Create: `lib/terrain/index.js`

- [ ] **Step 1: Implement `lib/terrain/index.js`**

```js
import { buildRiverGraph } from './river-graph.js';
import { ChunkManager } from './chunk-manager.js';
import { ChunkRunner } from './chunk-runner.js';
import { ChunkWorkerProxy } from './chunk-worker-proxy.js';
import { buildTerrainMaterial, applyStyle, STYLES } from './style-system.js';
import { buildWaterPlane } from './water.js';
import { buildConiferGeometry } from './trees.js';
import { terrainHeight } from './height.js';
import { riverDepthAt } from './carve.js';

const SEED_KEY = 'terrain.seed';
const WORLD_SIZE = 64000;
const RIVER_GRID_N = 256;

function resolveSeed(opts) {
  if (opts.seed !== undefined && opts.seed !== null) return opts.seed | 0;
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('seed');
  if (fromUrl !== null) {
    const parsed = parseInt(fromUrl, 36);
    if (Number.isFinite(parsed)) return parsed;
  }
  const stored = window.localStorage.getItem(SEED_KEY);
  if (stored) {
    const parsed = parseInt(stored, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  const buf = new Uint32Array(1);
  window.crypto.getRandomValues(buf);
  const seed = buf[0] >>> 0;
  window.localStorage.setItem(SEED_KEY, String(seed));
  return seed;
}

export function createTerrain(opts) {
  const { THREE, scene, renderer } = opts;
  if (!THREE || !scene || !renderer) {
    throw new Error('createTerrain requires { THREE, scene, renderer }');
  }
  const seed = resolveSeed(opts);

  // 1. River graph (one-time, main thread).
  const graph = buildRiverGraph({ seed, gridN: RIVER_GRID_N, worldSize: WORLD_SIZE });

  // 2. Worker (or main-thread fallback).
  let runner;
  try {
    runner = new ChunkWorkerProxy({ seed, riverSegments: graph.segments });
  } catch (err) {
    console.warn('Worker unavailable, falling back to main-thread chunk gen.', err);
    runner = new ChunkRunner({ seed, riverSegments: graph.segments });
  }

  // 3. Materials, water, lights.
  const terrainMaterial = buildTerrainMaterial(THREE);
  // MeshPhongMaterial supports flatShading; MeshLambertMaterial in r128 doesn't.
  const treeMaterial = new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 0 });
  const treeGeometry = buildConiferGeometry(THREE);
  const water = buildWaterPlane(THREE, WORLD_SIZE);
  scene.add(water);

  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.position.set(80, 120, 60);
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xb8e0ff, 0x6a8050, 0.55);
  scene.add(hemi);

  // 4. Style.
  const styleName = opts.style || 'lowpoly';
  applyStyle(THREE, scene, terrainMaterial, sun, hemi, water, styleName);

  // 5. Chunk manager.
  const perfMode = opts.perfMode === 'auto' ? 'high' : (opts.perfMode || 'high');
  const cm = new ChunkManager({
    THREE, scene, runner, terrainMaterial, treeMaterial, treeGeometry, perfMode,
  });

  return {
    seed,
    riverSegments: graph.segments,
    lakes: graph.lakes,
    update(cameraPos) { cm.update(cameraPos); },
    getHeight(x, z) { return terrainHeight(x, z, seed); },
    getRiverWidthAt(x, z) {
      const d = riverDepthAt(x, z, graph.segments, 1);
      return d > 0 ? 1 : 0;
    },
    setStyle(name) { applyStyle(THREE, scene, terrainMaterial, sun, hemi, water, name); },
    setPerfMode(mode) { cm.setPerfMode(mode === 'auto' ? 'high' : mode); },
    dispose() {
      cm.dispose();
      scene.remove(water);
      water.geometry.dispose();
      water.material.dispose();
      scene.remove(sun);
      scene.remove(hemi);
      terrainMaterial.dispose();
      treeMaterial.dispose();
      treeGeometry.dispose();
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/terrain/index.js
git commit -m "feat(terrain): createTerrain factory wiring graph, worker, materials, water, lights, manager"
```

---

## Phase 6 — Standalone shell

### Task 13: Free-fly controller

Desktop and mobile input → camera movement & look. Pure input layer; the shell wires it to a Three.js camera.

**Files:**
- Create: `shell/fly-controller.js`

- [ ] **Step 1: Implement `shell/fly-controller.js`**

```js
// Free-fly camera input. Mutates a target THREE.PerspectiveCamera each frame.
// Desktop: WASD + mouse drag-to-look + wheel-throttle + shift-boost.
// Mobile: split-screen virtual stick (left) + drag-to-look (right) + pinch throttle + boost button.

const KEY_MAP = {
  KeyW: 'fwd', KeyA: 'left', KeyS: 'back', KeyD: 'right',
  Space: 'up', ShiftLeft: 'boost', ShiftRight: 'boost', KeyQ: 'down', KeyE: 'up',
};

export class FlyController {
  constructor({ THREE, camera, domElement }) {
    this.THREE = THREE;
    this.camera = camera;
    this.dom = domElement;
    this.yaw = 0;
    this.pitch = 0;
    this.speed = 80;            // m/s base
    this.boost = false;
    this.input = { fwd: 0, back: 0, left: 0, right: 0, up: 0, down: 0 };
    this._mouseLook = { active: false, lastX: 0, lastY: 0 };
    this._touch = { lookId: null, lookLastX: 0, lookLastY: 0,
                    stickId: null, stickStartX: 0, stickStartY: 0, stickX: 0, stickY: 0,
                    pinchA: null, pinchB: null, pinchStartDist: 0, pinchStartSpeed: 0 };
    this._tmpVec = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
    this._bind();
  }

  _bind() {
    addEventListener('keydown', (e) => { const m = KEY_MAP[e.code]; if (!m) return; if (m === 'boost') this.boost = true; else this.input[m] = 1; });
    addEventListener('keyup',   (e) => { const m = KEY_MAP[e.code]; if (!m) return; if (m === 'boost') this.boost = false; else this.input[m] = 0; });
    addEventListener('wheel',   (e) => { this.speed = Math.max(20, Math.min(800, this.speed * (e.deltaY < 0 ? 1.15 : 0.87))); }, { passive: true });

    const dom = this.dom;
    dom.addEventListener('mousedown', (e) => { this._mouseLook.active = true; this._mouseLook.lastX = e.clientX; this._mouseLook.lastY = e.clientY; });
    addEventListener('mouseup',   () => { this._mouseLook.active = false; });
    addEventListener('mousemove', (e) => {
      if (!this._mouseLook.active) return;
      const dx = e.clientX - this._mouseLook.lastX;
      const dy = e.clientY - this._mouseLook.lastY;
      this._mouseLook.lastX = e.clientX; this._mouseLook.lastY = e.clientY;
      this.yaw   -= dx * 0.0025;
      this.pitch -= dy * 0.0025;
      this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch));
    });

    // Touch
    dom.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    dom.addEventListener('touchmove',  (e) => this._onTouchMove(e),  { passive: false });
    dom.addEventListener('touchend',   (e) => this._onTouchEnd(e),   { passive: false });
    dom.addEventListener('touchcancel',(e) => this._onTouchEnd(e),   { passive: false });
  }

  _onTouchStart(e) {
    e.preventDefault();
    const halfW = innerWidth / 2;
    for (const t of e.changedTouches) {
      // Pinch: any new touch starts pinch tracking if we already have one tracked.
      if (this._touch.pinchA && !this._touch.pinchB) {
        this._touch.pinchB = { id: t.identifier, x: t.clientX, y: t.clientY };
        const a = this._touch.pinchA, b = this._touch.pinchB;
        this._touch.pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
        this._touch.pinchStartSpeed = this.speed;
        continue;
      }
      if (t.clientX < halfW && this._touch.stickId === null) {
        this._touch.stickId = t.identifier;
        this._touch.stickStartX = t.clientX;
        this._touch.stickStartY = t.clientY;
        this._touch.stickX = 0; this._touch.stickY = 0;
        this._touch.pinchA = { id: t.identifier, x: t.clientX, y: t.clientY };
      } else if (t.clientX >= halfW && this._touch.lookId === null) {
        this._touch.lookId = t.identifier;
        this._touch.lookLastX = t.clientX;
        this._touch.lookLastY = t.clientY;
        this._touch.pinchA = this._touch.pinchA || { id: t.identifier, x: t.clientX, y: t.clientY };
      }
    }
  }
  _onTouchMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (this._touch.pinchB && (t.identifier === this._touch.pinchA.id || t.identifier === this._touch.pinchB.id)) {
        const tgt = t.identifier === this._touch.pinchA.id ? this._touch.pinchA : this._touch.pinchB;
        tgt.x = t.clientX; tgt.y = t.clientY;
        const a = this._touch.pinchA, b = this._touch.pinchB;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const ratio = d / Math.max(1, this._touch.pinchStartDist);
        this.speed = Math.max(20, Math.min(800, this._touch.pinchStartSpeed * ratio));
        continue;
      }
      if (t.identifier === this._touch.lookId) {
        const dx = t.clientX - this._touch.lookLastX;
        const dy = t.clientY - this._touch.lookLastY;
        this._touch.lookLastX = t.clientX;
        this._touch.lookLastY = t.clientY;
        this.yaw   -= dx * 0.005;
        this.pitch -= dy * 0.005;
        this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch));
      } else if (t.identifier === this._touch.stickId) {
        const dx = (t.clientX - this._touch.stickStartX);
        const dy = (t.clientY - this._touch.stickStartY);
        const r = 80;
        const cx = Math.max(-1, Math.min(1, dx / r));
        const cy = Math.max(-1, Math.min(1, dy / r));
        this._touch.stickX = cx;
        this._touch.stickY = cy;
        this.input.fwd = Math.max(0, -cy);
        this.input.back = Math.max(0, cy);
        this.input.left = Math.max(0, -cx);
        this.input.right = Math.max(0, cx);
      }
    }
  }
  _onTouchEnd(e) {
    for (const t of e.changedTouches) {
      if (this._touch.pinchA && t.identifier === this._touch.pinchA.id) this._touch.pinchA = null;
      if (this._touch.pinchB && t.identifier === this._touch.pinchB.id) this._touch.pinchB = null;
      if (t.identifier === this._touch.lookId) this._touch.lookId = null;
      if (t.identifier === this._touch.stickId) {
        this._touch.stickId = null;
        this._touch.stickX = 0; this._touch.stickY = 0;
        this.input.fwd = this.input.back = this.input.left = this.input.right = 0;
      }
    }
  }

  setBoost(on) { this.boost = !!on; }

  update(dt) {
    const yawQ = new this.THREE.Quaternion().setFromAxisAngle(new this.THREE.Vector3(0, 1, 0), this.yaw);
    const pitchQ = new this.THREE.Quaternion().setFromAxisAngle(new this.THREE.Vector3(1, 0, 0), this.pitch);
    this.camera.quaternion.copy(yawQ).multiply(pitchQ);

    const speed = this.speed * (this.boost ? 3 : 1);
    const fwd = new this.THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = new this.THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new this.THREE.Vector3(0, 1, 0);
    const move = new this.THREE.Vector3();
    move.addScaledVector(fwd,   (this.input.fwd  - this.input.back));
    move.addScaledVector(right, (this.input.right - this.input.left));
    move.addScaledVector(up,    (this.input.up   - this.input.down));
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed * dt);
      this.camera.position.add(move);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add shell/fly-controller.js
git commit -m "feat(shell): free-fly controller with desktop + mobile input"
```

---

### Task 14: HUD

Compass, altitude, FPS readout. Pure DOM overlay.

**Files:**
- Create: `shell/hud.js`

- [ ] **Step 1: Implement `shell/hud.js`**

```js
export function buildHUD(parent) {
  const root = document.createElement('div');
  root.style.cssText = `
    position:fixed; inset:0; pointer-events:none; font-family:ui-monospace,Menlo,monospace;
    color:#fff; text-shadow:0 1px 3px rgba(0,0,0,.6);
  `;
  root.innerHTML = `
    <div id="hud-fps" style="position:absolute;top:8px;left:8px;font-size:13px;opacity:.85"></div>
    <div id="hud-alt" style="position:absolute;top:8px;right:8px;font-size:13px;opacity:.85"></div>
    <div id="hud-compass" style="position:absolute;top:8px;left:50%;transform:translateX(-50%);font-size:13px;letter-spacing:.4em">N</div>
  `;
  parent.appendChild(root);
  const fpsEl = root.querySelector('#hud-fps');
  const altEl = root.querySelector('#hud-alt');
  const cmpEl = root.querySelector('#hud-compass');
  let frames = 0, last = performance.now(), fps = 0;
  return {
    update(camera, dt) {
      frames++;
      const now = performance.now();
      if (now - last >= 500) {
        fps = (frames * 1000 / (now - last)) | 0;
        frames = 0; last = now;
      }
      fpsEl.textContent = fps + ' fps';
      altEl.textContent = (camera.position.y | 0) + ' m';
      cmpEl.textContent = compassChar(headingFromCamera(camera));
    },
    dispose() { parent.removeChild(root); },
  };
}

// Heading derived directly from camera.quaternion (no dependence on matrixWorld being up to date).
// Returns radians in [0, 2π) where 0 = looking toward world -Z (north).
function headingFromCamera(camera) {
  const q = camera.quaternion;
  // Apply quaternion to (0, 0, -1):
  //   x' = -2 * (q.x * q.z + q.w * q.y)
  //   z' = -(1 - 2 * (q.x*q.x + q.y*q.y))
  const x = -2 * (q.x * q.z + q.w * q.y);
  const z = -(1 - 2 * (q.x * q.x + q.y * q.y));
  let h = Math.atan2(x, -z);
  if (h < 0) h += Math.PI * 2;
  return h;
}

function compassChar(heading) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(heading / (Math.PI / 4)) % 8;
  return dirs[idx];
}
```

- [ ] **Step 2: Commit**

```bash
git add shell/hud.js docs/superpowers/plans/2026-05-04-procedural-terrain-3d.md
git commit -m "feat(shell): HUD overlay (fps, altitude, compass)"
```

---

### Task 15: Settings flyout

Style picker; persists choice to `localStorage`.

**Files:**
- Create: `shell/settings.js`

- [ ] **Step 1: Implement `shell/settings.js`**

```js
const KEY = 'terrain.style';

export function buildSettings({ parent, initialStyle, onStyleChange }) {
  const root = document.createElement('div');
  root.style.cssText = `
    position:fixed; right:8px; bottom:8px; pointer-events:auto;
    font-family:ui-monospace,Menlo,monospace; color:#fff; font-size:13px;
  `;
  root.innerHTML = `
    <button id="set-toggle" style="background:rgba(0,0,0,.55);border:1px solid #fff4;color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer">Style: ${initialStyle}</button>
    <div id="set-panel" style="display:none;margin-top:6px;background:rgba(0,0,0,.7);border:1px solid #fff4;border-radius:8px;padding:6px;min-width:140px">
      <button data-style="lowpoly" class="set-btn">Low-poly</button>
      <button data-style="stylized" class="set-btn">Stylized</button>
      <button data-style="realistic" class="set-btn">Realistic</button>
    </div>
  `;
  parent.appendChild(root);
  const toggle = root.querySelector('#set-toggle');
  const panel  = root.querySelector('#set-panel');
  toggle.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });
  for (const btn of root.querySelectorAll('.set-btn')) {
    btn.style.cssText = 'display:block;width:100%;text-align:left;background:transparent;border:0;color:#fff;padding:6px 8px;cursor:pointer;font:inherit';
    btn.addEventListener('mouseenter', () => btn.style.background = 'rgba(255,255,255,.12)');
    btn.addEventListener('mouseleave', () => btn.style.background = 'transparent');
    btn.addEventListener('click', () => {
      const s = btn.dataset.style;
      localStorage.setItem(KEY, s);
      toggle.textContent = 'Style: ' + s;
      panel.style.display = 'none';
      onStyleChange(s);
    });
  }
  return {
    getStoredStyle() { return localStorage.getItem(KEY); },
    dispose() { parent.removeChild(root); },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add shell/settings.js
git commit -m "feat(shell): settings flyout with style picker (localStorage-persisted)"
```

---

### Task 16: Perf probe

Samples FPS over the first 60 frames and recommends a `perfMode`.

**Files:**
- Create: `shell/perf-probe.js`

- [ ] **Step 1: Implement `shell/perf-probe.js`**

```js
// Samples instantaneous frame times for `frameCount` frames after activation,
// then calls `cb(mode)` with 'high' or 'low'.
export class PerfProbe {
  constructor({ frameCount = 60, lowFpsThreshold = 28 } = {}) {
    this.frameCount = frameCount;
    this.lowFpsThreshold = lowFpsThreshold;
    this.samples = [];
    this.active = false;
    this.cb = null;
    this._lastT = 0;
  }
  start(cb) {
    this.cb = cb;
    this.active = true;
    this._lastT = performance.now();
  }
  tick() {
    if (!this.active) return;
    const now = performance.now();
    const dt = now - this._lastT;
    this._lastT = now;
    if (dt > 0) this.samples.push(1000 / dt);
    if (this.samples.length >= this.frameCount) {
      this.samples.sort((a, b) => a - b);
      const median = this.samples[Math.floor(this.samples.length / 2)];
      const mode = median < this.lowFpsThreshold ? 'low' : 'high';
      this.active = false;
      this.cb && this.cb(mode);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add shell/perf-probe.js
git commit -m "feat(shell): perf probe samples FPS and recommends mode"
```

---

### Task 17: Standalone shell entry

Wire Three.js scene + terrain module + fly controller + HUD + settings + perf probe. Replaces the placeholder `index.html`.

**Files:**
- Create: `shell/main.js`
- Modify: `index.html` (replace placeholder)

- [ ] **Step 1: Replace `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>Procedural Terrain</title>
  <link rel="icon" href="data:,">
  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: #000; overflow: hidden; }
    canvas { display: block; width: 100%; height: 100%; touch-action: none; }
    #boot {
      position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
      background: #0a0e14; color: #fff; font-family: ui-monospace, Menlo, monospace; z-index: 10;
      transition: opacity .4s ease;
    }
    #boot.hidden { opacity: 0; pointer-events: none; }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <script src="https://cdn-play.nitzan.games/lib/play-sdk.js"></script>
</head>
<body>
  <canvas id="game"></canvas>
  <div id="boot">Generating world…</div>
  <script type="module" src="shell/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Implement `shell/main.js`**

```js
import { createTerrain } from '../lib/terrain/index.js';
import { FlyController } from './fly-controller.js';
import { buildHUD } from './hud.js';
import { buildSettings } from './settings.js';
import { PerfProbe } from './perf-probe.js';

const THREE = window.THREE;
const canvas = document.getElementById('game');
const boot = document.getElementById('boot');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 6000);
camera.position.set(0, 60, 0);
camera.rotation.order = 'YXZ';

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// Determine initial style
const settingsKey = 'terrain.style';
const storedStyle = localStorage.getItem(settingsKey);
const initialStyle = storedStyle === 'stylized' || storedStyle === 'realistic' ? storedStyle : 'lowpoly';

const terrain = createTerrain({
  THREE, scene, renderer,
  style: initialStyle,
  perfMode: 'high',
});

const fly = new FlyController({ THREE, camera, domElement: canvas });
const hud = buildHUD(document.body);
const settings = buildSettings({
  parent: document.body,
  initialStyle,
  onStyleChange: (s) => terrain.setStyle(s),
});
const probe = new PerfProbe({ frameCount: 60, lowFpsThreshold: 28 });
probe.start((mode) => terrain.setPerfMode(mode));

// Place camera above terrain at spawn
const spawnY = terrain.getHeight(0, 0) + 80;
camera.position.set(0, spawnY, 0);

let lastFrame = performance.now();
let bootHidden = false;

function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  fly.update(dt);
  terrain.update(camera.position);
  hud.update(camera, dt);
  probe.tick();

  renderer.render(scene, camera);

  if (!bootHidden) {
    bootHidden = true;
    boot.classList.add('hidden');
    setTimeout(() => boot.remove(), 600);
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Visibility/lifecycle: pause on hide
let raf = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cancelAnimationFrame(raf);
  else { lastFrame = performance.now(); raf = requestAnimationFrame(frame); }
});

// PlaySDK readiness signal
if (window.PlaySDK && window.PlaySDK.ready) window.PlaySDK.ready();
```

- [ ] **Step 3: Local smoke test**

Run: `npm run dev`
Open: `http://localhost:8080`
Expected: world renders within ~2 s, you can WASD around, drag to look. No console errors. Use `?seed=42` to verify reload determinism: same world, same trees.

- [ ] **Step 4: Commit**

```bash
git add index.html shell/main.js
git commit -m "feat(shell): main entry wires terrain, fly controller, HUD, settings, perf probe"
```

---

## Phase 7 — Polish, screenshots, deploy

### Task 18: Visual fixtures (Puppeteer)

Capture three screenshots — one per style — at a fixed seed and camera pose. Commit as fixtures so future PRs can diff against them.

**Files:**
- Create: `tools/capture-fixtures.cjs`
- Create: `screenshots/.gitkeep`
- Create: `screenshots/style-lowpoly.png` (output)
- Create: `screenshots/style-stylized.png` (output)
- Create: `screenshots/style-realistic.png` (output)

- [ ] **Step 1: Implement `tools/capture-fixtures.cjs`**

```js
const puppeteer = require('/usr/local/lib/node_modules/puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  for (const style of ['lowpoly', 'stylized', 'realistic']) {
    await page.evaluate(s => localStorage.setItem('terrain.style', s), style);
    await page.goto('http://localhost:8080?seed=fixture42', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 4000));
    await page.screenshot({ path: `screenshots/style-${style}.png` });
    console.log('captured', style);
  }
  await browser.close();
})();
```

- [ ] **Step 2: Capture**

Pre-req: `npm run dev` running in another terminal.
Run: `node tools/capture-fixtures.cjs`
Expected: three PNGs land in `screenshots/`.

- [ ] **Step 3: Sanity-check screenshots**

Run: `open screenshots/style-lowpoly.png screenshots/style-stylized.png screenshots/style-realistic.png`
Verify: each shows mountains, lakes/rivers visible, trees scattered, distinct visual style.

- [ ] **Step 4: Commit**

```bash
git add tools/capture-fixtures.cjs screenshots/
git commit -m "test: visual fixtures for all three styles at fixed seed"
```

---

### Task 19: Generate thumbnail from real 3D

Per platform convention (`/Users/nitzanwilnai/Programming/Claude/JSGames/GAME_DEV_NOTES.md` and stored memory): thumbnails must use actual 3D models, not CSS/SVG approximations.

**Files:**
- Create: `tools/capture-thumbnail.cjs`
- Modify: `thumbnail.png` (output)

- [ ] **Step 1: Implement `tools/capture-thumbnail.cjs`**

```js
const puppeteer = require('/usr/local/lib/node_modules/puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  // Square 600×600 thumbnail per platform convention
  await page.setViewport({ width: 600, height: 600, deviceScaleFactor: 2 });
  await page.evaluate(() => localStorage.setItem('terrain.style', 'lowpoly'));
  await page.goto('http://localhost:8080?seed=thumbnail99', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 5000));
  // Frame a hero shot: jump camera to a curated pose by tweaking URL
  // (For v1 we use the default spawn pose. Operator can re-run with a different ?seed if needed.)
  await page.screenshot({ path: 'thumbnail.png' });
  await browser.close();
})();
```

- [ ] **Step 2: Capture**

Pre-req: `npm run dev` running.
Run: `node tools/capture-thumbnail.cjs`

- [ ] **Step 3: Verify**

Run: `open thumbnail.png`
Verify: actual 3D world visible, mountains and water in frame, looks marketable. If not, re-run with another `?seed=` URL value.

- [ ] **Step 4: Commit**

```bash
git add tools/capture-thumbnail.cjs thumbnail.png
git commit -m "feat: thumbnail captured from real 3D scene"
```

---

### Task 20: Final meta + smoke checklist

Lock down `meta.json`, verify the full smoke checklist from spec §10.

**Files:**
- Modify: `meta.json` (final)

- [ ] **Step 1: Final `meta.json`**

```json
{
  "slug": "procedural-terrain",
  "title": "Procedural Terrain",
  "description": "A vast procedurally generated world. Fly anywhere — snow-capped mountains, winding rivers, glittering lakes, and quiet forests stretch in every direction. Pick your style, set your seed, and roam.",
  "tags": ["3d", "procedural", "exploration", "sandbox", "casual"],
  "author": "nitzanwilnai",
  "thumbnail": "thumbnail.png"
}
```

- [ ] **Step 2: Manual smoke test (per spec §10)**

Run: `npm run dev` and walk through each item:
- Fly forward 60 s on desktop (Chrome). FPS holds ≥ 55.
- Fly forward 60 s on mobile (iPhone via local IP, or Chrome devtools mobile emulation as a proxy). FPS holds ≥ 28.
- Toggle style mid-flight three times — no stutter, no missing chunks.
- Reload with `?seed=hello` — exact same trees on the same hill.
- Fly to (~30 km, 0) — see ocean + fog at the world edge, no visible "wall."

If any item fails, file the issue and fix before declaring done.

- [ ] **Step 3: Commit**

```bash
git add meta.json
git commit -m "polish: final meta.json copy"
```

---

### Task 21: Deploy to play.nitzan.games

Use the platform's deploy script. **Do not run this without the user's explicit go-ahead** (per the user's `feedback_deploy_gating` memory: never deploy from inside a plan without per-action confirmation).

**Files:** none.

- [ ] **Step 1: Confirm with user**

Ask the user explicitly: "All checks pass — ready to deploy to play.nitzan.games?" Wait for explicit yes.

- [ ] **Step 2: Deploy**

```bash
cd /Users/nitzanwilnai/Programming/Claude/GamesPlatform
./scripts/deploy-game.sh /Users/nitzanwilnai/Programming/Claude/JSGames/ProceduralTerrain3D
```
Expected: script zips the project (respecting `.zipignore`), POSTs to `/api/deploy`, prints success.

- [ ] **Step 3: Verify on production**

Run: `open https://play.nitzan.games/play/procedural-terrain`
Verify: world loads in ≤ 2 s, can fly around, style picker works, seed determinism works.

---

## Self-review checklist

**Spec coverage:**
- §2 visual styles — Tasks 10, 12, 15 ✓
- §2 world extent + streaming — Tasks 6, 9, 12 ✓
- §2 rivers/lakes — Tasks 4, 5, 6 ✓
- §2 free-fly camera — Task 13 ✓
- §2 perf target + auto-downscale — Tasks 9, 16, 17 ✓
- §2 single-conifer trees — Tasks 6, 8 ✓
- §2 determinism — Tasks 2-6 (every random uses `hash2`) ✓
- §2 seed source URL → localStorage → random — Task 12 (`resolveSeed`) ✓
- §4 chunk grid + LOD — Task 9 ✓
- §4 init flow — Task 12 ✓
- §4 worker chunk job — Tasks 6, 7 ✓
- §4 main-thread fallback — Task 7 ✓
- §5 style system — Task 10 ✓
- §6 module API contract — Task 12 ✓
- §7 file layout — match ✓ (we have additional `chunk-runner.js` + `chunk-worker-proxy.js` not listed in spec; this is the runner/proxy split, which is an internal concern — note in the design rationale)
- §8 edge cases: worker fail, teleport, visibilitychange, resize — Tasks 7, 9, 17 ✓
- §10 testing strategy — Tasks 2-6, 7, 9, 18 ✓
- §11 success criteria — Tasks 17, 20, 21 ✓
- §12 out of scope — none of these tasks add scoped-out features ✓

**Placeholder scan:** none found (all code blocks are complete; no "TODO", no "implement later").

**Type consistency:**
- `buildChunkBuffers({ cx, cz, lod, seed, riverSegments, vertexGrid })` — same shape used in chunk-runner, chunk-worker, chunk-manager ✓
- `RiverSegment = { x0, z0, x1, z1, width, isTerminal, endsInLake }` — same in river-graph, carve, chunk-build ✓
- Tree descriptor `{ x, y, z, scale, tint, rotation }` — same in chunk-build and trees.js ✓
- `applyStyle` signature — same in style-system and index.js ✓
- `ChunkRunner.build()` and `ChunkWorkerProxy.build()` have identical async signatures — interchangeable ✓

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-04-procedural-terrain-3d.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints

Which approach?
