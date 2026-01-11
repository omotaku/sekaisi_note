const api = {
  list: () => fetch('/api/notes').then(r=>r.json()),
  create: (n) => fetch('/api/notes', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(n)}).then(r=>r.json()),
  update: (id,n) => fetch('/api/notes/'+id, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(n)}).then(r=>r.json()),
  del: (id) => fetch('/api/notes/'+id, {method:'DELETE'}).then(r=>r.json())
};

const $ = id => document.getElementById(id);
let notes = [];
let current = null;
let filterQuery = '';
let sortMode = 'new';
let saveTimer = null;
let tagFilterSet = new Set();
let dirty = false;
let map = null;
let permLayer = null; // permanent markers and saved geom
let tempLayer = null; // temporary markers/lines while editing
let pickMode = false;
let tempMarker = null;
let approxMode = false;
let approxCircle = null;

function matchesFilter(n, q){
  if(!q) return true;
  q = q.toLowerCase();
  return ((n.title||'').toLowerCase().includes(q)) || ((n.tags||'').toLowerCase().includes(q)) || ((n.century||'').toString().includes(q)) || ((n.year||'').toString().includes(q)) || ((n.content||'').toLowerCase().includes(q));
}

function sortNotes(arr){
  if(sortMode === 'new') return arr.sort((a,b)=> (b.createdAt || 0) > (a.createdAt || 0) ? 1 : -1);
  if(sortMode === 'year_desc') return arr.sort((a,b)=> (parseInt(b.year)||0) - (parseInt(a.year)||0) || (parseInt(b.century)||0) - (parseInt(a.century)||0));
  if(sortMode === 'year_asc') return arr.sort((a,b)=> (parseInt(a.year)||0) - (parseInt(b.year)||0) || (parseInt(a.century)||0) - (parseInt(b.century)||0));
  return arr;
}

function renderList(){
  const ul = $('notesList'); ul.innerHTML = '';
  let list = notes.slice();
  list = list.filter(n => matchesFilter(n, filterQuery));
  // apply tag filters
  if(tagFilterSet.size > 0){
    list = list.filter(n => {
      const tags = (n.tags||'').split(',').map(t=>t.trim()).filter(Boolean);
      for(const t of tags){ if(tagFilterSet.has(t)) return true; }
      return false;
    });
  }
  list = sortNotes(list);
  list.forEach(n=>{
    const li = document.createElement('li');
    li.setAttribute('role','button'); li.tabIndex = 0;
    li.addEventListener('keydown', (ev)=>{ if(ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); loadNote(n.id); } });
    const meta = document.createElement('div'); meta.className = 'meta';
    const yearBadge = document.createElement('div'); yearBadge.className = 'year-badge'; yearBadge.textContent = n.year || (n.century ? (n.century + 'C') : '');
    meta.appendChild(yearBadge);
    const body = document.createElement('div'); body.className = 'body';
    const title = document.createElement('div'); title.className = 'title'; title.textContent = n.title || '無題';
    const excerpt = document.createElement('div'); excerpt.className = 'excerpt'; excerpt.textContent = (n.content||'').replace(/\n/g,' ').slice(0,200);
    const tagsWrap = document.createElement('div'); tagsWrap.className = 'tags';
    (n.tags||'').split(',').map(t=>t.trim()).filter(Boolean).forEach(t=>{ const sp = document.createElement('span'); sp.className = 'tag-chip'; sp.textContent = t; tagsWrap.appendChild(sp); });
    body.appendChild(title); body.appendChild(excerpt); body.appendChild(tagsWrap);
    li.appendChild(meta); li.appendChild(body);
    li.onclick = ()=>loadNote(n.id);
    ul.appendChild(li);
  });
}

