/* ====== GDO Reparto — almacén de datos (prototipo) ======
   Persistencia local con localStorage. En la versión final esto se reemplaza
   por Firebase (Auth + Firestore en tiempo real). La API pública (Store.*) se
   mantiene igual para que el cambio sea transparente. */
window.GDO = window.GDO || {};

(function () {
  const KEY = 'gdo_reparto_db_v5';
  const INBOX = 'gdo_reparto_inbox'; // cola de pedidos entrantes desde la tienda online
  const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 9);

  // ----- puente con Firestore (datos compartidos entre dispositivos) -----
  // Si Firebase está activo escribimos cada cambio a Firestore; los listeners
  // (onSnapshot) traen de vuelta los cambios de otros dispositivos y mantienen
  // la cache en memoria. Si no, todo queda en localStorage (modo local).
  const FS_COLLS = ['users', 'vehiculos', 'pedidos', 'rutas', 'notificaciones'];
  const fsOn = () => GDO.FB && GDO.FB.enabled && GDO.FB.db;
  const fsClean = (o) => JSON.parse(JSON.stringify(o)); // saca undefined/funciones
  function fsSet(coll, obj) {
    if (!fsOn() || !obj || !obj.id) return;
    try { GDO.FB.db.collection(coll).doc(obj.id).set(fsClean(obj)); } catch (e) {}
  }
  function fsDel(coll, id) {
    if (!fsOn() || !id) return;
    try { GDO.FB.db.collection(coll).doc(id).delete(); } catch (e) {}
  }

  // Depósito fijo (editable por ruta): Acuña 1334, Villa Tesei.
  // Coordenadas sobre la calle Acuña en Villa Tesei (partido de Hurlingham).
  const DEPOT = { nombre: 'Depósito GDO — Acuña 1334, Villa Tesei', lat: -34.629221, lng: -58.629581 };

  function seed() {
    const admin = { id: 'u_admin', nombre: 'Administración GDO', email: 'admin@gdo.com', pass: '1234', roles: ['admin', 'vendedor'], activo: true };
    const vende = { id: 'u_vende', nombre: 'Lucía Vendedora', email: 'ventas@gdo.com', pass: '1234', roles: ['vendedor'], activo: true };
    const chof1 = { id: 'u_chof1', nombre: 'Carlos Chofer', email: 'carlos@gdo.com', pass: '1234', roles: ['repartidor'], activo: true };
    const chof2 = { id: 'u_chof2', nombre: 'Diego Reparto', email: 'diego@gdo.com', pass: '1234', roles: ['vendedor', 'repartidor'], activo: true };

    const veh = [
      { id: 'v1', nombre: 'Camioneta Blanca', patente: 'AB123CD', tipo: 'Utilitario refrigerado' },
      { id: 'v2', nombre: 'Furgón Naranja', patente: 'AE456FG', tipo: 'Furgón' },
    ];

    const hoy = new Date().toISOString().slice(0, 10);
    const cliente = (cliente, direccion, entrecalles, lat, lng, items, espec, prioridad, creadoPor) => ({
      id: uid('p'), cliente, direccion, entrecalles, lat, lng, items, fechaEntrega: '',
      especificaciones: espec, prioridad: prioridad || 'normal',
      estado: 'pendiente', creadoPor, rutaId: null, ventana: '', telefono: '',
      historia: [],
    });

    // Clientes reales de Hurlingham / Villa Tesei. Coordenadas exactas tomadas
    // de OpenStreetMap (POI del comercio), no del centro de la calle: así la
    // navegación cae sobre la puerta del local y no en una cuadra equivocada.
    const pedidos = [
      cliente('Granja 2 Cuñados', 'Av. Pres. Juan D. Perón 6871, Villa Udaondo, Ituzaingó', '',
        -34.631949, -58.660134, [{ producto: 'Pollo entero', cantidad: 40 }, { producto: 'Pata muslo (cajón)', cantidad: 6 }, { producto: 'Alas (cajón)', cantidad: 4 }],
        'Pollería/carnicería. Recibe el encargado, dejar en cámara del fondo.', 'alta', vende.id),
      cliente('ZAR Burguers', 'Av. Julio A. Roca 875, Hurlingham', '',
        -34.591977, -58.624285, [{ producto: 'Suprema (cajón)', cantidad: 8 }, { producto: 'Pollo entero', cantidad: 15 }],
        'Hamburguesería. Entregar antes de las 11hs (abren al mediodía).', 'normal', vende.id),
      cliente('Panadería Buenas Migas', 'Gral. Alfredo Rodríguez 1947, Hurlingham', '',
        -34.603476, -58.628488, [{ producto: 'Huevos (maple x12)', cantidad: 25 }],
        'Recibe Marta en el mostrador.', 'normal', admin.id),
      cliente('Supermercado Gaboto', 'Sebastián Gaboto 360, Hurlingham', '',
        -34.601089, -58.625911, [{ producto: 'Pollo entero', cantidad: 30 }, { producto: 'Huevos (maple x12)', cantidad: 20 }, { producto: 'Suprema (cajón)', cantidad: 5 }],
        'Descarga por portón lateral. Firmar remito.', 'alta', vende.id),
      cliente('Café Martínez', 'Av. Arturo Jauretche 953, Hurlingham', '',
        -34.588386, -58.631443, [{ producto: 'Huevos (maple x12)', cantidad: 10 }],
        '', 'baja', vende.id),
      cliente('Supermercado La Amistad', 'Germán Argerich 1507, Hurlingham', '',
        -34.587717, -58.642523, [{ producto: 'Pollo entero', cantidad: 25 }, { producto: 'Pata muslo (cajón)', cantidad: 4 }, { producto: 'Huevos (maple x12)', cantidad: 15 }],
        'Cliente preferencial.', 'alta', admin.id),
      cliente('Parrilla Los Pinos', 'Av. Arturo Jauretche 947, Hurlingham', '',
        -34.588251, -58.631171, [{ producto: 'Pollo entero', cantidad: 20 }, { producto: 'Alas (cajón)', cantidad: 5 }],
        'Calle angosta, demora habitual en la descarga.', 'normal', admin.id),
      cliente('Panadería JR', 'Gral. F. Miranda 1782, Hurlingham', '',
        -34.598892, -58.631191, [{ producto: 'Huevos (maple x12)', cantidad: 12 }],
        '', 'baja', vende.id),
      cliente('Supermercado Rosana', 'Gral. Miguel de Azcuénaga 770, Morón', '',
        -34.642770, -58.622124, [{ producto: 'Pollo entero', cantidad: 25 }, { producto: 'Suprema (cajón)', cantidad: 6 }, { producto: 'Huevos (maple x12)', cantidad: 18 }],
        'Entregar en cocina, fondo del pasillo.', 'normal', admin.id),
      cliente('Havanna', 'Av. Santa Rosa 1502, Ituzaingó', '',
        -34.642682, -58.656712, [{ producto: 'Huevos (maple x12)', cantidad: 8 }],
        '', 'baja', vende.id),
      cliente('Pizzería Don Muñiz', 'Eduardo Muñiz 58, Ituzaingó', '',
        -34.642503, -58.657394, [{ producto: 'Suprema (cajón)', cantidad: 5 }, { producto: 'Pollo entero', cantidad: 15 }],
        'Cobrar en efectivo.', 'normal', vende.id),
    ];

    // Dos rutas de ejemplo ya armadas y asignadas a los choferes, para que la
    // app se vea “en uso” al abrirla. Carlos toma la zona Hurlingham centro;
    // Diego la zona Villa Tesei. Dejamos algún pedido sin asignar (pendiente)
    // para poder mostrar el armado de una ruta nueva.
    const ruta = (nombre, repartidorId, vehiculoId, idxs, creadaPor) => {
      const ids = idxs.map((i) => pedidos[i].id);
      ids.forEach((id) => { const p = pedidos.find((x) => x.id === id); p.estado = 'asignado'; p.fechaEntrega = hoy; });
      const r = {
        id: uid('r'), nombre, fecha: hoy, repartidorId, vehiculoId,
        origen: { ...DEPOT }, destino: { ...DEPOT }, sameAsOrigin: true,
        pedidoIds: ids, orden: ids.slice(), estado: 'asignada',
        demoraDefaultMin: 10, salidaMin: 8 * 60, demoraPorId: {}, progreso: {},
        creadaPor,
      };
      ids.forEach((id) => { const p = pedidos.find((x) => x.id === id); p.rutaId = r.id; });
      return r;
    };

    const rutas = [
      ruta('Reparto Hurlingham centro', chof1.id, veh[0].id, [1, 3, 6, 4, 7, 2], admin.id),
      ruta('Reparto zona sur (Ituzaingó / Morón)', chof2.id, veh[1].id, [0, 8, 10, 9], admin.id),
    ];

    return {
      users: [admin, vende, chof1, chof2],
      vehiculos: veh,
      pedidos,
      rutas,
      notificaciones: [],
      depot: DEPOT,
      session: null,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        // El depósito es fijo: lo re-sincronizamos con la constante para que las
        // correcciones de coordenadas lleguen a bases ya guardadas en localStorage.
        d.depot = DEPOT;
        return d;
      }
    } catch (e) {}
    const db = seed();
    persist(db);
    return db;
  }
  function persist(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }

  // Vuelca los pedidos cargados por la tienda online (cola INBOX) hacia la
  // base de la app. Devuelve true si entró algún pedido nuevo. En producción
  // esto lo hace un listener de Firestore sobre la colección de pedidos.
  function drainInbox(d) {
    let inbox = [];
    try { inbox = JSON.parse(localStorage.getItem(INBOX) || '[]'); } catch (e) { inbox = []; }
    if (!Array.isArray(inbox) || !inbox.length) return false;
    let changed = false;
    inbox.forEach((o) => {
      if (!o || !o.id || d.pedidos.some((p) => p.id === o.id)) return;
      const nuevo = {
        id: o.id, cliente: o.cliente || 'Cliente', direccion: o.direccion || '',
        entrecalles: o.entrecalles || '', lat: o.lat == null ? null : o.lat,
        lng: o.lng == null ? null : o.lng, items: Array.isArray(o.items) ? o.items : [],
        fechaEntrega: o.fechaEntrega || '',
        especificaciones: o.especificaciones || '', prioridad: o.prioridad || 'normal',
        estado: 'pendiente', creadoPor: o.creadoPor || null, rutaId: null,
        ventana: o.ventana || '', telefono: o.telefono || '', origen: 'tienda', historia: [],
      };
      d.pedidos.push(nuevo);
      fsSet('pedidos', nuevo);
      changed = true;
      d.users.filter((u) => u.roles.includes('admin')).forEach((a) => {
        const n = { id: uid('n'), paraUserId: a.id, leida: false, ts: Date.now(),
          mensaje: '🛒 Nuevo pedido de la tienda online: ' + (o.cliente || 'cliente') + ' — falta asignar chofer' };
        d.notificaciones.push(n); fsSet('notificaciones', n);
      });
    });
    try { localStorage.setItem(INBOX, '[]'); } catch (e) {}
    return changed;
  }

  // Re-render en vivo cuando llegan cambios de otro dispositivo. Se posterga un
  // instante (para agrupar ráfagas) y no interrumpe si hay un modal abierto.
  let _rt = null;
  function scheduleRender() {
    clearTimeout(_rt);
    _rt = setTimeout(() => { if (GDO._dataChanged) GDO._dataChanged(); }, 180);
  }

  // Siembra inicial idempotente: si la base de Firestore está vacía, una sola
  // vez (transacción con candado en meta/init) carga los datos de ejemplo.
  function seedFirestore() {
    const fdb = GDO.FB.db;
    const initRef = fdb.collection('meta').doc('init');
    return fdb.runTransaction((tx) => tx.get(initRef).then((doc) => {
      if (doc.exists) return false;
      const s = seed();
      tx.set(initRef, { seededAt: Date.now() });
      FS_COLLS.forEach((c) => (s[c] || []).forEach((o) => tx.set(fdb.collection(c).doc(o.id), fsClean(o))));
      return true;
    })).catch((e) => { console.warn('[GDO] seed Firestore', e && e.code); });
  }

  // Escucha las colecciones: cada snapshot reemplaza la cache en memoria, la
  // guarda en localStorage (cache offline) y dispara el re-render.
  function startSync() {
    seedFirestore().then(() => {
      FS_COLLS.forEach((c) => {
        GDO.FB.db.collection(c).onSnapshot((snap) => {
          db[c] = snap.docs.map((d) => Object.assign({}, d.data(), { id: d.id }));
          persist(db);
          scheduleRender();
        }, (err) => console.warn('[GDO] onSnapshot ' + c, err && err.code));
      });
    });
  }

  let db = load();
  if (drainInbox(db)) persist(db);

  const Store = {
    DEPOT,
    raw: () => db,
    reset() { db = seed(); persist(db); },
    save() { persist(db); },
    // Trae pedidos nuevos de la tienda online; true si entró alguno.
    sync() { if (drainInbox(db)) { persist(db); return true; } return false; },

    // ----- sesión -----
    login(email, pass) {
      const u = db.users.find((x) => x.email.toLowerCase() === String(email).toLowerCase() && x.pass === pass && x.activo);
      if (u) { db.session = { userId: u.id, rolActivo: u.roles[0] }; persist(db); }
      return u || null;
    },
    loginAs(userId) {
      const u = db.users.find((x) => x.id === userId);
      if (u) { db.session = { userId: u.id, rolActivo: u.roles[0] }; persist(db); }
      return u || null;
    },
    logout() { db.session = null; persist(db); },
    current() { return db.session ? db.users.find((u) => u.id === db.session.userId) : null; },
    setRolActivo(r) { if (db.session) { db.session.rolActivo = r; persist(db); } },
    rolActivo() { return db.session ? db.session.rolActivo : null; },

    // ----- usuarios -----
    users: () => db.users,
    user: (id) => db.users.find((u) => u.id === id),
    upsertUser(u) {
      let full;
      if (u.id) { full = Object.assign(db.users.find((x) => x.id === u.id), u); }
      else { u.id = uid('u'); u.activo = true; db.users.push(u); full = u; }
      persist(db); fsSet('users', full); return u;
    },
    deleteUser(id) { db.users = db.users.filter((u) => u.id !== id); persist(db); fsDel('users', id); },
    admins: () => db.users.filter((u) => u.roles.includes('admin')),

    // ----- vehículos -----
    vehiculos: () => db.vehiculos,
    upsertVehiculo(v) {
      let full;
      if (v.id) full = Object.assign(db.vehiculos.find((x) => x.id === v.id), v);
      else { v.id = uid('v'); db.vehiculos.push(v); full = v; }
      persist(db); fsSet('vehiculos', full); return v;
    },
    deleteVehiculo(id) { db.vehiculos = db.vehiculos.filter((v) => v.id !== id); persist(db); fsDel('vehiculos', id); },

    // ----- pedidos -----
    pedidos: () => db.pedidos,
    pedido: (id) => db.pedidos.find((p) => p.id === id),
    upsertPedido(p) {
      let full;
      if (p.id) { full = Object.assign(db.pedidos.find((x) => x.id === p.id), p); }
      else { p.id = uid('p'); p.estado = p.estado || 'pendiente'; p.historia = []; db.pedidos.push(p); full = p; }
      persist(db); fsSet('pedidos', full); return p;
    },
    deletePedido(id) { db.pedidos = db.pedidos.filter((p) => p.id !== id); persist(db); fsDel('pedidos', id); },
    pedidosPendientes: () => db.pedidos.filter((p) => p.estado === 'pendiente'),

    // ----- rutas -----
    rutas: () => db.rutas,
    ruta: (id) => db.rutas.find((r) => r.id === id),
    upsertRuta(r) {
      let full;
      if (r.id) { full = Object.assign(db.rutas.find((x) => x.id === r.id), r); }
      else { r.id = uid('r'); db.rutas.push(r); full = r; }
      persist(db); fsSet('rutas', full); return r;
    },
    deleteRuta(id) {
      const r = db.rutas.find((x) => x.id === id);
      if (r) r.pedidoIds.forEach((pid) => { const p = Store.pedido(pid); if (p) { p.estado = 'pendiente'; p.rutaId = null; fsSet('pedidos', p); } });
      db.rutas = db.rutas.filter((x) => x.id !== id); persist(db); fsDel('rutas', id);
    },
    rutasDe: (userId) => db.rutas.filter((r) => r.repartidorId === userId),

    // ----- notificaciones -----
    notif: () => db.notificaciones,
    notifDe: (userId) => db.notificaciones.filter((n) => n.paraUserId === userId).sort((a, b) => b.ts - a.ts),
    noLeidas: (userId) => db.notificaciones.filter((n) => n.paraUserId === userId && !n.leida).length,
    pushNotif(paraUserId, mensaje, meta) {
      const n = { id: uid('n'), paraUserId, mensaje, leida: false, ts: Date.now(), ...(meta || {}) };
      db.notificaciones.push(n); persist(db); fsSet('notificaciones', n);
    },
    marcarLeidas(userId) {
      db.notificaciones.forEach((n) => { if (n.paraUserId === userId && !n.leida) { n.leida = true; fsSet('notificaciones', n); } });
      persist(db);
    },

    // ----- depósito -----
    depot: () => db.depot,
  };

  GDO.Store = Store;

  // Cuando Firebase esté listo, arranca la sincronización en tiempo real.
  if (GDO.FB && GDO.FB.ready) GDO.FB.ready.then((enabled) => { if (enabled) startSync(); });
})();
