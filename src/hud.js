// Toast messages ("WIPEOUT!", "KO ..."). The look lives in src/render/ui.js.
(function () {
  'use strict';
  var TB = window.TB;
  var HUD = (TB.hud = { toasts: [], seq: 0 });

  var TONE = { '#ffd23f': '#d4a63a', '#ff5a3c': '#c9503a', '#fff': '#d9d1bd' }; // dusty versions of the old bright colours
  HUD.toast = function (text, col) {
    HUD.toasts.push({ text: text, col: TONE[col] || col || '#d9d1bd', t: 0, id: ++HUD.seq });
    if (HUD.toasts.length > 4) HUD.toasts.shift();
  };
  HUD.clear = function () { HUD.toasts.length = 0; };
  HUD.tick = function (dt) {
    for (var i = HUD.toasts.length - 1; i >= 0; i--) { HUD.toasts[i].t += dt; if (HUD.toasts[i].t > 2.2) HUD.toasts.splice(i, 1); }
  };
})();
