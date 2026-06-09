/* ====== GDO Reparto — Configuración ======
   Acá va la clave de Google Maps Platform. Mientras esté vacía, la app usa
   Georef (gob.ar) + OpenStreetMap como hasta ahora (gratis). Apenas pegues la
   clave entre las comillas, se activa Google como geocodificador principal
   (más preciso en Argentina) y queda Georef como respaldo.

   La clave es SEGURA en el código porque está restringida por dominio (HTTP
   referrer) en la consola de Google: solo funciona desde rutas.granjadeloeste.com
   y lista.granjadeloeste.com. */
window.GDO = window.GDO || {};
GDO.CONFIG = {
  // Pegá acá la clave de Google (Maps JavaScript API). Ej: 'AIzaSy...'
  googleKey: 'AIzaSyCPwMUNJjtukzrFC2C2saOV49HPESfr3Jk',
};

/* Carga la librería de Google Maps SOLO si hay clave. Expone:
   - GDO.Google.ready : Promesa que resuelve true (cargó) o false (sin clave/err)
   - GDO.Google.disponible : true cuando google.maps ya está listo para usarse */
(function () {
  GDO.Google = { ready: Promise.resolve(false), disponible: false };
  const key = (GDO.CONFIG.googleKey || '').trim();
  if (!key) return; // sin clave: seguimos con Georef/OSM, no se carga nada de Google
  GDO.Google.ready = new Promise(function (resolve) {
    // callback global que dispara el loader de Google al terminar de cargar
    window.__gdoGmapsReady = function () { GDO.Google.disponible = true; resolve(true); };
    const s = document.createElement('script');
    s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) +
      '&libraries=geometry&loading=async&callback=__gdoGmapsReady';
    s.async = true; s.defer = true;
    s.onerror = function () { resolve(false); }; // si falla, la app usa Georef
    document.head.appendChild(s);
  });
})();
