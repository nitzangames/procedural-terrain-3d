// Wraps a Web Worker behind the same async `build()` API as ChunkRunner.
// Caller can substitute one for the other without other changes.
export class ChunkWorkerProxy {
  constructor({ seed, riverSegments }) {
    this.worker = new Worker(new URL('./chunk-worker.js', import.meta.url), { type: 'module' });
    this.nextId = 1;
    this.pending = new Map();
    // Surface silent failures: a worker that fails to load (404, syntax error, import
    // resolution) won't throw from `new Worker(...)` but will fire 'error' / 'messageerror'.
    this.worker.addEventListener('error', (e) => {
      console.error('[chunk-worker] error:', e.message || e, e.filename, e.lineno);
    });
    this.worker.addEventListener('messageerror', (e) => {
      console.error('[chunk-worker] messageerror:', e);
    });
    this.worker.onmessage = (e) => {
      const m = e.data;
      const cb = this.pending.get(m.id);
      if (!cb) return;
      this.pending.delete(m.id);
      cb(m);
    };
    // Initialize
    this.ready = new Promise((resolve) => {
      const id = this.nextId++;
      this.pending.set(id, () => resolve());
      this.worker.postMessage({ type: 'init', id, seed, riverSegments });
    });
  }
  async build(req) {
    await this.ready;
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.pending.set(id, (m) => resolve({
        positions: m.positions, indices: m.indices, normals: m.normals, colors: m.colors, trees: m.trees,
      }));
      this.worker.postMessage({ type: 'build', id, ...req });
    });
  }
  dispose() {
    this.worker.terminate();
    this.pending.clear();
  }
}
