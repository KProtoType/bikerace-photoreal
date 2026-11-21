// Photorealistic vehicles & riders: loads Blender GLBs via CORS from ASSET_BASE,
// applies automotive clearcoat paint, HDR chrome/visor reflections, self-shadowing,
// dynamic brake light flares, player headlight SpotLight beam, under-chassis contact shadows,
// and subtle suspension fork-dive / acceleration squat.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PERF, ASSET_BASE } from './perf.js';

const loader = new GLTFLoader();
loader.setCrossOrigin('anonymous');

const BIKE_PAINT_GAIN = 1.9, TRAFFIC_PAINT_GAIN = 1.9;
export const assets = { bike: null, rider: null, traffic: {} };

export async function loadVehicleAssets(onProgress) {
  const kinds = ['sedan', 'pickup', 'wagon', 'boxtruck'];
  const names = ['bike-v4', 'rider-v1'].concat(kinds.map((k) => 'traffic-' + k));
  let n = 0;
  const res = await Promise.all(names.map((nm) => new Promise((ok, fail) =>
    loader.load(ASSET_BASE + 'assets/models/' + nm + '.glb', (g) => { n++; onProgress && onProgress(n / names.length); ok(g); }, undefined, fail)
  )));
  assets.bike = res[0].scene;
  assets.rider = res[1].scene;
  kinds.forEach((k, i) => (assets.traffic[k] = res[i + 2].scene));
}

// Shared soft directional contact shadow texture
let sharedBlobTex = null;
function getBlobTex() {
  if (sharedBlobTex) return sharedBlobTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 6, 64, 64, 58);
  gr.addColorStop(0, 'rgba(0,0,0,0.88)');
  gr.addColorStop(0.55, 'rgba(0,0,0,0.46)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  sharedBlobTex = new THREE.CanvasTexture(c);
  return sharedBlobTex;
}

// Upgrade a cloned GLTF material to photorealistic car-show PBR while remembering baseline values for Original compare mode
function tuneMaterial(m, kind, isPhotoreal) {
  const nm = m.name || '';
  if (!m.userData._base) {
    m.userData._base = {
      clearcoat: m.clearcoat || 0,
      clearcoatRoughness: m.clearcoatRoughness != null ? m.clearcoatRoughness : 0.45,
      roughness: m.roughness != null ? m.roughness : 0.6,
      metalness: m.metalness != null ? m.metalness : 0,
      envMapIntensity: 1.0,
      emissiveIntensity: m.emissiveIntensity != null ? m.emissiveIntensity : 1.0
    };
  }
  const b = m.userData._base;
  if (!isPhotoreal) {
    if ('clearcoat' in m) { m.clearcoat = b.clearcoat; m.clearcoatRoughness = b.clearcoatRoughness; }
    m.roughness = b.roughness;
    m.metalness = b.metalness;
    m.envMapIntensity = 1.0;
    if (m.emissiveIntensity !== undefined) m.emissiveIntensity = b.emissiveIntensity;
    return;
  }
  if (nm === 'Paint' || nm === 'PaintAccent') {
    if ('clearcoat' in m) { m.clearcoat = kind === 'bike' ? 0.94 : 0.85; m.clearcoatRoughness = kind === 'bike' ? 0.075 : 0.14; }
    m.metalness = Math.max(b.metalness, kind === 'bike' ? 0.32 : 0.18);
    m.roughness = Math.min(b.roughness, kind === 'bike' ? 0.34 : 0.42);
    m.envMapIntensity = kind === 'bike' ? 1.85 : 1.55;
  } else if (/Chrome|MirrorGlass|ExhaustSteel|BrakeDisc|Aluminium|FinAlloy/.test(nm)) {
    m.envMapIntensity = nm === 'Chrome' || nm === 'MirrorGlass' ? 2.3 : 1.8;
    m.roughness = Math.min(b.roughness, nm === 'Chrome' || nm === 'MirrorGlass' ? 0.08 : 0.24);
  } else if (nm === 'HelmetPaint' || nm === 'Visor') {
    if ('clearcoat' in m) { m.clearcoat = 1.0; m.clearcoatRoughness = nm === 'Visor' ? 0.02 : 0.06; }
    m.envMapIntensity = nm === 'Visor' ? 2.5 : 1.85;
  } else if (/Suit|BootLeather|Leather|Glove/.test(nm)) {
    m.envMapIntensity = 1.25;
    m.roughness = Math.min(b.roughness, 0.56);
  } else if (/Glass|Window|Windshield/.test(nm)) {
    m.envMapIntensity = 2.2;
    m.roughness = Math.min(b.roughness, 0.06);
  } else if (nm === 'HeadlightBulb') {
    m.emissiveIntensity = 4.2;
    m.envMapIntensity = 1.4;
  } else if (nm === 'TailLight') {
    m.emissiveIntensity = 2.6;
    m.envMapIntensity = 1.3;
  } else {
    m.envMapIntensity = 1.2;
  }
}

