// Shared namespace, constants and small helper functions.
(function () {
  'use strict';
  var TB = (window.TB = window.TB || {});
  TB.W = 960;           // logical HUD size (the HUD is scaled to fit the window)
  TB.H = 540;
  TB.C = {
    segL: 200,            // length of one road segment (world units)
    roadW: 1500,          // road half width (world units), set per track
    S: 0.004,             // world units -> metres in the 3D scene
    YS: 0.4,              // extra vertical scale applied to hills in the 3D scene
    baseMax: 12000,       // reference top speed (world units / second)
    mphK: 0.0125          // world speed -> mph
  };

  var U = (TB.util = {});
  U.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.easeIn = function (a, b, p) { return a + (b - a) * p * p; };
  U.easeInOut = function (a, b, p) { return a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5); };
  U.rng = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  U.pickWeighted = function (list, rnd) {
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += list[i].wt;
    var r = rnd() * total;
    for (i = 0; i < list.length; i++) { r -= list[i].wt; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  };
  U.fmtTime = function (s) {
    if (!isFinite(s)) s = 0;
    var m = Math.floor(s / 60), sec = s - m * 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec.toFixed(2);
  };
  U.ordinal = function (n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };
})();
