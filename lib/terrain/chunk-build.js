import { terrainHeight, WATER_LEVEL, SNOW_LINE } from './height.js';
import { applyRiverCarve, riverDepthAt } from './carve.js';
import { hash2 } from './noise.js';

export const CHUNK_SIZE = 256;     // meters per chunk
const SKIRT_DROP = 8;              // meters — doubled with the heightfield amplitude
const RIVER_CARVE_DEPTH = 8;       // meters — doubled with the heightfield amplitude
const TREE_GRID_PITCH = 4;         // meters between candidate tree positions
const TREE_PEAK_HEIGHT = 16;       // density peaks here (doubled)
const TREE_DENSITY_HALFWIDTH = 28; // density goes to 0 this far above/below peak (doubled)

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
  if (y > 32)                return BAND.rock;       // doubled with heightfield
  if (y > 16)                return BAND.grassMid;   // doubled with heightfield
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

  // Trees (LOD 0) + sparse billboards (LOD 1). LOD 2 = nothing.
  const trees = lod === 0 ? placeTrees(cx, cz, seed, localSegs, TREE_GRID_PITCH) : [];
  const billboards = lod === 1 ? placeTrees(cx, cz, seed, localSegs, TREE_GRID_PITCH * 3) : [];

  return { positions, indices, normals, colors, trees, billboards };
}

// Deterministic tree placement for a chunk.
// Returns Array<{ x, y, z, scale, tint, rotation }>. `pitch` controls density.
function placeTrees(cx, cz, seed, localSegs, pitch) {
  const out = [];
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  for (let j = 0; j < CHUNK_SIZE; j += pitch) {
    for (let i = 0; i < CHUNK_SIZE; i += pitch) {
      // Deterministic jitter inside the cell
      const cellX = x0 + i, cellZ = z0 + j;
      const j1 = hash2(Math.floor(cellX), Math.floor(cellZ), seed | 0);
      const j2 = hash2(Math.floor(cellX) + 11, Math.floor(cellZ) + 17, seed ^ 0x55);
      const x = cellX + (j1 - 0.5) * pitch * 0.85;
      const z = cellZ + (j2 - 0.5) * pitch * 0.85;
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
      if (slope > 2.8) continue;     // doubled with heightfield amplitude
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
