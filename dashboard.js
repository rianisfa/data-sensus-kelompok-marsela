/* MARSELA Dashboard — data publik baca-saja, perubahan kegiatan via Edge Function. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dateWIB = () => {
    const f = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'});
    const p=f.formatToParts(new Date()), part=k=>p.find(x=>x.type===k).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  const addDays = (date, n) => { const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10); };
  const dateID = date => new Date(date+'T12:00:00Z').toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  const categorySet = { 'Caberawit':['PAUD','SD / Caberawit'], 'Muda-Mudi':['Muda - Mudi'], 'Kelompok':['Bapak - Bapak','Ibu - Ibu','Duda','Janda'],'Desa':['Bapak - Bapak','Ibu - Ibu','Duda','Janda'],'Pusat':['Bapak - Bapak','Ibu - Ibu','Duda','Janda','Muda - Mudi','SMP Sederajat','SMA Sederajat'] };
  const eligible = (event, members) => {
    const cats=[...(categorySet[event.jenis_pengajian]||[])];
    if(['Kelompok','Desa'].includes(event.jenis_pengajian)&&event.include_mudamudi) cats.push('Muda - Mudi');
    return members.filter(m=>cats.includes(m.kategori));
  };
  let db, members=[], recentEvents=[], upcomingEvents=[], isReady=false;
  // Kalender memuat jadwal per bulan langsung dari database, bukan hanya rentang 60 hari di Beranda.
  const [thisYear,thisMonth]=dateWIB().slice(0,7).split('-').map(Number);
  let calendarYear=thisYear, calendarMonth=thisMonth, calendarSelected=dateWIB();
  let calendarEvents=[], calendarRequest=0;
  const isoDay=(y,m,d)=>`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const monthName=(y,m)=>new Intl.DateTimeFormat('id-ID',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(y,m-1,1)));
  const shortDay=['Sen','Sel','Rab','Kam','Jum','Sab','Min'];
  const eventClass=e=> ({'Caberawit':'caberawit','Muda-Mudi':'mudamudi','Kelompok':'kelompok','Desa':'desa','Pusat':'pusat'}[e.jenis_pengajian]||'kelompok');
  const labelType=e=>e.jenis_pengajian||'Pengajian';
  function ensureCalendar(){
    if($('marsela-calendar'))return;
    const root=$('schedule-list');
    root.innerHTML=`<div id="marsela-calendar" class="marsela-calendar">
      <div class="cal-toolbar">
        <div class="cal-toolbar-title"><span class="cal-eyebrow">KALENDER BULANAN</span><h3 id="cal-month-title"></h3></div>
        <div class="cal-toolbar-actions"><button id="cal-prev" type="button" class="cal-icon-btn" aria-label="Bulan sebelumnya">&#10094;</button><button id="cal-today" type="button" class="btn-muted">Bulan ini</button><button id="cal-next" type="button" class="cal-icon-btn" aria-label="Bulan berikutnya">&#10095;</button></div>
      </div>
      <div class="cal-legend" aria-label="Legenda jenis pengajian"><span><i class="cal-dot caberawit"></i>Caberawit</span><span><i class="cal-dot mudamudi"></i>Muda-Mudi</span><span><i class="cal-dot kelompok"></i>Kelompok</span><span><i class="cal-dot desa"></i>Desa</span><span><i class="cal-dot pusat"></i>Pusat</span></div>
      <div class="cal-scroller"><div id="cal-grid" class="cal-grid" role="group" aria-label="Tanggal kegiatan"></div></div>
      <div id="cal-status" class="cal-status" role="status" aria-live="polite"></div>
      <div class="cal-details-head"><h3 id="cal-selected-title">Detail Kegiatan</h3><span id="cal-selected-count" class="cal-count"></span></div>
      <div id="cal-details" class="cal-details"></div>
    </div>`;
    installEventManager();
    $('cal-prev').addEventListener('click',()=>moveCalendar(-1));
    $('cal-next').addEventListener('click',()=>moveCalendar(1));
    $('cal-today').addEventListener('click',()=>{[calendarYear,calendarMonth]=dateWIB().slice(0,7).split('-').map(Number);calendarSelected=dateWIB();loadSchedule().catch(showError);});
    $('cal-grid').addEventListener('click',ev=>{
      const button=ev.target.closest('button[data-date]');if(!button)return;
      calendarSelected=button.dataset.date;renderCalendar();
    });
  }
  // Perubahan kegiatan hanya melalui Edge Function dengan token sesi pengurus.
  function installEventManager(){
    if($('marsela-manage-open'))return;
    const root=$('marsela-calendar');
    if(!root)return;
    const header=root.querySelector('.cal-toolbar-actions');
    const trigger=document.createElement('button');
    trigger.id='marsela-manage-open';trigger.type='button';trigger.className='btn-muted';
    trigger.textContent='Kelola Kegiatan';
    header.appendChild(trigger);
    trigger.hidden=!window.marselaIsAdmin?.();
    const overlay=document.createElement('div');
    overlay.id='marsela-manage-overlay';
    overlay.hidden=true;
    overlay.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(8,25,39,.7);padding:16px;overflow:auto;display:none;align-items:flex-start;justify-content:center';
    overlay.innerHTML=`<section role="dialog" aria-modal="true" aria-labelledby="marsela-manage-heading" style="background:#fff;color:#183047;width:min(100%,560px);border-radius:18px;padding:22px;margin:5vh auto;box-shadow:0 20px 70px #0004">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px"><h3 id="marsela-manage-heading" style="margin:0;color:#183047">Kelola Kegiatan</h3><button type="button" id="marsela-manage-close" aria-label="Tutup" style="border:0;background:#edf3f5;border-radius:8px;padding:9px 13px;color:#183047;cursor:pointer">Tutup ×</button></div>
      <p style="color:#526779;line-height:1.5">Tambah kegiatan baru, termasuk tanggal lampau untuk migrasi presensi dari buku. Penyimpanan menggunakan sesi Mode Pengurus yang sedang aktif.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"><button type="button" id="marsela-manage-new" class="btn-muted">+ Tambah Baru</button><label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="marsela-manage-show-archived"> Tampilkan arsip</label></div>
      <div id="marsela-manage-list" style="max-height:290px;overflow:auto;display:grid;gap:8px;margin:10px 0 18px"></div>
      <p id="marsela-manage-edit-hint" hidden style="color:#526779;font-size:13px"></p>
      <form id="marsela-manage-form" style="display:grid;gap:12px">
        <label style="display:grid;gap:5px">Nama kegiatan<input name="title" maxlength="150" minlength="3" required placeholder="Contoh: Pengajian Kelompok" style="width:100%;padding:11px;border:1px solid #c9d9df;border-radius:9px"></label>
        <label style="display:grid;gap:5px">Tanggal kegiatan<input name="event_date" type="date" required style="width:100%;padding:11px;border:1px solid #c9d9df;border-radius:9px"></label>
        <label style="display:grid;gap:5px">Jenis pengajian<select name="jenis_pengajian" required style="width:100%;padding:11px;border:1px solid #c9d9df;border-radius:9px"><option value="Kelompok">Kelompok</option><option value="Caberawit">Caberawit</option><option value="Muda-Mudi">Muda-Mudi</option><option value="Desa">Desa</option><option value="Pusat">Pusat</option></select></label>
        <label style="display:grid;gap:5px">Keterangan<textarea name="notes" rows="3" maxlength="500" placeholder="Lokasi atau keterangan kegiatan" style="width:100%;padding:11px;border:1px solid #c9d9df;border-radius:9px"></textarea></label>
        <label style="display:flex;gap:9px;align-items:center"><input name="include_mudamudi" type="checkbox"> Sertakan Muda-Mudi pada kegiatan Kelompok / Desa</label>
        <label style="display:flex;gap:9px;align-items:center"><input name="is_open" type="checkbox"> Buka presensi (hanya berlaku pada hari kegiatan)</label>
        <button id="marsela-manage-submit" type="submit" style="border:0;border-radius:10px;background:#4fb99c;color:#10283b;padding:12px;font-weight:700;cursor:pointer">Periksa Data Kegiatan</button>
      </form>
      <div id="marsela-manage-confirm" hidden style="margin-top:14px;border-top:1px solid #dce7eb;padding-top:14px">
        <p id="marsela-manage-preview" style="white-space:pre-line;color:#183047;line-height:1.6"></p>
        
        <div style="display:flex;gap:10px;margin-top:12px"><button id="marsela-manage-back" type="button" style="flex:1;padding:12px;border:1px solid #c9d9df;border-radius:9px;background:#fff;color:#183047">Kembali</button><button id="marsela-manage-save" type="button" style="flex:2;padding:12px;border:0;border-radius:9px;background:#4fb99c;color:#10283b;font-weight:700">Simpan Kegiatan</button></div>
      </div>
      <p id="marsela-manage-result" role="status" aria-live="polite" style="margin:12px 0 0;color:#526779;white-space:pre-line"></p>
    </section>`;
    document.body.appendChild(overlay);
    const form=overlay.querySelector('#marsela-manage-form');
    const updateMudamudiChoice=()=>{
      const type=form.elements.namedItem('jenis_pengajian').value;
      const checkbox=form.elements.namedItem('include_mudamudi');
      checkbox.disabled=!['Kelompok','Desa'].includes(type);
      if(checkbox.disabled)checkbox.checked=false;
    };
    form.elements.namedItem('jenis_pengajian').addEventListener('change',updateMudamudiChoice);
    updateMudamudiChoice();
    const confirm=overlay.querySelector('#marsela-manage-confirm');
    const output=overlay.querySelector('#marsela-manage-result');
    const save=overlay.querySelector('#marsela-manage-save');
    let pending=null, saving=false, editingId=null, allManaged=[];
    const list=overlay.querySelector('#marsela-manage-list');
    const editHint=overlay.querySelector('#marsela-manage-edit-hint');
    const newBtn=overlay.querySelector('#marsela-manage-new');
    const archivedToggle=overlay.querySelector('#marsela-manage-show-archived');
    const field=name=>form.elements.namedItem(name);
    async function callAdmin(action, payload={}){
      const adminToken=window.marselaAdminToken?.();
      if(!window.marselaIsAdmin?.()||!adminToken)throw new Error('Sesi pengurus tidak aktif. Silakan masuk kembali.');
      const c=window.MARSeLA_CONFIG||{};
      if(!/^https:\/\/.+\.supabase\.co$/.test(c.supabaseUrl||'')||!c.supabaseAnonKey)throw new Error('Konfigurasi Supabase tidak tersedia.');
      const response=await fetch(`${c.supabaseUrl}/functions/v1/marsela-qr`,{method:'POST',headers:{'Content-Type':'application/json','apikey':c.supabaseAnonKey,'Authorization':`Bearer ${c.supabaseAnonKey}`},body:JSON.stringify({action,adminToken,...payload})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok||result.error||result.ok===false)throw new Error(result.error||`Server menolak permintaan (HTTP ${response.status}).`);
      return result;
    }
    function startNew(){editingId=null;form.reset();updateMudamudiChoice();form.hidden=false;confirm.hidden=true;editHint.hidden=true;newBtn.textContent='+ Tambah Baru';output.textContent='';field('title').focus();}
    async function reloadManaged(){
      list.textContent='Memuat daftar kegiatan…';
      try{
        allManaged=await pageAll('marsela_events','id,title,event_date,notes,is_open,jenis_pengajian,include_mudamudi,is_archived',q=>q.order('event_date',{ascending:false}).order('id',{ascending:false}));
        drawManaged();
      }catch(e){list.textContent='Gagal memuat daftar: '+(e.message||String(e));}
    }
    function drawManaged(){
      const shown=allManaged.filter(e=>archivedToggle.checked||!e.is_archived);
      list.innerHTML=shown.length?shown.map(e=>`<div style="border:1px solid #dbe6e9;border-radius:10px;padding:10px;display:grid;gap:8px"><div><b>${escape(e.title)}</b><div style="font-size:12px;color:#526779">${escape(dateID(e.event_date))} · ${escape(e.jenis_pengajian)} ${e.is_archived?'· DIARSIPKAN':''}</div></div><div style="display:flex;flex-wrap:wrap;gap:6px"><button type="button" class="btn-muted" data-op="edit" data-id="${e.id}">Edit</button><button type="button" class="btn-muted" data-op="${e.is_archived?'restore':'archive'}" data-id="${e.id}">${e.is_archived?'Pulihkan':'Arsipkan'}</button><button type="button" class="btn-muted" data-op="delete" data-id="${e.id}">Hapus</button></div></div>`).join(''):'<p style="color:#526779">Tidak ada kegiatan.</p>';
    }
    archivedToggle.addEventListener('change',drawManaged);
    newBtn.addEventListener('click',startNew);
    list.addEventListener('click',async e=>{
      const btn=e.target.closest('button[data-op]');if(!btn||saving)return;
      const event=allManaged.find(x=>String(x.id)===btn.dataset.id);if(!event)return;
      const op=btn.dataset.op;
      if(op==='edit'){
        editingId=event.id;form.hidden=false;confirm.hidden=true;
        field('title').value=event.title;field('event_date').value=event.event_date;
        field('jenis_pengajian').value=event.jenis_pengajian;field('notes').value=event.notes||'';
        field('include_mudamudi').checked=!!event.include_mudamudi;updateMudamudiChoice();field('is_open').checked=!!event.is_open;
        editHint.hidden=false;editHint.textContent=`Mengedit kegiatan #${event.id}. Tanggal, jenis, dan peserta tidak boleh diubah bila sudah ada presensi atau sesi QR.`;
        field('title').focus();output.textContent='';return;
      }
      const descriptions={archive:`Arsipkan kegiatan "${event.title}"? Riwayat tetap tersimpan.`,restore:`Pulihkan kegiatan "${event.title}"?`,delete:`HAPUS PERMANEN kegiatan "${event.title}"? Hanya dapat dilakukan jika belum ada presensi dan sesi QR.`};
      if(!window.confirm(descriptions[op]))return;
      if(op==='delete'&&window.prompt('Ketik nama kegiatan persis untuk konfirmasi hapus permanen:')!==event.title){output.textContent='Penghapusan dibatalkan: nama konfirmasi tidak cocok.';return;}
      saving=true;btn.disabled=true;output.textContent='Memproses…';
      try{
        await callAdmin(op==='delete'?'delete_event':op==='archive'?'archive_event':'restore_event',{eventId:event.id,...(op==='delete'?{confirmTitle:event.title}:{})});
        output.textContent='Perubahan kegiatan berhasil.';await reloadManaged();await Promise.allSettled([refreshData(),loadSchedule()]);await loadDashboard().catch(console.error);
      }catch(err){output.textContent='Gagal: '+(err.message||String(err));}
      finally{saving=false;btn.disabled=false;}
    });
    const close=()=>{if(saving)return;overlay.hidden=true;overlay.style.display='none';pending=null;trigger.focus();};
    trigger.addEventListener('click',()=>{if(!window.marselaIsAdmin?.())return;overlay.hidden=false;overlay.style.display='flex';startNew();reloadManaged();});
    overlay.querySelector('#marsela-manage-close').addEventListener('click',close);
    overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
    overlay.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
    overlay.querySelector('#marsela-manage-back').addEventListener('click',()=>{if(saving)return;confirm.hidden=true;form.hidden=false;output.textContent='';});
    form.addEventListener('submit',e=>{
      e.preventDefault();
      const data=new FormData(form);
      const title=String(data.get('title')||'').trim();
      const event_date=String(data.get('event_date')||'');
      const jenis_pengajian=String(data.get('jenis_pengajian')||'');
      const notes=String(data.get('notes')||'').trim();
      if(title.length<3||title.length>150||!/^\d{4}-\d{2}-\d{2}$/.test(event_date)){
        output.textContent='Periksa nama dan tanggal kegiatan.';return;
      }
      const duplicate=allManaged.some(x=>x.id!==editingId&&x.event_date===event_date&&x.jenis_pengajian===jenis_pengajian&&x.title.trim().toLowerCase()===title.toLowerCase());
      if(duplicate){output.textContent='Kegiatan dengan nama, tanggal, dan jenis yang sama sudah ada pada kalender ini. Tidak ada data disimpan.';return;}
      pending={title,event_date,jenis_pengajian,notes,include_mudamudi:data.has('include_mudamudi')&&['Kelompok','Desa'].includes(jenis_pengajian),is_open:data.has('is_open')&&event_date===dateWIB()};
      overlay.querySelector('#marsela-manage-preview').textContent=`${editingId?'Periksa perubahan sebelum menyimpan:':'Periksa sebelum menyimpan:'}\n${title}\n${dateID(event_date)} · ${jenis_pengajian}\n${notes||'Tanpa keterangan'}\nPresensi: ${pending.is_open?'Dibuka hari ini':'Tidak dibuka'}`;
      form.hidden=true;confirm.hidden=false;output.textContent='';save.focus();
    });
    save.addEventListener('click',async()=>{
      if(saving||!pending)return;
      saving=true;save.disabled=true;save.textContent='Menyimpan…';output.textContent='Mengirim kegiatan ke server…';
      try{
        await callAdmin(editingId?'update_event':'create_event',{...(editingId?{eventId:editingId}:{}),...pending});
        output.textContent=`Kegiatan berhasil ${editingId?'diperbarui':'disimpan'}: ${pending.title} (${dateID(pending.event_date)}).`;
        editingId=null;editHint.hidden=true;await reloadManaged();
        pending=null;confirm.hidden=true;form.hidden=false;form.reset();
        await Promise.allSettled([refreshData(),loadSchedule()]);
        await loadDashboard().catch(console.error);
      }catch(error){output.textContent='Gagal menyimpan: '+(error.message||String(error));}
      finally{saving=false;save.disabled=false;save.textContent='Simpan Kegiatan';}
    });
  }
  function moveCalendar(delta){
    const d=new Date(Date.UTC(calendarYear, calendarMonth-1+delta,1));
    calendarYear=d.getUTCFullYear(); calendarMonth=d.getUTCMonth()+1;
    calendarSelected=isoDay(calendarYear,calendarMonth,1);
    loadSchedule().catch(showError);
  }
  function renderCalendar(){
    const filter=$('schedule-filter').value;
    const shown=calendarEvents.filter(e=>!filter||e.jenis_pengajian===filter);
    const group=new Map();for(const e of shown){const list=group.get(e.event_date)||[];list.push(e);group.set(e.event_date,list);}
    $('cal-month-title').textContent=monthName(calendarYear,calendarMonth);
    const offset=(new Date(Date.UTC(calendarYear,calendarMonth-1,1)).getUTCDay()+6)%7;
    const days=new Date(Date.UTC(calendarYear,calendarMonth,0)).getUTCDate();
    const cells=shortDay.map(d=>`<span class="cal-weekday">${d}</span>`);
    for(let i=0;i<offset;i++)cells.push('<span class="cal-pad" aria-hidden="true"></span>');
    for(let d=1;d<=days;d++){
      const date=isoDay(calendarYear,calendarMonth,d), dayEvents=group.get(date)||[];
      const selected=date===calendarSelected, today=date===dateWIB();
      const dots=[...new Set(dayEvents.map(eventClass))].map(cls=>`<i class="cal-dot ${cls}"></i>`).join('');
      const description=dayEvents.length?`${dayEvents.length} kegiatan`:'Tidak ada kegiatan';
      cells.push(`<button type="button" data-date="${date}" class="cal-day${selected?' selected':''}${today?' today':''}${dayEvents.length?' has-event':''}" aria-pressed="${selected}" aria-label="${dateID(date)}, ${description}"><span class="cal-day-num">${d}</span><span class="cal-day-dots" aria-hidden="true">${dots}</span></button>`);
    }
    $('cal-grid').innerHTML=cells.join('');
    const selected=group.get(calendarSelected)||[];
    $('cal-selected-title').textContent=`Kegiatan · ${dateID(calendarSelected)}`;
    $('cal-selected-count').textContent=`${selected.length} kegiatan`;
    $('cal-details').innerHTML=selected.length? selected.map(scheduleCard).join(''):'<p class="dash-empty">Tidak ada kegiatan untuk tanggal dan filter yang dipilih.</p>';
    $('cal-status').textContent=`${shown.length} kegiatan ditampilkan pada ${monthName(calendarYear,calendarMonth)}.`;
  }

  const read = result => { if(result.error)throw result.error;return result.data||[]; };
  function navigate(tab){
    for (const btn of document.querySelectorAll('.tab-btn')) {
      const active=btn.dataset.tab===tab;
      btn.classList.toggle('active',active);
      btn.setAttribute('aria-current',active?'page':'false');
    }
    for (const section of document.querySelectorAll('[id$="-section"]')){
      if(['beranda-section','sensus-section','presensi-section','jadwal-section','statistik-section'].includes(section.id)) section.hidden=section.id!==tab+'-section';
    }
    if(tab==='beranda')loadDashboard().catch(showError);
    if(tab==='jadwal')loadSchedule().catch(showError);
    if(tab==='statistik')loadStatistics().catch(showError);
  }
  const summaryCard = (label,value,sub='') => `<div class="dash-stat"><span>${escape(label)}</span><strong>${escape(value)}</strong>${sub?`<small>${escape(sub)}</small>`:''}</div>`;
  async function pageAll(table, columns, modify){
    const result=[];
    for(let offset=0;offset<20000;offset+=1000){
      let q=db.from(table).select(columns).range(offset,offset+999);
      if(modify)q=modify(q);
      const page=read(await q);result.push(...page);
      if(page.length<1000)break;
    }
    return result;
  }
  async function getMembers(){
    members=await pageAll('marsela_members','id,kategori,is_active,kelamin',q=>q.eq('is_active',true).order('id'));
  }
  async function getEvents(){
    const today=dateWIB();
    const from=addDays(today,-180),to=addDays(today,60);
    const all=await pageAll('marsela_events','id,title,event_date,notes,is_open,jenis_pengajian,include_mudamudi,is_archived',q=>q.eq('is_archived',false).gte('event_date',from).lte('event_date',to).order('event_date',{ascending:false}).order('id',{ascending:false}));
    recentEvents=all.filter(e=>e.event_date<=today);
    upcomingEvents=all.filter(e=>e.event_date>=today).sort((a,b)=>a.event_date.localeCompare(b.event_date)||Number(a.id)-Number(b.id));
  }
  async function refreshData(){
    if(!db)throw new Error('Supabase belum dikonfigurasi di config.js.');
    await Promise.all([getMembers(),getEvents()]);isReady=true;
  }
  function scheduleCard(e){
    const cls=e.event_date===dateWIB()?'today':'';
    const qrAction=e.event_date===dateWIB()&&e.is_open
      ? `<button type="button" class="marsela-qr-open" data-event-id="${escape(e.id)}" data-event-title="${escape(e.title)}"><span aria-hidden="true">▦</span> Tampilkan QR</button>`
      : '';
    return `<article class="schedule-item ${cls}"><div class="schedule-date"><strong>${escape(dateID(e.event_date))}</strong><span>${escape(e.jenis_pengajian||'Pengajian')}</span></div><div class="schedule-detail"><b>${escape(e.title)}</b><small>${escape(e.notes||'Waktu/tempat belum dicantumkan')}</small></div><span class="schedule-pill">${e.event_date<dateWIB()?'Selesai':e.event_date===dateWIB()?(e.is_open?'Presensi dibuka':'Hari ini'):'Akan datang'}</span>${qrAction}</article>`;
  }
  async function loadDashboard(){
    if(!db){$('dash-message').textContent='Koneksi Supabase belum tersedia. Pastikan config.js sudah diisi.';return;}
    if(!isReady)await refreshData();
    const today=dateWIB(), monthStart=today.slice(0,7)+'-01';
    const thisMonth=recentEvents.filter(e=>e.event_date>=monthStart);
    const todayEvents=upcomingEvents.filter(e=>e.event_date===today);
    const other=upcomingEvents.filter(e=>e.event_date>today).slice(0,5);
    $('dash-summary').innerHTML=[
      summaryCard('Anggota Aktif',members.length,'Tercatat di sensus'),
      summaryCard('Kegiatan Bulan Ini',thisMonth.length,'Hingga hari ini'),
      summaryCard('Pengajian Hari Ini',todayEvents.length,'Sesuai jadwal WIB'),
      summaryCard('Jadwal Mendatang',upcomingEvents.filter(e=>e.event_date>today).length,'60 hari ke depan')
    ].join('');
    $('dash-today').innerHTML=todayEvents.length?todayEvents.map(scheduleCard).join(''):'<p class="dash-empty">Tidak ada jadwal pengajian hari ini.</p>';
    $('dash-upcoming').innerHTML=other.length?other.map(scheduleCard).join(''):'<p class="dash-empty">Belum ada jadwal berikutnya.</p>';
    $('dash-updated').textContent=`Diperbarui ${dateID(today)} · WIB`;
    $('dash-message').textContent='';
  }
  async function loadSchedule(){
    ensureCalendar();
    if(!db){$('cal-status').textContent='Supabase belum terhubung. Periksa config.js.';return;}
    const request=++calendarRequest;
    const first=isoDay(calendarYear,calendarMonth,1);
    const last=isoDay(calendarYear,calendarMonth,new Date(Date.UTC(calendarYear,calendarMonth,0)).getUTCDate());
    $('cal-status').textContent='Memuat jadwal dari Supabase…';
    try{
      const list=await pageAll('marsela_events','id,title,event_date,notes,is_open,jenis_pengajian,include_mudamudi,is_archived',q=>q.eq('is_archived',false).gte('event_date',first).lte('event_date',last).order('event_date',{ascending:true}).order('id',{ascending:true}));
      if(request!==calendarRequest)return;
      calendarEvents=list;
      if(!calendarSelected.startsWith(first.slice(0,7)))calendarSelected=first;
      renderCalendar();
    }catch(e){
      if(request!==calendarRequest)return;
      $('cal-status').textContent='Jadwal gagal dimuat: '+(e.message||String(e));
      $('cal-details').innerHTML='<p class="dash-empty">Gagal memuat jadwal. Coba tombol Muat ulang.</p>';
      throw e;
    }
  }
  async function attendanceFor(e){
    const records=await pageAll('marsela_attendance','member_id,status',q=>q.eq('event_id',e.id).order('member_id'));
    const present=new Set(records.filter(r=>r.status==='Hadir').map(r=>Number(r.member_id)));
    const totalMembers=eligible(e,members);
    return {event:e,total:totalMembers.length,hadir:totalMembers.filter(m=>present.has(Number(m.id))).length};
  }
  async function loadStatistics(){
    if(!db){$('chart-message').textContent='Hubungkan Supabase terlebih dahulu.';return;}
    if(!isReady)await refreshData();
    const btn=$('chart-refresh');btn.disabled=true;
    $('chart-bars').innerHTML='<p class="dash-empty">Memuat statistik kehadiran…</p>';
    try{
      const days=Number($('chart-period').value)||30, start=addDays(dateWIB(),-days+1), type=$('chart-filter').value;
      const events=recentEvents.filter(e=>e.event_date>=start&&(!type||e.jenis_pengajian===type)).sort((a,b)=>a.event_date.localeCompare(b.event_date));
      const details=[];
      for(let i=0;i<events.length;i+=8){details.push(...await Promise.all(events.slice(i,i+8).map(attendanceFor)));}
      const total=details.reduce((n,x)=>n+x.total,0), hadir=details.reduce((n,x)=>n+x.hadir,0);
      const pct=total?100*hadir/total:0;
      $('chart-summary').innerHTML=summaryCard('Jumlah Pertemuan',details.length)+summaryCard('Kesempatan Hadir',total)+summaryCard('Tercatat Hadir',hadir)+summaryCard('Persentase Kehadiran',`${pct.toFixed(1)}%`);
      $('chart-bars').innerHTML=details.length?'<div class="chart-legend"><span class="chart-legend-item"><i class="chart-legend-dot" aria-hidden="true"></i>Hadir</span><span class="chart-legend-item"><i class="chart-legend-dot remaining" aria-hidden="true"></i>Tidak Hadir</span></div>'+details.map(d=>{
        const p=d.total?d.hadir/d.total*100:0;
        const label=`${dateID(d.event.event_date)} · ${d.event.title}`;
        return `<div class="chart-row"><div class="chart-row-top"><span title="${escape(label)}">${escape(label)}</span><b>${p.toFixed(1)}%</b></div><div class="chart-track"><div class="chart-fill" style="width:${Math.min(100,Math.max(0,p)).toFixed(2)}%"></div></div><small>${d.hadir} dari ${d.total} peserta</small></div>`;
      }).join(''):'<p class="dash-empty">Belum ada kegiatan untuk jenis dan periode ini.</p>';
      $('chart-message').textContent='';
    }catch(e){showError(e);$('chart-bars').textContent='Gagal menampilkan grafik. Silakan muat ulang.';}
    finally{btn.disabled=false;}
  }
  function showError(error){console.error('Marsela dashboard:',error);for(const id of ['dash-message','chart-message'])$(id).textContent='Gagal memuat data: '+(error.message||String(error));}
  document.addEventListener('DOMContentLoaded',async()=>{
    document.querySelectorAll('.tab-btn').forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.tab)));
    $('schedule-filter').addEventListener('change',()=>loadSchedule().catch(showError));
    $('schedule-refresh').addEventListener('click',async()=>{try{await refreshData();await loadSchedule();}catch(e){showError(e);}});
    $('chart-filter').addEventListener('change',()=>loadStatistics().catch(showError));
    $('chart-period').addEventListener('change',()=>loadStatistics().catch(showError));
    $('chart-refresh').addEventListener('click',async()=>{try{await refreshData();await loadStatistics();}catch(e){showError(e);}});
    const c=window.MARSeLA_CONFIG||{};
    if(window.supabase&&/^https:\/\/.+\.supabase\.co$/.test(c.supabaseUrl||'')&&c.supabaseAnonKey){
      db=window.supabase.createClient(c.supabaseUrl,c.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      try{await refreshData();await loadDashboard();}catch(e){showError(e);}
    }else{$('dash-message').textContent='Periksa config.js: Supabase belum terhubung.';}
  });
})();
