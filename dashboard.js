/* Marsela Dashboard — UI publik baca-saja, sumber data Supabase.
   Tidak menyimpan kredensial pengguna, tidak menulis ke tabel. */
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
  const categorySet = { 'Caberawit':['PAUD','SD / Caberawit'], 'Muda-Mudi':['Muda - Mudi'], 'Kelompok':['Bapak - Bapak','Ibu - Ibu','Duda','Janda'] };
  const eligible = (event, members) => {
    const cats=[...(categorySet[event.jenis_pengajian]||[])];
    if(event.jenis_pengajian==='Kelompok'&&event.include_mudamudi) cats.push('Muda - Mudi');
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
  const eventClass=e=> e.jenis_pengajian==='Caberawit'?'caberawit':e.jenis_pengajian==='Muda-Mudi'?'mudamudi':'kelompok';
  const labelType=e=>e.jenis_pengajian||'Pengajian';
  function ensureCalendar(){
    if($('marsela-calendar'))return;
    const root=$('schedule-list');
    root.innerHTML=`<div id="marsela-calendar" class="marsela-calendar">
      <div class="cal-toolbar">
        <div class="cal-toolbar-title"><span class="cal-eyebrow">KALENDER BULANAN</span><h3 id="cal-month-title"></h3></div>
        <div class="cal-toolbar-actions"><button id="cal-prev" type="button" class="cal-icon-btn" aria-label="Bulan sebelumnya">&#10094;</button><button id="cal-today" type="button" class="btn-muted">Bulan ini</button><button id="cal-next" type="button" class="cal-icon-btn" aria-label="Bulan berikutnya">&#10095;</button></div>
      </div>
      <div class="cal-legend" aria-label="Legenda jenis pengajian"><span><i class="cal-dot caberawit"></i>Caberawit</span><span><i class="cal-dot mudamudi"></i>Muda-Mudi</span><span><i class="cal-dot kelompok"></i>Kelompok</span></div>
      <div class="cal-scroller"><div id="cal-grid" class="cal-grid" role="group" aria-label="Tanggal kegiatan"></div></div>
      <div id="cal-status" class="cal-status" role="status" aria-live="polite"></div>
      <div class="cal-details-head"><h3 id="cal-selected-title">Detail Kegiatan</h3><span id="cal-selected-count" class="cal-count"></span></div>
      <div id="cal-details" class="cal-details"></div>
    </div>`;
    $('cal-prev').addEventListener('click',()=>moveCalendar(-1));
    $('cal-next').addEventListener('click',()=>moveCalendar(1));
    $('cal-today').addEventListener('click',()=>{[calendarYear,calendarMonth]=dateWIB().slice(0,7).split('-').map(Number);calendarSelected=dateWIB();loadSchedule().catch(showError);});
    $('cal-grid').addEventListener('click',ev=>{
      const button=ev.target.closest('button[data-date]');if(!button)return;
      calendarSelected=button.dataset.date;renderCalendar();
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
    const all=await pageAll('marsela_events','id,title,event_date,notes,is_open,jenis_pengajian,include_mudamudi',q=>q.gte('event_date',from).lte('event_date',to).order('event_date',{ascending:false}).order('id',{ascending:false}));
    recentEvents=all.filter(e=>e.event_date<=today);
    upcomingEvents=all.filter(e=>e.event_date>=today).sort((a,b)=>a.event_date.localeCompare(b.event_date)||Number(a.id)-Number(b.id));
  }
  async function refreshData(){
    if(!db)throw new Error('Supabase belum dikonfigurasi di config.js.');
    await Promise.all([getMembers(),getEvents()]);isReady=true;
  }
  function scheduleCard(e){
    const cls=e.event_date===dateWIB()?'today':'';
    return `<article class="schedule-item ${cls}"><div class="schedule-date"><strong>${escape(dateID(e.event_date))}</strong><span>${escape(e.jenis_pengajian||'Pengajian')}</span></div><div class="schedule-detail"><b>${escape(e.title)}</b><small>${escape(e.notes||'Waktu/tempat belum dicantumkan')}</small></div><span class="schedule-pill">${e.event_date===dateWIB()?(e.is_open?'Presensi dibuka':'Hari ini'):'Akan datang'}</span></article>`;
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
    $('dash-today').innerHTML=todayEvents.length?todayEvents.map(scheduleCard).join(''):'<p class="dash-empty">Tidak ada pengajian terjadwal hari ini.</p>';
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
      const list=await pageAll('marsela_events','id,title,event_date,notes,is_open,jenis_pengajian,include_mudamudi',q=>q.gte('event_date',first).lte('event_date',last).order('event_date',{ascending:true}).order('id',{ascending:true}));
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
      $('chart-bars').innerHTML=details.length?'<div class="chart-legend"><span class="chart-legend-item"><i class="chart-legend-dot" aria-hidden="true"></i>Hadir</span><span class="chart-legend-item"><i class="chart-legend-dot remaining" aria-hidden="true"></i>Sisa kesempatan hadir</span></div>'+details.map(d=>{
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
