// AI rivals: follow the road, dodge traffic, change lanes, chase the player and throw punches.
(function () {
  'use strict';
  var TB = window.TB, C = TB.C, U = TB.util, RC = TB.racer, K = TB.combat;
  var V = (TB.rivals = { list: [] });
  var COLS = [-0.55, 0, 0.55];
  V.CATCHUP = 0.16;  // extra top speed the quickest rival gets when far behind a player: keeps the fight alive for the whole race
  V.BOOST_CAP = 0.15; // ...and however much faster the player's bike is, a chasing rival never gets more than this much extra: an upgrade must keep paying off
  // Falls: a rival goes down when the road asks more of them than they can give. load = (share of top speed)^2 x (bend sharpness + hill steepness);
  // each rider can take TOL x (0.7 + 0.6 skill). Weak riders brake less for what is coming, so they reach that limit far more often.
  V.TOL = 3.4; V.FALL_RATE = 1.5; V.HILL_K = 6; V.SLIP = 0.06;
  V.SPOT_M = 6000; V.SPOT_MAX = 2; // at most this many falls per 6000 units of road per race, and not two in a row within 2500 units / 4 s: a pile-up must not block the road
  V.HAIRPIN_SPEED = 0.33; // share of top speed rivals slow to for a hairpin
  V.START_TRUCE = 2; // seconds after GO before rivals start swinging: everyone starts bunched up, and lost health never comes back

  // Start grid: 9 slots (3 rows of 3). The player gets slot 7.
  V.slot = function (i) { return { x: COLS[i % 3], z: 2400 - Math.floor(i / 3) * 450 }; };

  // level: difficulty (see TB.levels). duo: player 2 takes slot 8, so one rival sits out.
  // Road difficulty per segment: bend = |curve| x hairpin factor; hill = how steep the way down is, plus how sharply a crest drops away.
  function roadLoads() {
    var R = TB.road, n = R.N, i, k, sl = new Float32Array(n);
    V.cd = new Float32Array(n); V.hd = new Float32Array(n);
    for (i = 0; i < n; i++) { var sg = R.segs[i]; sl[i] = (sg.p2.world.y - sg.p1.world.y) / C.segL; V.cd[i] = Math.abs(sg.curve) * sg.sharp; }
    for (i = 0; i < n; i++) V.hd[i] = Math.max(0, -sl[i]) + 1.5 * Math.max(0, sl[Math.max(0, i - 5)] - sl[Math.min(n - 1, i + 5)]);
  }
  V.noteFall = function (z) { var k = Math.floor(z / V.SPOT_M); V.spots[k] = (V.spots[k] || 0) + 1; V.lastFall = { z: z, t: V.clock }; };
  V.spotFull = function (z) {
    if ((V.spots[Math.floor(z / V.SPOT_M)] || 0) >= V.SPOT_MAX) return true;
    return !!V.lastFall && V.clock - V.lastFall.t < 4 && Math.abs(z - V.lastFall.z) < 2500;
  };

  V.init = function (track, level, duo) {
    roadLoads(); V.spots = {}; V.lastFall = null; V.clock = 0;
    var tier = track.rival || { skill: 0.6, aggr: 1, dmg: 1, hp: 1 };
    var rng = U.rng(track.seed + 99), slots = duo ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4, 5, 6, 8], i, j, tmp;
    for (i = slots.length - 1; i > 0; i--) { j = Math.floor(rng() * (i + 1)); tmp = slots[i]; slots[i] = slots[j]; slots[j] = tmp; }
    V.list = [];
    for (i = 0; i < slots.length; i++) {
      var d = TB.roster[i], r = RC.make({ name: d.name, suit: d.suit, body: d.body, helmet: d.helmet, hp: Math.round(d.hp * level.hp * tier.hp) });
      var s = V.slot(slots[i]);
      r.x = s.x; r.z = s.z; r.targetX = s.x;
      r.aggr = d.aggr * tier.aggr; r.pace = d.pace; r.hunt = 0; r.laneCd = 0; r.isRival = true;
      r.skill = U.clamp(tier.skill + level.skill + (d.pace - 0.93) * 1.2 + (rng() - 0.5) * 0.14, 0.2, 1); // 0..1: the track's riders + the level + who this rider is
      r.slip = 0; // slip > 0: the rider lets go of the bars for a moment (a mistake)
      r.maxSp = C.baseMax * 0.93 * d.pace * track.diff * level.pace;
      r.dmgK = level.dmg * tier.dmg; r.levelSp = C.baseMax * 0.93 * track.diff * level.pace;
      r.catchup = 0.04 + V.CATCHUP * U.clamp((d.pace - 0.86) / 0.13, 0, 1); // the quick riders chase hardest, so the pack strings out behind them
      V.list.push(r);
    }
  };

  // the human this rival cares about: the nearest one still racing (or the first, if nobody is)
  function target(r, humans) {
    var best = null, bd = 1e18, i;
    for (i = 0; i < humans.length; i++) { var h = humans[i], dz = Math.abs(h.z - r.z); if (!h.finished && h.health > 0 && dz < bd) { bd = dz; best = h; } }
    return best || humans[0];
  }

  function obstacles(r, humans) {
    var out = TB.traffic.list.slice(), i;
    for (i = 0; i < V.list.length; i++) if (V.list[i] !== r && V.list[i].health > 0) out.push(V.list[i]); // wrecks at the roadside are not in the way
    for (i = 0; i < humans.length; i++) if (!(humans[i].health <= 0 && humans[i].crashT >= 0)) out.push(humans[i]); // a downed player lies at the roadside too
    return out;
  }
  function blocked(r, obs, x, from, to) {
    for (var i = 0; i < obs.length; i++) {
      var o = obs[i], dz = o.z - r.z;
      if (dz > from && dz < to && Math.abs(o.x - x) < o.hw + r.hw + 0.1) return o;
    }
    return null;
  }

  // The road asks more than the rider can give: a bend or hairpin taken too fast, or a steep drop / crest. Chance per second grows with how far over the limit they are.
  function fallCheck(r, seg, dt) {
    var cd = V.cd[seg.index], hd = V.HILL_K * Math.max(0, V.hd[seg.index] - 0.25), sp = r.speed / r.maxSp, load = sp * sp * (cd + hd), tol = V.TOL * (0.7 + 0.6 * r.skill);
    if (load <= tol || Math.random() > V.FALL_RATE * (load / tol - 1) * dt) return;
    var kind = hd > cd ? 'hill' : seg.sharp > 1.5 ? 'hairpin' : 'bend';
    if (RC.crash(r, kind, seg.curve >= 0 ? -1 : 1)) RC.hurt(r, 10);
  }

  V.update = function (dt, G, humans) {
    var racing = G.state === 'race' || G.state === 'finishing', finishZ = TB.road.finishZ, i, j;
    var lanes = TB.road.track.lanes, cand = [], k;
    if (racing) V.clock += dt;
    for (k = 0; k < lanes.length; k++) { cand.push(lanes[k]); if (k < lanes.length - 1) cand.push((lanes[k] + lanes[k + 1]) / 2); }
    for (i = 0; i < V.list.length; i++) {
      var r = V.list[i];
      if (!RC.tick(r, dt)) continue;
      if (!racing) continue;
      var player = target(r, humans), seg = TB.road.segAt(r.z), obs = obstacles(r, humans), ac = Math.abs(seg.curve);
      // rivals read the road ahead and brake for what is coming (fast riders brake a little later)
      var ahead2 = TB.road.segAt(r.z + 2600), ac2 = Math.max(ac, Math.abs(ahead2.curve));
      var hairpin = seg.sharp > 1.2 || ahead2.sharp > 1.2 || TB.road.segAt(r.z + r.speed * 0.9).sharp > 1.2; // the hairpin warning is read further ahead: there is a lot of speed to lose
      var dzP = r.z - player.z, chasing = !player.finished && player.health > 0 ? U.clamp(-dzP / 7000, 0, 1) : 0;
      // a player whose bike outclasses this level gets chased harder (more risk in the bends, harder acceleration): an upgrade should make a level easier, not empty
      var outclass = U.clamp((player.maxSp / r.levelSp - 1.02) / 0.08, 0, 1) * chasing;
      var hd2 = Math.max(V.hd[seg.index], V.hd[Math.min(TB.road.N - 1, seg.index + 14)]); // steep way down just ahead: good riders ease off
      var desired = r.maxSp * (1 - Math.min(0.38, ac2 * 0.07 * (1.4 - 0.55 * r.skill)) * (1 - 0.3 * outclass)) * (1 - Math.min(0.2, hd2 * 0.1 * (1.3 - r.skill)));
      if (!player.finished && player.health > 0) { // keep the fight alive: chase a player who has got away, ease off when far ahead
        // (a player on a much faster bike is chased harder: an upgrade should make a level easier, not empty)
        if (dzP < 0) desired *= 1 + Math.min(V.BOOST_CAP, r.catchup + 0.5 * Math.max(0, player.maxSp / r.maxSp - 1)) * chasing;
        else if (dzP > 1500) desired *= 1 - 0.13 * U.clamp((dzP - 1500) / 6000, 0, 1);
      }
      if (r.laneCd > 0) r.laneCd -= dt;
      if (r.hunt > 0) r.hunt -= dt;
      else if (Math.abs(dzP) < 2500 && !player.finished && player.health > 0 && Math.random() < r.aggr * 0.15 * dt) r.hunt = 4 + Math.random() * 3;
      // occasional mistakes: only matter in curves, where the curve push then drags the rider wide
      if (r.slip > 0) r.slip -= dt;
      else if (ac > 2.4 && r.speed > r.maxSp * 0.6 && Math.random() < (1 - r.skill) * V.SLIP * dt * ac) r.slip = 0.9 + Math.random() * 1.1;

      var look = Math.max(3000, r.speed * 0.75), ahead = blocked(r, obs, r.x, 50, look);
      if (ahead) {
        if (r.laneCd <= 0) {
          var order = cand.slice().sort(function (a, b) { return Math.abs(a - r.x) - Math.abs(b - r.x); });
          for (j = 0; j < order.length; j++) {
            if (Math.abs(order[j] - r.x) < 0.05) continue;
            if (!blocked(r, obs, order[j], -350, look + 600)) { r.targetX = order[j]; r.laneCd = 1.2; break; }
          }
        }
        var gap = ahead.z - r.z, closing = r.speed - ahead.speed;
        if (gap < 800 || gap < closing * (0.6 + 1.2 * r.skill)) desired = Math.min(desired, ahead.speed * 0.9); // no free lane: brake before it gets ugly (good riders brake early, weak ones late)
      } else if (r.laneCd <= 0 && r.hunt <= 0) {
        // take the inside line of curves, like a human would
        r.targetX += (U.clamp(seg.curve * 0.12, -0.6, 0.6) - r.targetX) * Math.min(1, dt * 0.6);
      }
      if (r.hunt > 0 && Math.abs(dzP) < 1600 && !player.finished && player.health > 0) {
        r.targetX = U.clamp(player.x + (r.x < player.x ? -1 : 1) * 0.3, -0.85, 0.85);
        if (!ahead || ahead === player) desired = U.clamp(player.speed, desired * 0.8, desired * 1.08);
      }
      if (r.finished) desired = 0;

      if (hairpin) desired = Math.min(desired, r.maxSp * V.HAIRPIN_SPEED * (1.25 - 0.3 * r.skill)); // weak riders take hairpins too fast
      var acc = r.maxSp / 6 * (1 + outclass);
      if (r.speed < desired) r.speed = Math.min(desired, r.speed + acc * dt);
      else r.speed = Math.max(desired, r.speed - (ahead || hairpin ? r.maxSp / 2.4 : acc * 1.5) * dt);

      var oz = r.z, sp = r.speed / r.maxSp;
      r.z += r.speed * dt;
      // Same road rules as the player: the curve pushes the rider outward, and the AI has to steer against it.
      if (hairpin && r.laneCd <= 0 && r.hunt <= 0) r.targetX = U.clamp((Math.abs(ahead2.curve) > ac ? ahead2.curve : seg.curve) * 0.1, -0.55, 0.55); // set up on the inside early
      var auth = (r.slip > 0 ? 0.15 : hairpin ? 3.6 : 2.1) * (0.35 + 0.65 * sp);
      var step = U.clamp(r.targetX - r.x, -auth * dt, auth * dt);
      r.x += step + r.vx * dt - RC.curvePush(r, dt, seg, 1);
      RC.clampX(r, seg, dt);
      r.lean += ((step / dt) * 0.8 - r.lean) * Math.min(1, dt * 8);
      if (Math.abs(r.x) > 1.0) {
        if (r.speed > r.maxSp * 0.3) r.speed -= (r.maxSp / 1.6) * dt;
        if (Math.abs(r.vx) < 0.3 && r.slip <= 0) r.targetX = 0.7 * (r.x > 0 ? 1 : -1);
      }
      if (r.z > TB.road.length - 4 * C.segL) r.z = TB.road.length - 4 * C.segL;
      RC.hitScenery(r, oz);
      RC.checkOffRoad(r);
      if (r.crashT < 0 && r.shield <= 0 && !r.finished && G.raceTime > 3) fallCheck(r, seg, dt);

      var t = r.crashT < 0 ? TB.traffic.hit(r, 100, 220) : null;
      if (t) RC.trafficContact(r, t);
      for (j = 0; j < V.list.length; j++) { // rivals nudge each other apart
        var o = V.list[j];
        if (o !== r && Math.abs(o.z - r.z) < 200 && Math.abs(o.x - r.x) < 0.14) { r.x += (r.x >= o.x ? 1 : -1) * 0.02; if (o.z > r.z) r.speed = Math.min(r.speed, o.speed); }
      }
      if (!r.finished && r.z >= finishZ) { r.finished = true; r.finishTime = G.raceTime; }

      // fighting
      if (!player.finished && G.state === 'race' && G.raceTime > V.START_TRUCE) {
        var side = K.adjacent(r, player);
        if (side && r.atkCd <= 0 && Math.random() < r.aggr * 0.7 * dt) K.start(r, Math.random() < 0.3 ? 'kick' : 'punch', side);
      }
      K.update(r, humans);
    }
  };
})();