function cloneBike(src, hex) {
  const root = src.clone(true), mats = [], allMats = [], tailMats = [], headMats = [], cache = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const old = o.material;
    if (!cache.has(old)) {
      const m = old.clone();
      if (old.name === 'Paint') {
        m.color.set(hex);
        const q = {}; m.color.getHSL(q);
        m.color.setHSL(q.h, Math.min(1, q.s * 0.82), q.l * 0.82);
        m.color.multiplyScalar(BIKE_PAINT_GAIN);
      }
      tuneMaterial(m, 'bike', PERF.photoreal);
      cache.set(old, m);
      allMats.push(m);
      if (old.name === 'TailLight') tailMats.push(m);
      else if (old.name === 'HeadlightBulb') headMats.push(m);
      if (!/TailLight|Amber|HeadlightBulb|HeadlightLens/.test(old.name)) mats.push(m);
    }
    o.material = cache.get(old);
    o.castShadow = true;
    o.receiveShadow = PERF.photoreal && PERF.selfShadows;
  });
  return { root, mats, allMats, tailMats, headMats };
}

function cloneTraffic(src, hex) {
  const root = src.clone(true), mats = [], tailMats = [], cache = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const old = o.material;
    if (!cache.has(old)) {
      const m = old.clone();
      if (old.name === 'Paint') m.color.set(hex).multiplyScalar(TRAFFIC_PAINT_GAIN);
      tuneMaterial(m, 'traffic', PERF.photoreal);
      cache.set(old, m);
      mats.push(m);
      if (/Tail|Brake|RearLight/i.test(old.name || '')) tailMats.push(m);
    }
    o.material = cache.get(old);
    o.castShadow = true;
    o.receiveShadow = PERF.photoreal && PERF.selfShadows;
  });
  return { root, mats, tailMats };
}

// ------------------------------------------------------------------ two-bone IK helper
const _d = new THREE.Vector3(), _p = new THREE.Vector3();
function ik2(root, tgt, l1, l2, pole, out) {
  _d.subVectors(tgt, root); let dist = _d.length(); _d.multiplyScalar(1 / Math.max(dist, 1e-5));
  dist = Math.min(Math.max(dist, 0.08), l1 + l2 - 0.002);
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d)); if (_p.lengthSq() < 1e-6) _p.set(0, 0, 1); _p.normalize();
  out.copy(root).addScaledVector(_d, a).addScaledVector(_p, h);
  return out;
}
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _bm = new THREE.Matrix4();
function placePart(obj, a, b, front) {
  _by.subVectors(b, a).normalize();
  _bz.copy(front).addScaledVector(_by, -front.dot(_by));
  if (_bz.lengthSq() < 1e-6) _bz.set(0, 0, 1).addScaledVector(_by, -_by.z);
  _bz.normalize(); _bx.crossVectors(_by, _bz);
  _bm.makeBasis(_bx, _by, _bz); obj.quaternion.setFromRotationMatrix(_bm); obj.position.copy(a);
}

// ------------------------------------------------------------------ rider
function riderColours(suit, helmet) {
  const acc = new THREE.Color(suit), hsl = {}; acc.getHSL(hsl); acc.setHSL(hsl.h, hsl.s * 0.82, hsl.l * 0.8);
  const base = new THREE.Color(0.05, 0.045, 0.042).lerp(new THREE.Color(suit), 0.07);
  const hc = new THREE.Color(helmet); hc.getHSL(hsl); hc.setHSL(hsl.h, hsl.s * 0.88, hsl.l * 0.86);
  const cl = (c) => { c.r = Math.min(1, c.r); c.g = Math.min(1, c.g); c.b = Math.min(1, c.b); return c; };
  return { Suit: cl(base.multiplyScalar(3.2)), SuitAccent: cl(acc.multiplyScalar(2.6)), HelmetPaint: cl(hc.multiplyScalar(1.25)) };
}

