// Small deterministic value-noise helpers used for terrain, mountains and textures.
function hash(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000;
}
export function noise2(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; // 0..1
}
export function fbm(x, z, seed = 0, oct = 4) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += noise2(x * f, z * f, seed + i * 17) * amp; norm += amp; amp *= 0.5; f *= 2.03; }
  return s / norm; // 0..1
}
export function ridged(x, z, seed = 0, oct = 4) {
  let s = 0, amp = 0.55, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { const n = 1 - Math.abs(noise2(x * f, z * f, seed + i * 31) * 2 - 1); s += n * n * amp; norm += amp; amp *= 0.5; f *= 2.1; }
  return s / norm;
}
export const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
