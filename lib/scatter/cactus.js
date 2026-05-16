// Saguaro cactus: tall central column with 1–2 arms. ~12 tris total.
// Geometry-only — placement is handled by the existing terrain scatter system,
// not the canyon-segment placement from CanyonRun3D's cacti.js.

import { mergeGeometries } from '../terrain/trees.js';   // reuse existing util

export function buildCactusGeometry(THREE) {
  const green = new THREE.Color(0.16, 0.42, 0.20);
  // Trunk: vertical capsule-ish cylinder, 3m tall, base at y=-1 so it sinks
  // 1m into the ground to hide the seam (same trick as the conifer trunk).
  const trunk = new THREE.CylinderGeometry(0.5, 0.5, 4.0, 6);
  trunk.translate(0, 1.0, 0);
  // Two arms: short horizontal cylinders bending upward
  const armL = new THREE.CylinderGeometry(0.32, 0.32, 1.6, 5);
  armL.rotateZ(Math.PI / 2); armL.translate(-0.8, 2.2, 0);
  const armLUp = new THREE.CylinderGeometry(0.32, 0.32, 1.2, 5);
  armLUp.translate(-1.5, 2.8, 0);
  const armR = new THREE.CylinderGeometry(0.32, 0.32, 1.2, 5);
  armR.rotateZ(-Math.PI / 2); armR.translate(0.6, 2.6, 0);
  const armRUp = new THREE.CylinderGeometry(0.32, 0.32, 0.9, 5);
  armRUp.translate(1.1, 3.0, 0);
  const merged = mergeGeometries(THREE, [trunk, armL, armLUp, armR, armRUp]);
  // Solid green vertex colors
  const vCount = merged.attributes.position.count;
  const colors = new Float32Array(vCount * 3);
  for (let i = 0; i < vCount; i++) {
    colors[i*3] = green.r; colors[i*3+1] = green.g; colors[i*3+2] = green.b;
  }
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.computeVertexNormals();
  return merged;
}
