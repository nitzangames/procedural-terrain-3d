export function buildWaterPlane(THREE, size = 64000) {
  const geom = new THREE.PlaneGeometry(size, size, 1, 1);
  geom.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({ color: 0x2d6ea3, transparent: false, opacity: 1 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.y = 0;
  mesh.renderOrder = -1;
  return mesh;
}
