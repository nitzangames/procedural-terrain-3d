import { describe, it, expect } from 'vitest';
import { terrainHeight, WATER_LEVEL, SNOW_LINE, MAX_HEIGHT_RANGE } from '../lib/terrain/height.js';

describe('terrainHeight', () => {
  it('is deterministic', () => {
    expect(terrainHeight(123.5, 456.5, 42)).toBe(terrainHeight(123.5, 456.5, 42));
  });

  it('changes with seed', () => {
    expect(terrainHeight(0, 0, 1)).not.toBe(terrainHeight(0, 0, 2));
  });

  it('produces both above-water and below-water heights across the world', () => {
    let above = 0, below = 0;
    for (let i = 0; i < 1000; i++) {
      const x = (i * 211) % 5000 - 2500;
      const z = (i * 313) % 5000 - 2500;
      const y = terrainHeight(x, z, 7);
      if (y > WATER_LEVEL) above++;
      else below++;
    }
    expect(above).toBeGreaterThan(100);
    expect(below).toBeGreaterThan(50);
  });

  it('produces snow-line peaks somewhere', () => {
    let snowy = 0;
    for (let i = 0; i < 5000; i++) {
      const x = (i * 211) % 10000 - 5000;
      const z = (i * 313) % 10000 - 5000;
      if (terrainHeight(x, z, 7) > SNOW_LINE) snowy++;
    }
    expect(snowy).toBeGreaterThan(20);
  });

  it('stays within MAX_HEIGHT_RANGE', () => {
    for (let i = 0; i < 2000; i++) {
      const x = (i * 211) % 64000 - 32000;
      const z = (i * 313) % 64000 - 32000;
      const y = terrainHeight(x, z, 7);
      expect(Math.abs(y)).toBeLessThanOrEqual(MAX_HEIGHT_RANGE);
    }
  });

  it('exports expected band constants', () => {
    expect(WATER_LEVEL).toBe(0);
    expect(SNOW_LINE).toBeGreaterThan(WATER_LEVEL);
    expect(MAX_HEIGHT_RANGE).toBeGreaterThan(SNOW_LINE);
  });
});