function buildTagChips(){
  const container = $('tagContainer'); if(!container) return;
  container.innerHTML = '';
  const all = new Set();
  notes.forEach(n => (n.tags||'').split(',').map(t=>t.trim()).filter(Boolean).forEach(t=>all.add(t)));
  Array.from(all).sort().forEach(tag => {
    const btn = document.createElement('button'); btn.className='tag-chip'; btn.textContent = tag; btn.setAttribute('aria-pressed', tagFilterSet.has(tag) ? 'true' : 'false');
    if(tagFilterSet.has(tag)) btn.classList.add('active');
    btn.onclick = ()=>{ if(tagFilterSet.has(tag)) tagFilterSet.delete(tag); else tagFilterSet.add(tag); buildTagChips(); renderList(); };
    container.appendChild(btn);
  });
}

function loadNote(id){
  current = notes.find(n=>n.id===id);
  if(!current) return;
  $('century').value = current.century||'';
  $('year').value = current.year||'';
  $('lat').value = current.lat||'';
  $('lng').value = current.lng||'';
  $('title').value = current.title||'';
  $('tags').value = current.tags||'';
  $('content').value = current.content||'';
  renderPreview();
  // pan map to note location if available
  if(map && current.lat && current.lng){
    try{ map.setView([parseFloat(current.lat), parseFloat(current.lng)], 6); }
    catch(e){}
  }
  // load geom into drawPoints and show temporary line
  drawPoints = [];
  // show saved geometry (temporary overlay) if present
  if(current.geom && Array.isArray(current.geom)){
    try{ const existing = L.polyline(current.geom, {color:'#de4838'}).addTo(tempLayer); }
    catch(e){}
  }
}

async function refresh(){
  try{ notes = await api.list(); renderList(); }
  catch(e){ console.error('fetch error', e); }
}

function ensureMap(){
  if(window.L && !map){
    try{
      map = L.map('map', { scrollWheelZoom: true }).setView([20,0], 2);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
      permLayer = L.layerGroup().addTo(map);
      tempLayer = L.layerGroup().addTo(map);
      map.on('click', (e)=>{
        const {lat,lng} = e.latlng;
        if(pickMode){
          if(tempMarker) tempLayer.removeLayer(tempMarker);
          tempMarker = L.marker([lat,lng]).addTo(tempLayer);
          $('lat').value = lat.toFixed(6);
          $('lng').value = lng.toFixed(6);
          // turn off pick mode
          pickMode = false; $('pickOnMap').setAttribute('aria-pressed','false'); $('pickOnMap').classList.remove('active');
          return;
        }
        if(approxMode){
          // approximate selection: round to 0.1 degree and show circle
          const latA = Math.round(lat*10)/10;
          const lngA = Math.round(lng*10)/10;
          $('lat').value = latA.toFixed(1);
          $('lng').value = lngA.toFixed(1);
          if(approxCircle) tempLayer.removeLayer(approxCircle);
          approxCircle = L.circle([lat, lng], { radius: 50000, color:'#f59e0b', fillOpacity:0.12 }).addTo(tempLayer);
          // keep approx mode on until toggled off
          return;
        }
        // drawing mode removed
        // (drawing was removed per request; saved geometries still display)
      });
    } catch(e){ console.error('map init failed', e); }
  }
}

function refreshMarkers(){
  if(!map) return;
  permLayer.clearLayers();
  notes.forEach(n => {
    if(n.lat && n.lng){
      const m = L.marker([parseFloat(n.lat), parseFloat(n.lng)]);
      m.on('click', ()=> loadNote(n.id));
      m.addTo(permLayer);
    }
    // draw saved geometry (array of [lat,lng]) if present
    if(n.geom && Array.isArray(n.geom) && n.geom.length>0){
      try{ const line = L.polyline(n.geom, {color:'#2b6cb0', weight:3, opacity:0.9}); line.on('click', ()=> loadNote(n.id)); line.addTo(permLayer); }
      catch(e){ /* ignore malformed geom */ }
    }
  });
}

