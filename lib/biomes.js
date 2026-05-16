// Region biomes for the open procedural world. Each biome owns a full color
// palette (per-altitude `bands`), atmosphere palette (sky/fog/sun/hemi), height
// multiplier (desert = flat, arctic = jagged), and scatter mesh key.
//
// biomeAt(x, z) maps a world position to one of 3 biomes via a 3×3 lookup of
// (temperature × moisture) noise. bandsAt + heightScaleAt return smoothly-
// blended values across the lookup so chunk-grid seams disappear at borders.
//
// scatterKey identifies which mesh the chunk should use for its scattered
// props. See lib/scatter/index.js.

export const BIOMES = [
  {
    name:        'forest',
    sky:         [0.66, 0.78, 0.90],
    fog:         [0.81, 0.85, 0.88],
    fogNear:     900, fogFar: 2700,
    sun:         [1.00, 0.97, 0.90],
    hemiSky:     [0.72, 0.88, 1.00],
    hemiGround:  [0.42, 0.50, 0.31],
    hemiIntensity: 0.35,
    bands: {
      deepWater: [0.29, 0.53, 0.72],
      sand:      [0.86, 0.78, 0.55],
      grassLow:  [0.52, 0.74, 0.40],
      grassMid:  [0.40, 0.62, 0.32],
      rock:      [0.55, 0.55, 0.58],
      snow:      [0.97, 0.97, 0.99],
    },
    heightScale: 1.0,           // default rolling hills + mountains
    scatterKey:  'conifer',
  },
  {
    name:        'desert',
    sky:         [0.90, 0.78, 0.55],
    fog:         [0.94, 0.78, 0.55],
    fogNear:     900, fogFar: 2700,
    sun:         [1.00, 0.92, 0.74],
    hemiSky:     [0.94, 0.84, 0.65],
    hemiGround:  [0.62, 0.50, 0.30],
    hemiIntensity: 0.40,
    bands: {
      deepWater: [0.29, 0.53, 0.72],   // unified water blue across all biomes
      sand:      [0.97, 0.88, 0.55],   // bright dune sand
      grassLow:  [0.95, 0.82, 0.48],   // sand top to bottom — no real grass
      grassMid:  [0.92, 0.76, 0.40],
      rock:      [0.88, 0.68, 0.34],   // tan/orange sandstone, not grey
      snow:      [0.95, 0.88, 0.65],   // pale dune crests (no actual snow)
    },
    heightScale: 0.35,                  // FLAT — dunes, not mountains
    scatterKey:  'cactus',
  },
  {
    name:        'arctic',
    sky:         [0.72, 0.82, 0.88],
    fog:         [0.82, 0.87, 0.92],
    fogNear:     800, fogFar: 2400,
    sun:         [0.92, 0.95, 1.00],
    hemiSky:     [0.92, 0.95, 0.98],
    hemiGround:  [0.88, 0.92, 0.96],   // white ground bounce (snow reflects everywhere)
    hemiIntensity: 0.40,
    bands: {
      deepWater: [0.29, 0.53, 0.72],
      sand:      [0.96, 0.98, 1.00],   // frosted shore — basically white
      grassLow:  [0.98, 0.99, 1.00],   // snow everywhere
      grassMid:  [0.97, 0.98, 1.00],   // still snow
      rock:      [0.92, 0.95, 0.98],   // ice-glazed rock, only a hint darker
      snow:      [1.00, 1.00, 1.00],   // pure white peaks
    },
    heightScale: 1.5,                   // JAGGED peaks
    scatterKey:  'icespike',
  },
];

const NAME_TO_BIOME = Object.fromEntries(BIOMES.map(b => [b.name, b]));

// 3×3 (temperature × moisture) lookup. 9 cells over 3 biomes — each biome
// occupies 3 cells. Arctic = all cold; desert = drier+hotter; forest = wetter+
// warmer. Within-biome boundaries are crossed often; cross-biome boundaries
// (arctic↔desert, arctic↔forest, desert↔forest) less often.
//                      dry         mid         wet
const LOOKUP = [
  /* cold */ ['arctic',   'arctic',   'arctic'],
  /* mid  */ ['desert',   'forest',   'forest'],
  /* hot  */ ['desert',   'desert',   'forest'],
].map(row => row.map(name => NAME_TO_BIOME[name]));

// Smoothed value noise — deterministic, no external dependency.
function hash2(ix, iy) {
  let h = (ix | 0) * 374761393 + (iy | 0) * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}
