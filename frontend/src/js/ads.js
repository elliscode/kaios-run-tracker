// KaiOS ad banner. Adapted from foursure/frontend/js/puzzle.js's
// displayAd(): same SDK (kaiads.v5.min.js, an unmodified vendor copy), same
// shared elliscode publisher account, same "Another app by elliscode"
// placeholder, same 300 s refresh.
const KAIADS_PUBLISHER = '91b81d86-37cf-4a2f-a895-111efa5b36bb';
const KAIADS_APP = 'runtracker';
// Just a placeholder string until "runtracker" and this slot are registered
// in the KaiAds publisher dashboard; until then onerror means the
// placeholder stays up.
const KAIADS_SLOT = 'bottombar';
const AD_REFRESH_MS = 300 * 1000;

const adContainer = document.getElementById('ad-container');

// Shown immediately on every displayAd() and left up if a real ad never
// loads -- real KaiAds fill reportedly doesn't work before the app is live
// in the store. Same class/size as a real ad, but no click action.
function showAdPlaceholder() {
  const el = document.createElement('div');
  el.className = 'nav-selectable-ad';
  el.setAttribute('tabindex', '-1');
  const img = document.createElement('img');
  img.src = 'assets/img/placeholder-ad.png';
  img.alt = '';
  el.appendChild(img);
  adContainer.appendChild(el);
}

function removeAds() {
  const wasFocused = adContainer.contains(document.activeElement);
  Array.from(adContainer.getElementsByClassName('nav-selectable-ad')).forEach(function (el) {
    el.remove();
  });
  return wasFocused;
}

function displayAd() {
  // No ad traffic mid-run: recording should need no network, and each
  // refresh costs battery. The current banner just stays up until the run ends.
  if (mode == 'recording' && adContainer.childElementCount > 0) {
    return;
  }
  const wasFocused = removeAds();
  showAdPlaceholder();
  if (wasFocused) {
    adContainer.firstElementChild.focus();
  }
  if (typeof getKaiAd !== 'function') {
    return;
  }
  getKaiAd({
    publisher: KAIADS_PUBLISHER,
    app: KAIADS_APP,
    slot: KAIADS_SLOT,
    h: 60,
    w: 240,
    // container is required for responsive ads
    container: adContainer,
    onerror: function () {
      // a missing ad must never affect the app; the placeholder stays up
    },
    onready: function (ad) {
      removeAds();
      ad.call('display', {
        // the app owns D-pad navigation; nav.js picks the ad up by this class
        tabindex: -1,
        navClass: 'nav-selectable-ad',
        display: 'block',
      });
    },
  });
}

displayAd();
setInterval(displayAd, AD_REFRESH_MS);
