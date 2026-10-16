/* Marsela Tahap 9B — sesi QR dengan token acak, expiry, dan validasi Edge Function. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const config = window.MARSeLA_CONFIG || {};
  let currentUrl = '', currentEventId = '', currentSessionId = '', currentAdminPin = '';
  let previousFocus = null;

  function endpoint() {
    if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error('Konfigurasi Supabase belum tersedia.');
    return `${config.supabaseUrl.replace(/\/$/, '')}/functions/v1/marsela-qr`;
  }
  async function callFunction(payload) {
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': config.supabaseAnonKey, 'Authorization': `Bearer ${config.supabaseAnonKey}` },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || `Permintaan QR gagal (${response.status}).`);
    return data;
  }
  function setMessage(text, isError=false) {
    const el = $('marsela-qr-message');
    el.textContent = text;
    el.dataset.state = isError ? 'error' : 'success';
  }
  function makeSessionUrl(eventId, token) {
    const url = new URL(window.location.href);
    url.searchParams.delete('presensiToken');
    url.searchParams.set('presensiEvent', String(eventId));
    url.searchParams.set('presensiToken', token);
    url.hash = 'presensi-section';
    return url.toString();
  }
  function renderQr(url) {
    const box = $('marsela-qr-code');
    box.innerHTML = '';
    if (!window.QRCode) throw new Error('Pustaka QR tidak termuat. Periksa koneksi atau CDN QRCode.');
    new window.QRCode(box, { text: url, width: 220, height: 220, colorDark: '#10283B', colorLight: '#FFFFFF', correctLevel: window.QRCode.CorrectLevel.M });
  }
  function openModal(button) {
    const modal = $('marsela-qr-modal');
    currentEventId = String(button.dataset.eventId || '');
    currentSessionId = ''; currentUrl = ''; currentAdminPin = '';
    previousFocus = document.activeElement;
    $('marsela-qr-event-name').textContent = button.dataset.eventTitle || 'Kegiatan Pengajian';
    $('marsela-qr-admin-controls').hidden = false;
    $('marsela-qr-session-view').hidden = true;
    $('marsela-qr-admin-pin').value = '';
    $('marsela-qr-code').innerHTML = '';
    $('marsela-qr-expiry').textContent = '';
    $('marsela-qr-create-session').disabled = false;
    $('marsela-qr-close-session').disabled = false;
    setMessage('Masukkan PIN pengurus untuk mengaktifkan sesi QR.');
    modal.hidden = false;
    document.body.classList.add('marsela-qr-open-state');
    $('marsela-qr-admin-pin').focus();
  }
  function closeModal() {
    const modal = $('marsela-qr-modal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('marsela-qr-open-state');
    currentAdminPin = '';
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
  }
  async function createSession() {
    const button = $('marsela-qr-create-session');
    const pin = $('marsela-qr-admin-pin').value;
    if (!pin) { setMessage('PIN pengurus wajib diisi.', true); $('marsela-qr-admin-pin').focus(); return; }
    button.disabled = true;
    try {
      setMessage('Memvalidasi pengurus dan membuat sesi QR…');
      const result = await callFunction({ action: 'create', eventId: currentEventId, adminPin: pin });
      currentAdminPin = pin;
      currentSessionId = result.sessionId;
      currentUrl = makeSessionUrl(result.eventId, result.token);
      renderQr(currentUrl);
      $('marsela-qr-admin-controls').hidden = true;
      $('marsela-qr-session-view').hidden = false;
      const expiry = new Date(result.expiresAt);
      $('marsela-qr-expiry').textContent = `Sesi aktif sampai ${expiry.toLocaleTimeString('id-ID', {hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jakarta'})} WIB (maksimal 60 menit).`;
      setMessage('Sesi QR aktif. Bagikan QR hanya kepada peserta kegiatan.');
    } catch (error) {
      setMessage(error.message || 'Sesi QR gagal dibuat.', true);
    } finally { button.disabled = false; }
  }
  async function closeSession() {
    if (!currentSessionId || !currentAdminPin) return;
    const button = $('marsela-qr-close-session'); button.disabled = true;
    try {
      await callFunction({ action: 'close', sessionId: currentSessionId, adminPin: currentAdminPin });
      currentSessionId = ''; currentUrl = '';
      $('marsela-qr-session-view').hidden = true;
      $('marsela-qr-admin-controls').hidden = false;
      $('marsela-qr-admin-pin').value = '';
      currentAdminPin = '';
      setMessage('Sesi QR sudah ditutup. QR sebelumnya tidak dapat digunakan lagi.');
    } catch (error) {
      setMessage(error.message || 'Sesi QR belum berhasil ditutup.', true);
    } finally { button.disabled = false; }
  }
  async function copyLink() {
    try {
      if (!currentUrl) throw new Error('Buat sesi QR terlebih dahulu.');
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(currentUrl);
      else {
        const helper = document.createElement('textarea'); helper.value = currentUrl; helper.readOnly = true;
        helper.style.position = 'fixed'; helper.style.opacity = '0'; document.body.appendChild(helper); helper.select();
        const ok = document.execCommand('copy'); helper.remove(); if (!ok) throw new Error('Salin otomatis tidak tersedia.');
      }
      setMessage('Tautan sesi QR berhasil disalin.');
    } catch (error) { setMessage(error.message || 'Tautan belum dapat disalin.', true); }
  }
  function downloadQr() {
    const box = $('marsela-qr-code');
    const canvas = box.querySelector('canvas'); const image = box.querySelector('img');
    const data = canvas ? canvas.toDataURL('image/png') : image?.src;
    if (!data) { setMessage('QR belum tersedia untuk diunduh.', true); return; }
    const link = document.createElement('a'); link.href = data; link.download = 'marsela-qr-presensi.png';
    document.body.appendChild(link); link.click(); link.remove(); setMessage('Unduhan QR dimulai.');
  }
  document.addEventListener('click', event => {
    const trigger = event.target.closest('.marsela-qr-open');
    if (trigger) { openModal(trigger); return; }
    if (event.target.closest('#marsela-qr-close') || event.target.closest('[data-qr-close="true"]')) closeModal();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
  $('marsela-qr-create-session')?.addEventListener('click', createSession);
  $('marsela-qr-admin-pin')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); createSession(); } });
  $('marsela-qr-close-session')?.addEventListener('click', closeSession);
  $('marsela-qr-copy')?.addEventListener('click', copyLink);
  $('marsela-qr-download')?.addEventListener('click', downloadQr);
})();
