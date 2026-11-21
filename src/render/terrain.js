// Builds the ground around the road: a coloured low-poly heightfield shaped by the road (cuttings, cliffs, lake slopes).
import * as THREE from 'three';
import { PERF } from './perf.js';
import { terrainMaterial } from './materials.js';
import { fbm, ridged, smooth, lerp, noise2 } from './noise.js';

const col = (hex) => new THREE.Color(hex);
const mix = (out, a, b, t) => { out.r = a.r + (b.r - a.r) * t; out.g = a.g + (b.g - a.g) * t; out.b = a.b + (b.b - a.b) * t; return out; };

export function buildTerrain(TB, track, look) {
  const R = TB.road, env = track.env, kind = env.kind, half = R.roadHalf, seed = env.seed;
  // ---- road samples (every 4th segment ~ 3.2 m)
  const STEP = 4, S = [];
  for (let j = 0; j <= R.N; j += STEP) {
    const th = R.heading[j], seg = R.segs[Math.min(j, R.N - 1)];
    let pref;
    if (kind === 'alpine') pref = Math.max(-1, Math.min(1, Math.sin(j * 0.0042 + 1.3) * 1.7));
    else if (kind === 'coast') pref = Math.max(-1, Math.min(1, Math.sin(j * 0.0026 + 0.4) * 2.2));
    else pref = 0;
    S.push({ x: R.pts[j * 3], y: R.pts[j * 3 + 1], z: R.pts[j * 3 + 2], rx: Math.cos(th), rz: Math.sin(th), ridge: seg.ridge, pref, j });
  }
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (const s of S) { minx = Math.min(minx, s.x); maxx = Math.max(maxx, s.x); minz = Math.min(minz, s.z); maxz = Math.max(maxz, s.z); }
  const MARGIN = kind === 'desert' ? 260 : 300;
  minx -= MARGIN; maxx += MARGIN; minz -= MARGIN; maxz += MARGIN;
  const cs = Math.max(6, Math.min(PERF.mobile ? 13 : 11, Math.sqrt(((maxx - minx) * (maxz - minz)) / PERF.terrainCells)));
  const NX = Math.ceil((maxx - minx) / cs) + 1, NZ = Math.ceil((maxz - minz) / cs) + 1;
  const H = new Float32Array(NX * NZ), DM = new Float32Array(NX * NZ).fill(1e9), NEAR = new Int32Array(NX * NZ).fill(-1);
  const sumW = new Float32Array(NX * NZ), sumH = new Float32Array(NX * NZ);
  const RR = kind === 'alpine' ? 210 : 170;
  const edge = half + 2.4 + cs * 0.8;               // flat shoulder width before the terrain starts to rise or fall
  const waterY = env.waterY;

  // ---- pass 1: nearest road sample for every cell
  const rc = Math.ceil(RR / cs);
  for (let k = 0; k < S.length; k++) {
    const s = S[k], ci = Math.round((s.x - minx) / cs), cj = Math.round((s.z - minz) / cs);
    for (let j = Math.max(0, cj - rc); j <= Math.min(NZ - 1, cj + rc); j++) {
      for (let i = Math.max(0, ci - rc); i <= Math.min(NX - 1, ci + rc); i++) {
        const dx = minx + i * cs - s.x, dz = minz + j * cs - s.z, d = Math.sqrt(dx * dx + dz * dz), id = j * NX + i;
        if (d < DM[id]) { DM[id] = d; NEAR[id] = k; }
      }
    }
  }
  // ---- height profile relative to the road
  function offset(dd, f, ridge, ry) {
    if (kind === 'alpine') {
      if (ridge) return dd < 1.5 ? -0.05 * dd : -0.08 - (dd - 1.5) * 1.45;
      const base = -0.12 * dd;
      if (f > 0) return lerp(base, 46 * (1 - Math.exp(-dd / 70)) * (1 - smooth(120, 205, dd)), f);
      return lerp(base, -0.6 * dd, -f);
    }
    if (kind === 'desert') return -ry * (1 - Math.exp(-dd / 45)) - 0.05 * dd * 0;
    // coast
    const base = -0.2 * dd;
    if (f > 0) return lerp(base, 24 * (1 - Math.exp(-dd / 55)) * (1 - smooth(90, 165, dd)), f);
    return lerp(base, -0.85 * dd, -f);
  }
  // ---- pass 2: blend the profiles of all nearby road samples (soft-nearest => no seams)
  for (let k = 0; k < S.length; k++) {
    const s = S[k], ci = Math.round((s.x - minx) / cs), cj = Math.round((s.z - minz) / cs);
    for (let j = Math.max(0, cj - rc); j <= Math.min(NZ - 1, cj + rc); j++) {
      for (let i = Math.max(0, ci - rc); i <= Math.min(NX - 1, ci + rc); i++) {
        const id = j * NX + i, cx = minx + i * cs, cz = minz + j * cs, dx = cx - s.x, dz = cz - s.z, d = Math.sqrt(dx * dx + dz * dz);
        if (d > DM[id] + 24) continue;
        const w = Math.exp(-(d - DM[id]) / 7), lat = dx * s.rx + dz * s.rz, side = lat >= 0 ? 1 : -1;
        const dd = Math.max(0, d - edge);
        const h = s.y - 1.3 + offset(dd, side * s.pref, s.ridge, s.y);
        sumW[id] += w; sumH[id] += w * h;
      }
    }
  }
  // ---- final height: road shaping blended into the natural ground
  const floorAt = (x, z) => {
    if (kind === 'alpine') return waterY - 9 - 14 * fbm(x * 0.004, z * 0.004, seed) - 3 * ridged(x * 0.02, z * 0.02, seed);
    if (kind === 'desert') return (fbm(x * 0.012, z * 0.012, seed) - 0.5) * 4;
    return waterY - 9 - 6 * fbm(x * 0.006, z * 0.006, seed);
  };
  const mesaAt = (x, z, dm) => {
    if (kind !== 'desert') return 0;
    const p = fbm(x * 0.0032, z * 0.0032, seed + 4, 3);
    const m = smooth(0.53, 0.60, p) * smooth(95, 190, dm);
    return m * (34 + 18 * smooth(0.62, 0.7, p)) + smooth(0.45, 0.56, p) * smooth(100, 190, dm) * 8;
  };
  const border = (i, j) => Math.min(1, Math.min(i, NX - 1 - i, j, NZ - 1 - j) / 8);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const id = j * NX + i, x = minx + i * cs, z = minz + j * cs;
    let fl = floorAt(x, z);
    if (kind === 'desert') { fl += (fbm(x * 0.0055, z * 0.0055, seed + 6) - 0.5) * 34 * smooth(60, 170, DM[id]); fl *= border(i, j); }
    let h;
    if (sumW[id] > 0) {
      const road = sumH[id] / sumW[id], t = smooth(RR * 0.7, RR, DM[id]);
      let b = 0;
      if (kind === 'alpine') b = (fbm(x * 0.02, z * 0.02, seed + 2) - 0.5) * 16 * smooth(6, 70, DM[id] - edge) + (fbm(x * 0.07, z * 0.07, seed + 3) - 0.5) * 3 * smooth(4, 30, DM[id] - edge);
      else if (kind === 'desert') b = (fbm(x * 0.03, z * 0.03, seed + 2) - 0.5) * 5 * smooth(10, 70, DM[id] - edge) + (fbm(x * 0.0055, z * 0.0055, seed + 6) - 0.5) * 34 * smooth(20, 110, DM[id] - edge);
      else b = (fbm(x * 0.025, z * 0.025, seed + 2) - 0.5) * 8 * smooth(6, 70, DM[id] - edge);
      h = lerp(Math.max(road + b, fl), fl, t);
      if (kind === 'desert') h = lerp(Math.max(road + b, fl), fl, t);
    } else h = fl;
    if (kind === 'desert') h += mesaAt(x, z, DM[id]) * border(i, j);
    H[id] = h;
  }
  // ---- no road on stilts: where the ground is far below the road, build an embankment up to the gravel edge (the cut below still wins where two roads are close)
  const BANK = half + TB.racer.SHOULDER_M + 2.0, BANK_FALL = 1.2, bankCells = Math.ceil((BANK + 20) / cs);
  for (let jr = 0; jr <= R.N; jr += 2) {
    const sx = R.pts[jr * 3], sy = R.pts[jr * 3 + 1], sz = R.pts[jr * 3 + 2], tilt = Math.abs(Math.tan(R.bank[jr])) * BANK;
    const ci = Math.round((sx - minx) / cs), cj = Math.round((sz - minz) / cs);
    for (let j = Math.max(0, cj - bankCells); j <= Math.min(NZ - 1, cj + bankCells); j++) {
      for (let i = Math.max(0, ci - bankCells); i <= Math.min(NX - 1, ci + bankCells); i++) {
        const id = j * NX + i, d = Math.hypot(minx + i * cs - sx, minz + j * cs - sz), lim = sy - 1.9 - tilt - Math.max(0, d - BANK) * BANK_FALL;
        if (d < BANK + 20 && H[id] < lim) H[id] = lim;
      }
    }
  }
  // ---- no ground above the road: two legs of a switchback are only ~17 m apart at different heights, so the hillside of one could bury the other.
  // Every grid cell that could touch the road or shoulder is cut down below the lowest road near it; further out the cut rises like a real road cutting.
  const CUT = half + TB.racer.SHOULDER_M + cs * 1.45, CUT_RISE = 1.1, cutCells = Math.ceil((CUT + 30) / cs);
  for (let jr = 0; jr <= R.N; jr += 2) {
    const sx = R.pts[jr * 3], sy = R.pts[jr * 3 + 1], sz = R.pts[jr * 3 + 2], tilt = Math.abs(Math.tan(R.bank[jr])) * (half + TB.racer.SHOULDER_M);
    const ci = Math.round((sx - minx) / cs), cj = Math.round((sz - minz) / cs);
    for (let j = Math.max(0, cj - cutCells); j <= Math.min(NZ - 1, cj + cutCells); j++) {
      for (let i = Math.max(0, ci - cutCells); i <= Math.min(NX - 1, ci + cutCells); i++) {
        const id = j * NX + i, d = Math.hypot(minx + i * cs - sx, minz + j * cs - sz), lim = sy - 0.4 - tilt + Math.max(0, d - CUT) * CUT_RISE;
        if (H[id] > lim) H[id] = lim;
      }
    }
  }
  // heightfield sampling
  const heightAt = (x, z) => {
    let fx = (x - minx) / cs, fz = (z - minz) / cs;
    if (fx < 0 || fz < 0 || fx >= NX - 1 || fz >= NZ - 1) return floorAt(x, z);
    const i = Math.floor(fx), j = Math.floor(fz); fx -= i; fz -= j;
    const a = H[j * NX + i], b = H[j * NX + i + 1], c = H[(j + 1) * NX + i], d = H[(j + 1) * NX + i + 1];
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
  // Exact distance (m) from a point to the road CENTRE LINE. The old version read the nearest height-grid cell (cells are ~11 m wide), so
  // it could be wrong by 8 m or more, which let trees "pass" the clearance test while standing right beside the road.
  // Here every road sample (every ~3.2 m) goes into a small hash grid and we measure to the closest line piece between neighbouring samples.
  const HC = 16, hgrid = new Map();
  const hkey = (i, j) => i * 73856093 ^ j * 19349663;
  for (let k = 0; k < S.length; k++) { const key = hkey(Math.floor(S[k].x / HC), Math.floor(S[k].z / HC)); let a = hgrid.get(key); if (!a) hgrid.set(key, a = []); a.push(k); }
  const roadDistAt = (x, z) => {
    const ci = Math.floor(x / HC), cj = Math.floor(z / HC);
    let best = 1e18;
    for (let R_ = 1; R_ <= 40 && best > 1e17; R_ += 3) { // widen the search ring only if nothing is near
      for (let j = cj - R_; j <= cj + R_; j++) for (let i = ci - R_; i <= ci + R_; i++) {
        const a = hgrid.get(hkey(i, j)); if (!a) continue;
        for (let n = 0; n < a.length; n++) {
          const k = a[n];
          for (let q = Math.max(0, k - 1); q <= k; q++) { // line piece q..q+1
            if (q + 1 >= S.length) continue;
            const A = S[q], B = S[q + 1], abx = B.x - A.x, abz = B.z - A.z, t = Math.max(0, Math.min(1, ((x - A.x) * abx + (z - A.z) * abz) / (abx * abx + abz * abz + 1e-9)));
            const dx = x - (A.x + abx * t), dz = z - (A.z + abz * t), d2 = dx * dx + dz * dz;
            if (d2 < best) best = d2;
          }
        }
      }
    }
    return Math.sqrt(best);
  };

  // ---- colours
  const C = {
    forestA: col('#5b6446'), forestB: col('#6c7152'), forestC: col('#474f3a'), rock: col('#8e8c88'), rock2: col('#6f685d'),
    gravel: col('#8a8272'), sand: col('#cfc4a8'), turq: col('#7f9b9a'), deep: col('#3c5663'), snow: col('#eef0f2'),
    dA: col('#d3c3a4'), dB: col('#bfa985'), dR: [col('#a8927a'), col('#b9a187'), col('#8f7a66')], dRoad: col('#cdbc9c'),
    gA: col('#b5a578'), gB: col('#968860'), gRock: col('#8a8176'), cSand: col('#dcd1b5'), cDeep: col('#456373'), cTurq: col('#7ea3a6')
  };
  const COL = new Float32Array(NX * NZ * 3), MASK = new Float32Array(NX * NZ * 3), tmp = new THREE.Color();
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const id = j * NX + i, x = minx + i * cs, z = minz + j * cs, h = H[id];
    const hx = (H[j * NX + Math.min(NX - 1, i + 1)] - H[j * NX + Math.max(0, i - 1)]) / (2 * cs), hz = (H[Math.min(NZ - 1, j + 1) * NX + i] - H[Math.max(0, j - 1) * NX + i]) / (2 * cs);
    const slope = Math.sqrt(hx * hx + hz * hz), n = fbm(x * 0.05, z * 0.05, seed + 9, 3), n2 = noise2(x * 0.4, z * 0.4, seed);
    const near = DM[id] < edge + cs * 0.6;
    if (kind === 'alpine' || kind === 'coast') {
      const under = waterY - h;
      if (under > 0) mix(tmp, kind === 'alpine' ? C.turq : C.cTurq, kind === 'alpine' ? C.deep : C.cDeep, smooth(0, kind === 'alpine' ? 20 : 7, under));
      else if (under > -1.3 && slope < 0.7) tmp.copy(kind === 'alpine' ? C.sand : C.cSand);
      else {
        if (kind === 'alpine') { mix(tmp, C.forestA, C.forestB, n); mix(tmp, tmp, C.forestC, smooth(0.55, 0.9, n2) * 0.5); mix(tmp, tmp, C.rock, smooth(0.62, 1.0, slope)); if (slope > 1.0) mix(tmp, tmp, C.rock2, 0.3); }
        else { mix(tmp, C.gA, C.gB, n); mix(tmp, tmp, C.gRock, smooth(0.55, 1.0, slope)); if (under > -2.6 && slope < 0.7) mix(tmp, tmp, C.cSand, 0.6); }
        if (near) mix(tmp, tmp, C.gravel, 0.55);
      }
    } else {
      mix(tmp, C.dA, C.dB, n);
      if (slope > 0.55 || h > 12) {
        const band = Math.floor(h / 3.2 + n * 2) % 3;
        mix(tmp, tmp, C.dR[(band + 3) % 3], smooth(0.5, 0.9, slope + (h > 12 ? 0.5 : 0)));
      }
      if (near) mix(tmp, tmp, C.dRoad, 0.5);
    }
    // masks for the textured shader: x = sand, y = underwater (keeps the blue colour), z = roadside gravel
    if (kind === 'alpine' || kind === 'coast') {
      const under = waterY - h, sandBand = kind === 'alpine' ? 1.6 : 3.0;
      MASK[id * 3] = (1 - smooth(0.2, sandBand, -under)) * (1 - smooth(0.55, 0.95, slope));
      MASK[id * 3 + 1] = smooth(-0.15, 0.35, under);
    }
    MASK[id * 3 + 2] = 1 - smooth(edge - cs * 0.2, edge + cs * 1.6, DM[id]);
    const j2 = 0.93 + n2 * 0.14;
    COL[id * 3] = tmp.r * j2; COL[id * 3 + 1] = tmp.g * j2; COL[id * 3 + 2] = tmp.b * j2;
  }

  // ---- tiles (so the GPU can skip the ones you cannot see)
  const group = new THREE.Group(), TILE = 40;
  const mat = look ? terrainMaterial(look) : new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: false, roughness: 0.96, metalness: 0 });
  const tiles = [];
  for (let tj = 0; tj < NZ - 1; tj += TILE) for (let ti = 0; ti < NX - 1; ti += TILE) {
    const w = Math.min(TILE, NX - 1 - ti) + 1, h = Math.min(TILE, NZ - 1 - tj) + 1;
    const nrm = new Float32Array(w * h * 3), pos = new Float32Array(w * h * 3), colr = new Float32Array(w * h * 3), msk = new Float32Array(w * h * 3), idx = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const gid = (tj + j) * NX + ti + i, o = (j * w + i) * 3;
      pos[o] = minx + (ti + i) * cs; pos[o + 1] = H[gid]; pos[o + 2] = minz + (tj + j) * cs;
      colr[o] = COL[gid * 3]; colr[o + 1] = COL[gid * 3 + 1]; colr[o + 2] = COL[gid * 3 + 2]; msk[o] = MASK[gid * 3]; msk[o + 1] = MASK[gid * 3 + 1]; msk[o + 2] = MASK[gid * 3 + 2];
      { const gi = ti + i, gj = tj + j, hx = (H[gj * NX + Math.min(NX - 1, gi + 1)] - H[gj * NX + Math.max(0, gi - 1)]) / (2 * cs), hz = (H[Math.min(NZ - 1, gj + 1) * NX + gi] - H[Math.max(0, gj - 1) * NX + gi]) / (2 * cs), il = 1 / Math.sqrt(hx * hx + 1 + hz * hz); nrm[o] = -hx * il; nrm[o + 1] = il; nrm[o + 2] = -hz * il; }
      if (i < w - 1 && j < h - 1) { const a = j * w + i, b = a + 1, c = a + w, d = c + 1; idx.push(a, c, b, b, c, d); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(colr, 3)); g.setAttribute('mask', new THREE.BufferAttribute(msk, 3)); g.setIndex(idx);
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = false;
    group.add(m); tiles.push(m);
  }
  return { group, material: mat, heightAt, roadDistAt, bbox: { minx, maxx, minz, maxz }, cs, floorAt, dispose() { tiles.forEach((t) => t.geometry.dispose()); mat.dispose(); } };
}
