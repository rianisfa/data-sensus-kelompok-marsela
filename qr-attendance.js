/* Marsela Tahap 9A — QR tautan kegiatan; sesi bertoken akan ditambahkan pada 9B. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let currentUrl = '';
  let previousFocus = null;

  function makeEventUrl(eventId) {
    const url = new URL(window.location.href);
    url.searchParams.set('presensiEvent', String(eventId));
    url.hash = 'presensi-section';
    return url.toString();
  }
  function openModal(button) {
    const modal = $('marsela-qr-modal');
    const box = $('marsela-qr-code');
    currentUrl = makeEventUrl(button.dataset.eventId);
    previousFocus = document.activeElement;
    $('marsela-qr-event-name').textContent = button.dataset.eventTitle || 'Kegiatan Pengajian';
    $('marsela-qr-message').textContent = '';
    box.innerHTML = '';
    if (window.QRCode) {
      new window.QRCode(box, {
        text: currentUrl,
        width: 220,
        height: 220,
        colorDark: '#10283B',
        colorLight: '#FFFFFF',
        correctLevel: window.QRCode.CorrectLevel.M
      });
    } else {
      box.innerHTML = '<p class="marsela-qr-fallback">QR tidak dapat dibuat karena pustaka QR belum termuat. Salin tautan untuk membagikannya.</p>';
    }
    modal.hidden = false;
    document.body.classList.add('marsela-qr-open-state');
    $('marsela-qr-close').focus();
  }
  function closeModal() {
    const modal = $('marsela-qr-modal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('marsela-qr-open-state');
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
  }
  async function copyLink() {
    const msg = $('marsela-qr-message');
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(currentUrl);
      } else {
        const helper = document.createElement('textarea');
        helper.value = currentUrl;
        helper.setAttribute('readonly', '');
        helper.style.position = 'fixed'; helper.style.opacity = '0';
        document.body.appendChild(helper); helper.select();
        const ok = document.execCommand('copy'); helper.remove();
        if (!ok) throw new Error('Salin otomatis tidak tersedia di browser ini.');
      }
      msg.textContent = 'Tautan QR berhasil disalin.';
    } catch (err) {
      msg.textContent = 'Tautan belum dapat disalin. Anda dapat menyalinnya dari alamat halaman setelah membuka tautan.';
      console.error('Marsela QR copy:', err);
    }
  }
  function downloadQr() {
    const box = $('marsela-qr-code');
    const canvas = box.querySelector('canvas');
    const image = box.querySelector('img');
    let data = '';
    if (canvas) data = canvas.toDataURL('image/png');
    else if (image && image.src) data = image.src;
    if (!data) {
      $('marsela-qr-message').textContent = 'QR belum tersedia untuk diunduh.';
      return;
    }
    const link = document.createElement('a');
    link.href = data; link.download = 'marsela-qr-presensi.png';
    document.body.appendChild(link); link.click(); link.remove();
    $('marsela-qr-message').textContent = 'Unduhan QR dimulai.';
  }
  document.addEventListener('click', event => {
    const trigger = event.target.closest('.marsela-qr-open');
    if (trigger) { openModal(trigger); return; }
    if (event.target.closest('#marsela-qr-close') || event.target.closest('[data-qr-close="true"]')) closeModal();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeModal();
  });
  $('marsela-qr-copy')?.addEventListener('click', copyLink);
  $('marsela-qr-download')?.addEventListener('click', downloadQr);
})();
