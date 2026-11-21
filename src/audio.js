// Web Audio: every sound is synthesised (no sound files). Starts after the first key press or tap.
// The engine is a V-twin: one oscillator plays a "two uneven bangs per two turns" pulse shape (that is the lope of a big
// twin), through a filter and a soft clipper; wind, tyre and gravel are filtered noise; rivals get three cheap voices.
(function () {
  'use strict';
  var TB = window.TB;
  var A = (TB.audio = { ctx: null, ready: false, muted: false, vol: 0.5 });
  var clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  var rnd = Math.random;
  // dark, sparse riff (semitones above the track's root note); -1 = rest
  var RIFF = [0, -1, -1, 0, -1, 3, -1, -1, 0, -1, -1, 0, -1, 5, 3, -1, 0, -1, -1, 0, -1, 3, -1, -1, 7, -1, 5, -1, 3, -1, -1, -1];
  var nz = {}; // shared noise buffers

  function makeBuffers(c) {
    var n = c.sampleRate * 2, i, w = c.createBuffer(1, n, c.sampleRate), b = c.createBuffer(1, n, c.sampleRate), g = c.createBuffer(1, n, c.sampleRate);
    var dw = w.getChannelData(0), db = b.getChannelData(0), dg = g.getChannelData(0), last = 0, env = 0;
    for (i = 0; i < n; i++) {
      var x = rnd() * 2 - 1; dw[i] = x;
      last = (last + 0.02 * x) / 1.02; db[i] = last * 3.5; // brown noise: deep road rumble
      if (rnd() < 0.004) env = 0.4 + rnd() * 0.6; env *= 0.93; dg[i] = (rnd() * 2 - 1) * env; // crackly gravel
    }
    nz.w = w; nz.b = b; nz.g = g;
  }
  function loopSrc(c, buf) { var s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = 0; s.start(0, rnd() * 1.5); return s; }

  // One crank cycle (two turns) of a 45-degree V-twin: bangs at 0 and 315 degrees, the second a bit weaker.
  function twinWave(c, second, bright) {
    var N = 1024, H = 96, x = new Float32Array(N), re = new Float32Array(H), im = new Float32Array(H), i, k, n;
    function pulse(at, amp) {
      for (i = 0; i < N * 0.5; i++) {
        var u = i / N, v = u < 0.012 ? u / 0.012 : Math.exp(-(u - 0.012) / (bright ? 0.02 : 0.04));
        x[(Math.floor(at * N) + i) % N] += amp * v;
      }
    }
    pulse(0, 1); pulse(second, 0.78);
    for (k = 1; k < H; k++) { var a = 0, b = 0; for (n = 0; n < N; n++) { a += x[n] * Math.cos(2 * Math.PI * k * n / N); b += x[n] * Math.sin(2 * Math.PI * k * n / N); } re[k] = a / N; im[k] = -b / N; }
    return c.createPeriodicWave(re, im);
  }
  function clipCurve(k) { var n = 1024, cv = new Float32Array(n), i; for (i = 0; i < n; i++) { var x = i / (n / 2) - 1; cv[i] = Math.tanh(x * k) / Math.tanh(k); } return cv; }

  A.init = function () {
    try {
      if (A.ctx) { if (A.ctx.state !== 'running' && A.ctx.resume) A.ctx.resume(); return; } // iOS also uses 'interrupted'
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      A._attach(new AC());
      if (A.ctx.state !== 'running' && A.ctx.resume) A.ctx.resume(); // must happen inside the tap on iPhones
      document.addEventListener('visibilitychange', function () { try { if (document.hidden) A.ctx.suspend(); else A.ctx.resume(); } catch (e) {} });
    } catch (e) { A.ctx = null; A.ready = false; }
  };

  // builds the whole sound graph on a context (also used with an OfflineAudioContext for testing)
  A._attach = function (c) {
    A.ctx = c;
    makeBuffers(c);
    var comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    A.master = c.createGain(); A.master.gain.value = A.muted ? 0 : A.vol;
    A.master.connect(comp); comp.connect(c.destination);
    var sfx = (A.sfx = c.createGain()); sfx.gain.value = 1; sfx.connect(A.master);

    // ---- player engine
    var wave = twinWave(c, 0.4375, false), waveB = twinWave(c, 0.4375, true);
    var E = (A.E = {});
    E.o = c.createOscillator(); E.o.setPeriodicWave(wave);
    E.o2 = c.createOscillator(); E.o2.setPeriodicWave(waveB);
    E.sub = c.createOscillator(); E.sub.type = 'sine';
    E.lp = c.createBiquadFilter(); E.lp.type = 'lowpass'; E.lp.Q.value = 2.2; E.lp.frequency.value = 300;
    E.hp = c.createBiquadFilter(); E.hp.type = 'highpass'; E.hp.frequency.value = 28;
    E.shape = c.createWaveShaper(); E.shape.curve = clipCurve(2.6); E.shape.oversample = '2x';
    E.g = c.createGain(); E.g.gain.value = 0;
    E.gb = c.createGain(); E.gb.gain.value = 0.35; // bright layer
    E.gs = c.createGain(); E.gs.gain.value = 0.35;
    E.o.connect(E.lp); E.o2.connect(E.gb); E.gb.connect(E.lp); E.sub.connect(E.gs); E.gs.connect(E.lp);
    E.lp.connect(E.shape); E.shape.connect(E.hp); E.hp.connect(E.g); E.g.connect(A.master);
    E.mech = loopSrc(c, nz.w); E.mbp = c.createBiquadFilter(); E.mbp.type = 'bandpass'; E.mbp.Q.value = 0.9; E.mg = c.createGain(); E.mg.gain.value = 0;
    E.mech.connect(E.mbp); E.mbp.connect(E.mg); E.mg.connect(A.master);
    E.o.start(); E.o2.start(); E.sub.start();

    // ---- wind, tyre/road rumble, gravel/scrape
    var W = (A.W = {});
    W.s = loopSrc(c, nz.w); W.bp = c.createBiquadFilter(); W.bp.type = 'bandpass'; W.bp.Q.value = 0.5; W.g = c.createGain(); W.g.gain.value = 0;
    W.s.connect(W.bp); W.bp.connect(W.g); W.g.connect(A.master);
    var R = (A.Rd = {});
    R.s = loopSrc(c, nz.b); R.lp = c.createBiquadFilter(); R.lp.type = 'lowpass'; R.lp.frequency.value = 160; R.g = c.createGain(); R.g.gain.value = 0;
    R.s.connect(R.lp); R.lp.connect(R.g); R.g.connect(A.master);
    var Gv = (A.Gv = {});
    Gv.s = loopSrc(c, nz.g); Gv.bp = c.createBiquadFilter(); Gv.bp.type = 'bandpass'; Gv.bp.frequency.value = 1500; Gv.bp.Q.value = 0.7; Gv.g = c.createGain(); Gv.g.gain.value = 0;
    Gv.s.connect(Gv.bp); Gv.bp.connect(Gv.g); Gv.g.connect(A.master);

    // ---- three rival engine voices
    A.riv = [];
    for (var i = 0; i < 3; i++) {
      var v = { o: c.createOscillator(), lp: c.createBiquadFilter(), g: c.createGain(), pan: c.createStereoPanner ? c.createStereoPanner() : null, who: null };
      v.o.setPeriodicWave(wave); v.o.frequency.value = 20; v.lp.type = 'lowpass'; v.lp.frequency.value = 500; v.lp.Q.value = 1.2; v.g.gain.value = 0;
      v.o.connect(v.lp); v.lp.connect(v.g);
      if (v.pan) { v.g.connect(v.pan); v.pan.connect(A.master); } else v.g.connect(A.master);
      v.o.start(); A.riv.push(v);
    }

    // ---- music bus
    A.musicGain = c.createGain(); A.musicGain.gain.value = 0.32; A.musicGain.connect(A.master);
    A.nextNote = c.currentTime + 0.1; A.step = 0;
    A.rpm = 1100; A.gear = 0; A.shiftT = 0; A.blip = 0; A.lastUpd = -1; A.prevThr = 0; A.seen = new WeakMap(); A.lastWhoosh = 0; A.t0 = c.currentTime;
    A.ready = true;
  };

  A.toggleMute = function () {
    A.muted = !A.muted;
    try { if (A.master) A.master.gain.setTargetAtTime(A.muted ? 0 : A.vol, A.ctx.currentTime, 0.02); } catch (e) {}
  };

  var GEAR_TOP = [0.16, 0.34, 0.54, 0.76, 1.1];
  function set(p, v, t, k) { p.setTargetAtTime(v, t, k); }

  // Called every simulation step: speed fraction 0..1, throttle 0/1, engine running?
  A.engine = function (pct, thr, on) {
    if (!A.ready) return;
    try {
      var c = A.ctx, t = c.currentTime;
      if (t - A.lastUpd < 0.028) return;
      var dt = A.lastUpd < 0 ? 0.03 : Math.min(0.1, t - A.lastUpd); A.lastUpd = t;
      var G = TB.G, p = TB.player, st = G.state, active = st === 'countdown' || st === 'race' || st === 'finishing';
      var down = p && p.crashT >= 0, run = active && !down; // (the game says "off" while finishing; the bike still coasts, so ignore `on` there)
      if (!active) { A._silence(t); return; }
      pct = clamp(pct, 0, 1.05);
      // ---- gearbox: pick a gear from speed, with a little hysteresis; shifting makes a brief power cut and an rpm dip
      var g = A.gear;
      if (pct > GEAR_TOP[g] && g < 4) { g++; A.shiftT = 0.16; A.rpmKick = -1400; }
      else if (g > 0 && pct < GEAR_TOP[g - 1] - 0.05) { g--; A.shiftT = 0.12; A.rpmKick = 700; }
      A.gear = g;
      var lo = g ? GEAR_TOP[g - 1] : 0, fr = clamp((pct - lo) / (GEAR_TOP[g] - lo), 0, 1.1);
      var target = (g ? 3000 : 1250) + fr * (g ? 3500 : 3300);
      if (!run) target = 1100 + pct * 600;
      if (st === 'countdown' || (pct < 0.02 && thr > 0)) target = 1250 + (thr ? 3800 : 0); // idle, or revving on the line
      if (A.blip > 0) { target += A.blip * 5500; A.blip -= dt; }
      if (A.shiftT > 0) { A.shiftT -= dt; target += (A.rpmKick || 0) * Math.min(1, A.shiftT / 0.1); }
      var kk = target > A.rpm ? 0.2 : 0.07; A.rpm += (target - A.rpm) * (1 - Math.pow(kk, dt * 10)) ;
      var rpm = clamp(A.rpm, 900, 7200), rf = (rpm - 900) / 6300;
      var cyc = rpm / 120 * (1 + (rnd() - 0.5) * 0.004); // crank-cycle frequency: one cycle = two turns = two bangs
      set(A.E.o.frequency, cyc, t, 0.03); set(A.E.o2.frequency, cyc, t, 0.03); set(A.E.sub.frequency, cyc * 2, t, 0.03);
      var load = run ? (thr ? 1 : 0.35) : 0.25, cut = A.shiftT > 0 ? 0.35 : 1;
      set(A.E.lp.frequency, 260 + rf * 1500 + load * 700 * (0.4 + rf), t, 0.05);
      set(A.E.gb.gain, 0.12 + 0.55 * load * rf, t, 0.06);
      set(A.E.g.gain, (run || st === 'finishing') ? (0.27 + 0.2 * load + 0.08 * rf) * cut : 0, t, 0.04);
      set(A.E.mbp.frequency, 700 + rf * 2600, t, 0.08);
      set(A.E.mg.gain, run ? 0.012 + 0.03 * rf * load : 0, t, 0.08);
      // crackle when the throttle is let go at high revs
      if (run && A.prevThr > 0 && !thr && rpm > 4200 && rnd() < 0.8) { A.pop(); }
      if (run && !thr && rpm > 3600 && rnd() < 0.05) A.pop();
      A.prevThr = thr;
      // ---- wind, tyres, gravel
      var rough = p ? clamp((Math.abs(p.x) - 0.9) * 8, 0, 1) : 0, gust = 0.85 + 0.15 * Math.sin(t * 1.9) * Math.sin(t * 0.7 + 1);
      set(A.W.bp.frequency, 350 + pct * 2400, t, 0.1);
      set(A.W.g.gain, active ? Math.pow(pct, 2.2) * 0.34 * gust : 0, t, 0.15);
      set(A.Rd.lp.frequency, 140 + pct * 260 + rough * 160, t, 0.1);
      set(A.Rd.g.gain, (down ? 0 : pct * 0.5) * (1 + rough * 1.2), t, 0.1);
      var scrape = down ? clamp(pct * 3, 0, 1) : 0;
      set(A.Gv.bp.frequency, down ? 2200 : 1100 + pct * 700, t, 0.1);
      set(A.Gv.g.gain, Math.max(rough * clamp(pct * 1.5, 0, 1) * 0.55, scrape * 0.9), t, 0.06);
      // ---- rivals, traffic passing
      A._others(t, dt, p, pct);
    } catch (e) {}
  };
  A._silence = function (t) {
    var i; set(A.E.g.gain, 0, t, 0.05); set(A.E.mg.gain, 0, t, 0.05); set(A.W.g.gain, 0, t, 0.08); set(A.Rd.g.gain, 0, t, 0.08); set(A.Gv.g.gain, 0, t, 0.08);
    for (i = 0; i < 3; i++) set(A.riv[i].g.gain, 0, t, 0.08);
    A.rpm = 1100; A.gear = 0;
  };

  // rival engines (three nearest, panned and quieter) and the whoosh when something is passed
  A._others = function (t, dt, p, pct) {
    if (!p) return;
    var C = TB.C, list = TB.rivals ? TB.rivals.list : [], i, j, best = [], r;
    for (i = 0; i < list.length; i++) {
      r = list[i]; var dz = r.z - p.z;
      var d = Math.abs(dz);
      if (r.crashT < 0 && d < 24000) best.push({ r: r, d: d, dz: dz });
      var prev = A.seen.get(r);
      if (prev !== undefined && Math.abs(prev) < 3000 && prev * dz <= 0 && prev !== dz && Math.abs(r.x - p.x) < 0.45) A.whoosh(Math.abs(r.speed - p.speed) / (p.maxSp || 1), r.x - p.x, 0.5);
      A.seen.set(r, dz);
    }
    best.sort(function (a, b) { return a.d - b.d; });
    for (i = 0; i < 3; i++) {
      var v = A.riv[i], b = best[i];
      if (!b) { set(v.g.gain, 0, t, 0.1); continue; }
      r = b.r; var rp = clamp(r.speed / (r.maxSp || p.maxSp || 1), 0, 1.05);
      j = list.indexOf(r) % 5; var rr = 1500 + rp * 4800 + j * 130;
      var closing = clamp((p.speed - r.speed) * (b.dz < 0 ? -1 : 1) / 9000, -1, 1);
      set(v.o.frequency, rr / 120 * (1 + 0.05 * closing) * (1 + j * 0.011), t, 0.1);
      var near = clamp(1 - b.d / 24000, 0, 1), behind = b.dz < 0 ? 0.55 : 1;
      set(v.lp.frequency, 200 + rp * 600 + near * 500 * behind, t, 0.1);
      set(v.g.gain, near * near * 0.2 * behind, t, 0.1);
      if (v.pan) set(v.pan.pan, clamp((r.x - p.x) * 1.4, -0.9, 0.9), t, 0.1);
    }
    var tl = TB.traffic ? TB.traffic.list : [];
    for (i = 0; i < tl.length; i++) {
      var tr = tl[i], dz2 = tr.z - p.z, pv = A.seen.get(tr);
      if (pv !== undefined && Math.abs(pv) < 3000 && pv > 0 && dz2 <= 0 && Math.abs(tr.x - p.x) < 0.6) A.whoosh(Math.abs(p.speed - (tr.speed || 0)) / (p.maxSp || 1), tr.x - p.x, 1);
      A.seen.set(tr, dz2);
    }
  };

  // ------------------------------------------------------------ one-shot sounds
  function out() { return A.sfx; }
  function noiseBurst(dur, f0, f1, vol, type, q, delay, pan) {
    var c = A.ctx, t = c.currentTime + (delay || 0);
    var src = c.createBufferSource(); src.buffer = nz.w;
    var flt = c.createBiquadFilter(); flt.type = type || 'lowpass'; if (q) flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t); flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    var g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(0.012, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(flt); flt.connect(g);
    if (pan && c.createStereoPanner) { var p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(out()); } else g.connect(out());
    src.start(t, rnd() * 1.5); src.stop(t + dur + 0.05);
  }
  function tone(freq, f2, dur, vol, type, delay, lpf) {
    var c = A.ctx, t = c.currentTime + (delay || 0), o = c.createOscillator(), g = c.createGain(), last = g;
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g);
    if (lpf) { var f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lpf; g.connect(f); last = f; }
    last.connect(out()); o.start(t); o.stop(t + dur + 0.05);
  }
  // exhaust pop
  A.pop = function () { if (!A.ready) return; try { var d = rnd() * 0.12; noiseBurst(0.06, 1800, 300, 0.1 + rnd() * 0.08, 'bandpass', 1.5, d); tone(120, 60, 0.05, 0.12, 'sine', d); } catch (e) {} };
  // a vehicle or rider passing close by
  A.whoosh = function (rel, side, k) {
    if (!A.ready) return; var c = A.ctx; if (c.currentTime - A.lastWhoosh < 0.12) return; A.lastWhoosh = c.currentTime;
    try { var v = clamp(0.12 + rel * 0.9, 0.1, 0.9) * (k || 1) * 0.55; noiseBurst(0.5 + 0.2 * (1 - rel), 600 + rel * 1600, 180, v, 'bandpass', 0.8, 0, clamp(side * 1.6, -0.9, 0.9)); } catch (e) {}
  };
  // punch or kick landing: body thump, leather slap, a little grit
  A.thud = function () {
    if (!A.ready) return;
    try {
      var k = 0.85 + rnd() * 0.3;
      tone(150 * k, 38, 0.26, 1.1, 'sine'); tone(300 * k, 70, 0.1, 0.35, 'triangle');
      noiseBurst(0.12, 1400, 160, 0.5, 'lowpass', 0.7); noiseBurst(0.035, 3500, 1800, 0.28, 'bandpass', 1.2);
    } catch (e) {}
  };
  // wreck: impact boom, crunching and tearing, a few metal clinks, then the slide (the sliding loop runs in engine())
  A.crash = function () {
    if (!A.ready) return;
    try {
      var p = TB.player, mine = p && p.crashT >= 0 && p.crashT < 0.2, v = mine ? 1 : 0.3, i;
      tone(95, 26, 0.75, 1.0 * v, 'sine'); tone(210, 50, 0.3, 0.5 * v, 'triangle');
      noiseBurst(0.35, 2600, 200, 0.7 * v, 'lowpass', 0.7);
      for (i = 0; i < 7; i++) noiseBurst(0.05 + rnd() * 0.1, 500 + rnd() * 3000, 300, (0.25 + rnd() * 0.3) * v, 'bandpass', 3 + rnd() * 4, 0.02 + i * 0.06 + rnd() * 0.05, rnd() - 0.5);
      for (i = 0; i < 4; i++) tone(700 + rnd() * 2400, 0, 0.12 + rnd() * 0.12, 0.07 * v, 'sine', 0.05 + rnd() * 0.5);
      noiseBurst(0.9, 3200, 700, 0.22 * v, 'highpass', 0.7, 0.1);
    } catch (e) {}
  };
  A.swing = function () { if (!A.ready) return; try { noiseBurst(0.14, 700, 2600, 0.14, 'bandpass', 1.1); } catch (e) {} };
  // countdown tick and similar: gritty low buzz (a square plus a saw, rounded off)
  A.beep = function (f, d, vol) {
    if (!A.ready) return;
    try { d = d || 0.15; vol = vol || 0.25; tone(f * 0.5, 0, d, vol * 0.8, 'sawtooth', 0, 900); tone(f * 0.5 * 1.006, 0, d, vol * 0.8, 'square', 0, 700); tone(f * 0.25, f * 0.2, d, vol, 'sine'); } catch (e) {}
  };
  // GO: a rev blip and a harsh two-note horn
  A.go = function () {
    if (!A.ready) return;
    try {
      A.blip = 0.45;
      tone(220, 0, 0.5, 0.3, 'sawtooth', 0, 1400); tone(277, 0, 0.5, 0.26, 'sawtooth', 0, 1400); tone(110, 0, 0.5, 0.3, 'square', 0, 500);
      noiseBurst(0.2, 3000, 600, 0.12, 'highpass');
    } catch (e) {}
  };
  // coins: two dull metallic pings
  A.cash = function () { if (!A.ready) return; try { tone(1240, 0, 0.18, 0.12, 'sine'); tone(1865, 0, 0.3, 0.1, 'sine', 0.07); tone(620, 0, 0.1, 0.08, 'triangle', 0.07); } catch (e) {} };
  // menu click: a stiff mechanical switch
  A.menu = function () { if (!A.ready) return; try { noiseBurst(0.025, 3200, 1500, 0.2, 'bandpass', 1.5); tone(210, 110, 0.07, 0.22, 'triangle'); } catch (e) {} };

  // Dark, sparse bass riff with a heavy kick; scheduled a little ahead of time. Kept quiet so the engine rules.
  A.music = function (on, root) {
    if (!A.ready || !on) return;
    try {
      var c = A.ctx, stepDur = 60 / 108 / 4;
      if (A.nextNote < c.currentTime) A.nextNote = c.currentTime + 0.05;
      while (A.nextNote < c.currentTime + 0.2) {
        var s = A.step % 32, semi = RIFF[s], t = A.nextNote;
        if (semi >= 0) {
          var f = (root || 55) * Math.pow(2, semi / 12), o = c.createOscillator(), o2 = c.createOscillator(), fl = c.createBiquadFilter(), g = c.createGain();
          o.type = 'sawtooth'; o.frequency.value = f; o2.type = 'square'; o2.frequency.value = f * 0.5;
          fl.type = 'lowpass'; fl.frequency.setValueAtTime(900, t); fl.frequency.exponentialRampToValueAtTime(180, t + stepDur * 1.6);
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.012); g.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 2.2);
          o.connect(fl); o2.connect(fl); fl.connect(g); g.connect(A.musicGain); o.start(t); o2.start(t); o.stop(t + stepDur * 2.4); o2.stop(t + stepDur * 2.4);
        }
        if (s % 8 === 0) { // kick
          var k = c.createOscillator(), kg = c.createGain();
          k.frequency.setValueAtTime(130, t); k.frequency.exponentialRampToValueAtTime(40, t + 0.12);
          kg.gain.setValueAtTime(0.5, t); kg.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
          k.connect(kg); kg.connect(A.musicGain); k.start(t); k.stop(t + 0.25);
        }
        if (s % 4 === 2) { // dry tick
          var h = c.createBufferSource(), hf = c.createBiquadFilter(), hg = c.createGain();
          h.buffer = nz.w; hf.type = 'highpass'; hf.frequency.value = 6000; hg.gain.setValueAtTime(0.07, t); hg.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
          h.connect(hf); hf.connect(hg); hg.connect(A.musicGain); h.start(t, rnd()); h.stop(t + 0.05);
        }
        A.step++; A.nextNote += stepDur;
      }
    } catch (e) {}
  };
})();
