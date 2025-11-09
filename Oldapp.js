
// Republic Route Planner (light blue)
const state = {
  stops: JSON.parse(localStorage.getItem('rrp.stops') || '[]'),
  defaults: JSON.parse(localStorage.getItem('rrp.defaults') || '{"commercialServiceSec":45,"rolloffServiceMin":7,"dumpServiceMin":10,"startName":"Start (Yard)"}'),
  startCoords: null
};
const el=(q,r=document)=>r.querySelector(q);
const els=(q,r=document)=>[...r.querySelectorAll(q)];

function save(){ localStorage.setItem('rrp.stops', JSON.stringify(state.stops)); localStorage.setItem('rrp.defaults', JSON.stringify(state.defaults)); }
function prettyDuration(sec){ const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=sec%60; return [h?`${h}h`:null, m?`${m}m`:null, s?`${s}s`:null].filter(Boolean).join(' ')||'0s'; }

function render(){
  el('#commercialSec').value = state.defaults.commercialServiceSec;
  el('#rolloffMin').value = state.defaults.rolloffServiceMin;
  el('#dumpMin').value = state.defaults.dumpServiceMin;
  el('#startName').value = state.defaults.startName;

  const list = el('#stops'); list.innerHTML='';
  state.stops.forEach((s,i)=>{
    const item = document.createElement('div');
    item.className='stop'; item.draggable=true; item.dataset.index=i; item.dataset.type=s.type;
    const title = s.type==='dump' ? `DS: ${s.name||'(Dump)'}` : `${i+1}. ${s.name||'(no name)'}`;
    const svcText = `${s.serviceSeconds||0}s`;
    item.innerHTML = `
      <div class="drag">☰</div>
      <div>
        <div class="title">${title}</div>
        <div class="meta">
          ${s.type} · svc ${svcText}
          ${s.lat&&s.lng?`· ${(+s.lat).toFixed(5)}, ${(+s.lng).toFixed(5)}`:''}
          ${s.address?`· ${s.address}`:''}
          ${s.notes?` · notes: ${s.notes}`:''}
        </div>
      </div>
      <div class="actions">
        <button class="ghost" data-action="edit">Edit</button>
        <button data-action="delete">Delete</button>
      </div>`;
    list.appendChild(item);
  });

  el('#totalCount').textContent = state.stops.length;
  const totalSvc = state.stops.reduce((a,s)=>a+(+s.serviceSeconds||0),0);
  el('#totalSvc').textContent = prettyDuration(totalSvc);
  const byType = {commercial:0, rolloff:0, dump:0};
  state.stops.forEach(s=>byType[s.type]=(byType[s.type]||0)+1);
  el('#countCommercial').textContent = byType.commercial||0;
  el('#countRolloff').textContent = byType.rolloff||0;
  el('#countDump').textContent = byType.dump||0;

  computeEstimates();
}

function addStopFromForm(){
  const type = el('#type').value;
  const name = el('#name').value.trim();
  const address = el('#address').value.trim();
  const lat = parseFloat(el('#lat').value);
  const lng = parseFloat(el('#lng').value);
  const notes = el('#notes').value.trim();
  let serviceSeconds;
  if (type==='commercial') serviceSeconds = Math.round(+el('#svcSec').value || state.defaults.commercialServiceSec);
  else if (type==='rolloff') serviceSeconds = Math.round(60*(+el('#svcMin').value || state.defaults.rolloffServiceMin));
  else serviceSeconds = Math.round(60*(+el('#svcDumpMin').value || state.defaults.dumpServiceMin));
  state.stops.push({type, name, address, lat:isFinite(lat)?lat:null, lng:isFinite(lng)?lng:null, serviceSeconds, notes});
  save(); clearStopForm(); render();
}
function clearStopForm(){ ['#name','#address','#lat','#lng','#svcSec','#svcMin','#svcDumpMin','#notes'].forEach(id=>el(id).value=''); }

function editStop(i){
  const s = state.stops[i];
  const name = prompt('Name', s.name||''); if (name===null) return;
  const address = prompt('Address', s.address||''); if (address===null) return;
  const lat = prompt('Latitude', s.lat??''); if (lat===null) return;
  const lng = prompt('Longitude', s.lng??''); if (lng===null) return;
  const svc = prompt('Service seconds', s.serviceSeconds??0); if (svc===null) return;
  const notes = prompt('Notes', s.notes||''); if (notes===null) return;
  state.stops[i] = {...s, name, address, lat:lat?parseFloat(lat):null, lng:lng?parseFloat(lng):null, serviceSeconds:Math.max(0,parseInt(svc||0,10)), notes};
  save(); render();
}
function deleteStop(i){ state.stops.splice(i,1); save(); render(); }

el('#stops').addEventListener('click', (e)=>{
  const btn = e.target.closest('button'); if (!btn) return;
  const i = +e.target.closest('.stop').dataset.index;
  if (btn.dataset.action==='edit') editStop(i);
  if (btn.dataset.action==='delete') deleteStop(i);
});

