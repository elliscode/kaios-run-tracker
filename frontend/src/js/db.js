// IndexedDB storage. Two stores so the runs list never has to load every
// run's GPS samples:
//   runs    -- small per-run record: { id, startTime, endTime, status, stats,
//              statsVersion, shareId, shareToken, uploadedAt, expiresAt }
//   samples -- { id, samples: [...] }, the raw recording, never modified
// status is 'recording' while a run is in progress (checkpointed periodically
// so a crash/kill loses at most a few seconds) and 'done' once finalized.
const Db = (function () {
  const DB_NAME = 'runtracker';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = function () {
          const db = request.result;
          if (!db.objectStoreNames.contains('runs')) {
            const runs = db.createObjectStore('runs', { keyPath: 'id' });
            runs.createIndex('startTime', 'startTime');
          }
          if (!db.objectStoreNames.contains('samples')) {
            db.createObjectStore('samples', { keyPath: 'id' });
          }
        };
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error); };
      });
    }
    return dbPromise;
  }

  function transact(storeNames, mode, work) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(storeNames, mode);
        let result;
        tx.oncomplete = function () { resolve(result); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
        work(tx, function (value) { result = value; });
      });
    });
  }

  // Writes the run record, and its samples too when given (samples are
  // omitted for metadata-only updates like upload status).
  function saveRun(run, samples) {
    const stores = samples ? ['runs', 'samples'] : ['runs'];
    return transact(stores, 'readwrite', function (tx) {
      tx.objectStore('runs').put(run);
      if (samples) {
        tx.objectStore('samples').put({ id: run.id, samples: samples });
      }
    });
  }

  function getRun(id) {
    return transact(['runs'], 'readonly', function (tx, done) {
      const request = tx.objectStore('runs').get(id);
      request.onsuccess = function () { done(request.result || null); };
    });
  }

  function getSamples(id) {
    return transact(['samples'], 'readonly', function (tx, done) {
      const request = tx.objectStore('samples').get(id);
      request.onsuccess = function () { done(request.result ? request.result.samples : []); };
    });
  }

  // Newest first.
  function listRuns() {
    return transact(['runs'], 'readonly', function (tx, done) {
      const runs = [];
      const request = tx.objectStore('runs').index('startTime').openCursor(null, 'prev');
      request.onsuccess = function () {
        const cursor = request.result;
        if (cursor) {
          runs.push(cursor.value);
          cursor.continue();
        } else {
          done(runs);
        }
      };
    });
  }

  function deleteRun(id) {
    return transact(['runs', 'samples'], 'readwrite', function (tx) {
      tx.objectStore('runs').delete(id);
      tx.objectStore('samples').delete(id);
    });
  }

  return {
    saveRun: saveRun,
    getRun: getRun,
    getSamples: getSamples,
    listRuns: listRuns,
    deleteRun: deleteRun,
  };
})();
