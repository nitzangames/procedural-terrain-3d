// Per-style presets. Used by createTerrain to swap scene-level state.
// `sky` is the fallback clear color (visible only briefly during a frame the dome
// hasn't rendered yet); `skyTop` / `skyHorizon` drive the gradient sky dome.
export const STYLES = {
  lowpoly: {
    sky:          [0.62, 0.84, 1.00],
    skyTop:       [0.30, 0.55, 0.92],
    skyHorizon:   [0.85, 0.93, 1.00],
    skyExponent:  0.55,
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
    skyTop:       [0.55, 0.74, 0.92],
    skyHorizon:   [1.00, 0.86, 0.74],
    skyExponent:  0.65,
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
    skyTop:       [0.30, 0.38, 0.46],
    skyHorizon:   [0.62, 0.68, 0.72],
    skyExponent:  0.50,
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
  // Topographic-map / aerial-survey look: warm dawn-cream horizon, cool blue zenith,
  // soft grey-blue fog, faceted olive/tan/dirt biomes with 3 variants per band.
  // Color palette modeled after JSGames/WW1FlightSim/js/world.js.
  cartograph: {
    sky:          [0.81, 0.84, 0.88],
    skyTop:       [0.435, 0.651, 0.839],   // 0x6fa6d6
    skyHorizon:   [1.000, 0.945, 0.788],   // 0xfff1c9 cream
    skyExponent:  0.55,
    fogType:      'linear',
    fogColor:     [0.812, 0.847, 0.878],   // 0xcfd8e0
    fogNear:      800,
    fogFar:       2400,
    waterColor:   [0.302, 0.416, 0.447],
    waterOpacity: 0.85,
    sunColor:     [1.000, 0.945, 0.788],
    hemiSky:      [1.000, 0.945, 0.788],
    hemiGround:   [0.290, 0.365, 0.208],
    hemiIntensity: 0.60,
  },
  // Topographic: cartograph's height-banded palette with explicit contour
  // lines drawn every 4m (minor, thin) and every 20m (major, thicker).
  // Aerial-survey / paper-map look.
  topographic: {
    sky:          [0.85, 0.86, 0.84],
    skyTop:       [0.78, 0.82, 0.86],
    skyHorizon:   [0.94, 0.92, 0.86],
    skyExponent:  0.55,
    fogType:      'linear',
    fogColor:     [0.88, 0.88, 0.84],
    fogNear:      900,
    fogFar:       2700,
    waterColor:   [0.46, 0.65, 0.78],
    waterOpacity: 1.0,
    sunColor:     [1.00, 0.98, 0.92],
    hemiSky:      [0.86, 0.88, 0.92],
    hemiGround:   [0.62, 0.62, 0.55],
    hemiIntensity: 0.55,
  },
};

// Sky dome: large inverted icosahedron with a vertex-direction gradient. Renders
// before everything and provides the background visible through the world.
// Radius is just under the camera far plane (4500 m in shell/main.js) so the dome
// never gets clipped at the horizon.
export function buildSkyDome(THREE) {
  const geom = new THREE.IcosahedronGeometry(4000, 3);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uTopColor:     { value: new THREE.Color(0.30, 0.55, 0.92) },
      uHorizonColor: { value: new THREE.Color(0.85, 0.93, 1.00) },
      uExponent:     { value: 0.55 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vDir = normalize(worldPos.xyz - cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uTopColor;
      uniform vec3 uHorizonColor;
      uniform float uExponent;
      varying vec3 vDir;
      void main() {
        float t = pow(clamp(vDir.y, 0.0, 1.0), uExponent);
        gl_FragColor = vec4(mix(uHorizonColor, uTopColor, t), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

const STYLE_INDEX = { lowpoly: 0, stylized: 1, realistic: 2, cartograph: 3, topographic: 4 };

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
       } else if (uStyle == 3 || uStyle == 4) {
         // Cartograph style: blend smoothly across biome bands so band contour lines
         // disappear. Variants (3 per band) come from a ~2.5m XZ cell hash for patchwork.
         // Topographic (uStyle==4) reuses the same palette + overlays contour lines.
         vec3 cellPos = floor(vWorldPosT * 0.4);
         float h = fract(sin(dot(cellPos.xz, vec2(12.9898, 78.233))) * 43758.5453);
         int v = int(h * 3.0);
         vec3 cWater    = (v == 0) ? vec3(0.169, 0.290, 0.122) : ((v == 1) ? vec3(0.196, 0.302, 0.137) : vec3(0.227, 0.353, 0.165));
         vec3 cGrass    = (v == 0) ? vec3(0.267, 0.420, 0.157) : ((v == 1) ? vec3(0.306, 0.463, 0.188) : vec3(0.353, 0.518, 0.184));
         vec3 cOlive    = (v == 0) ? vec3(0.478, 0.549, 0.259) : ((v == 1) ? vec3(0.541, 0.600, 0.302) : vec3(0.435, 0.502, 0.251));
         vec3 cTan      = (v == 0) ? vec3(0.604, 0.478, 0.235) : ((v == 1) ? vec3(0.549, 0.416, 0.188) : vec3(0.494, 0.353, 0.141));
         vec3 cHillside = (v == 0) ? vec3(0.435, 0.357, 0.212) : ((v == 1) ? vec3(0.373, 0.302, 0.165) : vec3(0.561, 0.435, 0.282));
         vec3 cSnow     = (v == 0) ? vec3(0.910, 0.910, 0.910) : ((v == 1) ? vec3(0.812, 0.812, 0.812) : vec3(0.855, 0.863, 0.878));
         float y = vWorldPosT.y;
         // Transition half-widths chosen per gap so adjacent zones don't overlap.
         vec3 col = cWater;
         col = mix(col, cGrass,    smoothstep( 0.0 - 3.0,  0.0 + 3.0, y));
         col = mix(col, cOlive,    smoothstep( 8.0 - 3.0,  8.0 + 3.0, y));
         col = mix(col, cTan,      smoothstep(16.0 - 4.0, 16.0 + 4.0, y));
         col = mix(col, cHillside, smoothstep(28.0 - 5.0, 28.0 + 5.0, y));
         col = mix(col, cSnow,     smoothstep(44.0 - 6.0, 44.0 + 6.0, y));
         if (uStyle == 4) {
           // Topographic: overlay contour lines.
           //   Minor contours every 4m (thin), major every 20m (thicker).
           //   Suppressed below water level so lakes stay clean.
           float lineAlt = max(0.0, y);
           float minorOff = abs(mod(lineAlt + 2.0, 4.0) - 2.0);
           float majorOff = abs(mod(lineAlt + 10.0, 20.0) - 10.0);
           float minorLine = 1.0 - smoothstep(0.06, 0.20, minorOff);
           float majorLine = 1.0 - smoothstep(0.12, 0.45, majorOff);
           float lineAmt = clamp(minorLine * 0.30 + majorLine * 0.70, 0.0, 0.80);
           vec3 lineColor = vec3(0.10, 0.13, 0.16);
           col = mix(col, lineColor, lineAmt);
         }
         diffuseColor.rgb = col;
       }`
    );
    // Faceted styles (lowpoly + ww1): override the geometry normal with a
    // screen-space-derivative-derived face normal in the lighting block.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `#include <normal_fragment_begin>
       if (uStyle == 0 || uStyle == 3 || uStyle == 4) {
         vec3 dx = dFdx(vWorldPosT);
         vec3 dy = dFdy(vWorldPosT);
         normal = normalize(cross(dx, dy));
       }`
    );
  };
  return mat;
}

// Apply a style to scene-level state (sky color, fog, lights, water, sky dome).
// Material uniform is updated in-place; no rebuild.
export function applyStyle(THREE, scene, material, sun, hemi, waterMesh, styleName, skyDome = null) {
  const s = STYLES[styleName];
  if (!s) throw new Error('Unknown style: ' + styleName);
  scene.background = new THREE.Color(s.sky[0], s.sky[1], s.sky[2]);
  if (skyDome) {
    skyDome.material.uniforms.uTopColor.value.setRGB(s.skyTop[0], s.skyTop[1], s.skyTop[2]);
    skyDome.material.uniforms.uHorizonColor.value.setRGB(s.skyHorizon[0], s.skyHorizon[1], s.skyHorizon[2]);
    skyDome.material.uniforms.uExponent.value = s.skyExponent;
  }
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
