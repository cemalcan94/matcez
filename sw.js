// Matcez service worker — v8
// Strateji: ÖNCE AĞ, çevrimdışıysa önbellek. (Önceki "önce önbellek" stratejisi,
// güncellemelerde eski JS + yeni HTML karışmasına yol açıyordu — bir daha olmayacak.)
// Uygulama küçük olduğu için ağ-öncelikli yaklaşım hem hızlı hem her zaman tutarlıdır;
// önbellek yalnızca çevrimdışı açılış içindir. API istekleri (Supabase) hiç dokunulmaz.
const VERSION = 'matcez-v10';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './manifest.webmanifest',
  './js/config.js', './js/seed-data.js', './js/jersey.js', './js/points.js',
  './js/store.js', './js/views.js', './js/squad.js', './js/admin.js', './js/app.js',
  './assets/logo/icon-192.png', './assets/logo/icon-512.png',
  './assets/promo/haftalik-odul.webp',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL))
      .catch(() => {})           // tek bir dosya inmese bile kurulum engellenmesin
      .then(() => self.skipWaiting())
  );
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
  // Yalnızca kendi origin'imizdeki GET istekleri; Supabase vb. dokunma
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return resp;
      })
      .catch(() => caches.match(e.request).then((hit) => hit ?? caches.match('./')))
  );
});
