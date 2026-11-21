// Real-time 3D GPU Particle & Atmosphere Engine:
// - Incandescent metallic sparks during crashes/scrapes (triggers HDR bloom)
// - Off-road dirt/sand/gravel plumes behind rear tires (color-matched per track)
// - Wet-road tire spray rooster-tails & angled rain streaks in Post-Rain mode
// - Subtle exhaust acceleration puffs & sunlit floating dust motes
import * as THREE from 'three';
import { PERF } from './perf.js';
import { ENV_STATE } from './materials.js';

function makeSoftDiscTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.7, 'rgba(255,255,255,0.16)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SPARK_VERT = `
attribute float aSize;
attribute float aLife;
attribute vec3 aColor;
varying float vLife;
varying vec3 vColor;
void main() {
  vLife = aLife;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * (340.0 / max(-mv.z, 1.0)), 1.0, 48.0);
  gl_Position = projectionMatrix * mv;
}`;

const SPARK_FRAG = `
uniform sampler2D uMap;
uniform float uGain;
varying float vLife;
varying vec3 vColor;
void main() {
  if (vLife <= 0.001) discard;
  vec4 t = texture2D(uMap, gl_PointCoord);
  float a = t.a * vLife;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vColor * uGain, a);
}`;

class ParticlePool {
  constructor(max, tex, additive, gain = 1.0) {
    this.max = max;
    this.cursor = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.groundY = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: tex }, uGain: { value: gain } },
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
  }

  emit(x, y, z, vx, vy, vz, r, g, b, size, ttl, grow, grav, drag, groundY = -9999) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const o = i * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz;
    this.col[o] = r; this.col[o + 1] = g; this.col[o + 2] = b;
    this.size[i] = size;
    this.life[i] = 1.0;
    this.maxLife[i] = Math.max(0.05, ttl);
    this.grow[i] = grow;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.groundY[i] = groundY;
  }

  update(dt) {
    let any = false;
    const n = this.max;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt / this.maxLife[i];
      if (this.life[i] <= 0) { this.life[i] = 0; continue; }
      const o = i * 3;
      this.vel[o + 1] -= this.grav[i] * dt;
      const damp = Math.exp(-this.drag[i] * dt);
      this.vel[o] *= damp; this.vel[o + 1] *= damp; this.vel[o + 2] *= damp;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      if (this.pos[o + 1] < this.groundY[i]) {
        this.pos[o + 1] = this.groundY[i];
        this.vel[o + 1] = Math.abs(this.vel[o + 1]) * 0.42;
        this.vel[o] *= 0.72;
        this.vel[o + 2] *= 0.72;
      }
      this.size[i] += this.grow[i] * dt;
    }
    if (any) {
      const g = this.points.geometry;
      g.attributes.position.needsUpdate = true;
      g.attributes.aColor.needsUpdate = true;
      g.attributes.aSize.needsUpdate = true;
      g.attributes.aLife.needsUpdate = true;
    }
  }

  clear() {
    this.life.fill(0);
    this.points.geometry.attributes.aLife.needsUpdate = true;
  }
}

export function createFX(scene) {
  const tex = makeSoftDiscTex();
  const group = new THREE.Group();
  group.name = 'photoreal-fx';
  scene.add(group);

  // Additive HDR sparks (bright > 1.0 triggers UnrealBloom!)
  const sparks = new ParticlePool(320, tex, true, 3.6);
  // Alpha-blended dust, tire spray & exhaust puffs
  const smoke = new ParticlePool(420, tex, false, 1.0);
  group.add(sparks.points, smoke.points);

  // Subtle angled rain streaks around camera (visible only in Post-Rain mode)
  const RAIN_N = 420;
  const rainPos = new Float32Array(RAIN_N * 6);
  const rainSeed = new Float32Array(RAIN_N * 4);
  for (let i = 0; i < RAIN_N; i++) {
    rainSeed[i * 4] = (Math.random() - 0.5) * 46;
    rainSeed[i * 4 + 1] = Math.random() * 22;
    rainSeed[i * 4 + 2] = (Math.random() - 0.5) * 46;
    rainSeed[i * 4 + 3] = 0.75 + Math.random() * 0.65;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: '#c8d9e8', transparent: true, opacity: 0.28, depthWrite: false });
  const rainMesh = new THREE.LineSegments(rainGeo, rainMat);
  rainMesh.frustumCulled = false;
  rainMesh.visible = false;
  group.add(rainMesh);

  // Sunlit floating atmospheric dust / pollen motes around camera
  const MOTE_N = 110;
  const motePos = new Float32Array(MOTE_N * 3);
  const moteCol = new Float32Array(MOTE_N * 3);
  const moteSize = new Float32Array(MOTE_N);
  const moteLife = new Float32Array(MOTE_N);
  const moteOff = new Float32Array(MOTE_N * 3);
  for (let i = 0; i < MOTE_N; i++) {
    moteOff[i * 3] = (Math.random() - 0.5) * 34;
    moteOff[i * 3 + 1] = 0.4 + Math.random() * 6.5;
    moteOff[i * 3 + 2] = (Math.random() - 0.5) * 34;
    moteCol[i * 3] = 1.0; moteCol[i * 3 + 1] = 0.94; moteCol[i * 3 + 2] = 0.80;
    moteSize[i] = 0.08 + Math.random() * 0.09;
    moteLife[i] = 0.35 + Math.random() * 0.4;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  moteGeo.setAttribute('aColor', new THREE.BufferAttribute(moteCol, 3));
  moteGeo.setAttribute('aSize', new THREE.BufferAttribute(moteSize, 1));
  moteGeo.setAttribute('aLife', new THREE.BufferAttribute(moteLife, 1));
  const moteMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex }, uGain: { value: 1.15 } },
    vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const moteMesh = new THREE.Points(moteGeo, moteMat);
  moteMesh.frustumCulled = false;
  group.add(moteMesh);

  const DUST_COLORS = {
    alpine: [0.46, 0.41, 0.33],
    desert: [0.76, 0.64, 0.46],
    coast: [0.72, 0.68, 0.56]
  };

  let emitAcc = 0;

  return {
    clear() { sparks.clear(); smoke.clear(); },
    burstSparks(x, y, z, fwdX, fwdZ, count = 18) {
      if (!PERF.photoreal || PERF.particles <= 0) return;
      const n = Math.max(3, Math.round(count * PERF.particles));
      for (let i = 0; i < n; i++) {
        const sp = 2.5 + Math.random() * 7.5;
        const a = Math.random() * Math.PI * 2;
        sparks.emit(
          x + (Math.random() - 0.5) * 0.4,
          y + 0.12 + Math.random() * 0.35,
          z + (Math.random() - 0.5) * 0.4,
          Math.cos(a) * sp - fwdX * 3.5,
          1.4 + Math.random() * 4.5,
          Math.sin(a) * sp - fwdZ * 3.5,
          1.0, 0.62 + Math.random() * 0.34, 0.18 + Math.random() * 0.25,
          0.11 + Math.random() * 0.08,
          0.28 + Math.random() * 0.42,
          -0.08, 16.0, 1.2, y + 0.04
        );
      }
    },
    emitWheelFX(r, fr, kind, dt) {
      if (!PERF.photoreal || PERF.particles <= 0) return;
      const spdMps = r.speed * 0.004;
      if (spdMps < 5) return;
      const fx = Math.sin(fr.th), fz = -Math.cos(fr.th); // bike forward (note fr.th heading)
      const bx = fr.x - fx * 1.15, by = fr.y + 0.18, bz = fr.z - fz * 1.15;
      const wet = ENV_STATE.uWetness.value;

      // Crashing slide sparks
      if (r.crashT >= 0 && r.crashT < 1.8 && Math.random() < 0.75 * PERF.particles) {
        this.burstSparks(fr.x, fr.y, fr.z, fx, fz, 3);
      }

      // Off-road gravel / sand dust plume
      if (Math.abs(r.x) > 0.92 && r.crashT < 0 && Math.random() < Math.min(1, spdMps / 22) * PERF.particles) {
        const dc = DUST_COLORS[kind] || DUST_COLORS.alpine;
        const shade = 0.85 + Math.random() * 0.3;
        smoke.emit(
          bx + (Math.random() - 0.5) * 0.35, by, bz + (Math.random() - 0.5) * 0.35,
          -fx * (1.5 + Math.random() * 2.5) + (Math.random() - 0.5) * 1.8,
          0.7 + Math.random() * 1.4,
          -fz * (1.5 + Math.random() * 2.5) + (Math.random() - 0.5) * 1.8,
          dc[0] * shade, dc[1] * shade, dc[2] * shade,
          0.55 + Math.random() * 0.45,
          0.55 + Math.random() * 0.45,
          1.9, -0.4, 2.2
        );
      }

      // Wet-road water spray rooster-tail in Post-Rain mode
      if (wet > 0.45 && r.crashT < 0 && Math.random() < Math.min(1, spdMps / 18) * 0.95 * PERF.particles) {
        smoke.emit(
          bx + (Math.random() - 0.5) * 0.25, by + 0.05, bz + (Math.random() - 0.5) * 0.25,
          -fx * (2.0 + Math.random() * 3.0) + (Math.random() - 0.5) * 1.1,
          0.85 + Math.random() * 1.35 * (spdMps / 40),
          -fz * (2.0 + Math.random() * 3.0) + (Math.random() - 0.5) * 1.1,
          0.74, 0.80, 0.86,
          0.42 + Math.random() * 0.35,
          0.32 + Math.random() * 0.28,
          2.2, 2.6, 2.8
        );
      }

      // Subtle warm exhaust vapor puff on hard acceleration
      if (r.isPlayer && r.throttle && spdMps < 36 && Math.random() < 0.28 * PERF.particles) {
        smoke.emit(
          bx + (Math.random() - 0.5) * 0.16, by + 0.24, bz + (Math.random() - 0.5) * 0.16,
          -fx * 2.2 + (Math.random() - 0.5) * 0.6,
          0.45 + Math.random() * 0.5,
          -fz * 2.2 + (Math.random() - 0.5) * 0.6,
          0.62, 0.60, 0.58,
          0.20, 0.34, 0.85, -0.3, 3.2
        );
      }
    },
    emitTrafficSpray(t, fr) {
      if (!PERF.photoreal || PERF.particles <= 0) return;
      const wet = ENV_STATE.uWetness.value;
      if (wet < 0.5 || Math.random() > 0.38 * PERF.particles) return;
      const rx = Math.cos(fr.th), rz = Math.sin(fr.th);
      const fx = Math.sin(fr.th), fz = -Math.cos(fr.th);
      const side = Math.random() < 0.5 ? -0.78 : 0.78;
      smoke.emit(
        fr.x + rx * side - fx * 1.9, fr.y + 0.22, fr.z + rz * side - fz * 1.9,
        -fx * 2.5 + (Math.random() - 0.5) * 0.9, 0.9 + Math.random() * 0.9, -fz * 2.5 + (Math.random() - 0.5) * 0.9,
        0.72, 0.78, 0.84,
        0.55, 0.34, 2.4, 2.2, 2.8
      );
    },
    update(dt, camPos, time, kind) {
      const on = PERF.photoreal && PERF.particles > 0;
      group.visible = on;
      if (!on) return;
      emitAcc += dt;
      sparks.update(dt);
      smoke.update(dt);

      // Update angled rain streaks around camera in Post-Rain mode
      const rainOn = ENV_STATE.uRain.value > 0.15;
      rainMesh.visible = rainOn;
      if (rainOn) {
        const count = Math.round(RAIN_N * Math.min(1, PERF.particles));
        rainGeo.setDrawRange(0, count * 2);
        const speedY = 26;
        for (let i = 0; i < count; i++) {
          const sx = rainSeed[i * 4], sy0 = rainSeed[i * 4 + 1], sz = rainSeed[i * 4 + 2], len = rainSeed[i * 4 + 3];
          const wrapX = ((sx - camPos.x) % 46 + 69) % 46 - 23;
          const wrapZ = ((sz - camPos.z) % 46 + 69) % 46 - 23;
          const y = ((sy0 - time * speedY) % 22 + 22) % 22 - 2;
          const x = camPos.x + wrapX;
          const yy = camPos.y + y;
          const z = camPos.z + wrapZ;
          const o = i * 6;
          rainPos[o] = x; rainPos[o + 1] = yy; rainPos[o + 2] = z;
          rainPos[o + 3] = x + 0.14 * len; rainPos[o + 4] = yy - 1.15 * len; rainPos[o + 5] = z + 0.08 * len;
        }
        rainGeo.attributes.position.needsUpdate = true;
      }

      // Sunlit floating atmospheric dust motes (sunny & golden hour)
      const motesOn = !rainOn && PERF.particles >= 0.6;
      moteMesh.visible = motesOn;
      if (motesOn) {
        const warm = PERF.weather === 'golden';
        moteMat.uniforms.uGain.value = warm ? 1.55 : (kind === 'desert' ? 1.25 : 0.95);
        for (let i = 0; i < MOTE_N; i++) {
          const ox = moteOff[i * 3], oy = moteOff[i * 3 + 1], oz = moteOff[i * 3 + 2];
          const wx = ((ox + Math.sin(time * 0.4 + i) * 1.4 - camPos.x) % 34 + 51) % 34 - 17;
          const wz = ((oz + Math.cos(time * 0.35 + i * 1.3) * 1.4 - camPos.z) % 34 + 51) % 34 - 17;
          const wy = ((oy + Math.sin(time * 0.7 + i * 0.8) * 0.6) % 7 + 7) % 7;
          motePos[i * 3] = camPos.x + wx;
          motePos[i * 3 + 1] = camPos.y - 1.4 + wy;
          motePos[i * 3 + 2] = camPos.z + wz;
        }
        moteGeo.attributes.position.needsUpdate = true;
      }
    }
  };
}
