/* ====== GDO Reparto — conexión Firebase (app interna) ======
   Inicializa Firebase (Firestore + Auth) usando el SDK "compat" cargado por
   <script> (sin paso de compilación).

   SEGURIDAD: la app interna (rutas) NO se loguea sola de forma anónima. El
   personal entra con email + contraseña reales (Firebase Auth). Recién ahí
   la app puede leer/escribir Firestore, porque las reglas exigen una sesión
   de personal (no anónima). El login anónimo queda SOLO para la tienda y el
   seguimiento de clientes (que tienen su propio init en sus páginas).

   Si el SDK no carga (sin internet en el primer arranque), la app cae a modo
   local con localStorage: GDO.FB.enabled = false y nadie se rompe. */
window.GDO = window.GDO || {};
(function () {
  const cfg = {
    apiKey: 'AIzaSyDljWSSEDrZylMxgYCPaqaqU2x-3QYvZaM',
    authDomain: 'ruteogdo.firebaseapp.com',
    projectId: 'ruteogdo',
    storageBucket: 'ruteogdo.firebasestorage.app',
    messagingSenderId: '507253098011',
    appId: '1:507253098011:web:785699004cd41dfe1f9abe',
    measurementId: 'G-MVREZXZXHF',
  };

  const FB = { enabled: false, app: null, db: null, auth: null, uid: null, user: null, cfg };
  GDO.FB = FB;

  // FB.ready resuelve cuando el SDK quedó listo (true) o no (false → modo local).
  let _resolve;
  FB.ready = new Promise((r) => { _resolve = r; });
  const finish = (en) => { FB.enabled = en; if (_resolve) { _resolve(en); _resolve = null; } };

  if (typeof firebase === 'undefined' || !firebase.initializeApp) {
    console.warn('[GDO] SDK de Firebase no disponible — funcionando en modo local.');
    finish(false);
    return;
  }

  try {
    FB.app = firebase.initializeApp(cfg);
    // App Check (reCAPTCHA v3 invisible): certifica que las llamadas a Firestore/
    // Auth vienen de nuestra app real, no de un bot/otro sitio. Por ahora SIN
    // bloqueo (enforcement apagado en Firebase): no afecta nada; protege cuando
    // se active. Si el SDK de App Check no cargó, el try lo ignora.
    try { if (firebase.appCheck) firebase.appCheck().activate('6LcFdCctAAAAAELE8bLAVjrYLFgVFHH_JO0oKOxw', true); } catch (e) {}
    FB.db = firebase.firestore();
    FB.auth = firebase.auth();
    // SESIÓN POR PESTAÑA: la sesión del personal se CIERRA al cerrar la app/pestaña
    // (antes sobrevivía). Así el próximo que entra —sobre todo el chofer— NO queda
    // con la sesión del usuario anterior. Sobrevive recargas, NO el cierre.
    try { FB.auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(function () {}); } catch (e) {}
    // Persistencia local (IndexedDB): la cache sobrevive recargas y cortes de red.
    try { FB.db.enablePersistence({ synchronizeTabs: true }).catch(function () {}); } catch (e) {}
  } catch (e) {
    console.warn('[GDO] No se pudo iniciar Firebase — modo local.', e);
    finish(false);
    return;
  }

  // ----- estado de sesión del personal -----
  // Otros módulos (data.js) se suscriben con FB.onAuth(cb). El cb recibe el
  // usuario de Firebase si hay personal logueado, o null si no hay sesión.
  // El login anónimo (que la app interna no usa) se trata como "sin sesión".
  const authCbs = [];
  let authSettled = false;
  FB.onAuth = function (cb) {
    authCbs.push(cb);
    if (authSettled) { try { cb(FB.user); } catch (e) {} }
  };

  FB.auth.onAuthStateChanged(function (user) {
    const staff = user && !user.isAnonymous ? user : null;
    FB.user = staff;
    FB.uid = staff ? staff.uid : null;
    authSettled = true;
    authCbs.forEach(function (cb) { try { cb(staff); } catch (e) {} });
  });

  // Login del personal: lo valida el servidor de Firebase Auth. Devuelve una
  // promesa que resuelve con el credential o rechaza (clave/email incorrectos).
  FB.login = function (email, pass) {
    return FB.auth.signInWithEmailAndPassword(String(email || '').trim(), String(pass || ''));
  };
  FB.logout = function () { return FB.auth.signOut(); };

  finish(true);
})();
