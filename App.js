/* ========= CONFIG ========= */
const MAPBOX_TOKEN = "PUT_YOUR_MAPBOX_TOKEN_HERE"; // <-- required
const DEFAULT_CENTER = [-94.2, 36.4]; // [lng,lat]

/* ========= MAP INIT (MapLibre + OSM tiles) ========= */
const map = new maplibregl.Map({
  container: "map",
  style: "https://demotiles.maplibre.org/style.json",
  center: DEFAULT_CENTER,
  zoom: 9
});
map.addControl(new maplibregl.NavigationControl(), "top-right");

/* ========= UI HOOKS ========= */
const els = {
  routeType: document.getElementById("routeType"),
  svc: document.getElementById("svc"),
  departAt: document.getElementById("departAt"),
  preview: document.getElementById("previewToggle"),
  file: document.getElementById("fileInput"),
  startLat: document.getElementById("startLat"),
  startLng: document.getElementById("startLng"),
  returnToStart: document.getElementById("returnToStart"),
  totals: document.getElementById("totals"),
  etaList: document.getElementById("etaList"),
  optimizeBtn: document.getElementById("optimizeBtn")
};

els.routeType.addEventListener("change", () => {
  if (els.routeType.value === "rolloff") els.svc.value = "420";
  else els.svc.value = "45";
});

/* ========= CSV LOAD ========= */
let loadedStops = []; // {id,name,lat,lng,serviceSeconds,notes,address?}

els.file.addEventListener("change", () => {
  const f = els.file.files?.[0];
  if (!f) return;
  Papa.parse(f, {
    header: true,
    skipEmptyLines: true,
    complete: (res) => {
      loadedStops = (res.data || []).map((row, i) => ({
        id: row.id || `S${i+1}`,
        name: row.name || `Stop ${i+1}`,
        lat: row.lat ? Number(row.lat) : null,
        lng: row.lng ? Number(row.lng) : null,
        serviceSeconds: row.serviceSeconds ? Number(row.serviceSeconds) : undefined,
        notes: row.notes || "",
        address: row.address || ""
      }));
      alert(`Loaded ${loadedStops.length} rows.`);
    }
  });
});

/* ========= HELPERS ========= */
const fmtHMS = (sec) => {
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  const s = Math.floor(sec%60);
  return `${h? h+"h ": ""}${m? m+"m ": ""}${(!h&&!m)? s+"s": ""}`.trim() || "0s";
};
const kmToMiles = (m) => (m/1609.344);

/* ========= MAP DRAW ========= */
function drawStops(stops){
  const fc = {
    type: "FeatureCollection",
    features: stops.map(s => ({
      type: "Feature",
      properties: { id: s.id, name: s.name },
      geometry: { type: "Point", coordinates: [s.lng, s.lat] }
    }))
  };
  if (map.getSource("stops")) map.getSource("stops").setData(fc);
  else {
    map.addSource("stops", { type: "geojson", data: fc });
    map.addLayer({ id:"stops-circle", type:"circle", source:"stops",
      paint:{ "circle-radius":6, "circle-color":"#1d9bf0", "circle-stroke-width":1, "circle-stroke-color":"#fff" }});
  }
}

function drawLine(geojson){
  if (!els.preview.checked) {
    if (map.getLayer("route-line")) map.removeLayer("route-line");
    if (map.getSource("route")) map.removeSource("route");
    return;
  }
  if (map.getSource("route")) map.getSource("route").setData(geojson);
  else {
    map.addSource("route", { type: "geojson", data: geojson });
    map.addLayer({ id:"route-line", type:"line", source:"route", paint:{
      "line-width":5, "line-color":"#177cc2"
    }});
  }
  // fit
  const bbox = turf.bbox(geojson);
  map.fitBounds(bbox, { padding: 40, duration: 500 });
}

/* ========= MAPBOX API ========= */
async function mapboxGeocodeOne(q){
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&limit=1`;
  const j = await (await fetch(url)).json();
  const f = j.features?.[0];
  return f ? { lat: f.center[1], lng: f.center[0] } : null;
}

async function mapboxMatrix(coords, departAtISO){
  // coords as [ [lng,lat], ... ]
  const pts = coords.map(c => c.join(",")).join(";");
  const depart = departAtISO ? `&depart_at=${encodeURIComponent(departAtISO)}` : "";
  const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving-traffic/${pts}?annotations=duration${depart}&access_token=${MAPBOX_TOKEN}`;
  const j = await (await fetch(url)).json();
  if (!j?.durations) throw new Error("Matrix failed");
  return j.durations; // seconds
}

