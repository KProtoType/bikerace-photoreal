// Road model (no drawing): builds a track out of short segments (curve + hill per segment),
// places roadside scenery, and converts everything into 3D world positions for the renderer.
(function () {
  'use strict';
  var TB = window.TB, C = TB.C, U = TB.util;
  var R = (TB.road = { segs: [], N: 0, track: null, finishIdx: 0, startIdx: 6, finishZ: 0, length: 0 });

  // ---------------------------------------------------------------- building a track
  function genTrack(track, rng, add, lastY, count) {
    var g = track.gen, segL = C.segL, ridge = track.ridge, ridgeDone = !ridge;
    function ri(a, b) { return Math.floor(a + rng() * (b - a + 1)); }
    function sec(len, curve, hill) { var e = Math.round(len * 0.3); add(e, len - 2 * e, e, curve, hill); }
    function hillTo() { var want = rng() * g.hillMax, d = want - lastY() / segL; return U.clamp(d, -g.hillAmp, g.hillAmp); }
    function dir() { return rng() < 0.5 ? -1 : 1; }
    function curveVal() { return g.curves[ri(0, g.curves.length - 1)]; }

    var list = [], k;
    for (k in g.weights) if (g.weights[k] > 0) list.push({ id: k, wt: g.weights[k] });
    sec(90, 0, 0);
    var ridgeStart = -1, ridgeEnd = -1;
    while (count() < track.segs - 500) {
      if (!ridgeDone && count() >= track.segs * ridge.at) {
        ridgeDone = true;
        sec(90, 0, Math.max(0, g.hillMax * 0.95 - lastY() / segL)); // climb up to the crest
        ridgeStart = count();
        for (k = 0; k < 4; k++) sec(ri(100, 140), (k % 2 ? -1 : 1) * (1.0 + rng() * 1.2), (rng() - 0.5) * 6);
        ridgeEnd = count();
        sec(110, 0, -lastY() / segL * 0.55); // long descent
        continue;
      }
      var id = U.pickWeighted(list, rng).id, d = dir(), n;
      if (id === 'straight') sec(ri(g.straightLen[0], g.straightLen[1]), 0, rng() < 0.5 ? hillTo() * 0.5 : 0);
      else if (id === 'curve') sec(ri(g.curveLen[0], g.curveLen[1]), d * curveVal(), hillTo() * 0.6);
      else if (id === 'scurve') {
        var c1 = curveVal();
        sec(ri(50, 80), d * c1, hillTo() * 0.4); sec(ri(50, 80), -d * c1, hillTo() * 0.4);
      } else if (id === 'hill') sec(ri(60, 120), 0, hillTo());
      else if (id === 'hairpin') {
        sec(ri(30, 50), 0, hillTo() * 0.3); sec(ri(34, 46), d * 5.7, hillTo() * 0.4);
      } else if (id === 'switchback') { // a climbing/descending run of hairpins
        var up = lastY() / segL < g.hillMax * 0.5, sh = up ? 16 : -16;
        n = ri(3, 4);
        for (k = 0; k < n; k++) { sec(ri(34, 44), d * 5.6, sh); d = -d; if (k < n - 1) sec(ri(10, 18), 0, sh * 0.5); }
        sec(ri(40, 70), 0, 0);
      }
    }
    sec(90, 0, -lastY() / segL); // come back down to y = 0
    return { ridgeStart: ridgeStart, ridgeEnd: ridgeEnd };
  }

  function placeScenery(track, rng, segs) {
    var sc = track.scenery, N = segs.length, i, side, t, off;
    function put(seg, t, off, v) {
      // keep the inside of tight curves clear: the camera cuts across it, and nobody should hit a tree "inside" a hairpin
      var nc = R.nearCurve[seg.index];
      if (Math.abs(nc) > 3.6 && off * nc > 0 && Math.abs(off) < 4.8 && t.t !== 'rail' && t.t !== 'sign' && t.t !== 'pole') return;
      seg.sprites.push({ t: t.t, off: off, w: t.w, h: t.h, v: v || 0, solid: !!t.solid, hw: t.hw || 0 });
    }
    for (i = 12; i < N - 20; i += 3) {
      var seg = segs[i], nearFinish = Math.abs(i - R.finishIdx) < 12 || Math.abs(i - R.startIdx) < 12;
      if (nearFinish) continue;
      for (side = -1; side <= 1; side += 2) {
        if (seg.ridge) continue; // ridge: nothing but cliffs and guardrails
        if (rng() < sc.density) { t = U.pickWeighted(sc.types, rng); off = side * (t.near[0] + rng() * (t.near[1] - t.near[0])); put(seg, t, off, Math.floor(rng() * 3)); }
        if (rng() < sc.farDensity) { t = U.pickWeighted(sc.far, rng); off = side * (t.near[0] + rng() * (t.near[1] - t.near[0])); put(seg, t, off, Math.floor(rng() * 3)); }
      }
      if (sc.poles && i % 36 === 0) put(seg, { t: 'pole', w: 160, h: 2600, hw: 0.03, solid: true }, 1.14, 0);
      if (sc.edgeRocks && rng() < sc.edgeRocks) put(seg, { t: 'rock', w: 650, h: 460, hw: 0.14, solid: true }, (rng() < 0.5 ? -1 : 1) * (0.93 + rng() * 0.08), 0);
    }
    // ridge: continuous guardrails on both sides, boulders down the cliff
    if (sc.rails) {
      for (i = 12; i < N - 20; i += 3) {
        var s2 = segs[i], c = s2.curve;
        if (s2.ridge) { put(s2, { t: 'rail', w: 660, h: 300, hw: 0.04, solid: true }, -1.07, 0); put(s2, { t: 'rail', w: 660, h: 300, hw: 0.04, solid: true }, 1.07, 0); }
        else if (Math.abs(c) >= 2.4) put(s2, { t: 'rail', w: 660, h: 300, hw: 0.04, solid: true }, (c > 0 ? -1 : 1) * 1.07, 0);
      }
    }
    if (sc.curveSigns) {
      for (i = 40; i < N - 30; i++) {
        var cur = segs[i].curve;
        if (Math.abs(cur) >= 3 && Math.abs(segs[i - 1].curve) < 3) {
          // judge the bend by its sharpest point, and warn of a hairpin early: from full speed it takes over a second of braking
          var peak = 0, q; for (q = i; q < Math.min(N, i + 40); q++) if (Math.abs(segs[q].curve) > peak) peak = Math.abs(segs[q].curve);
          var sg = segs[peak > 5 ? Math.max(0, i - 80) : i - 28], v = peak > 5 ? 2 : (cur > 0 ? 1 : 0);
          sg.sprites.push({ t: 'sign', off: (cur > 0 ? -1 : 1) * 1.25, w: 520, h: 1200, v: v, solid: true, hw: 0.04 });
        }
      }
    }
  }

  R.build = function (track) {
    var rng = U.rng(track.seed), segs = (R.segs = []);
    R.track = track;
    C.roadW = track.roadW || 1500;
    function lastY() { return segs.length ? segs[segs.length - 1].p2.world.y : 0; }
    function addSeg(curve, y) {
      var n = segs.length;
      segs.push({
        index: n, curve: curve, sprites: [], ridge: false,
        p1: { world: { y: lastY(), z: n * C.segL } },
        p2: { world: { y: y, z: (n + 1) * C.segL } }
      });
    }
    function add(enter, hold, leave, curve, y) {
      var startY = lastY(), endY = startY + y * C.segL, total = enter + hold + leave, n;
      for (n = 0; n < enter; n++) addSeg(U.easeIn(0, curve, n / enter), U.easeInOut(startY, endY, n / total));
      for (n = 0; n < hold; n++) addSeg(curve, U.easeInOut(startY, endY, (enter + n) / total));
      for (n = 0; n < leave; n++) addSeg(U.easeInOut(curve, 0, n / leave), U.easeInOut(startY, endY, (enter + hold + n) / total));
    }
    var info = genTrack(track, rng, add, lastY, function () { return segs.length; });
    R.finishIdx = segs.length + 30;
    add(30, 30, 30, 0, 0);                  // flat run-in to the finish line
    var tail = 320;                          // flat run-out so the view never wraps
    for (var i = 0; i < tail; i++) addSeg(0, 0);
    R.N = segs.length;
    R.finishZ = R.finishIdx * C.segL;
    R.length = R.N * C.segL;
    if (info.ridgeStart >= 0) for (i = info.ridgeStart; i < info.ridgeEnd; i++) segs[i].ridge = true;
    // strongest curve within ~25 segments of each segment (used to keep the inside of tight curves clear)
    R.nearCurve = new Float32Array(R.N);
    for (i = 0; i < R.N; i++) { var best = 0, k; for (k = Math.max(0, i - 25); k <= Math.min(R.N - 1, i + 25); k += 2) if (Math.abs(segs[k].curve) > Math.abs(best)) best = segs[k].curve; R.nearCurve[i] = best; }
    placeScenery(track, rng, segs);
    R.layout();
    return R;
  };

  R.segAt = function (z) {
    var i = Math.floor(z / C.segL) % R.N;
    if (i < 0) i += R.N;
    return R.segs[i];
  };

  // Finds sprites the rider has driven through (solid roadside objects).
  R.sceneryHit = function (r, z0, z1) {
    var i0 = Math.floor(z0 / C.segL), i1 = Math.floor(z1 / C.segL), i, j, seg, s;
    for (i = i0; i <= i1; i++) {
      seg = R.segs[((i % R.N) + R.N) % R.N];
      for (j = 0; j < seg.sprites.length; j++) {
        s = seg.sprites[j];
        if (s.solid && Math.abs(r.x - s.off) < s.hw + r.hw) return s;
      }
    }
    return null;
  };


  // ---------------------------------------------------------------- 3D layout
  // Turns the per-segment "curve" numbers into a real winding path in metres.
  // Scene axes: +X right, +Y up, forward at heading 0 is -Z. Positive curve = turning right.
  function smooth(a, b, v) { var t = U.clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  R.HAIRPIN_PUSH = 3.5; // hairpins turn about 4.5x sharper than ordinary curves, so they push much harder too: you have to brake and steer
  R.layout = function () {
    var N = R.N, S = C.S, YS = C.YS, segLm = C.segL * S, segs = R.segs, j;
    for (j = 0; j < N; j++) segs[j].sharp = 1 + (R.HAIRPIN_PUSH - 1) * smooth(4.2, 5.5, Math.abs(segs[j].curve));
    var P = (R.pts = new Float32Array((N + 1) * 3)), TH = (R.heading = new Float32Array(N + 1)), BK = (R.bank = new Float32Array(N + 1));
    var th = 0, x = 0, z = 0;
    for (j = 0; j <= N; j++) {
      var seg = segs[Math.min(j, N - 1)], c = j < N ? seg.curve : 0, ac = Math.abs(c);
      P[j * 3] = x; P[j * 3 + 1] = (j < N ? seg.p1.world.y : segs[N - 1].p2.world.y) * S * YS; P[j * 3 + 2] = z;
      TH[j] = th;
      BK[j] = U.clamp(c * 0.018, -0.09, 0.09);
      var K = 0.0036 + 0.0125 * smooth(4.2, 5.5, ac);
      var dth = c * K - 0.0008 * th; // the small pull-back keeps the road from looping back over itself
      var tm = th + dth * 0.5;
      x += Math.sin(tm) * segLm; z -= Math.cos(tm) * segLm;
      th += dth;
    }
    R.roadHalf = C.roadW * S;
    // how far toward each side a rider may be at each segment: stay at least 4 m from the centre of a tight bend, or the bike just spins on the spot
    var LR = (R.limitR = new Float32Array(N)), LL = (R.limitL = new Float32Array(N)), rawR = new Float32Array(N), rawL = new Float32Array(N), WIN = 12;
    for (j = 0; j < N; j++) {
      var d = TH[j + 1] - TH[j], rad = Math.abs(d) > 1e-6 ? segLm / Math.abs(d) : 1e9, lim = (rad - 4) / R.roadHalf;
      rawR[j] = d > 0 ? lim : 9; rawL[j] = d < 0 ? lim : 9;
    }
    for (j = 0; j < N; j++) {
      var a = 9, b = 9, q;
      for (q = Math.max(0, j - WIN); q <= Math.min(N - 1, j + WIN); q++) { if (rawR[q] < a) a = rawR[q]; if (rawL[q] < b) b = rawL[q]; }
      LR[j] = a; LL[j] = b;
    }
  };

  // 3D position/orientation of a spot on the road: z along the road (world units), x across (-1..1 = road edges).
  R.frame = function (zw, xr, out) {
    out = out || {};
    var N = R.N, f = zw / C.segL, j = Math.floor(f), t = f - j;
    if (j < 0) { j = 0; t = 0; } else if (j >= N) { j = N - 1; t = 1; }
    var P = R.pts, a = j * 3, b = a + 3, th = R.heading[j] + (R.heading[j + 1] - R.heading[j]) * t;
    var cx = P[a] + (P[b] - P[a]) * t, cy = P[a + 1] + (P[b + 1] - P[a + 1]) * t, cz = P[a + 2] + (P[b + 2] - P[a + 2]) * t;
    var bank = R.bank[j] + (R.bank[j + 1] - R.bank[j]) * t, m = xr * R.roadHalf;
    var cs = Math.cos(th), sn = Math.sin(th);
    out.x = cx + cs * m; out.z = cz + sn * m; out.y = cy - m * Math.tan(bank);
    out.th = th; out.bank = bank;
    out.pitch = Math.atan2(P[b + 1] - P[a + 1], C.segL * C.S);
    return out;
  };
})();
