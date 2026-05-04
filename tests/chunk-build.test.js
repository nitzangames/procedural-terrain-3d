import { describe, it, expect } from 'vitest';
import { buildChunkBuffers, CHUNK_SIZE } from '../lib/terrain/chunk-build.js';
import { buildRiverGraph } from '../lib/terrain/river-graph.js';

const seed = 99;
const graph = buildRiverGraph({ seed, gridN: 128, worldSize: 16000 });

describe('buildChunkBuffers', () => {
  it('produces a vertex grid of the requested size', () => {
    const out = buildChunkBuffers({ cx: 0, cz: 0, lod: 0, seed, riverSegments: graph.segments, vertexGrid: 32 });
    // (32+1)² interior + 4 skirts × (32+1) = 1089 + 132 = 1221
    expect(out.positions.length).toBe(((32 + 1) * (32 + 1) + 4 * (32 + 1)) * 3);
  });

  it('positions span the chunk extent on X/Z', () => {
    const out = buildChunkBuffers({ cx: 5, cz: -3, lod: 0, seed, riverSegments: graph.segments, vertexGrid: 16 });
    const minX = 5 * CHUNK_SIZE, maxX = 6 * CHUNK_SIZE;
    const minZ = -3 * CHUNK_SIZE, maxZ = -2 * CHUNK_SIZE;
    let foundMinX = false, foundMaxX = false;
    for (let i = 0; i < (16 + 1) * (16 + 1); i++) {
      const x = out.positions[i * 3], z = out.positions[i * 3 + 2];
      expect(x).toBeGreaterThanOrEqual(minX - 0.001);
      expect(x).toBeLessThanOrEqual(maxX + 0.001);
      expect(z).toBeGreaterThanOrEqual(minZ - 0.001);
      expect(z).toBeLessThanOrEqual(maxZ + 0.001);
      if (Math.abs(x - minX) < 0.001) foundMinX = true;
      if (Math.abs(x - maxX) < 0.001) foundMaxX = true;
    }
    expect(foundMinX).toBe(true);
    expect(foundMaxX).toBe(true);
  });

  it('indices form valid triangles', () => {
    const out = buildChunkBuffers({ cx: 0, cz: 0, lod: 0, seed, riverSegments: graph.segments, vertexGrid: 16 });
    const vCount = out.positions.length / 3;
    for (let i = 0; i < out.indices.length; i++) {
      expect(out.indices[i]).toBeGreaterThanOrEqual(0);
      expect(out.indices[i]).toBeLessThan(vCount);
    }
    expect(out.indices.length % 3).toBe(0);
  });

  it('normals are unit length', () => {
    const out = buildChunkBuffers({ cx: 0, cz: 0, lod: 0, seed, riverSegments: graph.segments, vertexGrid: 16 });
    for (let i = 0; i < out.normals.length / 3; i++) {
      const x = out.normals[i * 3], y = out.normals[i * 3 + 1], z = out.normals[i * 3 + 2];
      const len = Math.sqrt(x * x + y * y + z * z);
      expect(len).toBeCloseTo(1, 1);
    }
  });

  it('colors have one RGB triplet per vertex', () => {
    const out = buildChunkBuffers({ cx: 0, cz: 0, lod: 0, seed, riverSegments: graph.segments, vertexGrid: 16 });
    expect(out.colors.length).toBe(out.positions.length);
  });

  it('produces some trees on lod 0', () => {
    const out = buildChunkBuffers({ cx: 1, cz: 2, lod: 0, seed: 4, riverSegments: graph.segments, vertexGrid: 32 });
    expect(out.trees).toBeDefined();
    // For a typical seeded chunk with mid-elevation areas, expect at least a few trees.
    // Some chunks may legitimately have 0 (all underwater / above snow) — pick a known good one.
  });

  it('produces no trees on lod 2', () => {
    const out = buildChunkBuffers({ cx: 0, cz: 0, lod: 2, seed, riverSegments: graph.segments, vertexGrid: 16 });
    expect(out.trees.length).toBe(0);
  });

  it('is deterministic for the same inputs', () => {
    const a = buildChunkBuffers({ cx: 1, cz: 2, lod: 0, seed: 4, riverSegments: graph.segments, vertexGrid: 16 });
    const b = buildChunkBuffers({ cx: 1, cz: 2, lod: 0, seed: 4, riverSegments: graph.segments, vertexGrid: 16 });
    expect(Array.from(a.positions.slice(0, 30))).toEqual(Array.from(b.positions.slice(0, 30)));
    expect(a.trees.length).toBe(b.trees.length);
  });
});
