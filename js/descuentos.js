/* ====== GDO Reparto — Códigos de descuento ======
   Dos clases de código, con las mismas reglas de fondo:
   · CAMPAÑA  — uno para todos (ej. VOLVE10), con fecha de vencimiento. Cada
                cliente lo puede usar UNA sola vez (se lo reconoce por el
                teléfono). Sirve para cualquier acción publicitaria.
   · PERSONAL — uno por cliente (ej. VOLVE-JUAN-7K3), de un solo uso y atado a
                su teléfono. Es el que se le manda al cliente que se está yendo.

   DÓNDE VIVEN: Firestore, colección `descuentos`, con el CÓDIGO como id del
   documento. Así la tienda online puede buscar UN código por su nombre (regla
   `allow get: if true`, igual que el seguimiento de un pedido) sin poder
   listar los demás. El personal los ve todos: hacen falta al cargar un pedido.

   El descuento es un PORCENTAJE sobre la mercadería. El pedido guarda
   `descuento: {codigo, pct, tipo, nombre, subtotal, monto}` y `totalEstimado`
   pasa a ser lo que se COBRA (subtotal − descuento): así Métricas y el CRM
   cuentan la plata real.

   LOS USOS NO SE GUARDAN EN EL CÓDIGO: salen de los pedidos que lo llevan.
   Un pedido "no entregado" no gasta el código. Si dos pedidos del mismo
   cliente traen el mismo código, vale el que se hizo PRIMERO. */
