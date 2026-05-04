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
// near=1, far=4500 keeps the depth-buffer ratio at ~4500:1 (was 12000:1 with 0.5/6000),
// which fixes horizon flicker from poor depth precision at long distances.
const camera = new THREE.PerspectiveCamera(60, 1, 1, 4500);
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

// Capture mode: ?capture=1 hides HUD + settings (used for thumbnails / fixtures)
const captureMode = new URLSearchParams(location.search).get('capture') === '1';

const fly = new FlyController({ THREE, camera, domElement: canvas });
const hud = captureMode ? null : buildHUD(document.body);
const settings = captureMode ? null : buildSettings({
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
  if (hud) hud.update(camera, dt);
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
