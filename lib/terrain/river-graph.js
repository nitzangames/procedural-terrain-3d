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
