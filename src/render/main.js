// Browser entry: connects the simulation (window.TB) to the photorealistic 3D scene,
// particle FX, live weather/quality/compare controls, camera, HUD and input.
import * as THREE from 'three';
import { createScene } from './scene.js';
import { loadVehicleAssets, RacerRig, TrafficRig } from './vehicles.js';
import { makeProps } from './props.js';
import { buildWorld } from './world.js';
import { createUI } from './ui.js';
import { loadLook, ENV_STATE, setAnisotropy } from './materials.js';
import { PERF, WEATHER_MODES, WEATHER_LABELS, QUALITY_ORDER, QUALITY_TIERS, setQualityTier, setWeatherMode } from './perf.js';
import { createTouch } from './touch.js';
import { createFX } from './fx.js';

const TB = window.TB, G = TB.G, R = TB.road, C = TB.C, RC = TB.racer, S = C.S;
const errbox = document.getElementById('errbox');
function showError(e) { errbox.hidden = false; errbox.textContent += (e && e.stack ? e.stack : String(e)) + '\n'; console.error(e); }
window.addEventListener('error', (e) => showError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showError(e.reason));

const hash = window.location.hash || '';
const param = (k, d) => { const m = new RegExp('[#&]' + k + '=([^&]+)').exec(hash); return m ? m[1] : d; };