function buildRider(suit, helmet) {
  const mats = [], cache = new Map(), col = riderColours(suit, helmet);
  const part = (name) => {
    const o = assets.rider.getObjectByName(name).clone(true);
    o.traverse((m) => {
      if (!m.isMesh) return;
      const old = m.material;
      if (!cache.has(old)) {
        const c = old.clone();
        if (col[old.name]) c.color.copy(col[old.name]);
        tuneMaterial(c, 'rider', PERF.photoreal);
        cache.set(old, c); mats.push(c);
      }
      m.material = cache.get(old);
      m.castShadow = true;
      m.receiveShadow = PERF.photoreal && PERF.selfShadows;
    });
    o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1);
    return o;
  };
  const root = new THREE.Group(), torso = new THREE.Group(), neck = new THREE.Group();
  root.add(torso); torso.add(part('torso')); neck.position.set(0, 0.6, 0.03); torso.add(neck); neck.add(part('head'));
  const pelvis = part('pelvis'); root.add(pelvis);
  const side = (n) => ({ up: part('upperarm_' + n), fo: part('forearm_' + n), hand: part('hand_' + n) });
  const lside = (n) => ({ th: part('thigh_' + n), sh: part('shin_' + n), boot: part('boot_' + n) });
  const arms = [side('R'), side('L')], legs = [lside('R'), lside('L')];
  arms.forEach((a) => root.add(a.up, a.fo, a.hand)); legs.forEach((l) => root.add(l.th, l.sh, l.boot));
  return { root, torso, neck, legs, arms, pelvis, mats };
}

const RAISE = 0.07;
const P = new THREE.Vector3(0, 0.8 + RAISE, -0.3);
const HAND = [new THREE.Vector3(-0.375, 1.15, 0.345), new THREE.Vector3(0.375, 1.15, 0.345)];
const PEG = [new THREE.Vector3(-0.3, 0.41, -0.17), new THREE.Vector3(0.3, 0.41, -0.17)];
const LA1 = 0.30, LA2 = 0.285, LL1 = 0.43, LL2 = 0.42;
const PV = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Vector3(), _t = new THREE.Vector3(), _h = new THREE.Vector3(), _pole = new THREE.Vector3(), _k = new THREE.Vector3();
const _f = new THREE.Vector3(), _w = new THREE.Vector3(), _dir = new THREE.Vector3(), _yb = new THREE.Vector3();

