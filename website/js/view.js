// Share page for an uploaded run: /view/index.html?id=<16-char share id>. Fetches the run
// (and the Maps key) from the API, recomputes the stats with the exact same
// stats.js the app uses, then loads map.js to draw the route.
const API_DOMAIN = 'https://api.runtracker.elliscode.com';
const ID_REGEX = /^[0-9a-zA-Z]{16}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const statusElement = document.getElementById('status');

// read by map.js
let apiKey;
let routePoints = [];

function getRunId() {
  const id = new URLSearchParams(window.location.search).get('id');
  return id && ID_REGEX.test(id) ? id : null;
}

function showStatus(text) {
  statusElement.innerText = text;
  statusElement.classList.remove('hidden');
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function formatDate(ms, withTime) {
  const d = new Date(ms);
  const date = MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  return withTime ? date + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : date;
}

// Inverse of the app's api.js packRun.
function unpackSamples(run) {
  const s = run.samples;
  return s.t.map(function (t, i) {
    return {
      timestamp: run.startTime + t,
      latitude: s.lat[i],
      longitude: s.lon[i],
      altitude: s.alt[i],
      accuracy: s.acc[i],
      altitudeAccuracy: s.altAcc[i],
    };
  });
}

function setText(id, text) {
  document.getElementById(id).innerText = text;
}

function renderRun(response) {
  const run = response.run;
  const samples = unpackSamples(run);
  const stats = RunStats.computeStats(samples, run.startTime, run.endTime);

  setText('run-date', formatDate(run.startTime, true));
  setText('stat-km', stats.distanceKm.toFixed(2) + ' km');
  setText('stat-mi', stats.distanceMi.toFixed(2) + ' mi · ' + Math.round(stats.distanceM) + ' m');
  setText('stat-duration', RunStats.formatDuration(stats.durationMs));
  setText('stat-pace-km', RunStats.formatPace(stats.paceMsPerKm) + ' /km');
  setText('stat-pace-mi', RunStats.formatPace(stats.paceMsPerMi) + ' /mi');
  setText('stat-kmh', stats.speedKmh.toFixed(1) + ' km/h');
  setText('stat-mph', stats.speedMph.toFixed(1) + ' mph');
  setText('footer', stats.sampleCount + ' GPS samples, ' + stats.keptCount +
    ' used for distance. This shared run is deleted after ' + formatDate(response.expiresAt, false) + '.');

  // Draw the same points that counted toward distance; fall back to every
  // sample if filtering left too few to draw a line.
  const kept = RunStats.filterSamples(samples).indices.map(function (i) { return samples[i]; });
  const drawn = kept.length >= 2 ? kept : samples;
  routePoints = drawn.map(function (sample) {
    return { lat: sample.latitude, lng: sample.longitude };
  });

  statusElement.classList.add('hidden');
  document.getElementById('stats').classList.remove('hidden');
  document.getElementById('footer').classList.remove('hidden');
  document.getElementById('map').classList.remove('hidden');

  apiKey = response.key;
  const scriptTag = document.createElement('script');
  scriptTag.src = '../js/map.js?v=1.0.0';
  document.body.appendChild(scriptTag);
}

function loadRun() {
  const id = getRunId();
  if (!id) {
    showStatus('This link is missing a valid run ID.');
    return;
  }
  // plain string body, no custom headers: a CORS simple request, no preflight
  fetch(API_DOMAIN + '/view', { method: 'POST', body: JSON.stringify({ id: id }) })
    .then(function (res) {
      if (res.status == 404) {
        showStatus('This run was not found. Shared runs are deleted 30 days after their last upload.');
        return null;
      }
      if (!res.ok) {
        showStatus('Could not load this run (error ' + res.status + '), please refresh.');
        return null;
      }
      return res.json();
    })
    .then(function (response) {
      if (response) {
        renderRun(response);
      }
    })
    .catch(function () {
      showStatus('Could not load this run, please check your connection and refresh.');
    });
}

loadRun();
