// Parsons Route Planner (no-build PWA)
// Data model
const state = {
  stops: JSON.parse(localStorage.getItem('prp.stops') || '[]'),
  defaults: JSON.parse(localStorage.getItem('prp.defaults') || '{"commercialServiceSec":45,"rolloffServiceMin":7,"startName":"Start (My Location)"}'),
  startCoords: null // {lat, lng}
};

function save() {
  localStorage.setItem('prp.stops', JSON.stringify(state.stops));
  localStorage.setItem('prp.defaults', JSON.stringify(state.defaults));
}

function el(query, root=document){ return root.querySelector(query); }
function els(query, root=document){ return [...root.querySelectorAll(query)]; }

function render() {
  // defaults
  el('#commercialSec').value = state.defaults.commercialServiceSec;
  el('#rolloffMin').value   = state.defaults.rolloffServiceMin;
  el('#startName').value    = state.defaults.startName;

  const list = el('#stops');
  list.innerHTML = '';
  state.stops.forEach((s, i) => {
    const item = document.createElement('div');
    item.className = 'stop';
    item.draggable = true;
    item.dataset.index = i;
    item.innerHTML = `
      <div class="drag">☰</div>
      <div>
        <div class="title">${i+1}. ${s.name || '(no name)'}</div>
        <div class="meta">
          ${s.type} · svc ${s.serviceSeconds}s
          ${s.lat && s.lng ? `· lat ${(+s.lat).toFixed(5)}, lng ${(+s.lng).toFixed(5)}` : ''}
          ${s.address ? `· ${s.address}` : ''}
        </div>
      </div>
      <div class="actions">
        <button class="ghost" data-action="edit">Edit</button>
        <button data-action="delete">Delete</button>
      </div>
    `;
    list.appendChild(item);
  });
  el('#totalCount').textContent = state.stops.length;

  const totalSvc = state.stops.reduce((a,s)=>a + (+s.serviceSeconds||0), 0);
  el('#totalSvc').textContent = prettyDuration(totalSvc);

  computeEstimates();
}

function prettyDuration(sec) {
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  const s = sec%60;
  return [h?`${h}h`:null, m?`${m}m`:null, s?`${s}s`:null].filter(Boolean).join(' ') || '0s';
}

function addStopFromForm() {
  const type = el('#type').value;
  const name = el('#name').value.trim();
  const address = el('#address').value.trim();
  const lat = parseFloat(el('#lat').value);
  const lng = parseFloat(el('#lng').value);
  let serviceSeconds;
  if (type === 'commercial') {
    serviceSeconds = Math.round((+el('#svcSec').value || state.defaults.commercialServiceSec));
  } else {
    serviceSeconds = Math.round(60 * (+el('#svcMin').value || state.defaults.rolloffServiceMin));
  }
  state.stops.push({type, name, address, lat: isFinite(lat)?lat:null, lng: isFinite(lng)?lng:null, serviceSeconds});
  save();
  clearStopForm();
  render();
}

function clearStopForm() {
  el('#name').value='';
  el('#address').value='';
  el('#lat').value='';
  el('#lng').value='';
  el('#svcSec').value='';
  el('#svcMin').value='';
}

function editStop(index) {
  const s = state.stops[index];
  const name = prompt('Name', s.name || '');
  if (name === null) return;
  const address = prompt('Address (optional — improves Google Maps links)', s.address || '');
  if (address === null) return;
  const lat = prompt('Latitude (optional for optimization)', s.lat ?? '');
  if (lat === null) return;
  const lng = prompt('Longitude (optional for optimization)', s.lng ?? '');
  if (lng === null) return;
  const svc = prompt('Service seconds', s.serviceSeconds ?? 0);
  if (svc === null) return;
  state.stops[index] = { ...s, name, address, lat: lat?parseFloat(lat):null, lng: lng?parseFloat(lng):null, serviceSeconds: Math.max(0, parseInt(svc||0,10)) };
  save();
  render();
}

function deleteStop(index) {
  state.stops.splice(index, 1);
  save();
  render();
}

function handleListClicks(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  const item = e.target.closest('.stop');
  const index = +item.dataset.index;
  const action = btn.dataset.action;
  if (action === 'edit') editStop(index);
  if (action === 'delete') deleteStop(index);
}

