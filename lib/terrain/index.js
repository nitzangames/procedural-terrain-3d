import { buildRiverGraph } from './river-graph.js';
import { ChunkManager } from './chunk-manager.js';
import { ChunkRunner } from './chunk-runner.js';
import { ChunkWorkerProxy } from './chunk-worker-proxy.js';
import { buildTerrainMaterial, applyStyle, buildSkyDome, STYLES } from './style-system.js';
import { buildWaterPlane } from './water.js';
import { buildConiferGeometry, buildBillboardGeometry, buildBillboardMaterial } from './trees.js';
import { terrainHeight } from './height.js';
import { riverDepthAt } from './carve.js';
import { biomeAt, bandsAt } from '../biomes.js';
import { buildScatterRegistry } from '../scatter/index.js';

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
  let runnerType;
  try {
    runner = new ChunkWorkerProxy({ seed, riverSegments: graph.segments });
    runnerType = 'worker';
  } catch (err) {
    console.warn('[terrain] Worker unavailable, falling back to main-thread chunk gen.', err);
    runner = new ChunkRunner({ seed, riverSegments: graph.segments });
    runnerType = 'main-thread';
  }
  console.log('[terrain] chunk runner:', runnerType, 'seed:', seed);

  // 3. Materials, water, lights.
  const terrainMaterial = buildTerrainMaterial(THREE);
  // MeshPhongMaterial supports flatShading; MeshLambertMaterial in r128 doesn't.
  const treeMaterial = new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 0 });
  // Wind sway: cone vertices (y > 1.2) sway based on time + per-instance world-XZ phase.
  // Trunk vertices (y ≤ 1.2) stay fixed so the base doesn't visibly slide.
  treeMaterial.userData.uTime = { value: 0 };
  treeMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = treeMaterial.userData.uTime;
    shader.vertexShader =
      `uniform float uTime;\n` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
         {
           // instanceMatrix[3].xyz is the per-tree translation (world XZ via modelMatrix).
           vec3 _instOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
           float _swayH = max(0.0, position.y - 1.2);
           float _phase = _instOrigin.x * 0.05 + _instOrigin.z * 0.03;
           transformed.x += sin(uTime * 1.2 + _phase) * 0.020 * _swayH;
           transformed.z += cos(uTime * 0.9 + _phase * 1.1) * 0.015 * _swayH;
         }
         #endif`
      );
  };
  const treeGeometry = buildConiferGeometry(THREE);
  const billboardMaterial = buildBillboardMaterial(THREE);
  const billboardGeometry = buildBillboardGeometry(THREE);
  // Water plane is sized to comfortably exceed camera far-plane; we move it to follow
  // the camera in XZ each frame so the edge is never visible and depth precision stays
  // useful (a fixed 64 km plane at origin caused horizon flicker when viewed from far).
  const water = buildWaterPlane(THREE, 16000);
  scene.add(water);

  const skyDome = buildSkyDome(THREE);
  scene.add(skyDome);

  // Light intensities tuned so vertex colors (biome bands) don't clip toward
  // white — total scene exposure ~1.0 instead of 1.55.
  const sun = new THREE.DirectionalLight(0xffffff, 0.75);
  sun.position.set(80, 120, 60);
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xb8e0ff, 0x6a8050, 0.35);
  scene.add(hemi);

  // 4. Style.
  const styleName = opts.style || 'cartograph';
  applyStyle(THREE, scene, terrainMaterial, sun, hemi, water, styleName, skyDome);

  // 5. Scatter registry — biome-driven mesh choice per chunk. The conifer
  // geometry is already built above (treeGeometry); rebuild the full registry
  // so cacti + ice spikes are ready too.
  const scatterGeometries = opts.scatterGeometries || buildScatterRegistry(THREE);

  // 6. Chunk manager.
  const perfMode = opts.perfMode === 'auto' ? 'high' : (opts.perfMode || 'high');
  const cm = new ChunkManager({
    THREE, scene, runner, terrainMaterial, treeMaterial, treeGeometry,
    billboardMaterial, billboardGeometry, perfMode,
    biomeAt, scatterGeometries,
  });

  return {
    seed,
    riverSegments: graph.segments,
    lakes: graph.lakes,
    sun,
    hemi,
    water,
    skyDome,
    terrainMaterial,
    update(cameraPos) {
      cm.update(cameraPos);
      water.position.x = cameraPos.x;
      water.position.z = cameraPos.z;
      skyDome.position.copy(cameraPos);
      // Drive the water + tree wind shaders. Seconds since page load is monotonic and
      // independent of any per-frame dt drift, so wave phase stays continuous through stalls.
      const t = performance.now() / 1000;
      water.material.userData.uTime.value = t;
      treeMaterial.userData.uTime.value = t;
    },
    getHeight(x, z) { return terrainHeight(x, z, seed); },
    getRiverWidthAt(x, z) {
      const d = riverDepthAt(x, z, graph.segments, 1);
      return d > 0 ? 1 : 0;
    },
    setStyle(name) { applyStyle(THREE, scene, terrainMaterial, sun, hemi, water, name, skyDome); },
    setPerfMode(mode) { cm.setPerfMode(mode === 'auto' ? 'high' : mode); },
    dispose() {
      cm.dispose();
      scene.remove(water);
      water.geometry.dispose();
      water.material.dispose();
      scene.remove(skyDome);
      skyDome.geometry.dispose();
      skyDome.material.dispose();
      scene.remove(sun);
      scene.remove(hemi);
      terrainMaterial.dispose();
      treeMaterial.dispose();
      treeGeometry.dispose();
      billboardMaterial.dispose();
      billboardGeometry.dispose();
    },
  };
}
