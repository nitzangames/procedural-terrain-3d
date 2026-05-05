// Free-fly camera input. Mutates a target THREE.PerspectiveCamera each frame.
// Desktop: WASD + mouse drag-to-look + wheel-throttle + shift-boost.
// Mobile: split-screen virtual stick (left) + drag-to-look (right) + pinch throttle + boost button.
//
// Mouse input model (Boba-Drop-style polling):
// - Pointer event handlers do ZERO math. They just store the latest clientX/Y.
// - update() samples the latest position once per frame and computes a single delta from
//   the last frame's sample. The OS may deliver any number of events between two frames;
//   per-frame sampling guarantees one delta per frame regardless of event timing, which
//   removes the per-frame jitter that comes from variable event counts.

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
    // BobaDrop-style smoothing: smoothedYaw/Pitch lerp toward yaw/pitch at 0.5/frame.
    // Matches the dropperX pattern (`dropperX += (targetX - dropperX) * 0.5`) — visual
    // catch-up over a few frames absorbs residual jitter without obvious lag.
    this.smoothedYaw = 0;
    this.smoothedPitch = 0;
    this.speed = 80;            // m/s base
    this.boost = false;
    this.input = { fwd: 0, back: 0, left: 0, right: 0, up: 0, down: 0 };
    // Mouse drag state — handlers only store position; update() reads it.
    this._mouseLook = {
      active: false,
      latestX: 0, latestY: 0,        // most recent pointer position from any event
      lastSampledX: 0, lastSampledY: 0, // position at the previous frame's sample
    };
    this._touch = { lookId: null, lookLastX: 0, lookLastY: 0,
                    stickId: null, stickStartX: 0, stickStartY: 0, stickX: 0, stickY: 0,
                    pinchA: null, pinchB: null, pinchStartDist: 0, pinchStartSpeed: 0 };
    // Pre-allocated working objects so update() never allocates per frame.
    this._yawQ = new THREE.Quaternion();
    this._pitchQ = new THREE.Quaternion();
    this._yawAxis = new THREE.Vector3(0, 1, 0);
    this._pitchAxis = new THREE.Vector3(1, 0, 0);
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._move = new THREE.Vector3();
    this._bind();
  }

  _bind() {
    addEventListener('keydown', (e) => { const m = KEY_MAP[e.code]; if (!m) return; if (m === 'boost') this.boost = true; else this.input[m] = 1; });
    addEventListener('keyup',   (e) => { const m = KEY_MAP[e.code]; if (!m) return; if (m === 'boost') this.boost = false; else this.input[m] = 0; });
    addEventListener('wheel',   (e) => { this.speed = Math.max(20, Math.min(800, this.speed * (e.deltaY < 0 ? 1.15 : 0.87))); }, { passive: true });

    const dom = this.dom;
    // Mouse: handlers do no math, just record latest position. Pointer capture keeps
    // events flowing if the cursor leaves the canvas during a drag.
    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      this._mouseLook.active = true;
      this._mouseLook.latestX = e.clientX;
      this._mouseLook.latestY = e.clientY;
      this._mouseLook.lastSampledX = e.clientX;
      this._mouseLook.lastSampledY = e.clientY;
      try { dom.setPointerCapture(e.pointerId); } catch {}
    });
    dom.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !this._mouseLook.active) return;
      this._mouseLook.latestX = e.clientX;
      this._mouseLook.latestY = e.clientY;
    });
    const releaseMouse = (e) => {
      if (e.pointerType !== 'mouse') return;
      this._mouseLook.active = false;
      try { if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId); } catch {}
    };
    dom.addEventListener('pointerup',     releaseMouse);
    dom.addEventListener('pointercancel', releaseMouse);

    // Touch (multi-pointer logic stays on touch events — pointer events would require
    // refactoring stick + look + pinch tracking; touch events already work reasonably).
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
    // ── Mouse look: poll the latest pointer position once per frame ──────────────
    // The event handler stored latestX/Y; we compute one delta per frame here, no
    // matter how many events fired in between. This keeps per-frame yaw deltas
    // proportional to per-frame mouse motion (not to per-frame event count).
    if (this._mouseLook.active) {
      const dx = this._mouseLook.latestX - this._mouseLook.lastSampledX;
      const dy = this._mouseLook.latestY - this._mouseLook.lastSampledY;
      this._mouseLook.lastSampledX = this._mouseLook.latestX;
      this._mouseLook.lastSampledY = this._mouseLook.latestY;
      if (dx !== 0 || dy !== 0) {
        this.yaw   -= dx * 0.0025;
        this.pitch -= dy * 0.0025;
        this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch));
      }
    }

    // ── Lerp smoothed values toward target (BobaDrop's `dropperX += (targetX - dropperX) * 0.5`) ──
    this.smoothedYaw   += (this.yaw   - this.smoothedYaw)   * 0.5;
    this.smoothedPitch += (this.pitch - this.smoothedPitch) * 0.5;

    this._yawQ.setFromAxisAngle(this._yawAxis,   this.smoothedYaw);
    this._pitchQ.setFromAxisAngle(this._pitchAxis, this.smoothedPitch);
    this.camera.quaternion.copy(this._yawQ).multiply(this._pitchQ);

    const speed = this.speed * (this.boost ? 3 : 1);
    this._fwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this._right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);

    this._move.set(0, 0, 0);
    this._move.addScaledVector(this._fwd,   (this.input.fwd  - this.input.back));
    this._move.addScaledVector(this._right, (this.input.right - this.input.left));
    this._move.addScaledVector(this._up,    (this.input.up   - this.input.down));
    if (this._move.lengthSq() > 0) {
      this._move.normalize().multiplyScalar(speed * dt);
      this.camera.position.x += this._move.x;
      this.camera.position.y += this._move.y;
      this.camera.position.z += this._move.z;
    }
  }
}
