import { createTerrain } from '../lib/terrain/index.js';
import { FlyController } from './fly-controller.js';
import { buildHUD } from './hud.js';
import { buildSettings } from './settings.js';
import { PerfProbe } from './perf-probe.js';
import { biomeAt, BIOMES } from '../lib/biomes.js';
import { VERSION } from '../lib/version.js';

console.log('[procedural-terrain] v' + VERSION);

const THREE = window.THREE;
const canvas = document.getElementById('game');
const boot = document.getElementById('boot');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
// Camera far bumped to 8000 so distant peaks (~600m+ in arctic regions, after
// HEIGHT_AMP=5) stay drawn.
const camera = new THREE.PerspectiveCamera(60, 1, 1, 8000);
camera.position.set(0, 500, 0);
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
const VALID_STYLES = new Set(['lowpoly', 'stylized', 'realistic', 'cartograph', 'topographic']);
// One-shot migration: 'ww1' was renamed to 'cartograph'. Anyone who picked it before
// the rename gets seamlessly carried over instead of falling back to lowpoly.
if (storedStyle === 'ww1') {
  localStorage.setItem(settingsKey, 'cartograph');
}
const migratedStyle = storedStyle === 'ww1' ? 'cartograph' : storedStyle;
const initialStyle = VALID_STYLES.has(migratedStyle) ? migratedStyle : 'cartograph';

const terrain = createTerrain({
  THREE, scene, renderer,
  style: initialStyle,
  perfMode: 'high',
});

// Capture mode: ?capture=1 hides HUD + settings (used for thumbnails / fixtures)
const captureMode = new URLSearchParams(location.search).get('capture') === '1';

const fly = new FlyController({ THREE, camera, domElement: canvas });
const hud = captureMode ? null : buildHUD(document.body, VERSION);
const settings = captureMode ? null : buildSettings({
  parent: document.body,
  initialStyle,
  onStyleChange: (s) => terrain.setStyle(s),
});
const probe = new PerfProbe({ frameCount: 60, lowFpsThreshold: 28 });
probe.start((mode) => terrain.setPerfMode(mode));

// Place camera above terrain at spawn. With HEIGHT_AMP=5 arctic peaks reach
// ~700m; spawn well above so the first frame isn't inside a mountain.
const spawnY = terrain.getHeight(0, 0) + 500;
camera.position.set(0, spawnY, 0);

// --- Per-frame biome atmosphere lerp -----------------------------------
// As the camera flies into different biomes, smoothly interpolate the scene's
// sky/fog/sun/hemi toward that biome's palette. Reuses one set of THREE.Color
// objects so applyBiome doesn't allocate per frame.
const _biomeSky  = new THREE.Color();
const _biomeFog  = new THREE.Color();
const _biomeSun  = new THREE.Color();
const _biomeHemS = new THREE.Color();
const _biomeHemG = new THREE.Color();
const BIOME_LERP = 0.02;
function lerp(a, b, t) { return a + (b - a) * t; }
function applyBiomeAtCamera() {
  const b = biomeAt(camera.position.x, camera.position.z);
  if (!scene.fog || !terrain.sun || !terrain.hemi) return;
  _biomeSky.setRGB(b.sky[0], b.sky[1], b.sky[2]);
  if (scene.background && scene.background.lerp) scene.background.lerp(_biomeSky, BIOME_LERP);
  _biomeFog.setRGB(b.fog[0], b.fog[1], b.fog[2]);
  scene.fog.color.lerp(_biomeFog, BIOME_LERP);
  if (scene.fog.near !== undefined) scene.fog.near = lerp(scene.fog.near, b.fogNear, BIOME_LERP);
  if (scene.fog.far  !== undefined) scene.fog.far  = lerp(scene.fog.far,  b.fogFar,  BIOME_LERP);
  _biomeSun.setRGB(b.sun[0], b.sun[1], b.sun[2]);
  terrain.sun.color.lerp(_biomeSun, BIOME_LERP);
  _biomeHemS.setRGB(b.hemiSky[0], b.hemiSky[1], b.hemiSky[2]);
  _biomeHemG.setRGB(b.hemiGround[0], b.hemiGround[1], b.hemiGround[2]);
  terrain.hemi.color.lerp(_biomeHemS, BIOME_LERP);
  terrain.hemi.groundColor.lerp(_biomeHemG, BIOME_LERP);
  terrain.hemi.intensity = lerp(terrain.hemi.intensity, b.hemiIntensity, BIOME_LERP);
}

let lastFrame = performance.now();
let bootHidden = false;

function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  fly.update(dt);
  terrain.update(camera.position);
  applyBiomeAtCamera();
  if (hud) hud.update(camera, dt, fly);
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
if (window.PlaySDK && typeof window.PlaySDK.onReady === 'function') {
  window.PlaySDK.onReady(() => {});
}
