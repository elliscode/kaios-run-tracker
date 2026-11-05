# Iteration checklist

Changes from the first round of testing on the Nokia 2780. We'll work through them over the next few iterations; tick them off as they land.

## App (KaiOS)

### 1. Focused button hidden behind the softkey bar
On the run detail screen, **Re-upload run** shows as focused but sits behind the softkey bar.

- [ ] **Remove the Sharing row.** Delete the `detail-share` row from `frontend/index.html` and its text logic from `renderDetail()` in `frontend/src/js/app.js`. With it gone, the first button sits above the fold.
  - Whether the run is shared is still visible from whether **Open map** appears.
  - Move the expiry date into the "Uploaded" dialog, which already shows it, and into the SMS text (item 2).
- [ ] **Fix scrolling in `frontend/src/js/nav.js` so it works in both directions.** Right now `showPanel()` always scrolls to the top before focusing, and `navigate()` only ever scrolls down. Add one helper that both of them call. It should:
  - scroll down when the focused element's bottom is below `innerHeight - SOFTKEY_CLEARANCE`;
  - scroll up when its top is above 0.

  This way, landing on a panel and moving back up from the ad both keep the focused element visible.
- [ ] **Check:** headless 240×320 screenshots of the detail screen, both before and after an upload, with every button visible when focused.

### 2. Share link by SMS
- [ ] **Add a button.** Add **Send link by SMS** to the detail screen, shown only while the run is shared (same rule as **Open map**).
- [ ] **Use the sharer's approach** (`sendLiveLinkSms()` in `kaios-gps-location-sharer/frontend-v3/src/index.js`): create an `<a>` with `href = "sms://?&body=" + encodeURIComponent(text)` and call `.click()`, which opens the Messages app with the text filled in.
- [ ] **Message text:** something like `My run on Nov 4: 3.12 km in 24:31 — runtracker.elliscode.com/view/<id>`, with no `https://`, matching the sharer. It depends on the URL change in item 6.
- [ ] **Check:** on the 2780, Messages opens with the text and the link works when tapped on a smartphone.

### 3. Ad banner focus highlight
Focus on the ad works, but nothing shows it.

- [ ] **Cause:** `.nav-selectable-ad:focus` in `frontend/src/css/run-tracker.css` uses an **inset** `box-shadow`, and the full-size banner `<img>` paints over it. Foursure hit the same problem (see `foursure/notes/kaios-softkey-fixed-position-bug.md`).
- [ ] **Fix:** use foursure's style, an outward shadow: `box-shadow: 0 0 0 3px <color>` (foursure: `foursure/frontend/css/stylesheet.css`, `.nav-selectable-ad[nav-selected="true"]`).
  - Our nav uses real focus, so keep the `:focus` selector rather than foursure's `nav-selected` attribute.
  - The left and right edges of the shadow are clipped at the screen edge, so check that the top and bottom edges are enough to read as focus. If they aren't, give `#ad-container` a few px of vertical padding.
- [ ] **Check:** with a real ad loaded, not just the placeholder, since the SDK creates its own element with our `navClass`.

### 4. Remove the "Runs" softkey
- [ ] In `frontend/src/js/app.js`, set `MAIN_SOFTKEYS` to `['', 'SELECT', '']` and remove the `SoftRight` → `openRuns()` branch in the `Nav.setKeyHandler` callback. The **View Runs** button already does this.

### 5. Icons (you)
- [ ] **Reminder:** make the real app icons and replace the placeholders at `frontend/assets/icons/kaios_56.png` and `kaios_112.png`. Match whatever format your other KaiOS apps use; the manifest's `icons` entries and sizes stay the same unless the format changes.

## Share page and infrastructure

### 6. Path-based share URLs: `/view/<id>` instead of `?id=`
- [ ] **CloudFront function.** Rewrite `/view/<16-char id>` to `/view/index.html` at viewer request, so the browser URL keeps the ID while S3 serves the page:
  ```js
  function handler(event) {
    var request = event.request;
    if (/^\/view\/[0-9A-Za-z]{16}\/?$/.test(request.uri)) {
      request.uri = '/view/index.html';
    }
    return request;
  }
  ```
  Commit it as `website/cloudfront/view-rewrite.js` so it's versioned. You create it in the console (CloudFront → Functions), publish it, and attach it to the distribution's default behavior as a **Viewer request** handler.
- [ ] **`website/js/view.js`:** read the ID from the path, like the sharer viewer's `getEndOfPath()` (`pathname.split("/").filter(Boolean)`, last part). Keep `?id=` as a fallback so any already-shared links still work.
- [ ] **`website/view/index.html`:** change the script paths to absolute (`/js/stats.js`, `/js/view.js`), and change `view.js`'s `map.js` loader to `/js/map.js`. Relative `../js/` paths break when the URL is `/view/<id>/` with a trailing slash.
- [ ] **`frontend/src/js/app.js`:** change `VIEW_URL` to `https://runtracker.elliscode.com/view/`, and remove the `index.html` comment.
- [ ] **Docs:** update `docs/deployment-checklist.md` (step 6's "no URL-rewrite function needed" line, and the smoke-test URLs) and `README.md`.
- [ ] **Check:** `/view/<id>`, `/view/<id>/`, and the old `/view/index.html?id=<id>` all load the same run; `/view/bad` shows "missing a valid run ID".

### 7. Share page layout: less dead space, bigger map
- [ ] **Fill the screen in `website/view/index.html`.** Make `body` a full-height flex column (`height: 100dvh`, with a `100vh` fallback), and let `#map` take the remaining space (`flex: 1; min-height: 220px`) instead of the fixed `height: 70vh`.
- [ ] **Shrink the footer** to one short line (for example, `123 samples · deleted after Dec 4`) with less padding.
- [ ] **Check:** at desktop size, at phone size, and at 240×320 (KaiOS browser), the map reaches the footer with no grey band underneath.

## Release
- [ ] Bump the version in `frontend/manifest.webmanifest` and the `?v=` cache-busting strings in `frontend/index.html` and `website/view/index.html`.
- [ ] Rerun `node --test tests/stats.test.mjs` and the backend tests. Do the headless mock-flow run, then the on-device checks for items 1–4.
- [ ] Deploy the website (`website/release.sh` plus a CloudFront invalidation), then package the app (`frontend/release.sh`).