// drag reorder
let dragIndex = null;
el('#stops').addEventListener('dragstart', (e)=>{
  dragIndex = +e.target.closest('.stop')?.dataset.index;
});
el('#stops').addEventListener('dragover', (e)=>{
  e.preventDefault();
  const over = e.target.closest('.stop');
  if (!over) return;
  const overIndex = +over.dataset.index;
  if (overIndex === dragIndex) return;
  // swap
  const tmp = state.stops[dragIndex];
  state.stops[dragIndex] = state.stops[overIndex];
  state.stops[overIndex] = tmp;
  dragIndex = overIndex;
  render();
});
el('#stops').addEventListener('drop', ()=>{
  save();
});

// compute naive drive time estimate (km at 30 km/h avg urban + service time)
function computeEstimates() {
  // If we have coordinates for sequential stops, compute distance
  let distKm = 0;
  for (let i=1;i<state.stops.length;i++) {
    const a = state.stops[i-1], b = state.stops[i];
    if (isFinite(a.lat) && isFinite(a.lng) && isFinite(b.lat) && isFinite(b.lng)) {
      distKm += haversine(a.lat, a.lng, b.lat, b.lng);
    }
  }
  const avgKmh = 30; // rough urban
  const driveSec = Math.round((distKm/avgKmh) * 3600);
  const svcSec = state.stops.reduce((a,s)=>a+(+s.serviceSeconds||0),0);
  el('#estDistance').textContent = distKm.toFixed(1) + ' km';
  el('#estDrive').textContent = prettyDuration(driveSec);
  el('#estTotal').textContent = prettyDuration(driveSec + svcSec);
}

function haversine(lat1, lon1, lat2, lon2) {
  function toRad(d){ return d * Math.PI / 180; }
  const R = 6371;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// nearest neighbor optimization (requires lat/lng)
function optimizeOrder() {
  const withCoords = state.stops.map((s,i)=>({s, i})).filter(x=>isFinite(x.s.lat) && isFinite(x.s.lng));
  if (withCoords.length < 2) {
    alert('Add lat & lng to at least two stops to use Optimize.');
    return;
  }
  // Start from first stop with coords
  const start = withCoords[0].s;
  const unvisited = withCoords.slice(1).map(x=>x.s);
  const ordered = [start];
  while (unvisited.length) {
    const last = ordered[ordered.length-1];
    let best = 0, bestD = Infinity;
    for (let i=0;i<unvisited.length;i++) {
      const d = haversine(last.lat, last.lng, unvisited[i].lat, unvisited[i].lng);
      if (d < bestD) { bestD = d; best = i; }
    }
    ordered.push(unvisited.splice(best,1)[0]);
  }
  // merge back with those without coords (append at end in original order)
  const noCoords = state.stops.filter(s=>!(isFinite(s.lat)&&isFinite(s.lng)));
  state.stops = ordered.concat(noCoords);
  save();
  render();
}

// Build Google Maps directions link (let Google geocode addresses/names)
function openInGoogleMaps() {
  // Use name/address as string; maps can handle up to 25 waypoints (varies)
  const parts = state.stops.map(s=>(s.address?.trim() || s.name?.trim() || '').replace(/\s+/g,'+')).filter(Boolean);
  if (parts.length < 2) {
    alert('Add at least two stops with names or addresses.');
    return;
  }
  const url = `https://www.google.com/maps/dir/${parts.join('/')}`;
  window.open(url, '_blank');
}

// save defaults
function saveDefaults() {
  state.defaults.commercialServiceSec = Math.max(0, parseInt(el('#commercialSec').value || '45', 10));
  state.defaults.rolloffServiceMin = Math.max(0, parseInt(el('#rolloffMin').value || '7', 10));
  state.defaults.startName = el('#startName').value || 'Start (My Location)';
  save();
  alert('Defaults saved.');
}

// Try to get GPS for start (not strictly used, but displayed)
function getMyLocation() {
  if (!navigator.geolocation) { alert('Geolocation not supported.'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    state.startCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    el('#myLoc').textContent = `lat ${state.startCoords.lat.toFixed(5)}, lng ${state.startCoords.lng.toFixed(5)}`;
  }, err => {
    alert('Location error: ' + err.message);
  });
}

// Register SW
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js');
  });
}

// Events
el('#add').addEventListener('click', addStopFromForm);
el('#stops').addEventListener('click', handleListClicks);
el('#opt').addEventListener('click', optimizeOrder);
el('#gmap').addEventListener('click', openInGoogleMaps);
el('#saveDefaults').addEventListener('click', saveDefaults);
el('#loc').addEventListener('click', getMyLocation);

// initial render
render();