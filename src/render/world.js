// Builds one whole track in 3D: photoreal road ribbon (with dynamic wet/puddle PBR),
// terrain, live-reflective water, weather-reactive distant mountains, instanced scenery, gantries.
import * as THREE from 'three';
import { buildTerrain } from './terrain.js';
import { planarDetailMaterial, propMaterial, getNoiseTex, coniferMaterial, waterMaterial, roadMaterial, ENV_STATE } from './materials.js';
import { SPRITE_MODELS, buildSetPieces } from './props.js';
import { PERF } from './perf.js';
import { fbm, ridged, smooth, rng, noise2 } from './noise.js';

const Y_UP = new THREE.Vector3(0, 1, 0);

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) { t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; }
  return t;
}

function paintTexture(lanes, kind) {
  return canvasTex(512, 1024, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = rng(11);
    const line = (x, wd, col, y0 = 0, y1 = h) => { g.fillStyle = col; g.fillRect(x - wd / 2, y0, wd, y1 - y0); };
    for (let i = 0; i < 9; i++) { const pw = 60 + r() * 200, ph = 40 + r() * 220, px = r() * (w - pw), py = r() * h; g.fillStyle = `rgba(8,8,10,${0.16 + r() * 0.2})`; g.fillRect(px, py, pw, ph); g.fillStyle = 'rgba(8,8,10,0.25)'; g.fillRect(px, py, pw, 2); g.fillRect(px, py + ph, pw, 2); }
    line(w * 0.2, 5, 'rgba(8,8,10,0.28)'); line(w * 0.78, 4, 'rgba(8,8,10,0.25)'); line(w * 0.47, 3, 'rgba(8,8,10,0.2)');
    line(w * 0.035, 8, 'rgba(210,207,196,0.85)'); line(w * 0.965, 8, 'rgba(210,207,196,0.85)');
    line(w * 0.5 - 9, 6, 'rgba(204,166,50,0.88)'); line(w * 0.5 + 9, 6, 'rgba(204,166,50,0.88)');
    if (lanes > 2) for (const f of [0.25, 0.75]) line(w * f, 7, 'rgba(210,207,196,0.84)', 0, h * 0.4);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.7})`; const s = 1 + r() * 3.6; g.fillRect(r() * w, r() * h, s, s * (0.6 + r())); }
    for (let i = 0; i < 140; i++) { g.fillStyle = `rgba(0,0,0,${0.2 + r() * 0.5})`; g.fillRect(r() * w, r() * h, 6 + r() * 30, 8 + r() * 50); }
    g.globalCompositeOperation = 'source-over';
    for (let l = 0; l < lanes; l++) {
      const cx = ((l + 0.5) / lanes) * w, lw = w / lanes;
      for (const o of [-0.2, 0.2]) { const gr = g.createLinearGradient(cx + o * lw - 30, 0, cx + o * lw + 30, 0); gr.addColorStop(0, 'rgba(6,6,8,0)'); gr.addColorStop(0.5, 'rgba(6,6,8,0.32)'); gr.addColorStop(1, 'rgba(6,6,8,0)'); g.fillStyle = gr; g.fillRect(cx + o * lw - 30, 0, 60, h); }
    }
    g.strokeStyle = 'rgba(10,10,12,0.58)'; g.lineWidth = 2;
    for (let i = 0; i < 7; i++) { g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 60; y += 20 + r() * 40; g.lineTo(x, y); } g.stroke(); }
    const dust = kind === 'desert' ? '214,200,172' : '190,186,172';
    for (const side of [0, 1]) { const x0 = side ? w : 0, dir = side ? -1 : 1, gr = g.createLinearGradient(x0, 0, x0 + dir * w * 0.13, 0); gr.addColorStop(0, `rgba(${dust},0.62)`); gr.addColorStop(1, `rgba(${dust},0)`); g.fillStyle = gr; g.fillRect(side ? w * 0.87 : 0, 0, w * 0.13, h); }
    for (let i = 0; i < 24; i++) { const x = r() < 0.5 ? r() * w * 0.25 : w - r() * w * 0.25, y = r() * h, rad = 20 + r() * 50, gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(${dust},0.16)`); gr.addColorStop(1, `rgba(${dust},0)`); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
  });
}

