import { CHUNK_SIZE } from './chunk-build.js';
import { buildTreeInstancedMesh, buildBillboardInstancedMesh } from './trees.js';

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
  constructor({ THREE, scene, runner, terrainMaterial, treeMaterial, treeGeometry,
                billboardMaterial, billboardGeometry, perfMode = 'high' }) {
    this.THREE = THREE;
    this.scene = scene;
    this.runner = runner;
    this.terrainMaterial = terrainMaterial;
    this.treeMaterial = treeMaterial;
    this.treeGeometry = treeGeometry;
    this.billboardMaterial = billboardMaterial;
    this.billboardGeometry = billboardGeometry;
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
    if (out.billboards && out.billboards.length > 0 && lod === 1 && this.billboardGeometry) {
      treeMesh = buildBillboardInstancedMesh(THREE, this.billboardGeometry, this.billboardMaterial, out.billboards);
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
