// Loaded by view.js once apiKey and routePoints are set. Same Google Maps
// bootstrap loader as the GPS Location Sharer's website/js/map.js.

// Replace with this project's Map ID from Google Cloud Console (see
// docs/deployment-checklist.md). DEMO_MAP_ID works for testing only.
const MAP_ID = 'DEMO_MAP_ID';
const ROUTE_COLOR = '#bf360c';

// prettier-ignore
(g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=`https://maps.${c}apis.com/maps/api/js?`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({
  key: apiKey,
  v: "weekly",
});

async function initMap() {
  const { Map, Polyline } = await google.maps.importLibrary("maps");
  const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary("marker");
  const { LatLngBounds } = await google.maps.importLibrary("core");

  const map = new Map(document.getElementById("map"), {
    center: routePoints[0],
    zoom: 15,
    streetViewControl: false,
    mapTypeControl: false,
    mapId: MAP_ID,
  });

  new Polyline({
    map: map,
    path: routePoints,
    strokeColor: ROUTE_COLOR,
    strokeOpacity: 0.9,
    strokeWeight: 4,
  });

  const start = new PinElement({ glyph: "S", background: "#2e7d32", borderColor: "#1b5e20", glyphColor: "white" });
  const finish = new PinElement({ glyph: "F", background: ROUTE_COLOR, borderColor: "#8c2a0a", glyphColor: "white" });
  new AdvancedMarkerElement({ map: map, position: routePoints[0], content: start.element, title: "Start" });
  new AdvancedMarkerElement({ map: map, position: routePoints[routePoints.length - 1], content: finish.element, title: "Finish" });

  const bounds = new LatLngBounds();
  routePoints.forEach(function (point) {
    bounds.extend(point);
  });
  map.fitBounds(bounds, 20);
}

if (routePoints.length > 0) {
  initMap();
}
