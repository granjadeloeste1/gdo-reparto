/* ====== GDO Reparto — CRM: fichas de cliente, ritmo de compra y sugerencias ======

   IDEA CENTRAL: hasta ahora el "cliente" era un TEXTO adentro de cada pedido
   (js/views/admin.js → Store.upsertPedido({cliente:'...'})), así que el mismo
   comercio escrito de tres formas eran tres clientes distintos, y no se podía
   preguntar "¿cuánto me compró?" ni "¿hace cuánto no viene?".

   Acá el cliente pasa a ser una FICHA. Dos capas:

   1) La ficha CALCULADA: sale sola de los pedidos que ya existen. No hay que
      migrar ni cargar nada: agrupamos los pedidos por TELÉFONO (o por nombre
      normalizado si no hay teléfono) y de ahí salen historial, ritmo de compra,
      productos habituales y plata. Es de solo lectura y siempre está al día.

   2) La ficha GUARDADA (colección `crm_clientes` de Firestore): SOLO lo que una
      persona agrega a mano y la app no puede adivinar — tipo de cliente, notas,
      recordatorios, "ya lo contacté". Se crea recién cuando tocás algo. El campo
      `claves` permite unir duplicados (dos formas de escribir el mismo cliente).

   El resultado que le importa al negocio está en `sugerencias()`: la lista de
   "a quién contactar hoy y qué ofrecerle", ordenada por urgencia, con el mensaje
   de WhatsApp ya escrito.

   REGLA GDO: los mensajes NUNCA inventan un precio. Cuando hace falta hablar de
   plata, mandan a la lista viva (lista.granjadeloeste.com). */
