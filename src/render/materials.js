// Photorealistic PBR materials: Poly Haven (CC0) textures (albedo + normal + roughness),
// weather-reactive wet asphalt & puddles, terrain roughness + cloud shadows,
// animated wind-swaying & backlit-translucent foliage, and live reflective water.
import * as THREE from 'three';
import { PERF, ASSET_BASE } from './perf.js';

// Shared live environment & weather uniforms referenced by every custom shader material
export const ENV_STATE = {
  uTime: { value: 0 },
  uWetness: { value: 0 },        // 0 = dry sunny, 0.25 = golden damp sheen, 0.88 = post-rain puddles
  uRain: { value: 0 },           // 0..1 active rain ripple intensity
  uCloudCov: { value: 0.35 },    // cloud shadow coverage
  uWind: { value: 0.7 },         // wind sway strength
  uSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.4).normalize() },
  uSunCol: { value: new THREE.Color('#fff3de') },
  uFogCol: { value: new THREE.Color('#b4cde2') },
  uPhotoreal: { value: 1.0 },    // 1.0 = photoreal upgrades on, 0.0 = original baseline look
  uWaterRefl: { value: null },   // live mirrored sky + mountains render target texture
  uWaterReflOn: { value: 0.0 },
  uRes: { value: new THREE.Vector2(1280, 720) }
};

export const LOOKS = {
  alpine: {
    exposure: 0.96, sun: 3.4, envInt: 1.15, hemi: 0.16, fogMul: 1.5, fogDensityNear: 90,
    A: ['forest_ground_04', 0.2], B: ['rock_face', 0.16], C: ['coast_sand_02', 0.3],
    rockTint: '#b9b3ab', sat: 0.76, bright: 1.0, forest: 1, wetBase: 0.08
  },
  desert: {
    exposure: 0.92, sun: 3.8, envInt: 1.1, hemi: 0.14, fogMul: 1.4, fogDensityNear: 120,
    A: ['dry_ground_01', 0.18], B: ['red_laterite_soil_stones', 0.18], C: ['dry_ground_01', 0.24],
    rockTint: '#e6dccf', sat: 0.56, bright: 1.18, ripple: 1, wetBase: 0.0
  },
  coast: {
    exposure: 0.94, sun: 3.4, envInt: 1.15, hemi: 0.16, fogMul: 1.5, fogDensityNear: 90,
    A: ['grass_path_3', 0.2], B: ['rock_face', 0.16], C: ['coast_sand_02', 0.3],
    rockTint: '#c2bdb2', sat: 0.78, bright: 1.0, wetBase: 0.12
  }
};

const texLoader = new THREE.TextureLoader();
texLoader.setCrossOrigin('anonymous');
const texCache = new Map();
let maxAniso = 8;
export function setAnisotropy(renderer) {
  maxAniso = Math.min(PERF.anisotropy, renderer.capabilities.getMaxAnisotropy());
  for (const p of texCache.values()) {
    p.then((t) => { if (t) { t.anisotropy = maxAniso; t.needsUpdate = true; } }).catch(() => {});
  }
}

function loadTex(file, srgb) {
  const key = file + (srgb ? '|s' : '|l');
  if (!texCache.has(key)) {
    texCache.set(key, new Promise((res, rej) => {
      texLoader.load(ASSET_BASE + 'assets/tex/' + file, (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = maxAniso;
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        res(t);
      }, undefined, rej);
    }));
  }
  return texCache.get(key);
}

const layer = async (name, size = '1k') => ({
  diff: await loadTex(`${name}_diff_${size}.jpg`, true),
  nor: await loadTex(`${name}_nor_gl_${size}.jpg`, false),
  rough: await loadTex(`${name}_rough_${size}.jpg`, false)
});

// ------------------------------------------------------------------ shared tileable FBM noise texture
let noiseTex = null;
export function getNoiseTex() {
  if (noiseTex) return noiseTex;
  const N = 256, data = new Uint8Array(N * N * 4), P = 8;
  const g = new Float32Array(P * P);
  let sd = 12345;
  const r = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
  const oct = (o) => { const n = P << o, tab = new Float32Array(n * n); for (let i = 0; i < n * n; i++) tab[i] = r(); return { n, tab }; };
  const octs = [oct(0), oct(1), oct(2), oct(3), oct(4)], amps = [0.5, 0.27, 0.14, 0.07, 0.04];
  const smoothS = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0, v2 = 0;
    for (let k = 0; k < octs.length; k++) {
      const { n, tab } = octs[k], fx = (x / N) * n, fy = (y / N) * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = smoothS(fx - ix), ty = smoothS(fy - iy);
      const a = tab[(iy % n) * n + (ix % n)], b = tab[(iy % n) * n + ((ix + 1) % n)], c = tab[((iy + 1) % n) * n + (ix % n)], d = tab[((iy + 1) % n) * n + ((ix + 1) % n)];
      const val = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
      v += val * amps[k]; if (k >= 2) v2 += val * amps[k] * 2.2;
    }
    const o = (y * N + x) * 4;
    data[o] = Math.min(255, v * 255);
    data[o + 1] = Math.min(255, v2 * 255);
    data[o + 2] = (g[(y % P) * P + (x % P)] + r()) * 127;
    data[o + 3] = 255;
  }
  noiseTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.generateMipmaps = true;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

