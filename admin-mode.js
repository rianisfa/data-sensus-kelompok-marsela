/* Mode Pengurus MARSELA: hanya sesi tampilan sementara; bukan token otorisasi. */
(()=>{'use strict';
let expires=0;
const $=id=>document.getElementById(id);
const allowed=()=>Date.now()<expires;
window.marselaIsAdmin=allowed;
const privateSections=new Set(['laporan-section']);
function sync(){
  const active=allowed();
  $('marsela-admin-menu-items').hidden=!active;
  const entry=$('marsela-admin-entry');
  entry.title=active?'Keluar Mode Pengurus':'Masuk Mode Pengurus';
  entry.setAttribute('aria-label',entry.title);
  const manage=$('marsela-manage-open');if(manage)manage.hidden=!active;
  const manual=$('attendance-mode')?.querySelector('option[value="manual"]');
  if(manual){manual.hidden=!active;manual.disabled=!active;}
  if(!active&&$('attendance-mode')?.value==='manual'){
    $('attendance-mode').value='self';$('attendance-mode').dispatchEvent(new Event('change'));
  }
  if(!active&&privateSections.has([...document.querySelectorAll('.dash-section,.utility-section')].find(s=>!s.hidden)?.id))window.showMarselaSection?.('beranda-section');
}
window.marselaSyncAdminUI=sync;
window.marselaAdminGuard=id=>!privateSections.has(id)||allowed();
function close(){$('marsela-admin-dialog').hidden=true;$('marsela-admin-pin').value='';$('marsela-admin-status').textContent='';}
function open(){sync();$('marsela-admin-dialog').hidden=false;$('marsela-admin-form').hidden=allowed();$('marsela-admin-logout-view').hidden=!allowed();if(!allowed())$('marsela-admin-pin').focus();}
document.addEventListener('DOMContentLoaded',()=>{
  $('marsela-admin-entry').addEventListener('click',open);
  $('marsela-admin-cancel').addEventListener('click',close);
  $('marsela-admin-logout').addEventListener('click',()=>{expires=0;close();sync();window.showMarselaSection?.('beranda-section');});
  $('marsela-admin-form').addEventListener('submit',async e=>{
    e.preventDefault();const btn=$('marsela-admin-submit');const status=$('marsela-admin-status');
    const pin=$('marsela-admin-pin').value;
    if(pin.length<20){status.textContent='PIN minimal 20 digit.';return;}
    btn.disabled=true;status.textContent='Memverifikasi PIN…';
    try{
      const cfg=window.MARSeLA_CONFIG||{};
      const response=await fetch(`${cfg.supabaseUrl.replace(/\/$/,'')}/functions/v1/marsela-qr`,{
        method:'POST',headers:{'Content-Type':'application/json','apikey':cfg.supabaseAnonKey,'Authorization':`Bearer ${cfg.supabaseAnonKey}`},
        body:JSON.stringify({action:'verify_admin',adminPin:pin})
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok||!result.ok)throw new Error(result.error||'Verifikasi gagal.');
      expires=Date.now()+15*60*1000;close();sync();
    }catch(err){status.textContent=err.message||'Gagal memverifikasi PIN.';}
    finally{btn.disabled=false;$('marsela-admin-pin').value='';}
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('marsela-admin-dialog').hidden)close();});
  document.addEventListener('click',e=>{if(e.target===$('marsela-admin-dialog'))close();});
  sync();setInterval(sync,30000);
});
})();
