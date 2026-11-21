// Touch screens: on-screen buttons that feed the SAME input system as the keyboard (TB.input.press / release with key codes),
// tap handling for menus, the "rotate your phone" overlay, fullscreen, and a few phone-only protections (no zoom, no long-press menus).
export function createTouch(TB) {
  const G = TB.G, I = TB.input;
  const hash = window.location.hash || '';
  const forced = /[#&]touch/.test(hash);
  const body = document.body;
  const T = (TB.touch = { on: false, autoGas: true, vibrate });
  try { const v = window.localStorage.getItem('throttleBrawl.autoGas'); if (v !== null) T.autoGas = v === '1'; } catch (e) { /* no storage */ }

  // ------------------------------------------------------------------ touch mode on/off
  function setTouch(on) {
    if (T.on === on) return;
    T.on = on; body.classList.toggle('touch', on);
    if (!on) releaseAll();
    layout();
  }
  const mq = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
  const startsTouch = forced || !!(mq && mq.matches) || ('ontouchstart' in window && (navigator.maxTouchPoints || 0) > 0 && window.matchMedia('(hover: none)').matches);
  const racingNow = () => G.state === 'countdown' || G.state === 'race' || G.state === 'finishing';
  // a real keyboard key hides the touch buttons (unless forced for testing)
  window.addEventListener('keydown', (e) => { if (!forced && T.on) setTouch(false); }, true);
  window.addEventListener('touchstart', () => setTouch(true), { capture: true, passive: true });
  window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' || e.pointerType === 'pen') setTouch(true); }, true);

  // ------------------------------------------------------------------ holding keys
  const holds = {}; // key code -> set of sources holding it
  function hold(code, src) { (holds[code] || (holds[code] = new Set())).add(src); I.press(code); }
  function unhold(code, src) { const s = holds[code]; if (!s) return; s.delete(src); if (!s.size) I.release(code); }
  function tap(code) { I.press(code); I.release(code); } // one key press (the game sees it at the next step)
  const active = new Map(); // pointer id -> { el, code, side }
  function releaseAll() {
    for (const [id, a] of active) { if (a.code) unhold(a.code, 'p' + id); a.el.classList.remove('down'); if (a.pad) a.pad.classList.remove('l', 'r'); }
    active.clear();
    for (const c in holds) { for (const src of [...holds[c]]) if (src !== 'auto') holds[c].delete(src); if (!holds[c].size) I.release(c); }
    document.querySelectorAll('#touch .down').forEach((e) => e.classList.remove('down'));
  }
  function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* not supported */ } }

  // ------------------------------------------------------------------ the on-screen controls
  const root = document.createElement('div'); root.id = 'touch';
  root.innerHTML = `
    <div id="t-steer" class="tpad"><div class="tb steer l"><i></i></div><div class="tb steer r"><i></i></div></div>
    <div class="tb round gas" data-code="ArrowUp"><b>GAS</b></div>
    <div class="tb round brake" data-code="ArrowDown"><b>BRAKE</b></div>
    <div class="tb round fight pl" data-code="KeyZ"><b>PUNCH</b><i>LEFT</i></div>
    <div class="tb round fight pr" data-code="KeyX"><b>PUNCH</b><i>RIGHT</i></div>
    <div class="tb round fight kick" data-code="KeyC"><b>KICK</b></div>
    <div class="tb round pausebtn" id="t-pause"><span></span><span></span></div>`;
  body.appendChild(root);
  const steer = root.querySelector('#t-steer');

  function begin(e, el, code, extra) {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const a = Object.assign({ el, code }, extra); active.set(e.pointerId, a); return a;
  }
  function end(e) {
    const a = active.get(e.pointerId); if (!a) return;
    active.delete(e.pointerId);
    if (a.code) unhold(a.code, 'p' + e.pointerId);
    if (a.pad) { a.pad.classList.remove('l', 'r'); }
    else a.el.classList.remove('down');
  }
  // plain buttons
  root.querySelectorAll('[data-code]').forEach((el) => {
    const code = el.dataset.code;
    el.addEventListener('pointerdown', (e) => { begin(e, el, code); hold(code, 'p' + e.pointerId); el.classList.add('down'); if (code !== 'ArrowDown') vibrate(6); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((n) => el.addEventListener(n, end));
  });
  // steering pad: slide a thumb from LEFT to RIGHT without lifting
  function steerTo(e) {
    const a = active.get(e.pointerId); if (!a) return;
    const r = steer.getBoundingClientRect(), side = e.clientX < r.left + r.width / 2 ? 'ArrowLeft' : 'ArrowRight';
    if (a.code === side) return;
    if (a.code) unhold(a.code, 'p' + e.pointerId);
    a.code = side; hold(side, 'p' + e.pointerId);
    steer.classList.toggle('l', side === 'ArrowLeft'); steer.classList.toggle('r', side === 'ArrowRight');
  }
  steer.addEventListener('pointerdown', (e) => { begin(e, steer, null, { pad: steer }); steerTo(e); });
  steer.addEventListener('pointermove', steerTo);
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((n) => steer.addEventListener(n, end));
  // pause button
  const pauseBtn = root.querySelector('#t-pause');
  pauseBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); pauseBtn.classList.add('down'); tap('KeyP'); vibrate(8); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => pauseBtn.addEventListener(n, () => pauseBtn.classList.remove('down')));

  // ------------------------------------------------------------------ menus (tap)
  let lastScreen = '', lastChange = 0;
  const fresh = () => performance.now() - lastChange > 350; // ignore the tail of the tap that just changed screens
  const setSel = (k, i) => { if (G[k] !== i) { G[k] = i; TB.audio.menu(); return true; } return false; };
  const ui = document.getElementById('ui');
  ui.addEventListener('click', (e) => {
    if (!fresh()) return;
    const b = e.target.closest('[data-act]');
    if (b) {
      switch (b.dataset.act) {
        case 'back': tap('Escape'); break;
        case 'level': { const n = TB.save.levels[TB.save.level + 1] ? 'ArrowUp' : 'ArrowDown'; tap(n); break; }
        case 'players': tap('KeyT'); break;
        case 'garage': tap('KeyG'); break;
        case 'go': case 'next': tap('Enter'); break;
        case 'gback': tap('Space'); break;
        case 'gprev': tap('ArrowLeft'); break;
        case 'gnext': tap('ArrowRight'); break;
        case 'gact': tap('Enter'); break;
        case 'resume': tap('KeyP'); break;
        case 'quit': tap('KeyQ'); break;
        case 'sound': tap('KeyM'); break;
        case 'autogaskb': tap('KeyV'); break; // computers: the same toggle as the V key
        case 'autogas': T.autoGas = !T.autoGas; try { window.localStorage.setItem('throttleBrawl.autoGas', T.autoGas ? '1' : '0'); } catch (err) { /* ignore */ } break;
        case 'fullscreen': toggleFullscreen(); break;
      }
      return;
    }
    const card = e.target.closest('.card'), bike = e.target.closest('.bc');
    if (card && G.state === 'select') { const i = +card.dataset.i; if (G.sel === i) tap('Enter'); else setSel('sel', i); }
    else if (bike && G.state === 'garage') { const i = +bike.dataset.i; if (G.gsel === i) tap('Enter'); else setSel('gsel', i); }
  });
  // title + results: a tap anywhere continues
  window.addEventListener('pointerdown', (e) => {
    if (!T.on || !fresh() || e.target.closest('[data-act]')) return;
    if (G.state === 'title') tap('Enter');
    else if (G.state === 'results') tap('Enter');
  });

  // ------------------------------------------------------------------ audio unlock (iOS needs this inside a real tap)
  const unlock = () => { try { TB.audio.init(); } catch (e) { /* ignore */ } };
  ['touchstart', 'touchend', 'pointerdown', 'click'].forEach((n) => window.addEventListener(n, unlock, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) unlock(); });

  // ------------------------------------------------------------------ keep the page still: no zoom, scroll, selection, menus (double-tap zoom is off via CSS touch-action)
  const stop = (e) => e.preventDefault();
  ['gesturestart', 'gesturechange', 'gestureend', 'contextmenu', 'dragstart', 'selectstart'].forEach((n) => document.addEventListener(n, stop));
  document.addEventListener('touchmove', (e) => { if (T.on) e.preventDefault(); }, { passive: false });

  // ------------------------------------------------------------------ orientation + fullscreen
  const portrait = () => window.innerHeight > window.innerWidth;
  function layout() {
    const p = T.on && portrait();
    body.classList.toggle('portrait', p);
    const tu = Math.min(window.innerWidth / 844, window.innerHeight / 390);
    root.style.setProperty('--tu', Math.max(0.6, Math.min(1.35, tu)).toFixed(3));
    if (p) { releaseAll(); if (racingNow()) tap('KeyP'); } // pause while the phone is upright
  }
  window.addEventListener('resize', layout); window.addEventListener('orientationchange', layout);
  const fsEl = document.documentElement;
  const fsReq = fsEl.requestFullscreen || fsEl.webkitRequestFullscreen;
  if (!fsReq) body.classList.add('nofs');
  function toggleFullscreen() {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
      const p = fsReq.call(fsEl);
      const lock = () => { try { const o = screen.orientation; if (o && o.lock) o.lock('landscape').catch(() => {}); } catch (e) { /* not supported */ } };
      if (p && p.then) p.then(lock).catch(() => {}); else lock();
    } catch (e) { /* not supported */ }
  }

  // leaving the page or losing focus: let go of everything, and pause a race in progress
  const away = () => { releaseAll(); if (T.on && racingNow()) tap('KeyP'); };
  window.addEventListener('blur', releaseAll);
  window.addEventListener('pagehide', away);
  document.addEventListener('visibilitychange', () => { if (document.hidden) away(); });

  // ------------------------------------------------------------------ per frame
  T.update = function () {
    if (G.state !== lastScreen) { lastScreen = G.state; lastChange = performance.now(); }
    const race = racingNow();
    root.classList.toggle('on', T.on && race && !portrait());
    body.classList.toggle('autogas', T.autoGas);
    // auto-gas: the throttle is held for you while racing
    if (T.autoGas && race && T.on) hold('ArrowUp', 'auto'); else unhold('ArrowUp', 'auto');
  };

  setTouch(startsTouch); layout();
  return T;
}
