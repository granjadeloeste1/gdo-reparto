/* ====== GDO Reparto — Service Worker ======
   Estrategia "red primero, cae a caché": cuando hay internet siempre trae lo
   último (así los cambios publicados aparecen al toque), y si no hay señal usa
   lo guardado. Solo cachea archivos del propio sitio; CDNs/Firebase pasan
   directo (necesitan red). Subí CACHE de versión cuando quieras forzar limpieza. */
const CACHE = 'gdo-reparto-v16';
const CORE = [
  './',
  'index.html',
  'css/styles.css',
  'js/firebase.js', 'js/data.js', 'js/notify.js', 'js/ui.js',
  'js/route.js', 'js/geo.js', 'js/app.js',
  'js/views/login.js', 'js/views/admin.js', 'js/views/rutas.js', 'js/views/repartidor.js',
  'assets/logo-horizontal-color.svg', 'assets/logo-horizontal-blanco.svg',
  'assets/isotipo-color.svg', 'assets/icon-app.svg',
  'manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // CDNs / Firebase: directo a la red
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
  );
});
