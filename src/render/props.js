// Scenery models and set pieces loaded via CORS from ASSET_BASE,
// with received shadows enabled on manmade structures (overpass, viaduct, sheds).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { propMaterial } from './materials.js';
import { PERF, ASSET_BASE } from './perf.js';
import { rng } from './noise.js';

const loader = new GLTFLoader();
loader.setCrossOrigin('anonymous');
const FILES = ['rocks', 'rocks_big', 'plants', 'manmade', 'manmade_big'];
const GEO = {};

await Promise.all(FILES.map((f) => new Promise((ok) => {
  loader.load(ASSET_BASE + 'assets/models/props/' + f + '.glb', (g) => {
    g.scene.updateMatrixWorld(true);
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
      const c = geo.attributes.color;
      if (c && c.itemSize === 4) {
        const a = new Float32Array(c.count * 3);
        for (let i = 0; i < c.count; i++) { a[i * 3] = c.getX(i); a[i * 3 + 1] = c.getY(i); a[i * 3 + 2] = c.getZ(i); }
        geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
      }
      const nm0 = o.name.replace(/\.\d+$/, '');
      (/^(fir|pine)/.test(nm0) ? ['uv1', 'tangent'] : ['uv', 'uv1', 'tangent']).forEach((k) => geo.deleteAttribute(k));
      geo.computeBoundingSphere(); geo.computeBoundingBox();
      GEO[nm0] = geo;
    });
    ok();
  }, undefined, (e) => { console.warn('[props] could not load ' + f + '.glb', e); ok(); });
})));

const fallback = () => { const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0); const a = new Float32Array(24 * 3).fill(0.5); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
const geo = (n) => GEO[n] || (GEO[n] = fallback());

function decimate(g, cells) {
  g.computeBoundingBox(); const bb = g.boundingBox, st = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) / cells + 1e-9;
  const pos = g.attributes.position, nor = g.attributes.normal, col = g.attributes.color, ix = g.index, n = pos.count, map = new Map(), re = new Int32Array(n), P = [], N = [], C = [], K = [];
  for (let i = 0; i < n; i++) {
    const k = Math.floor((pos.getX(i) - bb.min.x) / st) + 4096 * (Math.floor((pos.getY(i) - bb.min.y) / st) + 4096 * Math.floor((pos.getZ(i) - bb.min.z) / st));
    let j = map.get(k); if (j === undefined) { j = K.length; map.set(k, j); P.push(0, 0, 0); N.push(0, 0, 0); C.push(0, 0, 0); K.push(0); }
    P[j * 3] += pos.getX(i); P[j * 3 + 1] += pos.getY(i); P[j * 3 + 2] += pos.getZ(i);
    if (nor) { N[j * 3] += nor.getX(i); N[j * 3 + 1] += nor.getY(i); N[j * 3 + 2] += nor.getZ(i); }
    if (col) { C[j * 3] += col.getX(i); C[j * 3 + 1] += col.getY(i); C[j * 3 + 2] += col.getZ(i); }
    K[j]++; re[i] = j;
  }
  for (let j = 0; j < K.length; j++) { for (let c = 0; c < 3; c++) { P[j * 3 + c] /= K[j]; C[j * 3 + c] /= K[j]; } const l = Math.hypot(N[j * 3], N[j * 3 + 1], N[j * 3 + 2]) || 1; for (let c = 0; c < 3; c++) N[j * 3 + c] /= l; }
  const tri = [], m = ix ? ix.count : n;
  for (let t = 0; t < m; t += 3) { const a = re[ix ? ix.getX(t) : t], b = re[ix ? ix.getX(t + 1) : t + 1], c = re[ix ? ix.getX(t + 2) : t + 2]; if (a !== b && b !== c && a !== c) tri.push(a, b, c); }
  const o = new THREE.BufferGeometry(); o.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  if (nor) o.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); if (col) o.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  o.setIndex(tri); o.computeBoundingSphere(); o.computeBoundingBox(); return o;
}
const LO_CELLS = { rock: 12, rock2: 12, boulder: 12, boulder2: 12, bush: 9, bushC: 9, bushD: 9, scrub2: 9, tuft: 9 };

