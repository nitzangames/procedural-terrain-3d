// Animated water plane. Vertex shader injects two sin waves driven by uTime, giving a
// slow surface ripple. The plane is subdivided so the displacement is visible — at 1×1
// segments the ripple would have nowhere to render.
export function buildWaterPlane(THREE, size = 64000) {
  const geom = new THREE.PlaneGeometry(size, size, 64, 64);
  geom.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({ color: 0x2d6ea3, transparent: false, opacity: 1 });
  mat.userData.uTime = { value: 0 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = mat.userData.uTime;
    shader.vertexShader =
      `uniform float uTime;\n` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           // World-space XZ so the wave phase doesn't shift when the plane follows the camera.
           vec4 _wp = modelMatrix * vec4(position, 1.0);
           float wave =
             sin(uTime * 0.55 + _wp.x * 0.0040) * 0.20 +
             sin(uTime * 0.38 + _wp.z * 0.0055) * 0.16;
           transformed.y += wave;
         }`
      );
  };
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.y = 0;
  mesh.renderOrder = -1;
  return mesh;
}
