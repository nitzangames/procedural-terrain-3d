import { describe, it, expect } from 'vitest';
import { computeDesiredChunks, lodForDistance } from '../lib/terrain/chunk-manager.js';

describe('lodForDistance', () => {
  it('returns 0 within the LOD0 ring', () => {
    expect(lodForDistance(100, { l0: 768, l1: 1536, l2: 3072 })).toBe(0);
  });
  it('returns 1 in the LOD1 ring', () => {
    expect(lodForDistance(1000, { l0: 768, l1: 1536, l2: 3072 })).toBe(1);
  });
  it('returns 2 in the LOD2 ring', () => {
    expect(lodForDistance(2500, { l0: 768, l1: 1536, l2: 3072 })).toBe(2);
  });
  it('returns -1 outside view distance', () => {
    expect(lodForDistance(5000, { l0: 768, l1: 1536, l2: 3072 })).toBe(-1);
  });
});

describe('computeDesiredChunks', () => {
  it('produces a square ring centered on the camera chunk', () => {
    const set = computeDesiredChunks({ camCx: 0, camCz: 0 }, { l0: 256, l1: 512, l2: 1024 }, 256);
    expect(set.has('0,0')).toBe(true);
    expect(set.has('-2,0')).toBe(true);
    expect(set.has('2,0')).toBe(true);
    expect(set.has('5,0')).toBe(false);
  });
  it('returns one entry per chunk with its LOD', () => {
    const set = computeDesiredChunks({ camCx: 0, camCz: 0 }, { l0: 256, l1: 512, l2: 1024 }, 256);
    expect(set.get('0,0')).toBe(0);
    // Distance to (3, 0) = ~768m → in LOD2 (since LOD0 ends at 256m, LOD1 at 512m)
    const v = set.get('3,0');
    expect(v === 2 || v === -1).toBe(true);
  });
});
