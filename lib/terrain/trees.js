// Conifer base mesh: a 6-sided cone on a short trunk. ~12 tris.
// Tints are stored as instance attribute; the chunk manager builds InstancedMesh
// with one instance per tree descriptor returned from buildChunkBuffers.

const TINT_PALETTE = [
  [0.18, 0.42, 0.18],   // dark green
  [0.30, 0.58, 0.30],   // lighter green
];

export function buildConiferGeometry(THREE) {
  // Trunk is 2.4 m tall but its base sits 1.2 m below the placement origin so it
  // extends into the ground. This hides the small gap that appears when the tree's
  // sampled height differs slightly from the interpolated terrain mesh under it.
  const trunkGeom = new THREE.CylinderGeometry(0.18, 0.25, 2.4, 5);
  // No translate: cylinder is centered at y=0, so it spans y=-1.2 (underground)
  // to y=+1.2 (where the cone sits).
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

// A simple billboard quad — vertical plane, base at y=0, top at y=5.5. Each instance
// is rotated around Y in the vertex shader to face the camera horizontally.
export function buildBillboardGeometry(THREE) {
  const g = new THREE.PlaneGeometry(3.5, 5.5);
  g.translate(0, 2.75, 0);
  return g;
}

// Material for distant tree billboards. Y-axis-aligned billboarding (rotates around Y to
// face the camera) + a procedural conical silhouette mask via discard. Cheap, no texture.
export function buildBillboardMaterial(THREE) {
  return new THREE.ShaderMaterial({
    transparent: false,         // discard handles cutout; no blending needed
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        // Instance world position (translation column of instanceMatrix).
        vec3 instOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        // Y-billboard: rotate local position around Y so the +Z normal faces the camera.
        vec3 toCam = cameraPosition - instOrigin;
        float angle = atan(toCam.x, toCam.z);
        float c = cos(angle), s = sin(angle);
        // We also want to honor the per-instance Y-rotation and scale stored in instanceMatrix
        // — extract scale Y, leave the rest to the billboard.
        float scaleY = length(vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2]));
        vec3 scaled = vec3(position.x * scaleY, position.y * scaleY, position.z * scaleY);
        vec3 rotated = vec3(
          scaled.x * c + scaled.z * s,
          scaled.y,
          -scaled.x * s + scaled.z * c
        );
        vec4 worldPos = vec4(instOrigin + rotated, 1.0);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      void main() {
        // Triangular silhouette: full width at base (v=0), narrowing to 0 at top (v=1).
        float halfW = 0.5 * (1.0 - vUv.y);
        if (abs(vUv.x - 0.5) > halfW) discard;
        // Slightly darker toward base for a hint of shading.
        float shade = mix(0.62, 1.0, vUv.y);
        vec3 col = vec3(0.20, 0.45, 0.20) * shade;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

// Build an InstancedMesh of billboard quads from a placement list.
export function buildBillboardInstancedMesh(THREE, geometry, material, list) {
  const im = new THREE.InstancedMesh(geometry, material, list.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();          // identity — billboarding is in the shader
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    p.set(t.x, t.y, t.z);
    s.set(t.scale, t.scale, t.scale);
    m.compose(p, q, s);
    im.setMatrixAt(i, m);
  }
  im.instanceMatrix.needsUpdate = true;
  im.frustumCulled = false;
  return im;
}
