// Thin fetch wrapper around api.runtracker.elliscode.com, same approach as
// kaios-t9-wizard/frontend-v3/js/api.js: every request is a CORS "simple
// request" (POST, plain string body, no custom headers) so there's never an
// OPTIONS preflight, and nothing here ever rejects -- every outcome resolves
// to { ok, status, body }.
const Api = (function () {
  const BASE_URL = 'https://api.runtracker.elliscode.com';
  const TIMEOUT_MS = 29000; // API Gateway's own integration timeout ceiling

  function request(path, body) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;
    return fetch(BASE_URL + path, {
      method: 'POST',
      body: body,
      signal: controller ? controller.signal : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (json) {
        return { ok: res.ok, status: res.status, body: json };
      });
    }).catch(function () {
      return { ok: false, status: 0, body: null, networkError: true };
    }).then(function (result) {
      if (timer) clearTimeout(timer);
      return result;
    });
  }

  function round(value, decimals) {
    if (value === null) {
      return null;
    }
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }

  // Column-per-field instead of an object per sample -- roughly a third of
  // the size. 7 decimal places of lat/lon is ~1 cm, so stats recomputed from
  // the upload match the app's to well under a meter.
  function packRun(run, samples) {
    const packed = { t: [], lat: [], lon: [], alt: [], acc: [], altAcc: [] };
    samples.forEach(function (s) {
      packed.t.push(s.timestamp - run.startTime);
      packed.lat.push(round(s.latitude, 7));
      packed.lon.push(round(s.longitude, 7));
      packed.alt.push(round(s.altitude, 1));
      packed.acc.push(round(s.accuracy, 1));
      packed.altAcc.push(round(s.altitudeAccuracy, 1));
    });
    return {
      v: 1,
      id: run.shareId,
      token: run.shareToken,
      startTime: run.startTime,
      endTime: run.endTime,
      samples: packed,
    };
  }

  function upload(run, samples) {
    return request('/upload', JSON.stringify(packRun(run, samples)));
  }

  return { upload: upload, BASE_URL: BASE_URL };
})();