async function save(){
  const payload = {
    century: $('century').value,
    year: $('year').value,
    lat: $('lat').value,
    lng: $('lng').value,
    title: $('title').value,
    tags: $('tags').value,
    content: $('content').value,
    geom: drawPoints.slice()
  };
  // validation: century/year should be numeric or empty
  if(payload.century && isNaN(Number(payload.century))) return alert('世紀は数値で入力してください（例: 19）');
  if(payload.year && isNaN(Number(payload.year))) return alert('年は数値で入力してください（例: 1789）');
  if(payload.lat && isNaN(Number(payload.lat))) return alert('緯度は数値で入力してください');
  if(payload.lng && isNaN(Number(payload.lng))) return alert('経度は数値で入力してください');
  if(current && current.id){
    const updated = await api.update(current.id, payload);
    current = updated;
  } else {
    const created = await api.create(payload);
    current = created;
  }
  await refresh();
  dirty = false;
}

// --- AI / Geocoding helpers

// --- AI helpers: 情報提供と要約
async function provideInfoFromText(text){
  if(!text) return alert('本文を入力してください');
  const container = $('aiResults'); if(!container) return;
  container.textContent = '情報を取得中...';
  // extract candidate keywords (simple heuristic)
  const cleaned = text.replace(/[\p{P}\p{S}]/gu, ' ').toLowerCase();
  const words = cleaned.split(/\s+/).filter(Boolean).map(w=>w.trim());
  const freq = {};
  words.forEach(w=>{ if(w.length<=1) return; freq[w]=(freq[w]||0)+1; });
  const candidates = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,6).map(x=>x[0]);
  const top = candidates.slice(0,3);
  if(top.length===0){ container.textContent = '候補が見つかりませんでした'; setTimeout(()=>{ container.textContent=''; }, 4000); return; }
  const results = [];
  for(const k of top){
    try{
      // search Wikipedia for the keyword (allow CORS via origin=*)
      const sUrl = 'https://ja.wikipedia.org/w/api.php?origin=*&action=query&format=json&list=search&srsearch=' + encodeURIComponent(k);
      const sResp = await fetch(sUrl);
      if(!sResp.ok) continue;
      const sJson = await sResp.json();
      if(!sJson.query || !sJson.query.search || sJson.query.search.length===0) continue;
      const title = sJson.query.search[0].title;
      const summaryUrl = 'https://ja.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title);
      const sumResp = await fetch(summaryUrl);
      if(!sumResp.ok) continue;
      const sumJson = await sumResp.json();
      if(sumJson.extract){ results.push({ title, extract: sumJson.extract }); }
    } catch(e){ console.error('wiki fetch err', e); }
  }
  if(results.length===0){ container.textContent = '外部情報が見つかりませんでした'; setTimeout(()=>{ container.textContent=''; }, 4000); return; }
  // render brief list
  container.innerHTML = '';
  results.forEach(r=>{ const d = document.createElement('div'); d.style.marginBottom='8px'; const t = document.createElement('strong'); t.textContent = r.title; const p = document.createElement('div'); p.textContent = r.extract; d.appendChild(t); d.appendChild(p); container.appendChild(d); });
  setTimeout(()=>{ container.textContent=''; }, 20000);
}

function summarizeText(text){
  if(!text) return '';
  // simple heuristic: split by Japanese period or newline, fallback to first 200 chars
  const parts = text.split(/。|\n|\.|\?|！|!/).map(s=>s.trim()).filter(Boolean);
  if(parts.length===0) return text.slice(0,200);
  return parts.slice(0,2).join('。') + (parts.length>2 ? '…' : '');
}

async function del(){
  if(!current || !current.id) return alert('削除するノートを選んでください');
  if(!confirm('本当に削除しますか？')) return;
  await api.del(current.id);
  current = null; $('title').value=''; $('tags').value=''; $('content').value=''; $('century').value=''; $('year').value='';
  await refresh();
}

function newNote(){ current = null; $('century').value=''; $('year').value=''; $('title').value=''; $('tags').value=''; $('content').value=''; renderPreview(); }

function exportNotes(){
  const a = document.createElement('a');
  const blob = new Blob([JSON.stringify(notes, null, 2)], {type:'application/json'});
  a.href = URL.createObjectURL(blob);
  a.download = 'jugyonote_export.json';
  a.click();
}

