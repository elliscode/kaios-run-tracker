// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const RunStats = require('../frontend/src/js/stats.js');

const START = 1700000000000;

// Moves `metersPerSecond` due north from (lat, lon) once per second.
function straightLine(seconds, metersPerSecond, accuracy) {
  const metersPerDegreeLat = Math.PI * 6371008.8 / 180;
  const samples = [];
  for (let i = 0; i <= seconds; i++) {
    samples.push({
      timestamp: START + i * 1000,
      latitude: 40 + (i * metersPerSecond) / metersPerDegreeLat,
      longitude: -71,
      altitude: null,
      accuracy: accuracy,
      altitudeAccuracy: null,
    });
  }
  return samples;
}

test('haversine matches known distances', () => {
  // one degree of latitude ~ 111.195 km on the mean-radius sphere
  const d = RunStats.haversine({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
  assert.ok(Math.abs(d - 111195) < 5, `got ${d}`);
  // Boston -> New York City, ~306 km great-circle
  const bosNyc = RunStats.haversine(
    { latitude: 42.3601, longitude: -71.0589 },
    { latitude: 40.7128, longitude: -74.0060 },
  );
  assert.ok(Math.abs(bosNyc - 306000) < 2000, `got ${bosNyc}`);
  assert.equal(RunStats.haversine({ latitude: 10, longitude: 10 }, { latitude: 10, longitude: 10 }), 0);
});

test('stationary jitter adds no distance', () => {
  const metersPerDegreeLat = Math.PI * 6371008.8 / 180;
  const samples = [];
  // deterministic +-3 m wobble per axis (inside the 10 m accuracy) for 10 minutes
  for (let i = 0; i < 600; i++) {
    const wobble = (((i * 7919) % 7) - 3) / metersPerDegreeLat;
    samples.push({ timestamp: START + i * 1000, latitude: 40 + wobble, longitude: -71 + wobble, altitude: null, accuracy: 10, altitudeAccuracy: null });
  }
  const stats = RunStats.computeStats(samples, START, START + 600000);
  assert.equal(stats.distanceM, 0);
});

test('a single 500 m spike is rejected', () => {
  const samples = straightLine(300, 3, 5);
  const clean = RunStats.computeStats(samples, START, START + 300000).distanceM;
  const spiked = samples.map((s) => Object.assign({}, s));
  spiked[150].latitude += 500 / (Math.PI * 6371008.8 / 180);
  const stats = RunStats.computeStats(spiked, START, START + 300000);
  assert.ok(Math.abs(stats.distanceM - clean) < 10, `clean ${clean}, spiked ${stats.distanceM}`);
  assert.equal(stats.droppedSpeed, 1);
});

test('inaccurate samples are dropped but raw samples are untouched', () => {
  const samples = straightLine(60, 3, 50);
  const before = JSON.stringify(samples);
  const stats = RunStats.computeStats(samples, START, START + 60000);
  assert.equal(stats.distanceM, 0);
  assert.equal(stats.droppedAccuracy, 61);
  assert.equal(JSON.stringify(samples), before);
});

test('5 km in 30 minutes gives the right speed and pace', () => {
  const seconds = 1800;
  const samples = straightLine(seconds, 5000 / seconds, 5);
  const stats = RunStats.computeStats(samples, START, START + seconds * 1000);
  assert.ok(Math.abs(stats.distanceKm - 5) < 0.02, `got ${stats.distanceKm} km`);
  assert.ok(Math.abs(stats.speedKmh - 10) < 0.05, `got ${stats.speedKmh} km/h`);
  assert.equal(RunStats.formatPace(stats.paceMsPerKm), '6:00');
  assert.equal(RunStats.formatPace(stats.paceMsPerMi), '9:39');
  assert.ok(Math.abs(stats.speedMph - 6.214) < 0.03, `got ${stats.speedMph} mph`);
});

test('formatters', () => {
  assert.equal(RunStats.formatDuration(754000), '12:34');
  assert.equal(RunStats.formatDuration(4354000), '1:12:34');
  assert.equal(RunStats.formatPace(null), '--:--');
});
