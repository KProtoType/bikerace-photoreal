// Photorealistic renderer: physical Rayleigh/Mie sky, animated volumetric-lit clouds,
// true HDR PMREM environment dome (blazing sun + clouds + horizon + dark road bounce),
// forward-shifted 4K/2K soft shadows, live mirrored mountain+sky water reflection target,
// and AgX filmic post-processing with optical sun glare, speed motion blur & desert heat shimmer.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { getNoiseTex, ENV_STATE } from './materials.js';
import { PERF } from './perf.js';

const SKY_VERT = `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w;
}`;

const SKY_FRAG = `
uniform vec3 top;
uniform vec3 mid;
uniform vec3 horizon;
uniform vec3 groundCol;
uniform vec3 sunCol;
uniform vec3 sunDir;
uniform float sunAmt;
uniform float hdrSun;
uniform float cloudAmt;
uniform float cloudDark;
uniform float haze;
uniform float time;
uniform float photoreal;
uniform sampler2D tN;
varying vec3 vDir;

float cloudFbm(vec2 uv) {
  vec4 n1 = texture2D(tN, uv * 0.28 + vec2(time * 0.0022, time * 0.0012));
  vec4 n2 = texture2D(tN, uv * 0.78 + vec2(-time * 0.0031, time * 0.0020) + 0.37);
  vec4 n3 = texture2D(tN, uv * 2.15 + vec2(time * 0.0042, -time * 0.0015) + 0.71);
  return n1.r * 0.58 + n2.g * 0.28 + n3.r * 0.14;
}

void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 sDir = normalize(sunDir);
  float cosT = max(dot(d, sDir), 0.0);

  // Rayleigh-like zenith-to-horizon scattering + warm horizon Mie belt
  vec3 c = mix(horizon, mid, smoothstep(0.0, 0.22, max(h, 0.0)));
  c = mix(c, top, smoothstep(0.14, 0.78, max(h, 0.0)));

  if (h < 0.0) {
    // Ground/road reflection hemisphere (critical for realistic metallic/chrome reflections in PMREM!)
    float gd = smoothstep(0.0, -0.35, h);
    vec3 gCol = mix(horizon * 0.72, groundCol, gd);
    c = mix(horizon * 0.92, gCol, smoothstep(0.0, -0.08, h));
  }

  // Forward Mie horizon scattering glow around the sun azimuth
  float horBand = exp(-max(h, 0.0) * 9.5);
  float mieGlow = pow(cosT, 5.0) * 0.32 + pow(cosT, 24.0) * 0.38;
  c = mix(c, horizon, haze * exp(-max(h, 0.0) * 14.0));
  c += sunCol * sunAmt * (mieGlow * (0.45 + 0.55 * horBand) + pow(cosT, 650.0) * hdrSun);

  // Multi-layer volumetric-lit clouds with Beer-Lambert shading & silver lining
  if (cloudAmt > 0.005 && h > 0.005) {
    vec2 uv = d.xz / (h + 0.13) * 0.52 + vec2(0.31, 0.17);
    float dens = cloudFbm(uv);
    float cov = clamp(cloudAmt, 0.0, 0.95);
    float cl = smoothstep(0.56 - cov * 0.34, 0.86 - cov * 0.18, dens) * smoothstep(0.012, 0.22, h);

    if (photoreal > 0.5) {
      // Sample slightly toward sun for self-shadowed cloud bellies + bright sunlit tops
      vec2 sunOff = sDir.xz / max(sDir.y + 0.35, 0.25) * 0.055;
      float densSun = cloudFbm(uv + sunOff);
      float lightTrans = exp(-max(densSun - 0.32, 0.0) * (2.8 + cloudDark * 2.4));
      vec3 litCol = mix(vec3(1.0), sunCol, 0.35) * (0.95 + 0.25 * lightTrans);
      vec3 shadCol = mix(mid * 0.65, horizon * 0.52, 0.5) * (1.0 - cloudDark * 0.38);
      vec3 cc = mix(shadCol, litCol, clamp(lightTrans * 1.15, 0.0, 1.0));
      // Silver-lining forward scatter when clouds pass near the sun
      float silver = pow(cosT, 14.0) * (1.0 - smoothstep(0.55, 0.92, dens)) * 1.25;
      cc += sunCol * silver * sunAmt;
      // Distant atmospheric perspective melts far clouds gently into the horizon
      float farFade = smoothstep(0.015, 0.18, h);
      cc = mix(horizon, cc, farFade);
      c = mix(c, cc, cl * (0.88 + 0.1 * cloudDark));
    } else {
      vec3 cc = mix(mix(horizon, vec3(1.0), 0.55), vec3(1.0), 0.4);
      cc = mix(cc, cc * vec3(0.8, 0.82, 0.9), smoothstep(0.55, 0.9, dens) * 0.7);
      cc += sunCol * 0.18 * pow(cosT, 6.0);
      c = mix(c, cc, cl * 0.9);
    }
  }
  gl_FragColor = vec4(max(c, vec3(0.0)), 1.0);
}`;

