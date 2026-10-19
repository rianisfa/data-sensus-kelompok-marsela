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
let qrValidation='none',qrValidatedEventId=null;
const message = txt => {el('presensi-message').textContent=txt;};
const qrFunctionUrl = () => `${String(config.supabaseUrl||'').replace(/\/$/,'')}/functions/v1/marsela-qr`;
async function callQrFunction(payload){
  const response=await fetch(qrFunctionUrl(),{method:'POST',headers:{'Content-Type':'application/json','apikey':config.supabaseAnonKey,'Authorization':`Bearer ${config.supabaseAnonKey}`},body:JSON.stringify(payload)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.error)throw new Error(data.error||`Permintaan QR gagal (${response.status}).`);
  return data;
}
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
    if(window.marselaAdminGuard&&!window.marselaAdminGuard(id))return;
    document.querySelectorAll('#beranda-section,#sensus-section,#presensi-section,#jadwal-section,#statistik-section,#rekap-section,#analisis-section,#riwayat-section,#laporan-section').forEach(s=>s.hidden=s.id!==id);
    document.querySelectorAll('.tab-btn').forEach(b=>{const active=map[b.dataset.tab]===id;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    document.querySelectorAll('.utility-link').forEach(b=>b.classList.toggle('active',b.dataset.section===id&&(b.dataset.action!=='historical'||attendanceMode()==='manual')));
    const menu=el('utility-menu'),toggle=el('menu-toggle');
    if(menu)menu.hidden=true;if(toggle)toggle.setAttribute('aria-expanded','false');
    window.scrollTo({top:0,behavior:'smooth'});
  };
  document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click',()=>{
    // Tab Presensi utama selalu kembali ke mode anggota biasa.
    if(b.dataset.tab==='presensi'&&!new URLSearchParams(window.location.search).has('presensiToken')){
      const selector=el('attendance-mode');
      if(selector&&selector.value!=='self'){
        selector.value='self';
        updateAttendanceMode();
        updateEventOptions();
        changeEvent().catch(handleError);
      }
    }
    window.showMarselaSection(map[b.dataset.tab]||'beranda-section');
  }));
  const toggle=el('menu-toggle'),menu=el('utility-menu');
  if(toggle&&menu){
    toggle.addEventListener('click',()=>{const open=menu.hidden;menu.hidden=!open;toggle.setAttribute('aria-expanded',String(open));});
    document.querySelectorAll('.utility-link').forEach(b=>b.addEventListener('click',()=>{
      if(b.dataset.action==='historical'){
        if(!window.marselaIsAdmin?.())return;
        const selector=el('attendance-mode');
        if(selector){
          selector.value='manual';
          updateAttendanceMode();
          updateEventOptions();
          changeEvent().catch(handleError);
        }
        window.showMarselaSection('presensi-section');
      }else{
        window.showMarselaSection(b.dataset.section);
      }
    }));
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
  updateEventOptions();
  selectedRecapIds=new Set(events.map(e=>String(e.id)));
  renderRecapChecks();
  await changeEvent();
}
function closeMemberSuggestions(){
  el('member-suggestions').hidden=true;
  el('member-search').setAttribute('aria-expanded','false');
}
function setMemberOptions(){
  const id=Number(el('public-member').value);
  const chosen=eligibleMembers(selected).find(m=>m.id===id);
  el('member-search').value=chosen?chosen.nama:'';
  closeMemberSuggestions();
  showSelected();
}
function searchMemberOptions(){
  // Teks yang diubah bukan pilihan sah sampai pengguna mengklik salah satu hasil.
  el('public-member').value='';
  const term=fmt(el('member-search').value);
  const filtered=eligibleMembers(selected).filter(m=>fmt(m.nama).includes(term)).slice(0,100);
  const box=el('member-suggestions');
  box.innerHTML=filtered.length?filtered.map(m=>`<button type="button" role="option" data-member-id="${m.id}" style="display:block;width:100%;padding:11px 12px;text-align:left;background:white;color:#183047;border:0;border-bottom:1px solid #edf2f7;cursor:pointer">${clean(m.nama)} <small>— ${clean(m.kategori||'-')}</small>${presence.has(m.id)?' <small>(Sudah tercatat)</small>':''}</button>`).join(''):'<div style="padding:12px">Nama tidak ditemukan.</div>';
  box.hidden=false;
  el('member-search').setAttribute('aria-expanded','true');
  showSelected();
}