window.GDO = window.GDO || {};
(function () {
  const DIA = 86400000;
  const LISTA_URL = 'lista.granjadeloeste.com';

  /* ═════════════════ normalización ═════════════════ */

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase()
      .normalize("NFD").replace(new RegExp("[\u0300-\u036f]", "g"), "")
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Últimos 8 dígitos: iguala "11 3580-0164", "+54 9 11 3580 0164" y "35800164".
  function telKey(t) {
    const d = String(t == null ? '' : t).replace(/\D/g, '');
    return d.length >= 8 ? d.slice(-8) : '';
  }

  // Dirección normalizada HASTA LA ALTURA, que es lo único estable:
  // "Av. Pres. Juan D. Perón 6871, Villa Udaondo, Ituzaingó" → "pres juan peron 6871".
  // Sin altura no sirve como dato para unificar (media Hurlingham vive en "la calle 13").
  const CALLE_PREF = ['av', 'avda', 'avenida', 'calle', 'ruta', 'pasaje', 'pje', 'psje',
    'bv', 'blvd', 'boulevard', 'diagonal', 'diag', 'colectora'];
  function dirKey(d) {
    const s = norm(String(d == null ? '' : d).split(',')[0]);
    if (!s || !/\d/.test(s)) return '';
    let partes = s.split(' ').filter(Boolean);
    while (partes.length > 1 && CALLE_PREF.indexOf(partes[0]) >= 0) partes.shift();
    // Fuera las iniciales sueltas ("Juan D. Perón" a veces se escribe sin la D).
    partes = partes.filter((w) => w.length > 1 || /\d/.test(w));
    return partes.length >= 2 ? partes.join(' ') : '';
  }

  // Nombres que no identifican a nadie: no sirven para unificar.
  const NOMBRE_GENERICO = ['cliente', 'consumidor final', 'sin nombre', 'particular',
    'vecino', 'mostrador', 'varios', 'contado', 'sin datos'];
  function nomKey(n) {
    const s = norm(n);
    return (s.length >= 3 && NOMBRE_GENERICO.indexOf(s) < 0) ? s : '';
  }

  // Los tres datos con los que se reconoce a un cliente. Cualquiera de los tres
  // alcanza para unificar dos pedidos (ver agrupar()).
  function senales(p) {
    const out = [];
    const t = telKey(p && p.telefono); if (t) out.push('t:' + t);
    const d = dirKey(p && p.direccion); if (d) out.push('d:' + d);
    const n = nomKey(p && p.cliente); if (n) out.push('n:' + n);
    return out;
  }

  // Producto normalizado, para poder comparar "Milanesas de pollo" con
  // "milanesa de pollo" (saca acentos, mayúsculas y el plural simple).
  function prodKey(s) {
    return norm(s).split(' ')
      .map((w) => (w.length > 4 && w.slice(-1) === 's' ? w.slice(0, -1) : w))
      .join(' ');
  }

  /* ═════════════════ lecturas del pedido ═════════════════ */

  /* Fecha REAL de la compra, por orden de confianza:
       1. la entrega confirmada por el chofer,
       2. la fecha de entrega pactada,
       3. el primer movimiento que tenga el pedido,
       4. el alta del pedido.
     Sin fecha no hay ritmo de compra posible, así que ese pedido no cuenta como
     compra. Pasa con pedidos VIEJOS que se cargaron sin fecha de entrega y nunca
     se despacharon: antes de agosto 2026 el pedido no guardaba fecha de alta.
     Se los lista en la pantalla de Clientes para poder completarlos. */
  function fechaDe(p) {
    const hist = p.historia || [];
    for (let i = hist.length - 1; i >= 0; i--) {
      if (hist[i] && hist[i].est === 'entregado' && hist[i].ts) return hist[i].ts;
    }
    const f = p.fechaEntrega || (p.diaEntrega && GDO.UI ? GDO.UI.proximoDiaFecha(p.diaEntrega) : '');
    if (f) { const t = Date.parse(f + 'T12:00:00'); if (!isNaN(t)) return t; }
    if (hist[0] && hist[0].ts) return hist[0].ts;
    return p.creado || null;
  }

  // Pedidos que la app no puede ubicar en el tiempo: no suman al historial ni al
  // ritmo de compra. Si son muchos, conviene completarles la fecha de entrega.
  function sinFecha() {
    return (GDO.Store.pedidos() || []).filter((p) => !fechaDe(p));
  }

  // Plata del pedido. Si el cliente declaró un total lo usamos; si no, sumamos
  // los items. Puede dar 0 (pedidos viejos sin precios): eso NO es un error, solo
  // significa que ese pedido no aporta al ranking por monto.
  function montoDe(p) {
    if (p.totalEstimado) return Number(p.totalEstimado) || 0;
    return (p.items || []).reduce((a, it) => {
      const c = (it.cantidad != null ? it.cantidad : it.cant) || 0;
      return a + c * (Number(it.precio) || 0);
    }, 0);
  }

  const mediana = (arr) => {
    if (!arr.length) return null;
    const a = arr.slice().sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
  };

  const TIPOS = {
    revendedor: { t: 'Revendedor', chip: 'crm-t-rev' },
    volumen: { t: 'Consumidor volumen', chip: 'crm-t-vol' },
    plumanegra: { t: 'Pluma Negra', chip: 'crm-t-pn' },
    '': { t: 'Sin clasificar', chip: 'crm-t-none' },
  };

  /* ═════════════════ armado de fichas ═════════════════ */

  /* Agrupa los pedidos en clientes.

     Une por CUALQUIERA de los tres datos — teléfono, dirección con altura o
     nombre — porque el mismo cliente aparece escrito de mil formas y a veces
     sin teléfono. Encadena: si el pedido A y el B comparten teléfono, y el B y
     el C comparten dirección, los tres son el mismo cliente.

     LA REGLA QUE FRENA TODO: nunca une dos pedidos con TELÉFONOS DISTINTOS.
     Eso es lo que evita que dos vecinos del mismo edificio (misma dirección sin
     depto) o dos "Juan" queden mezclados en una sola ficha. Si los dos tienen
     teléfono y no es el mismo, son dos clientes, compartan lo que compartan.

     Excepción: si una persona los unió a mano desde la ficha, el documento
     guardado lleva los dos teléfonos en `claves` y ahí sí quedan juntos. */
  function agrupar(pedidos, docs) {
    const grupos = [];        // { sen:{señal:1}, tels:{tel:1}, peds:[], doc }
    const padre = [];
    const idx = {};           // señal -> índice de grupo (resolver con raiz())
    const raiz = (i) => { while (padre[i] !== i) { padre[i] = padre[padre[i]]; i = padre[i]; } return i; };

    function nuevo(doc) {
      const i = grupos.length;
      grupos.push({ sen: {}, tels: {}, peds: [], doc: doc || null });
      padre.push(i);
      return i;
    }
    function marcar(i, sens, tel) {
      sens.forEach((s) => { grupos[i].sen[s] = 1; if (idx[s] == null) idx[s] = i; });
      if (tel) grupos[i].tels[tel] = 1;
    }
    // ¿Este teléfono contradice a los que ya tiene el grupo?
    function chocaTel(i, tel) {
      const ts = Object.keys(grupos[i].tels);
      if (!tel || !ts.length) return false;
      return ts.indexOf(tel) < 0;
    }
    function chocanGrupos(a, b) {
      const ta = Object.keys(grupos[a].tels), tb = Object.keys(grupos[b].tels);
      if (!ta.length || !tb.length) return false;
      return !ta.some((t) => tb.indexOf(t) >= 0);
    }
    function fundir(a, b) {   // b entra en a
      padre[b] = a;
      grupos[b].peds.forEach((p) => grupos[a].peds.push(p));
      Object.keys(grupos[b].sen).forEach((s) => { grupos[a].sen[s] = 1; });
      Object.keys(grupos[b].tels).forEach((t) => { grupos[a].tels[t] = 1; });
      if (!grupos[a].doc && grupos[b].doc) grupos[a].doc = grupos[b].doc;
      grupos[b].peds = []; grupos[b].sen = {}; grupos[b].tels = {};
    }

    // 1) Primero las fichas guardadas: sus `claves` ya declararon qué datos son
    //    de este cliente (incluidas las uniones hechas a mano).
    (docs || []).forEach((d) => {
      const i = nuevo(d);
      const sens = (d.claves || []).slice();
      senales({ cliente: d.nombre, telefono: d.telefono, direccion: d.direccion })
        .forEach((s) => { if (sens.indexOf(s) < 0) sens.push(s); });
      sens.forEach((s) => {
        grupos[i].sen[s] = 1;
        if (idx[s] == null) idx[s] = i;
        if (s.indexOf('t:') === 0) grupos[i].tels[s.slice(2)] = 1;
      });
    });

    // 2) Después los pedidos, encadenando por los datos que compartan.
    (pedidos || []).forEach((p) => {
      const sens = senales(p);
      if (!sens.length) return;
      const tel = telKey(p.telefono);

      const cand = [];
      sens.forEach((s) => {
        const g = idx[s];
        if (g == null) return;
        const r = raiz(g);
        if (cand.indexOf(r) < 0) cand.push(r);
      });
      const ok = cand.filter((g) => !chocaTel(g, tel));

      let dest;
      if (!ok.length) dest = nuevo(null);
      else {
        dest = ok[0];
        for (let k = 1; k < ok.length; k++) {
          const r = raiz(ok[k]);
          if (r !== dest && !chocanGrupos(dest, r)) fundir(dest, r);
        }
      }
      grupos[dest].peds.push(p);
      marcar(dest, sens, tel);
    });

    return grupos.filter((g, i) => raiz(i) === i && (g.peds.length || g.doc));
  }

  // Arma la ficha visible a partir de un grupo: los datos de contacto salen de lo
  // guardado a mano y, si no hay, del pedido MÁS NUEVO (es el dato más fresco).
  function armar(g) {
    const doc = g.doc || null;
    const peds = g.peds.slice().sort((a, b) => (fechaDe(a) || 0) - (fechaDe(b) || 0));
    const ult = peds[peds.length - 1] || null;
    const alias = [], tels = [], dirs = [];
    peds.forEach((p) => {
      if (p.cliente && alias.indexOf(p.cliente) < 0) alias.push(p.cliente);
      if (p.telefono && tels.indexOf(p.telefono) < 0) tels.push(p.telefono);
      if (p.direccion && dirs.indexOf(p.direccion) < 0) dirs.push(p.direccion);
    });
    const claves = Object.keys(g.sen).sort();
    return {
      // El id de una ficha sin documento guardado es su JUEGO COMPLETO de señales,
      // no la primera: dos vecinos de la misma dirección comparten la señal `d:` y
      // con una sola quedaban con el mismo id (se pisaban en la agenda y al abrir
      // la ficha). Dos grupos nunca pueden tener el mismo juego completo — si lo
      // tuvieran, agrupar() ya los habría fusionado.
      id: doc ? doc.id : ('g:' + claves.join('|')),
      docId: doc ? doc.id : null,
      claves: claves,
      nombre: (doc && doc.nombre) || (ult && ult.cliente) || alias[0] || 'Sin nombre',
      telefono: (doc && doc.telefono) || (ult && ult.telefono) || tels[tels.length - 1] || '',
      direccion: (doc && doc.direccion) || (ult && ult.direccion) || dirs[dirs.length - 1] || '',
      localidad: (doc && doc.localidad) || (ult && ult.localidad) || '',
      entrecalles: (doc && doc.entrecalles) || (ult && ult.entrecalles) || '',
      tipo: (doc && doc.tipo) || '',
      notas: (doc && doc.notas) || '',
      recordatorio: (doc && doc.recordatorio) || null,
      snooze: (doc && doc.snooze) || {},
      ultimoContactoTs: (doc && doc.ultimoContactoTs) || null,
      pausado: !!(doc && doc.pausado),
      socio: peds.some((p) => !!p.clienteUid),
      alias: alias, telefonos: tels, direcciones: dirs,
      pedidos: peds,
    };
  }

  // Devuelve TODAS las fichas, calculadas desde los pedidos y mezcladas con lo
  // guardado a mano. Ordenadas por última compra (lo más reciente primero).
  function fichas() {
    const Store = GDO.Store;
    const docs = (Store.crmClientes && Store.crmClientes()) || [];
    const out = agrupar(Store.pedidos() || [], docs).map((g) => calcular(armar(g)));
    out.sort((a, b) => (b.ultima || 0) - (a.ultima || 0));
    return out;
  }

  // Calcula sobre el grupo las métricas que después usan las sugerencias.
  function calcular(g) {
    const hoy = Date.now();

    // Compras REALES para el historial: las que ya ocurrieron y no fueron
    // rechazadas. Un "no entregado" no es una compra (no se llevó la mercadería).
    const compras = g.pedidos
      .map((p) => ({ p: p, ts: fechaDe(p) }))
      .filter((x) => x.ts && x.ts <= hoy && x.p.estado !== 'no_entregado')
      .sort((a, b) => a.ts - b.ts);

    // ¿Tiene un pedido en curso? Si ya pidió, NO hay que recordarle que pida.
    g.tienePendiente = g.pedidos.some((p) => ['pendiente', 'asignado', 'en_ruta'].indexOf(p.estado) >= 0);

    g.nCompras = compras.length;
    g.primera = compras.length ? compras[0].ts : null;
    g.ultima = compras.length ? compras[compras.length - 1].ts : null;
    g.diasDesde = g.ultima ? Math.floor((hoy - g.ultima) / DIA) : null;
    g.ultimoPedido = compras.length ? compras[compras.length - 1].p : null;

    // RITMO: mediana de días entre compras. Mediana y no promedio para que una
    // sola compra rara (vacaciones, un pedido enorme) no deforme el número.
    const gaps = [];
    for (let i = 1; i < compras.length; i++) gaps.push(Math.round((compras[i].ts - compras[i - 1].ts) / DIA));
    g.ritmo = gaps.length >= 2 ? mediana(gaps) : (gaps.length === 1 ? gaps[0] : null);
    if (g.ritmo != null && g.ritmo < 1) g.ritmo = 1;

    // Día de la semana en el que suele comprar (si repite en la mitad o más).
    g.diaHabitual = null;
    if (compras.length >= 3) {
      const cont = {};
      const ult = compras.slice(-8);
      ult.forEach((c) => { const d = new Date(c.ts).getDay(); cont[d] = (cont[d] || 0) + 1; });
      let mejor = null;
      Object.keys(cont).forEach((d) => { if (mejor === null || cont[d] > cont[mejor]) mejor = d; });
      if (mejor !== null && cont[mejor] / ult.length >= 0.5) g.diaHabitual = Number(mejor);
    }

    // Plata
    g.total = compras.reduce((a, c) => a + montoDe(c.p), 0);
    const conMonto = compras.filter((c) => montoDe(c.p) > 0);
    g.ticket = conMonto.length ? Math.round(g.total / conMonto.length) : 0;

    // PRODUCTOS: cuántas veces compró cada uno y cuándo fue la última.
    const prods = {};
    compras.forEach((c) => {
      const vistos = {};
      (c.p.items || []).forEach((it) => {
        const nom = String(it.producto || it.nombre || '').trim();
        const k = prodKey(nom);
        if (!k || vistos[k]) return;      // una sola vez por pedido
        vistos[k] = 1;
        const r = prods[k] || (prods[k] = { key: k, nombre: nom, n: 0, ultima: null });
        r.n++; r.ultima = c.ts; r.nombre = nom;   // nos quedamos con la escritura más nueva
      });
    });
    g.productos = Object.keys(prods).map((k) => prods[k]).sort((a, b) => b.n - a.n);

    // HABITUALES: los que aparecen en la mitad o más de sus compras. Son los que
    // "siempre lleva", y por lo tanto los que hay que ofrecerle sin pensar.
    g.habituales = compras.length >= 2
      ? g.productos.filter((x) => x.n >= Math.max(2, Math.ceil(compras.length * 0.5)))
      : g.productos.slice(0, 3);
    if (!g.habituales.length) g.habituales = g.productos.slice(0, 2);

    g.tipoLabel = (TIPOS[g.tipo] || TIPOS['']).t;
    g.tipoChip = (TIPOS[g.tipo] || TIPOS['']).chip;
    g._compras = compras;
    return g;
  }

  /* ═════════════════ el motor de sugerencias ═════════════════ */

  const HOY0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const dormido = (f) => f.ritmo != null && f.diasDesde != null && f.diasDesde > Math.max(21, f.ritmo * 2.5);

  // ¿Está pospuesta esta sugerencia para este cliente?
  function silenciada(f, tipo) {
    const s = f.snooze || {};
    const h = s[tipo] || s.todo;
    return !!(h && h > Date.now());
  }

  /* Devuelve la lista de "qué hacer hoy", ordenada por urgencia. Cada ítem:
     {id, clienteId, ficha, tipo, prio, ic, titulo, motivo, oferta, msg}   */
  function sugerencias(lista) {
    const fs = lista || fichas();
    const hoy = HOY0();
    const out = [];

    // Para el cross-sell: qué compra la gente del MISMO tipo de cliente. Si el
    // 40% de los revendedores lleva hamburguesa y este no la lleva nunca, ahí
    // hay una venta que hoy se pierde sin que nadie se entere.
    const porTipo = {};
    fs.forEach((f) => {
      if (f.nCompras < 2) return;
      const t = f.tipo || '_';
      const r = porTipo[t] || (porTipo[t] = { n: 0, prod: {} });
      r.n++;
      f.productos.forEach((p) => {
        const e = r.prod[p.key] || (r.prod[p.key] = { n: 0, nombre: p.nombre });
        e.n++;
      });
    });

    fs.forEach((f) => {
      if (f.pausado) return;
      const push = (o) => {
        if (silenciada(f, o.tipo)) return;
        out.push(Object.assign({ clienteId: f.id, ficha: f, id: f.id + ':' + o.tipo }, o));
      };

      /* 1 · RECORDATORIO puesto a mano — siempre primero, es un compromiso. */
      if (f.recordatorio && f.recordatorio.fecha) {
        const t = Date.parse(f.recordatorio.fecha + 'T00:00:00');
        if (!isNaN(t) && t <= hoy) {
          push({
            tipo: 'recordatorio', grupo: 'hoy', prio: 100, ic: '🔔',
            titulo: 'Recordatorio para hoy',
            motivo: f.recordatorio.motivo || 'Tenías anotado contactarlo.',
            oferta: '', msg: msgRecordatorio(f),
          });
        }
      }

      if (f.tienePendiente) return;    // ya tiene un pedido en curso: no molestar

      /* 2 · CLIENTE DORMIDO — el que se está yendo sin avisar. */
      if (dormido(f)) {
        push({
          tipo: 'dormido', grupo: 'hoy', prio: 92, ic: '😴',
          titulo: 'Se está yendo',
          motivo: 'Compraba cada ' + f.ritmo + ' días y hace ' + f.diasDesde + ' que no pide.',
          oferta: listaProd(f.habituales), msg: msgDormido(f),
        });
      } else if (f.ritmo != null && f.diasDesde != null && f.diasDesde >= Math.round(f.ritmo * 1.15)) {
        /* 3 · LE TOCA PEDIDO — el recordatorio de rutina, el que más plata hace. */
        push({
          tipo: 'toca', grupo: 'hoy', prio: 78, ic: '🔁',
          titulo: 'Le toca pedido',
          motivo: 'Compra cada ' + f.ritmo + ' días · el último fue hace ' + f.diasDesde + '.',
          oferta: listaProd(f.habituales), msg: msgToca(f),
        });
      }

      /* 4 · PRIMERA COMPRA SIN SEGUNDA — la venta más fácil de recuperar. */
      if (f.nCompras === 1 && f.diasDesde >= 12 && f.diasDesde <= 90) {
        push({
          tipo: 'sin_segunda', grupo: 'seguimiento', prio: 55, ic: '🌱',
          titulo: 'Compró una sola vez',
          motivo: 'Primera y única compra hace ' + f.diasDesde + ' días. Nunca volvió.',
          oferta: listaProd(f.productos.slice(0, 2)), msg: msgSinSegunda(f),
        });
      }

      /* 5 · DEJÓ DE LLEVAR algo que siempre llevaba. */
      if (f.nCompras >= 4 && !dormido(f)) {
        const enUlt2 = {};
        f._compras.slice(-2).forEach((c) => (c.p.items || []).forEach((it) => {
          enUlt2[prodKey(it.producto || it.nombre || '')] = 1;
        }));
        const cayo = f.habituales.filter((h) => !enUlt2[h.key]);
        if (cayo.length) {
          push({
            tipo: 'dejo', grupo: 'hoy', prio: 68, ic: '📉',
            titulo: 'Dejó de llevar ' + cayo[0].nombre,
            motivo: 'Lo llevaba en ' + cayo[0].n + ' de sus ' + f.nCompras + ' compras y en las últimas 2 no.',
            oferta: cayo.slice(0, 3).map((x) => x.nombre).join(', '), msg: msgDejo(f, cayo[0]),
          });
        }
      }

      /* 6 · BAJÓ EL VOLUMEN — competidor entrando. Se ve antes de perderlo. */
      if (f.nCompras >= 5 && f.total > 0) {
        const prom = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
        const pu = prom(f._compras.slice(-2).map((c) => montoDe(c.p)));
        const pa = prom(f._compras.slice(-5, -2).map((c) => montoDe(c.p)));
        if (pa > 0 && pu > 0 && pu < pa * 0.7) {
          push({
            tipo: 'bajo', grupo: 'hoy', prio: 72, ic: '⚠️',
            titulo: 'Bajó lo que compra',
            motivo: 'Sus últimos pedidos son ' + Math.round((1 - pu / pa) * 100) + '% más chicos que los anteriores.',
            oferta: listaProd(f.habituales), msg: msgBajo(f),
          });
        }
      }

      /* 7 · NUNCA PROBÓ lo que lleva el resto de su categoría (cross-sell). */
      if (f.nCompras >= 2 && !dormido(f)) {
        // Pedimos al menos 6 clientes comparables: con menos, un "el 50% lleva X"
        // sale de 2 personas y no dice nada.
        const r = porTipo[f.tipo || '_'];
        if (r && r.n >= 6) {
          const mio = {}; f.productos.forEach((p) => { mio[p.key] = 1; });
          const cand = Object.keys(r.prod)
            .filter((k) => !mio[k] && r.prod[k].n / r.n >= 0.4)
            .sort((a, b) => r.prod[b].n - r.prod[a].n);
          if (cand.length) {
            const nom = r.prod[cand[0]].nombre;
            push({
              tipo: 'probar', grupo: 'seguimiento', prio: 45, ic: '💡',
              titulo: 'Nunca probó ' + nom,
              motivo: 'Lo lleva el ' + Math.round(r.prod[cand[0]].n / r.n * 100) + '% de los clientes como él.',
              oferta: nom, msg: msgProbar(f, nom),
            });
          }
        }
      }

      /* 8 · SIN TELÉFONO — no es una venta, pero sin esto no hay CRM posible. */
      if (!f.telefono && f.nCompras >= 2) {
        push({
          tipo: 'sin_tel', grupo: 'seguimiento', prio: 20, ic: '📵',
          titulo: 'Sin teléfono cargado',
          motivo: 'Compró ' + f.nCompras + ' veces y no lo podemos contactar.',
          oferta: '', msg: '',
        });
      }
    });

    /* Orden: primero la urgencia, y a igual urgencia LOS QUE MÁS PLATA DEJAN.
       Antes desempataba por antigüedad, y eso ponía arriba al que compró poco
       hace mucho. Si no hay precios cargados, el desempate es cuántas veces
       compró (un cliente que volvió 6 veces vale más que uno que vino una). */
    const valor = (f) => (f.total || 0) * 1000 + (f.nCompras || 0);
    out.sort((a, b) => (b.prio - a.prio)
      || (valor(b.ficha) - valor(a.ficha))
      || ((b.ficha.diasDesde || 0) - (a.ficha.diasDesde || 0)));
    return out;
  }

  /* Una tarjeta POR CLIENTE, no una por aviso. Si de un mismo cliente salen tres
     cosas (le toca pedido + bajó el volumen + dejó de llevar milanesa), es UN
     llamado, no tres: mostramos el motivo más fuerte y el resto como contexto.
     Devuelve la sugerencia principal con `otras` = las demás de ese cliente. */
  function agenda(lista) {
    const sugs = sugerencias(lista);
    const vistos = {};
    const out = [];
    sugs.forEach((s) => {
      const p = vistos[s.clienteId];
      if (p) { p.otras.push(s); return; }
      const item = Object.assign({}, s, { otras: [] });
      vistos[s.clienteId] = item;
      out.push(item);
    });
    return out;
  }

  /* La agenda partida en DOS, que es la diferencia entre una lista que se usa y
     una que no se mira nunca:

     · HOY  — clientes que ya te venían comprando y algo cambió: se están yendo,
              les toca pedido, bajaron el volumen, dejaron de llevar algo. Son
              pocos y cada uno es plata concreta que se está por perder.
     · LUEGO — trabajo de fondo, sobre todo primeras compras que nunca repitieron.
              Vale mucho, pero es una tanda para cuando tengas un rato, no algo
              para hacer hoy. Mezclado con lo de arriba tapaba todo. */
  function agendaPartida(lista) {
    const todo = agenda(lista);
    return {
      hoy: todo.filter((s) => s.grupo === 'hoy'),
      luego: todo.filter((s) => s.grupo !== 'hoy'),
    };
  }

  /* ═════════════════ mensajes de WhatsApp ═════════════════
     Voseo rioplatense, cortos, y SIEMPRE con un paso siguiente concreto.
     Nunca llevan un precio escrito: para eso está la lista viva. */

  /* Cómo saludarlo. Cortar siempre por la primera palabra daba saludos ridículos
     ("Hola Kiosco!", "Hola San!"), así que la regla es al revés: el nombre ENTERO,
     salvo que parezca claramente el de una persona — exactamente dos palabras y
     ninguna de comercio ("Juan Pérez" → "Juan"). Ante la duda, nombre entero:
     nunca queda mal. Las aclaraciones entre paréntesis se sacan. */
  const COMERCIO = ['kiosco', 'kiosko', 'maxikiosco', 'maxi', 'granja', 'carniceria', 'almacen',
    'fiambreria', 'rotiseria', 'polleria', 'verduleria', 'despensa', 'super', 'supermercado',
    'minimercado', 'mini', 'mercado', 'mercadito', 'autoservicio', 'distribuidora', 'deposito',
    'restaurante', 'resto', 'bar', 'parrilla', 'pizzeria', 'panaderia', 'comedor', 'buffet',
    'club', 'colegio', 'escuela', 'hotel', 'catering', 'santa', 'san', 'la', 'el', 'los', 'las',
    'don', 'dona', 'casa', 'lo', 'los'];

  function nombrePila(f) {
    const nom = String(f.nombre || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (!nom) return '';
    const partes = nom.split(' ');
    if (partes.length === 2 && COMERCIO.indexOf(norm(partes[0])) < 0) return partes[0];
    return nom;
  }
  const yo = () => {
    const u = GDO.Store && GDO.Store.current && GDO.Store.current();
    return (u && u.nombre) ? String(u.nombre).trim().split(/\s+/)[0] : '';
  };
  const firma = () => (yo() ? 'Soy ' + yo() + ' de Granja del Oeste' : 'Te escribo de Granja del Oeste');
  const listaProd = (arr) => (arr || []).slice(0, 3).map((x) => x.nombre).join(', ');
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  function msgToca(f) {
    const hab = listaProd(f.habituales);
    const dia = f.diaHabitual != null ? ' Estamos armando el reparto del ' + DIAS[f.diaHabitual] + '.' : '';
    return 'Hola ' + nombrePila(f) + '! ¿Cómo andás? ' + firma() + ' 🐔' + dia +
      (hab ? ' ¿Te preparo lo de siempre (' + hab + ')?' : ' ¿Te preparo el pedido?') +
      ' La lista actualizada está en ' + LISTA_URL + ' — decime qué necesitás y te lo dejo listo.';
  }
  function msgDormido(f) {
    const hab = listaProd(f.habituales);
    return 'Hola ' + nombrePila(f) + '! ' + firma() + '. Hace un tiempo que no te pasamos pedido y te quería preguntar si necesitás reponer' +
      (hab ? ' (' + hab + ')' : '') + '. Seguimos con reparto en tu zona y la lista al día está en ' + LISTA_URL +
      '. Si quedó algo pendiente de la última vez, decime y lo vemos.';
  }
  function msgSinSegunda(f) {
    const p = f.productos[0];
    return 'Hola ' + nombrePila(f) + '! ' + firma() + '. Te escribo para saber qué tal te fue con el pedido de la vez pasada' +
      (p ? ' (' + p.nombre + ')' : '') + '. Si querés repetir o probar otra cosa, la lista está en ' + LISTA_URL +
      ' y te lo mandamos con el reparto.';
  }
  function msgDejo(f, prod) {
    return 'Hola ' + nombrePila(f) + '! ' + firma() + '. Vi que en los últimos pedidos no llevaste ' + prod.nombre +
      '. ¿Te está sobrando o preferís cambiarlo por otra cosa? Si querés te lo sumo al próximo y me decís la cantidad.';
  }
  function msgBajo(f) {
    return 'Hola ' + nombrePila(f) + '! ' + firma() + '. Quería saber cómo viene la venta y si hay algo que podamos mejorar de nuestro lado (cantidad, día de entrega, forma de pago). Cualquier cosa que necesites, la lista está en ' + LISTA_URL + '.';
  }
  function msgProbar(f, nom) {
    return 'Hola ' + nombrePila(f) + '! ' + firma() + '. Te quería contar que además de lo que llevás siempre tenemos ' + nom +
      ', que se lleva mucho entre los clientes como vos. Si te interesa te paso el precio y te lo sumo al próximo pedido.';
  }
  function msgRecordatorio(f) {
    return 'Hola ' + nombrePila(f) + '! ' + firma() + '. ' +
      ((f.recordatorio && f.recordatorio.motivo) || '¿Cómo venís? ¿Necesitás algo para esta semana?');
  }

  /* ═════════════════ acciones ═════════════════ */

  // Guarda cambios de la ficha. Si todavía no existía el documento, lo crea con
  // la clave de agrupación (para que la próxima vez se enganche solo).
  function guardar(f, cambios) {
    const base = {
      claves: f.claves || [],
      nombre: f.nombre || '', telefono: f.telefono || '', direccion: f.direccion || '',
      localidad: f.localidad || '', entrecalles: f.entrecalles || '',
      tipo: f.tipo || '', notas: f.notas || '',
      recordatorio: f.recordatorio || null, snooze: f.snooze || {},
      ultimoContactoTs: f.ultimoContactoTs || null, pausado: !!f.pausado,
    };
    return GDO.Store.upsertCrmCliente(Object.assign({ id: f.docId || null }, base, cambios || {}));
  }

  // "Ya lo contacté": deja constancia y silencia sus avisos hasta la próxima
  // vuelta de compra (nunca menos de 5 días) para no repetir el mismo llamado.
  function marcarContactado(f, tipo) {
    const dias = Math.max(5, Math.round((f.ritmo || 14) * 0.6));
    const sn = Object.assign({}, f.snooze || {});
    sn.todo = Date.now() + dias * DIA;
    return guardar(f, {
      ultimoContactoTs: Date.now(), snooze: sn,
      recordatorio: tipo === 'recordatorio' ? null : (f.recordatorio || null),
    });
  }

  /* Unir dos fichas A MANO: cuando la app no pudo darse cuenta sola (el cliente
     se mudó, cambió de teléfono, o cargó dos números distintos). Queda un solo
     documento con los datos de las dos, y a partir de ahí la unión es permanente:
     los teléfonos de ambas quedan en `claves`, así que agrupar() ya no las separa
     aunque los números no coincidan. */
  function unir(a, b) {
    const claves = {};
    (a.claves || []).forEach((k) => { claves[k] = 1; });
    (b.claves || []).forEach((k) => { claves[k] = 1; });
    // La ficha con más historia manda: es la que tiene los datos más confiables.
    const base = (a.nCompras >= b.nCompras) ? a : b;
    const otro = (base === a) ? b : a;
    const notas = [base.notas, otro.notas].filter(Boolean).join('\n');
    const doc = guardar(base, {
      claves: Object.keys(claves),
      tipo: base.tipo || otro.tipo || '',
      telefono: base.telefono || otro.telefono || '',
      direccion: base.direccion || otro.direccion || '',
      notas: notas,
      recordatorio: base.recordatorio || otro.recordatorio || null,
    });
    // El documento de la otra ficha ya no hace falta (sus claves quedaron acá).
    if (otro.docId && doc && otro.docId !== doc.id) GDO.Store.deleteCrmCliente(otro.docId);
    return doc;
  }

  // Posponer una sugerencia puntual N días (por defecto 7).
  function posponer(f, tipo, dias) {
    const sn = Object.assign({}, f.snooze || {});
    sn[tipo] = Date.now() + (dias || 7) * DIA;
    return guardar(f, { snooze: sn });
  }

  GDO.CRM = {
    fichas, sugerencias, agenda, agendaPartida, guardar, unir, marcarContactado,
    posponer, dormido, sinFecha,
    norm, telKey, dirKey, nomKey, senales, prodKey, fechaDe, montoDe, listaProd,
    TIPOS, DIAS, LISTA_URL,
  };
})();
