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
const jakartaToday = () => {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const val = k => parts.find(p=>p.type===k)?.value;
  return `${val('year')}-${val('month')}-${val('day')}`;
};
const read = r => {if(r.error) throw r.error; return r.data;};
let db, members=[], events=[], presence=new Map(), selected=null, rows=[];
const message = s => {el('presensi-message').textContent=s;};
function tabs(){document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.tab-btn').forEach(x=>x.classList.toggle('active',x===b));
  el('sensus-section').hidden=b.dataset.tab!=='sensus';
  el('presensi-section').hidden=b.dataset.tab!=='presensi';
}));}
async function loadInitial(){
  members=read(await db.from('marsela_members').select('id,nama,kategori,is_active').eq('is_active',true).order('nama').limit(1000));
  events=read(await db.from('marsela_events').select('id,title,event_date,notes,is_open').order('event_date',{ascending:false}).order('id',{ascending:false}).limit(150));
  el('public-event').innerHTML=events.length?events.map(x=>option(x.id,`${dateLabel(x.event_date)} — ${x.title}${x.is_open?' (Dibuka)':' (Ditutup)'}`)).join(''):option('','Belum ada kegiatan');
  const cats=[...new Set(members.map(m=>m.kategori).filter(Boolean))].sort();
  el('public-category').innerHTML=option('','Semua kategori')+cats.map(c=>option(c,c)).join('');
  setMemberOptions(); await changeEvent();
}
function setMemberOptions(){
  const before=el('public-member').value, term=fmt(el('member-search').value);
  const filtered=members.filter(m=>fmt(m.nama).includes(term));
  el('public-member').innerHTML=option('','— Pilih nama sendiri —')+filtered.map(m=>option(m.id,`${m.nama} — ${m.kategori||'-'}`)).join('');
  if(filtered.some(m=>String(m.id)===before))el('public-member').value=before;
  showSelected();
}
async function changeEvent(){
  selected=events.find(e=>String(e.id)===el('public-event').value)||null;
  presence=new Map();
  if(selected){
    const items=read(await db.from('marsela_attendance').select('member_id,status').eq('event_id',selected.id).limit(1000));
    presence=new Map(items.map(r=>[Number(r.member_id),r.status]));
  }
  showSelected(); renderRoster();
}
function showSelected(){
  const id=Number(el('public-member').value);
  const existing=presence.get(id);
  const open=selected?.is_open && selected.event_date===jakartaToday();
  el('submit-attendance').disabled=!selected||!id||!!existing||!open;
  el('selected-info').textContent=!selected?'Belum ada jadwal pengajian.':!id?'Pilih nama Anda terlebih dahulu.':existing?`Nama ini sudah tercatat: ${existing}. Presensi terkunci dan tidak dapat diubah.`:!open?'Kegiatan ini tidak membuka presensi hari ini.':`Siap mengisi untuk ${members.find(m=>m.id===id)?.nama||''}. Pastikan status sudah benar.`;
}
function renderRoster(){
  rows=members.filter(m=>!el('public-category').value||m.kategori===el('public-category').value).map(m=>({...m,status:presence.get(m.id)||'Belum'}));
  const count=s=>rows.filter(m=>m.status===s).length;
  el('public-summary').innerHTML=['Total: '+rows.length,'Hadir: '+count('Hadir'),'Izin: '+count('Izin'),'Sakit: '+count('Sakit'),'Belum: '+count('Belum')].map(s=>`<div class="stat-card">${clean(s)}</div>`).join('');
  el('public-roster').innerHTML=selected?`<table><thead><tr><th>No.</th><th>Nama</th><th>Kategori</th><th>Status</th></tr></thead><tbody>${rows.map((m,i)=>`<tr><td>${i+1}</td><td>${clean(m.nama)}</td><td>${clean(m.kategori)}</td><td>${clean(m.status)}</td></tr>`).join('')}</tbody></table>`:'<p>Belum ada kegiatan.</p>';
}
function exportCsv(){
  if(!selected)return;
  const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const lines=[['Nama','Kategori','Kegiatan','Tanggal','Status'],...rows.map(m=>[m.nama,m.kategori,selected.title,selected.event_date,m.status])];
  const csv='﻿'+lines.map(r=>r.map(q).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`rekap-marsela-${selected.event_date}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function submit(ev){
  ev.preventDefault();
  const id=Number(el('public-member').value), status=el('public-status').value;
  if(!selected||!id||!['Hadir','Izin','Sakit'].includes(status))return;
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
  if(!configured||!window.supabase){el('configuration-warning').hidden=false;el('attendance-form').hidden=true;return;}
  db=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  el('public-event').addEventListener('change',()=>changeEvent().catch(handleError));
  el('member-search').addEventListener('input',setMemberOptions);
  el('public-member').addEventListener('change',showSelected);
  el('public-category').addEventListener('change',renderRoster);
  el('attendance-form').addEventListener('submit',submit);
  el('refresh-attendance').addEventListener('click',()=>changeEvent().then(()=>message('Rekap diperbarui.')).catch(handleError));
  el('export-csv').addEventListener('click',exportCsv);
  await loadInitial();
}
function handleError(err){console.error(err);message('Gagal memuat data: '+(err.message||String(err)));}
document.addEventListener('DOMContentLoaded',()=>init().catch(handleError));
})();
