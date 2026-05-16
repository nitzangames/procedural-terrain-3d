// Ice spike: tall sharp tetrahedron-like crystal. Pointed top, square-ish base.
// Pure white-blue with flat shading via the chunk-manager's tree material.
import { mergeGeometries } from '../terrain/trees.js';

export function buildIceSpikeGeometry(THREE) {
  // Single tall ConeGeometry, 4 sides for a crystalline silhouette.
  const cone = new THREE.ConeGeometry(0.9, 3.6, 4);
  cone.translate(0, 1.8, 0);
  // Smaller secondary spike offset to one side for variety
  const cone2 = new THREE.ConeGeometry(0.4, 1.8, 4);
  cone2.translate(0.7, 0.9, 0.2);
  const merged = mergeGeometries(THREE, [cone, cone2]);
  const ice = new THREE.Color(0.78, 0.88, 0.96);
  const vCount = merged.attributes.position.count;
  const colors = new Float32Array(vCount * 3);
  for (let i = 0; i < vCount; i++) {
    colors[i*3] = ice.r; colors[i*3+1] = ice.g; colors[i*3+2] = ice.b;
  }
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.computeVertexNormals();
  return merged;
}