window.GDO = window.GDO || {};
(function () {
  const DIA = 86400000;
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const hoyISO = () => iso(new Date());
  const fmtDia = (s) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '');
  const fmtM = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');

  // "volve 10" → "VOLVE10". Solo letras, números y guiones: es lo que se dicta
  // por teléfono sin errores y lo que acepta un id de Firestore.
  function normCodigo(s) {
    return String(s == null ? '' : s).toUpperCase()
      .normalize('NFD').replace(new RegExp('[̀-ͯ]', 'g'), '')
      .replace(/[^A-Z0-9-]+/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  }
  const tel8 = (t) => (GDO.CRM ? GDO.CRM.telKey(t) : (String(t || '').replace(/\D/g, '').slice(-8)));

  const todos = () => (GDO.Store && GDO.Store.descuentos && GDO.Store.descuentos()) || [];
  const buscar = (codigo) => { const k = normCodigo(codigo); return k ? (todos().find((d) => d.id === k) || null) : null; };

  // ¿Venció? Se mira contra una fecha de referencia: la del pedido, no la de hoy
  // (un pedido hecho dentro del plazo conserva el descuento aunque se edite después).
  const vencido = (d, ref) => !!(d && d.vence && d.vence < iso(new Date(ref || Date.now())));
  function diasParaVencer(d) {
    if (!d || !d.vence) return null;
    return Math.round((Date.parse(d.vence + 'T00:00:00') - Date.parse(hoyISO() + 'T00:00:00')) / DIA);
  }

  // Pedidos que usaron el código (los "no entregado" no lo gastan).
  function usos(codigo, excluirId) {
    const k = normCodigo(codigo);
    return ((GDO.Store && GDO.Store.pedidos && GDO.Store.pedidos()) || []).filter((p) =>
      p.descuento && normCodigo(p.descuento.codigo) === k && p.estado !== 'no_entregado' && p.id !== excluirId);
  }
  const creadoDe = (p) => p.creado || p.ts || 0;
  const quien = (p) => (p.cliente || 'otro pedido') + (creadoDe(p) ? ', el ' + new Date(creadoDe(p)).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '');

  // En qué está un código, para mostrarlo: activo, pausado, vencido o (el
  // personal) ya usado.
  function estado(d) {
    if (!d.activo) return 'pausado';
    if (vencido(d)) return 'vencido';
    if (d.tipo === 'personal' && usos(d.id).length) return 'usado';
    return 'activo';
  }

  /* ¿Se puede usar este código en este pedido?
     ctx = { telefono, modalidad, pedidoId, creado, guardado }
       · creado:   cuándo se hizo el pedido (por defecto, ahora).
       · guardado: el pedido YA traía el código (vino de la tienda o se cargó
                   antes). No se lo frena por "pausado": se juzga como estaba
                   cuando se pidió.
     Devuelve { ok, d, error }. El error está escrito para mostrárselo tal cual
     a quien carga el pedido. */
  function validar(codigo, ctx) {
    ctx = ctx || {};
    const k = normCodigo(codigo);
    if (!k) return { ok: false, error: 'Escribí el código.' };
    const d = buscar(k);
    if (!d) return { ok: false, error: 'El código ' + k + ' no existe. Revisá que esté bien escrito.' };
    const ref = ctx.creado || Date.now();
    if (!ctx.guardado && !d.activo) return { ok: false, d: d, error: 'El código ' + k + ' está pausado.' };
    if (vencido(d, ref)) return { ok: false, d: d, error: 'El código ' + k + ' venció el ' + fmtDia(d.vence) + '.' };
    if (d.soloEnvio && ctx.modalidad === 'retiro') {
      return { ok: false, d: d, error: 'Este código es solo para pedidos con envío a domicilio.' };
    }
    const t = tel8(ctx.telefono);
    // Si otro pedido lo usó ANTES que este, gana el otro.
    const previos = (lista) => lista.filter((p) => creadoDe(p) <= ref);
    if (d.tipo === 'personal') {
      if (d.tel8 && !t) return { ok: false, d: d, error: 'Es un código personal: cargá el teléfono del cliente para usarlo.' };
      if (d.tel8 && t !== d.tel8) {
        return { ok: false, d: d, error: 'Es un código personal de ' + (d.clienteNombre || 'otro cliente') + ' y el teléfono no coincide.' };
      }
      const otros = previos(usos(k, ctx.pedidoId));
      if (otros.length) return { ok: false, d: d, error: 'Este código personal ya se usó (' + quien(otros[0]) + ').' };
    } else {
      if (!t) return { ok: false, d: d, error: 'Cargá el teléfono del cliente: cada cliente puede usar el código una sola vez.' };
      const otros = previos(usos(k, ctx.pedidoId).filter((p) => tel8(p.telefono) === t));
      if (otros.length) return { ok: false, d: d, error: 'Este cliente ya usó ' + k + ' (' + quien(otros[0]) + ').' };
    }
    return { ok: true, d: d };
  }

  // Cuánto se descuenta. Redondeado al peso: nadie cobra centavos.
  function aplicar(subtotal, d) {
    const s = Math.round(Number(subtotal) || 0);
    const pct = Number(d && d.pct) || 0;
    const monto = Math.round(s * pct / 100);
    return { subtotal: s, pct: pct, monto: monto, total: s - monto };
  }

  // Lo que queda guardado en el pedido.
  function resumenPedido(d, subtotal) {
    const a = aplicar(subtotal, d);
    return { codigo: d.id, pct: a.pct, tipo: d.tipo, nombre: d.nombre || '', subtotal: a.subtotal, monto: a.monto };
  }

  /* CÓDIGO PERSONAL: prefijo + nombre de pila + 3 caracteres al azar, sin los
     que se confunden al dictarlo (0/O, 1/I/L). Ej: VOLVE-JUAN-7K3. */
  const LETRAS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  function azar(n) {
    let s = '';
    try {
      const a = new Uint8Array(n);
      (self.crypto || window.crypto).getRandomValues(a);
      for (let i = 0; i < n; i++) s += LETRAS[a[i] % LETRAS.length];
    } catch (e) {
      for (let i = 0; i < n; i++) s += LETRAS[Math.floor(Math.random() * LETRAS.length)];
    }
    return s;
  }
  function codigoPersonal(nombre, prefijo) {
    const pila = normCodigo(String(nombre || '').replace(/\([^)]*\)/g, ' ').trim().split(/\s+/)[0]).replace(/-/g, '').slice(0, 8) || 'CLIENTE';
    const pre = normCodigo(prefijo || 'VOLVE') || 'VOLVE';
    let c, vueltas = 0;
    do { c = pre + '-' + pila + '-' + azar(3); } while (buscar(c) && ++vueltas < 20);
    return c;
  }
  // Sugerencia para una campaña a partir de su nombre y el %: "Volvé a GDO", 10 → "VOLVE10".
  function codigoCampana(nombre, pct) {
    const pal = normCodigo(String(nombre || '').split(/\s+/)[0]).replace(/-/g, '').slice(0, 10) || 'PROMO';
    return pal + (pct ? String(pct) : '');
  }

  /* Crear o actualizar un código. `datos` = { codigo, tipo, pct, nombre, vence,
     soloEnvio, activo, clienteNombre, telefono, fichaId }. */
  function guardar(datos, previo) {
    const u = (GDO.Store.current && GDO.Store.current()) || null;
    const id = normCodigo(datos.codigo);
    const doc = {
      id: id, codigo: id,
      tipo: datos.tipo === 'personal' ? 'personal' : 'campana',
      pct: Math.max(1, Math.min(50, Math.round(Number(datos.pct) || 0))),
      nombre: String(datos.nombre || '').trim().slice(0, 80),
      vence: datos.vence || '',
      soloEnvio: !!datos.soloEnvio,
      activo: datos.activo !== false,
    };
    if (doc.tipo === 'personal') {
      // Al EDITAR un personal no se vuelve a elegir el cliente: se conservan su
      // nombre y su teléfono (si no, el código quedaba sin dueño).
      doc.clienteNombre = String(datos.clienteNombre || (previo && previo.clienteNombre) || '').trim().slice(0, 80);
      doc.tel8 = datos.telefono ? tel8(datos.telefono) : ((previo && previo.tel8) || '');
      doc.fichaId = datos.fichaId || (previo && previo.fichaId) || '';
    }
    if (!previo) { doc.creadoPor = u ? u.id : null; doc.creadoPorNombre = u ? u.nombre : ''; }
    return GDO.Store.upsertDescuento(doc);
  }

  // "válido hasta el 30/09" / "sin vencimiento"
  const textoVence = (d) => (d && d.vence ? 'válido hasta el ' + fmtDia(d.vence) : 'sin vencimiento');

  /* EL MENSAJE para el cliente que se está yendo. Es el texto que pidió el
     dueño, con el código y cómo usarlo. Negritas con *…* (WhatsApp). */
  function mensajeVuelta(ficha, d) {
    const nom = GDO.CRM && GDO.CRM.nombrePila ? GDO.CRM.nombrePila(ficha || {}) : String((ficha && ficha.nombre) || '').split(' ')[0];
    const url = (GDO.CRM && GDO.CRM.LISTA_URL) || 'lista.granjadeloeste.com';
    return 'Hola ' + (nom || '') + '! 👋 Hace tiempo que no sabemos nada de vos y queremos que vuelvas 🐔❤️\n' +
      'Por eso te ofrecemos un *' + d.pct + '% de descuento* en tu próximo pedido' + (d.soloEnvio ? ' a domicilio' : '') + '!! 🎁\n\n' +
      '🎟️ Tu código: *' + d.id + '*\n' +
      '⏳ ' + textoVence(d).charAt(0).toUpperCase() + textoVence(d).slice(1) + '\n\n' +
      'Hacé tu pedido en ' + url + ' y cargá el código antes de enviarlo, o respondé este mensaje y te lo tomamos nosotros.\n' +
      '¡Te esperamos! — Granja del Oeste';
  }
  /* El mensaje de una CAMPAÑA, para estados o listas de difusión (sin nombre). */
  function mensajeCampana(d) {
    const url = (GDO.CRM && GDO.CRM.LISTA_URL) || 'lista.granjadeloeste.com';
    return '🎁 *' + d.pct + '% de descuento* en tu próximo pedido' + (d.soloEnvio ? ' a domicilio' : '') + ' en Granja del Oeste 🐔\n\n' +
      '🎟️ Código: *' + d.id + '*\n' +
      '⏳ ' + textoVence(d).charAt(0).toUpperCase() + textoVence(d).slice(1) + ' · uno por cliente\n\n' +
      'Pedí en ' + url + ' y cargá el código antes de enviar el pedido.';
  }

  GDO.Desc = {
    normCodigo, buscar, todos, validar, aplicar, resumenPedido, usos, estado, vencido, diasParaVencer,
    codigoPersonal, codigoCampana, guardar, mensajeVuelta, mensajeCampana, textoVence, fmtDia, fmtM, hoyISO, iso,
  };
})();