function updateEventOptions(){
  const select=el('public-event');
  if(!select)return;
  const previous=select.value;
  const today=jakartaToday();
  const list=attendanceMode()==='manual' ? events.filter(e=>e.event_date<=today) : events.filter(e=>e.event_date===today);
  select.innerHTML=option('','— Pilih kegiatan —')+list.map(e=>option(e.id,eventText(e))).join('');
  if(list.some(e=>String(e.id)===previous))select.value=previous;
}
async function changeEvent(){
  historicalSelected.clear();
  selected=events.find(e=>String(e.id)===el('public-event').value && (attendanceMode()==='manual' ? e.event_date<=jakartaToday() : e.event_date===jakartaToday()))||null;
  presence=await getPresence(selected);
  setMemberOptions();
  renderHistoricalList();
  await refreshRecap();
}
function attendanceMode(){
  return new URLSearchParams(window.location.search).has('presensiToken') ? 'qr' : (el('attendance-mode')?.value || 'self');
}
function updateAttendanceMode(){
  const mode=attendanceMode();
  const selector=el('attendance-mode');
  if(selector?.value==='manual'&&!window.marselaIsAdmin?.())selector.value='self';
  const wrap=el('manual-admin-pin-wrap');
  const pin=el('manual-admin-pin');
  if(selector){
    selector.disabled=mode==='qr';
    const label=selector.closest('label');
    // Pilihan mode tidak ditampilkan kepada anggota; mode historis hanya dibuka dari Menu Pengurus.
    if(label)label.hidden=mode!=='manual';
  }
  if(wrap)wrap.hidden=true; // PIN hanya diminta saat menyimpan historis
  const bulk=el('historical-bulk');
  if(bulk){bulk.hidden=mode!=='manual';bulk.style.display=mode==='manual'?'block':'none';}
  const picker=el('member-picker-wrap');if(picker)picker.hidden=mode==='manual';
  const statusField=el('public-status')?.closest('label');if(statusField)statusField.hidden=mode==='manual';
  if(mode==='manual')closeMemberSuggestions();
  const single=el('submit-attendance');if(single)single.hidden=mode==='manual';
  renderHistoricalList();
  if(pin){pin.required=false;pin.value='';}
  showSelected();
}
function showSelected(){
  const id=Number(el('public-member').value),existing=presence.get(id);
  const mode=attendanceMode();
  const today=jakartaToday();
  const open=mode==='manual' ? !!selected && (selected.event_date<today || (selected.event_date===today && selected.is_open)) : !!selected?.is_open&&selected.event_date===today;
  const allowed=eligibleMembers(selected).some(m=>m.id===id);
  const pinReady=mode!=='manual'||!!el('manual-admin-pin')?.value.trim();
  const qrReady=mode!=='qr'||(qrValidation==='valid'&&String(selected?.id)===String(qrValidatedEventId));
  el('submit-attendance').disabled=!selected||!id||!allowed||!!existing||!open||!pinReady||!qrReady;
  el('selected-info').textContent=mode==='qr'&&qrValidation==='invalid'?'QR tidak valid atau sudah kedaluwarsa. Minta QR baru kepada pengurus.':!selected?'Pilih kegiatan terlebih dahulu.':!id?'Pilih anggota terlebih dahulu.':existing?`Nama ini sudah tercatat: ${existing}. Presensi terkunci dan tidak dapat diubah.`:!open?(mode==='manual'?'Kegiatan belum berlangsung atau tidak memenuhi syarat input historis.':'Kegiatan ini tidak membuka presensi hari ini.'):mode==='qr'&&!qrReady?'Memvalidasi tautan QR…':mode==='manual'&&selected.event_date<today?`Input historis untuk ${dateLabel(selected.event_date)}. Pastikan cocok dengan buku presensi.`:`Siap mengisi untuk ${members.find(m=>m.id===id)?.nama||''}. Pastikan status sudah benar.`;
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
  const mode=attendanceMode();
  const today=jakartaToday();
  const dateAllowed=mode==='manual' ? (selected.event_date<today || (selected.event_date===today && selected.is_open)) : (selected.is_open&&selected.event_date===today);
  if(!dateAllowed){message(mode==='manual'?'Kegiatan historis harus bertanggal hari ini atau sebelumnya. Kegiatan hari ini harus masih dibuka.':'Presensi hanya tersedia untuk kegiatan hari ini yang masih dibuka.');return;}
  if(presence.has(id)){message('Nama ini sudah tercatat dan presensi tidak dapat diubah.');return;}
  if(mode==='qr'&&(qrValidation!=='valid'||String(selected.id)!==String(qrValidatedEventId))){message('QR belum valid. Minta QR baru kepada pengurus.');return;}
  const adminPin=mode==='manual'?(el('manual-admin-pin')?.value.trim()||''):'';
  if(mode==='manual'&&!adminPin){message('Masukkan kunci pengurus untuk presensi manual.');return;}
  const member=members.find(m=>m.id===id);
  if(!member)return;
  if(!window.confirm(`Kirim presensi ${status} untuk ${member.nama}? Setelah dikirim TIDAK BISA DIUBAH.`))return;
  const submitted={nama:member.nama,kegiatan:selected.title,status,tanggal:selected.event_date};
  const button=el('submit-attendance');button.disabled=true;
  let saved=false;
  try{
    if(mode==='qr'){
      const token=new URLSearchParams(window.location.search).get('presensiToken');
      await callQrFunction({action:'submit',token,memberId:id,status});
    }else if(mode==='manual'){
      await callQrFunction({action:'submit_manual',adminPin,eventId:selected.id,memberId:id,status});
    }else{
      await callQrFunction({action:'submit_self',eventId:selected.id,memberId:id,status});
    }
    saved=true;
    if(mode==='manual'&&el('manual-admin-pin'))el('manual-admin-pin').value='';
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

// Checklist historis: hanya submit_manual yang sudah ada di Edge Function.
// Setiap kiriman tersimpan satu per satu, bukan transaksi batch atomik.
const historicalSelected = new Map();
let historicalBusy=false;
function renderHistoricalList(){
  const list=el('historical-list'),box=el('historical-bulk');
  if(!list||!box)return;
  if(attendanceMode()!=='manual')return;
  const term=fmt(el('historical-search')?.value||'');
  const allowed=selected?eligibleMembers(selected):[];
  const valid=new Set(allowed.map(m=>m.id));
  for(const id of historicalSelected.keys())if(!valid.has(id)||presence.has(id))historicalSelected.delete(id);
  const visible=allowed.filter(m=>fmt(m.nama).includes(term));
  list.innerHTML=visible.length?visible.map(m=>{
    const existing=presence.get(m.id),checked=historicalSelected.has(m.id);
    const status=historicalSelected.get(m.id)||'Hadir';
    return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:8px;border-bottom:1px solid #e2e8f0">
      <label style="display:flex;align-items:center;gap:8px;flex:1;min-width:190px;font-weight:normal;margin:0">
      <input type="checkbox" data-historical-id="${m.id}" style="width:auto;flex:none" ${checked?'checked':''} ${existing||historicalBusy?'disabled':''}>
      <span>${clean(m.nama)} <small>(${clean(m.kategori||'-')})</small>${existing?` — Tercatat: ${clean(existing)}`:''}</span></label>
      ${!existing?`<select data-historical-status="${m.id}" aria-label="Status ${clean(m.nama)}" ${historicalBusy?'disabled':''} style="width:auto;min-width:105px"><option ${status==='Hadir'?'selected':''}>Hadir</option><option ${status==='Izin'?'selected':''}>Izin</option><option ${status==='Sakit'?'selected':''}>Sakit</option></select>`:''}
    </div>`;
  }).join(''):'<p class="message">Tidak ada anggota yang cocok.</p>';
  el('historical-count').textContent=`${historicalSelected.size} anggota dipilih`;
  const today=jakartaToday();
  const allowedDate=selected&&(selected.event_date<today||(selected.event_date===today&&selected.is_open));
  el('historical-submit').disabled=historicalBusy||!historicalSelected.size||!allowedDate;
  el('historical-check-visible').disabled=historicalBusy;
  el('historical-clear').disabled=historicalBusy;
}
function askHistoricalPin(count, label){
  return new Promise(resolve=>{
    const previous=document.activeElement;
    const modal=document.createElement('div');
    modal.style.cssText='position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(10,28,45,.68)';
    modal.innerHTML=`<div role="dialog" aria-modal="true" aria-labelledby="hist-pin-title" style="width:min(100%,440px);background:white;border-radius:18px;padding:26px;color:#183047;box-shadow:0 20px 70px #0004"><h3 id="hist-pin-title">Konfirmasi Presensi Historis</h3><p id="hist-pin-desc"></p><form id="hist-pin-form"><label for="hist-pin-input" style="display:block;margin:12px 0 6px">Kunci pengurus</label><input id="hist-pin-input" type="password" required autocomplete="off" placeholder="Masukkan kunci pengurus" style="box-sizing:border-box;width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px"><div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px"><button type="button" id="hist-pin-cancel" style="padding:10px 16px;border-radius:9px;border:1px solid #cbd5e1;background:white;color:#183047">Batal</button><button type="submit" style="padding:10px 16px;border-radius:9px;border:0;background:#16846e;color:white;font-weight:bold">Konfirmasi & Simpan</button></div></form></div>`;
    modal.querySelector('#hist-pin-desc').textContent=`Simpan ${count} presensi untuk ${label}? Data yang tersimpan tidak dapat diubah.`;
    document.body.append(modal);
    const input=modal.querySelector('#hist-pin-input');
    const finish=value=>{input.value='';modal.remove();if(previous?.isConnected)previous.focus({preventScroll:true});resolve(value);};
    modal.querySelector('#hist-pin-cancel').addEventListener('click',()=>finish(null));
    modal.addEventListener('click',e=>{if(e.target===modal)finish(null);});
    modal.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();finish(null);}if(e.key==='Tab'){const buttons=[input,modal.querySelector('#hist-pin-cancel'),modal.querySelector('button[type="submit"]')];if(e.shiftKey&&document.activeElement===buttons[0]){e.preventDefault();buttons[2].focus();}else if(!e.shiftKey&&document.activeElement===buttons[2]){e.preventDefault();buttons[0].focus();}}});
    modal.querySelector('#hist-pin-form').addEventListener('submit',e=>{e.preventDefault();if(input.value.trim())finish(input.value.trim());});
    input.focus();
  });
}
function showHistoricalNotice(success,errors,label){
  const modal=document.createElement('div');
  modal.style.cssText='position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(10,28,45,.68)';
  modal.innerHTML=`<div class="marsela-confirm-card" role="dialog" aria-modal="true" aria-labelledby="hist-notice-title" style="width:min(100%,470px);max-height:90vh;overflow:auto;background:white;border-radius:18px;padding:26px;color:#183047;text-align:center;box-shadow:0 20px 70px #0004"><div class="marsela-confirm-icon" aria-hidden="true"></div><p class="marsela-confirm-eyebrow">MARSELA DASHBOARD</p><h3 id="hist-notice-title"></h3><p id="hist-notice-label"></p><div class="marsela-confirm-details" style="text-align:left"><div><span>Berhasil disimpan</span><strong id="hist-notice-ok"></strong></div><div><span>Gagal / dilewati</span><strong id="hist-notice-fail"></strong></div></div><p class="marsela-confirm-lock" id="hist-notice-lock"></p><details id="hist-notice-errors" style="text-align:left;margin:12px 0"><summary>Lihat rincian kegagalan</summary><p id="hist-notice-error-text" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:160px;overflow:auto;font-size:.85rem"></p></details><button type="button" class="marsela-confirm-done" id="hist-notice-close">Selesai</button></div>`;
  modal.querySelector('.marsela-confirm-icon').textContent=success?'✓':'!';
  modal.querySelector('#hist-notice-title').textContent=success?(errors.length?'Presensi Sebagian Berhasil':'Presensi Berhasil!'):'Presensi Gagal';
  modal.querySelector('#hist-notice-label').textContent=label;
  modal.querySelector('#hist-notice-ok').textContent=`${success} anggota`;
  modal.querySelector('#hist-notice-fail').textContent=`${errors.length} anggota`;
  modal.querySelector('#hist-notice-lock').textContent=success?'Presensi yang berhasil tersimpan sudah terkunci dan tidak dapat diubah.':'Tidak ada presensi baru yang berhasil disimpan.';
  modal.querySelector('#hist-notice-errors').hidden=!errors.length;
  modal.querySelector('#hist-notice-error-text').textContent=errors.join('\n');
  document.body.append(modal);
  const close=()=>modal.remove();
  modal.querySelector('#hist-notice-close').addEventListener('click',close);
  modal.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
  modal.querySelector('#hist-notice-close').focus();
}
async function submitHistorical(){
  if(historicalBusy||attendanceMode()!=='manual'||!selected)return;
  const today=jakartaToday();
  if(!(selected.event_date<today||(selected.event_date===today&&selected.is_open)))return;
  const permitted=new Set(eligibleMembers(selected).map(m=>m.id));
  const pending=[...historicalSelected].filter(([id,status])=>permitted.has(id)&&!presence.has(id)&&['Hadir','Izin','Sakit'].includes(status));
  if(!pending.length)return;
  const event=selected,label=`${event.title} (${dateLabel(event.event_date)})`;
  const pin=await askHistoricalPin(pending.length,label);
  if(!pin||selected?.id!==event.id||attendanceMode()!=='manual')return;
  historicalBusy=true;renderHistoricalList();
  const result=el('historical-result');
  let success=0;const errors=[];
  try{
    presence=await getPresence(event);
    for(const [id,status] of pending){
      if(presence.has(id)){historicalSelected.delete(id);errors.push(`${members.find(m=>m.id===id)?.nama||id}: sudah tercatat`);continue;}
      try{
        await callQrFunction({action:'submit_manual',adminPin:pin,eventId:event.id,memberId:id,status});
        presence.set(id,status);historicalSelected.delete(id);success++;
      }catch(error){
        const reason=error.message||'gagal';
        errors.push(`${members.find(m=>m.id===id)?.nama||id}: ${reason}`);
        if(/kunci pengurus salah|kunci pengurus server belum|hanya tersedia untuk kegiatan yang dibuka hari ini|input manual hanya diizinkan|konfigurasi server/i.test(reason))break;
      }
      result.textContent=`Sedang menyimpan… ${success} berhasil; ${errors.length} gagal/dilewati.`;
    }
    result.textContent=`Selesai: ${success} berhasil; ${errors.length} gagal/dilewati.`;
    if(success)await refreshRecap();
    showHistoricalNotice(success,errors,label);
  }catch(error){
    result.textContent=`Proses terhenti: ${error.message||error}. Periksa hasil sebelum mengulang.`;
    showHistoricalNotice(success,[...errors,`Proses terhenti: ${error.message||error}`],label);
  }finally{historicalBusy=false;renderHistoricalList();showSelected();}
}

