// Samples instantaneous frame times for `frameCount` frames after activation,
// then calls `cb(mode)` with 'high' or 'low'.
export class PerfProbe {
  constructor({ frameCount = 60, lowFpsThreshold = 28 } = {}) {
    this.frameCount = frameCount;
    this.lowFpsThreshold = lowFpsThreshold;
    this.samples = [];
    this.active = false;
    this.cb = null;
    this._lastT = 0;
  }
  start(cb) {
    this.cb = cb;
    this.active = true;
    this._lastT = performance.now();
  }
  tick() {
    if (!this.active) return;
    const now = performance.now();
    const dt = now - this._lastT;
    this._lastT = now;
    if (dt > 0) this.samples.push(1000 / dt);
    if (this.samples.length >= this.frameCount) {
      this.samples.sort((a, b) => a - b);
      const median = this.samples[Math.floor(this.samples.length / 2)];
      const mode = median < this.lowFpsThreshold ? 'low' : 'high';
      this.active = false;
      this.cb && this.cb(mode);
    }
  }
}
