// The player's bike: acceleration, braking, drifting in curves, off-road slowdown, crashes.
(function () {
  'use strict';
  var TB = window.TB, C = TB.C, U = TB.util, RC = TB.racer;
  var P = (TB.playerCtl = {});

  var LOOK = [{ suit: '#2b6a86', helmet: '#c99a2a' }, { suit: '#9a3f24', helmet: '#d8d4cc' }];

  // idx: 0 = player 1, 1 = player 2. duo: two-player race (names and messages say which player).
  P.create = function (bike, idx, duo) {
    idx = idx || 0;
    var p = RC.make({ name: duo ? 'P' + (idx + 1) : 'YOU', isPlayer: true, suit: LOOK[idx].suit, body: bike.body, helmet: LOOK[idx].helmet, hp: 100 });
    p.bike = bike; p.idx = idx; p.label = duo ? 'P' + (idx + 1) + ' ' : ''; p.place = 9;
    p.maxSp = C.baseMax * 0.92 * bike.top;
    return p;
  };

  // The numbers the garage shows, worked out from the same formulas the bike uses when riding (flat road): top speed, 0-60 mph time, and the fastest hairpin it can hold with full steering.
  P.stats = function (bike) {
    var maxSp = C.baseMax * 0.92 * bike.top, v = 0, t = 0, t60 = 0, lo = 0, hi = 1, i, sp;
    while (t < 30 && !t60) { v = Math.min(maxSp * 1.04, v + (maxSp / 5.5) * bike.accel * (1 - 0.55 * (v / maxSp) * (v / maxSp)) * 0.01); t += 0.01; if (v * C.mphK >= 60) t60 = t; }
    for (i = 0; i < 30; i++) { // fastest share of top speed where steering (2.3 handle (.35 + .65 sp)) still beats the hairpin's push (2 sp^2 x 5.7 bend x 0.26 x 3.5 sharpness / handle)
      sp = (lo + hi) / 2;
      if (2.3 * bike.handle * (0.35 + 0.65 * sp) >= 2 * sp * sp * 5.7 * 0.26 * RC.CURVE_PUSH * 3.5 / bike.handle) lo = sp; else hi = sp;
    }
    return { top: Math.round(maxSp * 1.04 * C.mphK), t60: Math.round(t60 * 100) / 100, hairpin: Math.round(lo * maxSp * C.mphK) };
  };

  // c = { up, down, left, right }
  P.update = function (p, dt, c, racing) {
    if (!RC.tick(p, dt)) return;
    var bike = p.bike, seg = TB.road.segAt(p.z), maxSp = p.maxSp, sp = p.speed / maxSp;
    var offroad = Math.abs(p.x) > 1.0;
    p.throttle = 0;
    if (racing && !p.finished) {
      if (c.up) {
        p.throttle = 1;
        p.speed += (maxSp / 5.5) * bike.accel * (1 - 0.55 * sp * sp) * dt;
      } else p.speed -= (maxSp / 14) * dt;
      if (c.down) p.speed -= (maxSp / 2.2) * dt;
    } else if (p.finished) p.speed -= (maxSp / 3) * dt;
    if (offroad && p.speed > maxSp * 0.3) p.speed -= (maxSp / 1.6) * dt;
    var slope = (seg.p2.world.y - seg.p1.world.y) / C.segL; // uphill slows, downhill helps
    p.speed -= U.clamp(slope * 2000, -900, 900) * dt * (racing ? 1 : 0);
    p.speed = U.clamp(p.speed, 0, maxSp * 1.04);

    sp = p.speed / maxSp;
    var dir = (c.right ? 1 : 0) - (c.left ? 1 : 0);
    if (!racing || p.finished) dir = 0;
    var oz = p.z;
    p.x += dir * dt * 2.3 * bike.handle * (0.35 + 0.65 * sp);
    var push = RC.curvePush(p, dt, seg, bike.handle);
    p.x -= push; // no steering assist: you have to steer (and brake) through curves yourself
    p.x += p.vx * dt;
    RC.clampX(p, TB.road.segAt(p.z), dt);
    p.steer = dir;
    var target = dir * 0.8 - seg.curve * sp * 0.1;
    p.lean += (target - p.lean) * Math.min(1, dt * 8);
    p.z += p.speed * dt;
    if (p.z > TB.road.length - 4 * C.segL) p.z = TB.road.length - 4 * C.segL;
    RC.hitScenery(p, oz);
    RC.checkOffRoad(p);
  };
})();
