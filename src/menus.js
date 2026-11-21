// Menu logic (no drawing): which screen is showing and what the keys do. The look lives in src/render/ui.js.
(function () {
  'use strict';
  var TB = window.TB;
  var M = (TB.menus = {});

  M.update = function (dt, I) {
    var G = TB.G, save = TB.save;
    if (G.msgT > 0) G.msgT -= dt;
    switch (G.state) {
      case 'title':
        if (I.hit('confirm')) { G.state = 'select'; TB.audio.menu(); }
        break;
      case 'select':
        if (I.hit('left')) { G.sel = (G.sel + 2) % 3; TB.audio.menu(); }
        if (I.hit('right')) { G.sel = (G.sel + 1) % 3; TB.audio.menu(); }
        if (I.hit('back')) G.state = 'title';
        if (I.hit('up') || I.hit('down')) {
          var nl = save.level + (I.hit('up') ? 1 : -1);
          if (nl >= 0 && nl < TB.levels.length) {
            if (save.levels[nl]) { save.level = nl; TB.audio.menu(); TB.writeSave(); }
            else { G.msg = 'Finish top 3 on all three tracks on ' + TB.levels[nl - 1].name + ' first.'; G.msgT = 2.5; TB.audio.beep(150, 0.25, 0.25); }
          }
        }
        if (I.hitCode('KeyT') && TB.canDuo()) { G.duo = !G.duo; TB.audio.menu(); }
        if (I.hitCode('KeyV')) TB.toggleAutoGasKb();
        if (I.hitCode('KeyG')) { G.state = 'garage'; G.gsel = save.bike; TB.audio.menu(); }
        if (I.hit('confirm')) {
          if (save.unlocked[G.sel]) TB.startRace(G.sel);
          else { G.msg = 'Locked! Finish top 3 on the previous track.'; G.msgT = 2; TB.audio.beep(150, 0.25, 0.25); }
        }
        break;
      case 'results':
        if (I.hit('confirm')) { G.state = 'garage'; G.gsel = save.bike; TB.audio.menu(); }
        break;
      case 'garage':
        if (I.hit('left')) { G.gsel = (G.gsel + 3) % 4; TB.audio.menu(); }
        if (I.hit('right')) { G.gsel = (G.gsel + 1) % 4; TB.audio.menu(); }
        if (I.hit('back') || I.hit('space')) { G.state = 'select'; TB.audio.menu(); }
        if (I.hit('confirm')) {
          var b = TB.bikes[G.gsel];
          if (save.bikes[G.gsel]) { save.bike = G.gsel; G.msg = b.name + ' equipped.'; TB.audio.menu(); }
          else if (save.cash >= b.price) { save.cash -= b.price; save.bikes[G.gsel] = 1; save.bike = G.gsel; G.msg = 'Bought the ' + b.name + '!'; TB.audio.cash(); }
          else { G.msg = 'Not enough cash.'; TB.audio.beep(150, 0.25, 0.25); }
          G.msgT = 2; TB.writeSave();
        }
        break;
    }
  };

})();