function poseRider(R, o) {
  const T = R.torso, tilt = 0.95 - 0.12 * Math.min(1, Math.abs(o.speedK || 0));
  R.pelvis.position.set(0, 0.82 + RAISE, -0.32);
  T.position.copy(P); T.position.y += 0.05;
  let twist = 0, roll = -o.lean * 0.25, kickSide = 0, kickE = 0, punchSide = 0, punchE = 0;
  if (o.atk) {
    const p = o.atk.p, e = p < 0.4 ? Math.sin((p / 0.4) * Math.PI / 2) : Math.max(0, 1 - (p - 0.4) / 0.6);
    if (o.atk.type === 'kick') { kickSide = o.atk.side; kickE = e; }
    else { punchSide = o.atk.side; punchE = e; }
    twist = -o.atk.side * 0.45 * punchE * -1;
  }
  T.rotation.set(tilt, twist, roll, 'YXZ');
  R.neck.rotation.set(-tilt + 0.2, -twist * 0.6, -roll * 0.5);
  T.updateMatrix();
  for (let i = 0; i < 2; i++) {
    const sd = i === 0 ? 1 : -1;
    _s.set(i === 0 ? -0.2 : 0.2, 0.47, 0).applyMatrix4(T.matrix);
    _t.set(HAND[i].x, HAND[i].y, HAND[i].z - 0.07);
    if (punchSide === sd && punchE > 0) _t.set(-sd * (0.42 + 0.62 * punchE), 1.12 + 0.05 * punchE, 0.62 - 0.3 * punchE);
    _pole.set(i === 0 ? -0.9 : 0.9, -0.6, -0.3);
    ik2(_s, _t, LA1, LA2, _pole, _e);
    _dir.subVectors(_t, _s).normalize(); _f.copy(_pole).addScaledVector(_dir, -_pole.dot(_dir)).normalize().negate();
    const A = R.arms[i]; placePart(A.up, _s, _e, _f); placePart(A.fo, _e, _t, _f);
    _w.subVectors(_t, _e).normalize(); _yb.copy(_t).addScaledVector(_w, 0.1); placePart(A.hand, _t, _yb, _f);

    _h.set(i === 0 ? -0.11 : 0.11, 0.8 + RAISE, -0.34);
    _t.set(PEG[i].x, PEG[i].y + 0.1, PEG[i].z - 0.09);
    if (kickSide === sd && kickE > 0) _t.set(-sd * (0.3 + 0.78 * kickE), 0.46 + 0.5 * kickE, -0.29 + 0.35 * kickE);
    _pole.set(i === 0 ? -0.35 : 0.35, 0.25, 1);
    ik2(_h, _t, LL1, LL2, _pole, _k);
    _dir.subVectors(_t, _h).normalize(); _f.copy(_pole).addScaledVector(_dir, -_pole.dot(_dir)).normalize();
    const L = R.legs[i]; placePart(L.th, _h, _k, _f); placePart(L.sh, _k, _t, _f);
    L.boot.position.copy(_t);
    if (kickE > 0 && kickSide === sd) { _yb.set(0, 1, 0).lerp(_w.subVectors(_k, _t).normalize(), kickE).normalize(); _bz.set(0, 0, 1); placePart(L.boot, _t, _yb.add(_t), _bz); }
    else L.boot.quaternion.identity();
  }
}

function sortParts(group, skip) {
  const small = [], v = new THREE.Vector3(); group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!o.isMesh || o === skip) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    const r = o.geometry.boundingSphere.radius * o.getWorldScale(v).x;
    if (r < 0.3) small.push(o); if (r < 0.1) o.castShadow = false;
  });
  return small;
}
function setFar(rig, f) { if (rig.isFar === f) return; rig.isFar = f; for (const o of rig.small) { o.visible = f < 2; if (o.geometry.boundingSphere.radius >= 0.1) o.castShadow = f < 1; } }

