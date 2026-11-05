// Screens and wiring: main (GPS + recording), runs list, run detail.
const FIX_ACCURACY_M = 30; // a reading this good enables Start Recording
const MIN_SAMPLE_INTERVAL_MS = 900; // ~1 Hz; extra readings are dropped
const CHECKPOINT_MS = 15 * 1000; // in-progress run saved this often
const STALE_READING_MS = 10 * 1000; // no reading for this long -> "No signal"
// index.html spelled out: CloudFront's default root object only covers "/"
const VIEW_URL = 'https://runtracker.elliscode.com/view/index.html?id=';
const ID_CHARACTERS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const mainUi = document.getElementById('main-ui');
const runsUi = document.getElementById('runs-ui');
const detailUi = document.getElementById('detail-ui');
const gpsStatusElement = document.getElementById('gps-status');
const elapsedElement = document.getElementById('elapsed');
const distanceKmElement = document.getElementById('distance-km');
const distanceMiElement = document.getElementById('distance-mi');
const recordStatusElement = document.getElementById('record-status');
const primaryElement = document.getElementById('primary');
const stopGpsElement = document.getElementById('stop-gps');
const viewRunsElement = document.getElementById('view-runs');
const runsListElement = document.getElementById('runs-list');
const runsEmptyElement = document.getElementById('runs-empty');
const uploadElement = document.getElementById('upload');
const openMapElement = document.getElementById('open-map');
const deleteRunElement = document.getElementById('delete-run');

const MAIN_SOFTKEYS = ['', 'SELECT', 'Runs'];
const RECORDING_SOFTKEYS = ['', 'SELECT', ''];
const SUB_SOFTKEYS = ['Back', 'SELECT', ''];

// 'idle' -> 'acquiring' -> 'ready' -> 'recording' -> back to 'idle'
let mode = 'idle';
let lastReading = null;
let lastReadingAt = 0;
let currentRun = null;
let currentSamples = [];
let lastSampleTimestamp = 0;
let uiInterval = undefined;
let checkpointInterval = undefined;
let detailRun = null;
let uploading = false;

function setSelectable(element, selectable) {
  element.setAttribute('nav-selectable', selectable ? 'true' : 'false');
  element.classList.toggle('hidden', !selectable);
}

function randomString(length) {
  const output = [];
  while (output.length < length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length && output.length < length; i++) {
      // 248 = 4 * 62, rejecting the rest keeps every character equally likely
      if (bytes[i] < 248) {
        output.push(ID_CHARACTERS[bytes[i] % ID_CHARACTERS.length]);
      }
    }
  }
  return output.join('');
}