const lookCache = new Map();
export function loadLook(kind, renderer) {
  setAnisotropy(renderer);
  if (!lookCache.has(kind)) {
    lookCache.set(kind, (async () => {
      const cfg = LOOKS[kind];
      const [road, A, B, C] = await Promise.all([
        layer('asphalt_02', PERF.texSize),
        layer(cfg.A[0]),
        layer(cfg.B[0]),
        layer(cfg.C[0])
      ]);
      return { cfg, road, A, B, C };
    })());
  }
  return lookCache.get(kind);
}

// ------------------------------------------------------------------ shared GLSL helpers
const VERT_DECL = 'varying vec3 vWPos; varying vec3 vWNrm; varying vec3 vLoc;\n';
function patchVertex(sh, instanced) {
  sh.vertexShader = VERT_DECL + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    mat4 wM = modelMatrix;
    ${instanced ? '#ifdef USE_INSTANCING\n wM = modelMatrix * instanceMatrix;\n #endif' : ''}
    vWPos = (wM * vec4(transformed, 1.0)).xyz;
    vWNrm = normalize(mat3(wM) * objectNormal);
    vLoc = transformed;`);
}

const NOISE = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
float fbm2(vec2 p){ return vnoise(p)*0.55 + vnoise(p*2.07 + 13.1)*0.30 + vnoise(p*4.13 + 7.4)*0.15; }
float cloudShadowAt(vec2 xz, float t, float cov){
  vec2 p = xz * 0.0022 + vec2(t * 0.0045, t * 0.0028);
  float c = vnoise(p) * 0.65 + vnoise(p * 2.3 + 5.1) * 0.35;
  return 1.0 - smoothstep(0.62 - cov * 0.32, 0.92 - cov * 0.22, c) * (0.28 * cov);
}
`;

// ------------------------------------------------------------------ Photorealistic Road Asphalt PBR
// Dual-scale aggregate detail, worn wheel-track specular sheen, tar-seam glints,
// procedural world-space Post-Rain puddles with raindrop ripples and mirror-like HDR reflections.
export function roadMaterial(rd, kind, half) {
  [rd.diff, rd.nor, rd.rough].forEach((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; });
  const mat = new THREE.MeshPhysicalMaterial({
    map: rd.diff,
    normalMap: rd.nor,
    normalScale: new THREE.Vector2(1.15, 1.15),
    roughnessMap: rd.rough,
    roughness: 0.92,
    metalness: 0.0,
    clearcoat: 0.0,
    clearcoatRoughness: 0.14,
    envMapIntensity: 1.35,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  mat.color.set(kind === 'desert' ? '#918b84' : '#828389');

  const U = {
    uTime: ENV_STATE.uTime,
    uWetness: ENV_STATE.uWetness,
    uRain: ENV_STATE.uRain,
    uCloudCov: ENV_STATE.uCloudCov,
    uPhotoreal: ENV_STATE.uPhotoreal,
    uRoadHalf: { value: half }
  };
  mat.userData.U = U;

  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'varying vec3 vWPos; varying vec2 vRoadUv;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vRoadUv = uv;`);

    sh.fragmentShader = 'varying vec3 vWPos; varying vec2 vRoadUv; uniform float uTime, uWetness, uRain, uCloudCov, uPhotoreal, uRoadHalf;\n' + NOISE + sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
      float prRoad = uPhotoreal;
      float roadMacro = fbm2(vWPos.xz * 0.055 + 4.2);
      float roadPatch = fbm2(vWPos.xz * 0.19 + 19.7);
      // subtle large-scale asphalt aging & aggregate tone breaks (hides any tiling at speed)
      diffuseColor.rgb *= mix(1.0, 0.84 + 0.30 * roadMacro + 0.08 * (roadPatch - 0.5), prRoad);
      // world-space procedural puddles (gather naturally in wheel ruts & low spots)
      float puddleN = fbm2(vWPos.xz * 0.095 + vec2(11.3, 4.7)) * 0.72 + vnoise(vWPos.xz * 0.34) * 0.28;
      float wetAmt = clamp(uWetness, 0.0, 1.0) * prRoad;
      float puddleMask = smoothstep(0.68 - wetAmt * 0.34, 0.78 - wetAmt * 0.28, puddleN) * smoothstep(0.28, 0.72, wetAmt);
      // real physical wet asphalt darkening (porous stone absorbs more light when wet)
      float dampDark = mix(1.0, mix(0.62, 0.44, puddleMask), wetAmt * 0.88);
      diffuseColor.rgb *= dampDark;
      // subtle drifting cloud shadows on the highway
      float cSh = mix(1.0, cloudShadowAt(vWPos.xz, uTime, uCloudCov), prRoad);
      diffuseColor.rgb *= mix(1.0, cSh, 0.65);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      if (uPhotoreal > 0.5) {
        float worn = smoothstep(0.35, 0.85, fbm2(vWPos.xz * 0.14 + 2.1));
        float dryR = clamp(roughnessFactor * mix(0.84, 0.68, worn), 0.34, 0.96);
        float wetAmtR = clamp(uWetness, 0.0, 1.0);
        float puddleNR = fbm2(vWPos.xz * 0.095 + vec2(11.3, 4.7)) * 0.72 + vnoise(vWPos.xz * 0.34) * 0.28;
        float puddleR = smoothstep(0.68 - wetAmtR * 0.34, 0.78 - wetAmtR * 0.28, puddleNR) * smoothstep(0.28, 0.72, wetAmtR);
        float dampR = mix(dryR, dryR * 0.36, wetAmtR);
        roughnessFactor = mix(dampR, 0.035, puddleR);
      }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      if (uPhotoreal > 0.5 && uWetness > 0.25) {
        float wetAmtN = clamp(uWetness, 0.0, 1.0);
        float puddleNN = fbm2(vWPos.xz * 0.095 + vec2(11.3, 4.7)) * 0.72 + vnoise(vWPos.xz * 0.34) * 0.28;
        float puddleN2 = smoothstep(0.68 - wetAmtN * 0.34, 0.78 - wetAmtN * 0.28, puddleNN) * smoothstep(0.28, 0.72, wetAmtN);
        // smooth out asphalt micro-bumps inside puddles + add delicate raindrop rings
        vec3 upView = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        if (uRain > 0.05 && puddleN2 > 0.05) {
          vec2 rp = vWPos.xz * 2.4;
          vec2 ri = floor(rp), rf = fract(rp) - 0.5;
          float ph = fract(uTime * 1.65 + hash12(ri) * 6.28);
          float rad = length(rf);
          float ring = sin((rad - ph * 0.45) * 42.0) * exp(-rad * 7.0) * (1.0 - ph) * smoothstep(0.0, 0.08, ph);
          vec2 rdir = rf / max(rad, 0.001);
          vec3 rPert = (viewMatrix * vec4(rdir.x * ring * 0.16 * uRain, 0.0, rdir.y * ring * 0.16 * uRain, 0.0)).xyz;
          upView = normalize(upView + rPert);
        }
        normal = normalize(mix(normal, upView, puddleN2 * 0.92));
      }`)
      .replace('#include <clearcoat_normal_fragment_maps>', `#include <clearcoat_normal_fragment_maps>`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      if (uPhotoreal > 0.5) {
        // Grazing-angle asphalt sheen (real dry & damp highways catch warm sun specular along the road surface)
        vec3 Vv = normalize(vViewPosition);
        float ndv = clamp(dot(normalize(normal), Vv), 0.0, 1.0);
        float fres = pow(1.0 - ndv, 4.2);
        float sheenBoost = mix(0.055, 0.22, clamp(uWetness, 0.0, 1.0));
        reflectedLight.indirectSpecular += vec3(0.95, 0.97, 1.0) * fres * sheenBoost;
      }`);
  };
  mat.customProgramCacheKey = () => 'tb-road-photoreal';
  return mat;
}

// ------------------------------------------------------------------ Photorealistic Terrain PBR
// Now actually wires up the loaded Poly Haven roughness maps (A.rough, B.rough, C.rough),
// adds height-aware rock/dirt transitions, drifting cloud shadows, and weather wetness!
let rippleNow = 0;
export function terrainMaterial(look) {
  const { cfg, A, B, C } = look;
  rippleNow = cfg.ripple || 0;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0, envMapIntensity: 0.9 });
  const U = {
    tA: { value: A.diff }, tAn: { value: A.nor }, tAr: { value: A.rough },
    tB: { value: B.diff }, tBn: { value: B.nor }, tBr: { value: B.rough },
    tC: { value: C.diff }, tCn: { value: C.nor }, tCr: { value: C.rough },
    sA: { value: cfg.A[1] }, sB: { value: cfg.B[1] }, sC: { value: cfg.C[1] },
    rockTint: { value: new THREE.Color(cfg.rockTint) },
    satK: { value: cfg.sat || 0.75 },
    rippleK: { value: cfg.ripple || 0 },
    brightK: { value: cfg.bright || 1.0 },
    forestK: { value: cfg.forest || 0 },
    uTime: ENV_STATE.uTime,
    uWetness: ENV_STATE.uWetness,
    uCloudCov: ENV_STATE.uCloudCov,
    uPhotoreal: ENV_STATE.uPhotoreal
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    if (PERF.cheapTerrain) sh.fragmentShader = '#define TB_CHEAP\n' + sh.fragmentShader;
    patchVertex(sh, false);
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'attribute vec3 mask;\nvarying vec3 vMask;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vMask = mask;');
    sh.fragmentShader = 'varying vec3 vWPos; varying vec3 vWNrm; varying vec3 vMask;\nuniform sampler2D tA,tAn,tAr,tB,tBn,tBr,tC,tCn,tCr; uniform float sA,sB,sC,satK,brightK,rippleK,forestK,uTime,uWetness,uCloudCov,uPhotoreal; uniform vec3 rockTint;\n' + NOISE + sh.fragmentShader
      .replace('#include <map_fragment>', `
      vec3 Nw = normalize(vWNrm);
      float ny = Nw.y;
      float slopeN = vnoise(vWPos.xz * 0.05) * 0.12;
      float rockW = smoothstep(0.80, 0.54, ny + slopeN - 0.05 + vMask.z * 0.22);
      float gravW = vMask.z * 0.45;
      rockW = max(rockW, gravW * (1.0 - rockW));
      vec2 pA = vec2(vWPos.x, -vWPos.z) * sA;
      vec2 pA2 = vec2(vWPos.z, vWPos.x) * sA * 0.37 + 0.31;
      #ifdef TB_CHEAP
      vec3 cA = texture2D(tA, pA).rgb;
      #else
      vec3 cA = mix(texture2D(tA, pA).rgb, texture2D(tA, pA2).rgb, 0.45);
      #endif
      vec2 pC = vec2(vWPos.x, -vWPos.z) * sC;
      vec3 cC = texture2D(tC, pC).rgb;
      vec3 tw = pow(abs(Nw), vec3(5.0)); tw /= (tw.x + tw.y + tw.z);
      #ifdef TB_CHEAP
      vec3 cB = texture2D(tB, vWPos.xz * sB).rgb * tw.y + texture2D(tB, mix(vWPos.zy, vWPos.xy, step(tw.x, tw.z)) * sB).rgb * (1.0 - tw.y);
      #else
      vec3 cB = texture2D(tB, vWPos.zy * sB).rgb * tw.x + texture2D(tB, vWPos.xz * sB).rgb * tw.y + texture2D(tB, vWPos.xy * sB).rgb * tw.z;
      #endif
      // Height-contrast weighted blend so jagged stones poke sharply through soil instead of soft blurry fades
      if (uPhotoreal > 0.5) {
        float hRock = dot(cB, vec3(0.3333));
        float hSoil = dot(cA, vec3(0.3333));
        rockW = clamp(rockW + (hRock - hSoil) * 0.32 * rockW * (1.0 - rockW) * 4.0, 0.0, 1.0);
      }
      cB *= rockTint * 1.15;
      vec3 tint = mix(vec3(1.0), vColor.rgb / max(dot(vColor.rgb, vec3(0.3333)), 1e-3), 0.5);
      float lumV = dot(vColor.rgb, vec3(0.3333));
      cA *= tint * (0.82 + 0.5 * lumV);
      cC *= mix(vec3(1.0), tint, 0.5);
      float m1 = vnoise(vWPos.xz * 0.018 + 7.0), m2 = vnoise(vWPos.xz * 0.065), m3 = vnoise(vWPos.xz * 0.31);
      float macro = 0.62 + 0.55 * m1 + 0.3 * m2 + 0.2 * m3;
      vec3 hueShift = mix(vec3(1.03, 1.0, 0.95), vec3(0.97, 1.0, 1.03), m1);
      cA *= macro * hueShift;
      cB *= (0.7 + 0.6 * vnoise((vWPos.xz + vWPos.yy * vec2(0.9, -0.7)) * 0.065));
      cC *= (0.85 + 0.3 * m2);
      float dView = length(vViewPosition), nearK = 1.0 - smoothstep(35.0, 170.0, dView);
      float dpatch = smoothstep(0.52, 0.78, vnoise(vWPos.xz * 0.012 + 31.0)) * 0.34 + smoothstep(0.6, 0.85, vnoise(vWPos.xz * 0.11 + 5.0)) * 0.2 * nearK;
      float ripple = rippleK * sin(dot(vWPos.xz, vec2(0.62, 0.79)) * 5.5 + m2 * 12.0 + m1 * 20.0) * (0.5 + 0.5 * m3);
      vec2 sc = vWPos.xz * 1.9, ci = floor(sc), cf = fract(sc) - 0.5 - (vec2(hash12(ci + 3.1), hash12(ci + 7.7)) - 0.5) * 0.5;
      float hs = hash12(ci), sr = 0.05 + 0.16 * hash12(ci + 9.3);
      float stone = step(0.8, hs) * smoothstep(sr, sr * 0.5, length(cf)) * nearK;
      float lightStone = step(0.5, hash12(ci + 1.3));
      float grit = (hash12(floor(vWPos.xz * 22.0)) - 0.5) * 0.25 * nearK;
      cA *= (1.0 - dpatch) * (1.0 + 0.07 * ripple + grit); cC *= (1.0 - dpatch * 0.8) * (1.0 + 0.09 * ripple + grit);
      if (forestK > 0.5) {
        float fm1 = vnoise(vWPos.xz * 0.045 + 11.0), fm2 = vnoise(vWPos.xz * 0.21 + 2.0), fm3 = vnoise(vWPos.xz * 1.3 + 5.0), fm4 = vnoise(vWPos.xz * 0.011 + 41.0);
        float moss = smoothstep(0.5, 0.76, fm1) * (0.6 + 0.4 * fm2);
        float litter = smoothstep(0.55, 0.8, fm4 + (fm2 - 0.5) * 0.3);
        float grass = smoothstep(0.58, 0.82, vnoise(vWPos.xz * 0.09 + 77.0)) * (0.5 + 0.5 * fm3);
        vec3 gl = cA;
        gl = mix(gl, gl * vec3(0.66, 1.12, 0.52) * 1.15, moss * 0.8);
        gl = mix(gl, gl * vec3(1.35, 0.95, 0.68), litter * 0.55);
        gl = mix(gl, vec3(0.5, 0.46, 0.27) * (0.8 + 0.5 * fm3), grass * 0.5 * nearK);
        gl *= 0.88 + 0.28 * fm3 * nearK;
        cA = mix(cA, gl, 1.0 - vMask.z * 0.7);
      }
      vec3 ground = mix(cA, cC, vMask.x);
      ground = mix(ground, ground * mix(0.45, 1.35, lightStone), stone * 0.85 * (1.0 - vMask.y));
      vec3 albedo = mix(ground, cB, rockW);
      vec3 wet = vColor.rgb * (0.5 + 1.0 * dot(cC, vec3(0.3333)));
      albedo = mix(albedo, wet, vMask.y);
      albedo = mix(vec3(dot(albedo, vec3(0.3333))), albedo, mix(satK, 1.0, vMask.y)) * mix(brightK, 1.0, vMask.y);
      // Wet soil/rock darkening + drifting cloud shadows
      if (uPhotoreal > 0.5) {
        float wT = clamp(uWetness, 0.0, 1.0) * (1.0 - vMask.y);
        albedo *= mix(1.0, 0.68, wT * 0.75);
        albedo *= mix(1.0, cloudShadowAt(vWPos.xz, uTime, uCloudCov), 0.75);
      }
      diffuseColor.rgb = albedo;`)
      .replace('#include <color_fragment>', '')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      #ifndef TB_CHEAP
      {
        vec3 nA = texture2D(tAn, pA).xyz * 2.0 - 1.0; vec3 nC = texture2D(tCn, pC).xyz * 2.0 - 1.0;
        vec3 off = vec3(nA.x, 0.0, -nA.y) * 0.95 * (1.0 - vMask.x) + vec3(nC.x, 0.0, -nC.y) * 0.75 * vMask.x;
        vec3 nx = texture2D(tBn, vWPos.zy * sB).xyz * 2.0 - 1.0, ny2 = texture2D(tBn, vWPos.xz * sB).xyz * 2.0 - 1.0, nz = texture2D(tBn, vWPos.xy * sB).xyz * 2.0 - 1.0;
        vec3 offB = (vec3(0.0, nx.y, -nx.x) * tw.x + vec3(ny2.x, 0.0, -ny2.y) * tw.y + vec3(nz.x, nz.y, 0.0) * tw.z) * 1.2;
        vec3 Np = normalize(Nw + mix(off, offB, rockW) * (1.0 - vMask.y * 0.8));
        normal = normalize((viewMatrix * vec4(Np, 0.0)).xyz);
      }
      #endif`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      if (uPhotoreal > 0.5) {
        #ifndef TB_CHEAP
        float rA = texture2D(tAr, pA).r;
        float rC = texture2D(tCr, pC).r;
        float rB = texture2D(tBr, vWPos.xz * sB).r * tw.y + texture2D(tBr, mix(vWPos.zy, vWPos.xy, step(tw.x, tw.z)) * sB).r * (1.0 - tw.y);
        float texR = mix(mix(rA, rC, vMask.x), rB, rockW);
        float baseR = clamp(0.45 + texR * 0.55, 0.42, 0.98);
        #else
        float baseR = 0.92;
        #endif
        float wetR = mix(baseR, baseR * 0.42, clamp(uWetness, 0.0, 1.0));
        roughnessFactor = mix(wetR, 0.55, vMask.y);
      } else {
        roughnessFactor = mix(0.97, 0.78, vMask.y);
      }`);
  };
  mat.customProgramCacheKey = () => 'tb-terrain-pr' + (PERF.cheapTerrain ? '-lo' : '');
  mat.userData.U = U;
  return mat;
}

// ------------------------------------------------------------------ Planar world-space detail (shoulders, desert floor)
export function planarDetailMaterial(tex, scale, base = {}, strength = 1.0) {
  const rp = rippleNow;
  const mat = new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.94, metalness: 0 }, base));
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tD = { value: tex };
    sh.uniforms.sD = { value: scale };
    sh.uniforms.rippleP = { value: rp };
    sh.uniforms.uWetness = ENV_STATE.uWetness;
    sh.uniforms.uTime = ENV_STATE.uTime;
    sh.uniforms.uCloudCov = ENV_STATE.uCloudCov;
    sh.uniforms.uPhotoreal = ENV_STATE.uPhotoreal;
    patchVertex(sh, false);
    sh.fragmentShader = 'varying vec3 vWPos; varying vec3 vWNrm; uniform sampler2D tD; uniform float sD, rippleP, uWetness, uTime, uCloudCov, uPhotoreal;\n' + NOISE + sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
      { vec3 d = mix(texture2D(tD, vWPos.xz * sD).rgb, texture2D(tD, vec2(vWPos.z, vWPos.x) * sD * 0.37 + 0.2).rgb, 0.45); float l = dot(d, vec3(0.3333)) + 0.001;
        vec3 dn = mix(vec3(l), d, 0.4) / max(l, 0.05) * (0.35 + 1.3 * l);
        diffuseColor.rgb *= mix(vec3(1.0), dn, ${strength.toFixed(2)}); }
      {
        float dV = length(vViewPosition), nk = 1.0 - smoothstep(35.0, 170.0, dV);
        float m1 = vnoise(vWPos.xz * 0.018 + 7.0), m2 = vnoise(vWPos.xz * 0.065), m3 = vnoise(vWPos.xz * 0.31);
        float macro = 0.7 + 0.5 * m1 + 0.22 * m2 + 0.12 * m3;
        float dpatch = smoothstep(0.52, 0.78, vnoise(vWPos.xz * 0.012 + 31.0)) * 0.34 + smoothstep(0.6, 0.85, vnoise(vWPos.xz * 0.11 + 5.0)) * 0.2 * nk;
        float rip = rippleP * sin(dot(vWPos.xz, vec2(0.62, 0.79)) * 5.5 + m2 * 12.0 + m1 * 20.0) * (0.5 + 0.5 * m3);
        vec2 sc = vWPos.xz * 1.9, ci = floor(sc), cf = fract(sc) - 0.5 - (vec2(hash12(ci + 3.1), hash12(ci + 7.7)) - 0.5) * 0.5;
        float sr = 0.05 + 0.16 * hash12(ci + 9.3), stone = step(0.8, hash12(ci)) * smoothstep(sr, sr * 0.5, length(cf)) * nk;
        float grit = (hash12(floor(vWPos.xz * 22.0)) - 0.5) * 0.25 * nk;
        diffuseColor.rgb *= 0.9 * macro * (1.0 - dpatch) * (1.0 + 0.07 * rip + grit) * mix(1.0, mix(0.45, 1.35, step(0.5, hash12(ci + 1.3))), stone * 0.85);
        if (uPhotoreal > 0.5) {
          diffuseColor.rgb *= mix(1.0, 0.66, clamp(uWetness, 0.0, 1.0) * 0.72);
          diffuseColor.rgb *= mix(1.0, cloudShadowAt(vWPos.xz, uTime, uCloudCov), 0.7);
        }
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      if (uPhotoreal > 0.5) roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.45, clamp(uWetness, 0.0, 1.0));`);
  };
  mat.customProgramCacheKey = () => 'tb-planar-pr-' + strength;
  return mat;
}

