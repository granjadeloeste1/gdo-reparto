/* ====== GDO Reparto — Service Worker ======
   Estrategia "red primero, cae a caché": cuando hay internet siempre trae lo
   último (así los cambios publicados aparecen al toque), y si no hay señal usa
   lo guardado. Solo cachea archivos del propio sitio; CDNs/Firebase pasan
   directo (necesitan red). Subí CACHE de versión cuando quieras forzar limpieza. */
const CACHE = 'gdo-reparto-v93';
const CORE = [
  './',
  'index.html',
  'css/styles.css',
  'js/config.js',
  'js/firebase.js', 'js/data.js', 'js/notify.js', 'js/ui.js',
  'js/route.js', 'js/geo.js', 'js/extras.js', 'js/app.js',
  'js/views/login.js', 'js/views/admin.js', 'js/views/rutas.js', 'js/views/repartidor.js', 'js/views/club.js',
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
  // 'reload' saltea la caché HTTP del navegador: así, con internet, SIEMPRE
  // bajamos la última versión publicada (GitHub Pages cachea los archivos un
  // rato y, sin esto, el navegador reusaba versiones viejas). Si no hay red,
  // caemos a lo guardado en caché.
  e.respondWith(
    fetch(req, { cache: 'reload' }).then((res) => {
      // Solo cacheamos respuestas OK: un 404/redirección no debe quedar guardado
      // y servirse offline como si fuera la página buena.
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
  );
});
