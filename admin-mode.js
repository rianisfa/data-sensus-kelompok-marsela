/* MARSELA — sesi pengurus berbasis token Supabase, tanpa timeout otomatis. */
(()=>{'use strict';
const KEY='marsela_admin_token_v2';
const $=id=>document.getElementById(id);
let token='';let validated=false;
try{token=localStorage.getItem(KEY)||'';}catch{}
const allowed=()=>validated&&!!token;
window.marselaIsAdmin=allowed;
window.marselaAdminToken=()=>allowed()?token:'';
const privateSections=new Set(['laporan-section']);
function sync(){
 const active=allowed();
 const menu=$('marsela-admin-menu-items');if(menu)menu.hidden=!active;
 const entry=$('marsela-admin-entry');if(entry){entry.title=active?'Keluar Mode Pengurus':'Masuk Mode Pengurus';entry.setAttribute('aria-label',entry.title);}
 const manage=$('marsela-manage-open');if(manage)manage.hidden=!active;
 const manual=$('attendance-mode')?.querySelector('option[value="manual"]');
 if(manual){manual.hidden=!active;manual.disabled=!active;}
 if(!active&&$('attendance-mode')?.value==='manual'){$('attendance-mode').value='self';$('attendance-mode').dispatchEvent(new Event('change'));}
 if(!active&&privateSections.has([...document.querySelectorAll('.dash-section,.utility-section')].find(s=>!s.hidden)?.id))window.showMarselaSection?.('beranda-section');
}
window.marselaSyncAdminUI=sync;
window.marselaAdminGuard=id=>!privateSections.has(id)||allowed();
function clear(){token='';validated=false;try{localStorage.removeItem(KEY);}catch{}sync();}
function cfg(){const c=window.MARSeLA_CONFIG||{};if(!/^https:\/\/.+\.supabase\.co$/.test(c.supabaseUrl||'')||!c.supabaseAnonKey)throw Error('Konfigurasi Supabase tidak tersedia.');return c;}
async function request(action,params={}){
 const c=cfg();const res=await fetch(`${c.supabaseUrl.replace(/\/$/,'')}/functions/v1/marsela-qr`,{method:'POST',headers:{'Content-Type':'application/json','apikey':c.supabaseAnonKey,'Authorization':`Bearer ${c.supabaseAnonKey}`},body:JSON.stringify({action,...params})});
 const result=await res.json().catch(()=>({}));if(!res.ok||!result.ok)throw Error(result.error||`Permintaan gagal (HTTP ${res.status}).`);return result;
}
function close(){$('marsela-admin-dialog').hidden=true;$('marsela-admin-pin').value='';$('marsela-admin-status').textContent='';}
function open(){sync();$('marsela-admin-dialog').hidden=false;$('marsela-admin-form').hidden=allowed();$('marsela-admin-logout-view').hidden=!allowed();if(!allowed())$('marsela-admin-pin').focus();}
async function restore(){if(!token){sync();return;}try{await request('admin_check',{adminToken:token});validated=true;}catch{clear();}sync();}
document.addEventListener('DOMContentLoaded',()=>{
 $('marsela-admin-entry').addEventListener('click',open);
 $('marsela-admin-cancel').addEventListener('click',close);
 $('marsela-admin-logout').addEventListener('click',async()=>{
  const old=token;clear();close();window.showMarselaSection?.('beranda-section');
  if(old){try{await request('admin_logout',{adminToken:old});}catch(e){console.warn('Pencabutan token di server gagal; periksa koneksi dan login ulang untuk mencabut sesi lain.',e);}}
 });
 $('marsela-admin-form').addEventListener('submit',async e=>{
  e.preventDefault();const btn=$('marsela-admin-submit');const status=$('marsela-admin-status');const pin=$('marsela-admin-pin').value;
  if(pin.length<20){status.textContent='PIN minimal 20 digit.';return;}
  btn.disabled=true;status.textContent='Memverifikasi PIN…';
  try{const result=await request('admin_login',{adminPin:pin});if(!/^[A-Za-z0-9_-]{43}$/.test(result.adminToken||''))throw Error('Token sesi tidak valid.');
   token=result.adminToken;validated=true;try{localStorage.setItem(KEY,token);}catch{}close();sync();
  }catch(err){status.textContent=err.message||'Gagal masuk Mode Pengurus.';}
  finally{btn.disabled=false;$('marsela-admin-pin').value='';}
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('marsela-admin-dialog').hidden)close();});
 document.addEventListener('click',e=>{if(e.target===$('marsela-admin-dialog'))close();});
 sync();restore();
});
})();
