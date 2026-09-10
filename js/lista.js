/* ====== GDO Reparto — catálogo de la lista de precios ======
   La UNIDAD de cada producto no se adivina: está en la lista de precios. Un
   cajón de pollo se pide POR CAJÓN, la suprema fresca POR KG (con escalones de
   5 / 60 / 100 kg) y la suprema congelada POR CAJA (de 12 kg cerrados). Son
   productos distintos y no se mezclan.

   Hasta ahora, un pedido cargado a mano en el panel guardaba solo texto libre y
   una cantidad: "20". Después, en la comanda de producción, nadie podía saber si
   eran 20 cajones, 20 kilos o 20 unidades — y en Métricas ese pedido no sumaba
   plata porque tampoco tenía precio. Este módulo trae la MISMA lista que ve el
   cliente (el feed del Apps Script que alimenta lista.granjadeloeste.com) para
   que, al elegir el producto, vengan pegados su nombre exacto, su unidad, su
   escalón de precio y —si se vende por pieza— cuántos kilos pesa cada una.

   El motor de interpretación (encabezados → unidad y escalones) es el MISMO que
   usa la tienda; si allá cambia, hay que cambiarlo acá también.

   Sin internet: se usa la copia guardada de la última vez. Si nunca se cargó,
   el formulario sigue funcionando como antes (producto a mano) y se elige la
   unidad de una lista fija. Nunca bloquea la carga de un pedido. */