let dragIndex=null;
el('#stops').addEventListener('dragstart', e=>{ dragIndex = +e.target.closest('.stop')?.dataset.index; });
el('#stops').addEventListener('dragover', e=>{
  e.preventDefault();
  const over = e.target.closest('.stop'); if (!over) return;
  const oi = +over.dataset.index; if (oi===dragIndex) return;
  [state.stops[dragIndex], state.stops[oi]] = [state.stops[oi], state.stops[dragIndex]];
  dragIndex = oi; render();
});
el('#stops').addEventListener('drop', ()=>save());

function haversine(lat1, lon1, lat2, lon2){ const toRad=d=>d*Math.PI/180, R=6371; const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1); const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2; return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)); }
function computeEstimates(){
  let distKm=0;
  for (let i=1;i<state.stops.length;i++){
    const a=state.stops[i-1], b=state.stops[i];
    if (isFinite(a.lat)&&isFinite(a.lng)&&isFinite(b.lat)&&isFinite(b.lng)) distKm += haversine(a.lat,a.lng,b.lat,b.lng);
  }
  const avgKmh = 30;
  const driveSec = Math.round((distKm/avgKmh)*3600);
  const svcSec = state.stops.reduce((a,s)=>a+(+s.serviceSeconds||0),0);
  el('#estDistance').textContent = distKm.toFixed(1)+' km';
  el('#estDrive').textContent = prettyDuration(driveSec);
  el('#estTotal').textContent = prettyDuration(driveSec+svcSec);
}
function optimizeOrder(){
  const withC = state.stops.map((s,i)=>({s,i})).filter(x=>isFinite(x.s.lat)&&isFinite(x.s.lng));
  if (withC.length<2){ alert('Add lat/lng to at least two stops.'); return; }
  const start = withC[0].s;
  const unv = withC.slice(1).map(x=>x.s);
  const ordered=[start];
  while(unv.length){
    const last=ordered[ordered.length-1];
    let bi=0, bd=Infinity;
    for (let i=0;i<unv.length;i++){ const d=haversine(last.lat,last.lng,unv[i].lat,unv[i].lng); if (d<bd){ bd=d; bi=i; } }
    ordered.push(unv.splice(bi,1)[0]);
  }
  const noC = state.stops.filter(s=>!(isFinite(s.lat)&&isFinite(s.lng)));
  state.stops = ordered.concat(noC);
  save(); render();
}
function openInGoogleMaps(){
  const parts = state.stops.map(s=>(s.address?.trim()||s.name?.trim()||'').replace(/\s+/g,'+')).filter(Boolean);
  if (parts.length<2){ alert('Add at least two stops with names/addresses.'); return; }
  window.open('https://www.google.com/maps/dir/'+parts.join('/'),'_blank');
}
function saveDefaults(){
  state.defaults.commercialServiceSec = Math.max(0, parseInt(el('#commercialSec').value||'45',10));
  state.defaults.rolloffServiceMin = Math.max(0, parseInt(el('#rolloffMin').value||'7',10));
  state.defaults.dumpServiceMin = Math.max(0, parseInt(el('#dumpMin').value||'10',10));
  state.defaults.startName = el('#startName').value||'Start (Yard)';
  save(); alert('Defaults saved.');
}