// Per-track + Weather/Time-of-Day presets (Sunny, Golden Hour, Post-Rain)
function computeAtmosphere(env, weather, photoreal) {
  const kind = env.kind;
  const out = {
    top: env.sky.top,
    mid: env.sky.mid,
    horizon: env.sky.horizon,
    sun: env.sky.sun,
    ground: kind === 'desert' ? '#5c4b37' : kind === 'coast' ? '#2c4248' : '#2f3829',
    az: env.sky.az,
    el: env.sky.el,
    cloud: env.sky.cloud != null ? env.sky.cloud : 0.32,
    cloudDark: 0.12,
    haze: env.sky.haze != null ? env.sky.haze : 0.25,
    fog: env.fog,
    fogNear: env.fogNear,
    fogFar: env.fogFar,
    sunInt: env.light.sun,
    hemiSky: env.light.hemiSky,
    hemiGround: env.light.hemiGround,
    hemiInt: env.light.hemi,
    envInt: env.light.envInt != null ? env.light.envInt : 0.9,
    exposure: env.light.exposure || 1.0,
    wetness: 0.0,
    rain: 0.0,
    wind: kind === 'coast' ? 1.15 : kind === 'alpine' ? 0.75 : 0.55,
    bloomStr: 0.20,
    bloomThresh: 1.35,
    sat: (env.grade && env.grade.sat) || 0.92,
    contrast: (env.grade && env.grade.contrast) || 1.10,
    lift: (env.grade && env.grade.lift) || 0.008,
    vig: (env.grade && env.grade.vig) || 0.28,
    shadowTint: (env.grade && env.grade.shadowTint) || [0.92, 0.96, 1.08],
    highTint: (env.grade && env.grade.highTint) || [1.05, 1.01, 0.95],
    heatShimmer: kind === 'desert' ? 0.85 : 0.0
  };

  if (!photoreal) {
    out.bloomStr = 0.16;
    out.bloomThresh = 2.4;
    out.heatShimmer = 0.0;
    return out;
  }

  if (weather === 'sunny') {
    // Crisp, vivid real-world signature look per track
    if (kind === 'alpine') {
      out.top = '#1d53a8'; out.mid = '#5d92d0'; out.horizon = '#cfe2f2'; out.sun = '#fff5e2';
      out.fog = '#bcd4e8'; out.sunInt = 4.8; out.hemiInt = 1.65; out.envInt = 1.25; out.exposure = 1.04;
      out.cloud = 0.36; out.haze = 0.18; out.wetness = 0.06; out.sat = 1.06; out.contrast = 1.10;
    } else if (kind === 'desert') {
      out.top = '#3b6cb8'; out.mid = '#8eb2d9'; out.horizon = '#f0dec4'; out.sun = '#fff1d0';
      out.fog = '#e3d0b5'; out.sunInt = 5.1; out.hemiInt = 1.05; out.envInt = 1.15; out.exposure = 1.06;
      out.cloud = 0.22; out.haze = 0.32; out.wetness = 0.0; out.sat = 1.04; out.contrast = 1.12;
      out.heatShimmer = 1.0;
    } else {
      out.top = '#2265b8'; out.mid = '#6da7dc'; out.horizon = '#dfedf2'; out.sun = '#fff6e4';
      out.fog = '#c9dfe8'; out.sunInt = 4.6; out.hemiInt = 1.2; out.envInt = 1.25; out.exposure = 1.04;
      out.cloud = 0.42; out.haze = 0.22; out.wetness = 0.10; out.sat = 1.06; out.contrast = 1.08;
    }
  } else if (weather === 'golden') {
    // Low dramatic golden-hour sun, long cinematic shadows, warm amber specular fire on chrome & road
    out.el = 0.19;
    out.az = kind === 'coast' ? 3.55 : kind === 'desert' ? 0.65 : 0.42;
    out.top = '#273a6e';
    out.mid = '#b6755e';
    out.horizon = '#f6b372';
    out.sun = '#ffbe73';
    out.ground = '#3d2c22';
    out.fog = '#deb087';
    out.fogNear = env.fogNear * 0.85;
    out.fogFar = env.fogFar * 0.82;
    out.sunInt = 5.4;
    out.hemiSky = '#e8a882';
    out.hemiGround = '#694e3c';
    out.hemiInt = 1.15;
    out.envInt = 1.35;
    out.exposure = 1.08;
    out.cloud = 0.48;
    out.cloudDark = 0.26;
    out.haze = 0.42;
    out.wetness = 0.24; // subtle warm evening sheen on road
    out.bloomStr = 0.28;
    out.bloomThresh = 1.15;
    out.sat = 1.12;
    out.contrast = 1.14;
    out.shadowTint = [0.88, 0.92, 1.14];
    out.highTint = [1.10, 1.00, 0.88];
    out.heatShimmer = kind === 'desert' ? 0.55 : 0.0;
  } else if (weather === 'rain') {
    // Moody post-rain photorealism: brooding silver clouds, wet dark asphalt with mirror puddles, glowing brake/headlights
    out.el = 0.36;
    out.top = '#384658';
    out.mid = '#697a8b';
    out.horizon = '#a4b2be';
    out.sun = '#dde8f5';
    out.ground = '#1c2228';
    out.fog = '#8e9ea9';
    out.fogNear = env.fogNear * 0.62;
    out.fogFar = env.fogFar * 0.58;
    out.sunInt = 2.4;
    out.hemiSky = '#9ab0c7';
    out.hemiGround = '#3e444a';
    out.hemiInt = 1.55;
    out.envInt = 1.45;
    out.exposure = 1.12;
    out.cloud = 0.86;
    out.cloudDark = 0.68;
    out.haze = 0.52;
    out.wetness = 0.90;
    out.rain = 0.85;
    out.wind = 1.45;
    out.bloomStr = 0.30;
    out.bloomThresh = 1.05;
    out.sat = 0.96;
    out.contrast = 1.15;
    out.shadowTint = [0.89, 0.95, 1.08];
    out.highTint = [0.98, 1.01, 1.06];
    out.heatShimmer = 0.0;
  }
  return out;
}