window.GDO = window.GDO || {};
(function () {
  const API = 'https://script.google.com/macros/s/AKfycbwH6JW35BRYcBk958OEr4sEvfVIfzgqzQeGwvz63xZYgukwxik8EsIego4d9O456bHURg/exec';
  const CACHE = 'gdo_lista_cache_v1';
  const MAX_EDAD = 12 * 3600 * 1000;          // 12 h: la lista cambia por día, no por minuto

  // Unidades reconocidas en los encabezados de la planilla. Mismo orden y mismos
  // patrones que la tienda: el primero que aparece en el texto es el que manda.
  const UNIDADES = [
    { re: /MAPLES?/, u: 'maple', pl: 'maples' },
    { re: /CAJ[OÓ]N(ES)?/, u: 'cajón', pl: 'cajones' },
    { re: /CAJAS?/, u: 'caja', pl: 'cajas' },
    { re: /BOLSAS?/, u: 'bolsa', pl: 'bolsas' },
    { re: /BANDEJAS?/, u: 'bandeja', pl: 'bandejas' },
    { re: /PAQUETES?/, u: 'paquete', pl: 'paquetes' },
    { re: /PIEZAS?/, u: 'pieza', pl: 'piezas' },
    { re: /(\bKG\b|KILOS?)/, u: 'kg', pl: 'kg' },
    { re: /UNIDADES?|UNIDAD/, u: 'unidad', pl: 'unidades' },
  ];
  const TODAS = UNIDADES.map((d) => d.u);
  function plural(u) { const d = UNIDADES.find((x) => x.u === u); return d ? d.pl : u; }
  function etiqueta(u, cant) {
    if (!u) return (Number(cant) === 1 ? 'unidad' : 'unidades');
    return Number(cant) === 1 ? u : plural(u);
  }

  // "5 CAJAS X KG" → {min:5, unit:'caja'} · "PRECIOS X KG" → {min:1, unit:'kg'}
  function leerEncabezado(h) {
    const str = String(h == null ? '' : h).toUpperCase();
    let best = null;
    UNIDADES.forEach((d) => {
      const m = d.re.exec(str);
      if (m && (best === null || m.index < best.index)) best = { index: m.index, u: d.u };
    });
    if (!best) return null;
    const nm = str.slice(0, best.index).match(/(\d+)\s*$/);
    return { min: nm ? parseInt(nm[1], 10) : 1, unit: best.u };
  }
  // Peso de la pieza declarado en el encabezado ("3 KG C/U APROX" → 3).
  function pesoKgDe(h) {
    const m = String(h == null ? '' : h).toUpperCase().match(/(\d+)\s*(KGS?|KILOS?)\b/);
    return m ? parseInt(m[1], 10) : 0;
  }
  // Precio del escalón que corresponde a esa cantidad (el mayor min que no la pasa).
  function precioPorEscalon(tiers, cant) {
    if (!tiers || !tiers.length) return 0;
    let p = tiers[0].price;
    tiers.forEach((t) => { if (cant >= t.min) p = t.price; });
    return p || 0;
  }

  /* Aplana el feed a una lista de opciones pedibles. Un mismo producto puede dar
     DOS opciones si la planilla lo cotiza de dos formas (por caja y por kg): son
     dos maneras distintas de pedirlo y no se suman entre sí. */
  function aplanar(secciones) {
    const out = [];
    (secciones || []).forEach((sec) => {
      const secPc = leerEncabezado(sec.title || '');
      const secUnit = secPc ? secPc.unit : null;
      (sec.tables || []).forEach((tbl) => {
        const cols = [];
        (tbl.headers || []).forEach((h, i) => {
          if (i === 0 || !h || !String(h).trim()) return;
          const pc = leerEncabezado(h);
          if (pc) { cols.push({ idx: i, min: pc.min, unit: pc.unit, pesoKg: pesoKgDe(h) }); return; }
          // "X 30" sin unidad: la unidad la pone el título de la sección.
          if (secUnit) {
            const nm = String(h).toUpperCase().match(/(\d+)/);
            cols.push({ idx: i, min: nm ? parseInt(nm[1], 10) : 1, unit: secUnit, pesoKg: pesoKgDe(h) });
          }
        });
        (tbl.rows || []).forEach((row) => {
          // Si el NOMBRE dice la unidad (un maple cuyo precio cae en la columna
          // "1 CAJÓN"), esa manda: un cajón son 12 maples, confundirlos es grave.
          const npc = leerEncabezado(row.p);
          const uNombre = (npc && (npc.unit === 'maple' || npc.unit === 'cajón')) ? npc.unit : null;
          const grupos = {};
          cols.forEach((c) => {
            const price = (row.v || [])[c.idx - 1];
            if (price === null || price === undefined || price === '') return;
            const u = uNombre || c.unit;
            (grupos[u] = grupos[u] || []).push({ min: c.min, price: price, pesoKg: c.pesoKg });
          });
          Object.keys(grupos).forEach((u, gi) => {
            const tiers = grupos[u].slice().sort((a, b) => a.min - b.min);
            // Se vende POR PIEZA cuando la unidad secundaria trae un solo escalón
            // con peso fijo: el precio de la planilla es por kilo y cada pieza pesa eso.
            const kgPor = (gi > 0 && tiers.length === 1 && tiers[0].pesoKg > 1) ? tiers[0].pesoKg : 0;
            const unidad = kgPor ? 'pieza' : u;
            out.push({
              // Las formas SUELTAS (pieza, paquete, kilo) llevan nombre propio: el de
              // la fila describe la CAJA. Mismo nombre que arma la tienda.
              nombre: gi > 0 ? nombreOpcion(row.p, unidad, kgPor) : row.p,
              fila: row.p,                  // el nombre tal cual de la planilla
              marca: tbl.brand || '',
              seccion: sec.title || '',
              unidad: unidad,
              kgPor: kgPor,
              tiers: tiers,
              min: /TROZADO/i.test(sec.title || '') ? 5 : 0,   // el trozado es por 5 kg mínimo
            });
          });
        });
      });
    });
    return out;
  }

  /* ===== LISTA MINORISTA =====
     El mismo Apps Script sirve las dos listas: sin parámetro devuelve la
     MAYORISTA (secciones con tablas de escalones) y con `?lista=minorista`
     devuelve la MINORISTA, que tiene otra forma: una fila por VARIEDAD
     ({cat, sub, nombre, desc, variedad, precio}).

     En la minorista, un producto cuyas variedades son todas "N kg" se vende POR
     KILO y esas filas son los escalones (el precio de la fila es el precio POR
     KILO de ese escalón, no el total). El resto son variedades sueltas: cada una
     es una forma distinta de pedir el producto ("1 caja", "1 Paquete", un sabor)
     y la unidad sale de ahí. */
  const RE_SOLO_KG = /^\s*(\d+(?:[.,]\d+)?)\s*kgs?\s*$/i;
  function unidadDeVariedad(v) {
    const t = String(v || '').trim();
    if (!t) return 'unidad';
    // El número es opcional: "PIEZA ENTERA…" y "Caja de 20 kg" también dicen la unidad.
    const m = /^\s*(?:\d+(?:[.,]\d+)?\s*)?([a-zá-úñ]+)/i.exec(t);
    if (!m) return 'unidad';                       // un sabor, no una unidad
    const u = m[1].toLowerCase();
    return SINONIMOS[u] || SINONIMOS[u.replace(/e?s$/, '')] || 'unidad';
  }
  function aplanarMinorista(data) {
    const filas = (data && data.productos) || [];
    const porNombre = {};
    filas.forEach((f) => { (porNombre[f.nombre] = porNombre[f.nombre] || []).push(f); });
    const out = [];
    Object.keys(porNombre).forEach((nombre) => {
      const vs = porNombre[nombre];
      const seccion = (vs[0].cat || '') + (vs[0].sub ? ' · ' + vs[0].sub : '');
      const porKilo = vs.length > 0 && vs.every((v) => RE_SOLO_KG.test(v.variedad || ''));
      if (porKilo) {
        const tiers = vs.map((v) => ({ min: parseFloat(RE_SOLO_KG.exec(v.variedad)[1].replace(',', '.')), price: Number(v.precio) || 0, pesoKg: 0 }))
          .sort((a, b) => a.min - b.min);
        out.push({ nombre: nombre, marca: '', seccion: seccion, unidad: 'kg', kgPor: 0, tiers: tiers,
          min: /MILANES/i.test(vs[0].cat || '') ? 2 : 0, lista: 'minorista' });
        return;
      }
      vs.forEach((v) => {
        out.push({
          nombre: nombre + (v.variedad ? ' (' + v.variedad + ')' : ''),
          marca: '', seccion: seccion,
          unidad: unidadDeVariedad(v.variedad), kgPor: 0,
          tiers: [{ min: 1, price: Number(v.precio) || 0, pesoKg: 0 }],
          min: 0, lista: 'minorista',
        });
      });
    });
    return out;
  }

  // Un catálogo por lista: cada uno con su copia guardada y su carga en curso.
  const CAT = {
    mayorista: { url: API, cache: CACHE, aplanar: aplanar, ops: null, cargando: null },
    minorista: { url: API + '?lista=minorista', cache: CACHE + '_min', aplanar: aplanarMinorista, ops: null, cargando: null },
  };
  const cat = (lista) => CAT[lista === 'minorista' ? 'minorista' : 'mayorista'];

  function guardar(c, data) {
    try { localStorage.setItem(c.cache, JSON.stringify({ ts: Date.now(), data: data })); } catch (e) {}
  }
  function leerCache(c) {
    try {
      const x = JSON.parse(localStorage.getItem(c.cache) || 'null');
      return (x && x.data) ? x : null;
    } catch (e) { return null; }
  }

  /* Carga una lista. Devuelve una promesa con las opciones. Pinta primero con lo
     guardado (instantáneo) y refresca de la red por atrás si está vieja. */
  function cargar(listaOrCb, cb) {
    // Compatible con la forma vieja cargar(onListo): sin lista = mayorista.
    const lista = (typeof listaOrCb === 'string') ? listaOrCb : 'mayorista';
    const onListo = (typeof listaOrCb === 'function') ? listaOrCb : cb;
    const c = cat(lista);
    const guardado = leerCache(c);
    if (guardado && !c.ops) c.ops = c.aplanar(guardado.data);
    const vieja = !guardado || (Date.now() - guardado.ts) > MAX_EDAD;
    if (!c.cargando && vieja) {
      c.cargando = fetch(c.url + (c.url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' })
        .then((r) => { if (!r.ok) throw 0; return r.json(); })
        .then((data) => {
          const ops = c.aplanar(data);
          if (!ops.length) throw 0;
          guardar(c, data);
          c.ops = ops;
          if (onListo) try { onListo(ops); } catch (e) {}
          return ops;
        })
        .catch(() => c.ops || [])
        .then((r) => { c.cargando = null; return r; });
    }
    // Si YA hay algo (la copia guardada), se devuelve al instante y la red
    // refresca por atrás. Si no hay nada —la primera vez en este dispositivo—
    // hay que ESPERAR la red: devolver [] de una dejaba el buscador mudo hasta
    // que alguien volviera a abrir el formulario.
    if (c.ops && c.ops.length) return Promise.resolve(c.ops);
    return c.cargando || Promise.resolve([]);
  }

  const norm = (s) => String(s == null ? '' : s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

  /* Busca por palabras sueltas: "supr cong" encuentra la suprema congelada.
     Ordena poniendo primero lo que empieza con lo escrito. */
  function buscar(texto, max, lista) {
    const q = norm(texto);
    const ops = cat(lista).ops;
    if (!q || !ops) return [];
    const palabras = q.split(' ').filter(Boolean);
    const res = ops.filter((o) => {
      const n = norm(o.nombre + ' ' + o.marca + ' ' + o.seccion);
      return palabras.every((p) => n.indexOf(p) >= 0);
    });
    res.sort((a, b) => {
      const ia = norm(a.nombre).indexOf(palabras[0]), ib = norm(b.nombre).indexOf(palabras[0]);
      if (ia !== ib) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      return a.nombre.length - b.nombre.length;
    });
    return res.slice(0, max || 8);
  }

  /* ===== UNIDAD de un renglón del pedido =====
     Dos problemas reales que aparecieron con los datos en vivo:

     1. La MISMA unidad venía escrita de varias formas ("u", "un", "unidad") y
        al agrupar salían como si fueran distintas: "27 u + 1 un" en vez de
        "28 unidades". Acá se lleva todo a una sola forma.

     2. Los pedidos de la lista minorista guardaban la unidad como "u" aunque el
        producto se venda por CAJA o por MAPLE: la unidad real quedaba escondida
        en el nombre, entre paréntesis ("… (1 caja)"). Cuando la unidad guardada
        no dice nada y el nombre declara un envase de UNO, se usa ese: así
        "27 u" de la suprema congelada se lee "27 cajas", que es lo que hay que
        preparar. Sirve también para los pedidos VIEJOS, sin migrar nada. */
  const SINONIMOS = {
    u: 'unidad', un: 'unidad', uni: 'unidad', unid: 'unidad', unidad: 'unidad', unidades: 'unidad',
    kg: 'kg', kgs: 'kg', k: 'kg', kilo: 'kg', kilos: 'kg',
    cajon: 'cajón', 'cajón': 'cajón', cajones: 'cajón',
    caja: 'caja', cajas: 'caja',
    maple: 'maple', maples: 'maple',
    paquete: 'paquete', paquetes: 'paquete', paq: 'paquete',
    bandeja: 'bandeja', bandejas: 'bandeja',
    bolsa: 'bolsa', bolsas: 'bolsa',
    pieza: 'pieza', piezas: 'pieza',
  };
  // También "(1 Caja x 80 unidades)": la caja de tequeños no son 2 "unidades".
  const RE_ENVASE_UNO = /\(\s*1\s*(kgs?|kilos?|cajones?|caj[oó]n|cajas?|maples?|paquetes?|bandejas?|bolsas?|piezas?|unidad(?:es)?)(?:\s*x\s*\d+\s*unidad(?:es)?)?\s*\)\s*$/i;
  function unidadDeItem(it) {
    if (!it) return '';
    const cruda = String(it.unidad || it.u || '').trim().toLowerCase();
    const canon = SINONIMOS[cruda] || cruda;
    // Si no aporta nada (vacía o "unidad" a secas), miramos el envase del nombre.
    if (!canon || canon === 'unidad') {
      const m = RE_ENVASE_UNO.exec(String(it.producto || it.nombre || ''));
      if (m) {
        const u = m[1].toLowerCase();
        return SINONIMOS[u] || SINONIMOS[u.replace(/e?s$/, '')] || u;
      }
    }
    return canon;
  }

  /* KILOS de un renglón del pedido — el dato que producción necesita para saber
     cuánta mercadería mover, aunque se pida por caja o por cajón:
       · si ya viene declarado (pedidos de la tienda por pieza), ese manda;
       · si la unidad ES el kilo, los kilos SON la cantidad;
       · si el NOMBRE declara el peso del bulto ("SUPREMA CONGELADA … X 12 KG",
         "MEDALLÓN … X 6 KG"), se multiplica por la cantidad de bultos.
     Es una estimación del peso cerrado, no una promesa de balanza: por eso en
     pantalla va como "aprox.". Devuelve 0 cuando no hay forma de saberlo (un
     cajón de pollo no declara kilos: depende de las aves). */
  function kgDeItem(it) {
    if (!it) return 0;
    if (it.kg) return Number(it.kg) || 0;
    const c = Number(it.cantidad != null ? it.cantidad : it.cant) || 0;
    if (!c) return 0;
    const u = unidadDeItem(it);
    if (u === 'kg') return c;
    // "($7700 kg)" es un PRECIO por kilo, no un peso: sin esto, 3 bondiolas de la
    // minorista daban 23.100 kg.
    const nom = String(it.producto || it.nombre || '').toUpperCase().replace(/\$\s*[\d.,]+\s*(KGS?|KILOS?)?/g, ' ');
    // Lo que se pide SUELTO no pesa lo que la caja del nombre: un paquete de
    // "PAPA … X 15 KG (6 X 2,5 KG)" son 2,5 kg, y una pieza de "BONDIOLA … X CAJA
    // DE 20 KG" no son 20.
    if (u === 'pieza' || u === 'paquete') {
      const env = /\(\s*\d+\s*X\s*(\d+(?:[.,]\d+)?)\s*KGS?\s*\)/.exec(nom);
      if (env) return c * (parseFloat(env[1].replace(',', '.')) || 0);
      if (/\b(CAJAS?|CAJ[OÓ]N(ES)?|BOLSAS?)\s*(DE\s*)?\d/.test(nom)) return 0;
    }
    const m = nom.match(/(\d+(?:[.,]\d+)?)\s*KGS?\b/);
    if (m) return c * (parseFloat(m[1].replace(',', '.')) || 0);
    return 0;
  }

  /* NOMBRE de la forma SUELTA de pedir un producto (pieza, paquete, kilo).
     COPIA de nombreOpcion() de gdo-tienda/index.html: si se cambia una, cambiar
     la otra. El nombre de la fila describe la CAJA ("BONDIOLA … X CAJA DE 20
     KG"); si viaja tal cual, la comanda dice "3 piezas · … X CAJA DE 20 KG" y se
     preparan 3 cajas en vez de 3 piezas. */
  function nombreOpcion(nombre, unidad, kgPor) {
    const s = String(nombre || '');
    if (s.indexOf(' · ') >= 0) return s;                       // ya convertido
    const inner = /\(\s*\d+\s*X\s*(\d+(?:[.,]\d+)?)\s*(KGS?|UNI(?:DADES)?)\s*\)/i.exec(s);
    let t = s.replace(/\s*\([^)]*\d[^)]*\)/g, '')
      .replace(/\s*\bX?\s*(?:CAJA|CAJ[OÓ]N|BOLSA)\s*(?:DE\s*)?\d+(?:[.,]\d+)?\s*KGS?\b/i, '')
      .replace(/\s*\bX?\s*\d+(?:[.,]\d+)?\s*KGS?\b/i, '');
    if (inner) t = t.replace(/\s*\bX?\s*\d+\s*UNIDADES?\b/i, '');
    t = t.replace(/\s+/g, ' ').replace(/\s*\bX\s*$/i, '').trim();
    let suf;
    if (kgPor) suf = 'PIEZA SUELTA (~' + kgPor + ' KG)';
    else if (unidad === 'kg') suf = 'POR KG';
    else if (inner) suf = String(unidad).toUpperCase() + ' DE ' + inner[1] + (/^K/i.test(inner[2]) ? ' KG' : ' UNIDADES');
    else suf = 'POR ' + String(unidad).toUpperCase();
    return t + ' · ' + suf;
  }

  // Opciones de una lista sin esperar la red (de la copia guardada, si hay).
  function opsDe(lista) {
    const c = cat(lista);
    if (!c.ops) { const g = leerCache(c); if (g) c.ops = c.aplanar(g.data); }
    return c.ops || [];
  }

  /* Nombre para MOSTRAR un renglón. Los pedidos guardados antes del arreglo
     traen el nombre de la fila ("BONDIOLA … X CAJA DE 20 KG") aunque se hayan
     pedido por pieza: se busca en la lista la forma suelta con esa unidad y se
     muestra su nombre. Sin tocar los pedidos guardados. */
  function nombreItem(it) {
    const nom = String((it && (it.producto || it.nombre)) || '').trim();
    if (!nom || nom.indexOf(' · ') >= 0) return nom;
    const u = unidadDeItem(it);
    const op = opsDe('mayorista').find((o) => o.fila && o.fila !== o.nombre && o.fila === nom && o.unidad === u);
    if (op) return op.nombre;
    if (u === 'pieza' && /\b(CAJAS?|CAJ[OÓ]N(ES)?|BOLSAS?)\s*(DE\s*)?\d/i.test(nom)) {
      const cant = Number(it.cantidad != null ? it.cantidad : it.cant) || 0;
      return nombreOpcion(nom, 'pieza', (it.kg && cant) ? Math.round(it.kg / cant) : 0);
    }
    return nom;
  }

  /* PLATA de un renglón: cantidad × precio, porque `precio` es por la unidad del
     renglón. Excepción: los renglones POR PIEZA guardados antes del 2026-09-10
     traían el precio del KILO (y no traen precioKg): 3 piezas × $6.400 daba
     $19.200 cuando eran 9 kg × $6.400 = $57.600. */
  function montoItem(it) {
    if (!it) return 0;
    const c = Number(it.cantidad != null ? it.cantidad : it.cant) || 0;
    const p = Number(it.precio) || 0;
    if (p && it.kg && it.precioKg == null && unidadDeItem(it) === 'pieza') return p * (Number(it.kg) || 0);
    return c * p;
  }

  /* Busca el producto de un renglón de pedido en los catálogos (primero donde
     diga el pedido, después en el otro). Sirve para poner precio a los pedidos
     VIEJOS, que se guardaron sin el precio de cada producto. Devuelve null si no
     está en ninguna lista o si la lista no se pudo cargar. */
  function opcionPara(nombre, lista) {
    const k = (GDO.CRM ? GDO.CRM.prodKey(nombre) : norm(nombre));
    if (!k) return null;
    const orden = lista === 'minorista' ? ['minorista', 'mayorista'] : ['mayorista', 'minorista'];
    for (let i = 0; i < orden.length; i++) {
      const ops = cat(orden[i]).ops || [];
      const m = ops.find((o) => (GDO.CRM ? GDO.CRM.prodKey(o.nombre) : norm(o.nombre)) === k);
      if (m) return m;
    }
    return null;
  }

  // Cómo queda una opción convertida en renglón de pedido, con la cantidad dada.
  function renglon(op, cant) {
    const c = Number(cant) || 0;
    // OJO: el escalón de precio se busca con la cantidad EN LA UNIDAD EN QUE SE
    // VENDE (5 cajas, 60 kg), no en kilos — salvo en lo que se vende por pieza,
    // donde la planilla cotiza por kilo.
    const pu = precioPorEscalon(op.tiers, op.kgPor ? c * op.kgPor : c);
    const base = {
      producto: op.nombre + (op.marca ? ' (' + op.marca + ')' : ''),
      cantidad: c,
      unidad: op.unidad,
      // `precio` es por la unidad del renglón (cantidad × precio = total): en lo
      // que va por pieza es el de la PIEZA, y el del kilo va aparte.
      precio: op.kgPor ? pu * op.kgPor : pu,
    };
    if (op.kgPor) base.precioKg = pu;
    base.kg = (op.kgPor ? c * op.kgPor : kgDeItem(base)) || null;
    return base;
  }

  /* ===== PREPARACIONES (cómo quiere el cliente el corte) =====
     COPIA de gdo-tienda/preparaciones.js. Está duplicado porque el panel arma
     pedidos por teléfono y tiene que ofrecer EXACTAMENTE las mismas opciones que
     la tienda; si se cambia una lista hay que cambiar la otra.
     Es un dato ELEGIBLE, no un texto: por eso la comanda del día puede sumar
     "10 kg de suprema: 3 fileteados, 3 en cubos, 4 entera". Lo que no entra en
     estas opciones va en la aclaración libre del renglón, que también llega a la
     comanda pero sin sumarse. */
  const PREPS = [
    {
      id: 'suprema',
      // La fresca se corta; la congelada viene en caja cerrada de 12 kg y una
      // hamburguesa o milanesa ya elaborada tampoco se "cortan".
      re: /SUPREMA/i,
      no: /CONGELAD|HAMBURG|MEDALL|MILANES|NUGGET|ARROLL|MATAMBRE/i,
      titulo: '¿Cómo la quiere?',
      opciones: ['Entera', 'Fileteada para milanesa', 'Para churrasquitos', 'En cubos'],
    },
    {
      id: 'cuarto',
      re: /CUARTO\s*TRASERO|PATA\s*Y\s*MUSLO/i,
      no: /CONGELAD|DESHUES|MILANES/i,
      titulo: '¿Cómo lo quiere?',
      opciones: ['Entero', 'Trozado en dos (pata y muslo)', 'Sin piel', 'Trozado y sin piel'],
    },
  ];
  function prepDe(nombre) {
    const n = String(nombre == null ? '' : nombre);
    for (let i = 0; i < PREPS.length; i++) {
      const p = PREPS[i];
      if (p.re.test(n) && !(p.no && p.no.test(n))) return p;
    }
    return null;
  }
  /* RECARGO POR PREPARACIÓN. Filetear, cubetear o trozar es trabajo de gente y
     se cobra $500 el kilo, en todas las versiones. El producto TAL CUAL (la
     primera opción, "Entera"/"Entero") no paga nada. Es el mismo precio que
     cobra la lista mayorista, de donde salen estos productos. */
  const RECARGO_KG = 500;
  function prepConTrabajo(nombre, corte) {
    const d = prepDe(nombre);
    return !!(d && corte && corte !== d.opciones[0]);
  }
  /* El recargo es de la lista MAYORISTA. En la minorista no se cobra: el precio
     por kilo del mostrador ya es otro ($11.350 contra $8.500) y ahí el corte va
     incluido. Por eso hace falta saber de qué lista es el pedido. */
  function prepRecargo(nombre, corte, lista) {
    if (lista === 'minorista') return 0;
    return prepConTrabajo(nombre, corte) ? RECARGO_KG : 0;
  }

  GDO.Lista = {
    prepDe, PREPS, unidadDeItem, prepConTrabajo, prepRecargo, RECARGO_KG, opcionPara,
    cargar, buscar, renglon, precioPorEscalon, etiqueta, plural, kgDeItem,
    nombreOpcion, nombreItem, montoItem,
    UNIDADES: TODAS,
    opciones: () => _opciones || [],
    hay: () => !!(_opciones && _opciones.length),
  };
})();
