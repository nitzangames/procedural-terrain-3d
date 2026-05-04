// Euclidean distance from point P to segment AB in 2D.
export function distancePointToSegment2D(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 === 0) {
    const ex = px - ax, ez = pz - az;
    return Math.sqrt(ex * ex + ez * ez);
  }
  let t = ((px - ax) * dx + (pz - az) * dz) / len2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = ax + t * dx, cz = az + t * dz;
  const ex = px - cx, ez = pz - cz;
  return Math.sqrt(ex * ex + ez * ez);
}

// Maximum carve depth over all overlapping segments at (x, z).
// Returns 0 if outside every segment's width.
// Bowl falloff: depth × (1 - d/width)² for d <= width, 0 otherwise.
export function riverDepthAt(x, z, segments, depth) {
  let best = 0;
  for (const s of segments) {
    const d = distancePointToSegment2D(x, z, s.x0, s.z0, s.x1, s.z1);
    if (d >= s.width) continue;
    const t = 1 - d / s.width;
    const v = depth * t * t;
    if (v > best) best = v;
  }
  return best;
}

// Mutate `positions` (Float32Array of x,y,z triplets) by lowering Y where rivers pass.
// Also flattens vertices very close to the centerline so the water ribbon sits cleanly.
export function applyRiverCarve(positions, segments, depth = 4) {
  const n = positions.length / 3;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3];
    const z = positions[i * 3 + 2];
    const carve = riverDepthAt(x, z, segments, depth);
    if (carve > 0) positions[i * 3 + 1] -= carve;
  }
}
