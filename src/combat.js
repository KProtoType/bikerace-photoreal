// Punches and kicks. An attack only connects if the victim is right next to the attacker.
(function () {
  'use strict';
  var TB = window.TB;
  var K = (TB.combat = {});
  var REACH_Z = 520, MIN_X = 0.1, MAX_X = 0.7;
  var GUARD = 0.9;  // seconds after a hit on a player before another hit on them can land: losing health is permanent, so a crowd must not be able to stack hits

  // returns -1 / +1 (which side b is on) or 0 when not adjacent
  K.adjacent = function (a, b) {
    if (b.crashT >= 0) return 0;
    if (Math.abs(b.z - a.z) > REACH_Z) return 0;
    var dx = b.x - a.x, ad = Math.abs(dx);
    if (ad < MIN_X || ad > MAX_X) return 0;
    return dx < 0 ? -1 : 1;
  };

  K.nearest = function (a, list) {
    var best = null, bd = 1e9;
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (t === a || !K.adjacent(a, t)) continue;
      var d = Math.abs(t.z - a.z) * 0.002 + Math.abs(t.x - a.x);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  };

  K.start = function (a, type, side) {
    if (a.atkCd > 0 || a.crashT >= 0 || a.atkT > 0) return false;
    a.atkType = type; a.atkSide = side;
    a.atkDur = type === 'kick' ? 0.36 : 0.27;
    a.atkT = a.atkDur; a.atkCd = type === 'kick' ? 0.75 : 0.42; a.atkHit = false;
    TB.audio.swing();
    return true;
  };

  function damageFor(a, type) {
    if (a.isPlayer) return type === 'kick' ? 15 : 9;
    var ag = a.aggr || 0.5;
    return (type === 'kick' ? 8 + ag * 6 : 4 + ag * 5) * (a.dmgK || 1);
  }

  K.hit = function (a, t, type) {
    if (t.crashT >= 0 || t.shield > 0 || (t.isPlayer && t.guard > 0)) return false;
    if (t.isPlayer) t.guard = GUARD;
    var dmg = Math.round(damageFor(a, type)), away = t.x >= a.x ? 1 : -1;
    t.health -= dmg; t.flash = 0.3; t.wob = 1;
    t.vx += away * (type === 'kick' ? 1.2 : 0.75);
    t.speed *= type === 'kick' ? 0.88 : 0.94;
    TB.racer.pop(t, '-' + dmg, '#ffd23f');
    TB.racer.emit({ type: 'hit', r: t, by: a, kind: type });
    if (t.hunt !== undefined) t.hunt = 6; // rivals who get hit hold a grudge
    TB.audio.thud();
    if (t.isPlayer) TB.racer.shake(t, 12);
    if (a.isPlayer) TB.racer.shake(a, 6);
    if (t.health <= 0) {
      t.health = 0;
      TB.racer.crash(t, 'ko', away);
      if (a.isPlayer) {
        a.kos++; TB.G.koCash += 50;
        TB.hud.toast(a.label + 'KO ' + t.name.toUpperCase() + '  +$50', '#ffd23f');
        TB.audio.cash();
      }
    }
    return true;
  };

  // Called every frame for each fighter: resolves the hit part-way through the swing.
  K.update = function (a, targets) {
    if (a.atkT <= 0 || a.atkHit) return;
    if (1 - a.atkT / a.atkDur < 0.4) return;
    a.atkHit = true;
    var best = null, bd = 1e9;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (t === a) continue;
      var s = K.adjacent(a, t);
      if (s && s === a.atkSide) {
        var d = Math.abs(t.z - a.z) * 0.002 + Math.abs(t.x - a.x);
        if (d < bd) { bd = d; best = t; }
      }
    }
    if (best) K.hit(a, best, a.atkType);
  };
})();