async function main() {
  const ui = createUI(TB);
  const touch = createTouch(TB);
  const fit = () => { const s = Math.min(window.innerWidth / TB.W, window.innerHeight / TB.H); document.getElementById('stage').style.setProperty('--s', s.toFixed(4)); };
  window.addEventListener('resize', fit); window.addEventListener('orientationchange', () => setTimeout(fit, 150)); fit();

  const speedfx = [0, 1].map(() => Object.assign(document.createElement('div'), { className: 'speedfx' }));
  const hitfx = [0, 1].map(() => Object.assign(document.createElement('div'), { className: 'hitfx' }));
  [speedfx, hitfx].forEach((l) => { l[0].classList.add('fx-l'); l[1].classList.add('fx-r'); });
  document.body.append(...speedfx, ...hitfx);
  const setFxHalf = (duo) => { document.body.classList.toggle('duo', duo); speedfx[1].style.display = hitfx[1].style.display = duo ? 'block' : 'none'; };
  const fxLayer = document.getElementById('fx');

  ui.bootMsg('Loading photoreal bikes & textures...');
  const sc = createScene(document.getElementById('game'));
  TB.sc = sc;
  const fx3d = createFX(sc.scene);
  await loadVehicleAssets();
  const props = makeProps();
  const { scene, camera, camera2 } = sc;
  TB.duoAllowed = !PERF.mobile;
  sc.onSplit = (on) => { if (worlds[curWorld]) worlds[curWorld].treeShadows(!on); };

  // ---------------------------------------------------------------- Preview Graphics Toolbar
  const btnWeather = document.getElementById('gfx-weather');
  const btnQuality = document.getElementById('gfx-quality');
  const btnCompare = document.getElementById('gfx-compare');
  const fpsEl = document.getElementById('gfx-fps');

  function syncToolbar() {
    if (btnWeather) btnWeather.textContent = 'WEATHER: ' + (WEATHER_LABELS[PERF.weather] || 'SUNNY');
    if (btnQuality) btnQuality.textContent = 'QUALITY: ' + (QUALITY_TIERS[PERF.tier]?.label || 'HIGH');
    if (btnCompare) {
      btnCompare.textContent = PERF.photoreal ? 'LOOK: PHOTOREAL' : 'LOOK: ORIGINAL';
      btnCompare.classList.toggle('alt', !PERF.photoreal);
    }
  }

  function applyRigsLook() {
    for (const x of rigs) x.rig.applyLookMode(PERF.photoreal);
    for (const x of trafficRigs) x.rig.applyLookMode(PERF.photoreal);
    if (showRig) showRig.applyLookMode(PERF.photoreal);
  }

  function cycleWeather() {
    const idx = (WEATHER_MODES.indexOf(PERF.weather) + 1) % WEATHER_MODES.length;
    setWeatherMode(WEATHER_MODES[idx]);
    if (!PERF.photoreal) PERF.photoreal = true;
    sc.refreshEnv();
    applyRigsLook();
    syncToolbar();
    try { TB.audio.menu(); } catch (e) { /* ignore */ }
  }

  function cycleQuality() {
    const idx = (QUALITY_ORDER.indexOf(PERF.tier) + 1) % QUALITY_ORDER.length;
    setQualityTier(QUALITY_ORDER[idx]);
    setAnisotropy(sc.renderer);
    sc.applyQuality();
    applyRigsLook();
    syncToolbar();
    try { TB.audio.menu(); } catch (e) { /* ignore */ }
  }

  function toggleCompare() {
    PERF.photoreal = !PERF.photoreal;
    sc.refreshEnv();
    applyRigsLook();
    syncToolbar();
    try { TB.audio.menu(); } catch (e) { /* ignore */ }
  }

  if (btnWeather) btnWeather.addEventListener('click', (e) => { e.stopPropagation(); cycleWeather(); });
  if (btnQuality) btnQuality.addEventListener('click', (e) => { e.stopPropagation(); cycleQuality(); });
  if (btnCompare) btnCompare.addEventListener('click', (e) => { e.stopPropagation(); toggleCompare(); });
  syncToolbar();

  // ---------------------------------------------------------------- worlds
  const worlds = {}; let curWorld = -1;
  async function ensureWorld(idx) {
    const track = TB.tracks[idx];
    if (R.track !== track) R.build(track);
    if (curWorld === idx) return;
    if (worlds[curWorld]) scene.remove(worlds[curWorld].root);
    ui.showBoot('Loading ' + track.name + '...');
    const lk = await loadLook(track.env.kind, sc.renderer);
    lk.fogColor = new THREE.Color(track.env.fog);
    if (!worlds[idx]) {
      ui.showBoot('Building ' + track.name + '...');
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      worlds[idx] = buildWorld(TB, track, props, sc.renderer, lk);
    }
    sc.setReflectionMountains(worlds[idx].mountains, worlds[idx].waterY);
    sc.setEnv(track.env, lk);
    scene.add(worlds[idx].root);
    curWorld = idx;
    fx3d.clear();
    ui.hideBoot();
    lastTs = 0;
  }

  // ---------------------------------------------------------------- rigs
  let rigs = [], trafficRigs = [], showRig = null, showKey = '';
  const frA = {}, frB = {};
  function clearRigs() { for (const r of rigs) scene.remove(r.rig.group); for (const t of trafficRigs) scene.remove(t.rig.group); rigs = []; trafficRigs = []; }
  function clearShow() { if (showRig) { scene.remove(showRig.group); showRig = null; } showKey = ''; }
  function setupRace() {
    clearRigs(); clearShow(); fx3d.clear();
    const add = (r) => { const rig = new RacerRig({ body: r.body, suit: r.suit, helmet: r.helmet }, r.isPlayer); scene.add(rig.group); rigs.push({ r, rig }); };
    TB.humans.forEach(add); TB.rivals.list.forEach(add);
    TB.traffic.list.forEach((t) => { const rig = new TrafficRig(t); scene.add(rig.group); trafficRigs.push({ t, rig }); });
    cams.forEach((c) => { c.init = false; }); popEls.forEach((p) => p.el.remove()); popEls = [];
  }
  function ensureShowRig(bikeIdx) {
    const key = 'b' + bikeIdx;
    if (showKey === key && showRig) return;
    clearShow();
    showRig = new RacerRig({ body: TB.bikes[bikeIdx].body, suit: '#17b4e8', helmet: '#e8b923' }, true);
    scene.add(showRig.group); showKey = key;
  }

  // ---------------------------------------------------------------- camera
  const makeCam = (camera) => ({ camera, init: false, x: 0, y: 0, z: 0, th: 0, fov: 62, lag: 0, shakeT: 0, roll: 0, kick: 0, prevSp: 0, crashK: 0 });
  const cams = [makeCam(camera), makeCam(camera2)];
  const look = new THREE.Vector3(), pos = new THREE.Vector3();
  const fA = {}, fB = {}, fC = {};
  const FOLLOW = 9;
  function chaseCamera(cam, r, dt, speedK, shake, fovAdd = 0) {
    const camera = cam.camera;
    cam.crashK += ((r.crashT >= 0 && (r.crashT < 2 || r.health <= 0) ? 1 : 0) - cam.crashK) * (1 - Math.exp(-dt * 3));
    const trail = r.crashT >= 0 ? 0 : r.speed * S / FOLLOW;
    const zBack = Math.max(0, r.z - (4.4 + 1.5 * speedK + 2.2 * cam.crashK - trail) / S);
    R.frame(r.z, r.x, fA);
    R.frame(zBack, r.x * 0.78, fB);
    R.frame(r.z + (14 + (r.crashT >= 0 ? 0 : r.speed * S / 3.2)) / S, r.x * 0.5, fC);
    const k = cam.init ? 1 - Math.exp(-dt * FOLLOW) : 1, kz = cam.init ? 1 - Math.exp(-dt * 3.2) : 1;
    const tx = fB.x, ty = fB.y + 1.5 + 0.4 * speedK + 0.9 * cam.crashK, tz = fB.z;
    cam.x += (tx - cam.x) * k; cam.z += (tz - cam.z) * k; cam.y += (ty - cam.y) * k;
    const lx = fC.x, lz = fC.z, ly = fC.y + 1.35;
    if (!cam.init) { cam.lx = lx; cam.ly = ly; cam.lz = lz; }
    cam.lx += (lx - cam.lx) * kz; cam.ly += (ly - cam.ly) * k; cam.lz += (lz - cam.lz) * kz;
    cam.init = true;
    pos.set(cam.x, cam.y, cam.z);
    const tt = performance.now() / 1000, rough = r.crashT >= 0 ? 0 : Math.max(0, Math.min(1, (Math.abs(r.x) - 0.88) * 7));
    const buzz = speedK * speedK * (0.25 + 1.5 * rough) * (r.crashT >= 0 ? 0 : 1);
    if (shake > 0.3) pos.add(look.set((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(shake * 0.018));
    if (buzz > 0.02) pos.y += (Math.sin(tt * 47) * 0.6 + Math.sin(tt * 31.7 + 1) * 0.4) * 0.012 * buzz, pos.x += Math.sin(tt * 37.3 + 2) * 0.008 * buzz;
    camera.position.copy(pos);
    camera.lookAt(cam.lx, cam.ly, cam.lz);
    if (shake > 0.3) camera.rotateZ((Math.random() - 0.5) * shake * 0.0016);
    if (buzz > 0.02) camera.rotateZ(Math.sin(tt * 29 + 0.5) * 0.0025 * buzz);
    cam.roll += (r.lean - cam.roll) * (1 - Math.exp(-dt * 3.2));
    camera.rotateZ(-cam.roll * 0.04 - (r.lean - cam.roll) * 0.012);
    const acc = Math.max(0, Math.min(1, (r.speed - cam.prevSp) / Math.max(dt, 0.001) / 4000)); cam.prevSp = r.speed;
    cam.kick += ((r.throttle ? acc * 3.5 : 0) - cam.kick) * (1 - Math.exp(-dt * 2.5));
    const fov = fovAdd + 62 + 15 * speedK + (r.speed > r.maxSp * 0.95 ? 2 : 0) + cam.kick - Math.min(3, shake * 0.12);
    cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 4)); camera.fov = cam.fov; camera.updateProjectionMatrix();
    sc.follow(look.set(fA.x, fA.y, fA.z), camera.position, camera, speedK);
  }
  function orbitCamera(f, t, radius, height, aim, shiftX) {
    const a = t;
    pos.set(f.x + Math.cos(a) * radius, f.y + height, f.z + Math.sin(a) * radius);
    camera.position.copy(pos);
    look.set(f.x, f.y + aim, f.z);
    camera.lookAt(look);
    if (shiftX) { camera.updateMatrixWorld(); const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0); look.addScaledVector(right, shiftX); camera.lookAt(look); }
    camera.fov = 40; camera.updateProjectionMatrix();
    sc.follow(look.set(f.x, f.y, f.z), camera.position, camera, 0);
  }

  // ---------------------------------------------------------------- floating numbers + fx
  let popEls = [];
  const proj = new THREE.Vector3();
  function spawnPop(r, text, col) {
    const rig = rigs.find((x) => x.r === r); if (!rig) return;
    const el = document.createElement('div'); el.className = 'pop'; el.textContent = text; el.style.color = col; fxLayer.appendChild(el);
    const near = TB.humans.length > 1 && Math.abs(TB.humans[1].z - r.z) < Math.abs(TB.humans[0].z - r.z) ? 1 : 0;
    popEls.push({ el, rig, t: 0, dx: (Math.random() - 0.5) * 30, view: r.isPlayer ? r.idx : near });
  }
  function updatePops(dt) {
    for (let i = popEls.length - 1; i >= 0; i--) {
      const p = popEls[i]; p.t += dt;
      if (p.t > 1) { p.el.remove(); popEls.splice(i, 1); continue; }
      const duo = G.duo && TB.humans.length > 1, vw = duo ? window.innerWidth / 2 : window.innerWidth;
      p.rig.rig.group.getWorldPosition(proj); proj.y += 2.1 + p.t * 1.2; proj.project(cams[duo ? p.view : 0].camera);
      if (proj.z > 1 || (duo && Math.abs(proj.x) > 0.95)) { p.el.style.opacity = 0; continue; }
      const x = (proj.x * 0.5 + 0.5) * vw + (duo ? p.view * vw : 0) + p.dx, y = (-proj.y * 0.5 + 0.5) * window.innerHeight;
      const sc2 = 0.8 + Math.min(1, p.t * 6) * 0.5;
      p.el.style.transform = `translate(${x}px, ${y}px) translate(-50%,-50%) scale(${sc2})`; p.el.style.opacity = String(Math.max(0, 1 - p.t * p.t));
    }
  }
  const hitFlash = [0, 0];
  function drainFx() {
    for (const e of RC.fx) {
      if (e.type === 'pop') { spawnPop(e.r, e.text, e.col); if (!e.r.isPlayer && TB.player && TB.player.atkT > 0) touch.vibrate(14); }
      else if (e.type === 'hit' && e.r.isPlayer) { hitFlash[e.r.idx] = 0.5; touch.vibrate(30); }
      else if (e.type === 'crash') {
        if (e.r.isPlayer) { hitFlash[e.r.idx] = 0.8; touch.vibrate([60, 40, 90]); }
        const rigObj = rigs.find((x) => x.r === e.r);
        if (rigObj) {
          const gp = rigObj.rig.group.position;
          R.frame(e.r.z, e.r.x, frA);
          fx3d.burstSparks(gp.x, gp.y + 0.15, gp.z, Math.sin(frA.th), -Math.cos(frA.th), 26);
        }
      }
    }
    RC.fx.length = 0;
  }

  // ---------------------------------------------------------------- input
  const BLOCK = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Space: 1, Backspace: 1 };
  window.addEventListener('keydown', (e) => {
    TB.audio.init();
    if (!e.repeat) {
      if (e.code === 'KeyO') { cycleWeather(); return; }
      if (e.code === 'KeyU') { cycleQuality(); return; }
      if (e.code === 'KeyI') { toggleCompare(); return; }
    }
    if (BLOCK[e.code]) e.preventDefault();
    if (!e.repeat) TB.input.press(e.code);
  });
  window.addEventListener('keyup', (e) => TB.input.release(e.code));
  window.addEventListener('blur', () => { TB.input.down = {}; });
  window.addEventListener('pointerdown', () => TB.audio.init());

  // ---------------------------------------------------------------- start-up state
  TB.loadSave();
  let stopAt = parseFloat(param('stop', '0')) || 0, simTime = 0, auto = /[#&]auto/.test(hash);
  const autoStart = TB.debugStart(hash);
  if (!autoStart) {
    if (/garage/.test(hash)) { G.state = 'garage'; G.gsel = parseInt(param('bike', '0'), 10) || 0; }
    else if (/select/.test(hash)) { G.state = 'select'; G.sel = parseInt(param('sel', '0'), 10) || 0; }
  }
  const demoR = { z: 0, x: 0, speed: 9000, maxSp: 11000, lean: 0, wobPh: 0, wob: 0, flash: 0, shield: 0, crashT: -1, atkT: 0, atkDur: 0.3, atkType: 'punch', atkSide: 1 };
  let lastRace = -1, acc = 0;
  var lastTs = 0;
  const STEP = 1 / 60, MID_PARTS = 35, FAR_PARTS = 130;
  const ridgeStartZ = () => { for (let i = 0; i < R.N; i++) if (R.segs[i].ridge) return (i + 30) * C.segL; return 40000; };

  function menuWorldIdx() {
    if (G.state === 'title' || G.state === 'garage') return 0;
    if (G.state === 'select') return G.sel;
    if (G.state === 'results') return G.trackIdx;
    return G.trackIdx;
  }

  let prevDt = 0, perfHold = 3, wasDuo = false, saved = false, building = false, frameNo = 0, perfAcc = 0, perfN = 0, fpsAcc = 0, fpsN = 0;
  async function frame(ts) {
    requestAnimationFrame(frame);
    if (building) return;
    try {
      if (!lastTs) lastTs = ts;
      let dt = (ts - lastTs) / 1000; lastTs = ts; if (dt > 0.25) dt = 0.25;
      const racing = G.state === 'countdown' || G.state === 'race' || G.state === 'finishing' || G.state === 'paused';
      const want = racing ? G.trackIdx : menuWorldIdx();
      if (want !== curWorld || (racing && lastRace !== G.raceId)) {
        building = true;
        await ensureWorld(want);
        if (racing && lastRace !== G.raceId) { lastRace = G.raceId; setupRace(); }
        if (!racing) clearRigs();
        building = false; lastTs = 0; perfHold = 3; perfAcc = 0; perfN = 0; return;
      }
      const world = worlds[curWorld];
      const trackKind = TB.tracks[curWorld].env.kind;
      TB.world = world;
      if (!racing && rigs.length) clearRigs();
      touch.update();

      acc += dt;
      while (acc >= STEP) {
        if (!(stopAt && simTime >= stopAt)) {
          if (auto && TB.player && racing) {
            const p = TB.player, seg = R.segAt(p.z), err = -p.x - seg.curve * 0.03;
            TB.input.down.ArrowUp = true; TB.input.down.ArrowLeft = err < -0.06; TB.input.down.ArrowRight = err > 0.06;
            TB.input.down.ArrowDown = p.speed / p.maxSp > 0.8 && Math.abs(seg.curve) > 4;
          }
          TB.update(STEP); simTime += STEP;
        } else TB.input.edge = {};
        acc -= STEP;
      }
      drainFx();

      const t = performance.now() / 1000;
      ENV_STATE.uTime.value = t;
      const duo = racing && G.duo && TB.humans.length > 1;
      if (duo !== wasDuo) { wasDuo = duo; perfAcc = 0; perfN = 0; perfHold = 3; }
      sc.setSplit(duo); setFxHalf(duo);
      sc.renderer.info.reset();
      const canDraw = !document.body.classList.contains('portrait');

      if (racing) {
        const humans = TB.humans;
        const camPs = [cams[0].camera.position]; if (duo) camPs.push(cams[1].camera.position);
        const farFrom = (g) => { let d = 1e9; for (const c of camPs) d = Math.min(d, c.distanceToSquared(g.position)); return d < MID_PARTS * MID_PARTS ? 0 : d < FAR_PARTS * FAR_PARTS ? 1 : 2; };
        for (const x of rigs) {
          const r = x.r; R.frame(r.z, r.x, frA);
          const far = humans.every((h) => Math.abs(r.z - h.z) > 150000);
          x.rig.group.visible = !far; if (far) continue;
          x.rig.update(r, frA, dt); x.rig.far(farFrom(x.rig.group));
          if (x.rig.isFar < 2) fx3d.emitWheelFX(r, frA, trackKind, dt);
        }
        for (const x of trafficRigs) {
          const far = humans.every((h) => Math.abs(x.t.z - h.z) > 150000);
          x.rig.group.visible = !far; if (far) continue;
          R.frame(x.t.z, x.t.x, frB); x.rig.update(x.t, frB, dt); x.rig.far(farFrom(x.rig.group));
          if (x.rig.isFar < 1) fx3d.emitTrafficSpray(x.t, frB);
        }
        humans.forEach((h, i) => {
          const speedK = Math.min(1, h.speed / (C.baseMax * 1.2));
          chaseCamera(cams[i], h, dt, speedK, h.shake || 0, duo ? 12 : 0);
          // Dial back old 2D CSS speed lines when photoreal radial motion blur is active
          const cssOp = Math.max(0, Math.min(PERF.photoreal ? 0.25 : 0.9, (h.speed / h.maxSp - 0.75) * (PERF.photoreal ? 0.9 : 2.6)));
          speedfx[i].style.opacity = String(cssOp);
          if (duo) { world.update(cams[i].camera.position, t, true); if (canDraw) sc.renderView(i, cams[i].camera); }
        });
      } else {
        speedfx[0].style.opacity = '0';
        if (G.state === 'title' || G.state === 'garage') {
          ensureShowRig(G.state === 'garage' ? G.gsel : TB.save.bike);
          const z = ridgeStartZ(); R.frame(z, 0.25, frA);
          showRig.update(Object.assign(demoR, { speed: 0, lean: 0 }), frA, dt);
          if (G.state === 'title') orbitCamera(frA, 0.5 + G.t * 0.16, 6.6, 1.5, 0.8, -2.5);
          else orbitCamera(frA, 0.9 + G.t * 0.35, 5.2, 1.3, 1.05, 0);
        } else {
          ensureShowRig(TB.save.bike);
          const z0 = Math.min(R.finishZ * 0.25, 60000), span = Math.min(R.finishZ * 0.35, 110000);
          demoR.z = z0 + ((G.t * 26 / S) % span); demoR.x = 0.35 + Math.sin(G.t * 0.7) * 0.25; demoR.speed = 26 / S; demoR.maxSp = C.baseMax; demoR.lean = Math.cos(G.t * 0.7) * -0.35 + R.segAt(demoR.z).curve * 0.08; demoR.wobPh += dt * 28;
          R.frame(demoR.z, demoR.x, frA); showRig.update(demoR, frA, dt);
          fx3d.emitWheelFX(demoR, frA, trackKind, dt);
          if (!cams[0].init || Math.abs(cams[0].z) < 1e-9 || G.t < 0.05) cams[0].init = false;
          chaseCamera(cams[0], demoR, dt, 0.6, 0);
        }
      }

      fx3d.update(dt, camera.position, t, trackKind);
      updatePops(dt);
      for (let i = 0; i < 2; i++) { hitFlash[i] = Math.max(0, hitFlash[i] - dt * 1.6); hitfx[i].style.opacity = String(Math.min(0.85, hitFlash[i])); }
      if (!duo) {
        world.update(camera.position, t);
        if (canDraw) {
          sc.renderWaterReflection(camera);
          sc.render();
        }
      }

      // Live FPS badge & debug stats
      fpsAcc += dt; fpsN++;
      if (fpsAcc >= 0.5) {
        const fps = Math.round(fpsN / fpsAcc);
        if (fpsEl) fpsEl.textContent = fps + ' FPS';
        fpsAcc = 0; fpsN = 0;
      }
      if ((frameNo++ % 20) === 0) { const i = sc.renderer.info.render; window.__tbPerf = { calls: i.calls, tris: i.triangles, fps: Math.round(1 / Math.max(dt, 0.001)) }; }
      ui.update(G);

      // Gentle adaptive resolution safeguard (never disables quality features unless truly struggling)
      perfHold = Math.max(0, perfHold - dt);
      const stall = dt > 0.1 && prevDt < 0.06; prevDt = dt;
      if (perfHold > 0 || stall) { /* skip startup spike */ }
      else if (duo && !stopAt && !auto) {
        perfAcc += dt; perfN++;
        if (perfAcc > 1.5) { const avg = perfAcc / perfN; perfAcc = 0; perfN = 0; if (avg > 1 / 48) sc.lowerSplitRes(Math.max(0.75, Math.min(0.92, Math.sqrt(1 / 52 / avg)))); }
      } else if (!stopAt && !auto && PERF.tier !== 'ultra') {
        perfAcc += dt; perfN++;
        if (perfAcc > 1.8) { const avg = perfAcc / perfN; perfAcc = 0; perfN = 0; if (avg > 1 / 40 && sc.getRatio() > PERF.minRatio + 0.01) { const r = Math.max(PERF.minRatio, sc.getRatio() * Math.max(0.75, Math.min(0.92, Math.sqrt(1 / 48 / avg)))); sc.setRatio(r); } }
      }
      window.__tbStopTime = stopAt; if (stopAt && simTime >= stopAt) window.__tbDone = true;
      if (!window.__tbReady) { window.__tbReady = true; ui.hideBoot(); document.title = 'Bikerace — Photoreal Preview'; }
    } catch (e) { showError(e); building = false; }
  }
  requestAnimationFrame(frame);
}
main().catch((e) => { showError(e); });
