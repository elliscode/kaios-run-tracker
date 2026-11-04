# KaiOS Run Tracker

A simple GPS running tracker for KaiOS 3.x / 4.x. It records raw GPS samples at about 1 Hz, keeps every run on the phone in IndexedDB, and shows distance, time, pace, and speed. Uploading a run is optional. An uploaded run gets a private link at runtracker.elliscode.com that draws the route on a Google Map, and it's deleted 30 days after its last upload.

## Layout

| Path | What |
|---|---|
| `frontend/` | The KaiOS app (vanilla JS, no dependencies) |
| `frontend/src/js/stats.js` | Distance/pace math, the single source shared with the website |
| `backend/lambda/` | Python Lambda for `api.runtracker.elliscode.com` (`POST /upload`, `POST /view`) |
| `website/` | `runtracker.elliscode.com`: landing page and `view/index.html?id=…` share page |
| `docs/deployment-checklist.md` | AWS and Google Cloud setup, step by step |

## How a run is stored

- Each GPS sample is `{timestamp, latitude, longitude, altitude, accuracy, altitudeAccuracy}`. Raw samples are never modified.
- Distance only counts samples with accuracy ≤ 25 m. A point has to move farther than its accuracy radius from the last counted point. Jumps that imply more than 7 m/s are ignored. The thresholds are constants at the top of `stats.js`.
- Cached stats carry a `statsVersion`. Bumping `STATS_VERSION` recomputes every stored run from its raw samples.
- While recording, the run is checkpointed every 15 s and when the app goes to the background. If the app is killed mid-run, the next launch offers to save or discard what was recorded.

## Local development

- **Tests:**
  - `node --test tests/stats.test.mjs` runs the stats tests.
  - `cd backend && python3 -m unittest discover tests` runs the backend tests. boto3 is stubbed, so they make no AWS calls.
- **App in a desktop browser:** serve `frontend/` (for example `python3 -m http.server` from inside it) and open `index.html?mock=1`. Mock mode replaces the GPS with a synthetic ~3 m/s loop. Arrow keys and Enter navigate. Softkeys are the labels at the bottom, or dispatch `SoftLeft`/`SoftRight` key events.
- **Share page locally:** copy `frontend/src/js/stats.js` to `website/js/stats.js` (the copy is gitignored), then serve `website/`. It calls the real API.

## Checking on the device

Do these on both a KaiOS 3 and a KaiOS 4 phone:

1. **Get GPS:**
   - Accuracy shows and updates.
   - Start Recording turns on once accuracy is ±30 m or better.
2. **Record about 10 minutes outdoors:**
   - The sample count rises about once per second.
   - The count keeps rising with the screen off.
   - Back asks before stopping.
3. **Kill the app mid-run** (task switcher), then reopen it. You should see the "Unfinished run" dialog.
4. **Upload, open the map, and re-upload.** The link stays the same, and the stats match between the app and the page.