function bindHistorical(){
  el('historical-search')?.addEventListener('input',renderHistoricalList);
  el('historical-list')?.addEventListener('change',ev=>{
    const checkbox=ev.target.closest('input[data-historical-id]');
    const statusInput=ev.target.closest('select[data-historical-status]');
    if(checkbox){const id=Number(checkbox.dataset.historicalId);if(checkbox.checked)historicalSelected.set(id,el('historical-list').querySelector(`select[data-historical-status="${id}"]`)?.value||'Hadir');else historicalSelected.delete(id);}
    if(statusInput){const id=Number(statusInput.dataset.historicalStatus);if(historicalSelected.has(id))historicalSelected.set(id,statusInput.value);}
    renderHistoricalList();
  });
  el('historical-check-visible')?.addEventListener('click',()=>{
    const term=fmt(el('historical-search').value);
    for(const m of eligibleMembers(selected).filter(m=>fmt(m.nama).includes(term)&&!presence.has(m.id)))historicalSelected.set(m.id,historicalSelected.get(m.id)||'Hadir');
    renderHistoricalList();
  });
  el('historical-clear')?.addEventListener('click',()=>{historicalSelected.clear();renderHistoricalList();});
  el('historical-submit')?.addEventListener('click',submitHistorical);
}

function handleError(err){console.error(err);message('Gagal memuat data: '+(err.message||String(err)));}
async function init(){
  tabs();
  bindHistorical();
  createRecapControls();createExportAllButton();
  if(!configured||!window.supabase){el('configuration-warning').hidden=false;el('attendance-form').hidden=true;return;}
  db=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  el('public-event').addEventListener('change',()=>changeEvent().catch(handleError));
  el('member-search').addEventListener('input',searchMemberOptions);
  el('member-search').addEventListener('focus',searchMemberOptions);
  el('member-search').addEventListener('keydown',ev=>{
    if(ev.key==='Escape')closeMemberSuggestions();
    if(ev.key==='ArrowDown'){
      const first=el('member-suggestions').querySelector('button');
      if(first){ev.preventDefault();first.focus();}
    }
  });
  el('member-suggestions').addEventListener('click',ev=>{
    const button=ev.target.closest('button[data-member-id]');if(!button)return;
    el('public-member').value=button.dataset.memberId;
    const member=members.find(m=>String(m.id)===button.dataset.memberId);
    el('member-search').value=member?.nama||'';
    closeMemberSuggestions();showSelected();
  });
  el('member-suggestions').addEventListener('keydown',ev=>{
    const buttons=[...el('member-suggestions').querySelectorAll('button')];
    const index=buttons.indexOf(document.activeElement);
    if(ev.key==='Escape'){closeMemberSuggestions();el('member-search').focus();}
    if(ev.key==='ArrowDown'&&index<buttons.length-1){ev.preventDefault();buttons[index+1].focus();}
    if(ev.key==='ArrowUp'){ev.preventDefault();if(index>0)buttons[index-1].focus();else el('member-search').focus();}
  });
  document.addEventListener('click',ev=>{if(!el('member-picker-wrap').contains(ev.target))closeMemberSuggestions();});
  el('manual-admin-pin')?.addEventListener('input',()=>{showSelected();renderHistoricalList();});
  el('attendance-mode')?.addEventListener('change',()=>{updateAttendanceMode();updateEventOptions();changeEvent().catch(handleError);});
  updateAttendanceMode();
  el('public-category').addEventListener('change',renderRoster);
  el('attendance-form').addEventListener('submit',submit);
  el('refresh-attendance').addEventListener('click',()=>loadInitial().then(()=>message('Jadwal dan rekap diperbarui.')).catch(handleError));
  el('export-csv').addEventListener('click',exportCsv);
  await loadInitial();
  await handleQrDeepLink();
}
async function handleQrDeepLink(){
  const params=new URLSearchParams(window.location.search);
  const eventId=params.get('presensiEvent');
  const token=params.get('presensiToken');
  if(!eventId&&!token)return;
  window.showMarselaSection?.('presensi-section');
  if(token){qrValidation='pending';qrValidatedEventId=null;updateAttendanceMode();}
  let validatedEventId=eventId;
  if(token){
    try{
      const session=await callQrFunction({action:'validate',token});
      validatedEventId=String(session.eventId);
    }catch(error){
      qrValidation='invalid';
      message(`QR tidak aktif atau sudah kedaluwarsa: ${error.message||'minta QR baru kepada pengurus.'}`);
      showSelected();
      return;
    }
  }
  const event=events.find(e=>String(e.id)===String(validatedEventId)&&e.event_date===jakartaToday()&&e.is_open===true);
  if(!event){
    if(token)qrValidation='invalid';
    message('Tautan tidak aktif atau bukan untuk kegiatan hari ini. Silakan minta tautan terbaru kepada pengurus.');
    showSelected();
    return;
  }
  if(token){qrValidation='valid';qrValidatedEventId=String(event.id);el('public-event').disabled=true;}
  el('public-event').value=String(event.id);
  await changeEvent();
  window.showMarselaSection?.('presensi-section');
  message(token?`Sesi QR valid untuk “${event.title}”. Pilih nama Anda sendiri dan konfirmasi kehadiran.`:`Kegiatan “${event.title}” terbuka dari tautan kegiatan. Pilih nama Anda sendiri untuk melanjutkan presensi.`);
}
document.addEventListener('DOMContentLoaded',()=>init().catch(handleError));
})();