// ------------------------------------------------------------------ Props (rocks, palms, shrubs, manmade)
// Adds organic wind sway & backlit foliage translucency for 'tree', wet glistening for 'rock'/'plant'.
export function propMaterial(rockTex, rockScale, rockTint, mode) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: false,
    roughness: mode === 'rock' ? 0.90 : mode === 'plant' ? 0.84 : 0.86,
    metalness: mode === 'plant' ? 0.06 : 0,
    side: THREE.DoubleSide
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tR = { value: rockTex };
    sh.uniforms.sR = { value: rockScale };
    sh.uniforms.uTime = ENV_STATE.uTime;
    sh.uniforms.uWind = ENV_STATE.uWind;
    sh.uniforms.uWetness = ENV_STATE.uWetness;
    sh.uniforms.uSunDir = ENV_STATE.uSunDir;
    sh.uniforms.uSunCol = ENV_STATE.uSunCol;
    sh.uniforms.uPhotoreal = ENV_STATE.uPhotoreal;
    patchVertex(sh, true);
    if (mode === 'tree') {
      sh.vertexShader = 'uniform float uTime, uWind, uPhotoreal;\n' + sh.vertexShader
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n objectNormal = normalize(mix(objectNormal, normalize(vec3(position.x, 0.3 * position.y + 0.12, position.z)), 0.62));')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (uPhotoreal > 0.5) {
          mat4 wM2 = modelMatrix;
          #ifdef USE_INSTANCING
          wM2 = modelMatrix * instanceMatrix;
          #endif
          vec3 wBase = (wM2 * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float ph = wBase.x * 0.17 + wBase.z * 0.13;
          float hK = clamp(transformed.y * 0.85, 0.0, 1.4);
          float sway = (sin(uTime * 1.45 + ph) * 0.65 + sin(uTime * 2.8 + ph * 1.7) * 0.35) * 0.045 * uWind * hK * hK;
          transformed.x += sway;
          transformed.z += sway * 0.55;
        }`);
    }
    sh.fragmentShader = 'varying vec3 vWPos; varying vec3 vWNrm; varying vec3 vLoc; uniform sampler2D tR; uniform float sR, uWetness, uPhotoreal; uniform vec3 uSunDir, uSunCol;\n' + NOISE + sh.fragmentShader
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      { float camD = length(vViewPosition); float fade = smoothstep(3.5, 11.0, camD);
        float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); if (fade < ign) discard; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      float rockH = 0.0;
      {
        ${mode === 'rock' ? `
        vec3 fn = normalize(cross(dFdx(vLoc), dFdy(vLoc)));
        vec3 tw = pow(abs(fn), vec3(4.0)); tw /= (tw.x + tw.y + tw.z);
        vec3 mean = max(textureLod(tR, vec2(0.5), 10.0).rgb, vec3(0.01));
        vec3 r = texture2D(tR, vLoc.zy * sR).rgb * tw.x + texture2D(tR, vLoc.xz * sR).rgb * tw.y + texture2D(tR, vLoc.xy * sR).rgb * tw.z;
        r += (texture2D(tR, vLoc.zy * sR * 3.1 + 0.3).rgb * tw.x + texture2D(tR, vLoc.xz * sR * 3.1 + 0.3).rgb * tw.y + texture2D(tR, vLoc.xy * sR * 3.1 + 0.3).rgb * tw.z - mean) * 0.5;
        vec3 detail = max(r, vec3(0.0)) / mean;
        float dl = dot(detail, vec3(0.3333));
        detail = mix(vec3(dl), detail, 0.45);
        rockH = dl * 0.5;
        diffuseColor.rgb = vColor.rgb * detail * ${rockTint} * 1.15;
        if (uPhotoreal > 0.5) diffuseColor.rgb *= mix(1.0, 0.65, clamp(uWetness, 0.0, 1.0) * 0.75);
        ` : `
        ${mode === 'tree' ? `
        float n = vnoise(vWPos.xz * 0.45 + vWPos.y * 0.3) * 0.7 + vnoise(vWPos.xz * 1.6 + vWPos.y * 1.1) * 0.3;
        diffuseColor.rgb *= 0.84 + 0.3 * n;` : `
        float n = vnoise(vWPos.xz * 3.1 + vWPos.y * 1.7) * 0.6 + vnoise(vWPos.xz * 11.0 + vWPos.y * 5.0) * 0.4;
        diffuseColor.rgb *= 0.74 + 0.52 * n;`}
        if (uPhotoreal > 0.5) diffuseColor.rgb *= mix(1.0, 0.74, clamp(uWetness, 0.0, 1.0) * 0.6);
        `}
      }`)
      .replace('#include <color_fragment>', mode === 'rock' ? '' : '#include <color_fragment>')
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      if (uPhotoreal > 0.5) roughnessFactor = mix(roughnessFactor, ${mode === 'rock' ? '0.32' : '0.40'}, clamp(uWetness, 0.0, 1.0) * 0.75);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      ${mode === 'rock' ? `{
        vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
        vec3 R1 = cross(sy, normal), R2 = cross(normal, sx);
        float fDet = dot(sx, R1);
        vec3 grad = sign(fDet) * (dFdx(rockH) * 0.015 * R1 + dFdy(rockH) * 0.015 * R2);
        normal = normalize(abs(fDet) * normal - grad);
      }` : ''}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      ${mode === 'tree' ? `
      if (uPhotoreal > 0.5) {
        // Warm sunlit subsurface translucency when leaves/fronds are backlit by the sun
        vec3 viewW = normalize(cameraPosition - vWPos);
        float back = pow(clamp(dot(-viewW, normalize(uSunDir)), 0.0, 1.0), 3.0);
        reflectedLight.directDiffuse += diffuseColor.rgb * uSunCol * back * 0.42;
      }` : ''}`);
  };
  mat.customProgramCacheKey = () => 'tb-prop-pr-' + mode + rockTint;
  return mat;
}

// ------------------------------------------------------------------ Conifers with organic wind sway & sunlit translucency
let needleTex = null;
export function needleTexture() {
  if (needleTex) return needleTex;
  needleTex = texLoader.load(ASSET_BASE + 'assets/tex/conifer_atlas.png');
  needleTex.flipY = false;
  needleTex.colorSpace = THREE.SRGBColorSpace;
  needleTex.generateMipmaps = true;
  needleTex.minFilter = THREE.LinearMipmapLinearFilter;
  needleTex.anisotropy = Math.min(8, maxAniso);
  needleTex.wrapS = needleTex.wrapT = THREE.ClampToEdgeWrapping;
  return needleTex;
}

export function coniferMaterial() {
  const tex = needleTexture();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, map: tex, alphaTest: 0.5,
    roughness: 0.85, metalness: 0, side: THREE.DoubleSide
  });
  mat.color.setScalar(2.0);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = ENV_STATE.uTime;
    sh.uniforms.uWind = ENV_STATE.uWind;
    sh.uniforms.uWetness = ENV_STATE.uWetness;
    sh.uniforms.uSunDir = ENV_STATE.uSunDir;
    sh.uniforms.uSunCol = ENV_STATE.uSunCol;
    sh.uniforms.uPhotoreal = ENV_STATE.uPhotoreal;
    patchVertex(sh, true);
    sh.vertexShader = 'uniform float uTime, uWind, uPhotoreal;\n' + sh.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n objectNormal = normalize(mix(objectNormal, normalize(vec3(position.x, 0.25 * position.y + 0.1, position.z)), 0.7));')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      if (uPhotoreal > 0.5) {
        mat4 wM2 = modelMatrix;
        #ifdef USE_INSTANCING
        wM2 = modelMatrix * instanceMatrix;
        #endif
        vec3 wBase = (wM2 * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float ph = wBase.x * 0.13 + wBase.z * 0.11;
        float hK = clamp(transformed.y, 0.0, 1.0);
        float sway = (sin(uTime * 1.25 + ph) * 0.65 + sin(uTime * 2.5 + ph * 1.9 + transformed.y * 2.0) * 0.35) * 0.032 * uWind * hK * hK;
        transformed.x += sway;
        transformed.z += sway * 0.6;
      }`);
    sh.fragmentShader = 'varying vec3 vWPos; varying vec3 vWNrm; varying vec3 vLoc; uniform float uWetness, uPhotoreal; uniform vec3 uSunDir, uSunCol;\n' + NOISE + sh.fragmentShader
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      { float camD = length(vViewPosition); float fade = smoothstep(3.5, 11.0, camD);
        float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); if (fade < ign) discard; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      { float aa = diffuseColor.a; diffuseColor.a = clamp((aa - 0.36) / max(fwidth(aa) * 1.2, 0.0001) + 0.5, 0.0, 1.0);
        float n = vnoise(vWPos.xz * 0.45 + vWPos.y * 0.3) * 0.7 + vnoise(vWPos.xz * 1.6 + vWPos.y * 1.1) * 0.3;
        diffuseColor.rgb *= 0.84 + 0.3 * n;
        diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.3333))), diffuseColor.rgb, 0.80) * vec3(1.03, 1.0, 0.94);
        if (uPhotoreal > 0.5) diffuseColor.rgb *= mix(1.0, 0.78, clamp(uWetness, 0.0, 1.0) * 0.55); }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      if (uPhotoreal > 0.5) roughnessFactor = mix(roughnessFactor, 0.46, clamp(uWetness, 0.0, 1.0) * 0.65);`)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n #ifdef DOUBLE_SIDED\n normal *= faceDirection;\n #endif')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      if (uPhotoreal > 0.5) {
        vec3 viewW = normalize(cameraPosition - vWPos);
        float back = pow(clamp(dot(-viewW, normalize(uSunDir)), 0.0, 1.0), 3.2);
        reflectedLight.directDiffuse += diffuseColor.rgb * uSunCol * vec3(0.75, 1.05, 0.55) * back * 0.38;
      }`);
  };
  mat.customProgramCacheKey = () => 'tb-conifer-pr';
  mat.userData.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.4, side: THREE.DoubleSide });
  return mat;
}

