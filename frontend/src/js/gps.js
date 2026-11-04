// Geolocation watch + wake locks. Gps.start() turns the GPS on and reports
// every reading; recording (deciding which readings become samples) is the
// app's job, so GPS can be warmed up before a run without storing anything.
//
// Desktop testing: open index.html?mock=1 to replace watchPosition with a
// synthetic ~3 m/s loop (adapted from the sharer's commented-out mock).
const Gps = (function () {
  const WATCH_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 30 * 1000 };
  const watchId = [];
  const wakeLocks = [];

  if (/[?&]mock=1/.test(window.location.search)) {
    installMock();
  }

  function start(onReading, onError) {
    stop();
    if (!navigator.geolocation) {
      onError({ code: 0, message: 'Geolocation is not available on this device' });
      return;
    }
    if (navigator.b2g && navigator.b2g.requestWakeLock) {
      // 'gps' keeps the receiver on, 'cpu' keeps our callbacks running with
      // the screen off.
      ['gps', 'cpu'].forEach(function (topic) {
        try {
          wakeLocks.push(navigator.b2g.requestWakeLock(topic));
        } catch (e) {
          // dont care
        }
      });
    }
    watchId.push(navigator.geolocation.watchPosition(onReading, onError, WATCH_OPTIONS));
  }

  function stop() {
    while (watchId.length > 0) {
      navigator.geolocation.clearWatch(watchId.pop());
    }
    while (wakeLocks.length > 0) {
      try {
        wakeLocks.pop().unlock();
      } catch (e) {
        // dont care
      }
    }
  }

  function isOn() {
    return watchId.length > 0;
  }

  function nullable(value) {
    return typeof value === 'number' && isFinite(value) ? value : null;
  }

  function toSample(position) {
    const c = position.coords;
    return {
      timestamp: position.timestamp || Date.now(),
      latitude: c.latitude,
      longitude: c.longitude,
      altitude: nullable(c.altitude),
      accuracy: c.accuracy,
      altitudeAccuracy: nullable(c.altitudeAccuracy),
    };
  }

  function installMock() {
    let tick = 0;
    navigator.geolocation.watchPosition = function (success) {
      tick = 0;
      return setInterval(function () {
        tick++;
        if (tick < 4) {
          return; // pretend it takes a few seconds to get a fix
        }
        // ~66 m radius (~420 m loop) at ~3 m/s, with a poor first fix and an
        // occasional ~450 m spike that stats.js should reject
        const angle = tick * 3 / 66;
        const spike = tick % 97 == 0 ? 0.004 : 0;
        success({
          timestamp: Date.now(),
          coords: {
            latitude: 42.3601 + 0.0006 * Math.sin(angle) + spike,
            longitude: -71.0589 + 0.0008 * Math.cos(angle),
            altitude: 12 + Math.sin(tick / 30),
            accuracy: tick < 7 ? 45 : 6 + (tick % 5),
            altitudeAccuracy: 15,
          },
        });
      }, 1000);
    };
    navigator.geolocation.clearWatch = function (id) { clearInterval(id); };
  }

  return { start: start, stop: stop, isOn: isOn, toSample: toSample };
})();