// ------------------------------------------------------------------ RacerRig (bike + rider + dynamic lights + suspension)
export class RacerRig {
  constructor(look, isPlayer) {
    this.isPlayer = !!isPlayer;
    this.group = new THREE.Group();
    this.lean = new THREE.Group();
    this.group.add(this.lean);

    const b = cloneBike(assets.bike, look.body);
    this.bike = b.root;
    this.mats = b.mats.slice();
    this.allBikeMats = b.allMats;
    this.tailMats = b.tailMats;
    this.headMats = b.headMats;
    this.lean.add(this.bike);

    this.wheelF = this.bike.getObjectByName('wheel-front');
    this.wheelB = this.bike.getObjectByName('wheel-back');
    this.fork = this.bike.getObjectByName('fork');

    this.rider = buildRider(look.suit, look.helmet);
    this.lean.add(this.rider.root);
    this.rider.mats.forEach((m) => this.mats.push(m));
    this.crashed = false; this.t = 0; this.spin = 0; this.pitchDyn = 0; this.prevSpeed = 0;

    // Multi-layer soft contact shadow (tight dark core + wide soft penumbra)
    const bt = getBlobTex();
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1.35, 2.9),
      new THREE.MeshBasicMaterial({ map: bt, transparent: true, depthWrite: false, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.03;
    this.group.add(this.blob);

    // Player dynamic headlight SpotLight (casts real warm beam on road & traffic, extra vivid in Golden Hour & Post-Rain!)
    this.headlight = null;
    if (this.isPlayer) {
      this.headlight = new THREE.SpotLight('#fff0d2', 0, 48, 0.56, 0.65, 1.35);
      this.headlight.position.set(0, 1.05, 0.85);
      this.headlight.target.position.set(0, 0.0, 22);
      this.lean.add(this.headlight, this.headlight.target);
    }

    this.wheelRot = 0;
    this.rv = new THREE.Vector3(); this.ro = new THREE.Vector3(); this.rAng = new THREE.Vector3(); this.rAv = new THREE.Vector3();
    this.small = sortParts(this.group, this.blob);
  }

  applyLookMode(photoreal) {
    for (const m of this.allBikeMats) tuneMaterial(m, 'bike', photoreal);
    for (const m of this.rider.mats) tuneMaterial(m, 'rider', photoreal);
    const recv = photoreal && PERF.selfShadows;
    this.group.traverse((o) => { if (o.isMesh && o !== this.blob) o.receiveShadow = recv; });
  }

  far(f) { setFar(this, f); }
  setFlash(v) { const e = Math.min(1, v); for (const m of this.mats) m.emissive && m.emissive.setRGB(0.9 * e, 0.12 * e, 0.05 * e); }

  update(r, fr, dt) {
    const g = this.group, th = fr.th;
    g.position.set(fr.x, fr.y, fr.z);
    g.rotation.set(0, 0, 0); g.rotation.order = 'YXZ';
    g.rotation.y = Math.PI - th; g.rotation.x = -fr.pitch;
    const spd = r.speed * 0.004;
    this.wheelRot += spd / 0.3 * dt;
    if (this.wheelF) { this.wheelF.rotation.x = this.wheelRot; this.wheelB.rotation.x = this.wheelRot; }
    this.setFlash(r.flash > 0 ? r.flash / 0.3 : 0);
    g.visible = !(r.shield > 0 && r.crashT < 0 && Math.floor(r.shield * 10) % 2 === 0);

    // Dynamic brake light flare & player headlight intensity
    const accel = dt > 0.001 ? (r.speed - this.prevSpeed) / dt : 0;
    this.prevSpeed = r.speed;
    const braking = r.brake || accel < -1400;
    const tailGlow = PERF.photoreal ? (braking ? 9.5 : (PERF.weather === 'rain' ? 3.8 : PERF.weather === 'golden' ? 3.2 : 2.3)) : 2.0;
    for (const m of this.tailMats) m.emissiveIntensity = tailGlow;
    if (this.headlight) {
      const hlOn = PERF.photoreal && PERF.headlightSpot && r.crashT < 0;
      const hlInt = PERF.weather === 'rain' ? 32 : PERF.weather === 'golden' ? 22 : 9;
      this.headlight.intensity = hlOn ? hlInt : 0;
    }

    if (r.crashT >= 0) {
      if (!this.crashed) this.beginCrash(r, fr);
      this.stepCrash(r, fr, dt);
      return;
    }
    if (this.crashed) this.endCrash();

    const wob = Math.sin(r.wobPh) * r.wob * 0.12;
    const half = window.TB.road.roadHalf, dx = this.lastX === undefined ? 0 : r.x - this.lastX; this.lastX = r.x;
    const yawT = dt > 0 && Math.abs(dx) < 0.2 ? Math.max(-0.3, Math.min(0.3, Math.atan2(dx * half / dt, Math.max(4, spd)))) : 0;
    this.yaw = (this.yaw || 0) + (yawT - (this.yaw || 0)) * Math.min(1, dt * 9);

    // Subtle suspension pitch: fork dives slightly when braking, rear squats on hard throttle
    const targetPitch = PERF.photoreal ? Math.max(-0.045, Math.min(0.055, (braking ? 0.042 : 0) - (r.throttle && accel > 800 ? 0.032 : 0))) : 0;
    this.pitchDyn += (targetPitch - this.pitchDyn) * Math.min(1, dt * 10);

    this.lean.rotation.set(this.pitchDyn, -this.yaw, r.lean * 0.55 + fr.bank + wob);
    this.lean.position.set(0, 0, 0);
    this.blob.visible = true;
    poseRider(this.rider, { lean: r.lean, speedK: r.speed / Math.max(1, r.maxSp), atk: r.atkT > 0 ? { type: r.atkType, side: r.atkSide, p: 1 - r.atkT / r.atkDur } : null });
    this.rider.root.visible = true;
  }

  beginCrash(r) {
    this.crashed = true; this.t = 0;
    const s = r.crashDir || 1, v = Math.max(5, r.speed * 0.004);
    this.ro.set(0, 0.55, -0.3); this.rv.set(-s * 3.2, 5.2 + v * 0.06, v * 0.55); this.rAng.set(0, 0, 0); this.rAv.set(-s * 7, 3 * s, 9 * s);
    this.rider.root.parent.remove(this.rider.root);
    this.group.add(this.rider.root);
    this.rider.root.position.set(0, 0, 0); this.crashSide = s; this.bikeRoll = 0;
    poseRider(this.rider, { lean: 0, speedK: 0, atk: null });
  }

  stepCrash(r, fr, dt) {
    this.t += dt; const s = this.crashSide, t = this.t;
    const roll = Math.min(1, t * 3.2); this.bikeRoll += (roll * 1.35 - this.bikeRoll) * Math.min(1, dt * 10);
    this.lean.rotation.set(0, Math.sin(t * 2.2) * 0.35 * s * Math.min(1, t), s * -this.bikeRoll);
    this.lean.position.set(-s * 0.1 * this.bikeRoll, 0.12 * Math.max(0, Math.sin(Math.min(t, 0.9) * 3.4)), 0);
    const rv = this.rv, ro = this.ro, ra = this.rAng;
    rv.y -= 17 * dt; ro.addScaledVector(rv, dt);
    if (ro.y <= 0) { ro.y = 0; if (rv.y < -3) { rv.y *= -0.28; rv.x *= 0.6; rv.z *= 0.7; this.rAv.multiplyScalar(0.7); } else rv.y = 0; rv.x *= Math.exp(-3 * dt); rv.z *= Math.exp(-2.2 * dt); this.rAv.multiplyScalar(Math.exp(-3 * dt)); }
    ra.addScaledVector(this.rAv, dt);
    const R = this.rider.root;
    R.rotation.set(ra.x, ra.y, ra.z);
    PV.set(0, 0.85, -0.3).applyEuler(R.rotation);
    R.position.set(ro.x - PV.x, ro.y + 0.3 - PV.y, ro.z - PV.z);
    this.blob.visible = true;
  }

  endCrash() {
    this.crashed = false;
    const R = this.rider.root; this.group.remove(R); this.lean.add(R); R.position.set(0, 0, 0); R.rotation.set(0, 0, 0);
    this.lean.position.set(0, 0, 0);
  }
}

// ------------------------------------------------------------------ TrafficRig (with under-chassis contact shadow & self-shadowing)
const TRAFFIC_SHADOW = { sedan: [2.3, 5.2], wagon: [2.35, 5.5], pickup: [2.5, 5.9], boxtruck: [2.9, 7.6] };
export class TrafficRig {
  constructor(t) {
    const src = assets.traffic[t.kind] || assets.traffic.sedan, c = cloneTraffic(src, t.color);
    this.group = new THREE.Group(); this.car = c.root; this.group.add(this.car);
    this.wheels = []; this.car.traverse((o) => { if (o.name && o.name.startsWith('wheel')) this.wheels.push(o); });
    this.spin = 0; this.mats = c.mats; this.tailMats = c.tailMats;
    this.R = t.kind === 'boxtruck' ? 0.5 : t.kind === 'pickup' ? 0.405 : t.kind === 'wagon' ? 0.372 : 0.322;

    // Grounded soft under-chassis contact occlusion (prevents cars looking like they float!)
    const dims = TRAFFIC_SHADOW[t.kind] || TRAFFIC_SHADOW.sedan;
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(dims[0], dims[1]),
      new THREE.MeshBasicMaterial({ map: getBlobTex(), transparent: true, depthWrite: false, opacity: 0.84, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.035;
    this.blob.visible = PERF.photoreal;
    this.group.add(this.blob);

    this.small = sortParts(this.group, this.blob);
  }

  applyLookMode(photoreal) {
    for (const m of this.mats) tuneMaterial(m, 'traffic', photoreal);
    const recv = photoreal && PERF.selfShadows;
    this.group.traverse((o) => { if (o.isMesh && o !== this.blob) o.receiveShadow = recv; });
    this.blob.visible = photoreal;
  }

  far(f) { setFar(this, f); }
  update(t, fr, dt) {
    const g = this.group; g.position.set(fr.x, fr.y, fr.z); g.rotation.order = 'YXZ'; g.rotation.set(-fr.pitch, Math.PI - fr.th, fr.bank);
    this.spin += t.speed * 0.004 / this.R * dt; for (const w of this.wheels) w.rotation.x = this.spin;
  }
}