// ------------------------------------------------------------------ Photorealistic Reflective Water
// 4-octave animated wave ripples, live mirrored sky + mountain reflection pass,
// Beer-Lambert shallow-to-deep color absorption, blazing sun glitter, and multi-wave shoreline foam.
export function waterMaterial(env, nm, depthTex, bbox, kind) {
  const alp = kind === 'alpine';
  const mat = new THREE.MeshPhysicalMaterial({
    color: env.waterColor,
    roughness: alp ? 0.045 : 0.09,
    metalness: 0,
    clearcoat: 0.0,
    transparent: true,
    opacity: 1,
    normalMap: nm,
    normalScale: new THREE.Vector2(0.42, 0.42),
    envMapIntensity: alp ? 0.85 : 1.0,
    depthWrite: false,
    specularIntensity: 1.0
  });
  const U = {
    tDepth: { value: depthTex },
    wBox: { value: new THREE.Vector4(bbox.minx, bbox.minz, bbox.maxx - bbox.minx, bbox.maxz - bbox.minz) },
    wTime: { value: 0 },
    shallow: { value: new THREE.Color(alp ? '#38968f' : '#58aeb0') },
    deep: { value: new THREE.Color(alp ? '#0a2d40' : env.waterColor) },
    skyC: { value: new THREE.Color(alp ? '#4f86bd' : '#8dbde0') },
    alpine: { value: alp ? 1 : 0 },
    tRefl: ENV_STATE.uWaterRefl,
    uReflOn: ENV_STATE.uWaterReflOn,
    uRes: ENV_STATE.uRes,
    uSunDir: ENV_STATE.uSunDir,
    uSunCol: ENV_STATE.uSunCol,
    uPhotoreal: ENV_STATE.uPhotoreal
  };
  mat.userData.U = U;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'varying vec3 vWP;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'varying vec3 vWP; uniform sampler2D tDepth, tRefl; uniform vec4 wBox; uniform float wTime, alpine, uReflOn, uPhotoreal; uniform vec2 uRes; uniform vec3 shallow, deep, skyC, uSunDir, uSunCol;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
      vec2 wuv = (vWP.xz - wBox.xy) / wBox.zw;
      float dpt = (wuv.x < 0.0 || wuv.y < 0.0 || wuv.x > 1.0 || wuv.y > 1.0) ? 40.0 : texture2D(tDepth, wuv).r * 40.0;
      float dmix = 1.0 - exp(-max(dpt, 0.0) * 0.19);
      vec3 wcol = mix(shallow, deep, smoothstep(0.0, 0.85, dmix));
      // multi-band animated shoreline foam waves
      float wave1 = sin(dpt * 9.0 - wTime * 2.4 + sin(vWP.x * 0.14 + vWP.z * 0.11) * 3.0);
      float foam = (1.0 - smoothstep(0.0, 0.42, dpt)) * (0.55 + 0.45 * sin(vWP.x * 0.9 + vWP.z * 0.7 + wTime * 1.4));
      foam += (1.0 - smoothstep(0.2, 1.45, dpt)) * smoothstep(0.45, 0.92, wave1) * 0.42 * uPhotoreal;
      diffuseColor.rgb = mix(wcol, vec3(0.86, 0.91, 0.94), clamp(foam, 0.0, 1.0) * 0.62);
      diffuseColor.a = mix(0.24, 0.98, smoothstep(0.0, 2.0, dpt));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      vec3 wWorldN = vec3(0.0, 1.0, 0.0);
      {
        vec2 q1 = vWP.xz * 0.038 + vec2(wTime * 0.011, wTime * 0.008);
        vec2 q2 = vWP.xz * 0.15 + vec2(-wTime * 0.019, wTime * 0.014);
        vec2 q3 = vWP.xz * 0.42 + vec2(wTime * 0.028, -wTime * 0.022);
        vec3 a = texture2D(normalMap, q1).xyz * 2.0 - 1.0;
        vec3 b = texture2D(normalMap, q2).xyz * 2.0 - 1.0;
        vec3 c = texture2D(normalMap, q3).xyz * 2.0 - 1.0;
        float far = smoothstep(120.0, 950.0, length(vViewPosition));
        float amp = mix(0.32, 0.42, 1.0 - alpine);
        vec2 slope = (a.xy * 0.48 + b.xy * 0.34 + c.xy * 0.18 * uPhotoreal) * amp;
        vec3 Nw = normalize(vec3(slope.x, 1.0, -slope.y));
        Nw = normalize(mix(Nw, vec3(0.0, 1.0, 0.0), far * 0.68));
        wWorldN = Nw;
        normal = normalize((viewMatrix * vec4(Nw, 0.0)).xyz);
      }`)
      .replace('#include <opaque_fragment>', `
      {
        vec3 Vv = normalize(vViewPosition);
        float ndv = clamp(dot(normalize(normal), Vv), 0.0, 1.0);
        float fr = mix(0.03, 1.0, pow(1.0 - ndv, 4.4));
        if (uPhotoreal > 0.5 && uReflOn > 0.5) {
          vec2 suv = gl_FragCoord.xy / max(uRes, vec2(1.0));
          vec2 ruv = vec2(suv.x, 1.0 - suv.y) + wWorldN.xz * vec2(0.045, 0.075);
          ruv = clamp(ruv, vec2(0.003), vec2(0.997));
          vec3 refl = texture2D(tRefl, ruv).rgb;
          float reflAmt = clamp(fr * 0.88, 0.04, 0.86) * smoothstep(0.0, 1.8, dpt);
          outgoingLight = mix(outgoingLight, refl, reflAmt);
        } else {
          outgoingLight += skyC * fr * (0.28 + 0.30 * alpine) * (0.5 + 0.5 * smoothstep(0.0, 3.0, dpt));
        }
        // Crisp sunlit wave-crest sparkle glitter
        if (uPhotoreal > 0.5) {
          vec3 viewW = normalize(cameraPosition - vWP);
          vec3 Hw = normalize(viewW + normalize(uSunDir));
          float sp1 = pow(max(dot(wWorldN, Hw), 0.0), 340.0);
          float sp2 = pow(max(dot(wWorldN, Hw), 0.0), 48.0);
          outgoingLight += uSunCol * (sp1 * 3.8 + sp2 * 0.28) * smoothstep(0.0, 1.2, dpt);
        }
      }
      #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'tb-water-pr-' + kind;
  return mat;
}
