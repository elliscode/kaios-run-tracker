# Iteration checklist

Changes from the first round of testing on the Nokia 2780. We'll work through them over the next few iterations; tick them off as they land.

**Status (Nov 5):** items 1–4 and 6–8 are implemented and tested headless. The website and CloudFront function are live. Still open: item 5 (your icons), the on-device checks, and the app release.

## App (KaiOS)

### 1. Focused button hidden behind the softkey bar
On the run detail screen, **Re-upload run** shows as focused but sits behind the softkey bar.

- [x] **Remove the Sharing row.** Delete the `detail-share` row from `frontend/index.html` and its text logic from `renderDetail()` in `frontend/src/js/app.js`. With it gone, the first button sits above the fold.
  - Whether the run is shared is still visible from whether **Open map** appears.
  - Move the expiry date into the "Uploaded" dialog, which already shows it, and into the SMS text (item 2).
  - Done. "Uploading..." now shows on the upload button itself.
- [x] **Fix scrolling in `frontend/src/js/nav.js` so it works in both directions.** Right now `showPanel()` always scrolls to the top before focusing, and `navigate()` only ever scrolls down. Add one helper that both of them call. It should:
  - scroll down when the focused element's bottom is below `innerHeight - SOFTKEY_CLEARANCE`;
  - scroll up when its top is above 0.

  This way, landing on a panel and moving back up from the ad both keep the focused element visible.

  Done as `Nav.focusElement()`. It focuses with `preventScroll`, so the browser's own scroll can't fight it, then reveals the element. `app.js` and `ads.js` use it too.
- [x] **Check:** headless 240×320 screenshots of the detail screen, both before and after an upload, with every button visible when focused. Verified in both directions, and the ad included.
- [ ] **Check on the 2780.**

### 2. Share link by SMS
- [x] **Add a button.** Add **Send link by SMS** to the detail screen, shown only while the run is shared (same rule as **Open map**).
- [x] **Use the sharer's approach** (`sendLiveLinkSms()` in `kaios-gps-location-sharer/frontend-v3/src/index.js`): create an `<a>` with `href = "sms://?&body=" + encodeURIComponent(text)` and call `.click()`, which opens the Messages app with the text filled in.
- [x] **Message text:** something like `My run on Nov 4: 3.12 km in 24:31 — runtracker.elliscode.com/view/<id>`, with no `https://`, matching the sharer. It depends on the URL change in item 6.

  As built: `My run on Nov 5: 0.03 km in 00:12 — runtracker.elliscode.com/view/<id> (link works until Dec 5)`.
- [ ] **Check:** on the 2780, Messages opens with the text and the link works when tapped on a smartphone.

### 3. Ad banner focus highlight
Focus on the ad works, but nothing shows it.

- [x] **Cause:** `.nav-selectable-ad:focus` in `frontend/src/css/run-tracker.css` uses an **inset** `box-shadow`, and the full-size banner `<img>` paints over it. Foursure hit the same problem (see `foursure/notes/kaios-softkey-fixed-position-bug.md`).
- [x] **Fix:** use foursure's style, an outward shadow: `box-shadow: 0 0 0 3px <color>` (foursure: `foursure/frontend/css/stylesheet.css`, `.nav-selectable-ad[nav-selected="true"]`).
  - Our nav uses real focus, so keep the `:focus` selector rather than foursure's `nav-selected` attribute.
  - The left and right edges of the shadow are clipped at the screen edge, so check that the top and bottom edges are enough to read as focus. If they aren't, give `#ad-container` a few px of vertical padding.

  **Changed during the work:** the outward shadow left only two faint 3 px lines, because our banner is full screen width. The ring is now a `::after` overlay with a 3 px border drawn above the ad's content, so all four sides show.
- [ ] **Check:** with a real ad loaded, not just the placeholder, since the SDK creates its own element with our `navClass`.

### 4. Remove the "Runs" softkey
- [x] In `frontend/src/js/app.js`, set `MAIN_SOFTKEYS` to `['', 'SELECT', '']` and remove the `SoftRight` → `openRuns()` branch in the `Nav.setKeyHandler` callback. The **View Runs** button already does this.

  Done, and `RECORDING_SOFTKEYS` is removed too, since it was now identical.

### 5. Icons (you)
- [ ] **Reminder:** make the real app icons and replace the placeholders at `frontend/assets/icons/kaios_56.png` and `kaios_112.png`. Match whatever format your other KaiOS apps use; the manifest's `icons` entries and sizes stay the same unless the format changes.

## Share page and infrastructure