function exportCSV(){
  const rows = [['id','century','year','title','tags','content','createdAt']];
  notes.forEach(n => rows.push([n.id || '', n.century||'', n.year||'', (n.title||'').replace(/"/g,'""'), n.tags||'', (n.content||'').replace(/"/g,'""'), n.createdAt||'']));
  const csv = rows.map(r => r.map(c => '"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'})); a.download='jugyonote_export.csv'; a.click();
}

function backupToLocal(){
  try{ localStorage.setItem('jugyonote_backup', JSON.stringify(notes)); alert('ローカルにバックアップしました'); }
  catch(e){ console.error(e); alert('バックアップに失敗しました'); }
}

function restoreFromLocal(){
  try{ const raw = localStorage.getItem('jugyonote_backup'); if(!raw) return alert('バックアップが見つかりません'); const arr = JSON.parse(raw); // push to server
    Promise.all(arr.map(n => api.create(n))).then(()=>{ alert('ローカルバックアップをインポートしました'); refresh(); }).catch(e=>{ console.error(e); alert('インポート中にエラー'); });
  } catch(e){ console.error(e); alert('復元に失敗しました'); }
}

function importFromFile(file){
  const reader = new FileReader();
  reader.onload = (e)=>{
    try{ const arr = JSON.parse(e.target.result); if(!Array.isArray(arr)) return alert('JSONは配列である必要があります');
      Promise.all(arr.map(n => api.create(n))).then(()=>{ alert('インポート完了'); refresh(); }).catch(err=>{ console.error(err); alert('インポート中にエラー'); });
    } catch(e){ alert('ファイルの読み込みに失敗しました'); }
  };
  reader.readAsText(file);
}

// debounced autosave: save 1.5s after typing stops
function renderPreview(){
  const p = $('preview');
  if(!p) return;
  const text = $('content').value || '';
  if(p.hidden) return;
  if(window.marked) { p.innerHTML = marked.parse(text); }
  else { p.innerHTML = text.replace(/\n/g, '<br>'); }
}

function onContentInput(){
  renderPreview();
  if(saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>{ if(($('content').value||'').trim() || ($('title').value||'').trim()) save(); }, 1500);
  dirty = true;
}

function onKeyDown(e){
  if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's'){
    e.preventDefault(); save();
  }
  if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n'){
    e.preventDefault(); newNote();
  }
}