export function makeProps() {
  const P = {};
  ['fir', 'fir2', 'fir3', 'pine', 'pine2', 'snag', 'fir_lo', 'fir2_lo', 'fir3_lo', 'pine_lo', 'pine2_lo', 'fern', 'barrel', 'cactus2', 'palm2', 'tuft', 'scrub2', 'palm', 'bush', 'bushC', 'bushD', 'cactus', 'boulder', 'boulder2', 'rock', 'rock2', 'pole', 'sign0', 'sign1', 'sign2', 'rail', 'billboard']
    .forEach((n) => { P[n] = geo(n); });
  for (const k in LO_CELLS) { P[k + '_lo'] = decimate(P[k], LO_CELLS[k]); }
  P.mesa = geo('big_butte');
  return P;
}

export const SPRITE_MODELS = {
  fir: ['fir', 'fir2', 'fir3', 'pine'], boulder: ['boulder', 'boulder2'], rock: ['rock', 'rock2'], bush: ['bush'], cactus: ['cactus', 'cactus2'], palm: ['palm', 'palm2'], mesa: ['mesa'],
  billboard: ['billboard'], rail: ['rail'], sign: ['sign0', 'sign1', 'sign2'], pole: ['pole']
};

export function buildSetPieces(TB, track, terrain, look) {
  const R = TB.road, env = track.env, kind = env.kind, half = R.roadHalf, S = TB.C.S, segL = TB.C.segL;
  const group = new THREE.Group(); group.name = 'setpieces';
  const rand = rng(track.seed * 31 + 7), keep = PERF.mobile ? 0.55 : 1;
  const viewD = PERF.viewDist;
  const tex = look.B.diff;
  const matRock = propMaterial(tex, 0.45, 'vec3(1.0)', 'rock'), matMade = propMaterial(tex, 0.2, 'vec3(1.0)', 'plant'), matPlant = propMaterial(tex, 0.2, 'vec3(1.0)', 'tree');
  [matRock, matMade, matPlant].forEach((m) => { m.flatShading = false; });
  const lodItems = [], fr = {};

  const roadAt = (j, off, out) => { R.frame(j * segL + 100, off, out); return out; };
  const clearPatch = (x, z, r, tol) => {
    const y0 = terrain.heightAt(x, z); let lo = y0, hi = y0;
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, y = terrain.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    return hi - lo < tol ? lo : null;
  };
  const FP = [];
  const reachOf = (model, sc) => { const g = geo(model); if (!g.boundingBox) g.computeBoundingBox(); const b = g.boundingBox; return Math.hypot(Math.max(Math.abs(b.min.x), Math.abs(b.max.x)), Math.max(Math.abs(b.min.z), Math.abs(b.max.z))) * sc; };
  const SPAN = new Set(['gantry', 'overpass']);
  function place(model, mat, x, y, z, ry, sx, sy, sz, opts = {}) {
    const bb0 = geo(model).boundingBox || (geo(model).computeBoundingBox(), geo(model).boundingBox), lx0 = bb0.min.x * sx, lx1 = bb0.max.x * sx, hz0 = Math.max(Math.abs(bb0.min.z), Math.abs(bb0.max.z)) * sz;
    const longThing = lx1 - lx0 > 20 && lx1 - lx0 > 6 * hz0, ca = Math.cos(ry), sa = Math.sin(ry);
    FP.push({ m: model, x, z, r: longThing ? hz0 : reachOf(model, Math.max(sx, sz)), cap: longThing ? [x + lx0 * ca, z - lx0 * sa, x + lx1 * ca, z - lx1 * sa] : undefined, h: geo(model).boundingBox ? geo(model).boundingBox.max.y * sy : 5, k: SPAN.has(model) ? 'span' : 'setpiece' });
    const m = new THREE.Mesh(geo(model), mat); m.rotation.y = ry; m.scale.set(sx, sy, sz);
    m.castShadow = opts.shadow !== false;
    m.receiveShadow = mat === matMade || mat === matRock;
    const lod = new THREE.LOD(); lod.addLevel(m, 0); lod.addLevel(new THREE.Object3D(), (opts.dist || viewD) * 0.92);
    lod.position.set(x, y, z); lod.updateMatrix(); lod.matrixAutoUpdate = false; group.add(lod); lodItems.push(lod); return lod;
  }
  const samplesRoad = [];
  for (let j = 14; j < R.N - 14; j += 4) samplesRoad.push(j);
  const straight = (j, span = 40, tolTh = 0.03, tolY = 1.2) => {
    const a = Math.max(2, j - span), b = Math.min(R.N - 2, j + span);
    return Math.abs(R.heading[a] - R.heading[j]) < tolTh && Math.abs(R.heading[b] - R.heading[j]) < tolTh && Math.abs(R.pts[a * 3 + 1] - R.pts[j * 3 + 1]) < tolY && Math.abs(R.pts[b * 3 + 1] - R.pts[j * 3 + 1]) < tolY;
  };
  const nearStart = (j) => Math.abs(j - R.startIdx) < 40 || Math.abs(j - R.finishIdx) < 40;
  const used = [];
  const free = (x, z, r) => { for (const u of used) { const dx = u[0] - x, dz = u[1] - z, rr = u[2] + r; if (dx * dx + dz * dz < rr * rr) return false; } return true; };
  const take = (x, z, r) => used.push([x, z, r]);
  const lateral = (j, d, out) => { const th = R.heading[j]; out.x = R.pts[j * 3] + Math.cos(th) * d; out.z = R.pts[j * 3 + 2] + Math.sin(th) * d; return out; };
  const P2 = {};

  {
    const bigs = kind === 'desert' ? ['big_butte', 'big_boulder', 'big_spire', 'big_slab', 'big_boulder', 'big_slab'] : ['big_granite'];
    const smalls = kind === 'desert' ? ['rock', 'rock2', 'boulder', 'boulder2'] : ['boulder', 'boulder2'];
    const gap = kind === 'desert' ? 110 : 220;
    const nBig = kind === 'desert' ? 1 : 0.25;
    let lastJ = -999, count = 0;
    for (const j of samplesRoad) {
      if (j - lastJ < gap || nearStart(j)) continue;
      if (rand() > 0.22 * keep * nBig) continue;
      const side = rand() < 0.5 ? -1 : 1, d = half + 20 + rand() * (kind === 'desert' ? 75 : 55) * rand() + (kind === 'desert' ? 8 : 4);
      lateral(j, d * side, P2);
      const bigName = bigs[Math.floor(rand() * bigs.length)];
      const bb = geo(bigName).boundingBox, rad = Math.max(bb.max.x, bb.max.z) * 0.9;
      const sc = (0.75 + rand() * 0.55) * (kind === 'desert' ? 1 : 0.9);
      if (terrain.roadDistAt(P2.x, P2.z) < half + 12 + reachOf(bigName, sc) || !free(P2.x, P2.z, rad * sc + 6)) continue;
      const y0 = clearPatch(P2.x, P2.z, rad * sc * 0.7, 9); if (y0 === null) continue;
      if (env.waterY > -900 && y0 < env.waterY + 1.5) continue;
      const ry = rand() * 6.28, mat = matRock;
      place(bigName, mat, P2.x, y0 - 0.5 * sc, P2.z, ry, sc, sc * (0.85 + rand() * 0.4), sc);
      take(P2.x, P2.z, rad * sc + 4);
      const ns = 2 + Math.floor(rand() * 3);
      for (let k = 0; k < ns; k++) {
        const a = rand() * 6.28, rr = rad * sc * (0.95 + rand() * 0.6), px = P2.x + Math.cos(a) * rr, pz = P2.z + Math.sin(a) * rr;
        const s2 = 2.2 + rand() * 4.5, m2 = smalls[Math.floor(rand() * smalls.length)];
        if (terrain.roadDistAt(px, pz) < half + 3 + reachOf(m2, s2 * 1.3)) continue;
        place(m2, matRock, px, terrain.heightAt(px, pz) - 0.35 * s2 * 0.3, pz, rand() * 6.28, s2 * (0.9 + rand() * 0.4), s2 * (0.7 + rand() * 0.4), s2 * (0.9 + rand() * 0.4));
        if (kind === 'desert' && rand() < 0.7) { const q = 1.4 + rand() * 1.4; place('scrub2', matPlant, px + (rand() - 0.5) * 6, terrain.heightAt(px, pz) - 0.05, pz + (rand() - 0.5) * 6, rand() * 6.28, q * 1.5, q, q * 1.5, { shadow: false, dist: viewD * 0.5 }); }
      }
      lastJ = j; count++;
    }
    group.userData.formations = count;
  }

  if (kind === 'desert') {
    {
      const poles = [];
      for (let i = 8; i < R.N - 10; i++) for (const s of R.segs[i].sprites) if (s.t === 'pole') {
        R.frame(i * segL + 100, s.off, fr); const k = s.h * S * 0.9; poles.push({ x: fr.x, y: fr.y, z: fr.z, th: -fr.th, k });
      }
      const AT = [[-0.1, 0.99], [0.1, 0.99], [0, 1.017], [-0.07, 0.905], [0.07, 0.905]];
      const SEG = 9, per = 10;
      for (let c0 = 0; c0 < poles.length - 1; c0 += per) {
        const n = Math.min(per, poles.length - 1 - c0), pos = [], idx = []; let v = 0;
        for (let a = c0; a < c0 + n; a++) {
          const A = poles[a], B = poles[a + 1];
          if (Math.hypot(A.x - B.x, A.z - B.z) > 60) continue;
          for (let w = 0; w < AT.length; w++) {
            const pa = [A.x + Math.cos(A.th) * AT[w][0] * A.k, A.y + AT[w][1] * A.k, A.z - Math.sin(A.th) * AT[w][0] * A.k];
            const pb = [B.x + Math.cos(B.th) * AT[w][0] * B.k, B.y + AT[w][1] * B.k, B.z - Math.sin(B.th) * AT[w][0] * B.k];
            const len = Math.hypot(pb[0] - pa[0], pb[2] - pa[2]), sag = 0.012 * len + 0.15 * (w > 2 ? 1 : 0.6);
            for (let s = 0; s <= SEG; s++) {
              const t = s / SEG, q = [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t - sag * 4 * t * (1 - t), pa[2] + (pb[2] - pa[2]) * t], hw = 0.065;
              pos.push(q[0] - hw, q[1], q[2], q[0] + hw, q[1], q[2], q[0], q[1] - hw, q[2], q[0], q[1] + hw, q[2]);
              if (s > 0) { const b = v - 4; idx.push(b, b + 1, v + 1, b, v + 1, v, b + 2, b + 3, v + 3, b + 2, v + 3, v + 2); }
              v += 4;
            }
          }
        }
        if (!v) continue;
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#2d2926', side: THREE.DoubleSide })); m.castShadow = false; m.frustumCulled = true;
        const lod = new THREE.LOD(); lod.addLevel(m, 0); lod.addLevel(new THREE.Object3D(), viewD);
        const cx = g.boundingSphere.center.clone(); m.geometry.translate(-cx.x, -cx.y, -cx.z); lod.position.copy(cx); m.geometry.computeBoundingSphere();
        group.add(lod); lodItems.push(lod);
      }
    }

    const cand = samplesRoad.filter((j) => !nearStart(j) && straight(j, 35, 0.03, 1.5));
    const flatBoth = (j, from, to) => {
      const th = R.heading[j], y = R.pts[j * 3 + 1];
      for (const sd of [-1, 1]) for (let d = from; d <= to; d += 10) { const x = R.pts[j * 3] + Math.cos(th) * d * sd, z = R.pts[j * 3 + 2] + Math.sin(th) * d * sd; if (Math.abs(terrain.heightAt(x, z) - y) > 3.5) return false; }
      return true;
    };
    const spots = (f0, f1, test) => cand.filter((j) => j > f0 * R.N && j < f1 * R.N && test(j));
    let op = spots(0.28, 0.45, (j) => flatBoth(j, 10, 60))[0];
    if (op === undefined) op = spots(0.15, 0.9, (j) => flatBoth(j, 10, 60))[0];
    if (op !== undefined) {
      roadAt(op, 0, fr);
      place('overpass', matMade, fr.x, fr.y - 0.05, fr.z, -fr.th, 1, 1, 1, { dist: viewD * 1.3 });
      take(fr.x, fr.z, 40); group.userData.overpass = op;
    }
    const flatSide = (j, sd, from, to) => { const th = R.heading[j], y = R.pts[j * 3 + 1]; for (let d = from; d <= to; d += 8) { const x = R.pts[j * 3] + Math.cos(th) * d * sd, z = R.pts[j * 3 + 2] + Math.sin(th) * d * sd; if (Math.abs(terrain.heightAt(x, z) - y) > 4.0) return 0; } return sd; };
    let vi, vside = 0;
    for (const j of cand) {
      if (j < R.N * 0.5 || (op !== undefined && Math.abs(j - op) < 300)) continue;
      vside = flatSide(j, 1, 30, 62) || flatSide(j, -1, 30, 62);
      if (vside) {
        const th = R.heading[j]; lateral(j, (half + 44) * vside, P2); let ok = true;
        for (let u = -70; u <= 70 && ok; u += 7) for (const w of [-8, 0, 8]) { const x = P2.x + Math.sin(th) * u + Math.cos(th) * w, z = P2.z - Math.cos(th) * u + Math.sin(th) * w; if (terrain.roadDistAt(x, z) < half + 10) ok = false; }
        if (!ok) vside = 0;
      }
      if (vside) { vi = j; break; }
    }
    if (vi !== undefined) {
      lateral(vi, (half + 44) * vside, P2); const y0 = clearPatch(P2.x, P2.z, 40, 9) ?? R.pts[vi * 3 + 1] - 1; roadAt(vi, 0, fr);
      place('viaduct', matMade, P2.x, Math.min(y0, fr.y) - 0.2, P2.z, -fr.th + Math.PI / 2, 1, 1, 1, { dist: viewD * 1.3 });
      take(P2.x, P2.z, 60); group.userData.viaduct = vi;
    }
    let ng = 0, lastG = -9999;
    for (const j of cand) {
      if (ng >= 3) break;
      if (!(j > R.N * (0.12 + ng * 0.3) && j - lastG > R.N * 0.12 && flatBoth(j, 7, 18)) || (op !== undefined && Math.abs(j - op) < 160) || (vi !== undefined && Math.abs(j - vi) < 200)) continue;
      lastG = j;
      roadAt(j, 0, fr); place('gantry', matMade, fr.x, fr.y - 0.05, fr.z, -fr.th, 1, 1, 1, { dist: viewD * 0.8 }); take(fr.x, fr.z, 12); (group.userData.gantryAt = group.userData.gantryAt || []).push(j); ng++;
    }
    group.userData.gantries = ng;

    {
      let yards = 0, lastJ = -999;
      for (const j of cand) {
        if (yards >= (PERF.mobile ? 4 : 7)) break;
        if (j - lastJ < R.N / 6 || j < R.N * 0.08 || nearStart(j) || (op !== undefined && Math.abs(j - op) < 260) || (vi !== undefined && Math.abs(j - vi) < 260)) continue;
        const sd = (yards % 2) ? -1 : 1, th = R.heading[j];
        lateral(j, (half + 24) * sd, P2); const y0 = clearPatch(P2.x, P2.z, 14, 3.0); if (y0 === null || terrain.roadDistAt(P2.x, P2.z) < half + 12 || !free(P2.x, P2.z, 24)) continue;
        const ry = Math.atan2(-sd * Math.cos(th), -sd * Math.sin(th)) + (rand() - 0.5) * 0.25, ryAlong = Math.PI / 2 - th;
        const local = (u, w) => { const ca = Math.cos(th), sa = Math.sin(th), fx = Math.sin(th), fz = -Math.cos(th); return [P2.x + ca * (w * sd) + fx * u, P2.z + sa * (w * sd) + fz * u]; };
        const put = (m, mat, u, w, rot, s = 1, opts) => { const [x, z] = local(u, w); place(m, mat, x, terrain.heightAt(x, z) - 0.05, z, rot, s, s, s, opts); };
        put('shed', matMade, -4, 0, ry, 1); put('shed2', matMade, 8, 6, ry + 0.1, 1);
        put('tank', matMade, -14, -2, ryAlong + 0.15, 1);
        put('drums', matMade, 14, -5, rand() * 6, 1, { dist: viewD * 0.6 }); put('drums', matMade, -9, -9, rand() * 6, 0.9, { dist: viewD * 0.6 });
        for (let k = 0; k < 3; k++) put(rand() < 0.5 ? 'drum' : 'drum2', matMade, 12 + rand() * 4, -9 + rand() * 4, rand() * 6, 1, { dist: viewD * 0.5 });
        put('slab', matMade, 3, -12, rand() * 6, 1, { dist: viewD * 0.6 }); put('rubble', matMade, -20, 4, rand() * 6, 1, { dist: viewD * 0.6 });
        for (let k = 0; k < 7; k++) { if (rand() < 0.14) continue; const [x, z] = local(-12 + k * 3.1, -9); place('fence', matMade, x, terrain.heightAt(x, z) - 0.02, z, ryAlong + (rand() - 0.5) * 0.06, 1, 1, 1, { dist: viewD * 0.5 }); }
        for (let k = 0; k < 6; k++) put(rand() < 0.5 ? 'tuft' : 'scrub2', matPlant, -22 + rand() * 40, -6 + rand() * 24, rand() * 6, 1.5 + rand() * 1.8, { shadow: false, dist: viewD * 0.5 });
        take(P2.x, P2.z, 28); (group.userData.yardAt = group.userData.yardAt || []).push(j); lastJ = j; yards++;
      }
      group.userData.yards = yards;
    }

    {
      let n = 0;
      for (const j of samplesRoad) {
        if (rand() > 0.07 * keep || nearStart(j)) continue;
        const sd = rand() < 0.5 ? -1 : 1, d = half + 6 + rand() * 30; lateral(j, d * sd, P2);
        if (terrain.roadDistAt(P2.x, P2.z) < half + 7.5 || !free(P2.x, P2.z, 6)) continue;
        const y = terrain.heightAt(P2.x, P2.z), u = rand();
        if (u < 0.35) place('slab', matMade, P2.x, y - 0.03, P2.z, rand() * 6.28, 1.2, 1.2, 1.2, { dist: viewD * 0.5 });
        else if (u < 0.5) place('drum', matMade, P2.x, y, P2.z, rand() * 6.28, 1, 1, 1, { dist: viewD * 0.4 });
        else { const q = 1.6 + rand() * 1.6; place(rand() < 0.5 ? 'tuft' : 'scrub2', matPlant, P2.x, y - 0.05, P2.z, rand() * 6.28, q, q, q, { shadow: false, dist: viewD * 0.5 }); }
        n++;
      }
      group.userData.debris = n;
    }
  }
  group.userData.footprints = FP;
  group.userData.pieces = lodItems.length; group.userData.N = R.N; group.userData.finishIdx = R.finishIdx; group.userData.finishZ = R.finishZ;
  return group;
}
