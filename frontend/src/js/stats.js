// Pure distance/pace math for a run's raw GPS samples. Shared verbatim by the
// KaiOS app and the website's share page (website/release.sh copies this file
// over), so both always show identical numbers for the same run. Never mutates
// the samples it's given -- derived stats must always be reproducible from the
// raw recording.
//
// A sample is { timestamp, latitude, longitude, altitude, accuracy,
// altitudeAccuracy } exactly as gps.js records it.
(function (root) {
  // Bump whenever the filtering/derivation below changes, so cached stats on
  // stored runs get recomputed (see db.js / app.js ensureStats).
  const STATS_VERSION = 1;

  const EARTH_RADIUS_M = 6371008.8;
  const METERS_PER_MILE = 1609.344;

  // Readings worse than this are never trusted for distance.
  const MAX_ACCURACY_M = 25;
  // A new point has to be at least this far from the last accepted point
  // before it counts, so standing still doesn't accumulate jitter.
  const MIN_STEP_M = 5;
  // ...or the average of the two points' accuracy radii, if that's larger.
  const ACCURACY_STEP_FACTOR = 1;
  // ~25 km/h -- far faster than running, so anything above it is a GPS jump.
  const MAX_SPEED_MPS = 7;
  // If this many points in a row are rejected as too fast, the anchor itself
  // was probably the bad point -- move the anchor without adding distance.
  const REANCHOR_AFTER = 5;

  function toRadians(degrees) {
    return degrees * Math.PI / 180;
  }

  function haversine(a, b) {
    const lat1 = toRadians(a.latitude);
    const lat2 = toRadians(b.latitude);
    const dLat = lat2 - lat1;
    const dLon = toRadians(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function isAccurate(sample) {
    return typeof sample.accuracy === 'number' && sample.accuracy <= MAX_ACCURACY_M;
  }

  // Walks the samples once and decides which ones count toward distance.
  // Returns the accepted sample indices (in order) plus the summed distance
  // between them, and how many samples were rejected and why.
  function filterSamples(samples) {
    const indices = [];
    let distance = 0;
    let droppedAccuracy = 0;
    let droppedSpeed = 0;
    let anchor = null;
    let consecutiveSpeedDrops = 0;

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      if (!isAccurate(sample)) {
        droppedAccuracy++;
        continue;
      }
      if (anchor === null) {
        anchor = sample;
        indices.push(i);
        continue;
      }
      const d = haversine(anchor, sample);
      const threshold = Math.max(MIN_STEP_M, ACCURACY_STEP_FACTOR * (anchor.accuracy + sample.accuracy) / 2);
      if (d < threshold) {
        // still within the noise radius of the anchor, not movement yet
        continue;
      }
      const seconds = (sample.timestamp - anchor.timestamp) / 1000;
      if (seconds <= 0 || d / seconds > MAX_SPEED_MPS) {
        droppedSpeed++;
        consecutiveSpeedDrops++;
        if (consecutiveSpeedDrops >= REANCHOR_AFTER) {
          anchor = sample;
          indices.push(i);
          consecutiveSpeedDrops = 0;
        }
        continue;
      }
      consecutiveSpeedDrops = 0;
      distance += d;
      anchor = sample;
      indices.push(i);
    }

    return {
      indices: indices,
      distance: distance,
      droppedAccuracy: droppedAccuracy,
      droppedSpeed: droppedSpeed,
    };
  }

  function computeStats(samples, startTime, endTime) {
    const filtered = filterSamples(samples);
    const distanceM = filtered.distance;
    const durationMs = Math.max(0, endTime - startTime);
    const hours = durationMs / 3600000;
    const km = distanceM / 1000;
    const mi = distanceM / METERS_PER_MILE;
    return {
      statsVersion: STATS_VERSION,
      distanceM: distanceM,
      distanceKm: km,
      distanceMi: mi,
      durationMs: durationMs,
      speedKmh: hours > 0 ? km / hours : 0,
      speedMph: hours > 0 ? mi / hours : 0,
      // pace in milliseconds per unit, null when there's no distance to divide by
      paceMsPerKm: km > 0 ? durationMs / km : null,
      paceMsPerMi: mi > 0 ? durationMs / mi : null,
      sampleCount: samples.length,
      keptCount: filtered.indices.length,
      droppedAccuracy: filtered.droppedAccuracy,
      droppedSpeed: filtered.droppedSpeed,
    };
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // 754000 -> "12:34", 4354000 -> "1:12:34"
  function formatDuration(ms) {
    const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return h > 0 ? h + ':' + pad2(m) + ':' + pad2(s) : pad2(m) + ':' + pad2(s);
  }

  // pace in ms per unit -> "8:05", or "--:--" when unknown
  function formatPace(msPerUnit) {
    if (msPerUnit === null || !isFinite(msPerUnit)) {
      return '--:--';
    }
    const totalSeconds = Math.round(msPerUnit / 1000);
    return Math.floor(totalSeconds / 60) + ':' + pad2(totalSeconds % 60);
  }

  const RunStats = {
    STATS_VERSION: STATS_VERSION,
    MAX_ACCURACY_M: MAX_ACCURACY_M,
    MIN_STEP_M: MIN_STEP_M,
    MAX_SPEED_MPS: MAX_SPEED_MPS,
    METERS_PER_MILE: METERS_PER_MILE,
    haversine: haversine,
    filterSamples: filterSamples,
    computeStats: computeStats,
    formatDuration: formatDuration,
    formatPace: formatPace,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RunStats;
  } else {
    root.RunStats = RunStats;
  }
})(this);
