// Slow civilian cars and trucks that act as moving obstacles.
(function () {
  'use strict';
  var TB = window.TB, C = TB.C, U = TB.util;
  var T = (TB.traffic = { list: [] });
  // Muted, weathered road-vehicle paint (white, silver, dusty red, faded blue, black, beige, olive, dark green).
  var COLORS = ['#bdbab0', '#bdbab0', '#9a9fa2', '#9a9fa2', '#8a3d34', '#4a6179', '#26282b', '#b5a888', '#6a6e5a', '#3f4c42', '#7a6a58'];
  var TRUCK_COLORS = ['#c4c1b6', '#c4c1b6', '#c4c1b6', '#a89c80', '#4a6179', '#a3a8ab', '#8a3d34'];
  // Real-world sizes in metres (width of the drawn vehicle). The collision half-width is derived from it so what you hit is what you see.
  var KINDS = { sedan: { w: 1.9, truck: false }, pickup: { w: 2.05, truck: false }, wagon: { w: 2.0, truck: false }, boxtruck: { w: 2.45, truck: true } };
  var CARS = ['sedan', 'sedan', 'pickup', 'pickup', 'wagon'];

  T.init = function (track, finishZ) {
    var rng = U.rng(track.seed * 31 + 5), lanes = track.lanes, n = lanes.length, list = (T.list = []);
    var lastZ = [], i;
    for (i = 0; i < n; i++) lastZ.push(5000 + rng() * 2000);
    for (i = 0; i < track.traffic; i++) {
      var lane = Math.floor(rng() * n), truck = rng() < 0.3;
      var kind = truck ? 'boxtruck' : CARS[Math.floor(rng() * CARS.length)], halfM = (track.roadW || 1500) * C.S;
      var z = lastZ[lane] + 3200 + rng() * 6000;
      if (z > finishZ - 2500) continue;
      lastZ[lane] = z;
      list.push({
        z: z, x: lanes[lane], speed: (2800 + lane * (1800 / Math.max(1, n - 1))) * (truck ? 0.9 : 1),
        truck: truck, kind: kind, color: (truck ? TRUCK_COLORS : COLORS)[Math.floor(rng() * (truck ? TRUCK_COLORS : COLORS).length)],
        hw: KINDS[kind].w / 2 * 1.04 / halfM, isTraffic: true, lane: lane
      });
    }
    list.sort(function (a, b) { return a.z - b.z; });
  };

  T.update = function (dt, finishZ) {
    for (var i = 0; i < T.list.length; i++) {
      var t = T.list[i];
      t.z += t.speed * dt;
      if (t.z > finishZ + 4000) t.z = finishZ + 4000; // park at the end
    }
  };

  // First traffic vehicle overlapping racer r (within the given window), or null.
  T.hit = function (r, zBack, zFront) {
    for (var i = 0; i < T.list.length; i++) {
      var t = T.list[i], dz = t.z - r.z;
      if (dz > -zBack && dz < zFront && Math.abs(t.x - r.x) < t.hw + r.hw) return t;
    }
    return null;
  };
})();
