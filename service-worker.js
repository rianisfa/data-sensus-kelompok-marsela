
/*
 * MARSELA PWA Service Worker
 * Versi awal: online-first dan aman untuk data presensi.
 */

const CACHE_NAME = "marsela-pwa-v1";

const STATIC_ASSETS = [
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png"
];

// Instalasi service worker
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );

  self.skipWaiting();
});

// Hapus cache versi lama
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) =>
            name.startsWith("marsela-pwa-") &&
            name !== CACHE_NAME
          )
          .map((name) => caches.delete(name))
      )
    )
  );

  self.clients.claim();
});

// Permintaan data dan halaman tetap melalui jaringan.
// Hanya ikon statis yang menggunakan cache.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        return cached || fetch(request);
      })
    );
  }
});
