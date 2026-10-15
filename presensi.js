/* Marsela: rekap multi-kegiatan 1 bulan terakhir WIB; presensi publik tetap sekali kirim. */
(() => {
'use strict';
const el = id => document.getElementById(id);
const config = window.MARSeLA_CONFIG || {};
const configured = /^https:\/\/.+\.supabase\.co$/.test(config.supabaseUrl || '') && !!config.supabaseAnonKey && !config.supabaseAnonKey.includes('GANTI');
const clean = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const option = (v,t) => `<option value="${clean(v)}">${clean(t)}</option>`;
const fmt = v => String(v ?? '').trim().toLowerCase();
const dateLabel = v => v ? new Date(v+'T12:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'}) : '';
const eligibility = {'Caberawit':['PAUD','SD / Caberawit'],'Muda-Mudi':['Muda - Mudi'],'Kelompok':['Bapak - Bapak','Ibu - Ibu','Duda','Janda']};
const jakartaToday = () => {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const val = k => parts.find(p=>p.type===k)?.value;
  return `${val('year')}-${val('month')}-${val('day')}`;
};
// Satu bulan kalender mundur dari tanggal hari ini, dengan hari akhir bulan disesuaikan.
function monthAgo(dateISO){
  const [y,m,d]=dateISO.split('-').map(Number);
  const first=new Date(Date.UTC(y,m-2,1));
  const days=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  first.setUTCDate(Math.min(d,days));
  return first.toISOString().slice(0,10);
}
const read = r => {if(r.error) throw r.error;return r.data;};
let db, members=[],events=[],selected=null,presence=new Map(),selectedRecapIds=new Set(),recapPresence=new Map(),rows=[];
const message = txt => {el('presensi-message').textContent=txt;};
const eligibleMembers = event => {
  const allowed=[...(eligibility[event?.jenis_pengajian]||[])];
  if(event?.jenis_pengajian==='Kelompok'&&event?.include_mudamudi)allowed.push('Muda - Mudi');
  return members.filter(m=>allowed.includes(m.kategori));
};
const eventText = e => `${dateLabel(e.event_date)} — [${e.jenis_pengajian}] ${e.title}${e.is_open?' (Dibuka)':' (Ditutup)'}`;
const chosenEvents = () => events.filter(e=>selectedRecapIds.has(String(e.id)));
function tabs(){
  const map={beranda:'beranda-section',sensus:'sensus-section',presensi:'presensi-section',jadwal:'jadwal-section',statistik:'statistik-section'};
  window.showMarselaSection=function(id){
    document.querySelectorAll('#beranda-section,#sensus-section,#presensi-section,#jadwal-section,#statistik-section,#rekap-section,#analisis-section,#riwayat-section,#laporan-section').forEach(s=>s.hidden=s.id!==id);
    document.querySelectorAll('.tab-btn').forEach(b=>{const active=map[b.dataset.tab]===id;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    document.querySelectorAll('.utility-link').forEach(b=>b.classList.toggle('active',b.dataset.section===id));
    const menu=el('utility-menu'),toggle=el('menu-toggle');
    if(menu)menu.hidden=true;if(toggle)toggle.setAttribute('aria-expanded','false');
    window.scrollTo({top:0,behavior:'smooth'});
  };
  document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click',()=>window.showMarselaSection(map[b.dataset.tab]||'beranda-section')));
  const toggle=el('menu-toggle'),menu=el('utility-menu');
  if(toggle&&menu){
    toggle.addEventListener('click',()=>{const open=menu.hidden;menu.hidden=!open;toggle.setAttribute('aria-expanded',String(open));});
    document.querySelectorAll('.utility-link').forEach(b=>b.addEventListener('click',()=>window.showMarselaSection(b.dataset.section)));
    document.addEventListener('click',e=>{if(!menu.hidden&&!menu.contains(e.target)&&!toggle.contains(e.target)){menu.hidden=true;toggle.setAttribute('aria-expanded','false');}});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){menu.hidden=true;toggle.setAttribute('aria-expanded','false');}});
  }
}
function createRecapControls(){
  const container=el('public-category').closest('.form-grid');
  const group=document.createElement('div');group.id='recap-multi-controls';
  group.style.cssText='grid-column:1 / -1;display:grid;gap:10px';
  group.innerHTML=`<label>Jenis pengajian untuk rekap
    <select id="recap-type"><option value="">Semua jenis pengajian</option><option value="Caberawit">Caberawit</option><option value="Muda-Mudi">Muda-Mudi</option><option value="Kelompok">Kelompok</option></select></label>
    <div><div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
    <strong style="font-size:.93rem">Pilih kegiatan (boleh lebih dari satu)</strong>
    <label style="display:flex;align-items:center;gap:6px;font-weight:normal;font-size:.88rem"><input type="checkbox" id="recap-check-all" style="width:auto"> Pilih semua yang ditampilkan</label>
    </div><div id="recap-event-list" style="border:1px solid #cbd5e1;border-radius:12px;padding:12px;max-height:230px;overflow:auto;display:grid;gap:8px"></div>
    <p class="message" id="recap-range" style="margin:8px 0 0"></p></div>`;
  container.insertBefore(group,container.firstChild);
  el('recap-type').addEventListener('change',()=>{
    selectedRecapIds=new Set(visibleRecapEvents().map(e=>String(e.id)));
    renderRecapChecks();refreshRecap().catch(handleError);
  });
  el('recap-check-all').addEventListener('change',ev=>{
    const ids=visibleRecapEvents().map(e=>String(e.id));
    for(const id of ids){if(ev.target.checked)selectedRecapIds.add(id);else selectedRecapIds.delete(id);}
    renderRecapChecks();refreshRecap().catch(handleError);
  });
  el('recap-event-list').addEventListener('change',ev=>{
    const input=ev.target.closest('input[data-event-id]');if(!input)return;
    if(input.checked)selectedRecapIds.add(input.dataset.eventId);else selectedRecapIds.delete(input.dataset.eventId);
    updateCheckAll();refreshRecap().catch(handleError);
  });
}
function visibleRecapEvents(){const type=el('recap-type').value;return events.filter(e=>!type||e.jenis_pengajian===type);}
function updateCheckAll(){
  const visible=visibleRecapEvents(),selected=visible.filter(e=>selectedRecapIds.has(String(e.id))).length;
  const check=el('recap-check-all');check.checked=visible.length>0&&selected===visible.length;check.indeterminate=selected>0&&selected<visible.length;
  check.disabled=visible.length===0;
}
function renderRecapChecks(){
  const shown=visibleRecapEvents();
  el('recap-event-list').innerHTML=shown.length?shown.map(e=>`<label style="display:flex;align-items:flex-start;gap:9px;cursor:pointer;font-size:.9rem;font-weight:normal"><input type="checkbox" data-event-id="${clean(e.id)}" ${selectedRecapIds.has(String(e.id))?'checked':''} style="width:auto;margin-top:3px;flex:none"><span>${clean(eventText(e))}</span></label>`).join(''):'<span>Tidak ada kegiatan dalam periode ini.</span>';
  updateCheckAll();
  el('recap-range').textContent=`Hanya kegiatan ${dateLabel(monthAgo(jakartaToday()))} s.d. ${dateLabel(jakartaToday())} (WIB) ditampilkan. Data lebih lama tetap tersimpan di Supabase.`;
}
async function getPresence(event){
  if(!event)return new Map();
  return new Map(read(await db.from('marsela_attendance').select('member_id,status').eq('event_id',event.id).limit(1000)).map(r=>[Number(r.member_id),r.status]));
}
async function loadPresenceFor(eventsToLoad){
  const result=new Map();
  // Query satu per satu agar tidak terpotong limit default PostgREST per permintaan.
  for(let i=0;i<eventsToLoad.length;i+=8){
    const batch=eventsToLoad.slice(i,i+8);
    const maps=await Promise.all(batch.map(getPresence));
    batch.forEach((event,j)=>result.set(String(event.id),maps[j]));
  }
  return result;
}
async function loadInitial(){
  members=read(await db.from('marsela_members').select('id,nama,kategori,is_active').eq('is_active',true).order('nama').limit(1000));
  const today=jakartaToday();
  events=read(await db.from('marsela_events').select('id,title,event_date,notes,is_open,jenis_pengajian,include_mudamudi').gte('event_date',monthAgo(today)).lte('event_date',today).order('event_date',{ascending:false}).order('id',{ascending:false}).limit(1000));
  const todayEvents=events.filter(e=>e.event_date===today);
  const previousFormSelection=el('public-event').value;
  el('public-event').innerHTML=option('','— Pilih pengajian hari ini —')+todayEvents.map(e=>option(e.id,eventText(e))).join('');
  if(todayEvents.some(e=>String(e.id)===previousFormSelection))el('public-event').value=previousFormSelection;
  selectedRecapIds=new Set(events.map(e=>String(e.id)));
  renderRecapChecks();
  await changeEvent();
}
function setMemberOptions(){
  const before=el('public-member').value,term=fmt(el('member-search').value);
  const filtered=eligibleMembers(selected).filter(m=>fmt(m.nama).includes(term));
  el('public-member').innerHTML=option('','— Pilih nama sendiri —')+filtered.map(m=>option(m.id,`${m.nama} — ${m.kategori||'-'}`)).join('');
  if(filtered.some(m=>String(m.id)===before))el('public-member').value=before;
  showSelected();
}
async function changeEvent(){
  selected=events.find(e=>String(e.id)===el('public-event').value&&e.event_date===jakartaToday())||null;
  presence=await getPresence(selected);
  setMemberOptions();
  await refreshRecap();
}
function showSelected(){
  const id=Number(el('public-member').value),existing=presence.get(id);
  const open=selected?.is_open&&selected.event_date===jakartaToday();
  const allowed=eligibleMembers(selected).some(m=>m.id===id);
  el('submit-attendance').disabled=!selected||!id||!allowed||!!existing||!open;
  el('selected-info').textContent=!selected?'Belum ada jadwal pengajian hari ini.':!id?'Pilih nama Anda terlebih dahulu.':existing?`Nama ini sudah tercatat: ${existing}. Presensi terkunci dan tidak dapat diubah.`:!open?'Kegiatan ini tidak membuka presensi hari ini.':`Siap mengisi untuk ${members.find(m=>m.id===id)?.nama||''}. Pastikan status sudah benar.`;
}
function updateCategoryOptions(){
  const select=el('public-category'),prev=select.value;
  const cats=[...new Set(chosenEvents().flatMap(e=>eligibleMembers(e).map(m=>m.kategori)))].filter(Boolean).sort();
  select.innerHTML=option('','Semua kategori')+cats.map(c=>option(c,c)).join('');
  if(cats.includes(prev))select.value=prev;
}
async function refreshRecap(){
  const chosen=chosenEvents();
  recapPresence=await loadPresenceFor(chosen);
  updateCategoryOptions();renderRoster();
}
function aggregateRows(chosen,presenceMap,category=''){
  const all=[];
  for(const e of chosen){
    const attended=presenceMap.get(String(e.id))||new Map();
    for(const m of eligibleMembers(e)){
      if(category&&m.kategori!==category)continue;
      all.push({nama:m.nama,kategori:m.kategori,event_id:e.id,title:e.title,jenis:e.jenis_pengajian,date:e.event_date,status:attended.get(Number(m.id))||'Belum'});
    }
  }
  return all;
}
function renderRoster(){
  rows=aggregateRows(chosenEvents(),recapPresence,el('public-category').value);
  const count=s=>rows.filter(m=>m.status===s).length;
  const percent=rows.length?(100*count('Hadir')/rows.length).toFixed(1).replace(/\.0$/,''):'0';
  el('public-summary').innerHTML=['Total: '+rows.length,'Hadir: '+count('Hadir'),'Izin: '+count('Izin'),'Sakit: '+count('Sakit'),'Kehadiran: '+percent+'%'].map(s=>`<div class="stat-card">${clean(s)}</div>`).join('');
  el('public-roster').innerHTML=chosenEvents().length?`<table><thead><tr><th>No.</th><th>Nama</th><th>Kategori</th><th>Status</th></tr></thead><tbody>${rows.map((m,i)=>`<tr><td>${i+1}</td><td>${clean(m.nama)}</td><td>${clean(m.kategori)}</td><td>${clean(m.status)}</td></tr>`).join('')}</tbody></table>`:'<p>Centang satu atau beberapa kegiatan untuk melihat rekap.</p>';
}
const q = v => '"'+String(v??'').replace(/"/g,'""')+'"';
function downloadCsv(data,filename){
  const lines=[['Tanggal','Jenis Pengajian','Kegiatan','Nama','Kategori','Status Presensi'],...data.map(m=>[m.date,m.jenis,m.title,m.nama,m.kategori,m.status])];
  const csv='\uFEFF'+lines.map(line=>line.map(q).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportCsv(){
  if(!selectedRecapIds.size){message('Pilih setidaknya satu kegiatan untuk diunduh.');return;}
  downloadCsv(rows,`rekap-kegiatan-terpilih-marsela-${jakartaToday()}.csv`);
}
async function exportAllCsv(){
  if(!events.length){message('Belum ada kegiatan dalam satu bulan terakhir.');return;}
  const button=el('export-all-csv');button.disabled=true;
  try{
    const allPresence=await loadPresenceFor(events);
    downloadCsv(aggregateRows(events,allPresence),`rekap-semua-kegiatan-marsela-${monthAgo(jakartaToday())}-sd-${jakartaToday()}.csv`);
    message(`CSV semua ${events.length} kegiatan dalam satu bulan terakhir berhasil disiapkan.`);
  }catch(err){handleError(err);}finally{button.disabled=false;}
}
function createExportAllButton(){
  const single=el('export-csv');
  single.textContent='Unduh CSV Terpilih';
  const button=document.createElement('button');button.id='export-all-csv';button.type='button';button.className=single.className;button.textContent='Unduh Semua Kegiatan';
  single.insertAdjacentElement('afterend',button);button.addEventListener('click',exportAllCsv);
}
// Dialog konfirmasi hanya dibuat pada saat diperlukan; tidak mengubah struktur tab.
let confirmationPreviousFocus = null;
function closeConfirmation(){
  const dialog=el('marsela-confirmation');
  if(!dialog)return;
  dialog.hidden=true;
  document.body.classList.remove('marsela-modal-open');
  if(confirmationPreviousFocus?.isConnected)confirmationPreviousFocus.focus({preventScroll:true});
}
function showConfirmation({nama,kegiatan,status,tanggal}){
  let dialog=el('marsela-confirmation');
  if(!dialog){
    dialog=document.createElement('div');
    dialog.id='marsela-confirmation';
    dialog.className='marsela-modal';
    dialog.hidden=true;
    dialog.innerHTML=`<div class="marsela-modal-backdrop" data-close-confirmation></div>
      <div class="marsela-confirm-card" role="dialog" aria-modal="true" aria-labelledby="marsela-confirm-title" aria-describedby="marsela-confirm-desc" tabindex="-1">
        <button type="button" class="marsela-confirm-close" data-close-confirmation aria-label="Tutup konfirmasi">×</button>
        <div class="marsela-confirm-icon" aria-hidden="true">✓</div>
        <p class="marsela-confirm-eyebrow">MARSELA DASHBOARD</p>
        <h3 id="marsela-confirm-title">Presensi Berhasil!</h3>
        <p id="marsela-confirm-desc">Presensi telah tersimpan di database.</p>
        <div class="marsela-confirm-details">
          <div><span>Nama anggota</span><strong id="marsela-confirm-name"></strong></div>
          <div><span>Kegiatan</span><strong id="marsela-confirm-event"></strong></div>
          <div><span>Tanggal</span><strong id="marsela-confirm-date"></strong></div>
          <div><span>Status</span><strong id="marsela-confirm-status"></strong></div>
        </div>
        <p class="marsela-confirm-lock">🔒 Presensi sudah terkunci dan tidak dapat diubah.</p>
        <button type="button" class="marsela-confirm-done" data-close-confirmation>Selesai</button>
      </div>`;
    document.body.append(dialog);
    dialog.addEventListener('click',e=>{if(e.target.closest('[data-close-confirmation]'))closeConfirmation();});
    dialog.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();closeConfirmation();}
      if(e.key==='Tab'){
        const focusable=[...dialog.querySelectorAll('button:not(:disabled)')];
        const first=focusable[0],last=focusable[focusable.length-1];
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
      }
    });
  }
  confirmationPreviousFocus=document.activeElement;
  el('marsela-confirm-name').textContent=nama;
  el('marsela-confirm-event').textContent=kegiatan;
  el('marsela-confirm-date').textContent=dateLabel(tanggal);
  el('marsela-confirm-status').textContent=status;
  el('marsela-confirm-status').dataset.status=status;
  dialog.hidden=false;
  document.body.classList.add('marsela-modal-open');
  dialog.querySelector('.marsela-confirm-done').focus({preventScroll:true});
}
async function submit(ev){
  ev.preventDefault();
  const id=Number(el('public-member').value),status=el('public-status').value;
  if(!selected||!id||!eligibleMembers(selected).some(m=>m.id===id)||!['Hadir','Izin','Sakit'].includes(status))return;
  const member=members.find(m=>m.id===id);
  if(!window.confirm(`Kirim presensi ${status} untuk ${member?.nama}? Setelah dikirim TIDAK BISA DIUBAH.`))return;
  const submitted={nama:member.nama,kegiatan:selected.title,status,tanggal:selected.event_date};
  const button=el('submit-attendance');button.disabled=true;
  let saved=false;
  try{
    read(await db.rpc('marsela_submit_attendance',{p_event_id:selected.id,p_member_id:id,p_status:status}));
    saved=true;
    message(`Berhasil! Presensi ${member.nama}: ${status}. Data sudah terkunci.`);
    showConfirmation(submitted);
    try{await changeEvent();}catch(refreshErr){
      console.error('Presensi tersimpan tetapi rekap belum diperbarui:',refreshErr);
      message('Presensi berhasil tersimpan, namun rekap belum termuat ulang. Silakan tekan Muat ulang.');
    }
  }catch(err){
    console.error(err);
    message('Presensi gagal: '+(err.message||String(err))+'. Jika sudah tercatat, tidak dapat diubah lagi.');
    await changeEvent().catch(()=>{});
  }finally{
    if(!saved)button.disabled=false;
    showSelected();
  }
}
function handleError(err){console.error(err);message('Gagal memuat data: '+(err.message||String(err)));}
async function init(){
  tabs();
  createRecapControls();createExportAllButton();
  if(!configured||!window.supabase){el('configuration-warning').hidden=false;el('attendance-form').hidden=true;return;}
  db=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  el('public-event').addEventListener('change',()=>changeEvent().catch(handleError));
  el('member-search').addEventListener('input',setMemberOptions);
  el('public-member').addEventListener('change',showSelected);
  el('public-category').addEventListener('change',renderRoster);
  el('attendance-form').addEventListener('submit',submit);
  el('refresh-attendance').addEventListener('click',()=>loadInitial().then(()=>message('Jadwal dan rekap diperbarui.')).catch(handleError));
  el('export-csv').addEventListener('click',exportCsv);
  await loadInitial();
}
document.addEventListener('DOMContentLoaded',()=>init().catch(handleError));
})();
