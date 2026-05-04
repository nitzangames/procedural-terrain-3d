// Per-style presets. Used by createTerrain to swap scene-level state.
export const STYLES = {
  lowpoly: {
    sky:          [0.62, 0.84, 1.00],
    fogType:      'none',
    fogColor:     [0.62, 0.84, 1.00],
    fogNear:      0,
    fogFar:       0,
    waterColor:   [0.18, 0.43, 0.64],
    waterOpacity: 1.0,
    sunColor:     [1.00, 1.00, 1.00],
    hemiSky:      [0.72, 0.88, 1.00],
    hemiGround:   [0.42, 0.50, 0.31],
    hemiIntensity: 0.55,
  },
  stylized: {
    sky:          [0.81, 0.91, 0.96],
    fogType:      'linear',
    fogColor:     [0.81, 0.91, 0.96],
    fogNear:      900,
    fogFar:       2400,
    waterColor:   [0.29, 0.53, 0.72],
    waterOpacity: 0.85,
    sunColor:     [1.00, 0.95, 0.84],
    hemiSky:      [1.00, 0.91, 0.77],
    hemiGround:   [0.42, 0.50, 0.31],
    hemiIntensity: 0.70,
  },
  realistic: {
    sky:          [0.43, 0.51, 0.58],
    fogType:      'exp2',
    fogColor:     [0.43, 0.51, 0.58],
    fogDensity:   0.0008,
    waterColor:   [0.16, 0.23, 0.29],
    waterOpacity: 0.9,
    sunColor:     [0.99, 0.95, 0.85],
    hemiSky:      [0.63, 0.71, 0.78],
    hemiGround:   [0.23, 0.21, 0.15],
    hemiIntensity: 0.45,
  },
};

const STYLE_INDEX = { lowpoly: 0, stylized: 1, realistic: 2 };

// Build the shared terrain material. Adds a uStyle uniform and patches the shader to:
//  - lowpoly: derive face normal via dFdx/dFdy, snap colors to 6 palette entries
//  - stylized: smooth normal + smooth color
//  - realistic: smooth normal + slope-blended rock + snow-line snow
export function buildTerrainMaterial(THREE) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.userData.uStyle = { value: STYLE_INDEX.lowpoly };
  mat.userData.uSnowLine = { value: 22 };
  mat.userData.uWaterY   = { value: 0 };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uStyle    = mat.userData.uStyle;
    shader.uniforms.uSnowLine = mat.userData.uSnowLine;
    shader.uniforms.uWaterY   = mat.userData.uWaterY;

    // Vertex shader: pass world position to fragment.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       varying vec3 vWorldPosT;`
    ).replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
       vWorldPosT = (modelMatrix * vec4(transformed, 1.0)).xyz;`
    );

    // Fragment shader: redefine `vColor` use per-style.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       uniform int uStyle;
       uniform float uSnowLine;
       uniform float uWaterY;
       varying vec3 vWorldPosT;

       const vec3 PAL[6] = vec3[6](
         vec3(0.18,0.42,0.62),  // deepWater
         vec3(0.86,0.78,0.55),  // sand
         vec3(0.52,0.74,0.40),  // grassLow
         vec3(0.40,0.62,0.32),  // grassMid
         vec3(0.55,0.55,0.58),  // rock
         vec3(0.97,0.97,0.99)   // snow
       );
       vec3 paletteSnap(vec3 c) {
         float bestD = 100.0; int best = 0;
         for (int i = 0; i < 6; i++) {
           float d = distance(c, PAL[i]);
           if (d < bestD) { bestD = d; best = i; }
         }
         return PAL[best];
       }`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       if (uStyle == 0) {
         diffuseColor.rgb = paletteSnap(diffuseColor.rgb);
       } else if (uStyle == 2) {
         vec3 dx = dFdx(vWorldPosT);
         vec3 dy = dFdy(vWorldPosT);
         vec3 worldN = normalize(cross(dx, dy));
         float slope = clamp(1.0 - worldN.y, 0.0, 1.0);
         vec3 ROCK = vec3(0.36, 0.34, 0.30);
         vec3 SNOW = vec3(0.96, 0.97, 0.98);
         diffuseColor.rgb = mix(diffuseColor.rgb, ROCK, smoothstep(0.25, 0.7, slope));
         float snowMask = smoothstep(0.0, 6.0, vWorldPosT.y - uSnowLine - slope * 6.0);
         diffuseColor.rgb = mix(diffuseColor.rgb, SNOW, clamp(snowMask, 0.0, 1.0));
       }`
    );
    // For uStyle == 0, override the geometry normal in the lighting block.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `#include <normal_fragment_begin>
       if (uStyle == 0) {
         vec3 dx = dFdx(vWorldPosT);
         vec3 dy = dFdy(vWorldPosT);
         normal = normalize(cross(dx, dy));
       }`
    );
  };
  return mat;
}

// Apply a style to scene-level state (sky color, fog, lights, water).
// Material uniform is updated in-place; no rebuild.
export function applyStyle(THREE, scene, material, sun, hemi, waterMesh, styleName) {
  const s = STYLES[styleName];
  if (!s) throw new Error('Unknown style: ' + styleName);
  scene.background = new THREE.Color(s.sky[0], s.sky[1], s.sky[2]);
  if (s.fogType === 'none') {
    scene.fog = null;
  } else if (s.fogType === 'linear') {
    scene.fog = new THREE.Fog(new THREE.Color(s.fogColor[0], s.fogColor[1], s.fogColor[2]), s.fogNear, s.fogFar);
  } else {
    scene.fog = new THREE.FogExp2(new THREE.Color(s.fogColor[0], s.fogColor[1], s.fogColor[2]), s.fogDensity);
  }
  if (sun)  sun.color.setRGB(s.sunColor[0], s.sunColor[1], s.sunColor[2]);
  if (hemi) {
    hemi.color.setRGB(s.hemiSky[0], s.hemiSky[1], s.hemiSky[2]);
    hemi.groundColor.setRGB(s.hemiGround[0], s.hemiGround[1], s.hemiGround[2]);
    hemi.intensity = s.hemiIntensity;
  }
  if (waterMesh) {
    waterMesh.material.color.setRGB(s.waterColor[0], s.waterColor[1], s.waterColor[2]);
    waterMesh.material.opacity = s.waterOpacity;
    waterMesh.material.transparent = s.waterOpacity < 1;
  }
  material.userData.uStyle.value = STYLE_INDEX[styleName];
}