function toCSV(rows){
  const header = ['type','name','address','lat','lng','serviceSeconds','notes'];
  const esc = v => (v==null?'':String(v).replace(/"/g,'""'));
  const lines = [header.join(',')].concat(rows.map(r=>header.map(h=>`"${esc(r[h])}"`).join(',')));
  return lines.join('\\n');
}
function downloadTemplate(){
  const rows=[
    {type:'commercial',name:'123 Main St',address:'123 Main St, City, ST',lat:'',lng:'',serviceSeconds:45,notes:'Back gate locked'},
    {type:'rolloff',name:'ACME Plant #2',address:'456 Mill Rd, City, ST',lat:'',lng:'',serviceSeconds:8*60,notes:'Swap 40yd'},
    {type:'dump',name:'Transfer Station',address:'TS Road, City, ST',lat:'',lng:'',serviceSeconds:10*60,notes:'DS after 10th stop'}
  ];
  const blob = new Blob([toCSV(rows)], {type:'text/csv'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='route_template.csv'; a.click();
}
function downloadCSV(){
  const blob = new Blob([toCSV(state.stops)], {type:'text/csv'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='route.csv'; a.click();
}
function parseDelimited(text){
  const delim = (text.indexOf('\\t')>-1 && text.indexOf(',')===-1) ? '\\t' : ',';
  const lines = text.split(/\\r?\\n/).filter(l=>l.trim().length);
  const parseLine=(line)=>{ 
    const out=[]; let cur='', inQ=false;
    for(let i=0;i<line.length;i++){ const ch=line[i];
      if(inQ){ if(ch=='"' && line[i+1]=='"'){ cur+='"'; i++; } else if(ch=='"'){ inQ=false; } else cur+=ch; }
      else {{ if(ch=='"'){ inQ=true; } else if( (delim===',' && ch===',') || (delim==='\\t' && ch==='\\t') ){ out.push(cur); cur=''; } else cur+=ch; }}
    }
    out.push(cur);
    return out;
  };
  let header = parseLine(lines.shift()).map(h=>h.trim().toLowerCase());
  const rows = lines.map(parseLine).map(cells=>{
    const obj={}; header.forEach((h,idx)=>obj[h]=cells[idx]||'');
    const norm = {
      type: (obj.type||'commercial').toLowerCase(),
      name: obj.name||obj.stop||obj.customer||'',
      address: obj.address||obj.location||'',
      lat: obj.lat?parseFloat(obj.lat):null,
      lng: obj.lng?parseFloat(obj.lng):null,
      serviceSeconds: obj.serviceseconds?parseInt(obj.serviceseconds,10):(obj.servicemin?parseInt(obj.servicemin,10)*60:0),
      notes: obj.notes||obj.comment||''
    };
    if (!norm.serviceSeconds){
      if (norm.type==='commercial') norm.serviceSeconds = state.defaults.commercialServiceSec;
      else if (norm.type==='rolloff') norm.serviceSeconds = state.defaults.rolloffServiceMin*60;
      else norm.serviceSeconds = state.defaults.dumpServiceMin*60;
    }
    return norm;
  });
  return rows;
}
function uploadCSV(ev){
  const file = ev.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = () => { 
    try{
      const rows = parseDelimited(reader.result);
      if (!confirm(`Import ${rows.length} stops? This replaces current stops.`)) return;
      state.stops = rows; save(); render();
    }catch(err){ alert('Import error: '+err.message); }
  };
  reader.readAsText(file);
}
function importFromPaste(){
  const text = el('#pasteArea').value.trim();
  if(!text){ alert('Paste rows from Excel or a CSV/TSV first.'); return; }
  try{
    const rows = parseDelimited(text);
    if (!confirm(`Import ${rows.length} stops? This replaces current stops.`)) return;
    state.stops = rows; save(); render();
    el('#pasteArea').value='';
  }catch(err){ alert('Paste import error: '+err.message); }
}
function openPrintSheet(){
  const rows = state.stops;
  const html = `<!doctype html>
  <html><head><meta charset="utf-8"><title>Route Sheet</title>
  <style>
    body{{font-family:Arial, sans-serif; padding:20px}}
    h1{{font-size:20px;margin:0 0 10px}}
    table{{border-collapse:collapse;width:100%}}
    th,td{{border:1px solid #999;padding:6px;font-size:12px}}
    th{{background:#e6f6ff}}
  </style></head>
  <body>
    <h1>Republic Route Sheet</h1>
    <div>Date: ${new Date().toLocaleDateString()} &nbsp; | &nbsp; Total Stops: ${rows.length}</div>
    <table>
      <thead><tr><th>#</th><th>Type</th><th>Name/Address</th><th>Lat</th><th>Lng</th><th>Svc (s)</th><th>Notes</th></tr></thead>
      <tbody>
        ${rows.map((s,i)=>`<tr>
          <td>${i+1}</td>
          <td>${s.type}</td>
          <td>${(s.name||'') + (s.address?(' — '+s.address):'')}</td>
          <td>${s.lat??''}</td>
          <td>${s.lng??''}</td>
          <td>${s.serviceSeconds||0}</td>
          <td>${s.notes||''}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <script>window.print()</script>
  </body></html>`;
  const w = window.open('', '_blank'); w.document.write(html); w.document.close();
}
function getMyLocation(){
  if(!navigator.geolocation){ alert('Geolocation not supported.'); return; }
  navigator.geolocation.getCurrentPosition(pos=>{
    state.startCoords = {lat:pos.coords.latitude, lng:pos.coords.longitude};
    el('#myLoc').textContent = `lat ${state.startCoords.lat.toFixed(5)}, lng ${state.startCoords.lng.toFixed(5)}`;
  }, err=> alert('Location error: '+err.message));
}
if ('serviceWorker' in navigator){ window.addEventListener('load', ()=> navigator.serviceWorker.register('./sw.js') ); }

window.addEventListener('DOMContentLoaded', ()=>{
  el('#add').addEventListener('click', addStopFromForm);
  el('#opt').addEventListener('click', optimizeOrder);
  el('#gmap').addEventListener('click', openInGoogleMaps);
  el('#saveDefaults').addEventListener('click', saveDefaults);
  el('#loc').addEventListener('click', getMyLocation);
  el('#downloadCSV').addEventListener('click', downloadCSV);
  el('#downloadTemplate').addEventListener('click', downloadTemplate);
  el('#uploadCSV').addEventListener('change', uploadCSV);
  el('#importPaste').addEventListener('click', importFromPaste);
  render();
});