const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _t = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _camFwd = new THREE.Vector3(), _camUp = new THREE.Vector3(), _sunW = new THREE.Vector3();

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PERF.dprCap));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.info.autoReset = false;
  renderer.toneMapping = THREE.NoToneMapping; // AgX / ACES applied in our final post pass

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.35, 6500);
  const camera2 = camera.clone();

  // ---- lights
  const hemi = new THREE.HemisphereLight('#bcd8ff', '#556644', 1.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1d0', 4.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(PERF.shadowSize, PERF.shadowSize);
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.045;
  sun.shadow.radius = 2.4;
  const sc = sun.shadow.camera;
  sc.left = -PERF.shadowBox; sc.right = PERF.shadowBox;
  sc.top = PERF.shadowBox; sc.bottom = -PERF.shadowBox;
  sc.near = 1; sc.far = 340;
  scene.add(sun, sun.target);

  const sunDir = new THREE.Vector3(0.5, 0.8, 0.3).normalize();

  // ---- visible physical sky dome
  const skyU = {
    top: { value: new THREE.Color() },
    mid: { value: new THREE.Color() },
    horizon: { value: new THREE.Color() },
    groundCol: { value: new THREE.Color('#2c332a') },
    sunCol: { value: new THREE.Color() },
    sunDir: { value: sunDir },
    sunAmt: { value: 1 },
    hdrSun: { value: 6.5 },
    cloudAmt: { value: 0.35 },
    cloudDark: { value: 0.15 },
    haze: { value: 0.25 },
    time: ENV_STATE.uTime,
    photoreal: ENV_STATE.uPhotoreal,
    tN: { value: getNoiseTex() }
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyU, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    side: THREE.BackSide, depthWrite: false, fog: false
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4200, 40, 24), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);

  // ---- True HDR environment dome for PMREM reflections (blazing HDR sun + clouds + horizon + dark ground bounce!)
  const envU = {
    top: skyU.top,
    mid: skyU.mid,
    horizon: skyU.horizon,
    groundCol: skyU.groundCol,
    sunCol: skyU.sunCol,
    sunDir: skyU.sunDir,
    sunAmt: { value: 1.0 },
    hdrSun: { value: 36.0 },
    cloudAmt: skyU.cloudAmt,
    cloudDark: skyU.cloudDark,
    haze: skyU.haze,
    time: { value: 0 },
    photoreal: ENV_STATE.uPhotoreal,
    tN: skyU.tN
  };
  const envSky = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 18),
    new THREE.ShaderMaterial({
      uniforms: envU,
      vertexShader: SKY_VERT.replace('gl_Position.z = gl_Position.w;', ''),
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false
    })
  );
  const envScene = new THREE.Scene();
  envScene.add(envSky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  // ---- live mirrored water reflection (renders ONLY sky + distant mountains = 2 draw calls, <0.2ms!)
  let reflRT = new THREE.WebGLRenderTarget(PERF.waterReflectSize || 384, Math.round((PERF.waterReflectSize || 384) * 0.56), {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    type: THREE.HalfFloatType
  });
  const reflCam = camera.clone();
  const reflScene = new THREE.Scene();
  const reflSky = new THREE.Mesh(new THREE.SphereGeometry(4200, 28, 16), skyMat);
  reflSky.renderOrder = -10;
  reflSky.frustumCulled = false;
  reflScene.add(reflSky);
  let reflMountClone = null;
  let reflFrame = 0;

  // ---- post-processing: MSAA HalfFloat RT -> Bloom -> Filmic AgX + Optical Sun Glare + Speed Motion Blur + Heat Shimmer
  const size = new THREE.Vector2();
  renderer.getSize(size);
  let rt = new THREE.WebGLRenderTarget(Math.max(2, size.x), Math.max(2, size.y), { type: THREE.HalfFloatType, samples: PERF.msaa });
  const composer = new EffectComposer(renderer, rt);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloom = new UnrealBloomPass(new THREE.Vector2(Math.max(2, size.x), Math.max(2, size.y)), 0.20, 0.55, 1.35);
  composer.addPass(bloom);
  const origBloomSetSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => origBloomSetSize(Math.ceil(w / 2), Math.ceil(h / 2));
  bloom.setSize(Math.max(2, size.x), Math.max(2, size.y));
  bloom.enabled = !!PERF.bloom;

  const grade = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      exposure: { value: 1.0 },
      lift: { value: 0.008 },
      sat: { value: 1.04 },
      contrast: { value: 1.1 },
      vig: { value: 0.28 },
      shadowTint: { value: new THREE.Vector3(0.92, 0.96, 1.08) },
      highTint: { value: new THREE.Vector3(1.05, 1.01, 0.95) },
      time: { value: 0 },
      grain: { value: PERF.mobile ? 0 : 0.014 },
      photoreal: ENV_STATE.uPhotoreal,
      sunUv: { value: new THREE.Vector2(0.5, 0.75) },
      sunVis: { value: 0.0 },
      sunCol: { value: new THREE.Color('#fff3de') },
      sunGlareAmt: { value: PERF.sunGlare },
      speedBlur: { value: 0.0 },
      heatAmt: { value: 0.0 }
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float exposure, lift, sat, contrast, vig, time, grain, photoreal, sunVis, sunGlareAmt, speedBlur, heatAmt;
    uniform vec2 sunUv;
    uniform vec3 shadowTint, highTint, sunCol;
    varying vec2 vUv;

    // Blender 4 / Troy Sobotka AgX filmic tone mapping (preserves sunlit highlights & sky color without neon clipping)
    vec3 agxDefaultContrastApprox(vec3 x) {
      vec3 x2 = x * x;
      vec3 x4 = x2 * x2;
      return + 15.5     * x4 * x2
             - 40.14    * x4 * x
             + 31.96    * x4
             - 6.868    * x2 * x
             + 0.4298   * x2
             + 0.1191   * x
             - 0.00232;
    }
    vec3 agx(vec3 val) {
      const mat3 agx_mat = mat3(
        0.842479062253094, 0.0423282422610123, 0.0423756549057051,
        0.0784335999999992,  0.878468636469772,  0.0784336,
        0.0792237451477643, 0.0791661274605434, 0.879142973793104
      );
      const mat3 agx_mat_inv = mat3(
        1.19687900512017, -0.0528968517574562, -0.0529716355144438,
        -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
        -0.0990297440797205, -0.0989611768448433, 1.15107367264116
      );
      val = max(val * exposure, vec3(1e-6));
      val = agx_mat * val;
      val = clamp(log2(val), -12.47393, 4.026069);
      val = (val - (-12.47393)) / (4.026069 - (-12.47393));
      val = agxDefaultContrastApprox(val);
      val = agx_mat_inv * val;
      return clamp(val, 0.0, 1.0);
    }

    const mat3 ACESIn = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    const mat3 ACESOut = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    vec3 aces(vec3 c){ c *= exposure / 0.6; c = ACESIn * c; vec3 a = c * (c + 0.0245786) - 0.000090537; vec3 b = c * (0.983729 * c + 0.4329510) + 0.238081; return clamp(ACESOut * (a / b), 0.0, 1.0); }
    vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

    void main(){
      vec2 uv = vUv;
      // Subtle desert horizon heat-shimmer distortion
      if (photoreal > 0.5 && heatAmt > 0.01) {
        float hBand = smoothstep(0.34, 0.52, uv.y) * (1.0 - smoothstep(0.54, 0.72, uv.y));
        float sh = sin(uv.y * 130.0 - time * 14.0 + sin(uv.x * 45.0) * 2.0) * 0.0012 * heatAmt * hBand;
        uv.x += sh;
      }

      vec3 hdr = texture2D(tDiffuse, uv).rgb;

      // Speed-scaled radial camera-shutter motion blur (bike & road center stay tack-sharp!)
      if (photoreal > 0.5 && speedBlur > 0.015) {
        vec2 center = vec2(0.5, 0.46);
        vec2 dir = uv - center;
        float dist = length(dir * vec2(1.0, 1.25));
        float edgeMask = smoothstep(0.24, 0.78, dist);
        if (edgeMask > 0.01) {
          vec2 stepV = dir * (0.018 * speedBlur * edgeMask);
          vec3 acc = hdr * 0.34;
          acc += texture2D(tDiffuse, uv - stepV * 0.35).rgb * 0.24;
          acc += texture2D(tDiffuse, uv - stepV * 0.72).rgb * 0.20;
          acc += texture2D(tDiffuse, uv - stepV * 1.12).rgb * 0.13;
          acc += texture2D(tDiffuse, uv - stepV * 1.55).rgb * 0.09;
          hdr = acc;
        }
      }

      // Optical camera sun glare + subtle anamorphic streak when riding toward the sun
      if (photoreal > 0.5 && sunVis > 0.01 && sunGlareAmt > 0.01) {
        vec2 dS = (uv - sunUv) * vec2(1.77, 1.0);
        float rS = length(dS);
        float halo = exp(-rS * 3.8) * 0.26 + exp(-rS * 14.0) * 0.42;
        float streak = exp(-abs(dS.y) * 34.0) * exp(-abs(dS.x) * 2.4) * 0.16;
        // Subtle opposite-side ghost iris ring
        vec2 gUv = vec2(1.0) - sunUv;
        float gR = length((uv - mix(sunUv, gUv, 0.72)) * vec2(1.77, 1.0));
        float ghost = exp(-pow((gR - 0.11) * 18.0, 2.0)) * 0.045;
        hdr += sunCol * (halo + streak + ghost) * sunVis * sunGlareAmt;
      }

      vec3 c = photoreal > 0.5 ? agx(hdr) : toSRGB(aces(hdr));
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c *= mix(shadowTint, highTint, smoothstep(0.12, 0.82, l));
      c = mix(vec3(l), c, sat);
      c = (c - 0.5) * contrast + 0.5;
      c = max(c, 0.0) * (1.0 - lift) + lift;
      float d = length((vUv - 0.5) * vec2(1.25, 1.0));
      c *= 1.0 - vig * smoothstep(0.38, 0.96, d);
      c += (fract(sin(dot(vUv * 913.0 + time, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * grain;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`
  });
  composer.addPass(grade);

  let ratio = Math.max(PERF.minRatio, Math.min(window.devicePixelRatio || 1, PERF.dprCap, Math.sqrt(PERF.pixels / Math.max(1, window.innerWidth * window.innerHeight))));
  let split = false, soloRatio = ratio, saved = false;
  let lastEnv = null, lastLook = null, activeWaterY = -999;

  const DUO_PIXELS = 1350000, DUO_MIN_PIXELS = 850000;
  const pixelRatioFor = (px) => Math.sqrt(px / Math.max(1, window.innerWidth * window.innerHeight));

  function resize() {
    const w = window.innerWidth, h = window.innerHeight, vw = split ? w / 2 : w;
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(ratio);
    composer.setSize(vw, h);
    ENV_STATE.uRes.value.set(Math.round(vw * ratio), Math.round(h * ratio));
    for (const c of [camera, camera2]) { c.aspect = vw / h; c.updateProjectionMatrix(); }
  }
  window.addEventListener('resize', resize);
  resize();

  function applyQualityLive() {
    ratio = Math.max(PERF.minRatio, Math.min(window.devicePixelRatio || 1, PERF.dprCap, Math.sqrt(PERF.pixels / Math.max(1, window.innerWidth * window.innerHeight))));
    if (split) ratio = Math.min(ratio, pixelRatioFor(DUO_PIXELS));
    sun.shadow.mapSize.set(PERF.shadowSize, PERF.shadowSize);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    sc.left = -PERF.shadowBox; sc.right = PERF.shadowBox;
    sc.top = PERF.shadowBox; sc.bottom = -PERF.shadowBox;
    sc.updateProjectionMatrix();
    bloom.enabled = !!PERF.bloom && !split && !saved;
    grade.uniforms.sunGlareAmt.value = PERF.sunGlare;
    for (const t of [composer.renderTarget1, composer.renderTarget2]) { t.samples = PERF.msaa; t.dispose(); }
    if (PERF.waterReflect) {
      const rw = PERF.waterReflectSize || 384, rh = Math.round(rw * 0.56);
      if (reflRT.width !== rw) { reflRT.dispose(); reflRT = new THREE.WebGLRenderTarget(rw, rh, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, type: THREE.HalfFloatType }); }
      ENV_STATE.uWaterRefl.value = reflRT.texture;
    }
    ENV_STATE.uWaterReflOn.value = (PERF.waterReflect && PERF.photoreal && activeWaterY > -900) ? 1.0 : 0.0;
    resize();
  }

  const api = {
    renderer, scene, camera, camera2, composer, sun, hemi, sky, bloom, sunDir, grade,
    setReflectionMountains(mountainsMesh, waterY) {
      activeWaterY = waterY;
      if (reflMountClone) { reflScene.remove(reflMountClone); reflMountClone = null; }
      if (mountainsMesh && waterY > -900) {
        reflMountClone = new THREE.Mesh(mountainsMesh.geometry, mountainsMesh.material);
        reflMountClone.frustumCulled = false;
        reflScene.add(reflMountClone);
      }
      ENV_STATE.uWaterRefl.value = reflRT.texture;
      ENV_STATE.uWaterReflOn.value = (PERF.waterReflect && PERF.photoreal && waterY > -900) ? 1.0 : 0.0;
    },
    setEnv(env, look) {
      lastEnv = env; lastLook = look;
      const a = computeAtmosphere(env, PERF.weather, PERF.photoreal);
      const c = (h) => new THREE.Color(h);

      sky.visible = true;
      scene.background = null;
      skyU.top.value.copy(c(a.top));
      skyU.mid.value.copy(c(a.mid));
      skyU.horizon.value.copy(c(a.horizon));
      skyU.groundCol.value.copy(c(a.ground));
      skyU.sunCol.value.copy(c(a.sun));
      skyU.cloudAmt.value = a.cloud;
      skyU.cloudDark.value = a.cloudDark;
      skyU.haze.value = a.haze;
      skyU.hdrSun.value = PERF.photoreal ? (PERF.weather === 'rain' ? 2.2 : 8.5) : 1.2;

      sunDir.set(Math.cos(a.el) * Math.sin(a.az), Math.sin(a.el), Math.cos(a.el) * Math.cos(a.az)).normalize();
      sun.color.copy(c(a.sun));
      sun.intensity = a.sunInt;
      hemi.color.copy(c(a.hemiSky));
      hemi.groundColor.copy(c(a.hemiGround));
      hemi.intensity = a.hemiInt;

      scene.fog = new THREE.Fog(c(a.fog), a.fogNear * PERF.fogMul, a.fogFar * PERF.fogMul);
      api.fogColor = c(a.fog);

      // Update shared shader environment uniforms
      ENV_STATE.uWetness.value = PERF.photoreal ? a.wetness : 0.0;
      ENV_STATE.uRain.value = PERF.photoreal ? a.rain : 0.0;
      ENV_STATE.uCloudCov.value = a.cloud;
      ENV_STATE.uWind.value = a.wind;
      ENV_STATE.uSunDir.value.copy(sunDir);
      ENV_STATE.uSunCol.value.copy(c(a.sun));
      ENV_STATE.uFogCol.value.copy(c(a.fog));
      ENV_STATE.uPhotoreal.value = PERF.photoreal ? 1.0 : 0.0;
      ENV_STATE.uWaterReflOn.value = (PERF.waterReflect && PERF.photoreal && activeWaterY > -900) ? 1.0 : 0.0;

      // Bake true HDR PMREM reflections (or flat legacy envMap when Compare: Original is active)
      envU.sunAmt.value = PERF.photoreal ? (PERF.weather === 'rain' ? 0.35 : 1.0) : 0.0;
      envU.hdrSun.value = PERF.photoreal ? (PERF.weather === 'golden' ? 42.0 : 32.0) : 0.0;
      if (api.envMap) api.envMap.dispose();
      api.envMap = pmrem.fromScene(envScene, 0.015).texture;
      scene.environment = api.envMap;
      scene.environmentIntensity = a.envInt;

      const U = grade.uniforms;
      U.exposure.value = a.exposure;
      U.lift.value = a.lift;
      U.sat.value = a.sat;
      U.contrast.value = a.contrast;
      U.vig.value = a.vig;
      U.shadowTint.value.set(...a.shadowTint);
      U.highTint.value.set(...a.highTint);
      U.sunCol.value.copy(c(a.sun));
      U.heatAmt.value = a.heatShimmer;
      U.sunGlareAmt.value = PERF.photoreal ? PERF.sunGlare : 0.0;

      bloom.strength = a.bloomStr;
      bloom.threshold = a.bloomThresh;
      bloom.enabled = !!PERF.bloom && !split && !saved;
    },
    refreshEnv() {
      if (lastEnv) api.setEnv(lastEnv, lastLook);
    },
    applyQuality() {
      applyQualityLive();
      api.refreshEnv();
    },
    // Forward-shifted, texel-snapped sun shadow box + screen-space sun glare projection
    follow(pos, camPos, activeCam = camera, speedK = 0) {
      activeCam.getWorldDirection(_camFwd);
      const fwdPush = PERF.photoreal ? (PERF.shadowForward || 30) : 0;
      const fx = pos.x + _camFwd.x * fwdPush;
      const fy = pos.y;
      const fz = pos.z + _camFwd.z * fwdPush;
      const texel = (sc.right - sc.left) / PERF.shadowSize;
      const rx = _r.crossVectors(_up, sunDir).normalize();
      const ry = _u.crossVectors(sunDir, rx).normalize();
      _t.set(fx, fy, fz);
      const px = Math.round(_t.dot(rx) / texel) * texel;
      const py = Math.round(_t.dot(ry) / texel) * texel;
      const pd = _t.dot(sunDir);
      _t.set(0, 0, 0).addScaledVector(rx, px).addScaledVector(ry, py).addScaledVector(sunDir, pd);
      sun.target.position.copy(_t);
      sun.position.copy(_t).addScaledVector(sunDir, 150);
      sky.position.copy(camPos);
      sun.target.updateMatrixWorld();

      // Project sun into screen space for optical lens flare / glare
      if (PERF.photoreal && PERF.weather !== 'rain') {
        const dotFwd = _camFwd.dot(sunDir);
        if (dotFwd > 0.15) {
          _sunW.copy(camPos).addScaledVector(sunDir, 2000).project(activeCam);
          grade.uniforms.sunUv.value.set(_sunW.x * 0.5 + 0.5, _sunW.y * 0.5 + 0.5);
          const inFrame = 1.0 - Math.min(1.0, Math.max(Math.abs(_sunW.x) - 1.15, Math.abs(_sunW.y) - 1.15, 0) * 1.4);
          grade.uniforms.sunVis.value = Math.max(0, inFrame * Math.pow(Math.max(0, (dotFwd - 0.15) / 0.85), 1.35));
        } else {
          grade.uniforms.sunVis.value = 0.0;
        }
      } else {
        grade.uniforms.sunVis.value = 0.0;
      }

      // Speed-scaled radial motion blur (activates smoothly above ~55% top speed)
      const blurK = Math.max(0, (speedK - 0.45) / 0.55);
      grade.uniforms.speedBlur.value = PERF.photoreal ? (blurK * blurK * PERF.motionBlur) : 0.0;
    },
    renderWaterReflection(activeCam = camera) {
      if (!PERF.waterReflect || !PERF.photoreal || activeWaterY <= -900 || split) return;
      if ((reflFrame++ & 1) !== 0) return; // update every 2nd frame (~30Hz reflection = <0.15ms avg cost)
      activeCam.getWorldDirection(_camFwd);
      _camUp.set(0, 1, 0).applyQuaternion(activeCam.quaternion);
      reflCam.fov = activeCam.fov;
      reflCam.aspect = activeCam.aspect;
      reflCam.near = activeCam.near;
      reflCam.far = activeCam.far;
      reflCam.updateProjectionMatrix();
      reflCam.position.set(activeCam.position.x, 2 * activeWaterY - activeCam.position.y, activeCam.position.z);
      reflCam.up.set(-_camUp.x, _camUp.y, -_camUp.z).normalize();
      reflCam.lookAt(
        reflCam.position.x + _camFwd.x * 100,
        reflCam.position.y - _camFwd.y * 100,
        reflCam.position.z + _camFwd.z * 100
      );
      reflSky.position.copy(reflCam.position);
      const prevRT = renderer.getRenderTarget();
      const prevShadow = renderer.shadowMap.enabled;
      renderer.shadowMap.enabled = false;
      renderer.setRenderTarget(reflRT);
      renderer.clear();
      renderer.render(reflScene, reflCam);
      renderer.setRenderTarget(prevRT);
      renderer.shadowMap.enabled = prevShadow;
    },
    render() {
      grade.uniforms.time.value = (grade.uniforms.time.value + 0.37) % 1000;
      composer.render();
    },
    setSplit(on) {
      if (split === on) return; split = on;
      if (!on) renderPass.camera = camera;
      bloom.enabled = !!PERF.bloom && !on && !saved;
      ENV_STATE.uWaterReflOn.value = (!on && PERF.waterReflect && PERF.photoreal && activeWaterY > -900) ? 1.0 : 0.0;
      if (on) { soloRatio = ratio; ratio = Math.min(ratio, pixelRatioFor(DUO_PIXELS)); } else ratio = soloRatio;
      for (const t of [composer.renderTarget1, composer.renderTarget2]) { t.samples = PERF.msaa; t.dispose(); }
      renderer.setScissorTest(on); resize();
      if (api.onSplit) api.onSplit(on);
    },
    renderView(i, cam) {
      const w = window.innerWidth / 2, h = window.innerHeight;
      renderer.setViewport(i * w, 0, w, h); renderer.setScissor(i * w, 0, w, h);
      renderPass.camera = cam; api.render();
    },
    saveMore() { saved = true; sun.shadow.intensity = 0; sun.shadow.autoUpdate = false; bloom.enabled = false; },
    getRatio() { return ratio; },
    lowerSplitRes(k) { const lo = pixelRatioFor(DUO_MIN_PIXELS); if (ratio <= lo + 0.01) return false; ratio = Math.max(lo, ratio * (k || 0.92)); resize(); return true; },
    setRatio(r) { ratio = r; resize(); },
    resize
  };
  return api;
}
