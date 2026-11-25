// Game data: tracks, bikes and rival riders. All names are invented for this game.
(function () {
  'use strict';
  var TB = window.TB;

  TB.bikes = [
    { name: 'Rustbucket 250', price: 0,    top: 1.00, accel: 1.00, handle: 1.00, body: '#5e4330', desc: 'Dented, loud and loyal.' },
    { name: 'Gutterhawk S',   price: 1500, top: 1.12, accel: 1.25, handle: 1.09, body: '#2a3f52', desc: 'Quick off the line.' },
    { name: 'Vandal GT',      price: 3800, top: 1.25, accel: 1.55, handle: 1.19, body: '#6e1a1e', desc: 'Fast, mean, grippy.' },
    { name: 'Thunderwraith X', price: 8000, top: 1.40, accel: 1.90, handle: 1.30, body: '#18181c', desc: 'Nothing else comes close.' }
  ];

  TB.prizes = [600, 400, 250, 120, 60, 0, 0, 0, 0];

  // Difficulty levels. pace/accel = rival speed & launch, corner/handle = cornering & hairpin speed/grip, hp/dmg = rival toughness and hit strength,
  // skill/skillFloor = riding skill, aggr/atkRate/kickRate/atkCd = hunting & combat tempo, block/guardCd/counter/packBlock = defense & counter-attacks,
  // fallK/slipK = mistake & crash frequency, recover/respawnSp = crash recovery speed, catchup/boostCap/leadEase/packSpread/diffLift = pack pressure, prize = prize multiplier.
  // Each TRACK also has its own rivals (track.diff = their speed, track.rival = skill / aggression / toughness), and the two combine: Legend on the coast is the hardest field.
  TB.levels = [
    {
      name: 'Rookie', pace: 1.00, accel: 1.00, hp: 1.00, dmg: 0.80, skill: 0.00, skillFloor: 0.20,
      aggr: 1.00, atkRate: 1.00, kickRate: 0.30, atkCd: 1.00, maxHunt: 1,
      corner: 1.00, handle: 1.00, fallK: 1.00, slipK: 1.00,
      recover: 1.00, respawnSp: 0.16, catchup: 1.00, boostCap: 0.15, chaseDist: 7000, leadEase: 0.13,
      packSpread: 1.00, diffLift: 0.00, dodge: 0.00,
      block: 0.00, guardCd: 0.00, counter: 0.00, packBlock: 0.00, truce: 2.0, prize: 1
    },
    {
      name: 'Pro', pace: 1.20, accel: 1.55, hp: 1.45, dmg: 1.15, skill: 0.28, skillFloor: 0.65,
      aggr: 1.50, atkRate: 2.20, kickRate: 0.45, atkCd: 0.78, maxHunt: 2,
      corner: 1.28, handle: 1.24, fallK: 0.35, slipK: 0.28,
      recover: 1.70, respawnSp: 0.42, catchup: 1.60, boostCap: 0.24, chaseDist: 4500, leadEase: 0.055,
      packSpread: 0.68, diffLift: 0.35, dodge: 0.65,
      block: 0.20, guardCd: 0.25, counter: 0.45, packBlock: 0.45, truce: 1.8, prize: 2.5
    },
    {
      name: 'Legend', pace: 1.36, accel: 2.25, hp: 2.15, dmg: 1.42, skill: 0.50, skillFloor: 0.90,
      aggr: 2.15, atkRate: 3.80, kickRate: 0.56, atkCd: 0.60, maxHunt: 2,
      corner: 1.55, handle: 1.50, fallK: 0.06, slipK: 0.04,
      recover: 2.60, respawnSp: 0.60, catchup: 2.25, boostCap: 0.34, chaseDist: 2800, leadEase: 0.012,
      packSpread: 0.42, diffLift: 0.65, dodge: 1.00,
      block: 0.44, guardCd: 0.45, counter: 0.85, packBlock: 0.85, truce: 1.6, prize: 5
    }
  ];

  TB.roster = [
    { name: 'Vex Malone',   suit: '#8a2026', body: '#1c1c1e', helmet: '#d8d4cc', aggr: 0.80, pace: 0.99, hp: 90 },
    { name: 'Rusty Quill',  suit: '#8a5a2b', body: '#3d2a1c', helmet: '#3a3a3a', aggr: 0.50, pace: 0.93, hp: 80 },
    { name: 'Jinx Harlow',  suit: '#4a3a5a', body: '#2a2a2e', helmet: '#b89a3a', aggr: 0.70, pace: 0.96, hp: 80 },
    { name: 'Dagger Dunne', suit: '#2c3a44', body: '#26353b', helmet: '#4a5a60', aggr: 0.90, pace: 0.90, hp: 100 },
    { name: 'Mara Voss',    suit: '#3f5a3a', body: '#5a5a58', helmet: '#3f5a3a', aggr: 0.40, pace: 0.97, hp: 70 },
    { name: 'Bruno Kettle', suit: '#2f4670', body: '#3a3c40', helmet: '#c8c6c0', aggr: 0.60, pace: 0.88, hp: 110 },
    { name: 'Nadia Slick',  suit: '#7a2a40', body: '#141416', helmet: '#e0ddd6', aggr: 0.50, pace: 0.94, hp: 70 },
    { name: 'Tank Orwell',  suit: '#8c7428', body: '#4a1c12', helmet: '#222222', aggr: 0.85, pace: 0.86, hp: 120 }
  ];

  TB.tracks = [
    // ---------------------------------------------------------------- 1. alpine lake road
    {
      name: 'Emerald Ridge', tag: 'Alpine lake road. Hairpins, big climbs, cliff-top ridge.',
      seed: 7, segs: 6400, diff: 0.93, roadW: 1200, laneCount: 2, stars: 1,
      rival: { skill: 0.42, aggr: 0.85, dmg: 0.85, hp: 0.9 }, // weekend riders: they get hairpins and hills wrong, fall often and hit softly
      lanes: [-0.5, 0.5], traffic: 9, musicRoot: 55,
      ridge: { at: 0.58 },
      gen: {
        weights: { straight: 1, curve: 5, scurve: 2, hill: 2, hairpin: 1.2, switchback: 1.5 },
        curves: [1.6, 2.4, 3.2], curveLen: [70, 150], straightLen: [20, 50], hillAmp: 50, hillMax: 70
      },
      pal: {
        sky: ['#2b86e6', '#b4e1ff'], sun: { x: 0.78, y: 0.2, r: 30, c: '#fffbe0' }, clouds: true,
        fog: '#cfe7f3', grass: ['#2f6b34', '#2a6130'], rumble: ['#d6d6d6', '#8a8a8a'],
        road: ['#6c7077', '#64686f'], lane: '#e9e9e9', center: '#f2c230', drop: ['#1f86b8', '#1b7aab'],
        layers: [
          { kind: 'peaks', color: '#7d90ad', snow: '#ffffff', snowLine: 0.58, h: 190, f: 0.12 },
          { kind: 'peaks', color: '#5f7596', snow: '#f2f7ff', snowLine: 0.72, h: 120, f: 0.22 },
          { kind: 'sea', color: '#12a5c4', h: 34, f: 0.3 },
          { kind: 'pines', color: '#1f5a36', h: 80, f: 0.55, gap: true }
        ]
      },
      scenery: {
        density: 0.8, farDensity: 0.55, rails: 'curves', curveSigns: true, poles: false,
        types: [
          { t: 'fir', wt: 7, near: [1.25, 2.8], w: 900, h: 4200, hw: 0.05, solid: true },
          { t: 'fir', wt: 4, near: [1.3, 3.2], w: 1100, h: 3600, hw: 0.05, solid: true },
          { t: 'boulder', wt: 2, near: [1.15, 2.2], w: 900, h: 700, hw: 0.14, solid: true },
          { t: 'bush', wt: 2, near: [1.2, 2.4], w: 500, h: 350, hw: 0.1, solid: false }
        ],
        far: [
          { t: 'fir', wt: 8, near: [3.5, 9], w: 1300, h: 5200, solid: false },
          { t: 'boulder', wt: 2, near: [3.5, 8], w: 1600, h: 1200, solid: false }
        ]
      }
    },
    // ---------------------------------------------------------------- 2. desert
    {
      name: 'Cinder Mesa', tag: 'Scorched desert. Long straights, huge dips and crests.',
      seed: 23, segs: 7000, diff: 1.02, roadW: 1500, laneCount: 4, stars: 2,
      rival: { skill: 0.62, aggr: 1.0, dmg: 1.0, hp: 1.0 }, // club racers: decent, but the big crests still catch them
      lanes: [-0.75, -0.25, 0.25, 0.75], traffic: 14, musicRoot: 49,
      gen: {
        weights: { straight: 4, curve: 3, scurve: 1.5, hill: 4, hairpin: 0.4, switchback: 0 },
        curves: [1.4, 2.6, 4.0], curveLen: [60, 130], straightLen: [50, 140], hillAmp: 45, hillMax: 50
      },
      pal: {
        sky: ['#ff8c42', '#ffe2a6'], sun: { x: 0.3, y: 0.28, r: 52, c: '#fff4c8' }, clouds: false,
        fog: '#f3cf9c', grass: ['#d8a05a', '#cf964f'], rumble: ['#c0392b', '#f1f1f1'],
        road: ['#5f5855', '#575250'], lane: '#efe9d8', center: '#f2c230', drop: ['#d8a05a', '#cf964f'],
        layers: [
          { kind: 'mesa', color: '#c97b47', h: 170, f: 0.12 },
          { kind: 'mesa', color: '#a85a32', h: 100, f: 0.3 },
          { kind: 'hills', color: '#d9a15d', h: 45, f: 0.7 }
        ]
      },
      scenery: {
        density: 0.28, farDensity: 0.2, rails: null, curveSigns: true, poles: true, edgeRocks: 0.012,
        types: [
          { t: 'cactus', wt: 5, near: [1.25, 3.5], w: 500, h: 1500, hw: 0.07, solid: true },
          { t: 'rock', wt: 4, near: [1.2, 3.2], w: 700, h: 500, hw: 0.14, solid: true },
          { t: 'bush', wt: 3, near: [1.2, 3.5], w: 500, h: 320, hw: 0.1, solid: false }
        ],
        far: [
          { t: 'mesa', wt: 4, near: [4, 11], w: 4500, h: 2600, solid: false },
          { t: 'rock', wt: 3, near: [3, 7], w: 1300, h: 900, solid: false }
        ]
      }
    },
    // ---------------------------------------------------------------- 3. coast
    {
      name: 'Saltspray Coast', tag: 'Sea breeze, palm trees and fast sweeping bends.',
      seed: 11, segs: 6400, diff: 1.11, roadW: 1500, laneCount: 4, stars: 3,
      rival: { skill: 0.85, aggr: 1.2, dmg: 1.15, hp: 1.15 }, // pros: fast, tough and rarely fall
      lanes: [-0.75, -0.25, 0.25, 0.75], traffic: 15, musicRoot: 58,
      gen: {
        weights: { straight: 3, curve: 5, scurve: 3, hill: 3, hairpin: 0.6, switchback: 0 },
        curves: [1.6, 2.8, 4.2], curveLen: [50, 120], straightLen: [30, 80], hillAmp: 26, hillMax: 32
      },
      pal: {
        sky: ['#2f9bec', '#c2edff'], sun: { x: 0.72, y: 0.3, r: 38, c: '#fffbe6' }, clouds: true,
        fog: '#cdeefb', grass: ['#83c866', '#78bf5c'], rumble: ['#e23b3b', '#f4f4f4'],
        road: ['#6d6d71', '#656569'], lane: '#f4f4f4', center: '#f2c230', drop: ['#83c866', '#78bf5c'],
        layers: [
          { kind: 'hills', color: '#8fc0da', h: 95, f: 0.12 },
          { kind: 'sea', color: '#2a8fd6', h: 36, f: 0.2 },
          { kind: 'hills', color: '#4f9a5a', h: 60, f: 0.6 }
        ]
      },
      scenery: {
        density: 0.4, farDensity: 0.25, rails: null, curveSigns: true, poles: true,
        types: [
          { t: 'palm', wt: 6, near: [1.25, 3.0], w: 900, h: 2700, hw: 0.06, solid: true },
          { t: 'rock', wt: 2, near: [1.2, 2.6], w: 650, h: 450, hw: 0.13, solid: true },
          { t: 'bush', wt: 3, near: [1.2, 3.0], w: 500, h: 360, hw: 0.1, solid: false },
          { t: 'billboard', wt: 0.8, near: [1.6, 2.4], w: 1500, h: 1700, hw: 0.1, solid: true }
        ],
        far: [
          { t: 'palm', wt: 5, near: [3.5, 9], w: 1300, h: 3800, solid: false },
          { t: 'billboard', wt: 1, near: [3, 6], w: 1800, h: 2000, solid: false }
        ]
      }
    }
  ];

  // 3D look of each track (colours, lighting, terrain style). Read by src/render/.
  // (hazy, desaturated palettes: pale sky, near-white horizon, haze that eats the distance)
  TB.tracks[0].env = {
    kind: 'alpine', waterY: -30, seed: 3,
    // a crisp clear mountain day: deeper blue overhead, pale haze only at the horizon, a few thin clouds, sun high enough to light the snow faces
    sky: { top: '#2f66b0', mid: '#6f9ccf', horizon: '#c9dcec', sun: '#fff3de', az: 0.55, el: 0.66, cloud: 0.32, haze: 0.14 },
    fog: '#b4cde2', fogNear: 220, fogFar: 4200,
    light: { sun: 4.3, hemiSky: '#9dbce8', hemiGround: '#a0947c', hemi: 2.1, envInt: 0.75, exposure: 0.98 },
    grade: { sat: 0.9, lift: 0.008, contrast: 1.14, vig: 0.3, shadowTint: [0.9, 0.96, 1.1], highTint: [1.05, 1.01, 0.95] },
    waterColor: '#16465a', mountainSnow: true
  };
  TB.tracks[1].env = {
    kind: 'desert', waterY: -999, seed: 8,
    sky: { top: '#8aa0c6', mid: '#c9d0de', horizon: '#f0ebe2', sun: '#fff3df', az: 0.9, el: 0.55, cloud: 0.2, haze: 0.3 },
    fog: '#e3d9ca', fogNear: 130, fogFar: 2500,
    light: { sun: 4.2, hemiSky: '#c2c9de', hemiGround: '#b59f80', hemi: 0.8, envInt: 0.6, exposure: 1.1 },
    grade: { sat: 0.8, lift: 0.012, contrast: 1.13, vig: 0.34, shadowTint: [0.93, 0.95, 1.05], highTint: [1.06, 1.01, 0.93] },
    waterColor: '#000'
  };
  TB.tracks[2].env = {
    kind: 'coast', waterY: -4, seed: 5,
    sky: { top: '#5f8cc2', mid: '#a3c1dc', horizon: '#e6ecee', sun: '#fff4e0', az: 3.4, el: 0.62, cloud: 0.45, haze: 0.25 },
    fog: '#cddae0', fogNear: 150, fogFar: 2800,
    light: { sun: 3.8, hemiSky: '#a9bddb', hemiGround: '#8b8467', hemi: 0.85, envInt: 0.65, exposure: 1.0 },
    grade: { sat: 0.84, lift: 0.012, contrast: 1.1, vig: 0.32, shadowTint: [0.93, 0.97, 1.06], highTint: [1.06, 1.01, 0.94] },
    waterColor: '#245f7e'
  };
})();
