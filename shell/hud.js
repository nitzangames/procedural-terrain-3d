export function buildHUD(parent, version = '') {
  const debug = new URLSearchParams(location.search).get('debug') === '1';
  const root = document.createElement('div');
  root.style.cssText = `
    position:fixed; inset:0; pointer-events:none; font-family:ui-monospace,Menlo,monospace;
    color:#fff; text-shadow:0 1px 3px rgba(0,0,0,.6);
  `;
  root.innerHTML = `
    <div id="hud-fps" style="position:absolute;top:8px;left:8px;font-size:13px;opacity:.85"></div>
    <div id="hud-alt" style="position:absolute;top:8px;right:8px;font-size:13px;opacity:.85"></div>
    <div id="hud-compass" style="position:absolute;top:8px;left:50%;transform:translateX(-50%);font-size:13px;letter-spacing:.4em">N</div>
    <div id="hud-version" style="position:absolute;bottom:8px;left:8px;font-size:11px;opacity:.55">${version ? 'v' + version : ''}</div>
    <div id="hud-debug" style="position:absolute;bottom:8px;right:8px;font-size:11px;opacity:.85;text-align:right;line-height:1.5;display:${debug ? 'block' : 'none'};background:rgba(0,0,0,.4);padding:6px 8px;border-radius:4px"></div>
  `;
  parent.appendChild(root);
  const fpsEl = root.querySelector('#hud-fps');
  const altEl = root.querySelector('#hud-alt');
  const cmpEl = root.querySelector('#hud-compass');
  const dbgEl = root.querySelector('#hud-debug');
  // Track avg fps AND worst single-frame time per window — average alone hides stutter.
  let frames = 0, last = performance.now(), fps = 0;
  let lastFrame = performance.now(), maxMs = 0, worstMs = 0;
  // Debug stats: rolling max of mouseEvents/dx/dy per window so a single peak is visible.
  let dbgMaxEv = 0, dbgMaxDx = 0, dbgMaxDy = 0;
  let dbgEv = 0, dbgDx = 0, dbgDy = 0;
  return {
    update(camera, dt, fly) {
      frames++;
      const now = performance.now();
      const frameMs = now - lastFrame;
      lastFrame = now;
      if (frameMs > maxMs) maxMs = frameMs;
      if (debug && fly && fly.stats) {
        if (fly.stats.mouseEvents > dbgMaxEv) dbgMaxEv = fly.stats.mouseEvents;
        const adx = Math.abs(fly.stats.lastDx), ady = Math.abs(fly.stats.lastDy);
        if (adx > dbgMaxDx) dbgMaxDx = adx;
        if (ady > dbgMaxDy) dbgMaxDy = ady;
      }
      if (now - last >= 500) {
        fps = (frames * 1000 / (now - last)) | 0;
        worstMs = maxMs | 0;
        dbgEv = dbgMaxEv; dbgDx = dbgMaxDx; dbgDy = dbgMaxDy;
        frames = 0; last = now; maxMs = 0;
        dbgMaxEv = 0; dbgMaxDx = 0; dbgMaxDy = 0;
      }
      fpsEl.textContent = `${fps} fps  ${worstMs}ms peak`;
      altEl.textContent = (camera.position.y | 0) + ' m';
      cmpEl.textContent = compassChar(headingFromCamera(camera));
      if (debug && dbgEl) {
        dbgEl.innerHTML =
          `dt: ${(frameMs).toFixed(2)}ms<br>` +
          `peak mouse events / frame: ${dbgEv}<br>` +
          `peak |dx| px: ${dbgDx}<br>` +
          `peak |dy| px: ${dbgDy}`;
      }
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
