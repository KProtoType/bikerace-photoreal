// Game flow (no drawing): save data, input state, race set-up and the fixed-timestep simulation.
(function () {
  'use strict';
  var TB = window.TB, C = TB.C, U = TB.util;
  var R = TB.road, RC = TB.racer, K = TB.combat, V = TB.rivals, T = TB.traffic;
  var SAVE_KEY = 'throttleBrawl.previewSave.v1';

  // ------------------------------------------------------------------ save data
  function defaultSave() { return { cash: 9500, bikes: [1, 1, 1, 1], bike: 2, unlocked: [1, 1, 1], level: 0, levels: [1, 1, 1], podium: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], best: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] }; }
  TB.save = defaultSave();
  // Keyboard auto-gas (computers): default OFF, kept under its own key so a phone's saved AUTO-GAS choice is never touched.
  var KB_KEY = 'throttleBrawl.autoGasKb';
  TB.autoGasKb = false;
  TB.setAutoGasKb = function (v) { TB.autoGasKb = !!v; try { window.localStorage.setItem(KB_KEY, v ? '1' : '0'); } catch (e) { /* ignore */ } };
  TB.autoGasActive = function () { return TB.autoGasKb && !(TB.touch && TB.touch.on); }; // phones have their own switch (touch.js)
  TB.toggleAutoGasKb = function () {
    if (TB.touch && TB.touch.on) return false;
    TB.setAutoGasKb(!TB.autoGasKb); TB.audio.menu(); return true;
  };
  TB.loadSave = function () {
    try { var kv = window.localStorage.getItem(KB_KEY); if (kv !== null) TB.autoGasKb = kv === '1'; } catch (e) { /* no storage */ }
    try {
      var raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      var s = JSON.parse(raw), d = defaultSave(), i, l;
      if (typeof s.cash === 'number' && s.cash >= 0) d.cash = Math.floor(s.cash);
      for (i = 0; i < 4; i++) if (s.bikes && s.bikes[i]) d.bikes[i] = 1;
      for (i = 0; i < 3; i++) if (s.unlocked && s.unlocked[i]) d.unlocked[i] = 1;
      for (l = 0; l < 3; l++) {
        if (s.levels && s.levels[l]) d.levels[l] = 1;
        for (i = 0; i < 3; i++) {
          if (s.podium && s.podium[l] && s.podium[l][i]) d.podium[l][i] = 1;
          if (s.best && Array.isArray(s.best[l]) && typeof s.best[l][i] === 'number') d.best[l][i] = s.best[l][i];
        }
      }
      if (s.best && typeof s.best[0] === 'number') for (i = 0; i < 3; i++) if (typeof s.best[i] === 'number') d.best[0][i] = s.best[i]; // saves from before difficulty levels
      if (typeof s.level === 'number' && d.levels[s.level]) d.level = s.level;
      if (typeof s.bike === 'number' && d.bikes[s.bike]) d.bike = s.bike;
      TB.save = d;
    } catch (e) { /* no storage: just play without saving */ }
  };
  TB.writeSave = function () {
    try { window.localStorage.setItem(SAVE_KEY, JSON.stringify(TB.save)); } catch (e) { /* ignore */ }
  };

  // ------------------------------------------------------------------ input
  var KEYMAP = {
    up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
    punchL: ['KeyZ', 'KeyJ'], punchR: ['KeyX', 'KeyK'], kick: ['KeyC', 'KeyL'],
    pause: ['KeyP', 'Escape'], confirm: ['Enter', 'NumpadEnter'], back: ['Escape', 'Backspace'],
    space: ['Space'], quit: ['KeyQ']
  };
  var I = (TB.input = { down: {}, edge: {} });
  I.held = function (n) { var k = KEYMAP[n]; for (var i = 0; i < k.length; i++) if (I.down[k[i]]) return true; return false; };
  I.hit = function (n) { var k = KEYMAP[n]; for (var i = 0; i < k.length; i++) if (I.edge[k[i]]) return true; return false; };
  I.hitCode = function (c) { return !!I.edge[c]; };
  I.press = function (code) { if (!I.down[code]) I.edge[code] = true; I.down[code] = true; };
  I.release = function (code) { I.down[code] = false; };

  // ------------------------------------------------------------------ state
  var G = (TB.G = {
    state: 'title', t: 0, sel: 0, gsel: 0, trackIdx: 0, builtIdx: -1, duo: false, ending: false,
    cd: 3, lastCd: 4, raceTime: 0, place: 9, total: 9, koCash: 0, fin: 0, goFlash: 0,
    msg: '', msgT: 0, results: null, prevState: 'race', bump: 0
  });

  // Two players share one keyboard, so each gets their own half of it. Phones are single player only.
  TB.canDuo = function () { return !!TB.duoAllowed && !(TB.touch && TB.touch.on); };
  var DUO_KEYS = [
    { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', punchL: 'KeyZ', punchR: 'KeyX', kick: 'KeyC' },
    { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', punchL: 'KeyJ', punchR: 'KeyK', kick: 'KeyL' }
  ];
  function heldBy(i, n) { return G.duo ? !!I.down[DUO_KEYS[i][n]] : I.held(n); }
  function hitBy(i, n) { return G.duo ? !!I.edge[DUO_KEYS[i][n]] : I.hit(n); }
  function others(h) { return TB.humans.filter(function (o) { return o !== h; }).concat(V.list); }

  TB.startRace = function (idx) {
    var track = TB.tracks[idx], bike = TB.bikes[TB.save.bike], duo = G.duo && TB.canDuo();
    G.duo = duo;
    R.build(track); G.builtIdx = idx; G.trackIdx = idx;
    var p = (TB.player = TB.playerCtl.create(bike, 0, duo)), s = V.slot(7);
    p.x = s.x; p.z = s.z;
    TB.humans = [p];
    if (duo) { var p2 = TB.playerCtl.create(bike, 1, true), s2 = V.slot(8); p2.x = s2.x; p2.z = s2.z; TB.humans.push(p2); }
    V.init(track, TB.levels[TB.save.level], duo); T.init(track, R.finishZ);
    G.raceId = (G.raceId || 0) + 1;
    G.koCash = 0; G.ending = false; G.raceTime = 0; G.cd = 3; G.lastCd = 4; G.fin = 0; G.goFlash = 0; G.place = 9; G.total = V.list.length + TB.humans.length;
    TB.hud.clear(); RC.fx.length = 0;
    G.state = 'countdown';
  };

  function ranking(p) {
    var n = 1, i, l = others(p), r;
    for (i = 0; i < l.length; i++) { r = l[i]; if (r.finished || r.z > p.z) n++; }
    return n;
  }

  function finishRace() {
    var i, r, entries = [], humans = TB.humans, level = TB.levels[TB.save.level];
    for (i = 0; i < V.list.length; i++) {
      r = V.list[i];
      entries.push({ name: r.name, suit: r.suit, fin: r.finished, out: r.health <= 0, t: r.finishTime, z: r.z });
    }
    humans.forEach(function (h) { entries.push({ name: h.name, isPlayer: true, who: h, suit: h.suit, fin: h.finished, out: false, t: h.finishTime, z: h.z }); });
    entries.sort(function (a, b) {
      if (a.fin && b.fin) return a.t - b.t;
      if (a.fin) return -1;
      if (b.fin) return 1;
      if (a.out !== b.out) return a.out ? 1 : -1; // anyone still riding is ahead of anyone who is out
      return b.z - a.z;
    });
    var save = TB.save, idx = G.trackIdx, players = [], best = 99, bestTime = 0, prize = 0, kos = 0;
    entries.forEach(function (e, n) {
      if (!e.isPlayer) return;
      var h = e.who, pr = Math.round((TB.prizes[n] || 0) * level.prize);
      players[h.idx] = { name: h.name, place: n + 1, prize: pr, kos: h.kos, time: h.finishTime };
      prize += pr; kos += h.kos;
      if (n + 1 < best) best = n + 1;
      if (!bestTime || h.finishTime < bestTime) bestTime = h.finishTime;
    });
    var lv = save.level, one = players[0];
    var res = { duo: G.duo, players: players, place: best, prize: prize, koCash: G.koCash, kos: kos, time: one.time, order: entries, best: false, unlocked: null, levelUp: null };
    save.cash += prize + G.koCash;
    if (bestTime && (!save.best[lv][idx] || bestTime < save.best[lv][idx])) { if (save.best[lv][idx]) res.best = true; save.best[lv][idx] = bestTime; }
    if (best <= 3) {
      save.podium[lv][idx] = 1;
      if (idx + 1 < TB.tracks.length && !save.unlocked[idx + 1]) { save.unlocked[idx + 1] = 1; res.unlocked = TB.tracks[idx + 1].name; }
      if (lv + 1 < TB.levels.length && !save.levels[lv + 1] && save.podium[lv].every(function (v) { return v; })) { save.levels[lv + 1] = 1; res.levelUp = TB.levels[lv + 1].name; }
    }
    TB.writeSave();
    G.results = res; G.place = res.place;
    TB.audio.engine(0, 0, false);
    G.state = 'results';
  }

  TB.finishRace = finishRace; // (also used by the debug shortcut #results)

  // ------------------------------------------------------------------ one frame of racing
  function raceUpdate(dt) {
    var p = TB.player, st = G.state, c, i, r, t;
    if (st === 'paused') {
      TB.audio.engine(0, 0, false);
      if (I.hitCode('KeyV')) TB.toggleAutoGasKb();
      if (I.hit('pause') || I.hit('confirm')) G.state = G.prevState;
      else if (I.hit('quit')) { G.state = 'select'; G.sel = G.trackIdx; }
      return;
    }
    if (I.hit('pause')) { G.prevState = st; G.state = 'paused'; return; }

    if (st === 'countdown') {
      G.cd -= dt;
      var n = Math.ceil(G.cd);
      if (n !== G.lastCd && n > 0) { G.lastCd = n; TB.audio.beep(440, 0.15, 0.25); }
      if (G.cd <= 0) { G.state = st = 'race'; G.raceTime = 0; G.goFlash = 0.9; TB.audio.go(); }
    }
    if (G.goFlash > 0) G.goFlash -= dt;
    var racing = st === 'race';

    var humans = TB.humans;
    humans.forEach(function (h, n) {
      c = { up: heldBy(n, 'up'), down: heldBy(n, 'down'), left: heldBy(n, 'left'), right: heldBy(n, 'right') };
      if (TB.autoGasActive()) c.up = !c.down; // auto-gas: the throttle is held for you, and braking (down / S) always wins over it
      TB.playerCtl.update(h, dt, c, racing);
      if (racing && h.crashT < 0 && !h.finished) {
        if (hitBy(n, 'punchL')) K.start(h, 'punch', -1);
        if (hitBy(n, 'punchR')) K.start(h, 'punch', 1);
        if (hitBy(n, 'kick')) { t = K.nearest(h, others(h)); K.start(h, 'kick', t ? (t.x < h.x ? -1 : 1) : 1); }
      }
      K.update(h, others(h));
    });
    V.update(dt, G, humans);
    T.update(dt, R.finishZ);

    // players vs traffic, rivals and each other
    humans.forEach(function (h) {
      if (h.crashT >= 0) return;
      t = T.hit(h, 120, 200);
      if (t) {
        if (!RC.trafficContact(h, t) && G.bump <= 0) { TB.audio.thud(); RC.shake(h, 5); G.bump = 0.3; }
      }
      var l = others(h);
      for (i = 0; i < l.length; i++) {
        r = l[i];
        if (r.crashT >= 0) continue;
        if (Math.abs(r.z - h.z) < 160 && Math.abs(r.x - h.x) < 0.17) {
          var s = h.x >= r.x ? 1 : -1;
          h.x += s * 0.025; r.x -= s * 0.025;
          if (h.z < r.z) h.speed = Math.min(h.speed, r.speed);
          if (G.bump <= 0) { TB.audio.thud(); RC.shake(h, 3); G.bump = 0.3; }
        }
      }
    });
    if (G.bump > 0) G.bump -= dt;

    if (racing || st === 'finishing') G.raceTime += dt;
    humans.forEach(function (h) {
      if (h.finished) return;
      h.place = ranking(h);
      if (h.z >= R.finishZ) { // (a player who ran out of health is only down for a while, so everyone finishes)
        h.finished = true; h.finishTime = G.raceTime;
        TB.audio.go(); TB.hud.toast(h.label + 'FINISHED  ' + U.fmtTime(G.raceTime), '#ffd23f');
      }
    });
    G.place = p.place;
    if (!G.ending && humans.every(function (h) { return h.finished; })) { // the race ends when every player has finished
      G.ending = true; G.fin = 3.2; G.state = 'finishing';
    } else if (G.ending) {
      G.fin -= dt;
      if (G.fin <= 0) finishRace();
    }

    var loud = humans.reduce(function (a, h) { return h.crashT < 0 && h.speed / h.maxSp > a.speed / a.maxSp ? h : a; }, p); // one engine sound: the faster bike
    TB.audio.engine(loud.speed / loud.maxSp, loud.throttle || 0, loud.crashT < 0 && G.state !== 'finishing');
    TB.audio.music(true, R.track.musicRoot);
  }

  TB.update = function (dt) {
    G.t += dt;
    if (TB.humans) TB.humans.forEach(function (h) { h.shake = (h.shake || 0) * Math.exp(-6 * dt); });
    TB.hud.tick(dt);
    if (I.hitCode('KeyM')) TB.audio.toggleMute();
    switch (G.state) {
      case 'countdown': case 'race': case 'finishing': case 'paused': raceUpdate(dt); break;
      default: TB.menus.update(dt, I);
    }
    I.edge = {};
  };

  // Developer shortcut: index.html#race=1&z=0.6 starts race 1 (0..2) 60% of the way along the track.
  TB.debugStart = function (hash) {
    var m = /race=(\d)/.exec(hash || '');
    if (!m) return false;
    TB.save.unlocked = [1, 1, 1];
    var ml = /level=(\d)/.exec(hash); if (ml) { TB.save.levels = [1, 1, 1]; TB.save.level = Math.min(2, +ml[1]); }
    if (/[#&]duo/.test(hash)) G.duo = true;
    TB.startRace(Math.min(2, +m[1]));
    var mz = /z=([\d.]+)/.exec(hash), mf = /find=(ridge|hairpin)/.exec(hash), mo = /off=(\d+)/.exec(hash);
    if (mz || mf) {
      var p = TB.player, nz = mz ? R.finishZ * Math.min(0.97, +mz[1]) : 0, d, i;
      if (mf) { // jump to the first ridge segment, or the first hairpin after the given z
        var from = Math.floor(nz / C.segL);
        for (i = from; i < R.N - 400; i++) if (mf[1] === 'ridge' ? R.segs[i].ridge : Math.abs(R.segs[i].curve) > 5.3) break;
        nz = Math.max(0, (i - 25 + (mo ? +mo[1] : 0)) * C.segL);
      }
      d = nz - p.z;
      TB.humans.forEach(function (h) { h.z += d; h.speed = 7000; }); G.cd = 0.01;
      for (i = 0; i < V.list.length; i++) { V.list[i].z += d; V.list[i].speed = 7000; }
      for (i = 0; i < T.list.length; i++) T.list[i].z += d;
    }
    return true;
  };
})();