async function mapboxRoute(coords, departAtISO){
  const pts = coords.map(c => c.join(",")).join(";");
  const depart = departAtISO ? `&depart_at=${encodeURIComponent(departAtISO)}` : "";
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${pts}?geometries=geojson&overview=full${depart}&access_token=${MAPBOX_TOKEN}`;
  const j = await (await fetch(url)).json();
  if (!j?.routes?.length) throw new Error("Route failed");
  const R = j.routes[0];
  return {
    legs: R.legs.map(L => ({ driveSeconds: Math.round(L.duration), driveMeters: Math.round(L.distance) })),
    line: R.geometry // GeoJSON line
  };
}

/* ========= SIMPLE OPTIMIZER (NN + 2-opt) ========= */
function nearestNeighbor(n, dist){
  const un = new Set([...Array(n).keys()]); const path=[];
  let cur = 0; path.push(cur); un.delete(cur);
  while(un.size){
    let best=-1, bd=Infinity;
    for(const j of un){ const d = dist(cur,j); if(d<bd){bd=d;best=j;} }
    cur = best; un.delete(cur); path.push(cur);
  }
  return path;
}
function twoOpt(order, dist){
  let improved = true;
  while(improved){
    improved=false;
    for(let i=0;i<order.length-2;i++){
      for(let k=i+2;k<order.length;k++){
        const a=order[i], b=order[i+1], c=order[k-1], d=order[k];
        const delta = (dist(a,b)+dist(c,d)) - (dist(a,c)+dist(b,d));
        if (delta>0){
          order = [...order.slice(0,i+1), ...order.slice(i+1,k).reverse(), ...order.slice(k)];
          improved=true;
        }
      }
    }
  }
  return order;
}

/* ========= MAIN: BUILD INPUT & RUN ========= */
els.optimizeBtn.addEventListener("click", async () => {
  try{
    if (!MAPBOX_TOKEN || MAPBOX_TOKEN.startsWith("PUT_")) {
      alert("Add your Mapbox token in app.js first.");
      return;
    }
    if (!loadedStops.length){ alert("Upload a CSV first."); return; }

    // 1) Default service time from UI + route type preset
    const defaultSvc = Number(els.svc.value || (els.routeType.value === "rolloff" ? 420 : 45));

    // 2) Geocode any rows that have address but no lat/lng
    for (const s of loadedStops){
      if ((s.lat==null || s.lng==null) && s.address){
        const g = await mapboxGeocodeOne(s.address);
        if (g){ s.lat=g.lat; s.lng=g.lng; }
      }
    }
    const stops = loadedStops.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng));
    if (!stops.length){ alert("No valid coordinates after geocoding."); return; }

    // 3) Start / End
    const startLat = parseFloat(els.startLat.value || DEFAULT_CENTER[1]);
    const startLng = parseFloat(els.startLng.value || DEFAULT_CENTER[0]);
    const returnToStart = els.returnToStart.checked;

    // 4) Departure time
    const departAtISO = els.departAt.value
      ? new Date(els.departAt.value).toISOString()
      : new Date(Date.now()).toISOString();

    // 5) Build coords: [start] + stops (+ return)
    const coords = [[startLng, startLat], ...stops.map(s => [s.lng, s.lat])];
    if (returnToStart) coords.push([startLng, startLat]);

    // 6) Time-aware MATRIX at departAt
    const M = await mapboxMatrix(coords, departAtISO);

    // 7) Optimize order for the stops only (indices 1..N)
    const n = stops.length;
    const dist = (i,j) => M[1+i][1+j]; // seconds from stop i to stop j
    let order = nearestNeighbor(n, dist);
    order = twoOpt(order, dist);

    const orderedStops = order.map(i => stops[i]);

    // 8) Build the final path with per-leg departAt cascade + service times
    let clock = new Date(departAtISO).getTime();
    let totalDrive=0, totalMeters=0, totalService=0;
    const perStopETA = {};

    // Start → first stop
    const seq = [[startLng,startLat], ...orderedStops.map(s => [s.lng,s.lat])];
    const allLegs = [];
    for (let i=0;i<seq.length-1;i++){
      const legDepart = new Date(clock).toISOString();
      const R = await mapboxRoute([seq[i], seq[i+1]], legDepart);
      const L = R.legs[0];
      allLegs.push(L);
      totalDrive += L.driveSeconds;
      totalMeters += L.driveMeters;
      clock += L.driveSeconds*1000;

      const svc = Number.isFinite(orderedStops[i]?.serviceSeconds)
        ? orderedStops[i].serviceSeconds
        : defaultSvc;

      if (orderedStops[i]) {
        perStopETA[orderedStops[i].id] = new Date(clock).toLocaleString();
        clock += (svc*1000);
        totalService += svc;
      }
    }

    // 9) Render map layers
    drawStops(orderedStops);
    if (els.preview.checked){
      // One consolidated line for the full sequence
      const fullRoute = await mapboxRoute(seq, departAtISO);
      drawLine({ type:"FeatureCollection", features:[
        { type:"Feature", properties:{}, geometry: fullRoute.line }
      ]});
    } else {
      drawLine({ type:"FeatureCollection", features:[] });
    }

    // 10) Totals panel
    const etaEnd = new Date(clock).toLocaleString();
    els.totals.textContent =
      `Drive: ${fmtHMS(totalDrive)} (${kmToMiles(totalMeters).toFixed(1)} mi) • ` +
      `Service: ${fmtHMS(totalService)} • ETA finish: ${etaEnd}`;

    // 11) Per-stop ETA cards
    els.etaList.innerHTML = "";
    orderedStops.forEach((s, idx) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML =
        `<strong>${idx+1}. ${s.name || s.id}</strong><div class="time">ETA: ${perStopETA[s.id] || "—"}</div>` +
        (s.notes ? `<div>${s.notes}</div>` : "");
      els.etaList.appendChild(card);
    });

  }catch(err){
    console.error(err);
    alert("Routing error: " + (err?.message || err));
  }
});
