/* Presensi publik tanpa login; hanya RPC insert di database, tidak ada update/delete. */
(() => {
'use strict';
const el = id => document.getElementById(id);
const config = window.MARSeLA_CONFIG || {};
const configured = /^https:\/\/.+\.supabase\.co$/.test(config.supabaseUrl || '') && !!config.supabaseAnonKey && !config.supabaseAnonKey.includes('GANTI');
const clean = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const option = (v,t) => `<option value="${clean(v)}">${clean(t)}</option>`;
const dateLabel = v => v ? new Date(v + 'T12:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'}) : '';
const fmt = v => String(v ?? '').trim().toLowerCase();
const eligibility = {
  'Caberawit': ['PAUD','SD / Caberawit'],
  'Muda-Mudi': ['Muda - Mudi'],
  'Kelompok': ['Bapak - Bapak','Ibu - Ibu','Duda','Janda']
};
const eligibleMembers = (event = selected) => {
  const allowed = [...(eligibility[event?.jenis_pengajian] || [])];
  if (event?.jenis_pengajian === 'Kelompok' && event?.include_mudamudi) allowed.push('Muda - Mudi');
  return members.filter(m => allowed.includes(m.kategori));
};
function setCategoryOptions(){
  const prev=el('public-category').value;
  const cats=[...new Set(eligibleMembers(recapEvent).map(m=>m.kategori).filter(Boolean))].sort();
  el('public-category').innerHTML=option('','Semua kategori')+cats.map(c=>option(c,c)).join('');
  if(cats.includes(prev))el('public-category').value=prev;
}
const jakartaToday = () => {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const val = k => parts.find(p=>p.type===k)?.value;
  return `${val('year')}-${val('month')}-${val('day')}`;
};
const read = r => {if(r.error) throw r.error; return r.data;};
let db, members=[], events=[], presence=new Map(), selected=null, recapEvent=null, recapPresence=new Map(), rows=[];
const message = s => {el('presensi-message').textContent=s;};
function tabs(){document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.tab-btn').forEach(x=>x.classList.toggle('active',x===b));
  el('sensus-section').hidden=b.dataset.tab!=='sensus';
  el('presensi-section').hidden=b.dataset.tab!=='presensi';
}));}
const eventText = e => `${dateLabel(e.event_date)} — [${e.jenis_pengajian}] ${e.title}${e.is_open?' (Dibuka)':' (Ditutup)'}`;
async function loadInitial(){
  members=read(await db.from('marsela_members').select('id,nama,kategori,is_active').eq('is_active',true).order('nama').limit(1000));
  // Kegiatan mendatang tidak ditampilkan. Arsip adalah kegiatan sebelum hari ini (WIB).
  events=read(await db.from('marsela_events').select('id,title,event_date,notes,is_open,jenis_pengajian,include_mudamudi').lte('event_date',jakartaToday()).order('event_date',{ascending:false}).order('id',{ascending:false}).limit(1000));
  const today=jakartaToday();
  const todaysEvents=events.filter(e=>e.event_date===today);
  const pastEvents=events.filter(e=>e.event_date<today);
  el('public-event').innerHTML=option('','— Pilih pengajian hari ini —')+todaysEvents.map(e=>option(e.id,eventText(e))).join('');
  const archive=el('public-archive');
  archive.innerHTML=option('','— Pilih kegiatan yang sudah lewat —')+pastEvents.map(e=>option(e.id,eventText(e))).join('');
  await changeEvent();
}
function createArchiveSelector(){
  const container=el('public-category').closest('.form-grid');
  const label=document.createElement('label');
  label.textContent='Arsip rekap kegiatan yang sudah lewat';
  const select=document.createElement('select');
  select.id='public-archive';
  select.addEventListener('change',()=>changeRecap().catch(handleError));
  label.appendChild(select);
  container.insertBefore(label,container.firstChild);
  const note=document.createElement('p');
  note.className='message';
  note.id='recap-source';
  container.parentElement.insertBefore(note,container.nextSibling);
}
async function getPresence(event){
  if(!event)return new Map();
  const items=read(await db.from('marsela_attendance').select('member_id,status').eq('event_id',event.id).limit(1000));
  return new Map(items.map(r=>[Number(r.member_id),r.status]));
}
async function changeRecap(){
  const id=el('public-archive').value;
  recapEvent=id?events.find(e=>String(e.id)===id):selected;
  recapPresence=(recapEvent?.id===selected?.id)?presence:await getPresence(recapEvent);
  el('recap-source').textContent=recapEvent?`Rekap: ${eventText(recapEvent)}`:'Belum ada kegiatan yang dipilih untuk rekap.';
  setCategoryOptions();renderRoster();
}
function setMemberOptions(){
  const before=el('public-member').value, term=fmt(el('member-search').value);
  const filtered=eligibleMembers().filter(m=>fmt(m.nama).includes(term));
  el('public-member').innerHTML=option('','— Pilih nama sendiri —')+filtered.map(m=>option(m.id,`${m.nama} — ${m.kategori||'-'}`)).join('');
  if(filtered.some(m=>String(m.id)===before))el('public-member').value=before;
  showSelected();
}
async function changeEvent(){
  selected=events.find(e=>String(e.id)===el('public-event').value && e.event_date===jakartaToday())||null;
  presence=await getPresence(selected);
  setMemberOptions();
  await changeRecap();
}
function showSelected(){
  const id=Number(el('public-member').value);
  const existing=presence.get(id);
  const open=selected?.is_open && selected.event_date===jakartaToday();
  const memberAllowed=eligibleMembers().some(m=>m.id===id);
  el('submit-attendance').disabled=!selected||!id||!memberAllowed||!!existing||!open;
  el('selected-info').textContent=!selected?'Belum ada jadwal pengajian.':!id?'Pilih nama Anda terlebih dahulu.':existing?`Nama ini sudah tercatat: ${existing}. Presensi terkunci dan tidak dapat diubah.`:!open?'Kegiatan ini tidak membuka presensi hari ini.':`Siap mengisi untuk ${members.find(m=>m.id===id)?.nama||''}. Pastikan status sudah benar.`;
}
function renderRoster(){
  rows=eligibleMembers(recapEvent).filter(m=>!el('public-category').value||m.kategori===el('public-category').value).map(m=>({...m,status:recapPresence.get(m.id)||'Belum'}));
  const count=s=>rows.filter(m=>m.status===s).length;
  el('public-summary').innerHTML=['Total: '+rows.length,'Hadir: '+count('Hadir'),'Izin: '+count('Izin'),'Sakit: '+count('Sakit'),'Belum: '+count('Belum')].map(s=>`<div class="stat-card">${clean(s)}</div>`).join('');
  el('public-roster').innerHTML=recapEvent?`<table><thead><tr><th>No.</th><th>Nama</th><th>Kategori</th><th>Status</th></tr></thead><tbody>${rows.map((m,i)=>`<tr><td>${i+1}</td><td>${clean(m.nama)}</td><td>${clean(m.kategori)}</td><td>${clean(m.status)}</td></tr>`).join('')}</tbody></table>`:'<p>Belum ada kegiatan.</p>';
}
function exportCsv(){
  if(!recapEvent)return;
  const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const lines=[['Nama','Kategori','Kegiatan','Tanggal','Status'],...rows.map(m=>[m.nama,m.kategori,recapEvent.title,recapEvent.event_date,m.status])];
  const csv='﻿'+lines.map(r=>r.map(q).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`rekap-marsela-${recapEvent.jenis_pengajian}-${recapEvent.event_date}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function submit(ev){
  ev.preventDefault();
  const id=Number(el('public-member').value), status=el('public-status').value;
  if(!selected||!id||!eligibleMembers().some(m=>m.id===id)||!['Hadir','Izin','Sakit'].includes(status))return;
  const member=members.find(m=>m.id===id);
  if(!window.confirm(`Kirim presensi ${status} untuk ${member?.nama}? Setelah dikirim TIDAK BISA DIUBAH.`))return;
  const button=el('submit-attendance');button.disabled=true;
  try{
    read(await db.rpc('marsela_submit_attendance',{p_event_id:selected.id,p_member_id:id,p_status:status}));
    message(`Berhasil! Presensi ${member.nama}: ${status}. Data sudah terkunci.`);
    await changeEvent();
  }catch(err){
    console.error(err);
    message('Presensi gagal: '+(err.message||String(err))+'. Jika sudah tercatat, tidak dapat diubah lagi.');
    await changeEvent().catch(()=>{});
  }finally{showSelected();}
}
async function init(){
  tabs();
  createArchiveSelector();
  if(!configured||!window.supabase){el('configuration-warning').hidden=false;el('attendance-form').hidden=true;return;}
  db=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  el('public-event').addEventListener('change',()=>changeEvent().catch(handleError));
  el('member-search').addEventListener('input',setMemberOptions);
  el('public-member').addEventListener('change',showSelected);
  el('public-category').addEventListener('change',renderRoster);
  el('attendance-form').addEventListener('submit',submit);
  el('refresh-attendance').addEventListener('click',()=>changeRecap().then(()=>message('Rekap diperbarui.')).catch(handleError));
  el('export-csv').addEventListener('click',exportCsv);
  await loadInitial();
}
function handleError(err){console.error(err);message('Gagal memuat data: '+(err.message||String(err)));}
document.addEventListener('DOMContentLoaded',()=>init().catch(handleError));
})();
