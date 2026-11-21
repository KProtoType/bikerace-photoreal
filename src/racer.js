// A "racer" is the shared data + behaviour of the player and every AI rival.
// Everybody (player and rivals) follows the SAME road rules: the same curve push, the same
// crash rules for roadside objects and traffic. The player just gets a little extra help.
(function () {
  'use strict';
  var TB = window.TB, C = TB.C, U = TB.util;
  var RC = (TB.racer = {});
  var CRASH_TIME = 2.4;
  RC.INVULN = 1.5;          // seconds of invulnerability after respawn
  RC.DOWN_TIME = 5;         // a player who runs out of health is down for this long (counted from the crash), then rides on
  RC.REVIVE_BARS = 2;       // ...with this many bars of the 10-bar health gauge (the red zone starts at 3.5 bars)
  RC.BARS = 10;
  RC.CURVE_PUSH = 1.0;      // how strongly curves push a bike toward the outside: take a hairpin flat out and you can't hold it
  RC.OFFROAD_X = 1.12;      // past the shoulder...
  RC.OFFROAD_SPEED = 0.5;   // ...faster than this share of top speed = you run off the road and crash
  RC.SHOULDER_M = 1.7;      // metres of flat gravel beyond the tarmac: nobody can ride further out than this
  RC.fx = [];               // events for the renderer: { type: 'pop'|'hit'|'crash', ... }

  // Furthest anyone can be from the road centre (1 = tarmac edge). Past the shoulder the ground is no longer flat.
  RC.maxX = function () { return 1 + RC.SHOULDER_M / (C.roadW * C.S); };

  // Health never comes back by itself. At zero a rival is out for good; a player is down for 5 s, then continues with 2 bars.
  RC.hurt = function (r, n) { r.health = Math.max(0, r.health - n); };

  // Same limit, tightened on the inside of hairpins so nobody pivots on the spot around the bend's centre. A rider caught outside it is eased back in.
  RC.clampX = function (r, seg, dt) {
    var m = RC.maxX(), hi = Math.min(m, TB.road.limitR[seg.index]), lo = -Math.min(m, TB.road.limitL[seg.index]);
    if (r.x > m) r.x = m; else if (r.x < -m) r.x = -m;
    if (r.x > hi) r.x = Math.max(hi, r.x - 1.6 * dt); else if (r.x < lo) r.x = Math.min(lo, r.x + 1.6 * dt);
  };

  RC.shake = function (r, v) { r.shake = Math.max(r.shake || 0, v); };

  RC.make = function (o) {
    return {
      name: o.name || '', isPlayer: !!o.isPlayer, z: 0, x: 0, speed: 0, vx: 0, steer: 0,
      health: o.hp || 100, maxHealth: o.hp || 100,
      suit: o.suit, body: o.body, helmet: o.helmet,
      lean: 0, wob: 0, wobPh: 0, flash: 0,
      atkT: 0, atkDur: 0.3, atkType: null, atkSide: 1, atkCd: 0, atkHit: true,
      crashT: -1, crashDir: 1, crashKind: 'wreck', shield: 0, pops: [],
      finished: false, finishTime: 0, hw: 0.1, kos: 0, maxSp: C.baseMax, crashes: 0, out: false, down: 0, guard: 0, touchCd: 0
    };
  };

  RC.emit = function (e) { if (RC.fx.length < 300) RC.fx.push(e); };
  RC.pop = function (r, text, col) { RC.emit({ type: 'pop', r: r, text: text, col: col }); };

  RC.crash = function (r, reason, dir) {
    if (r.crashT >= 0 || r.shield > 0) return false;
    if (!r.isPlayer && reason !== 'ko' && TB.rivals) { // too many falls on one stretch: this rider just saves it (slower, back toward the middle) so the road is never blocked by a pile-up
      if (TB.rivals.spotFull(r.z)) { r.speed *= 0.6; r.x -= (r.x > 0 ? 1 : -1) * 0.2; r.shield = 0.5; return false; }
      TB.rivals.noteFall(r.z);
    }
    r.crashT = 0; r.crashDir = dir || (Math.random() < 0.5 ? -1 : 1); r.crashKind = reason; r.atkT = 0; r.vx = 0; r.crashes++;
    RC.emit({ type: 'crash', r: r, speed: r.speed });
    if (r.isPlayer) { RC.shake(r, 22); TB.audio.crash(); TB.hud.toast(r.label + (reason === 'ko' ? 'KNOCKED OFF!' : reason === 'offroad' ? 'OFF THE ROAD!' : 'WIPEOUT!'), '#ff5a3c'); }
    else if (TB.humans && TB.humans.some(function (h) { return Math.abs(r.z - h.z) < 6000; })) TB.audio.crash();
    return true;
  };

  // Where a downed player gets back on: on the tarmac (never the shoulder, a hairpin's inside edge or a wall), in a lane with no traffic or rider right there.
  RC.safeX = function (r) {
    var seg = TB.road.segAt(r.z), lim = Math.max(0.1, Math.min(0.6, TB.road.limitR[seg.index], TB.road.limitL[seg.index])), best = U.clamp(r.x, -lim, lim), bd = 9, i, c;
    var cand = [best, -0.5, -0.25, 0, 0.25, 0.5].map(function (x) { return U.clamp(x, -lim, lim); }), probe = { z: r.z, x: 0, hw: r.hw };
    function free(x) {
      probe.x = x;
      if (TB.traffic.hit(probe, 700, 2600)) return false;
      var l = (TB.rivals ? TB.rivals.list : []), j;
      for (j = 0; j < l.length; j++) if (l[j].health > 0 && Math.abs(l[j].z - r.z) < 700 && Math.abs(l[j].x - x) < 0.3) return false;
      return true;
    }
    for (i = 0; i < cand.length; i++) { c = cand[i]; if (free(c) && Math.abs(c - cand[0]) < bd) { bd = Math.abs(c - cand[0]); best = c; } } // the free spot nearest to where they went down
    return best; // everywhere is busy: the blinking shield covers the first moments
  };

  RC.respawn = function (r) {
    r.crashT = -1;
    r.speed = r.isPlayer ? 1500 : 1800;
    r.x = r.isPlayer ? RC.safeX(r) : U.clamp(r.x, -0.6, 0.6);
    if (r.isPlayer && r.health <= 0) { // got up after the count: 2 bars, still red
      r.health = Math.round(r.maxHealth * RC.REVIVE_BARS / RC.BARS); TB.hud.toast(r.label + 'BACK UP', '#ffd23f');
    }
    r.down = 0;
    r.shield = RC.INVULN; r.wob = 0; r.vx = 0; r.lean = 0;
    RC.emit({ type: 'respawn', r: r });
  };

  // timers shared by everyone; returns false while crashed (caller skips driving)
  RC.tick = function (r, dt) {
    if (r.flash > 0) r.flash -= dt;
    if (r.atkCd > 0) r.atkCd -= dt;
    if (r.shield > 0) r.shield -= dt;
    if (r.guard > 0) r.guard -= dt;
    if (r.touchCd > 0) r.touchCd -= dt;
    if (r.atkT > 0) r.atkT -= dt;
    r.wob *= Math.exp(-4 * dt); r.wobPh += dt * 28;
    r.vx *= Math.exp(-5 * dt);
    if (r.health <= 0 && r.crashT < 0) { r.shield = 0; RC.crash(r, 'ko', 1); } // (safety net: zero health always means a crash)
    if (r.crashT >= 0) {
      r.crashT += dt;
      r.speed *= Math.exp(-1.7 * dt);
      r.z += r.speed * dt;
      if (r.health <= 0) { // the wreck slides to the roadside. A rival stays there for good; a player is down for 5 s (r.down counts it) and then gets up
        r.x += U.clamp((r.x >= 0 ? 1 : -1) * RC.maxX() - r.x, -0.6 * dt, 0.6 * dt);
        if (r.isPlayer) { r.down = Math.max(0, RC.DOWN_TIME - r.crashT); if (r.crashT >= RC.DOWN_TIME) RC.respawn(r); }
        else if (r.crashT >= CRASH_TIME) r.out = true;
      } else if (r.crashT >= CRASH_TIME) RC.respawn(r);
      return false;
    }
    return true;
  };

  // Sideways push of a curve (same formula for everyone). Positive curve pushes toward -x.
  RC.curvePush = function (r, dt, seg, handle) {
    var sp = r.speed / r.maxSp;
    return dt * 2 * sp * sp * seg.curve * 0.26 * RC.CURVE_PUSH * (seg.sharp || 1) / (handle || 1);
  };

  // Roadside objects (shared by player and rivals). Grazing one at the very edge mostly just slows you down.
  // A touch slows you once and always moves you back toward the road, whichever side of the object you are on: nobody can get stuck against one.
  RC.hitScenery = function (r, oz) {
    if (Math.abs(r.x) < 0.88 || r.crashT >= 0) return;
    var s = TB.road.sceneryHit(r, oz, r.z);
    if (!s) { r.touching = null; return; }
    var overlap = (s.hw + r.hw) - Math.abs(r.x - s.off), first = r.touching !== s, sharp = TB.road.segAt(r.z).sharp > 1.5;
    r.touching = s;
    if (overlap < 0.05 || r.speed < (sharp ? 3000 : 3500) || r.shield > 0) { // graze, slow enough, or just restarted
      if (first && r.touchCd <= 0) { // (at most once every 0.6 s: a guardrail is many sections, and each must not count as a new knock)
        r.touchCd = 0.6; r.speed *= r.shield > 0 ? 0.7 : 0.5;
        if (r.isPlayer) { TB.audio.thud(); RC.shake(r, 4); }
      }
      r.x += (r.x > 0 ? -1 : 1) * 0.08;
      return;
    }
    RC.crash(r, 'scenery', r.x > s.off ? 1 : -1);
    RC.hurt(r, 12);
  };

  // Leaving the road (shared): the shoulder only slows you, but running wide past it at speed is a crash.
  // On the ridge there is nothing but a drop past the edge, so it's a crash at a much lower speed.
  RC.checkOffRoad = function (r) {
    if (r.crashT >= 0 || r.shield > 0 || Math.abs(r.x) < RC.OFFROAD_X) return;
    var sg = TB.road.segAt(r.z), lim = sg.ridge ? 0.25 : sg.sharp > 1.5 ? 0.27 : RC.OFFROAD_SPEED; // the ridge and hairpins are far less forgiving
    if (r.speed > r.maxSp * lim) {
      RC.crash(r, 'offroad', r.x > 0 ? 1 : -1);
      RC.hurt(r, 10);
    }
  };

  // Traffic contact (shared). Only a genuinely hard hit (big speed gap AND big overlap) wrecks you.
  RC.trafficContact = function (r, t) {
    var overlap = (t.hw + r.hw) - Math.abs(t.x - r.x), hard = (r.speed - t.speed > 3000) && overlap > 0.55 * (t.hw + r.hw);
    if (hard && r.shield <= 0) {
      RC.crash(r, 'traffic', r.x >= t.x ? 1 : -1);
      RC.hurt(r, 15);
      return true;
    }
    r.speed = Math.min(r.speed, t.speed * 0.92); r.x += (r.x >= t.x ? 1 : -1) * 0.05;
    return false;
  };
})();
