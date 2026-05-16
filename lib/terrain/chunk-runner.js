import { buildChunkBuffers } from './chunk-build.js';
import { biomeAt, bandsAt } from '../biomes.js';

// Main-thread fallback "runner" with the same async API as the worker proxy.
// Used when Worker construction fails (sandboxed iframes, COOP/COEP issues, tests).
export class ChunkRunner {
  constructor({ seed, riverSegments }) {
    this.seed = seed;
    this.riverSegments = riverSegments;
  }
  async build({ cx, cz, lod, vertexGrid }) {
    return buildChunkBuffers({
      cx, cz, lod, vertexGrid,
      seed: this.seed,
      riverSegments: this.riverSegments,
      biomeAt,
      bandsAt,
    });
  }
  dispose() { /* nothing to release */ }
}
