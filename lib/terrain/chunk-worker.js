// Web Worker entrypoint. Runs in worker scope; receives jobs and posts buffers back.
// The worker is created with `new Worker(new URL('./chunk-worker.js', import.meta.url), { type: 'module' })`.
import { buildChunkBuffers } from './chunk-build.js';
import { biomeAt, bandsAt } from '../biomes.js';

let seed = 0;
let riverSegments = [];

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    seed = msg.seed;
    riverSegments = msg.riverSegments;
    self.postMessage({ type: 'ready', id: msg.id });
    return;
  }
  if (msg.type === 'build') {
    const out = buildChunkBuffers({
      cx: msg.cx, cz: msg.cz, lod: msg.lod, vertexGrid: msg.vertexGrid,
      seed, riverSegments, biomeAt, bandsAt,
    });
    self.postMessage(
      { type: 'built', id: msg.id, ...out },
      [out.positions.buffer, out.indices.buffer, out.normals.buffer, out.colors.buffer]
    );
  }
};
