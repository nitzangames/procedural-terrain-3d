// Free-fly camera input. Mutates a target THREE.PerspectiveCamera each frame.
// Desktop: WASD + mouse drag-to-look + wheel-throttle + shift-boost.
// Mobile: split-screen virtual stick (left) + drag-to-look (right) + pinch throttle + boost button.

const KEY_MAP = {
  KeyW: 'fwd', KeyA: 'left', KeyS: 'back', KeyD: 'right',
  Space: 'up', ShiftLeft: 'boost', ShiftRight: 'boost', KeyQ: 'down', KeyE: 'up',
};

// How fast the camera transform catches up to input (smoothing time constant in seconds).
// Lower = snappier; higher = smoother but laggier. Mouse polling at 1000 Hz vs render at
// 120 Hz means raw event accumulation jitters frame-to-frame; lerping toward the target
// absorbs that without noticeable lag. Same trick as MiniGT / HotLap camera follow.
const SMOOTH_TAU = 0.040;

export class FlyController {
  constructor({ THREE, camera, domElement }) {
    this.THREE = THREE;
    this.camera = camera;
    this.dom = domElement;
    // Targets — accumulated by input handlers
    this.yaw = 0;
    this.pitch = 0;
    // Smoothed transform — what the camera actually uses
    this.smoothedYaw = 0;
    this.smoothedPitch = 0;
    this.speed = 80;            // m/s base
    this.boost = false;
    this.input = { fwd: 0, back: 0, left: 0, right: 0, up: 0, down: 0 };
    this._mouseLook = { active: false, lastX: 0, lastY: 0 };
    this._touch = { lookId: null, lookLastX: 0, lookLastY: 0,
                    stickId: null, stickStartX: 0, stickStartY: 0, stickX: 0, stickY: 0,
                    pinchA: null, pinchB: null, pinchStartDist: 0, pinchStartSpeed: 0 };
    // Pre-allocated working objects so update() never allocates per frame
    this._yawQ = new THREE.Quaternion();
    this._pitchQ = new THREE.Quaternion();
    this._yawAxis = new THREE.Vector3(0, 1, 0);
    this._pitchAxis = new THREE.Vector3(1, 0, 0);
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._move = new THREE.Vector3();
    this._smoothedVel = new THREE.Vector3();
    this._targetVel = new THREE.Vector3();
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
    // Frame-rate-independent exponential smoothing toward target yaw/pitch.
    // k = 1 - exp(-dt / tau)  →  smaller tau = snappier, larger = smoother.
    const k = 1 - Math.exp(-dt / SMOOTH_TAU);
    this.smoothedYaw   += (this.yaw   - this.smoothedYaw)   * k;
    this.smoothedPitch += (this.pitch - this.smoothedPitch) * k;

    this._yawQ.setFromAxisAngle(this._yawAxis,   this.smoothedYaw);
    this._pitchQ.setFromAxisAngle(this._pitchAxis, this.smoothedPitch);
    this.camera.quaternion.copy(this._yawQ).multiply(this._pitchQ);

    const speed = this.speed * (this.boost ? 3 : 1);
    this._fwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this._right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);

    // Build the desired velocity from input, then smooth it the same way as look —
    // this absorbs dt jitter so position glides instead of stepping by uneven amounts.
    this._targetVel.set(0, 0, 0);
    this._targetVel.addScaledVector(this._fwd,   (this.input.fwd  - this.input.back));
    this._targetVel.addScaledVector(this._right, (this.input.right - this.input.left));
    this._targetVel.addScaledVector(this._up,    (this.input.up   - this.input.down));
    if (this._targetVel.lengthSq() > 0) {
      this._targetVel.normalize().multiplyScalar(speed);
    }
    this._smoothedVel.x += (this._targetVel.x - this._smoothedVel.x) * k;
    this._smoothedVel.y += (this._targetVel.y - this._smoothedVel.y) * k;
    this._smoothedVel.z += (this._targetVel.z - this._smoothedVel.z) * k;

    this.camera.position.x += this._smoothedVel.x * dt;
    this.camera.position.y += this._smoothedVel.y * dt;
    this.camera.position.z += this._smoothedVel.z * dt;
  }
}
