// AI rivals: follow the road, dodge traffic, change lanes, chase the player, block/counter and throw punches.
(function () {
  'use strict';
  var TB = window.TB, C = TB.C, U = TB.util, RC = TB.racer, K = TB.combat;
  var V = (TB.rivals = { list: [] });
  var COLS = [-0.55, 0, 0.55];
  V.CATCHUP = 0.16;  // extra top speed the quickest rival gets when far behind a player: keeps the fight alive for the whole race
  V.BOOST_CAP = 0.15; // default cap on chasing boost (overridden per difficulty level via level.boostCap)
  // Falls: a rival goes down when the road asks more of them than they can give. load = (share of top speed)^2 x (bend sharpness + hill steepness);
  // each rider can take TOL x (0.7 + 0.6 skill) x grip. Weak riders brake less for what is coming, so they reach that limit far more often.
  V.TOL = 3.4; V.FALL_RATE = 1.5; V.HILL_K = 6; V.SLIP = 0.06;
  V.SPOT_M = 6000; V.SPOT_MAX = 2; // at most this many falls per 6000 units of road per race, and not two in a row within 2500 units / 4 s: a pile-up must not block the road
  V.HAIRPIN_SPEED = 0.33; // baseline share of top speed Rookie rivals slow to for a hairpin
  V.START_TRUCE = 2; // seconds after GO before rivals start swinging: everyone starts bunched up, and lost health never comes back

  // Enhance combat hit resolution for Pro/Legend rivals: blocking, brief poise guard, and immediate counter-attacks.
  if (K && K.hit && !K._rivalHook) {
    var baseHit = K.hit;
    K._rivalHook = true;
    K.hit = function (a, t, type) {
      if (t && t.isRival) {
        if (t.crashT >= 0 || t.shield > 0 || t.guard > 0) return false;
        if (a && a.isPlayer && t.blockChance > 0) {
          var blk = t.blockChance * (t.atkT > 0 ? 0.65 : 1);
          if (Math.random() < blk) {
            var away = t.x >= a.x ? 1 : -1, chip = type === 'kick' ? 4 : 2;
            t.health = Math.max(0, t.health - chip);
            t.flash = 0.16; t.wob = 0.25;
            t.vx += away * (type === 'kick' ? 0.28 : 0.14);
            t.speed *= 0.985;
            if (t.guardCd > 0) t.guard = t.guardCd;
            t.hunt = Math.max(t.hunt || 0, 7);
            RC.pop(t, 'BLOCK!', '#8ee0ff');
            RC.emit({ type: 'hit', r: t, by: a, kind: type });
            TB.audio.thud();
            RC.shake(a, 5);
            if (t.counterChance > 0 && Math.random() < Math.min(0.96, t.counterChance + 0.15)) {
              t.counterT = 0.55;
              t.atkCd = Math.min(t.atkCd, 0.08);
            }
            if (t.health <= 0) {
              t.health = 0;
              RC.crash(t, 'ko', away);
              a.kos++; TB.G.koCash += 50;
              TB.hud.toast(a.label + 'KO ' + t.name.toUpperCase() + '  +$50', '#ffd23f');
              TB.audio.cash();
            }
            return true;
          }
        }
        var preSp = t.speed;
        var hit = baseHit.call(this, a, t, type);
        if (hit && t.health > 0 && t.crashT < 0) {
          if (t.guardCd > 0) t.guard = t.guardCd;
          if (t.dodgeK > 0) { // tougher poise: higher-tier rivals recover speed & balance faster after taking a punch
            t.vx *= 1 - 0.28 * t.dodgeK;
            t.speed = Math.min(preSp, t.speed * (1 + 0.04 * t.dodgeK));
          }
          t.hunt = Math.max(t.hunt || 0, 6 + 3 * (t.dodgeK || 0));
          if (a && a.isPlayer && t.counterChance > 0 && Math.random() < t.counterChance) {
            t.counterT = 0.6;
            t.atkCd = Math.min(t.atkCd, 0.14);
          }
        }
        return hit;
      }
      return baseHit.call(this, a, t, type);
    };
  }

  // Start grid: 9 slots (3 rows of 3). The player gets slot 7.
  V.slot = function (i) { return { x: COLS[i % 3], z: 2400 - Math.floor(i / 3) * 450 }; };

  // Road difficulty per segment: bend = |curve| x hairpin factor; hill = how steep the way down is, plus how sharply a crest drops away.
  function roadLoads() {
    var R = TB.road, n = R.N, i, sl = new Float32Array(n);
    V.cd = new Float32Array(n); V.hd = new Float32Array(n);
    for (i = 0; i < n; i++) { var sg = R.segs[i]; sl[i] = (sg.p2.world.y - sg.p1.world.y) / C.segL; V.cd[i] = Math.abs(sg.curve) * sg.sharp; }
    for (i = 0; i < n; i++) V.hd[i] = Math.max(0, -sl[i]) + 1.5 * Math.max(0, sl[Math.max(0, i - 5)] - sl[Math.min(n - 1, i + 5)]);
  }
  V.noteFall = function (z) { var k = Math.floor(z / V.SPOT_M); V.spots[k] = (V.spots[k] || 0) + 1; V.lastFall = { z: z, t: V.clock }; };
  V.spotFull = function (z) {
    if ((V.spots[Math.floor(z / V.SPOT_M)] || 0) >= V.SPOT_MAX) return true;
    return !!V.lastFall && V.clock - V.lastFall.t < 4 && Math.abs(z - V.lastFall.z) < 2500;
  };

  // level: difficulty (see TB.levels). duo: player 2 takes slot 8, so one rival sits out.
  V.init = function (track, level, duo) {
    roadLoads(); V.spots = {}; V.lastFall = null; V.clock = 0;
    var lv = level || TB.levels[0];
    var tier = track.rival || { skill: 0.6, aggr: 1, dmg: 1, hp: 1 };
    var effDiff = U.lerp(track.diff, 1.06, lv.diffLift || 0);
    var spread = lv.packSpread !== undefined ? lv.packSpread : 1;
    var rng = U.rng(track.seed + 99), slots = duo ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4, 5, 6, 8], i, j, tmp;
    for (i = slots.length - 1; i > 0; i--) { j = Math.floor(rng() * (i + 1)); tmp = slots[i]; slots[i] = slots[j]; slots[j] = tmp; }
    V.list = [];
    for (i = 0; i < slots.length; i++) {
      var d = TB.roster[i], r = RC.make({ name: d.name, suit: d.suit, body: d.body, helmet: d.helmet, hp: Math.round(d.hp * lv.hp * tier.hp) });
      var s = V.slot(slots[i]);
      var effPace = 0.99 - (0.99 - d.pace) * spread;
      r.x = s.x; r.z = s.z; r.targetX = s.x;
      r.aggr = d.aggr * tier.aggr; // base trait (also used by TB.combat.damageFor)
      r.aggrK = lv.aggr || 1;
      r.atkRate = lv.atkRate || 1;
      r.kickRate = lv.kickRate !== undefined ? lv.kickRate : 0.3;
      r.atkCdK = lv.atkCd || 1;
      r.maxHunt = lv.maxHunt || 2;
      r.pace = effPace; r.hunt = 0; r.laneCd = 0; r.counterT = 0; r.isRival = true;
      r.skill = U.clamp(tier.skill + lv.skill + (d.pace - 0.93) * 1.2 + (rng() - 0.5) * 0.14, lv.skillFloor || 0.2, 1);
      r.slip = 0; // slip > 0: the rider lets go of the bars for a moment (a mistake)
      r.maxSp = C.baseMax * 0.93 * effPace * effDiff * lv.pace;
      r.levelSp = C.baseMax * 0.93 * effDiff * lv.pace;
      r.accelK = lv.accel || 1;
      r.cornerK = lv.corner || 1;
      r.handle = lv.handle || 1;
      r.fallK = lv.fallK !== undefined ? lv.fallK : 1;
      r.slipK = lv.slipK !== undefined ? lv.slipK : 1;
      r.recoverK = lv.recover || 1;
      r.respawnSp = lv.respawnSp !== undefined ? lv.respawnSp : 0.16;
      r.dmgK = lv.dmg * tier.dmg;
      r.catchup = (0.04 + V.CATCHUP * U.clamp((d.pace - 0.86) / 0.13, 0, 1)) * (lv.catchup || 1);
      r.boostCap = lv.boostCap !== undefined ? lv.boostCap : V.BOOST_CAP;
      r.chaseDist = lv.chaseDist || 7000;
      r.leadEase = lv.leadEase !== undefined ? lv.leadEase : 0.13;
      r.dodgeK = lv.dodge || 0;
      r.blockChance = lv.block || 0;
      r.guardCd = lv.guardCd || 0;
      r.counterChance = lv.counter || 0;
      r.packBlock = lv.packBlock || 0;
      r.truce = lv.truce !== undefined ? lv.truce : V.START_TRUCE;
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
    var nearest = null, bestDz = 1e18, i, pad = r.dodgeK > 0 ? 0.12 : 0.1;
    for (i = 0; i < obs.length; i++) {
      var o = obs[i], dz = o.z - r.z;
      if (dz > from && dz < to && Math.abs(o.x - x) < o.hw + r.hw + pad) {
        if (dz < bestDz) { bestDz = dz; nearest = o; }
      }
    }
    return nearest;
  }

  function clearance(r, obs, x, from, to) {
    var best = to, i, pad = 0.12;
    for (i = 0; i < obs.length; i++) {
      var o = obs[i], dz = o.z - r.z;
      if (dz > from && dz < to && Math.abs(o.x - x) < o.hw + r.hw + pad) {
        if (dz <= 0) return -1;
        if (dz < best) best = dz;
      }
    }
    return best;
  }

  function chooseAttack(r, player, side, obs) {
    if (r.dodgeK > 0.3) {
      // Shove a player who is close to the road edge or next to traffic using a heavy kick.
      if (player.x * side > 0.42 || blocked(player, obs, player.x + side * 0.34, -220, 1400)) {
        return Math.random() < 0.85 ? 'kick' : 'punch';
      }
      // Beat an incoming player wind-up with a fast punch.
      if (player.atkT > 0 && !player.atkHit && r.dodgeK > 0.5) {
        return Math.random() < 0.75 ? 'punch' : 'kick';
      }
    }
    return Math.random() < r.kickRate ? 'kick' : 'punch';
  }

  // The road asks more than the rider can give: a bend or hairpin taken too fast, or a steep drop / crest. Chance per second grows with how far over the limit they are.
  function fallCheck(r, seg, dt) {
    var cd = V.cd[seg.index], hd = V.HILL_K * Math.max(0, V.hd[seg.index] - 0.25), sp = r.speed / r.maxSp;
    var load = sp * sp * (cd + hd);
    var tol = V.TOL * (0.7 + 0.6 * r.skill) * r.handle * r.cornerK;
    if (load <= tol || Math.random() > V.FALL_RATE * r.fallK * (load / tol - 1) * dt) return;
    var kind = hd > cd ? 'hill' : seg.sharp > 1.5 ? 'hairpin' : 'bend';
    if (RC.crash(r, kind, seg.curve >= 0 ? -1 : 1)) RC.hurt(r, 10);
  }

  V.update = function (dt, G, humans) {
    var racing = G.state === 'race' || G.state === 'finishing', finishZ = TB.road.finishZ, i, j;
    var lanes = TB.road.track.lanes, baseCand = [], eliteCand = [], k;
    if (racing) V.clock += dt;
    for (k = 0; k < lanes.length; k++) {
      baseCand.push(lanes[k]); eliteCand.push(lanes[k]);
      if (k < lanes.length - 1) { var mid = (lanes[k] + lanes[k + 1]) / 2; baseCand.push(mid); eliteCand.push(mid); }
    }
    eliteCand.push(-0.76, 0.76); // tight tarmac edge lines for weaving on Pro/Legend (clear of edge rocks)

    // Find pack leader z and active hunters so the pack stays tight without dogpiling the same lane.
    var leadZ = 0, hunters = 0;
    for (i = 0; i < V.list.length; i++) {
      if (V.list[i].health > 0) {
        if (V.list[i].z > leadZ) leadZ = V.list[i].z;
        if (V.list[i].hunt > 0 && V.list[i].crashT < 0) hunters++;
      }
    }

    for (i = 0; i < V.list.length; i++) {
      var r = V.list[i];
      var wasCrashed = r.crashT >= 0 && r.health > 0;
      if (wasCrashed && r.recoverK > 1) r.crashT += dt * (r.recoverK - 1);
      if (!RC.tick(r, dt)) continue;
      if (wasCrashed && r.crashT < 0) {
        if (r.dodgeK > 0) r.x = RC.safeX(r);
        r.speed = Math.max(r.speed, r.maxSp * r.respawnSp);
        r.laneCd = 0;
      }
      if (!racing) continue;

      var player = target(r, humans), seg = TB.road.segAt(r.z), obs = obstacles(r, humans), ac = Math.abs(seg.curve);
      // rivals read the road ahead and brake for what is coming (higher-tier riders brake later and harder)
      var aheadDist = 2600 + 800 * r.dodgeK;
      var ahead2 = TB.road.segAt(r.z + aheadDist), ac2 = Math.max(ac, Math.abs(ahead2.curve));
      var hpLead = r.speed * U.lerp(0.9, 0.62, r.dodgeK);
      var aheadHp = TB.road.segAt(r.z + hpLead);
      var hairpin = seg.sharp > 1.2 || ahead2.sharp > 1.2 || aheadHp.sharp > 1.2;
      var dzP = r.z - player.z, chasing = !player.finished && player.health > 0 ? U.clamp(-dzP / r.chaseDist, 0, 1) : 0;
      // a player whose bike outclasses this level gets chased harder (more risk in the bends, harder acceleration): an upgrade should make a level easier, not empty
      var outclass = U.clamp((player.maxSp / r.levelSp - 1.02) / 0.08, 0, 1) * chasing;
      var hd2 = Math.max(V.hd[seg.index], V.hd[Math.min(TB.road.N - 1, seg.index + 14)]); // steep way down just ahead: good riders ease off
      var cPen = Math.min(0.38, ac2 * 0.07 * (1.4 - 0.55 * r.skill) / r.cornerK) * (1 - 0.3 * outclass);
      var hPen = Math.min(0.2, hd2 * 0.1 * (1.3 - r.skill) / r.cornerK);
      var desired = r.maxSp * (1 - cPen) * (1 - hPen);

      if (!player.finished && player.health > 0) { // keep the fight alive: chase a player who has got away, ease off slightly when far ahead
        if (dzP < 0) {
          var bikeGap = Math.max(0, player.maxSp / r.maxSp - 1);
          desired *= 1 + Math.min(r.boostCap, r.catchup + (0.5 + 0.35 * r.dodgeK) * bikeGap) * chasing;
        } else if (dzP > 1500) {
          desired *= 1 - r.leadEase * U.clamp((dzP - 1500) / 6000, 0, 1);
        }
        // Tight pack cohesion on Pro/Legend: trailing pack members draft hard to stay within striking distance of the leader.
        if (r.dodgeK > 0 && leadZ - r.z > 1400 && dzP < 3000) {
          desired *= 1 + 0.055 * r.dodgeK * U.clamp((leadZ - r.z - 1400) / 5000, 0, 1);
        }
      }

      if (r.laneCd > 0) r.laneCd -= dt;
      if (r.counterT > 0) r.counterT -= dt;
      var huntRange = 2500 + 2200 * r.dodgeK;
      if (r.hunt > 0) r.hunt -= dt;
      else if (hunters < r.maxHunt && Math.abs(dzP) < huntRange && !player.finished && player.health > 0 && Math.random() < r.aggr * 0.15 * r.aggrK * dt) {
        r.hunt = 4 + Math.random() * (3 + 2 * r.dodgeK);
        hunters++;
      }
      // occasional mistakes: only matter in curves, where the curve push then drags the rider wide
      if (r.slip > 0) r.slip -= dt;
      else if (ac > 2.4 && r.speed > r.maxSp * 0.6 && Math.random() < (1 - r.skill) * V.SLIP * r.slipK * dt * ac) {
        r.slip = (0.9 + Math.random() * 1.1) * (1 - 0.45 * r.dodgeK);
      }

      var look = Math.max(3000, r.speed * (0.75 + 0.52 * r.dodgeK)), ahead = blocked(r, obs, r.x, 50, look);
      var cand = r.dodgeK > 0.3 ? eliteCand : baseCand;
      var evadingTraffic = false;
      if (ahead) {
        var gap = ahead.z - r.z, closing = Math.max(0, r.speed - ahead.speed);
        var clearPad = ahead.hw + r.hw + 0.15;
        var alreadyClearing = r.dodgeK > 0 && Math.abs(r.targetX - ahead.x) >= clearPad && !blocked(r, obs, r.targetX, -220, Math.min(look, gap + 1400));
        var urgent = r.dodgeK > 0 && !alreadyClearing && (gap < 1500 || gap < closing * 0.55);
        if (!alreadyClearing && (r.laneCd <= 0 || urgent)) {
          var limR = TB.road.limitR[seg.index] - 0.12, limL = -(TB.road.limitL[seg.index] - 0.12);
          var order = cand.slice().sort(function (a, b) { return Math.abs(a - r.x) - Math.abs(b - r.x); });
          var picked = false, bestFallback = r.targetX, bestClear = -1;
          for (j = 0; j < order.length; j++) {
            var cx = order[j];
            if (cx > limR || cx < limL) continue;
            if (Math.abs(cx - r.x) < 0.05) continue;
            if (!blocked(r, obs, cx, -350, look + 700)) {
              r.targetX = cx; r.laneCd = U.lerp(1.2, 0.24, r.dodgeK); picked = true; break;
            }
            if (r.dodgeK > 0) {
              var cl = clearance(r, obs, cx, -260, look + 700);
              if (cl > bestClear) { bestClear = cl; bestFallback = cx; }
            }
          }
          if (!picked && r.dodgeK > 0 && bestClear > gap + 350) {
            r.targetX = bestFallback; r.laneCd = U.lerp(0.8, 0.24, r.dodgeK);
          }
        }
        if (r.dodgeK <= 0) {
          if (gap < 800 || gap < closing * (0.6 + 1.2 * r.skill)) desired = Math.min(desired, ahead.speed * 0.9); // Rookie: classic early/late braking
        } else {
          // Pro/Legend: weave at full speed when there is time to clear laterally; brake smartly if boxed in or tight on clearance
          var steeringClear = Math.abs(r.targetX - ahead.x) >= clearPad;
          if (ahead.isTraffic && steeringClear) evadingTraffic = true;
          var needX = Math.max(0, clearPad - Math.abs(r.x - ahead.x));
          var estAuth = Math.max(1.0, (hairpin ? 3.6 : 2.1) * r.handle * (evadingTraffic ? 1 + 0.55 * r.dodgeK : 1) * (0.35 + 0.65 * (r.speed / r.maxSp)));
          var tClear = needX / estAuth, tHit = gap / Math.max(400, closing);
          if (!steeringClear) {
            if (gap < 1000 || gap < closing * (0.65 + 0.35 * r.skill)) desired = Math.min(desired, ahead.speed * 0.92);
          } else if (ahead.isTraffic && (tClear > tHit * 0.72 || gap < 550)) {
            desired = Math.min(desired, ahead.speed * 0.94);
          }
        }
      } else if (r.laneCd <= 0 && r.hunt <= 0) {
        // Defensive lane blocking when just ahead of a closing player (Pro/Legend)
        if (r.packBlock > 0 && !hairpin && !player.finished && player.health > 0 && dzP > 140 && dzP < 1500 && player.speed > r.speed * 0.94) {
          var blkX = U.clamp(player.x, -0.76, 0.76);
          if (!blocked(r, TB.traffic.list, blkX, -200, look * 0.85)) {
            r.targetX += (blkX - r.targetX) * Math.min(1, dt * (2.4 * r.packBlock));
          }
        } else {
          // take the inside line of curves, like a human would
          var apex = U.clamp(seg.curve * (0.12 + 0.03 * r.dodgeK), -0.66, 0.66);
          if (r.dodgeK <= 0 || !blocked(r, TB.traffic.list, apex, -150, look * 0.75)) {
            r.targetX += (apex - r.targetX) * Math.min(1, dt * (0.6 + 2.2 * r.dodgeK));
          }
        }
      }

      if (r.hunt > 0 && !hairpin && Math.abs(dzP) < (1600 + 600 * r.dodgeK) && !player.finished && player.health > 0) {
        var strikeOff = 0.3 - 0.05 * r.dodgeK;
        var huntX = U.clamp(player.x + (r.x < player.x ? -1 : 1) * strikeOff, -0.82, 0.82);
        var huntSafe = r.dodgeK <= 0 || !blocked(r, TB.traffic.list, huntX, -200, look * 0.8);
        if (huntSafe && (!ahead || ahead === player || r.dodgeK <= 0)) {
          r.targetX = huntX;
          desired = U.clamp(player.speed * (1 + 0.03 * r.dodgeK), desired * 0.82, desired * (1.08 + 0.07 * r.dodgeK));
        }
      }
      if (r.finished) desired = 0;

      if (hairpin) desired = Math.min(desired, r.maxSp * V.HAIRPIN_SPEED * (1.25 - 0.3 * r.skill) * r.cornerK);
      var sp = r.speed / r.maxSp;
      var lowTorque = 1 + (r.accelK - 1) * 0.42 * (1 - sp);
      var acc = (r.maxSp / 6) * r.accelK * lowTorque * (1 + outclass * (1 + 0.35 * r.dodgeK));
      var brakeRate = ahead || hairpin ? (r.maxSp / 2.4) * (1 + 0.85 * r.dodgeK) : acc * 1.5;
      if (r.speed < desired) r.speed = Math.min(desired, r.speed + acc * dt);
      else r.speed = Math.max(desired, r.speed - brakeRate * dt);

      var oz = r.z;
      sp = r.speed / r.maxSp;
      r.z += r.speed * dt;
      // Same road rules as the player: the curve pushes the rider outward, and the AI has to steer against it.
      if (!ahead && hairpin && r.laneCd <= 0 && (r.hunt <= 0 || r.dodgeK > 0)) {
        var hpCurve = Math.abs(ahead2.curve) > ac ? ahead2.curve : (Math.abs(aheadHp.curve) > ac ? aheadHp.curve : seg.curve);
        var hpX = U.clamp(hpCurve * (0.1 + 0.02 * r.dodgeK), -0.62, 0.62); // set up on the inside early
        if (r.dodgeK <= 0 || !blocked(r, TB.traffic.list, hpX, -150, look * 0.7)) r.targetX = hpX;
      }
      var evadeBoost = evadingTraffic ? 1 + 0.55 * r.dodgeK : 1;
      var auth = (r.slip > 0 ? 0.15 : hairpin ? 3.6 : 2.1) * r.handle * evadeBoost * (0.35 + 0.65 * sp);
      var step = U.clamp(r.targetX - r.x, -auth * dt, auth * dt);
      r.x += step + r.vx * dt - RC.curvePush(r, dt, seg, r.handle);
      RC.clampX(r, seg, dt);
      r.lean += ((step / dt) * 0.8 - r.lean) * Math.min(1, dt * 8);
      if (Math.abs(r.x) > 1.0) {
        if (r.speed > r.maxSp * 0.3) r.speed -= (r.maxSp / (1.6 + 0.6 * r.dodgeK)) * dt;
        if (Math.abs(r.vx) < 0.35 && r.slip <= 0) r.targetX = (0.7 - 0.12 * r.dodgeK) * (r.x > 0 ? 1 : -1);
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

      // fighting: opportunistic attacks + instant counter-attacks
      if (!player.finished && player.health > 0 && G.state === 'race' && G.raceTime > r.truce) {
        var side = K.adjacent(r, player);
        if (side && r.atkCd <= 0) {
          var trigger = r.counterT > 0 || Math.random() < r.aggr * 0.7 * r.atkRate * dt;
          if (trigger && K.start(r, chooseAttack(r, player, side, obs), side)) {
            r.atkCd *= r.atkCdK;
            r.counterT = 0;
          }
        }
      }
      K.update(r, humans);
    }
  };
})();
