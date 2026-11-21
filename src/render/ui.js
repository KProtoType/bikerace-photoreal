// HTML/CSS overlay: title, track select, garage, results, race HUD and pause screen.
export function createUI(TB) {
  const $ = (s, r = document) => r.querySelector(s);
  const U = TB.util, root = $('#ui');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const kb = (t) => `<span class="key">${t}</span>`;
  // on-screen buttons (shown on touch screens only; touch.js wires up the data-act names)
  const btn = (act, label, cls = '') => `<button type="button" class="tbtn ${cls}" data-act="${act}">${label}</button>`;
  const AG = btn('autogas', 'AUTO-GAS: ON', 'js-autogas small'), FS = btn('fullscreen', 'FULLSCREEN', 'js-fs small'), SND = btn('sound', 'SOUND', 'small');

  if (!document.getElementById('grainfx')) document.body.appendChild(Object.assign(document.createElement('div'), { id: 'grainfx' }));
  root.innerHTML = `
  <div id="s-title" class="screen"><div class="vig"></div>
    <div class="logo"><span class="l1">Bike</span><span class="l2">race</span><div class="rule"></div></div>
    <div class="tagline">Race eight rivals. Punch and kick riders beside you. Finish on the podium to win cash and unlock bikes and tracks.</div>
    <div class="controls panel kb-only"><h3>CONTROLS</h3><div class="grid">
      <div>${kb('W')}${kb('&uarr;')} Throttle</div><div>${kb('Z')}${kb('J')} Punch left</div>
      <div>${kb('S')}${kb('&darr;')} Brake</div><div>${kb('X')}${kb('K')} Punch right</div>
      <div>${kb('A')}${kb('D')}${kb('&larr;')}${kb('&rarr;')} Steer</div><div>${kb('C')}${kb('L')} Kick</div>
      <div>${kb('P')}${kb('Esc')} Pause</div><div>${kb('O')} Weather &nbsp;${kb('U')} Quality &nbsp;${kb('I')} Compare</div></div></div>
    <div class="controls panel touch-only"><h3>TOUCH CONTROLS</h3><div class="grid">
      <div><b>Left thumb</b> LEFT / RIGHT to steer</div><div><b>Right thumb</b> PUNCH L, PUNCH R, KICK</div>
      <div>Gas is automatic (turn off in pause)</div><div>BRAKE slows you down</div>
      <div>Pause: button at top right</div><div>Turn your phone sideways</div></div></div>
    <div class="press blink kb-only">PRESS ENTER TO START</div>
    <div class="press blink touch-only">TAP TO START</div>
    <div class="title-tools touch-only">${FS}</div>
  </div>
  <div id="s-select" class="screen"><div class="dim-bg"></div>
    <div class="topline"><span id="sel-bike"></span><span class="screen-title" style="position:static;font-size:40px">SELECT TRACK</span><span class="cash" id="sel-cash"></span></div>
    <div class="modes"><button type="button" class="pill" data-act="level"><b id="sel-level"></b></button><button type="button" class="pill kb-only" id="sel-players" data-act="players"><b id="sel-duo"></b></button><button type="button" class="pill kb-only" id="sel-ag" data-act="autogaskb"><b id="sel-agt"></b></button></div>
    <div class="cards" id="cards"></div>
    <div class="msg" id="sel-msg"></div>
    <div class="hint kb-only" id="sel-hint">${kb('&larr;')}${kb('&rarr;')} choose &nbsp; ${kb('&uarr;')}${kb('&darr;')} level &nbsp; ${kb('T')} 1 or 2 players &nbsp; ${kb('V')} auto-gas &nbsp; ${kb('Enter')} race &nbsp; ${kb('G')} garage &nbsp; ${kb('Esc')} title</div>
    <div class="hint kb-only duo-keys" id="sel-duokeys">P1: ${kb('W')}${kb('A')}${kb('S')}${kb('D')} drive, ${kb('Z')}${kb('X')} punch, ${kb('C')} kick &nbsp;&nbsp; P2: arrows drive, ${kb('J')}${kb('K')} punch, ${kb('L')} kick</div>
    <div class="tbar touch-only">${btn('back', 'BACK')}${btn('garage', 'GARAGE')}${AG}${SND}${FS}${btn('go', 'RACE', 'go')}</div>
  </div>
  <div id="s-garage" class="screen"><div class="dim-bg"></div>
    <div class="screen-title">GARAGE</div>
    <div class="topline"><span></span><span></span><span class="cash" id="gar-cash"></span></div>
    <div class="garage-main"><div class="name outline" id="gar-name" style="margin-top:34px"></div></div>
    <div class="statbox panel"><div class="status disp" id="gar-status" style="font-size:26px;margin-bottom:6px"></div>
      <div class="row"><span>SPEED</span><div class="bar hot"><i id="st-top"></i></div></div>
      <div class="row"><span>ACCEL</span><div class="bar blue"><i id="st-acc"></i></div></div>
      <div class="row"><span>GRIP</span><div class="bar"><i id="st-grip"></i></div></div>
      <div class="nums" id="gar-nums"></div><div class="desc" id="gar-desc"></div></div>
    <div class="bikecards" id="bikecards"></div>
    <div class="msg" id="gar-msg" style="bottom:100px;color:#d4a63a"></div>
    <div class="hint kb-only">${kb('&larr;')}${kb('&rarr;')} browse &nbsp; ${kb('Enter')} buy or equip &nbsp; ${kb('Space')} back to tracks</div>
    <div class="tbar touch-only">${btn('gback', 'BACK TO TRACKS')}${btn('gprev', '&lt; PREV')}${btn('gnext', 'NEXT &gt;')}${btn('gact', 'EQUIP', 'go js-gact')}</div>
  </div>
  <div id="s-results" class="screen"><div class="dim-bg"></div>
    <div class="screen-title" style="top:14px;font-size:46px">RACE RESULTS</div>
    <div class="topline" style="top:70px;justify-content:center;color:#9b9482;letter-spacing:3px" id="res-sub"></div>
    <div class="res-grid"><div class="panel ranktbl" id="res-tbl"></div><div class="panel earn" id="res-earn"></div></div>
    <div class="hint blink kb-only" style="font:24px var(--display);letter-spacing:6px;color:#d9d1bd">PRESS ENTER FOR THE GARAGE</div>
    <div class="tbar touch-only">${btn('next', 'CONTINUE TO THE GARAGE', 'go')}</div>
  </div>
  <div id="hud">
    <div class="h-pos panel skew"><div class="n" id="h-place">1ST</div><div class="t" id="h-total">/9</div></div>
    <div class="h-prog panel"><div class="trk" id="h-trk"></div><div class="time" id="h-time">0:00.00</div></div>
    <div class="h-cash panel skew"><span id="h-cash">$0</span></div>
    <div class="h-rival panel" id="h-rival" hidden><div class="nm" id="h-rname"></div><div class="bar hot"><i id="h-rbar"></i></div></div>
    <div class="h-speed panel skew"><div class="v" id="h-mph">0</div><div class="u">MPH</div><div class="bar blue" id="h-sbar"><i></i></div></div>
    <div class="h-health panel skew"><div class="lb">HEALTH</div><div class="bar seg10" id="h-hbar"><i></i></div></div>
    <div class="dh-div"></div>
    ${[0, 1].map((i) => `<div class="dh dh${i}" id="dh${i}"><div class="dh-pos panel"><span class="who">P${i + 1}</span><span class="n"></span></div>
      <div class="dh-rival panel"><div class="nm"></div><div class="bar hot"><i></i></div></div>
      <div class="dh-c outline"></div>
      <div class="dh-low panel"><div class="v"></div><div class="u">MPH</div><div class="bar hp seg10"><i></i></div></div><div class="dh-down"><div class="dn-t">DOWN</div><div class="dn-n"></div><div class="dn-s">GETTING UP</div></div></div>`).join('')}
    <div class="h-toasts" id="h-toasts"></div>
    <div class="h-center outline" id="h-center" hidden></div>
    <div class="h-down" id="h-down" hidden><div class="dn-t">DOWN</div><div class="dn-n"></div><div class="dn-s">GETTING UP</div></div>
    <div class="h-pause" id="h-pause"><div class="t outline disp">PAUSED</div><p class="kb-only">${kb('P')} ${kb('Esc')} ${kb('Enter')} resume &nbsp;&nbsp; ${kb('Q')} quit to track select &nbsp;&nbsp; ${kb('V')} auto-gas</p>
      <div class="kb-only pausebar2"><button type="button" class="pill" id="pause-ag" data-act="autogaskb"><b id="pause-agt"></b></button></div>
      <div class="tbar pausebar touch-only">${btn('resume', 'RESUME', 'go')}${btn('quit', 'QUIT TO TRACKS')}${AG}${SND}${FS}</div></div>
  </div>`;

  const screens = { title: $('#s-title'), select: $('#s-select'), garage: $('#s-garage'), results: $('#s-results') };
  const hud = $('#hud');

  // ---- track cards (shapes drawn with CSS)
  const ART = [
    `<div class="sky" style="background:linear-gradient(#1f64c8,#8cc6ef 60%,#cfe8f7)"></div><div class="sun" style="left:70%;top:14px;width:22px;height:22px;background:#fff6c8;box-shadow:0 0 22px 8px rgba(255,246,200,.8)"></div>
     <div class="mt" style="left:-10px;width:190px;height:78px;background:#8398b8;clip-path:polygon(0 100%,38% 12%,52% 38%,64% 20%,100% 100%)"></div><div class="mt" style="left:44px;bottom:84px;width:36px;height:24px;background:#fff;clip-path:polygon(50% 0,100% 100%,64% 68%,50% 100%,36% 70%,0 100%)"></div>
     <div class="mt" style="left:130px;width:200px;height:62px;background:#6d86a8;clip-path:polygon(0 100%,40% 20%,62% 50%,80% 8%,100% 100%)"></div>
     <div class="lake" style="background:linear-gradient(#17a6c4,#0b5c96)"></div><div class="ground" style="background:linear-gradient(#2f6b34,#1f4a26)"></div>
     <div class="mt" style="left:20px;bottom:24px;width:30px;height:48px;background:#1d4a2c;clip-path:polygon(50% 0,100% 100%,0 100%)"></div><div class="mt" style="left:46px;bottom:20px;width:24px;height:38px;background:#245a35;clip-path:polygon(50% 0,100% 100%,0 100%)"></div>
     <div class="mt" style="right:18px;bottom:22px;width:34px;height:54px;background:#1d4a2c;clip-path:polygon(50% 0,100% 100%,0 100%)"></div><div class="rd" style="background:linear-gradient(#5b5f68,#3d4047)"></div>`,
    `<div class="sky" style="background:linear-gradient(#2a6fc9,#f2a766 55%,#ffd9a0)"></div><div class="sun" style="left:24%;top:24px;width:30px;height:30px;background:#fff0c4;box-shadow:0 0 26px 10px rgba(255,230,170,.8)"></div>
     <div class="mt" style="left:30px;width:110px;height:62px;background:#c97b47;clip-path:polygon(0 100%,10% 20%,86% 20%,100% 100%)"></div><div class="mt" style="left:170px;width:130px;height:84px;background:#a85a32;clip-path:polygon(0 100%,14% 14%,80% 14%,100% 100%)"></div>
     <div class="ground" style="background:linear-gradient(#e0b073,#c48850)"></div><div class="mt" style="left:60px;bottom:14px;width:12px;height:36px;background:#4c8a46;border-radius:6px 6px 0 0"></div><div class="mt" style="right:40px;bottom:10px;width:12px;height:42px;background:#4c8a46;border-radius:6px 6px 0 0"></div>
     <div class="rd" style="background:linear-gradient(#565250,#3a3735)"></div>`,
    `<div class="sky" style="background:linear-gradient(#1b78d8,#7cc4f2 60%,#cdeeff)"></div><div class="sun" style="left:66%;top:20px;width:26px;height:26px;background:#fffbe6;box-shadow:0 0 24px 8px rgba(255,250,220,.8)"></div>
     <div class="mt" style="left:-20px;width:160px;height:44px;background:#78b25f;clip-path:polygon(0 100%,30% 20%,70% 60%,100% 100%)"></div>
     <div class="lake" style="bottom:20px;height:34px;background:linear-gradient(#32b5d6,#0e6fb0)"></div><div class="ground" style="height:30px;background:linear-gradient(#7ac05d,#5ea94c)"></div>
     <div class="mt" style="right:30px;bottom:22px;width:6px;height:56px;background:#7a5c3c;transform:rotate(8deg)"></div><div class="mt" style="right:6px;bottom:62px;width:58px;height:22px;background:#2e9a47;border-radius:50% 50% 10% 10%"></div>
     <div class="rd" style="background:linear-gradient(#6a6a70,#46464c)"></div>`
  ];
  const cardsEl = $('#cards');
  cardsEl.innerHTML = TB.tracks.map((tr, i) => `<div class="card" data-i="${i}"><div class="art">${ART[i]}</div><h4 class="disp">${esc(tr.name)}</h4><p>${esc(tr.tag)}</p>
    <div class="meta"><div class="stars">${'&#9632;'.repeat(tr.stars)}<b>${'&#9632;'.repeat(3 - tr.stars)}</b> <span class="dim" style="font-size:12px">difficulty</span></div><div class="best dim" style="margin-top:6px"></div></div>
    <div class="lock"><div class="big">LOCKED</div><div style="margin-top:8px;font-size:13px">Finish in the top 3 on ${i ? esc(TB.tracks[i - 1].name) : ''} to unlock.</div></div></div>`).join('');
  const cardEls = [...cardsEl.children];
  const bikeEl = $('#bikecards');
  bikeEl.innerHTML = TB.bikes.map((b, i) => `<div class="bc" data-i="${i}"><div class="sw" style="background:${b.body}"></div><div class="n">${esc(b.name)}</div><div class="p"></div></div>`).join('');
  const bikeEls = [...bikeEl.children];
  // progress bar: ticks + dots
  const trk = $('#h-trk'); let dots = [], meDots = [];
  function buildProgress() {
    trk.innerHTML = ''; for (let i = 1; i < 10; i++) { const t = document.createElement('div'); t.className = 'tick'; t.style.left = i * 10 + '%'; trk.appendChild(t); }
    dots = TB.rivals.list.map((r) => { const d = document.createElement('div'); d.className = 'dot'; d.style.background = r.suit; trk.appendChild(d); return d; });
    meDots = TB.humans.map((h, i) => { const d = document.createElement('div'); d.className = 'dot me'; if (i) { d.style.background = '#c9503a'; d.style.boxShadow = '0 0 8px rgba(201,80,58,0.7)'; } trk.appendChild(d); return d; });
  }

  let cur = '', lastRace = -1, cache = {}, toastSeen = 0;
  const set = (key, el, val, prop = 'textContent') => { if (cache[key] !== val) { cache[key] = val; el[prop] = val; } };
  const E = { place: $('#h-place'), total: $('#h-total'), time: $('#h-time'), cash: $('#h-cash'), mph: $('#h-mph'), rival: $('#h-rival'), rname: $('#h-rname'), rbar: $('#h-rbar'),
    sbar: $('#h-sbar'), down: $('#h-down'), dn: $('#h-down .dn-n'), hbar: $('#h-hbar'), toasts: $('#h-toasts'), center: $('#h-center'), pause: $('#h-pause') };
  const DH = [0, 1].map((i) => { const e = $('#dh' + i); return { n: $('.dh-pos .n', e), v: $('.dh-low .v', e), hp: $('.dh-low .hp i', e), hpb: $('.dh-low .hp', e), rival: $('.dh-rival', e), rn: $('.dh-rival .nm', e), rb: $('.dh-rival i', e), c: $('.dh-c', e), down: $('.dh-down', e), dn: $('.dh-down .dn-n', e) }; });
  const agEls = { set textContent(v) { document.querySelectorAll('.js-autogas').forEach((e) => { e.textContent = v; }); } };
  const kbEls = { set textContent(v) { ['#sel-agt', '#pause-agt'].forEach((q) => { $(q).textContent = v; }); $('#sel-ag').classList.toggle('on', !!TB.autoGasKb); $('#pause-ag').classList.toggle('on', !!TB.autoGasKb); } };
  const pct = (v) => Math.round(U.clamp(v, 0, 1) * 1000) / 10 + '%';

  function showScreen(name) {
    for (const k in screens) screens[k].classList.toggle('on', k === name);
    hud.classList.toggle('on', name === 'hud');
  }

  function fillResults(G) {
    const res = G.results; if (!res) return;
    $('#res-sub').textContent = TB.tracks[G.trackIdx].name.toUpperCase() + '    ' + U.fmtTime(res.time);
    $('#res-tbl').innerHTML = res.order.map((o, i) => `<div class="r ${o.isPlayer ? 'me' : ''}"><span class="pos ${i === 0 ? 'gold' : ''}">${U.ordinal(i + 1)}</span><span class="dot" style="background:${o.suit}"></span><span class="${o.isPlayer ? 'gold' : ''}">${esc(o.name)}</span><span class="dim" style="text-align:right;font-size:12px">${o.fin ? U.fmtTime(o.t) : o.out ? 'OUT' : 'racing'}</span></div>`).join('');
    const big = res.duo ? res.players.map((q) => `<div class="place duo disp outline ${q.place === 1 ? 'gold' : ''}">${esc(q.name)} ${U.ordinal(q.place)}</div>`).join('') : `<div class="place disp outline ${res.place === 1 ? 'gold' : ''}">${U.ordinal(res.place) + ' place'}</div>`;
    const prizes = res.duo ? res.players.map((q) => `<div class="line"><span>${esc(q.name)} prize</span><b>$${q.prize}</b></div>`).join('') : `<div class="line"><span>Prize money</span><b>$${res.prize}</b></div>`;
    $('#res-earn').innerHTML = `${big}
      ${prizes}<div class="line"><span>KO bonus (${res.kos} KO)</span><b>$${res.koCash}</b></div>
      <div class="line tot"><span>Total earned</span><b>$${res.prize + res.koCash}</b></div><div class="line"><span>Cash now</span><b>$${TB.save.cash}</b></div>
      ${res.best ? '<div class="disp gold outline" style="font-size:28px;margin-top:14px;letter-spacing:3px">NEW BEST TIME!</div>' : ''}
      ${res.unlocked ? `<div class="disp green outline" style="font-size:20px;margin-top:10px">TRACK UNLOCKED: ${esc(res.unlocked.toUpperCase())}</div>` : ''}
      ${res.levelUp ? `<div class="disp green outline" style="font-size:20px;margin-top:10px">LEVEL UNLOCKED: ${esc(res.levelUp.toUpperCase())}</div>` : ''}`;
  }

  function update(G, hudOn) {
    const st = G.state, racing = st === 'countdown' || st === 'race' || st === 'finishing' || st === 'paused';
    const name = racing ? 'hud' : st;
    if (TB.touch) { const t = 'AUTO-GAS: ' + (TB.touch.autoGas ? 'ON' : 'OFF'); set('ag', agEls, t, 'textContent'); }
    const kbT = 'AUTO-GAS: ' + (TB.autoGasKb ? 'ON' : 'OFF') + '  (V)'; set('agkb', kbEls, kbT, 'textContent'); // computers: the V key or a click
    if (name !== cur) { cur = name; showScreen(name); cache = {}; if (name === 'results') fillResults(G); }
    if (name === 'select') {
      cardEls.forEach((c, i) => { c.classList.toggle('sel', i === G.sel); c.classList.toggle('locked', !TB.save.unlocked[i]); const b = TB.save.best[TB.save.level][i]; c.querySelector('.best').textContent = b ? 'Best ' + U.fmtTime(b) : 'No best time yet'; });
      set('selcash', $('#sel-cash'), '$' + TB.save.cash); set('selbike', $('#sel-bike'), 'Bike: ' + TB.bikes[TB.save.bike].name);
      set('selmsg', $('#sel-msg'), G.msgT > 0 ? G.msg : '');
      const lv = TB.levels[TB.save.level];
      set('sellevel', $('#sel-level'), 'LEVEL: ' + lv.name.toUpperCase() + (lv.prize > 1 ? '  (prizes x' + lv.prize + ')' : ''));
      const can = TB.canDuo(); $('#sel-players').hidden = !can; set('selduo', $('#sel-duo'), G.duo ? '2 PLAYERS' : '1 PLAYER');
      $('#sel-duokeys').hidden = !(can && G.duo); $('#sel-hint').hidden = can && G.duo;
    } else if (name === 'garage') {
      const b = TB.bikes[G.gsel], owned = TB.save.bikes[G.gsel], eq = TB.save.bike === G.gsel;
      set('gname', $('#gar-name'), b.name.toUpperCase()); set('gcash', $('#gar-cash'), 'CASH $' + TB.save.cash);
      const status = $('#gar-status'); set('gstat', status, eq ? 'EQUIPPED' : owned ? 'OWNED' : '$' + b.price);
      status.style.color = eq ? '#d4a63a' : owned ? '#9ba04f' : TB.save.cash >= b.price ? '#d9d1bd' : '#c9503a';
      const mx = (k) => Math.max(...TB.bikes.map((x) => x[k])); // bars: this bike against the best one in the garage
      $('#st-top').style.width = pct(b.top / mx('top')); $('#st-acc').style.width = pct(b.accel / mx('accel')); $('#st-grip').style.width = pct(b.handle / mx('handle'));
      const ps = TB.playerCtl.stats(b); set('gnums', $('#gar-nums'), `TOP ${ps.top} MPH  /  0-60 IN ${ps.t60.toFixed(1)} S  /  HAIRPIN ${ps.hairpin} MPH`);
      set('gdesc', $('#gar-desc'), b.desc); set('gmsg', $('#gar-msg'), G.msgT > 0 ? G.msg : '');
      set('gact', { set textContent(v) { const e = $('.js-gact'); if (e) e.textContent = v; } }, eq ? 'EQUIPPED' : owned ? 'EQUIP' : 'BUY  $' + b.price);
      bikeEls.forEach((el, i) => { el.classList.toggle('sel', i === G.gsel); el.querySelector('.p').textContent = TB.save.bike === i ? 'EQUIPPED' : TB.save.bikes[i] ? 'OWNED' : '$' + TB.bikes[i].price; });
    } else if (name === 'hud') {
      const p = TB.player; if (!p) return;
      const duo = !!G.duo && TB.humans.length > 1; hud.classList.toggle('duo', duo);
      if (lastRace !== G.raceId) { lastRace = G.raceId; buildProgress(); toastSeen = 0; E.toasts.innerHTML = ''; }
      set('place', E.place, U.ordinal(G.place).toUpperCase()); set('total', E.total, '/' + G.total);
      set('time', E.time, U.fmtTime(G.raceTime)); set('cash', E.cash, '$' + TB.save.cash);
      const mph = Math.round(p.speed * TB.C.mphK); set('mph', E.mph, String(mph));
      E.sbar.firstElementChild.style.width = pct(p.speed / (p.maxSp || 1)); E.sbar.className = 'bar ' + (p.speed / p.maxSp > 0.9 ? 'hot' : 'blue');
      E.hbar.firstElementChild.style.width = pct(p.health / p.maxHealth); E.hbar.classList.toggle('low', p.health / p.maxHealth <= 0.35);
      const fz = TB.road.finishZ;
      TB.rivals.list.forEach((r, i) => { if (dots[i]) dots[i].style.left = pct(r.z / fz); }); TB.humans.forEach((h, i) => { if (meDots[i]) meDots[i].style.left = pct(h.z / fz); });
      if (duo) TB.humans.forEach((h, i) => {
        const el = DH[i], near2 = TB.combat.nearest(h, TB.humans.filter((o) => o !== h).concat(TB.rivals.list));
        set('dhn' + i, el.n, U.ordinal(h.place).toUpperCase()); set('dhv' + i, el.v, String(Math.round(h.speed * TB.C.mphK)));
        el.hp.style.width = pct(h.health / h.maxHealth); el.hpb.classList.toggle('low', h.health / h.maxHealth <= 0.35);
        el.rival.hidden = !near2; if (near2) { set('dhr' + i, el.rn, near2.name.toUpperCase()); el.rb.style.width = pct(near2.health / near2.maxHealth); }
        const dn = st !== 'paused' && !h.finished && h.crashT >= 0 && h.health <= 0 ? Math.max(1, Math.ceil(h.down)) : 0; el.down.hidden = !dn; if (dn) set('dhd' + i, el.dn, String(dn));
        const msg = st === 'paused' ? '' : h.finished ? 'FINISH!' : ''; el.c.hidden = !msg; set('dhc' + i, el.c, msg);
      });
      const near = TB.combat.nearest(p, TB.rivals.list);
      E.rival.hidden = !near;
      if (near) { set('rname', E.rname, near.name.toUpperCase()); E.rname.style.color = '#d9d1bd'; E.rival.style.borderLeft = '4px solid ' + near.suit; E.rbar.style.width = pct(near.health / near.maxHealth); }
      // toasts
      const list = TB.hud.toasts;
      for (const t of list) if (t.id > toastSeen) { toastSeen = t.id; const d = document.createElement('div'); d.className = 'toast outline'; d.style.color = t.col; d.textContent = t.text; E.toasts.appendChild(d); setTimeout(() => d.remove(), 2300); }
      let c = '', cls = 'h-center outline';
      if (st === 'countdown') { const n = Math.ceil(G.cd); c = n > 0 ? String(n) : 'GO!'; }
      else if (G.goFlash > 0) { c = 'GO!'; }
      else if (!duo && st === 'finishing') { c = 'FINISH!'; cls += ' sm'; }
      if (st === 'paused') c = '';
      if (st === 'countdown' && G.cd > 0) E.center.style.color = Math.ceil(G.cd) === 1 ? '#d4a63a' : '#d9d1bd'; else E.center.style.color = c === 'GO!' ? '#e0642a' : '';
      const dn1 = !duo && st !== 'paused' && !p.finished && p.crashT >= 0 && p.health <= 0 ? Math.max(1, Math.ceil(p.down)) : 0; E.down.hidden = !dn1; if (dn1) set('dn1', E.dn, String(dn1)); // down for 5 s: the number counts 5, 4, 3, 2, 1
      E.center.hidden = !c; set('ctext', E.center, c); set('ccls', E.center, cls, 'className');
      E.pause.style.display = st === 'paused' ? 'block' : 'none';
    } else if (name === 'results') {
      // static
    }
  }
  return { update, showBoot(msg) { const b = $('#boot'); b.classList.remove('gone'); $('#bootmsg').textContent = msg || 'Loading...'; }, hideBoot() { $('#boot').classList.add('gone'); }, bootMsg(m) { $('#bootmsg').textContent = m; } };
}