### 6. Path-based share URLs: `/view/<id>` instead of `?id=`
- [x] **CloudFront function.** Rewrite `/view/<16-char id>` to `/view/index.html` at viewer request, so the browser URL keeps the ID while S3 serves the page. Commit it as `website/cloudfront/view-rewrite.js` so it's versioned.

  **Changed during the work:** it now rewrites any single dot-free segment under `/view/`, not just valid IDs. A mangled link then gets the page's "missing a valid run ID" message instead of S3's `AccessDenied` XML. `view.js` still validates the ID.
- [x] **You, in the console:** create the function, publish it, and attach it to the distribution's default behavior as a **Viewer request** handler. The steps are in `docs/deployment-checklist.md`, step 6. Live as of Nov 5; `/view/PItD6AcEdmefLwiS` loads.
- [x] **`website/js/view.js`:** read the ID from the path, like the sharer viewer's `getEndOfPath()` (`pathname.split("/").filter(Boolean)`, last part). Keep `?id=` as a fallback so any already-shared links still work.
- [x] **`website/view/index.html`:** change the script paths to absolute (`/js/stats.js`, `/js/view.js`), and change `view.js`'s `map.js` loader to `/js/map.js`. Relative `../js/` paths break when the URL is `/view/<id>/` with a trailing slash.
- [x] **`frontend/src/js/app.js`:** change `VIEW_URL` to `https://runtracker.elliscode.com/view/`, and remove the `index.html` comment.
- [x] **Docs:** update `docs/deployment-checklist.md` (step 6's "no URL-rewrite function needed" line, and the smoke-test URLs) and `README.md`.
- [x] **Check:** `/view/<id>`, `/view/<id>/`, and the old `/view/index.html?id=<id>` all load the same run; `/view/bad` shows "missing a valid run ID". Verified against a local server that runs the real `view-rewrite.js`.

### 7. Share page layout: less dead space, bigger map
Do this together with item 8; both change the footer.

- [x] **Fill the screen in `website/view/index.html`.** Make `body` a full-height flex column (`height: 100dvh`, with a `100vh` fallback), and let `#map` take the remaining space (`flex: 1`) instead of the fixed `height: 70vh`.

  The map's minimum height is 100 px. The stats are 2×2 below 420 px wide and 4 across above, so they never wrap 3 + 1.

  **Added after:** in the KaiOS browser, the page is map only. The header, stats and footer are hidden, and loading or error messages still show. This is detected from the user agent (`KAIOS/3.1`, `KaiOS/4.0`), not screen width, because zooming the KaiOS browser changes its CSS width.
- [x] **Shrink the footer** to one short line (for example, `123 samples · deleted after Dec 4`) with less padding.
- [x] **Check:** at desktop size, at phone size, and at 240×320 (KaiOS browser), the map reaches the footer with no grey band underneath. Verified at 1280×800, 400×700 and 240×320.

### 8. "Download JSON" button on the share page
- [x] **Add the button.** Add **Download JSON** to `website/view/index.html`, in the footer line from item 7. It's hidden on KaiOS, along with the rest of the footer (see item 7).
- [x] **Build the file in the browser, in `website/js/view.js`.** No API change is needed, since the page already has every sample.
  - Reuse `unpackSamples()`, which already produces one object per sample.
  - The file is a plain array: `[{timestamp, latitude, longitude, altitude, accuracy, altitudeAccuracy}, ...]`, with `timestamp` in epoch ms. That's the same shape the app records, so `stats.js` can read it directly.
  - Never include the Maps `key` from the `/view` response.
- [x] **Download mechanics:**
  - Turn the JSON into a file with `new Blob([JSON.stringify(samples, null, 2)], {type: 'application/json'})`, then `URL.createObjectURL`.
  - Create a temporary `<a download="run-2026-11-04-2032-<id>.json">`, `.click()` it, and revoke the URL.
- [x] **Note:** lat/lon in the file are the uploaded values, rounded to 7 decimals (about 1 cm). The unrounded originals exist only on the phone.
- [x] **Check (headless):** the file downloads, its sample count matches the footer's, the Maps key isn't in it, and the button is hidden at 240×320.
- [ ] **Check:** a download from a real phone browser.

## Release
- [x] The app's `?v=` cache-busters in `frontend/index.html` now equal the manifest's `b2g_features.version` (3.0.1). Bump them together. The website keeps its own `?v=` (currently 1.1.2), since it's deployed separately.
- [ ] **You:** bump the store version in `frontend/manifest.webmanifest`
- [ ] Rerun `node --test tests/stats.test.mjs` and the backend tests. Do the headless mock-flow run, then the on-device checks for items 1–4.
- [x] Deploy the website (`website/release.sh` plus a CloudFront invalidation) and attach the CloudFront function (item 6). Done Nov 5.
- [ ] Package the app (`frontend/release.sh`).
  - **Order matters:** the new app links to `/view/<id>`, which only works once the function is attached.
