import { describe, it, expect } from 'vitest';
import { distancePointToSegment2D, applyRiverCarve, riverDepthAt } from '../lib/terrain/carve.js';

describe('distancePointToSegment2D', () => {
  it('returns 0 on the segment', () => {
    expect(distancePointToSegment2D(5, 0, 0, 0, 10, 0)).toBeCloseTo(0);
  });
  it('returns perpendicular distance', () => {
    expect(distancePointToSegment2D(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
  });
  it('returns endpoint distance when past the segment', () => {
    expect(distancePointToSegment2D(15, 0, 0, 0, 10, 0)).toBeCloseTo(5);
  });
});

describe('riverDepthAt', () => {
  it('is monotonic with distance from segment', () => {
    const seg = { x0: 0, z0: 0, x1: 100, z1: 0, width: 10 };
    const d0 = riverDepthAt(50, 0, [seg], 4);
    const d1 = riverDepthAt(50, 5, [seg], 4);
    const d2 = riverDepthAt(50, 9, [seg], 4);
    const d3 = riverDepthAt(50, 11, [seg], 4);
    expect(d0).toBeGreaterThan(d1);
    expect(d1).toBeGreaterThan(d2);
    expect(d3).toBe(0);
  });
  it('is exactly the carve depth at the centerline', () => {
    const seg = { x0: 0, z0: 0, x1: 100, z1: 0, width: 10 };
    expect(riverDepthAt(50, 0, [seg], 4)).toBeCloseTo(4);
  });
  it('returns 0 outside any river', () => {
    const seg = { x0: 0, z0: 0, x1: 100, z1: 0, width: 10 };
    expect(riverDepthAt(50, 50, [seg], 4)).toBe(0);
  });
});

describe('applyRiverCarve', () => {
  it('lowers vertices near the river segment', () => {
    const positions = new Float32Array([
      0, 5, 0,    // on segment (will carve)
      0, 5, 50,   // far away (untouched)
    ]);
    const seg = { x0: -10, z0: 0, x1: 10, z1: 0, width: 6 };
    applyRiverCarve(positions, [seg], 4);
    expect(positions[1]).toBeLessThan(5);
    expect(positions[4]).toBe(5);
  });
});
