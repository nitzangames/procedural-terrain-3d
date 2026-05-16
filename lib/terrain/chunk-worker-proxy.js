// Wraps a Web Worker behind the same async `build()` API as ChunkRunner.
// Caller can substitute one for the other without other changes.
import { VERSION } from '../version.js';
export class ChunkWorkerProxy {
  constructor({ seed, riverSegments }) {
    // Cache-bust the worker URL with the build VERSION so the browser refetches
    // worker code (and its module imports) on every version bump. Without this
    // the worker can serve stale code from cache long after the main thread
    // has reloaded.
    const workerUrl = new URL('./chunk-worker.js', import.meta.url);
    workerUrl.searchParams.set('v', VERSION);
    this.worker = new Worker(workerUrl, { type: 'module' });
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
