// Conifer base mesh: a 6-sided cone on a short trunk. ~12 tris.
// Tints are stored as instance attribute; the chunk manager builds InstancedMesh
// with one instance per tree descriptor returned from buildChunkBuffers.

const TINT_PALETTE = [
  [0.18, 0.42, 0.18],   // dark green
  [0.30, 0.58, 0.30],   // lighter green
];

export function buildConiferGeometry(THREE) {
  const trunkGeom = new THREE.CylinderGeometry(0.18, 0.25, 1.2, 5);
  trunkGeom.translate(0, 0.6, 0);
  const coneGeom = new THREE.ConeGeometry(1.4, 4.2, 6);
  coneGeom.translate(0, 1.2 + 2.1, 0);
  // Merge the two into one BufferGeometry
  const merged = mergeGeometries(THREE, [trunkGeom, coneGeom]);
  // Color attribute: trunk vertices brown, cone vertices green.
  // (Per-instance color variation would require a custom shader because instanceColor
  // multiplies all vertices uniformly — that's deferred. v1 ships one green.)
  const trunkVCount = trunkGeom.attributes.position.count;
  const totalVCount = merged.attributes.position.count;
  const colors = new Float32Array(totalVCount * 3);
  for (let i = 0; i < trunkVCount; i++) {
    colors[i * 3] = 0.29; colors[i * 3 + 1] = 0.20; colors[i * 3 + 2] = 0.13;
  }
  for (let i = trunkVCount; i < totalVCount; i++) {
    colors[i * 3] = 0.24; colors[i * 3 + 1] = 0.50; colors[i * 3 + 2] = 0.24;
  }
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  trunkGeom.dispose(); coneGeom.dispose();
  return merged;
}

function mergeGeometries(THREE, geoms) {
  const out = new THREE.BufferGeometry();
  let totalV = 0, totalI = 0;
  for (const g of geoms) {
    totalV += g.attributes.position.count;
    if (g.index) totalI += g.index.count; else totalI += g.attributes.position.count;
  }
  const pos = new Float32Array(totalV * 3);
  const norm = new Float32Array(totalV * 3);
  const idx = new Uint32Array(totalI);
  let vOff = 0, iOff = 0;
  for (const g of geoms) {
    const gPos = g.attributes.position.array;
    const gNorm = g.attributes.normal ? g.attributes.normal.array : null;
    pos.set(gPos, vOff * 3);
    if (gNorm) norm.set(gNorm, vOff * 3);
    if (g.index) {
      const gIdx = g.index.array;
      for (let i = 0; i < gIdx.length; i++) idx[iOff + i] = gIdx[i] + vOff;
      iOff += gIdx.length;
    } else {
      for (let i = 0; i < gPos.length / 3; i++) idx[iOff + i] = i + vOff;
      iOff += gPos.length / 3;
    }
    vOff += gPos.length / 3;
  }
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (norm.some(v => v !== 0)) out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  if (!out.attributes.normal) out.computeVertexNormals();
  return out;
}

// Build an InstancedMesh from a tree descriptor list returned by buildChunkBuffers.
// Each descriptor: { x, y, z, scale, tint, rotation }. Tint is stored but not yet
// applied (would need a custom shader; v1 ships one green).
export function buildTreeInstancedMesh(THREE, geometry, material, trees) {
  const im = new THREE.InstancedMesh(geometry, material, trees.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    p.set(t.x, t.y, t.z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rotation);
    s.set(t.scale, t.scale, t.scale);
    m.compose(p, q, s);
    im.setMatrixAt(i, m);
  }
  im.instanceMatrix.needsUpdate = true;
  im.frustumCulled = false; // chunk-level culling handled by chunk manager
  return im;
}

// A simple billboard atlas (one cone-shaped quad). Used for LOD 1 distant trees.
export function buildBillboardGeometry(THREE) {
  const g = new THREE.PlaneGeometry(3.5, 5.5);
  g.translate(0, 2.75, 0);
  return g;
}
