import { fbm, ridge } from './noise.js';

export const WATER_LEVEL = 0;
export const SNOW_LINE = 44;
export const MAX_HEIGHT_RANGE = 120;

const F = 0.012;     // base frequency (1/m)
const SEED1 = 1;     // base hills
const SEED2 = 7;     // mountains
const SEED3 = 23;    // basins/lakes

// World height at (x, z). x and z are world meters.
// Empirical range across many seeds: approximately [-28, 60]. See spec §4.4.
// All amplitudes are doubled vs the original design — original peaks read as too flat.
export function terrainHeight(x, z, worldSeed = 0) {
  const s1 = SEED1 ^ worldSeed;
  const s2 = SEED2 ^ worldSeed;
  const s3 = SEED3 ^ worldSeed;

  const base = (fbm(x * F, z * F, s1) * 2 - 1) * 12;                   // [-12, 12]
  const mountains = Math.pow(ridge(x * F * 0.7, z * F * 0.7, s2), 1.6) * 64;
  const basins = Math.pow(ridge(x * F * 0.25 + 5, z * F * 0.25 - 9, s3), 3.0) * -20;

  return base + mountains + basins - 12;
}