function newRunId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now() + '-' + randomString(8);
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function formatDate(ms) {
  const d = new Date(ms);
  return MONTHS[d.getMonth()] + ' ' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function formatDay(ms) {
  const d = new Date(ms);
  return MONTHS[d.getMonth()] + ' ' + d.getDate();
}

// ---------------------------------------------------------------- main screen

function renderMain() {
  if (mode == 'idle') {
    primaryElement.innerText = 'Get GPS';
  } else if (mode == 'recording') {
    primaryElement.innerText = 'Stop Recording';
  } else {
    primaryElement.innerText = 'Start Recording';
  }
  primaryElement.setAttribute('nav-selectable', mode == 'acquiring' ? 'false' : 'true');
  setSelectable(stopGpsElement, mode == 'acquiring' || mode == 'ready');
  viewRunsElement.setAttribute('nav-selectable', mode == 'recording' ? 'false' : 'true');
  if (mainUi.getAttribute('active') == 'true') {
    Nav.setPanelSoftkeys.apply(null, mode == 'recording' ? RECORDING_SOFTKEYS : MAIN_SOFTKEYS);
    const focused = document.activeElement;
    if (!focused || (focused.getAttribute('nav-selectable') != 'true' && !focused.classList.contains('nav-selectable-ad'))) {
      Nav.selectFirstElement();
    }
  }
  renderLive();
}

function renderLive() {
  if (mode == 'idle') {
    gpsStatusElement.innerText = 'Off';
  } else if (!lastReading) {
    gpsStatusElement.innerText = 'Acquiring...';
  } else if (Date.now() - lastReadingAt > STALE_READING_MS) {
    gpsStatusElement.innerText = 'No signal (last ±' + Math.round(lastReading.accuracy) + ' m)';
  } else {
    const prefix = mode == 'acquiring' ? 'Weak fix ±' : 'Fix ±';
    gpsStatusElement.innerText = prefix + Math.round(lastReading.accuracy) + ' m';
  }

  if (mode == 'recording') {
    const now = Date.now();
    const stats = RunStats.computeStats(currentSamples, currentRun.startTime, now);
    elapsedElement.innerText = RunStats.formatDuration(now - currentRun.startTime);
    distanceKmElement.innerText = stats.distanceKm.toFixed(2);
    distanceMiElement.innerText = stats.distanceMi.toFixed(2);
    recordStatusElement.innerText = 'Recording · ' + currentSamples.length + ' samples';
  } else if (mode == 'ready') {
    recordStatusElement.innerText = 'Ready to record';
  } else if (mode == 'acquiring') {
    recordStatusElement.innerText = 'Waiting for ±' + FIX_ACCURACY_M + ' m fix';
  } else {
    recordStatusElement.innerText = 'Not recording';
  }
}

function onReading(position) {
  const sample = Gps.toSample(position);
  lastReading = sample;
  lastReadingAt = Date.now();
  if (mode == 'acquiring' && sample.accuracy <= FIX_ACCURACY_M) {
    mode = 'ready';
    renderMain();
    primaryElement.focus();
    return;
  }
  if (mode == 'recording' && sample.timestamp - lastSampleTimestamp >= MIN_SAMPLE_INTERVAL_MS) {
    currentSamples.push(sample);
    lastSampleTimestamp = sample.timestamp;
  }
  if (mode != 'recording') {
    // while recording the 1 s interval redraws; otherwise redraw per reading
    renderLive();
  }
}

function onGpsError(error) {
  // TIMEOUT / POSITION_UNAVAILABLE: the watch keeps trying, and renderLive
  // shows "No signal" once readings go stale. Only a permission problem (or
  // no geolocation at all) is fatal.
  if (error.code == 1 || error.code == 0) {
    const wasRecording = mode == 'recording';
    if (wasRecording) {
      stopRecording();
    } else {
      stopGps();
    }
    Nav.showDialog('Location unavailable', (error.code == 1
      ? 'Location permission was denied. Enable it for Run Tracker in Settings.'
      : error.message) + (wasRecording ? ' Your run so far was saved.' : ''));
  }
}

function startGps() {
  lastReading = null;
  mode = 'acquiring';
  Gps.start(onReading, onGpsError);
  renderMain();
  if (!uiInterval) {
    uiInterval = setInterval(renderLive, 1000);
  }
}

function stopGps() {
  Gps.stop();
  clearInterval(uiInterval);
  uiInterval = undefined;
  lastReading = null;
  mode = 'idle';
  renderMain();
}

function startRecording() {
  const now = Date.now();
  currentRun = { id: newRunId(), startTime: now, endTime: now, status: 'recording', stats: null, statsVersion: null };
  currentSamples = [];
  lastSampleTimestamp = 0;
  mode = 'recording';
  elapsedElement.innerText = '00:00';
  distanceKmElement.innerText = '0.00';
  distanceMiElement.innerText = '0.00';
  checkpoint();
  checkpointInterval = setInterval(checkpoint, CHECKPOINT_MS);
  renderMain();
  primaryElement.focus();
}

function checkpoint() {
  if (mode != 'recording') {
    return Promise.resolve();
  }
  currentRun.endTime = Date.now();
  return Db.saveRun(currentRun, currentSamples).catch(function (e) {
    console.log('checkpoint failed', e);
  });
}

function finalizeRun(run, samples, endTime) {
  run.endTime = endTime;
  run.status = 'done';
  run.stats = RunStats.computeStats(samples, run.startTime, run.endTime);
  run.statsVersion = run.stats.statsVersion;
  return Db.saveRun(run, samples);
}

function stopRecording() {
  clearInterval(checkpointInterval);
  checkpointInterval = undefined;
  const run = currentRun;
  const samples = currentSamples;
  currentRun = null;
  currentSamples = [];
  stopGps();
  return finalizeRun(run, samples, Date.now()).then(function () {
    return run;
  });
}

function confirmStop() {
  Nav.showConfirm('Stop recording?', 'Stop and save this run?',
    'Keep going', null,
    'Stop', function () {
      stopRecording().then(function (run) {
        openDetail(run.id);
      }).catch(function (e) {
        Nav.showDialog('Save failed', 'Could not save the run: ' + e);
      });
    });
}

function primaryClicked() {
  if (mode == 'idle') {
    startGps();
  } else if (mode == 'ready') {
    startRecording();
  } else if (mode == 'recording') {
    confirmStop();
  }
}

// A run left in 'recording' state means the app was killed mid-run.
function recoverUnfinishedRun() {
  return Db.listRuns().then(function (runs) {
    const unfinished = runs.find(function (run) { return run.status == 'recording'; });
    if (!unfinished) {
      return;
    }
    Nav.showConfirm('Unfinished run',
      'A run from ' + formatDate(unfinished.startTime) + ' was interrupted. Save what was recorded, or discard it?',
      'Discard', function () {
        Db.deleteRun(unfinished.id).then(recoverUnfinishedRun);
      },
      'Save', function () {
        Db.getSamples(unfinished.id).then(function (samples) {
          const endTime = samples.length > 0 ? samples[samples.length - 1].timestamp : unfinished.startTime;
          return finalizeRun(unfinished, samples, endTime);
        }).then(recoverUnfinishedRun);
      });
  });
}

// ------------------------------------------------------------------ runs list

function ensureStats(run) {
  if (run.stats && run.statsVersion == RunStats.STATS_VERSION) {
    return Promise.resolve(run);
  }
  return Db.getSamples(run.id).then(function (samples) {
    run.stats = RunStats.computeStats(samples, run.startTime, run.endTime);
    run.statsVersion = run.stats.statsVersion;
    return Db.saveRun(run);
  }).then(function () {
    return run;
  });
}

function runLabel(run) {
  const label = formatDate(run.startTime) + ' · ' + RunStats.formatDuration(run.stats.durationMs) +
    ' · ' + run.stats.distanceKm.toFixed(2) + ' km';
  return run.status == 'recording' ? label + ' (unfinished)' : label;
}

function openRuns(selectId) {
  Db.listRuns().then(function (runs) {
    return runs.reduce(function (chain, run) {
      return chain.then(function () { return ensureStats(run); });
    }, Promise.resolve()).then(function () { return runs; });
  }).then(function (runs) {
    runsListElement.innerHTML = '';
    runs.forEach(function (run) {
      const button = document.createElement('button');
      button.setAttribute('nav-selectable', 'true');
      button.classList.add('run-row');
      button.innerText = runLabel(run);
      button.addEventListener('click', function () { openDetail(run.id); });
      button.dataset.id = run.id;
      runsListElement.appendChild(button);
    });
    runsEmptyElement.classList.toggle('hidden', runs.length > 0);
    Nav.showPanel(runsUi, SUB_SOFTKEYS);
    const selected = selectId && runsListElement.querySelector('[data-id="' + selectId + '"]');
    if (selected) {
      selected.focus();
    }
  });
}

// ----------------------------------------------------------------- run detail

function isShared(run) {
  return !!(run.shareId && run.expiresAt && run.expiresAt > Date.now());
}

function renderDetail() {
  const run = detailRun;
  const s = run.stats;
  document.getElementById('detail-title').innerText = formatDate(run.startTime);
  document.getElementById('detail-distance').innerText =
    s.distanceKm.toFixed(2) + ' km\n' + s.distanceMi.toFixed(2) + ' mi\n' + Math.round(s.distanceM) + ' m';
  document.getElementById('detail-duration').innerText = RunStats.formatDuration(s.durationMs);
  document.getElementById('detail-pace').innerText =
    RunStats.formatPace(s.paceMsPerKm) + ' /km · ' + RunStats.formatPace(s.paceMsPerMi) + ' /mi';
  document.getElementById('detail-speed').innerText =
    s.speedKmh.toFixed(1) + ' km/h · ' + s.speedMph.toFixed(1) + ' mph';
  document.getElementById('detail-samples').innerText =
    s.sampleCount + ' recorded, ' + s.keptCount + ' used for distance';

  let shareText = 'Not uploaded';
  if (uploading) {
    shareText = 'Uploading...';
  } else if (isShared(run)) {
    shareText = 'Shared · expires ' + formatDay(run.expiresAt);
  } else if (run.uploadedAt) {
    shareText = 'Expired, re-upload to view the map';
  }
  document.getElementById('detail-share').innerText = shareText;
  uploadElement.innerText = run.uploadedAt ? 'Re-upload run' : 'Upload & share run';
  setSelectable(openMapElement, isShared(run));
}

function openDetail(id) {
  Db.getRun(id).then(function (run) {
    return ensureStats(run);
  }).then(function (run) {
    detailRun = run;
    renderDetail();
    Nav.showPanel(detailUi, SUB_SOFTKEYS);
  });
}

function uploadErrorMessage(result) {
  if (result.networkError) {
    return 'No internet connection, or the server could not be reached.';
  }
  const message = result.body && result.body.message ? ' (' + result.body.message + ')' : '';
  if (result.status == 413) {
    return 'This run is too large to upload' + message + '.';
  }
  return 'Upload failed with status ' + result.status + message + '.';
}

function uploadClicked() {
  if (uploading) {
    return;
  }
  const run = detailRun;
  // The share ID is created once and kept, so re-uploads keep the same URL.
  if (!run.shareId) {
    run.shareId = randomString(16);
    run.shareToken = randomString(32);
  }
  uploading = true;
  renderDetail();
  Db.saveRun(run).then(function () {
    return Db.getSamples(run.id);
  }).then(function (samples) {
    return Api.upload(run, samples);
  }).then(function (result) {
    uploading = false;
    if (result.ok && result.body) {
      run.uploadedAt = Date.now();
      run.expiresAt = result.body.expiresAt;
      return Db.saveRun(run).then(function () {
        renderDetail();
        Nav.showDialog('Uploaded', 'Run uploaded. It can be viewed on a map until ' + formatDay(run.expiresAt) + '.');
      });
    }
    renderDetail();
    Nav.showDialog('Upload failed', uploadErrorMessage(result));
  }).catch(function (e) {
    uploading = false;
    renderDetail();
    Nav.showDialog('Upload failed', String(e));
  });
}

function openMapClicked() {
  try {
    window.open(VIEW_URL + detailRun.shareId, '_blank');
  } catch (e) {
    Nav.showDialog('Could not open map', String(e));
  }
}

function deleteClicked() {
  const run = detailRun;
  const sharedNote = isShared(run) ? ' The uploaded copy will expire on its own on ' + formatDay(run.expiresAt) + '.' : '';
  Nav.showConfirm('Delete run?', 'Delete the run from ' + formatDate(run.startTime) + '? This cannot be undone.' + sharedNote,
    'Cancel', null,
    'Delete', function () {
      Db.deleteRun(run.id).then(function () {
        detailRun = null;
        openRuns();
      });
    });
}

// ----------------------------------------------------------------------- keys

function showMain() {
  Nav.showPanel(mainUi, mode == 'recording' ? RECORDING_SOFTKEYS : MAIN_SOFTKEYS);
  renderMain();
}

function goBack() {
  if (detailUi.getAttribute('active') == 'true') {
    openRuns(detailRun ? detailRun.id : undefined);
  } else {
    showMain();
  }
}

Nav.setKeyHandler(function (key) {
  const onMain = mainUi.getAttribute('active') == 'true';
  if (onMain) {
    if (key == 'Backspace' && mode == 'recording') {
      // never let Back close the app mid-run
      confirmStop();
      return true;
    }
    if (key == 'SoftRight' && mode != 'recording') {
      openRuns();
      return true;
    }
    return false; // Backspace while not recording exits the app as usual
  }
  if (key == 'Backspace' || key == 'SoftLeft') {
    goBack();
    return true;
  }
  return false;
});

primaryElement.addEventListener('click', primaryClicked);
stopGpsElement.addEventListener('click', stopGps);
viewRunsElement.addEventListener('click', function () { openRuns(); });
uploadElement.addEventListener('click', uploadClicked);
openMapElement.addEventListener('click', openMapClicked);
deleteRunElement.addEventListener('click', deleteClicked);

document.addEventListener('visibilitychange', function () {
  if (document.hidden) {
    checkpoint();
  } else {
    renderLive();
  }
});

showMain();
recoverUnfinishedRun();
