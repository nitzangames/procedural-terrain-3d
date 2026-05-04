import { describe, it, expect } from 'vitest';
import { buildRiverGraph } from '../lib/terrain/river-graph.js';
import { WATER_LEVEL, terrainHeight } from '../lib/terrain/height.js';

describe('buildRiverGraph', () => {
  it('is deterministic for a fixed seed', () => {
    const a = buildRiverGraph({ seed: 42, gridN: 64, worldSize: 16000 });
    const b = buildRiverGraph({ seed: 42, gridN: 64, worldSize: 16000 });
    expect(a.segments.length).toBe(b.segments.length);
    if (a.segments.length > 0) {
      expect(a.segments[0]).toEqual(b.segments[0]);
    }
  });

  it('changes with seed', () => {
    const a = buildRiverGraph({ seed: 1, gridN: 64, worldSize: 16000 });
    const b = buildRiverGraph({ seed: 2, gridN: 64, worldSize: 16000 });
    // Either count differs, or first segment differs
    const sameCount = a.segments.length === b.segments.length;
    const sameFirst = sameCount && a.segments.length > 0 &&
      a.segments[0].x0 === b.segments[0].x0 &&
      a.segments[0].z0 === b.segments[0].z0;
    expect(sameFirst).toBe(false);
  });

  it('produces some rivers for a typical seed', () => {
    const g = buildRiverGraph({ seed: 7, gridN: 128, worldSize: 32000 });
    expect(g.segments.length).toBeGreaterThan(10);
  });

  it('every segment has positive width', () => {
    const g = buildRiverGraph({ seed: 11, gridN: 64, worldSize: 16000 });
    for (const s of g.segments) {
      expect(s.width).toBeGreaterThan(0);
    }
  });

  it('every traced river ends at ocean OR at a lake basin', () => {
    const g = buildRiverGraph({ seed: 13, gridN: 64, worldSize: 16000 });
    for (const s of g.segments) {
      if (!s.isTerminal) continue;
      const endHeight = terrainHeight(s.x1, s.z1, 13);
      // Terminal segment ends in ocean (y < water level) OR at a lake (recorded in graph)
      const isOcean = endHeight < WATER_LEVEL;
      const isLake = s.endsInLake === true;
      expect(isOcean || isLake).toBe(true);
    }
  });

  it('returns lakes array', () => {
    const g = buildRiverGraph({ seed: 15, gridN: 64, worldSize: 16000 });
    expect(Array.isArray(g.lakes)).toBe(true);
  });

  it('does not mis-attribute lakes to unrelated segments', () => {
    // Bug repro: when a river source is itself a basin, the prior fix
    // mistakenly marked an unrelated previous-trace segment as endsInLake.
    // Now verify that endsInLake is set only on segments whose end-point
    // (x1, z1) is actually a lake center.
    const g = buildRiverGraph({ seed: 13, gridN: 64, worldSize: 16000 });
    for (const s of g.segments) {
      if (!s.endsInLake) continue;
      // The segment must end near at least one lake center
      let near = false;
      for (const l of g.lakes) {
        const d = Math.hypot(s.x1 - l.x, s.z1 - l.z);
        if (d <= l.radius + 60) { near = true; break; }
      }
      expect(near).toBe(true);
    }
  });
});
