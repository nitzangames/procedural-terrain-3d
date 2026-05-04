import { describe, it, expect } from 'vitest';
import { ChunkRunner } from '../lib/terrain/chunk-runner.js';
import { buildRiverGraph } from '../lib/terrain/river-graph.js';

describe('ChunkRunner (main-thread fallback)', () => {
  it('runs a chunk synchronously and returns buffers', async () => {
    const seed = 42;
    const graph = buildRiverGraph({ seed, gridN: 64, worldSize: 16000 });
    const runner = new ChunkRunner({ seed, riverSegments: graph.segments });
    const out = await runner.build({ cx: 0, cz: 0, lod: 0, vertexGrid: 16 });
    expect(out.positions).toBeInstanceOf(Float32Array);
    expect(out.indices).toBeInstanceOf(Uint32Array);
    expect(out.normals).toBeInstanceOf(Float32Array);
    expect(out.colors).toBeInstanceOf(Float32Array);
    expect(Array.isArray(out.trees)).toBe(true);
  });
});
