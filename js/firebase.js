/* ====== GDO Reparto — conexión Firebase ======
   Inicializa Firebase (Firestore + Auth) usando el SDK "compat" cargado por
   <script> (sin paso de compilación). Hace login anónimo como puerta de
   seguridad para las reglas de Firestore. Si algo falla (sin internet, SDK no
   cargó, auth deshabilitada), la app sigue funcionando en modo local con
   localStorage: GDO.FB.enabled queda en false y nadie se rompe. */
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

  const FB = { enabled: false, app: null, db: null, auth: null, uid: null, cfg };
  GDO.FB = FB;

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
    FB.db = firebase.firestore();
    FB.auth = firebase.auth();
  } catch (e) {
    console.warn('[GDO] No se pudo iniciar Firebase — modo local.', e);
    finish(false);
    return;
  }

  let settled = false;
  const settle = (en) => { if (settled) return; settled = true; finish(en); };

  // Login anónimo: da request.auth != null para las reglas de Firestore sin
  // pedirle nada al usuario. Si la consola no lo tiene habilitado, igual
  // intentamos Firestore (sirve mientras las reglas estén en modo prueba).
  FB.auth.onAuthStateChanged((user) => {
    if (user) FB.uid = user.uid;
    settle(true);
  });
  FB.auth.signInAnonymously().catch((e) => {
    console.warn('[GDO] Auth anónima no disponible (¿habilitada en la consola?). Intento Firestore igual.', e && e.code);
    settle(true);
  });

  // Red de seguridad: si nada respondió (offline), seguimos en modo local.
  setTimeout(() => settle(false), 5000);
})();
