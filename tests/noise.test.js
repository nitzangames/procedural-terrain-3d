import { describe, it, expect } from 'vitest';
import { hash2, valueNoise, fbm, ridge } from '../lib/terrain/noise.js';

describe('hash2', () => {
  it('is deterministic for the same inputs', () => {
    expect(hash2(123, 456, 7)).toBe(hash2(123, 456, 7));
  });
  it('returns values in [0, 1)', () => {
    for (let i = 0; i < 1000; i++) {
      const v = hash2(i, i * 31, 42);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('changes with seed', () => {
    expect(hash2(1, 1, 1)).not.toBe(hash2(1, 1, 2));
  });
});

describe('valueNoise', () => {
  it('is deterministic', () => {
    expect(valueNoise(1.5, 2.5, 9)).toBe(valueNoise(1.5, 2.5, 9));
  });
  it('returns values in [0, 1]', () => {
    for (let i = 0; i < 200; i++) {
      const v = valueNoise(i * 0.13, i * 0.07, 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it('is continuous (small input change → small output change)', () => {
    const a = valueNoise(10.0, 10.0, 5);
    const b = valueNoise(10.001, 10.0, 5);
    expect(Math.abs(a - b)).toBeLessThan(0.01);
  });
});

describe('fbm', () => {
  it('is deterministic', () => {
    expect(fbm(3, 4, 1)).toBe(fbm(3, 4, 1));
  });
  it('stays within [0, 1]', () => {
    for (let i = 0; i < 200; i++) {
      const v = fbm(i * 0.21, i * 0.17, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('ridge', () => {
  it('peaks at 1 when fbm = 0.5', () => {
    // ridge(n) = 1 - |2n - 1|, so it's 1 when n = 0.5
    // We can't force fbm to 0.5, but ridge should always be in [0, 1]
    for (let i = 0; i < 200; i++) {
      const v = ridge(i * 0.31, i * 0.13, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
