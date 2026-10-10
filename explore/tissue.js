/* What living tissue looks like, for the 3D body (and the cells): bone that is matte and finely
   pitted, muscle that is wet and runs in fibres, organs with a wet shine, glossy blood vessels,
   and skin you can see through that thickens towards its edges. No pictures to download: the
   fine surface detail is made on the graphics card from noise, and fades away when you zoom
   out (so it never shimmers). */

// [roughness, clearcoat, clearcoat roughness, sheen, sheen colour, bump detail (per unit), bump strength, colour variation, stretch (fibres)]
const LOOK = {
  skeletal: [0.62, 0.12, 0.5, 0.45, '#fff0da', 260, 0.55, 0.1, 1],
  muscular: [0.5, 0.45, 0.35, 0.7, '#ff9a86', 300, 0.22, 0.14, 7],
  visceral: [0.4, 0.8, 0.22, 0.35, '#ffd0c4', 110, 0.5, 0.12, 1],
  cardiovascular: [0.32, 0.9, 0.18, 0.25, '#ffb0a8', 160, 0.3, 0.1, 1],
  nervous: [0.5, 0.55, 0.3, 0.4, '#fff2e6', 150, 0.4, 0.1, 1],
  lymphoid: [0.42, 0.75, 0.24, 0.3, '#f4ffd8', 120, 0.45, 0.12, 1],
  regions: [0.55, 0.2, 0.45, 0.6, '#ffd9c7', 0, 0, 0.05, 1],
  cell: [0.38, 0.6, 0.28, 0.4, '#ffffff', 26, 0.35, 0.12, 1],
};

const NOISE = `
float t_hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float t_noise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(t_hash(i), t_hash(i + vec3(1, 0, 0)), f.x), mix(t_hash(i + vec3(0, 1, 0)), t_hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(t_hash(i + vec3(0, 0, 1)), t_hash(i + vec3(1, 0, 1)), f.x), mix(t_hash(i + vec3(0, 1, 1)), t_hash(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
float t_fbm(vec3 p) { return t_noise(p) * 0.55 + t_noise(p * 2.1 + 7.3) * 0.3 + t_noise(p * 4.3 + 3.1) * 0.15; }
vec3 t_perturb(vec3 surf, vec3 n, vec2 dh, float face) {
  vec3 sx = normalize(dFdx(surf)), sy = normalize(dFdy(surf)), r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * face;
  return normalize(abs(det) * n - sign(det) * (dh.x * r1 + dh.y * r2));
}`;

// kind: a body layer id (skeletal, muscular, …) or 'cell'. extra: more material settings; film: true makes a
// see-through shell (a membrane) clearer in the middle and thicker towards its edges, like skin is.
export function tissueMaterial(THREE, kind, { film = false, ...extra } = {}) {
  const [roughness, clearcoat, clearcoatRoughness, sheen, sheenColor, freq, bump, vary, stretch] = LOOK[kind] || LOOK.visceral;
  const skin = kind === 'regions' || film, edge = kind === 'regions' ? '0.7' : '0.92';
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness, clearcoat, clearcoatRoughness, sheen, sheenColor: new THREE.Color(sheenColor), sheenRoughness: 0.55, ...extra });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tFreq = { value: freq }; sh.uniforms.tBump = { value: bump }; sh.uniforms.tVary = { value: vary }; sh.uniforms.tStretch = { value: stretch };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vObj; uniform float tFreq; uniform float tBump; uniform float tVary; uniform float tStretch;${NOISE}`)
      // a little life in the colour: no two patches of tissue are exactly the same shade
      .replace('#include <color_fragment>', `#include <color_fragment>
  diffuseColor.rgb *= 1.0 - tVary * 0.5 + tVary * t_fbm(vObj * tFreq * 0.04);`)
      // fine detail in the surface (fibres run up and down the body), faded out when it's smaller than a pixel
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  if (tBump > 0.0) {
    vec3 q = vObj * tFreq * vec3(1.0, 1.0 / tStretch, 1.0);
    float fade = 1.0 - smoothstep(0.25, 0.9, length(fwidth(q)));
    if (fade > 0.0) { float h = t_fbm(q); normal = t_perturb(-vViewPosition, normal, vec2(dFdx(h), dFdy(h)) * tBump * fade * 0.12, faceDirection); }
  }
  ${skin ? `diffuseColor.a = clamp(diffuseColor.a * (0.45 + 3.2 * pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 2.4)), 0.0, ${edge});` : ''}`);
  };
  m.customProgramCacheKey = () => 'tissue-' + (skin ? 'film' + edge : 'solid');
  return m;
}