function noise(x, y, scale) {
  const sx = x / scale, sy = y / scale;
  const ix = Math.floor(sx), iy = Math.floor(sy);
  const fx = sx - ix, fy = sy - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const h00 = hash2(ix,     iy);
  const h10 = hash2(ix + 1, iy);
  const h01 = hash2(ix,     iy + 1);
  const h11 = hash2(ix + 1, iy + 1);
  return (h00 * (1-u) + h10 * u) * (1-v) + (h01 * (1-u) + h11 * u) * v;
}

// Region scale — the noise period is SCALE, but the 3-bucket lookup means each
// biome cell is ~SCALE/3 wide. For ~1km biomes SCALE ≈ 3km.
const TEMP_SCALE   = 3000;
const MOIST_SCALE  = 3750;
const TEMP_OFFSET  = { x:  100, z:  100 };
const MOIST_OFFSET = { x: 9000, z: 9000 };
const DENSITY_SCALE  = 2500;
const DENSITY_OFFSET = { x: 17000, z: 23000 };

// Per-position scatter density modulation, [0, 1]. Multiply with the biome's
// max density. ~2.5km wavelength so dense + sparse patches alternate.
export function densityAt(x, z) {
  return noise(x + DENSITY_OFFSET.x, z + DENSITY_OFFSET.z, DENSITY_SCALE);
}

export function biomeAt(x, z) {
  const t = noise(x + TEMP_OFFSET.x,  z + TEMP_OFFSET.z,  TEMP_SCALE);
  const m = noise(x + MOIST_OFFSET.x, z + MOIST_OFFSET.z, MOIST_SCALE);
  const ti = Math.min(2, Math.floor(t * 3));
  const mi = Math.min(2, Math.floor(m * 3));
  return LOOKUP[ti][mi];
}

// Bilinearly-interpolated bands across the 3×3 lookup — chunks near a biome
// boundary blend the adjacent biomes' palettes so chunk seams disappear.
// deepWater is excluded (kept discrete) so water stays consistent per chunk.
const BLENDED_BAND_NAMES = ['sand', 'grassLow', 'grassMid', 'rock', 'snow'];
function lerpBand(a, b, t, out) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}
export function bandsAt(x, z) {
  const t = noise(x + TEMP_OFFSET.x,  z + TEMP_OFFSET.z,  TEMP_SCALE)  * 3;
  const m = noise(x + MOIST_OFFSET.x, z + MOIST_OFFSET.z, MOIST_SCALE) * 3;
  const ti  = Math.min(2, Math.floor(t));
  const mi  = Math.min(2, Math.floor(m));
  const ti1 = Math.min(2, ti + 1);
  const mi1 = Math.min(2, mi + 1);
  const tf  = Math.min(1, Math.max(0, t - ti));
  const mf  = Math.min(1, Math.max(0, m - mi));
  const b00 = LOOKUP[ti ][mi ].bands;
  const b10 = LOOKUP[ti1][mi ].bands;
  const b01 = LOOKUP[ti ][mi1].bands;
  const b11 = LOOKUP[ti1][mi1].bands;
  const out = {};
  const rowA = [0, 0, 0], rowB = [0, 0, 0];
  for (const name of BLENDED_BAND_NAMES) {
    lerpBand(b00[name], b10[name], tf, rowA);
    lerpBand(b01[name], b11[name], tf, rowB);
    const c = [0, 0, 0];
    lerpBand(rowA, rowB, mf, c);
    out[name] = c;
  }
  const center = LOOKUP[ti][mi].bands.deepWater;
  out.deepWater = [center[0], center[1], center[2]];
  return out;
}

// Bilinearly-interpolated heightScale so heights don't show vertical cliffs at
// biome edges. Same noise inputs as biomeAt — when (t,m) crosses a bucket
// boundary, this lerps between the neighbouring biomes' heightScales.
export function heightScaleAt(x, z) {
  const t = noise(x + TEMP_OFFSET.x,  z + TEMP_OFFSET.z,  TEMP_SCALE)  * 3;
  const m = noise(x + MOIST_OFFSET.x, z + MOIST_OFFSET.z, MOIST_SCALE) * 3;
  const ti  = Math.min(2, Math.floor(t));
  const mi  = Math.min(2, Math.floor(m));
  const ti1 = Math.min(2, ti + 1);
  const mi1 = Math.min(2, mi + 1);
  const tf  = Math.min(1, Math.max(0, t - ti));
  const mf  = Math.min(1, Math.max(0, m - mi));
  const s00 = LOOKUP[ti ][mi ].heightScale;
  const s10 = LOOKUP[ti1][mi ].heightScale;
  const s01 = LOOKUP[ti ][mi1].heightScale;
  const s11 = LOOKUP[ti1][mi1].heightScale;
  return (s00 * (1-tf) + s10 * tf) * (1-mf) + (s01 * (1-tf) + s11 * tf) * mf;
}
