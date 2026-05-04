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
  const treeMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
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
