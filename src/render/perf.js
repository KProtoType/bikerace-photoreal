// Performance, quality tiers (Ultra / High / Balanced), weather presets (Sunny / Golden Hour / Post-Rain),
// and live Original-vs-Photoreal comparison state.
export const ASSET_BASE = './';

const hash = window.location.hash || '';
const coarse = !!(window.matchMedia && (window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(hover: none)').matches));
const touchy = coarse || (navigator.maxTouchPoints || 0) > 1;
const smallScreen = Math.min(window.screen.width || 9999, window.screen.height || 9999) <= 820;
let mobile = (touchy && smallScreen) || (coarse && smallScreen);
if (/[#&]lowfx/.test(hash)) mobile = true;
if (/[#&]hifx/.test(hash)) mobile = false;

export const QUALITY_TIERS = {
  ultra: {
    id: 'ultra',
    label: 'ULTRA',
    dprCap: 2,
    pixels: 2.5e6,
    minRatio: 0.85,
    shadowSize: 4096,
    shadowBox: 64,
    shadowForward: 38,
    bloom: true,
    msaa: 4,
    texSize: '2k',
    anisotropy: 16,
    sceneryKeep: 1,
    hiDist: 75,
    viewDist: 820,
    fogMul: 1.0,
    cheapTerrain: false,
    terrainCells: 145000,
    waterReflect: true,
    waterReflectSize: 512,
    particles: 1.0,
    motionBlur: 1.0,
    sunGlare: 1.0,
    headlightSpot: true,
    selfShadows: true
  },
  high: {
    id: 'high',
    label: 'HIGH',
    dprCap: 2,
    pixels: 1.95e6,
    minRatio: 0.78,
    shadowSize: 2048,
    shadowBox: 56,
    shadowForward: 32,
    bloom: true,
    msaa: 4,
    texSize: '2k',
    anisotropy: 8,
    sceneryKeep: 1,
    hiDist: 62,
    viewDist: 740,
    fogMul: 1.0,
    cheapTerrain: false,
    terrainCells: 135000,
    waterReflect: true,
    waterReflectSize: 384,
    particles: 0.85,
    motionBlur: 0.9,
    sunGlare: 0.95,
    headlightSpot: true,
    selfShadows: true
  },
  balanced: {
    id: 'balanced',
    label: 'BALANCED',
    dprCap: mobile ? 1.35 : 1.5,
    pixels: mobile ? 1.05e6 : 1.35e6,
    minRatio: 0.65,
    shadowSize: 1024,
    shadowBox: 38,
    shadowForward: 20,
    bloom: !mobile,
    msaa: 2,
    texSize: mobile ? '1k' : '2k',
    anisotropy: 4,
    sceneryKeep: mobile ? 0.55 : 0.85,
    hiDist: 52,
    viewDist: mobile ? 460 : 620,
    fogMul: mobile ? 0.8 : 1.0,
    cheapTerrain: mobile,
    terrainCells: mobile ? 85000 : 120000,
    waterReflect: false,
    waterReflectSize: 256,
    particles: 0.45,
    motionBlur: 0.45,
    sunGlare: 0.65,
    headlightSpot: false,
    selfShadows: true
  }
};

export const WEATHER_MODES = ['sunny', 'golden', 'rain'];
export const WEATHER_LABELS = { sunny: 'SUNNY', golden: 'GOLDEN HOUR', rain: 'POST-RAIN' };
export const QUALITY_ORDER = ['ultra', 'high', 'balanced'];

let savedTier = null;
let savedWeather = null;
try {
  savedTier = window.localStorage.getItem('throttleBrawl.preview.quality');
  savedWeather = window.localStorage.getItem('throttleBrawl.preview.weather');
} catch (e) { /* ignore */ }

const hashTier = (/[#&]q=(ultra|high|balanced)/.exec(hash) || [])[1];
const hashWeather = (/[#&]w=(sunny|golden|rain)/.exec(hash) || [])[1];
const startTier = hashTier || (QUALITY_TIERS[savedTier] ? savedTier : (mobile ? 'balanced' : 'high'));
const startWeather = hashWeather || (WEATHER_MODES.includes(savedWeather) ? savedWeather : 'sunny');

export const PERF = Object.assign({
  mobile,
  tier: startTier,
  weather: startWeather,
  photoreal: !/[#&]original/.test(hash)
}, QUALITY_TIERS[startTier]);

export function setQualityTier(tier) {
  if (!QUALITY_TIERS[tier]) return false;
  PERF.tier = tier;
  Object.assign(PERF, QUALITY_TIERS[tier]);
  try { window.localStorage.setItem('throttleBrawl.preview.quality', tier); } catch (e) { /* ignore */ }
  return true;
}

export function setWeatherMode(mode) {
  if (!WEATHER_MODES.includes(mode)) return false;
  PERF.weather = mode;
  try { window.localStorage.setItem('throttleBrawl.preview.weather', mode); } catch (e) { /* ignore */ }
  return true;
}

window.TB = window.TB || {};
window.TB.perf = PERF;