function bannerTexture(text) {
  return canvasTex(1024, 192, (g, w, h) => {
    g.fillStyle = '#15161b'; g.fillRect(0, 0, w, h);
    const cell = 24;
    for (let i = 0; i < w / cell; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#f4f4f4' : '#15161b'; g.fillRect(i * cell, j * cell, cell, cell); g.fillRect(i * cell, h - (j + 1) * cell, cell, cell); }
    g.font = "900 110px Impact, 'Arial Black', sans-serif"; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = '#4a1a1c'; g.lineJoin = 'round'; g.strokeText(text, w / 2, h / 2 + 4);
    g.fillStyle = '#d9b84e'; g.fillText(text, w / 2, h / 2 + 4);
  }, false);
}

function checkerTexture() {
  return canvasTex(256, 64, (g, w, h) => { for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#f4f4f4' : '#151515'; g.fillRect(i * 16, j * 16, 16, 16); } }, false);
}

function waterNormalTexture() {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N), hgt = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0, a = 0.5, f = 4;
    for (let o = 0; o < 4; o++) { v += Math.sin((x / N) * Math.PI * 2 * f + o * 1.3 + Math.sin((y / N) * Math.PI * 2 * (f / 2) + o)) * Math.cos((y / N) * Math.PI * 2 * f + o * 0.7) * a; a *= 0.5; f *= 2; }
    hgt[y * N + x] = v;
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = hgt[y * N + (x + 1) % N] - hgt[y * N + (x + N - 1) % N], dy = hgt[((y + 1) % N) * N + x] - hgt[((y + N - 1) % N) * N + x];
    const nx = -dx * 2.2, ny = -dy * 2.2, nz = 1, l = Math.hypot(nx, ny, nz), o = (y * N + x) * 4;
    img.data[o] = (nx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[o + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(220, 220); t.anisotropy = 8;
  return t;
}

function ribbon(R, lat, yo, step, opts = {}) {
  const rows = [], N = R.N;
  for (let j = 0; j <= N; j += step) rows.push(j);
  if (rows[rows.length - 1] !== N) rows.push(N);
  const nc = lat.length, pos = new Float32Array(rows.length * nc * 3), uv = new Float32Array(rows.length * nc * 2), col = opts.color ? new Float32Array(rows.length * nc * 3) : null;
  const idx = [], tmp = new THREE.Color();
  for (let r = 0; r < rows.length; r++) {
    const j = rows[r], th = R.heading[j], rx = Math.cos(th), rz = Math.sin(th), tb = Math.tan(R.bank[j]);
    const cx = R.pts[j * 3], cy = R.pts[j * 3 + 1], cz = R.pts[j * 3 + 2];
    for (let k = 0; k < nc; k++) {
      const o = (r * nc + k) * 3, l = lat[k];
      pos[o] = cx + rx * l; pos[o + 1] = cy - l * tb + yo[k]; pos[o + 2] = cz + rz * l;
      uv[(r * nc + k) * 2] = ((l - lat[0]) / (lat[nc - 1] - lat[0])) * (opts.uRepeat || 1); uv[(r * nc + k) * 2 + 1] = (j * 0.8) / (opts.texLen || 8);
      if (col) { const c = opts.color(r, k, j, tmp); col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b; }
    }
  }
  for (let r = 0; r < rows.length - 1; r++) for (let k = 0; k < nc - 1; k++) {
    const a = r * nc + k, b = a + 1, c = a + nc, d = c + 1; idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

function flatRibbon(R, lat, yo, step, colorFn) {
  const rows = []; for (let j = 0; j <= R.N; j += step) rows.push(j);
  const nc = lat.length, nq = (rows.length - 1) * (nc - 1), pos = new Float32Array(nq * 12), col = new Float32Array(nq * 12), idx = new Uint32Array(nq * 6), tmp = new THREE.Color();
  const P = (r, k, out, o) => { const j = rows[r], th = R.heading[j], l = lat[k], tb = Math.tan(R.bank[j]); out[o] = R.pts[j * 3] + Math.cos(th) * l; out[o + 1] = R.pts[j * 3 + 1] - l * tb + (typeof yo[k] === 'function' ? yo[k](j) : yo[k]); out[o + 2] = R.pts[j * 3 + 2] + Math.sin(th) * l; };
  let q = 0;
  for (let r = 0; r < rows.length - 1; r++) for (let k = 0; k < nc - 1; k++, q++) {
    const o = q * 12, c = colorFn(r, k, rows[r], tmp);
    P(r, k, pos, o); P(r, k + 1, pos, o + 3); P(r + 1, k, pos, o + 6); P(r + 1, k + 1, pos, o + 9);
    for (let v = 0; v < 4; v++) { col[o + v * 3] = c.r; col[o + v * 3 + 1] = c.g; col[o + v * 3 + 2] = c.b; }
    const b = q * 4; idx.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], q * 6);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}

export function buildWorld(TB, track, props, renderer, look) {
  const R = TB.road, env = track.env, kind = env.kind, half = R.roadHalf, root = new THREE.Group();
  const S = TB.C.S, segL = TB.C.segL;
  const terrain = buildTerrain(TB, track, look);
  root.add(terrain.group);

  // ------------------------------------------------------------------ Photorealistic road
  const lanes = track.laneCount;
  const roadTex = paintTexture(lanes, kind);
  roadTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const TILE_M = 3.2, rw = half * 2;
  const asphaltMat = roadMaterial(look.road, kind, half);
  const asphalt = new THREE.Mesh(ribbon(R, [-half, half], [0, 0], 2, { texLen: TILE_M, uRepeat: rw / TILE_M }), asphaltMat);
  asphalt.receiveShadow = true; root.add(asphalt);

  const paintMat = new THREE.MeshStandardMaterial({ map: roadTex, transparent: true, roughness: 0.65, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const paint = new THREE.Mesh(ribbon(R, [-half, half], [0.004, 0.004], 2, { texLen: 8 }), paintMat);
  paint.receiveShadow = true; paint.renderOrder = 1; root.add(paint);

  const sh = 1.7;
  const gravel = new THREE.Color(kind === 'desert' ? '#cdbfa4' : kind === 'coast' ? '#c4bba6' : '#8f8a7c');
  const shoulderMat = planarDetailMaterial(kind === 'desert' ? look.A.diff : look.B.diff, (kind === 'desert' ? look.cfg.A[1] : look.cfg.B[1]) * 1.4, { vertexColors: true, roughness: 0.96 }, 0.9);
  for (const sd of [-1, 1]) {
    const b = half + sh, c2 = b + 2.0;
    const edgeY = new Float32Array(R.N + 1);
    for (let j = 0; j <= R.N; j++) { const th = R.heading[j], l = sd * c2, top = R.pts[j * 3 + 1] - l * Math.tan(R.bank[j]); edgeY[j] = Math.max(-1.9, Math.min(-0.03, terrain.heightAt(R.pts[j * 3] + Math.cos(th) * l, R.pts[j * 3 + 2] + Math.sin(th) * l) - top - 0.05)); }
    const edge = (j) => edgeY[j];
    const lat = sd < 0 ? [-c2, -b, -(half + 0.45), -half] : [half, half + 0.45, b, c2];
    const yo = sd < 0 ? [edge, -0.03, -0.02, -0.01] : [-0.01, -0.02, -0.03, edge];
    const m = new THREE.Mesh(flatRibbon(R, lat, yo, 2, (r, k, j, t) => {
      const rum = sd < 0 ? k === 2 : k === 1, apron = sd < 0 ? k === 0 : k === 3;
      if (rum) return t.copy(gravel).multiplyScalar(1.12);
      if (apron) return t.copy(gravel).multiplyScalar(0.55);
      return t.copy(gravel).multiplyScalar(0.92 + 0.12 * noise2(j * 0.13, k, 3));
    }), shoulderMat);
    m.receiveShadow = true; root.add(m);

    const rows = []; for (let j = 0; j <= R.N; j += 2) rows.push(j);
    const pos = new Float32Array(rows.length * 6), fcol = new Float32Array(rows.length * 6).fill(0.5), fmask = new Float32Array(rows.length * 6), idx = [];
    rows.forEach((j, r) => {
      const th = R.heading[j], cs = Math.cos(th), sn = Math.sin(th), l = sd * c2, l2 = sd * (c2 + 0.3), top = R.pts[j * 3 + 1] - l * Math.tan(R.bank[j]) + edgeY[j];
      const dth = R.heading[Math.min(j + 1, R.N)] - th, tight = dth * sd > 0 && 0.8 / Math.max(Math.abs(dth), 1e-6) < c2 + 1;
      const bx = R.pts[j * 3] + cs * l2, bz = R.pts[j * 3 + 2] + sn * l2, bot = tight ? top : Math.min(top, terrain.heightAt(bx, bz) - 1.2);
      pos.set([R.pts[j * 3] + cs * l, top, R.pts[j * 3 + 2] + sn * l, bx, bot, bz], r * 6);
      if (r) { const a = (r - 1) * 2, b2 = a + 1, c = a + 2, d = a + 3; if (sd > 0) idx.push(a, b2, c, b2, d, c); else idx.push(b2, a, d, a, c, d); }
    });
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); fg.setAttribute('color', new THREE.BufferAttribute(fcol, 3)); fg.setAttribute('mask', new THREE.BufferAttribute(fmask, 3)); fg.setIndex(idx); fg.computeVertexNormals(); fg.computeBoundingSphere();
    const face = new THREE.Mesh(fg, terrain.material); face.receiveShadow = true; root.add(face);
  }

  // ------------------------------------------------------------------ start / finish gantries
  const f = {};
  function gantry(idx, text) {
    const g = new THREE.Group(), z = idx * segL; R.frame(z, 0, f);
    const th = f.th, wdt = half + 1.8;
    const pillar = new THREE.MeshStandardMaterial({ color: '#2b2e36', roughness: 0.45, metalness: 0.55, envMapIntensity: 1.4 });
    for (const sd of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6.4, 0.5), pillar); p.position.set(sd * wdt, 3.2, 0); p.castShadow = true; p.receiveShadow = true; g.add(p); }
    const banner = new THREE.Mesh(new THREE.BoxGeometry(wdt * 2 + 0.5, 1.7, 0.4), [pillar, pillar, pillar, pillar, new THREE.MeshStandardMaterial({ map: bannerTexture(text), roughness: 0.55 }), new THREE.MeshStandardMaterial({ map: bannerTexture(text), roughness: 0.55 })]);
    banner.position.set(0, 6.0, 0); banner.castShadow = true; banner.receiveShadow = true; g.add(banner);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(wdt * 2 - 1, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: text === 'FINISH' ? '#ffe088' : '#b8f0a8', emissive: text === 'FINISH' ? '#ffbe44' : '#7ae868', emissiveIntensity: 2.2 }));
    lamp.position.set(0, 5.05, 0); g.add(lamp);
    g.position.set(f.x, f.y, f.z); g.rotation.y = -th;
    root.add(g);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 1.6), new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.78, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    strip.rotation.x = -Math.PI / 2; const sg = new THREE.Group(); sg.add(strip); strip.position.y = 0.01;
    sg.position.set(f.x, f.y, f.z); sg.rotation.y = -th; sg.rotation.order = 'YXZ';
    sg.rotateX(-f.pitch); sg.rotateZ(-f.bank);
    sg.receiveShadow = true; root.add(sg);
  }
  gantry(R.finishIdx, 'FINISH'); gantry(R.startIdx, 'START');

  // ------------------------------------------------------------------ water
  let water = null;
  if (env.waterY > -900) {
    const nm = waterNormalTexture();
    const bbx = terrain.bbox, DN = 512, dd = new Uint8Array(DN * DN);
    for (let j = 0; j < DN; j++) for (let i = 0; i < DN; i++) {
      const x = bbx.minx + (i + 0.5) / DN * (bbx.maxx - bbx.minx), z = bbx.minz + (j + 0.5) / DN * (bbx.maxz - bbx.minz);
      dd[j * DN + i] = Math.max(0, Math.min(255, Math.round((env.waterY - terrain.heightAt(x, z)) / 40 * 255)));
    }
    const dtex = new THREE.DataTexture(dd, DN, DN, THREE.RedFormat, THREE.UnsignedByteType); dtex.minFilter = dtex.magFilter = THREE.LinearFilter; dtex.wrapS = dtex.wrapT = THREE.ClampToEdgeWrapping; dtex.needsUpdate = true;
    water = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), waterMaterial(env, nm, dtex, bbx, kind));
    water.rotation.x = -Math.PI / 2; water.position.y = env.waterY; water.renderOrder = 2; water.userData.nm = nm;
    root.add(water);
  } else {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), planarDetailMaterial(look.A.diff, look.cfg.A[1], { color: '#d3c6ab', roughness: 1 }, 1.0));
    g.rotation.x = -Math.PI / 2; g.position.y = -0.4; root.add(g);
  }

  // ------------------------------------------------------------------ weather-reactive distant mountains
  let mountainsMesh = null;
  {
    const bb = terrain.bbox, cx = (bb.minx + bb.maxx) / 2, cz = (bb.minz + bb.maxz) / 2;
    const r0 = Math.hypot(bb.maxx - bb.minx, bb.maxz - bb.minz) / 2 + 20;
    const NA = PERF.mobile ? 240 : kind === 'alpine' ? 640 : 400, NR = PERF.mobile ? 44 : kind === 'alpine' ? 84 : 60, span = kind === 'coast' ? 2500 : 3600, pos = new Float32Array(NA * (NR + 1) * 3), col = new Float32Array(NA * (NR + 1) * 3), idx = [];
    const rock = new THREE.Color(kind === 'desert' ? '#8c7763' : kind === 'coast' ? '#7e725e' : '#7b7d82'), rockB = new THREE.Color(kind === 'desert' ? '#a2705a' : kind === 'coast' ? '#948766' : '#6b6e72'),
      forest = new THREE.Color('#3f4a38'), sandc = new THREE.Color(kind === 'desert' ? '#cdb996' : '#8f8466'), tmp = new THREE.Color();
    const baseY = kind === 'desert' ? 0 : env.waterY - 12;
    for (let a = 0; a < NA; a++) for (let rr = 0; rr <= NR; rr++) {
      const ang = (a / NA) * Math.PI * 2, t = rr / NR, rad = r0 + t * t * span + t * 120, x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
      let h;
      const ramp = smooth(0, 0.62, t);
      if (kind === 'alpine') {
        const rid = ridged(x * 0.0011, z * 0.0011, env.seed + 5, 5), lo = fbm(x * 0.003, z * 0.003, env.seed), crag = ridged(x * 0.006, z * 0.006, env.seed + 8, 3);
        h = ramp * (rid * 1100 + lo * 160 + crag * 90 * smooth(0.25, 0.7, rid));
      } else if (kind === 'desert') {
        const p = fbm(x * 0.0016, z * 0.0016, env.seed + 11, 4), er = ridged(x * 0.0042, z * 0.0042, env.seed + 21, 4), q = (smooth(0.40, 0.45, p) + smooth(0.49, 0.54, p) + smooth(0.58, 0.63, p)) / 3;
        h = Math.max(0, ramp * (q * 330 + smooth(0.3, 0.6, p) * 70 + er * 80 * smooth(0.05, 0.5, q + p * 0.3)));
      } else {
        const side = smooth(0.35, 0.65, noise2(Math.cos(ang) * 1.6 + 5, Math.sin(ang) * 1.6, env.seed));
        h = ramp * side * (fbm(x * 0.0018, z * 0.0018, env.seed + 3) * 330 + ridged(x * 0.0015, z * 0.0015, 2, 3) * 170 + ridged(x * 0.005, z * 0.005, 4, 3) * 50);
      }
      const y = baseY + h, o = (a * (NR + 1) + rr) * 3;
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
      const hh = h / (kind === 'desert' ? 400 : kind === 'alpine' ? 1100 : 900), vn = noise2(x * 0.01, z * 0.01, 3);
      if (kind === 'alpine') tmp.copy(forest).lerp(rock, smooth(0.12, 0.35, hh));
      else if (kind === 'desert') tmp.copy(sandc).lerp(rock, smooth(0.02, 0.18, hh)).lerp(rockB, smooth(0.35, 0.8, vn) * smooth(0.08, 0.3, hh) * 0.7);
      else tmp.copy(sandc).lerp(rock, smooth(0.15, 0.5, hh));
      tmp.multiplyScalar(0.85 + 0.3 * vn);
      col[o] = tmp.r; col[o + 1] = tmp.g; col[o + 2] = tmp.b;
    }
    for (let a = 0; a < NA; a++) for (let rr = 0; rr < NR; rr++) {
      const a2 = (a + 1) % NA, i0 = a * (NR + 1) + rr, i1 = a2 * (NR + 1) + rr;
      if (kind === 'alpine') idx.push(i0, i1, i0 + 1, i1, i1 + 1, i0 + 1);
      else idx.push(i0, i0 + 1, i1, i1, i0 + 1, i1 + 1);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    const MU = {
      tN: { value: getNoiseTex() },
      sunDir: ENV_STATE.uSunDir,
      sunCol: ENV_STATE.uSunCol,
      fogCol: ENV_STATE.uFogCol,
      uTime: ENV_STATE.uTime,
      uCloudCov: ENV_STATE.uCloudCov,
      uPhotoreal: ENV_STATE.uPhotoreal,
      fogD: { value: (kind === 'desert' ? 3300 : kind === 'alpine' ? 7600 : 3800) / PERF.fogMul },
      hazeMax: { value: kind === 'desert' ? 0.82 : kind === 'alpine' ? 0.45 : 0.72 },
      baseY: { value: baseY },
      alp: { value: kind === 'alpine' ? 1 : 0 },
      strata: { value: kind === 'desert' ? 1.0 : kind === 'alpine' ? 0.5 : 0.35 },
      relief: { value: kind === 'alpine' ? 1.3 : 1.0 }
    };
    const mm = new THREE.ShaderMaterial({
      uniforms: MU, side: THREE.DoubleSide, fog: false,
      vertexShader: 'attribute vec3 color; varying vec3 vWP; varying vec3 vN; varying vec3 vCol; void main(){ vWP = position; vN = normal; vCol = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tN; uniform vec3 sunDir, sunCol, fogCol; uniform float fogD, hazeMax, baseY, strata, relief, alp, uTime, uCloudCov, uPhotoreal;
      varying vec3 vWP; varying vec3 vN; varying vec3 vCol;
      void main(){
        float dist = length(vWP - cameraPosition);
        vec3 N = normalize(vN);
        float steep = 1.0 - smoothstep(0.35, 0.85, N.y);
        vec2 uvT = vWP.xz, uvS = vec2(vWP.x + vWP.z, vWP.y * 2.2);
        float hLo = mix(texture2D(tN, uvT * 0.00045).r, texture2D(tN, uvS * 0.00035 + 0.37).r, steep);
        vec2 mid2 = mix(texture2D(tN, uvT * 0.0031).rg, texture2D(tN, uvS * 0.0022 + 0.11).rg, steep);
        float hMid = mid2.r * 0.7 + mid2.g * 0.5;
        vec4 fine = texture2D(tN, mix(uvT, uvS, steep) * 0.011 + 0.7);
        float hgt = hLo * 90.0 + hMid * 22.0 * relief + (fine.r * 0.6 + fine.g * 0.5) * 5.0 * smoothstep(2500.0, 300.0, dist);
        vec3 sx = dFdx(vWP), sy = dFdy(vWP);
        vec3 R1 = cross(sy, N), R2 = cross(N, sx); float fDet = dot(sx, R1);
        vec3 grad = sign(fDet) * (dFdx(hgt) * R1 + dFdy(hgt) * R2);
        vec3 Nb = normalize(abs(fDet) * N - grad * 0.9);
        vec3 alb = vCol * (0.75 + 0.5 * hLo);
        float yy = vWP.y - baseY, band = sin(yy * 0.11 + hLo * 7.0 + hMid * 2.0), thin = pow(abs(sin(yy * 0.55 + hMid * 5.0)), 6.0);
        float streak = texture2D(tN, vec2((vWP.x + vWP.z) * 0.0042, vWP.y * 0.00045) + 0.2).g;
        alb *= 1.0 + strata * steep * (0.14 * band - 0.18 * thin) - steep * 0.26 * smoothstep(0.5, 0.95, streak);
        alb *= 0.9 + 0.2 * hMid;
        float snowA = 0.0;
        if (alp > 0.5) {
          vec4 n1 = texture2D(tN, vWP.xz * 0.00022), n2 = texture2D(tN, vWP.xz * 0.0011 + 0.3), n3 = texture2D(tN, vec2(vWP.x + vWP.z, vWP.y * 1.6) * 0.0016 + 0.6);
          vec4 n4 = texture2D(tN, vWP.xz * 0.0042 + 0.1);
          float near = 1.0 - smoothstep(600.0, 3200.0, dist);
          vec3 pert = vec3(n2.r - 0.5, 0.0, n2.g - 0.5) * (0.5 + 0.5 * near) + vec3(n4.r - 0.5, 0.0, n4.b - 0.5) * 0.4 * near;
          Nb = normalize(N + pert * 0.4);
          float alt = yy + (n1.r - 0.5) * 220.0 + (n2.r - 0.5) * 70.0;
          float ny2 = normalize(vec3(N.x * 2.6, N.y, N.z * 2.6)).y;
          float line = smoothstep(210.0, 330.0, alt);
          float flat_ = smoothstep(0.12, 0.42, ny2 + (n2.g - 0.5) * 0.22 + (n4.r - 0.5) * 0.12);
          float couloir = smoothstep(0.55, 0.8, n4.g) * smoothstep(330.0, 520.0, alt) * smoothstep(0.2, 0.5, ny2) * 0.8;
          snowA = smoothstep(0.12, 0.88, clamp(line * flat_ + couloir, 0.0, 1.0));
          float rockv = 0.7 + 0.6 * smoothstep(0.2, 0.8, n3.r);
          vec3 rockC = vec3(0.34, 0.31, 0.29) * rockv * (1.0 + 0.25 * vCol.g);
          vec3 base = mix(vCol * (0.8 + 0.4 * hLo), rockC, smoothstep(90.0, 220.0, alt) * smoothstep(0.7, 0.4, ny2 + 0.4));
          alb = mix(base, vec3(0.97, 0.98, 1.0), snowA);
        }
        vec3 sDir = normalize(sunDir);
        float nl = clamp(dot(Nb, sDir), 0.0, 1.0);
        float sky = Nb.y * 0.5 + 0.5;
        vec3 aS = fogCol * 0.72 * vec3(0.84, 0.94, 1.12);
        vec3 aG = fogCol * vec3(0.38, 0.36, 0.34);
        // Drifting cloud shadows across mountain ridges
        float csh = 1.0;
        if (uPhotoreal > 0.5) {
          float cn = texture2D(tN, vWP.xz * 0.00032 + vec2(uTime * 0.0012, uTime * 0.0007)).r;
          csh = 1.0 - smoothstep(0.60 - uCloudCov * 0.3, 0.90 - uCloudCov * 0.2, cn) * (0.36 * uCloudCov);
        }
        vec3 lit = alb * (mix(aG, aS, sky) + sunCol * 1.45 * nl * csh * (0.35 + 0.65 * smoothstep(0.0, 0.35, nl)));
        if (alp > 0.5) lit = mix(lit, lit * vec3(0.62, 0.76, 1.14), snowA * (1.0 - nl) * 0.82);
        // Directional aerial perspective (warmer haze looking toward sun, cooler blue away)
        vec3 vDir = normalize(vWP - cameraPosition);
        float sunScatter = pow(max(dot(vDir, sDir), 0.0), 4.0) * 0.22 * uPhotoreal;
        vec3 hazeC = mix(fogCol, sunCol, sunScatter);
        float f = 1.0 - exp(-pow(dist / fogD, 1.35));
        f = min(f, hazeMax); f = max(f, 0.06 * smoothstep(0.0, 400.0, dist));
        f += (1.0 - smoothstep(0.0, 140.0, yy)) * 0.16 * (1.0 - f);
        gl_FragColor = vec4(mix(lit, hazeC, clamp(f, 0.0, 1.0)), 1.0);
      }`
    });
    mm.extensions = { derivatives: true };
    mountainsMesh = new THREE.Mesh(g, mm);
    mountainsMesh.frustumCulled = false;
    root.add(mountainsMesh);
    root.userData.mountains = mountainsMesh;
  }

  // ------------------------------------------------------------------ scenery (all instanced)
  const insts = [];
  const rand = rng(track.seed * 7 + 1);
  const bushModel = kind === 'desert' ? 'bushD' : kind === 'coast' ? 'bushC' : 'bush';
  const fr = {};
  const MODEL_R = {};
  const modelR = (name) => {
    if (MODEL_R[name] !== undefined) return MODEL_R[name];
    const g = props[name]; let m = 0;
    if (g) { const a = g.attributes.position.array; for (let i = 0; i < a.length; i += 3) m = Math.max(m, a[i] * a[i] + a[i + 2] * a[i + 2]); }
    return (MODEL_R[name] = Math.sqrt(m));
  };
  const MODEL_H = {}; const modelH = (name) => { if (MODEL_H[name] === undefined) { const g = props[name]; if (g && !g.boundingBox) g.computeBoundingBox(); MODEL_H[name] = g ? g.boundingBox.max.y : 1; } return MODEL_H[name]; };
  const MARGIN = 1.6;
  const insideExtra = (j, sd) => { const cv = R.nearCurve[Math.max(0, Math.min(R.N - 1, j))]; return (Math.abs(cv) > 2.4 && sd * cv > 0) ? 6 + 5 * Math.min(1, (Math.abs(cv) - 2.4) / 3) : 0; };
  const VB = new Set(), vbk = (x, z) => Math.floor(x / 3) * 100003 + Math.floor(z / 3);
  for (let j = 10; j < R.N - 100; j += 3) {
    const ax = R.pts[(j - 7) * 3], az = R.pts[(j - 7) * 3 + 2];
    for (const k of [25, 50, 75]) {
      const bx = R.pts[(j + k) * 3], bz = R.pts[(j + k) * 3 + 2], n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 3));
      for (let q = 1; q <= n; q++) { const x = ax + (bx - ax) * q / n, z = az + (bz - az) * q / n; if (terrain.roadDistAt(x, z) > half + 0.8) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) VB.add(vbk(x + a * 3, z + b * 3)); }
    }
  }
  const blocksView = (x, z, r) => { const q = Math.min(r, 8) * 0.8; return VB.has(vbk(x, z)) || VB.has(vbk(x + q, z)) || VB.has(vbk(x - q, z)) || VB.has(vbk(x, z + q)) || VB.has(vbk(x, z - q)); };
  const clearEnough = (x, z, r, extra) => terrain.roadDistAt(x, z) - half - r >= MARGIN + extra;

  const FIXED = new Set(['rail', 'sign', 'pole']);
  const CONIF = { fir: 0.3, fir2: 0.3, fir3: 0.5, pine: 0.3, pine2: 0.3, snag: 0.3 };
  const pickConifer = (r, core) => {
    const u = r();
    if (core) return u < 0.4 ? 'fir' : u < 0.76 ? 'fir2' : u < 0.84 ? 'pine' : u < 0.89 ? 'pine2' : u < 0.97 ? 'fir3' : 'snag';
    return u < 0.26 ? 'fir' : u < 0.4 ? 'fir2' : u < 0.52 ? 'pine' : u < 0.6 ? 'pine2' : u < 0.93 ? 'fir3' : 'snag';
  };
  function treeDims(model, r, big) {
    let sy, sx;
    if (model === 'fir3') { sy = 3 + r() * 6 * (big || 1); sx = sy * (0.5 + r() * 0.12); }
    else if (model === 'pine' || model === 'pine2') { sy = 11 + r() * 11 * (big || 1); sx = sy * (0.27 + r() * 0.07); }
    else if (model === 'snag') { sy = 6 + r() * 9; sx = sy * (0.24 + r() * 0.08); }
    else { sy = 9 + Math.pow(r(), 1.4) * 18 * (big || 1); sx = sy * (0.25 + r() * 0.07); }
    return [sx, sy];
  }
  const treeTint = (model, r) => {
    const v = 0.58 + r() * 0.3, hue = r(), rusty = r() < 0.05;
    let tr = v, tg = v, tb = v;
    if (rusty) { tr *= 1.25; tg *= 0.95; tb *= 0.7; }
    else if (hue < 0.3) { tr *= 1.06; tg *= 1.03; tb *= 0.88; }
    else if (hue > 0.7) { tr *= 0.92; tg *= 0.98; tb *= 1.06; }
    if (model === 'snag') { tr = tg = tb = 0.85 + r() * 0.3; }
    return [tr, tg, tb];
  };
  const SPRITE_DROP = { cactus: 0.55 };
  for (let i = 8; i < R.N - 10; i++) {
    const seg = R.segs[i];
    for (let q = 0; q < seg.sprites.length; q++) {
      const s = seg.sprites[q];
      if (s._fx) continue; s._fx = 1;
      if (FIXED.has(s.t) || s.t === 'mesa') continue;
      const models = SPRITE_MODELS[s.t]; if (!models) continue;
      const sd = s.off < 0 ? -1 : 1, z = i * segL + 100;
      if (SPRITE_DROP[s.t] && ((i * 7 + q * 3) % 100) / 100 < SPRITE_DROP[s.t]) { s.solid = false; s._skip = true; continue; }
      if (s.t === 'fir' && kind === 'alpine' && ((i * 5 + q * 11) % 100) < (s.solid ? 40 : 65)) { s._skip = true; continue; }
      const rr = rng(i * 131 + q * 17 + track.seed);
      let model = models[(s.v || 0) % models.length], sx = s.w * S, sy = s.h * S, sz = sx, tint = null;
      if (s.t === 'fir') { model = pickConifer(rr, rr() < 0.7); const d = treeDims(model, rr); sx = sz = d[0]; sy = d[1]; tint = treeTint(model, rr); }
      else if (s.t === 'cactus') { const u = rr(); model = u < 0.5 ? 'cactus' : u < 0.8 ? 'cactus2' : 'barrel'; const k = 0.55 + rr() * 0.8; sy = (model === 'barrel' ? 0.9 : s.h * S) * k; sx = sz = (model === 'barrel' ? 1.3 : s.w * S) * k; tint = [0.85 + rr() * 0.3, 0.9 + rr() * 0.2, 0.8 + rr() * 0.3]; }
      else if (s.t === 'palm') { model = rr() < 0.5 ? 'palm' : 'palm2'; const k = 0.7 + rr() * 0.5; sy = s.h * S * k; sx = sz = s.w * S * 0.9 * k; tint = [0.85 + rr() * 0.3, 0.9 + rr() * 0.2, 0.8 + rr() * 0.2]; }
      else if (s.t === 'boulder' || s.t === 'rock') { sy = s.h * S * 1.5; sx = sz = s.w * S * (0.8 + rr() * 0.5); }
      else if (s.t === 'bush') { model = bushModel; sx = sz = s.w * S * 1.5; sy = s.h * S * 1.5; }
      else if (s.t === 'billboard') { sx = sz = s.w * S * 0.8; sy = s.w * S * 0.8; }
      const rc = modelR(model) * Math.max(sx, sz) * 1.04;
      const minm = half + rc + MARGIN + insideExtra(i, sd) + 0.4;
      let m = Math.abs(s.off) * half;
      if (m < minm) { m = minm; s.off = sd * m / half; }
      R.frame(z, s.off, fr);
      const tall = modelH(model) * sy > 2.5;
      if (!clearEnough(fr.x, fr.z, rc, 0) || (tall && blocksView(fr.x, fr.z, rc))) { s.solid = false; s._skip = true; continue; }
      if (s.solid) s.hw = Math.max(s.hw || 0, 0.6 * rc / half);
      s._m = model; s._d = [sx, sy, sz]; s._t = tint; s._r = rc;
    }
  }
  for (let i = 8; i < R.N - 10; i++) {
    const seg = R.segs[i];
    for (let q = 0; q < seg.sprites.length; q++) {
      const s = seg.sprites[q];
      if (s._skip) continue;
      const models = SPRITE_MODELS[s.t]; if (!models || s.t === 'mesa') continue;
      const z = i * segL + 100;
      R.frame(z, s.off, fr);
      let y = fr.y, x = fr.x, zz = fr.z;
      const fixed = FIXED.has(s.t);
      if (!fixed && Math.abs(s.off) > 1.45) y = terrain.heightAt(x, zz);
      if (!fixed && env.waterY > -900 && y < env.waterY + 0.7) continue;
      let model = s._m || models[(s.v || 0) % models.length];
      if (s.t === 'sign') model = 'sign' + Math.min(2, s.v);
      let ry = rand() * Math.PI * 2, sx = s.w * S, sy = s.h * S, sz = s.w * S, tint = s._t || null;
      if (s._d) { sx = s._d[0]; sy = s._d[1]; sz = s._d[2]; }
      if (s.t === 'rail') { ry = Math.PI / 2 - fr.th; sx = s.w * S; sy = 1; sz = 1; y -= 0.02; }
      else if (s.t === 'sign') { ry = -fr.th + (s.off > 0 ? 0.25 : -0.25); sx = sy = sz = 1.5; }
      else if (s.t === 'pole') { ry = -fr.th; sx = sy = sz = s.h * S * 0.9; }
      else if (s.t === 'billboard') ry = -fr.th + (s.off > 0 ? 0.3 : -0.3);
      const t0 = 0.9 + rand() * 0.2;
      insts.push({ model, x, y: y - (fixed ? 0 : 0.15), z: zz, ry, sx, sy, sz, tr: tint ? tint[0] : t0, tg: tint ? tint[1] : t0, tb: tint ? tint[2] : t0, r: fixed ? 0 : modelR(model) * Math.max(sx, sz), h: modelH(model) * sy, kind: fixed ? 'fixed' : 'sprite' });
    }
  }

  {
    const r = rng(track.seed * 13 + 5), seed = env.seed;
    const step = kind === 'alpine' ? 4 : kind === 'coast' ? 7 : 11, tries = kind === 'alpine' ? 4 : 3;
    const add = (model, x, y, z, sx, sy, sz, tint, ry = r() * 6.28) => {
      const rc = modelR(model) * Math.max(sx, sz);
      insts.push({ model, x, y, z, ry, sx, sy, sz, tr: tint[0], tg: tint[1], tb: tint[2], r: rc, h: modelH(model) * sy, kind: 'scatter' });
    };
    const cover = (x, z, rc, f2) => {
      const n = f2 > 0.55 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        if (r() < 0.45) continue;
        const a = r() * 6.28, dd = rc * (0.3 + r() * 0.8) + 0.6, px = x + Math.cos(a) * dd, pz = z + Math.sin(a) * dd;
        if (!clearEnough(px, pz, 1.4, 0.5) || blocksView(px, pz, 1.4)) continue;
        const py = terrain.heightAt(px, pz) - 0.05, u = r();
        if (u < 0.8) { const q = 1.4 + r() * 1.6; add('fern', px, py, pz, q, q * (0.8 + r() * 0.5), q, [0.8 + r() * 0.4, 0.85 + r() * 0.3, 0.7 + r() * 0.3]); }
        else if (u < 0.96) { const q = 1.0 + r() * 1.3; add('bush', px, py, pz, q * 1.3, q, q * 1.3, [0.75 + r() * 0.4, 0.85 + r() * 0.3, 0.7 + r() * 0.2]); }
        else { const q = 0.8 + r() * 1.6; add(r() < 0.5 ? 'boulder' : 'boulder2', px, py - 0.1, pz, q, q * 0.8, q, [0.8, 0.8, 0.8]); }
      }
    };
    for (let j = 10; j < R.N - 10; j += step) {
      const th = R.heading[j], rx = Math.cos(th), rz = Math.sin(th), cx = R.pts[j * 3], cz = R.pts[j * 3 + 2];
      for (let t = 0; t < tries; t++) {
        if (PERF.sceneryKeep < 1 && r() > PERF.sceneryKeep) continue;
        const sd = r() < 0.5 ? -1 : 1;
        const d = half + 4 + (kind === 'alpine' ? 170 * Math.pow(r(), 1.5) : 130 * r() * r() * r()), x = cx + rx * d * sd, z = cz + rz * d * sd;
        const y = terrain.heightAt(x, z);
        if (env.waterY > -900 && y < env.waterY + 1.4) continue;
        const sl = Math.abs(terrain.heightAt(x + 2, z) - y) + Math.abs(terrain.heightAt(x, z + 2) - y);
        if (sl > 2.6) continue;
        const rdEdge = terrain.roadDistAt(x, z) - half, ext = insideExtra(j, sd);
        if (rdEdge < 3) continue;
        const clump = fbm(x * 0.012, z * 0.012, seed + 40);
        let model, sx, sy, sz, tint = [1, 1, 1];
        if (kind === 'alpine') {
          const f2 = fbm(x * 0.0075 + 3, z * 0.0075 - 5, seed + 41), dens = smooth(0.4, 0.58, f2), thin = 0.12 + 0.88 * smooth(4, 38, rdEdge);
          if (r() > dens * thin + 0.035) continue;
          const core = f2 > 0.6 && rdEdge > 30, v = r();
          if (dens < 0.08 && r() < 0.5) model = 'fir3';
          else if (v < 0.93) model = pickConifer(r, core);
          else model = r() < 0.5 ? 'boulder' : 'boulder2';
          if (model === 'boulder' || model === 'boulder2') { sx = sz = 1.5 + r() * 4; sy = sx * 0.9; tint = [0.9, 0.9, 0.9]; }
          else { const d2 = treeDims(model, r, 0.75 + f2 * 0.6); sx = sz = d2[0]; sy = d2[1]; tint = treeTint(model, r); }
        } else if (kind === 'desert') {
          if (clump < 0.45 && r() < 0.7) continue;
          const u = r();
          if (u < 0.08) { const w = r(); model = w < 0.45 ? 'cactus' : w < 0.75 ? 'cactus2' : 'barrel'; const k = Math.pow(r(), 1.6); sy = model === 'barrel' ? 0.5 + k * 0.9 : 1.6 + k * 5.4; sx = sz = model === 'barrel' ? sy * 1.5 : sy * (0.8 + r() * 0.5); tint = [0.8 + r() * 0.35, 0.85 + r() * 0.25, 0.75 + r() * 0.35]; }
          else if (u < 0.5) { model = r() < 0.5 ? 'rock' : 'rock2'; sx = sz = 1.5 + r() * 5; sy = sx * 0.9; tint = [0.9, 0.9, 0.9]; }
          else if (u < 0.78) { model = 'bushD'; sx = sz = 1.0 + r() * 1.8; sy = sx * (0.6 + r() * 0.4); tint = [0.8 + r() * 0.4, 0.85 + r() * 0.3, 0.75 + r() * 0.3]; }
          else { model = r() < 0.5 ? 'tuft' : 'scrub2'; sx = sz = 1.2 + r() * 2.2; sy = sx * (0.5 + r() * 0.5); tint = [0.85 + r() * 0.3, 0.85 + r() * 0.3, 0.8 + r() * 0.3]; }
        } else {
          if (clump < 0.3 && r() < 0.75) continue;
          const u = r();
          if (u < 0.5) { model = r() < 0.55 ? 'palm' : 'palm2'; sy = 5 + r() * 7; sx = sz = sy * (0.8 + r() * 0.3); tint = [0.85 + r() * 0.3, 0.9 + r() * 0.2, 0.8 + r() * 0.25]; }
          else if (u < 0.72) { model = 'bushC'; sx = sz = 1.5 + r() * 2; sy = sx * (0.6 + r() * 0.4); tint = [0.85 + r() * 0.3, 0.9 + r() * 0.2, 0.8 + r() * 0.25]; }
          else if (u < 0.82) { model = 'tuft'; sx = sz = 1.5 + r() * 2; sy = sx * 0.7; tint = [1, 1, 0.9]; }
          else { model = r() < 0.5 ? 'boulder' : 'boulder2'; sx = sz = 1.5 + r() * 3.5; sy = sx * 0.85; tint = [0.9, 0.9, 0.9]; }
        }
        sz = sz === undefined ? sx : sz;
        const rc = modelR(model) * Math.max(sx, sz);
        if (!clearEnough(x, z, rc, ext)) continue;
        if (modelH(model) * sy > 2.5 && blocksView(x, z, rc)) continue;
        if (ext > 0 && rdEdge < 22 + ext && rc > 1.2) continue;
        add(model, x, y - 0.2, z, sx, sy, sz, tint);
        if (kind === 'alpine' && CONIF[model] !== undefined && model !== 'snag') cover(x, z, rc, fbm(x * 0.0075 + 3, z * 0.0075 - 5, seed + 41));
      }
    }
  }

  const propMat = propMaterial(look.B.diff, 0.2, 'vec3(1.0)', 'tree');
  const rockMat = propMaterial(look.B.diff, 1.1, 'vec3(1.0)', 'rock');
  const conMat = coniferMaterial(), CON = /^(fir|pine)/;
  const ROCKS = new Set(['boulder', 'boulder2', 'rock', 'rock2']);
  const SMALL = new Set(['bush', 'bushC', 'bushD', 'fern', 'tuft', 'scrub2']);
  const buckets = new Map();
  for (const it of insts) {
    const key = it.model + '|' + Math.floor(it.x / 100) + '|' + Math.floor(it.z / 100);
    let b = buckets.get(key); if (!b) { b = { model: it.model, list: [] }; buckets.set(key, b); }
    b.list.push(it);
  }
  const chunks = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pv = new THREE.Vector3(), sv = new THREE.Vector3(), cc = new THREE.Color();
  const mk = (geo, mat, list) => {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => {
      q.setFromAxisAngle(Y_UP, it.ry); m4.compose(pv.set(it.x, it.y, it.z), q, sv.set(it.sx, it.sy, it.sz)); mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, cc.setRGB(it.tr, it.tg, it.tb));
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
    mesh.receiveShadow = false; return mesh;
  };
  for (const b of buckets.values()) {
    const geo = props[b.model]; if (!geo) continue;
    let sxm = 0, szm = 0; for (const it of b.list) { sxm += it.x; szm += it.z; }
    const n = b.list.length, mat = ROCKS.has(b.model) ? rockMat : CON.test(b.model) ? conMat : propMat, shadow = !SMALL.has(b.model);
    const hi = mk(geo, mat, b.list); hi.castShadow = shadow; if (mat === conMat) hi.customDepthMaterial = conMat.userData.depth; root.add(hi);
    const ch = { hi, lo: null, x: sxm / n, z: szm / n, model: b.model };
    if (props[b.model + '_lo']) { ch.far = !CON.test(b.model); ch.lo = mk(props[b.model + '_lo'], mat, b.list); ch.lo.castShadow = false; root.add(ch.lo); }
    chunks.push(ch);
  }
  const setp = buildSetPieces(TB, track, terrain, look); root.add(setp);

  let tick = 0;
  function update(camPos, t, everyFrame) {
    if (water) water.material.userData.U.wTime.value = t;
    if (everyFrame || (tick++ % 5) === 0) {
      const HI_DIST = PERF.hiDist, LO_DIST = PERF.mobile ? 210 : 340;
      const near = everyFrame ? 0.55 : 1, vis = PERF.viewDist * PERF.viewDist * near * near;
      const hi2 = HI_DIST * HI_DIST * near * near, LO2 = LO_DIST * LO_DIST * near * near;
      for (const c of chunks) {
        const dx = c.x - camPos.x, dz = c.z - camPos.z, d2 = dx * dx + dz * dz;
        if (c.lo) { c.hi.visible = d2 < hi2; c.lo.visible = d2 >= hi2 && d2 < (c.far ? vis : Math.min(vis, LO2)); } else c.hi.visible = d2 < vis;
      }
    }
  }
  function dispose() {
    root.traverse((o) => { if (o.geometry && !Object.values(props).includes(o.geometry)) o.geometry.dispose(); });
    terrain.dispose(); roadTex.dispose();
  }
  const treeShadows = (on) => { for (const c of chunks) if (!SMALL.has(c.model)) c.hi.castShadow = on; };
  return { root, update, treeShadows, dispose, heightAt: terrain.heightAt, terrain, water, waterY: env.waterY, mountains: mountainsMesh, chunks, insts };
}
