// Matcez service worker — uygulama kabuğunu önbelleğe alır (çevrimdışı açılış + hızlı yükleme).
// Strateji: navigasyon ve kabuk dosyaları için "stale-while-revalidate"
// (önce önbellekten göster, arka planda güncelle) — API istekleri (Supabase) hiç dokunulmaz.
const VERSION = 'matcez-v1';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './manifest.webmanifest',
  './js/config.js', './js/seed-data.js', './js/jersey.js', './js/points.js',
  './js/store.js', './js/views.js', './js/squad.js', './js/admin.js', './js/app.js',
  './assets/logo/icon-192.png', './assets/logo/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Yalnızca kendi origin'imizdeki GET istekleri; Supabase/Sofascore vb. dokunma
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fresh = fetch(e.request)
        .then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(VERSION).then((c) => c.put(e.request, copy));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