document.addEventListener('DOMContentLoaded', ()=>{
  $('saveBtn').onclick = save;
  $('newBtn').onclick = newNote;
  $('deleteBtn').onclick = del;
  $('exportBtn').onclick = exportNotes;
  $('printBtn').onclick = printCurrentNote;
  $('csvBtn').onclick = exportCSV;
  $('importBtn').onclick = ()=>$('fileInput').click();
  $('fileInput').addEventListener('change', (e)=>{ if(e.target.files && e.target.files[0]) importFromFile(e.target.files[0]); });
  $('backupRestoreBtn').onclick = restoreFromLocal;
  // auto backup every 60s
  setInterval(()=>{ backupToLocal(); }, 60000);
  $('togglePreview').onclick = ()=>{ const p = $('preview'); p.hidden = !p.hidden; renderPreview(); };
  const searchEl = $('search'); if(searchEl) searchEl.addEventListener('input', (e)=>{ filterQuery = e.target.value; renderList(); });
  const sortEl = $('sortSelect'); if(sortEl) sortEl.addEventListener('change', (e)=>{ sortMode = e.target.value; renderList(); });
  const contentEl = $('content'); if(contentEl) contentEl.addEventListener('input', onContentInput);
  const pickBtn = $('pickOnMap');
  const drawBtn = $('drawBtn');
  const clearDrawBtn = $('clearDrawBtn');
  const approxBtn = $('approxPickBtn');
  if(pickBtn) pickBtn.addEventListener('click', ()=>{
    // exclusive modes
    pickMode = !pickMode;
    if(pickMode){ drawMode = false; approxMode = false; if(drawBtn) drawBtn.classList.remove('active'); if(approxBtn) approxBtn.classList.remove('active'); if(approxCircle){ tempLayer.removeLayer(approxCircle); approxCircle=null; } }
    pickBtn.setAttribute('aria-pressed', pickMode ? 'true' : 'false'); pickBtn.classList.toggle('active'); if(pickMode) ensureMap();
  });
  if(drawBtn) drawBtn.addEventListener('click', ()=>{
    drawMode = !drawMode;
    if(drawMode){ pickMode = false; approxMode = false; if(pickBtn) { pickBtn.setAttribute('aria-pressed','false'); pickBtn.classList.remove('active'); } if(approxBtn) { approxBtn.setAttribute('aria-pressed','false'); approxBtn.classList.remove('active'); if(approxCircle){ tempLayer.removeLayer(approxCircle); approxCircle=null; } }
      ensureMap(); drawPoints = []; if(drawLine) { tempLayer.removeLayer(drawLine); drawLine = null; }
    }
    drawBtn.classList.toggle('active');
  });
  if(clearDrawBtn) clearDrawBtn.addEventListener('click', ()=>{ drawPoints = []; if(drawLine) { tempLayer.removeLayer(drawLine); drawLine = null; } });
  if(approxBtn) approxBtn.addEventListener('click', ()=>{
    approxMode = !approxMode;
    if(approxMode){ pickMode = false; drawMode = false; if(pickBtn) { pickBtn.setAttribute('aria-pressed','false'); pickBtn.classList.remove('active'); } if(drawBtn) drawBtn.classList.remove('active'); }
    approxBtn.classList.toggle('active'); approxBtn.setAttribute('aria-pressed', approxMode ? 'true' : 'false'); if(approxMode) ensureMap(); else { if(approxCircle){ tempLayer.removeLayer(approxCircle); approxCircle=null; } }
  });
  // AI buttons: 情報提供と要約
  const provideInfoBtn = $('provideInfoBtn'); if(provideInfoBtn) provideInfoBtn.addEventListener('click', async ()=>{ const txt = $('content').value || $('title').value || ''; await provideInfoFromText(txt); });
  const summarizeBtn = $('summarizeBtn'); if(summarizeBtn) summarizeBtn.addEventListener('click', ()=>{ const txt = $('content').value || ''; const s = summarizeText(txt); if(!s) return alert('要約できませんでした'); $('aiResults').textContent = '要約: '+s; setTimeout(()=>{$('aiResults').textContent='';}, 8000); });
  document.addEventListener('keydown', onKeyDown);
  renderPreview();
  refresh();
  window.addEventListener('beforeunload', (e)=>{ if(dirty){ e.preventDefault(); e.returnValue = ''; } });
  // rebuild tags after refresh
  setInterval(()=>{ buildTagChips(); }, 1200);
  // init map after DOM ready
  ensureMap();
  // refresh markers periodically
  setInterval(()=>{ refreshMarkers(); }, 1200);
});

function printCurrentNote(){
  if(!current){ alert('印刷するノートを選択してください'); return; }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${(current.title||'無題')}</title><style>
    body{font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial; padding:24px; color:#0f172a}
    h1{font-size:24px}
    .meta{color:#475569;margin-bottom:8px}
    .tags{color:#1e3a8a;font-weight:600;margin-top:12px}
    pre{white-space:pre-wrap;font-family:inherit}
    @media print{ body{margin:0;} }
  </style></head><body>
    <h1>${escapeHtml(current.title||'無題')}</h1>
    <div class="meta">${current.century?('世紀: '+escapeHtml(current.century)):''} ${current.year?(' 年: '+escapeHtml(current.year)):''}</div>
    <div class="tags">${escapeHtml(current.tags||'')}</div>
    <hr>
    <pre>${escapeHtml(current.content||'')}</pre>
  </body></html>`;
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(()=>{ w.print(); }, 300);
}

function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
