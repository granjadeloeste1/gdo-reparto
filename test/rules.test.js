/* Pruebas de firestore.rules contra el emulador local de Firestore (no toca
   la base real: proyecto "demo-gdo", sin credenciales).
   Requiere Node y Java. Desde esta carpeta (test/):
     npm install
     npx -y firebase-tools@13 emulators:exec --only firestore --project demo-gdo "node rules.test.js"
   Cada caso dice qué se espera: los "NO …" / "se rechaza" son ataques que las
   reglas tienen que frenar; el resto son los flujos reales (tienda, club,
   juego, personal) que tienen que seguir andando. */
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');
firebase.firestore.setLogLevel('silent');
const FV = firebase.firestore.FieldValue;

const RULES = process.env.RULES || path.join(__dirname, '..', 'firestore.rules');
let env, ok = 0, mal = 0;
async function t(nombre, fn) {
  try { await fn(); ok++; console.log('  ✓ ' + nombre); }
  catch (e) { mal++; console.log('  ✗ ' + nombre + ' — ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}
const anon = (uid) => env.authenticatedContext(uid || 'anon1', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const user = (uid, email) => env.authenticatedContext(uid, email ? { email } : {}).firestore();
const nadie = () => env.unauthenticatedContext().firestore();

const PID = 'p_' + 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
function pedidoRetiro(id, extra) {
  return Object.assign({
    id, origen: 'tienda', cliente: 'Juan Pérez', telefono: '11 3580-0164', modalidad: 'retiro',
    direccion: '', localidad: '', entrecalles: '', lat: null, lng: null,
    items: [{ producto: 'Pollo entero', unidad: 'unidad', precio: 5000, nota: '', cantidad: 2, preparacion: '', kg: null }],
    fechaEntrega: '2026-11-05', diaEntrega: 'Jueves', ventana: '', especificaciones: 'x', formaPago: 'Efectivo',
    prioridad: 'normal', estado: 'pendiente', creadoPor: null, rutaId: null, clienteUid: null,
    totalEstimado: 10000, descuento: null, historia: [], creado: Date.now(), ts: Date.now(),
  }, extra || {});
}
let n = 0;
const nid = () => 'p_' + (1000000000000000 + (++n)).toString(36) + 'abcdefghijklmnop';

async function main() {
  env = await initializeTestEnvironment({ projectId: 'demo-gdo', firestore: { rules: fs.readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8080 } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await db.doc('Staff/admin1').set({ nombre: 'Matias' });                 // sin rol = admin
    await db.doc('Staff/caj1').set({ rol: 'cajero' });
    await db.doc('Staff/rep1').set({ rol: 'repartidor' });
    await db.doc('Staff/vend1').set({ rol: 'vendedor' });
    await db.doc('descuentos/VOLVE10').set({ pct: 10, activo: true, vence: '', tipo: 'campana' });
    await db.doc('descuentos/PAUSADO').set({ pct: 10, activo: false, vence: '', tipo: 'campana' });
    await db.doc('descuentos/VENCIDO').set({ pct: 10, activo: true, vence: '2020-01-01', tipo: 'campana' });
    await db.doc('descuentos/FUTURO').set({ pct: 10, activo: true, vence: '2099-12-31', tipo: 'campana' });
    await db.doc('descuentos/VOLVE-ABCDEFGH').set({ pct: 15, activo: true, vence: '', tipo: 'personal', tel8: '35800164', clienteNombre: 'Juan' });
    await db.doc('rutas/r1').set({ pedidoIds: [PID], orden: [PID], estado: 'asignada' });
    await db.doc('pedidos/' + PID).set(pedidoRetiro(PID, { rutaId: 'r1', estado: 'asignado' }));
    await db.doc('pedidos/p_pend1').set(pedidoRetiro('p_pend1'));
    await db.doc('club_config/contador').set({ n: 5 });
    await db.doc('club_config/flags').set({ canjeActivo: true });
    await db.doc('juego_config/dia').set({ objetivoMs: 10000 });
    await db.doc('juego_dias/30111222_2026-11-03').set({ dni: '30111222' });
    await db.doc('clientes/soc1').set({ nombre: 'Socio Uno', dni: '30111222', puntos: 50, nroSocio: 3 });
    await db.doc('clientes/soc2').set({ nombre: 'Socio Dos', dni: '30999888', puntos: 0, nroSocio: 4 });
    await db.doc('users/u_rep').set({ id: 'u_rep', nombre: 'Rep', email: 'rep@gdo.com', roles: ['repartidor'], activo: true });
    await db.doc('canjes/c1').set({ clienteUid: 'soc1', socioNombre: 'Socio Uno', socioNro: 3, usado: false, estado: 'emitido', costo: 10 });
  });

  console.log('\n# Pedidos de la tienda');
  await t('retiro de la lista (anónimo) se crea', () => { const id = nid(); return assertSucceeds(anon().doc('pedidos/' + id).set(pedidoRetiro(id))); });
  await t('link de vendedor (envío, datos del negocio) se crea', () => { const id = nid(); return assertSucceeds(anon().doc('pedidos/' + id).set(pedidoRetiro(id, {
    canal: 'vendedor', lista: 'mayorista', vendedorId: 'u_abc123', vendedorNombre: 'Lucía', contacto: 'Juan', fantasia: 'Super X', razonSocial: 'X SA',
    cuit: '20-12345678-9', email: 'a@b.com', modalidad: 'envio', lat: -34.6, lng: -58.6, cuentaUid: 'anon1', clienteUid: null }))); });
  await t('minorista con código VOLVE10 se crea', () => { const id = nid(); return assertSucceeds(anon().doc('pedidos/' + id).set(pedidoRetiro(id, {
    lista: 'minorista', zona: 'Hurlingham', envio: 0, descuento: { codigo: 'VOLVE10', pct: 10, tipo: 'campana', nombre: '', subtotal: 10000, monto: 1000 } }))); });
  await t('código con vencimiento futuro se acepta', () => { const id = nid(); return assertSucceeds(anon().doc('pedidos/' + id).set(pedidoRetiro(id, {
    descuento: { codigo: 'FUTURO', pct: 10, tipo: 'campana', nombre: '', subtotal: 10000, monto: 1000 } }))); });
  await t('combo (fuente) se crea', () => { const id = nid(); return assertSucceeds(anon().doc('pedidos/' + id).set(pedidoRetiro(id, { lista: 'minorista', fuente: 'landing-combo-fin-de-mes', zona: '', envio: 0 }))); });
  await t('socio logueado con su clienteUid se crea', () => { const id = nid(); return assertSucceeds(user('soc1').doc('pedidos/' + id).set(pedidoRetiro(id, { clienteUid: 'soc1' }))); });
  await t('id con HTML se rechaza', () => { const id = 'p_"><img src=x onerror=alert(1)>'; return assertFails(anon().doc('pedidos/' + id).set(pedidoRetiro(id))); });
  await t('id del doc distinto del campo id se rechaza', () => assertFails(anon().doc('pedidos/' + nid()).set(pedidoRetiro(nid()))));
  await t('campo pagado:true se rechaza', () => { const id = nid(); return assertFails(anon().doc('pedidos/' + id).set(pedidoRetiro(id, { pagado: true }))); });
  await t('pagoOnline se rechaza', () => { const id = nid(); return assertFails(anon().doc('pedidos/' + id).set(pedidoRetiro(id, { pagoOnline: { medio: 'Nave' } }))); });
  await t('pod (comprobante) se rechaza', () => { const id = nid(); return assertFails(anon().doc('pedidos/' + id).set(pedidoRetiro(id, { pod: { foto: 'javascript:alert(1)' } }))); });
  await t('lat como texto se rechaza', () => { const id = nid(); return assertFails(anon().doc('pedidos/' + id).set(pedidoRetiro(id, { lat: '"><script>' }))); });
  await t('prioridad alta se rechaza', () => { const id = nid(); return assertFails(anon().doc('pedidos/' + id).set(pedidoRetiro(id, { prioridad: 'alta' }))); });
  await t('puntos > 0 se rechaza', () => { const id = nid(); return assertFails(anon().doc('pedidos/' + id).set(pedidoRetiro(id, { puntos: 500 }))); });
  await t('vendedorId con HTML se rechaza', () => { const id = nid(); return assertFails(anon().doc('pedidos/' + id).set(pedidoRetiro(id, { vendedorId: '"><b>' }))); });
  await t('clienteUid ajeno se rechaza', () => { const id = nid(); return assertFails(anon().doc('pedidos/' + id).set(pedidoRetiro(id, { clienteUid: 'soc1' }))); });
  await t('101 renglones se rechaza', () => { const id = nid(); return assertFails(anon().doc('pedidos/' + id).set(pedidoRetiro(id, { items: Array(101).fill({ producto: 'x', cantidad: 1 }) }))); });
  await t('código con % inventado se rechaza', () => { const id = nid(); return assertFails(anon().doc('pedidos/' + id).set(pedidoRetiro(id, { descuento: { codigo: 'VOLVE10', pct: 50, tipo: 'campana', nombre: '', subtotal: 1, monto: 1 } }))); });
  await t('código pausado se rechaza', () => { const id = nid(); return assertFails(anon().doc('pedidos/' + id).set(pedidoRetiro(id, { descuento: { codigo: 'PAUSADO', pct: 10, tipo: 'campana', nombre: '', subtotal: 1, monto: 1 } }))); });
  await t('código vencido se rechaza', () => { const id = nid(); return assertFails(anon().doc('pedidos/' + id).set(pedidoRetiro(id, { descuento: { codigo: 'VENCIDO', pct: 10, tipo: 'campana', nombre: '', subtotal: 1, monto: 1 } }))); });
  await t('código inexistente se rechaza', () => { const id = nid(); return assertFails(anon().doc('pedidos/' + id).set(pedidoRetiro(id, { descuento: { codigo: 'NOEXISTE', pct: 10, tipo: 'campana', nombre: '', subtotal: 1, monto: 1 } }))); });
  await t('código personal con SU teléfono se acepta', () => { const id = nid(); return assertSucceeds(anon().doc('pedidos/' + id).set(pedidoRetiro(id, { telefono: '+54 9 11 3580-0164', descuento: { codigo: 'VOLVE-ABCDEFGH', pct: 15, tipo: 'personal', nombre: '', subtotal: 1, monto: 1 } }))); });
  await t('código personal con OTRO teléfono se rechaza', () => { const id = nid(); return assertFails(anon().doc('pedidos/' + id).set(pedidoRetiro(id, { telefono: '11 4444-5555', descuento: { codigo: 'VOLVE-ABCDEFGH', pct: 15, tipo: 'personal', nombre: '', subtotal: 1, monto: 1 } }))); });
  await t('sin login no se crea', () => { const id = nid(); return assertFails(nadie().doc('pedidos/' + id).set(pedidoRetiro(id))); });
  await t('personal (staff) crea un pedido con cualquier campo', () => assertSucceeds(user('rep1').doc('pedidos/p_staff1').set({ cliente: 'X', prioridad: 'alta', pagado: true })));

  console.log('\n# Pedidos: lectura y borrado');
  await t('cualquiera lee UN pedido por su id (link de seguimiento)', () => assertSucceeds(anon('otro').doc('pedidos/' + PID).get()));
  await t('anónimo NO lista pedidos', () => assertFails(anon().collection('pedidos').get()));
  await t('anónimo NO modifica un pedido', () => assertFails(anon().doc('pedidos/p_pend1').update({ pagado: true })));
  await t('repartidor NO borra pedidos', () => assertFails(user('rep1').doc('pedidos/p_pend1').delete()));
  await t('cajero NO borra un pedido asignado a ruta', () => assertFails(user('caj1').doc('pedidos/' + PID).delete()));
  await t('vendedor borra un pedido pendiente sin ruta', () => assertSucceeds(user('vend1').doc('pedidos/p_pend1').delete()));
  await t('admin borra cualquier pedido', () => assertSucceeds(user('admin1').doc('pedidos/' + PID).delete()));

  console.log('\n# Rutas y seguimiento');
  await t('anónimo NO lee la ruta (ids de todas las paradas)', () => assertFails(anon().doc('rutas/r1').get()));
  await t('repartidor lee la ruta', () => assertSucceeds(user('rep1').doc('rutas/r1').get()));
  await t('repartidor publica /seguimiento', () => assertSucceeds(user('rep1').doc('seguimiento/r1').set({ estado: 'en_curso', origen: { lat: 1, lng: 2 }, choferPos: null, demoraDefaultMin: 10, paradas: [{ t: 'abcd', est: '', dem: null, lat: -34.6, lng: -58.6 }], actualizado: 1 })));
  await t('/seguimiento con un campo de más se rechaza', () => assertFails(user('rep1').doc('seguimiento/r1').set({ paradas: [], pedidoIds: ['x'] })));
  await t('anónimo lee /seguimiento', () => assertSucceeds(anon().doc('seguimiento/r1').get()));
  await t('anónimo NO lista /seguimiento', () => assertFails(anon().collection('seguimiento').get()));
  await t('anónimo NO escribe /seguimiento', () => assertFails(anon().doc('seguimiento/r1').set({ paradas: [] })));

  console.log('\n# Club: socios');
  await t('alta de socio con el N° que deja el contador (+1 en el mismo commit)', async () => {
    const db = user('nuevo1'); const b = db.batch();
    b.update(db.doc('club_config/contador'), { n: 6 });
    b.set(db.doc('clientes/nuevo1'), { nombre: 'N', email: 'n@x', dni: '1', direccion: '', telefono: '', puntos: 0, nroSocio: 6, creado: FV.serverTimestamp() });
    return assertSucceeds(b.commit());
  });
  await t('alta eligiendo otro N° (99) se rechaza', async () => {
    const db = user('nuevo2'); const b = db.batch();
    b.update(db.doc('club_config/contador'), { n: 7 });
    b.set(db.doc('clientes/nuevo2'), { nombre: 'N', puntos: 0, nroSocio: 99 });
    return assertFails(b.commit());
  });
  await t('alta con el N° actual SIN incrementar el contador se rechaza', () => assertFails(user('nuevo3').doc('clientes/nuevo3').set({ nombre: 'N', puntos: 0, nroSocio: 6 })));
  await t('alta marcándose juegoIlimitado se rechaza', async () => {
    const db = user('nuevo4'); const b = db.batch();
    b.update(db.doc('club_config/contador'), { n: 7 });
    b.set(db.doc('clientes/nuevo4'), { nombre: 'N', puntos: 0, nroSocio: 7, juegoIlimitado: true });
    return assertFails(b.commit());
  });
  await t('cuenta mayorista (nroSocio 0, tipo mayorista) se crea', () => assertSucceeds(user('may1').doc('clientes/may1').set({ tipo: 'mayorista', esMayorista: true, puntos: 0, nroSocio: 0, fantasia: 'X' }, { merge: true })));
  await t('socio edita su teléfono', () => assertSucceeds(user('soc1').doc('clientes/soc1').update({ telefono: '1122334455' })));
  await t('socio NO cambia su DNI', () => assertFails(user('soc1').doc('clientes/soc1').update({ dni: '99999999' })));
  await t('socio NO cambia su N° de socio', () => assertFails(user('soc1').doc('clientes/soc1').update({ nroSocio: 1 })));
  await t('socio NO se marca juegoIlimitado', () => assertFails(user('soc1').doc('clientes/soc1').update({ juegoIlimitado: true })));
  await t('socio NO se suma puntos', () => assertFails(user('soc1').doc('clientes/soc1').update({ puntos: 5000 })));
  await t('cajero lista socios (búsqueda por N°)', () => assertSucceeds(user('caj1').collection('clientes').where('nroSocio', '==', 3).get()));
  await t('admin lista socios', () => assertSucceeds(user('admin1').collection('clientes').get()));
  await t('repartidor NO lista socios', () => assertFails(user('rep1').collection('clientes').get()));
  await t('repartidor lee UN socio por id (acreditar en la entrega)', () => assertSucceeds(user('rep1').doc('clientes/soc1').get()));
  await t('socio NO lee a otro socio', () => assertFails(user('soc1').doc('clientes/soc2').get()));

  console.log('\n# Club: club_config');
  await t('logueado NO crea club_config/flags con n:1', () => assertFails(user('soc1').doc('club_config/otro').set({ n: 1, canjeActivo: true })));
  await t('logueado NO pisa flags', () => assertFails(user('soc1').doc('club_config/flags').set({ n: 1 })));
  await t('contador +1 con campo extra se rechaza', () => assertFails(user('soc1').doc('club_config/contador').update({ n: 8, x: 1 })));
  await t('contador salteando números se rechaza', () => assertFails(user('soc1').doc('club_config/contador').update({ n: 50 })));
  await t('admin prende el canje', () => assertSucceeds(user('admin1').doc('club_config/flags').set({ canjeActivo: true }, { merge: true })));

  console.log('\n# Canjes');
  await t('socio anonimiza SUS vouchers al darse de baja', () => assertSucceeds(user('soc1').doc('canjes/c1').update({ socioNombre: '', socioNro: 0 })));
  await t('socio NO marca su voucher como no usado / cambia otra cosa', () => assertFails(user('soc1').doc('canjes/c1').update({ socioNombre: '', socioNro: 0, costo: 0 })));
  await t('otro socio NO toca el voucher', () => assertFails(user('soc2').doc('canjes/c1').update({ socioNombre: '', socioNro: 0 })));
  await t('cajero NO marca usado un voucher sin vencimiento', () => assertFails(user('caj1').doc('canjes/c1').update({ usado: true })));  // sin venceMs → no

  console.log('\n# Juego');
  await t('socio NO lee /juego_dias (DNI)', () => assertFails(user('soc1').doc('juego_dias/30111222_2026-11-03').get()));
  await t('anónimo NO lista /juego_dias', () => assertFails(anon().collection('juego_dias').get()));
  await t('personal lee /juego_dias', () => assertSucceeds(user('caj1').doc('juego_dias/30111222_2026-11-03').get()));

  const crearPartida = (id, obj) => assertSucceeds(user('caj1').doc('partidas/' + id).set({
    clienteUid: 'soc1', socioNro: 3, socioNombre: 'Socio Uno', dni: '30111222', fecha: '2026-11-03', estado: 'habilitada',
    objetivoMs: obj || 10000, premioIco: '🎁', premioNombre: 'Docena de huevos', ticketNro: '1', monto: 1000,
    gano: false, premioEntregado: false, demo: false, venceMs: Date.now() + 60000, habilitadaPor: 'caj1', habilitadaTs: FV.serverTimestamp() }));
  const s1 = user('soc1');
  await t('cajero habilita partida', () => crearPartida('pt1'));
  await t('socio arranca (inicioTs = servidor)', () => assertSucceeds(s1.doc('partidas/pt1').update({ estado: 'jugando', inicioTs: FV.serverTimestamp() })));
  await t('MÉTODO VIEJO: declarar tiempoMs/gano al frenar se rechaza', () => assertFails(s1.doc('partidas/pt1').update({ estado: 'jugada', tiempoMs: 10000, gano: true, finTs: FV.serverTimestamp() })));
  await new Promise((r) => setTimeout(r, 300));
  await t('socio frena (solo estado + finTs del servidor)', () => assertSucceeds(s1.doc('partidas/pt1').update({ estado: 'jugada', finTs: FV.serverTimestamp() })));
  let ms = null;
  await t('cerrar con un tiempo inventado se rechaza', () => assertFails(s1.doc('partidas/pt1').update({ tiempoMs: 10000, gano: true })));
  await t('cerrar con el tiempo del servidor pero gano:true (perdió) se rechaza', async () => {
    const x = (await s1.doc('partidas/pt1').get()).data();
    ms = Math.floor(x.finTs.toMillis()) - Math.floor(x.inicioTs.toMillis());
    return assertFails(s1.doc('partidas/pt1').update({ tiempoMs: ms, gano: true }));
  });
  await t('cerrar con tiempoMs = finTs − inicioTs (cuenta del servidor) se acepta', () => assertSucceeds(s1.doc('partidas/pt1').update({ tiempoMs: ms, gano: false })));
  await t('cerrar de nuevo (cambiar el resultado) se rechaza', () => assertFails(s1.doc('partidas/pt1').update({ tiempoMs: ms + 1 })));
  await t('voucher de una partida perdida se rechaza', () => assertFails(s1.doc('canjes/pt1').set({ clienteUid: 'soc1', origen: 'juego', partidaId: 'pt1', premioNombre: 'Docena de huevos', costo: 0, usado: false, estado: 'emitido', venceMs: Date.now() + 3600000 })));

  // Un jugador real que embocó: el objetivo coincide con lo que midió el servidor.
  await t('cajero habilita partida 2', () => crearPartida('pt2'));
  await t('socio arranca partida 2', () => assertSucceeds(s1.doc('partidas/pt2').update({ estado: 'jugando', inicioTs: FV.serverTimestamp() })));
  await new Promise((r) => setTimeout(r, 250));
  await t('socio frena partida 2', () => assertSucceeds(s1.doc('partidas/pt2').update({ estado: 'jugada', finTs: FV.serverTimestamp() })));
  let ms2;
  await env.withSecurityRulesDisabled(async (c) => {   // "el objetivo del día justo era ese tiempo"
    const fdb = c.firestore();
    const x = (await fdb.doc('partidas/pt2').get()).data();
    ms2 = Math.floor(x.finTs.toMillis()) - Math.floor(x.inicioTs.toMillis());
    await fdb.doc('partidas/pt2').update({ objetivoMs: Math.floor(ms2 / 10) * 10 + 5 });
  });
  await t('GANÓ (servidor): cerrar con gano:true se acepta', () => assertSucceeds(s1.doc('partidas/pt2').update({ tiempoMs: ms2, gano: true })));
  await t('voucher de la partida ganada se emite', () => assertSucceeds(s1.doc('canjes/pt2').set({ clienteUid: 'soc1', origen: 'juego', partidaId: 'pt2', premioNombre: 'Docena de huevos', premioIco: '🎁', costo: 0, usado: false, estado: 'emitido', codigo: 'GDO-1', socioNombre: 'Socio Uno', socioNro: 3, tiempoMs: ms2, venceMs: Date.now() + 3600000, ts: FV.serverTimestamp() })));
  await t('personal marca el premio entregado', () => assertSucceeds(user('caj1').doc('partidas/pt2').update({ premioEntregado: true })));
  await t('otro socio NO frena mi partida', async () => { await crearPartida('pt3'); await s1.doc('partidas/pt3').update({ estado: 'jugando', inicioTs: FV.serverTimestamp() }); return assertFails(user('soc2').doc('partidas/pt3').update({ estado: 'jugada', finTs: FV.serverTimestamp() })); });

  console.log('\n# /users (perfiles de la app)');
  await t('repartidor NO se pone roles admin', () => assertFails(user('rep1', 'rep@gdo.com').doc('users/u_rep').update({ roles: ['admin'] })));
  await t('repartidor NO edita a otro', () => assertFails(user('rep1', 'rep@gdo.com').doc('users/otro').set({ roles: ['admin'] })));
  await t('repartidor vincula SU UID al perfil con SU email (primer ingreso)', () => assertSucceeds(user('rep1', 'REP@gdo.com').doc('users/u_rep').update({ uid: 'rep1' })));
  await t('otro staff NO vincula su UID al perfil ajeno', () => assertFails(user('caj1', 'caj@gdo.com').doc('users/u_rep').update({ uid: 'caj1' })));
  await t('staff crea SU perfil como repartidor', () => assertSucceeds(user('vend1', 'v@gdo.com').doc('users/vend1').set({ id: 'vend1', uid: 'vend1', nombre: 'v', email: 'v@gdo.com', roles: ['repartidor'], activo: true })));
  await t('staff NO crea su perfil como admin', () => assertFails(user('caj1', 'c@gdo.com').doc('users/caj1').set({ id: 'caj1', uid: 'caj1', nombre: 'c', email: 'c@gdo.com', roles: ['admin'], activo: true })));
  await t('admin edita usuarios', () => assertSucceeds(user('admin1').doc('users/u_rep').update({ roles: ['repartidor', 'vendedor'], comision: { pct: 5 } })));
  await t('socio (no staff) NO lee usuarios', () => assertFails(user('soc1').collection('users').get()));

  console.log('\n# Descuentos');
  await t('anónimo lee UN código por nombre', () => assertSucceeds(anon().doc('descuentos/VOLVE10').get()));
  await t('anónimo NO lista códigos', () => assertFails(anon().collection('descuentos').get()));

  console.log(`\n${ok} OK · ${mal} FALLARON`);
  await env.cleanup();
  process.exit(mal ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
