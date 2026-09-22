/* ====== Vista: Producción (comanda del día) ======
   Lo que hay que preparar, leído de TODOS los pedidos de un día — los que van a
   domicilio y los que el cliente pasa a buscar, que también se producen.

   Dos listas, a propósito:
   1. LA COMANDA: los productos sumados entre todos los pedidos, SIN decir de
      quién es cada cosa. Es la hoja que va al sector de producción: no necesitan
      saber a qué cliente pertenece cada kilo, necesitan el total a preparar.
   2. EL DETALLE: pedido por pedido, con cliente, horario y aclaraciones. Es la
      hoja de control para armar cada pedido una vez que la mercadería está.

   Las dos se imprimen y se bajan a Excel. Todo se calcula en el momento desde
   /pedidos: no hay ningún número guardado que pueda quedar viejo.

   OJO con las unidades: NO se suman cantidades de distinta unidad bajo el mismo
   producto (20 cajones y 5 kg de pollo no son 25 de nada). El agrupador es
   producto + unidad, y el nombre se normaliza con la misma función que el CRM
   para que "Milanesa de pollo" y "Milanesas de Pollo" sean lo mismo. */
window.GDO = window.GDO || {}; GDO.Views = GDO.Views || {};
(function () {
  const { Store } = GDO;
  const { esc, toast, confirmDlg, esRetiro, fechaEfectiva, diaSemanaDe, vendedorChip } = GDO.UI;

  const fmtM = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
  const nUm = (n) => {
    const x = Math.round((Number(n) || 0) * 100) / 100;
    return x.toLocaleString('es-AR');
  };
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const hoyISO = () => iso(new Date());
  const masDias = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
  /* Kilos de un renglón: los declarados, o los que se deducen de la unidad
     ("12 kg" son 12 kilos) o del peso del bulto que dice el nombre ("SUPREMA
     CONGELADA … X 12 KG" × 2 cajas = 24 kg). Un cajón de pollo no declara kilos
     —depende de las aves—, así que ahí devuelve 0 y la columna queda vacía. */
  const kgDe = (it) => (GDO.Lista ? GDO.Lista.kgDeItem(it) : (Number(it && it.kg) || 0));
  /* Unidad NORMALIZADA del renglón: "u" y "un" son la misma cosa (si no, salían
     sumas absurdas como "27 u + 1 un"), y si la unidad guardada no dice nada
     pero el nombre declara el envase ("… (1 caja)"), esa es la unidad real. */
  const uniDe = (it) => (GDO.Lista ? GDO.Lista.unidadDeItem(it) : String((it && (it.unidad || it.u)) || '').trim());
  /* NOMBRE del producto. Lo que se pide suelto (una pieza de bondiola) tiene que
     decirlo: con el nombre de la fila ("… X CAJA DE 20 KG") la comanda mandaba a
     preparar cajas en vez de piezas. Ver GDO.Lista.nombreItem. */
  const nomDe = (it) => (GDO.Lista ? GDO.Lista.nombreItem(it) : String((it && (it.producto || it.nombre)) || '').trim());
  /* Lo que se MUESTRA como producto: el nombre tal cual está en la lista, SIN la
     presentación que le agrega el sistema a las formas sueltas (" · PAQUETE DE
     2,5 KG", " · POR KG", " · PIEZA SUELTA"). La presentación va en las columnas
     Total · Fracción · Cantidad; en el nombre solo si es parte del nombre real. */
  /* Nombre del PRODUCTO a mostrar: la fila de la lista, pero sin el envase que no
     va entre paréntesis ("BONDIOLA IMPORTADA X CAJA DE 20 KG" → "BONDIOLA
     IMPORTADA"): la caja o la pieza son la FRACCIÓN y van en su columna. Lo que
     está entre paréntesis sí queda: "(6X1KG)" dice cuánto trae cada paquete. */
  const nomProd = (it) => filaDe(it).replace(/\s+X\s+CAJ(AS?|[OÓ]N(ES)?)\s+(DE\s+)?\d+(?:[.,]\d+)?\s*KGS?\.?\s*$/i, '').trim();
  const filaDe = (it) => {
    const orig = String((it && (it.producto || it.nombre)) || '').trim();
    const eq = (GDO.Lista && GDO.Lista.equivDe) ? GDO.Lista.equivDe(orig) : null;   // minorista → mayorista
    let n = eq ? eq.n : orig;
    // Si el pedido guardó el nombre de una forma suelta, volvemos a la fila de la lista.
    if (n.indexOf(' · ') >= 0) {
      const op = GDO.Lista && GDO.Lista.opcionPara ? GDO.Lista.opcionPara(n, 'mayorista') : null;
      n = (op && op.fila) ? op.fila : n.split(' · ')[0].trim();
    }
    return n;
  };
  const largo = (isoStr) => {
    if (!isoStr) return '';
    const d = new Date(isoStr + 'T00:00:00');
    const M = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return diaSemanaDe(isoStr) + ' ' + d.getDate() + ' de ' + M[d.getMonth()] + ' de ' + d.getFullYear();
  };

  // Estado de la pantalla (se conserva mientras no se cambie de sección).
  let dia = hoyISO();
  let incluirCerrados = false;   // sumar también lo ya entregado/retirado
  let unoPorHoja = false;        // al imprimir los pedidos para armar: uno por hoja
  /* MAYORISTA y MINORISTA van en PLANILLAS SEPARADAS (pedido del usuario): se
     preparan distinto (cajas y cajones contra bolsas de 1, 2 y 5 kg), así que cada
     una tiene su comanda, sus pedidos para armar y su impresión. 'todas' las junta. */
  let listaSel = 'minorista';     // arranca en la MINORISTA (pedido del usuario: es la que más trabajo lleva)
  const listaDe = (p) => (p && p.lista === 'minorista' ? 'minorista' : 'mayorista');
  const LISTA_T = { mayorista: 'MAYORISTA', minorista: 'MINORISTA', todas: 'MAYORISTA + MINORISTA' };
  let _listasPedidas = false;    // las listas de precios se piden una vez por sesión

  /* ═══════ CATEGORÍAS ═══════
     La comanda y la hoja de armado van separadas por categoría, EN EL MISMO ORDEN
     que la lista de precios (Cajones de pollo, Trozado, Elaborados…): así el que
     prepara recorre la cámara igual que la lista. La categoría sale de buscar el
     producto en la lista mayorista (y si no está, en la minorista). Lo que no está
     en ninguna (un producto cargado a mano con otro nombre) va a "OTROS". */
  const OTROS = 'OTROS PRODUCTOS';
  const sinForma = (s) => String(s || '').split(' · ')[0].trim();
  const sinParen = (s) => String(s || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  function opcionDe(nom) {
    if (!GDO.Lista || !GDO.Lista.opcionPara) return null;
    return GDO.Lista.opcionPara(nom, 'mayorista')
      || GDO.Lista.opcionPara(sinForma(nom), 'mayorista')
      || GDO.Lista.opcionPara(sinParen(sinForma(nom)), 'mayorista');
  }
  // Orden de las categorías: el de la lista mayorista, después las de la minorista.
  function ordenCategorias() {
    const orden = {};
    let i = 0;
    const may = (GDO.Lista && GDO.Lista.opciones) ? GDO.Lista.opciones('mayorista') : [];
    const min = (GDO.Lista && GDO.Lista.opciones) ? GDO.Lista.opciones('minorista') : [];
    may.forEach((o) => { const c = o.seccion || OTROS; if (orden[c] == null) orden[c] = i++; });
    min.forEach((o) => { const c = String(o.seccion || '').split(' · ')[0] || OTROS; if (orden[c] == null) orden[c] = 1000 + i++; });
    return orden;
  }
  function categoriaDe(it) {
    const op = opcionDe(nomDe(it));
    if (!op) return OTROS;
    const s = String(op.seccion || '').trim();
    // En la minorista la sección es "Categoría · Subcategoría": va la categoría.
    return (op.lista === 'minorista' ? s.split(' · ')[0] : s) || OTROS;
  }
  const posCat = (orden, cat) => (cat === OTROS ? 99999 : (orden[cat] != null ? orden[cat] : 50000));

  /* Pedidos de ese día. Se van los "no entregados" (el cliente no se los llevó)
     y, salvo que se pida, también los ya cerrados: si la comanda se imprime a
     media mañana, lo que ya salió no hay que volver a producirlo. */
  function pedidosDelDia(todasLasListas) {
    return (Store.pedidos() || []).filter((p) => {
      if (fechaEfectiva(p) !== dia) return false;
      if (p.estado === 'no_entregado') return false;
      if (!incluirCerrados && p.estado === 'entregado') return false;
      if (!todasLasListas && listaSel !== 'todas' && listaDe(p) !== listaSel) return false;
      return true;
    }).sort((a, b) => {
      // Primero los retiros (el cliente los viene a buscar y hay hora), después
      // los envíos; dentro de cada grupo, por horario y por cliente.
      const ra = esRetiro(a) ? 0 : 1, rb = esRetiro(b) ? 0 : 1;
      if (ra !== rb) return ra - rb;
      const va = a.ventana || 'zz', vb = b.ventana || 'zz';
      if (va !== vb) return va < vb ? -1 : 1;
      return String(a.cliente || '').localeCompare(String(b.cliente || ''));
    });
  }

  /* LA COMANDA: los productos sumados entre todos los pedidos.
     UNA fila por producto, pero las cantidades se suman POR UNIDAD: 20 cajones y
     5 kg de pollo no son "25" de nada. Si un producto viene en dos unidades, la
     fila muestra las dos ("2 cajones + 15 kg"), que es lo que hay que preparar. */
  /* TOTAL · FRACCIÓN · CANTIDAD de un renglón. "Milanesa de pollo: 10 kg en
     fracciones de 2 kg, 5 unidades" no es lo mismo que "10 kg en una bolsa": el
     que prepara necesita las tres cosas.
       - La fracción la dice el pedido si la guardó (`fraccionKg`, y `bultos`),
         o se deduce del envase (una caja "X 10 KG", un paquete de 2,5 kg).
       - Lo que se pide por kilo sin fracción (a granel) solo tiene total.
       - Lo que no tiene peso (un cajón de pollo, una tarta) se cuenta en su
         unidad: total = cantidad, y la fracción es el envase. */
  /* REGLA DE LOS PARÉNTESIS DEL NOMBRE (pedido del usuario):
     "(6X1KG)" o "(6 X 2,5 KG)" en el nombre = la caja trae 6 PAQUETES de 1 kg
     (o de 2,5 kg). La fracción es el PAQUETE, y como su peso ya lo dice el nombre,
     en la columna Fracción va solo "paquete". 3 kg de un producto "(6X1KG)" son
     3 paquetes. Lo mismo con unidades: "(10X8 UNI)" = paquetes de 8 unidades. */
  const RE_PACK = /\(\s*(\d+)\s*X\s*(\d+(?:[.,]\d+)?)\s*(KGS?|KILOS?|UNI\w*|U)\s*\)/i;
  const r2 = (n) => Math.round(n * 100) / 100;
  function partesDe(it) {
    const cant = Number(it.cantidad != null ? it.cantidad : it.cant) || 0;
    const uni = uniDe(it);
    const fila = filaDe(it);
    const fk = Number(it.fraccionKg) || 0;
    // 1) El pedido guardó la fracción (lo que se elige en la tienda): manda.
    if (fk) {
      const total = uni === 'kg' ? cant : cant * fk;
      return { total: total, totUni: 'kg', frac: nUm(fk) + ' kg', fk: fk, cant: Number(it.bultos) || (uni === 'kg' ? r2(cant / fk) : cant) };
    }
    // 2) El nombre trae "(N X F KG)" / "(N X F UNI)": la fracción es el paquete.
    const m = RE_PACK.exec(fila);
    if (m) {
      const n = parseInt(m[1], 10) || 1;
      const f = parseFloat(m[2].replace(',', '.')) || 0;
      const enKg = /^K/i.test(m[3]);
      const tu = enKg ? 'kg' : 'unidad';
      if (f) {
        if (uni === 'kg' && enKg) return { total: cant, totUni: 'kg', frac: 'paquete', fk: f, cant: r2(cant / f) };
        if (uni === 'caja' || uni === 'cajón') return { total: r2(cant * n * f), totUni: tu, frac: unidadTxt(uni, 1), fk: n * f, cant: cant };
        if (uni !== 'kg') return { total: r2(cant * f), totUni: tu, frac: 'paquete', fk: f, cant: cant };
      }
    }
    // 3) Por kilo, sin fracción conocida: solo el total.
    if (uni === 'kg') return { total: cant, totUni: 'kg', frac: '', fk: 0, cant: null };
    // 4) Bulto con peso. Si el peso YA está en el nombre que se muestra ("SUPREMA
    //    CONGELADA … X 10 KG"), la fracción es solo el envase; si no (la pieza de
    //    bondiola, o la caja que se sacó del nombre), se aclara el peso.
    const env = unidadTxt(uni, 1);
    const kg = kgDe(it);
    if (kg && cant) {
      const fkg = Math.round(kg / cant * 1000) / 1000;
      const enNombre = !it.kg && /\d\s*KGS?\b/i.test(nomProd(it));
      return { total: r2(kg), totUni: 'kg', frac: enNombre ? env : env + ' de ' + nUm(fkg) + ' kg', fk: fkg, cant: cant };
    }
    return { total: cant, totUni: uni, frac: env, fk: 0, cant: cant };
  }
  const totalTxt = (x) => nUm(x.total) + ' ' + (x.totUni === 'kg' ? 'kg' : unidadTxt(x.totUni, x.total));
  const fracTxt = (x) => x.frac || '—';
  const cantNum = (x) => (x.cant == null ? '—' : nUm(x.cant));

  function consolidar(list) {
    const g = {};
    list.forEach((p) => {
      (p.items || []).forEach((it) => {
        const nom = nomProd(it);
        if (!nom) return;
        const uni = uniDe(it);
        const x = partesDe(it);
        // Una fila por producto Y por fracción: 5 bolsas de 2 kg y 3 de 1 kg son
        // dos cosas distintas para preparar, aunque sea el mismo producto.
        const clave = (GDO.CRM ? GDO.CRM.prodKey(nom) : nom.toLowerCase()) + '|' + x.totUni + '|' + x.fk + '|' + x.frac;
        const cant = Number(it.cantidad != null ? it.cantidad : it.cant) || 0;
        const r = g[clave] || (g[clave] = { nombre: nom, cat: categoriaDe(it), total: 0, totUni: x.totUni, frac: x.frac, fk: x.fk, cant: 0, sinCant: false, kg: 0, pedidos: 0, preps: {}, notas: [] });
        r.nombre = nom;                 // nos quedamos con la escritura más nueva
        r.total += x.total;
        if (x.cant == null) r.sinCant = true; else r.cant += x.cant;
        r.kg += kgDe(it);
        r.pedidos++;
        /* CÓMO PREPARARLO. Es lo que convierte la comanda en una orden de
           trabajo: no alcanza con "10 kg de suprema", hace falta saber que 3 van
           fileteados y 4 enteros. Se suma por preparación Y por unidad, porque
           tampoco acá se pueden mezclar kilos con cajones. */
        const prep = String(it.preparacion || '').trim();
        if (prep) {
          const k2 = prep + '|' + uni;
          const pr = r.preps[k2] || (r.preps[k2] = { prep: prep, unidad: uni, cant: 0 });
          pr.cant += cant;
        }
        // Las aclaraciones libres van con SU cantidad, para que producción sepa
        // sobre cuánto aplica. Sin nombre de cliente: eso está en el detalle.
        const nota = String(it.nota || '').trim();
        if (nota) r.notas.push({ texto: nota, cant: cant, unidad: uni });
      });
    });
    const orden = ordenCategorias();
    return Object.keys(g).map((k) => g[k]).map((r) => { if (r.sinCant) r.cant = null; return r; }).sort((a, b) =>
      (posCat(orden, a.cat) - posCat(orden, b.cat)) || a.nombre.localeCompare(b.nombre, 'es') || (b.fk - a.fk));
  }
  // Filas ya ordenadas → grupos { cat, filas } en el mismo orden.
  function porCategoria(filas, catDe) {
    const out = [];
    filas.forEach((f) => {
      const cat = catDe(f);
      const ult = out[out.length - 1];
      if (ult && ult.cat === cat) ult.filas.push(f); else out.push({ cat: cat, filas: [f] });
    });
    return out;
  }

  // "cajón"→"cajones", "caja"→"cajas", "kg"→"kg". El plural sale de la misma
  // tabla de unidades que usa la lista de precios.
  const unidadTxt = (uni, cant) => (GDO.Lista ? GDO.Lista.etiqueta(uni, cant)
    : (uni || (Number(cant) === 1 ? 'unidad' : 'unidades')));

  /* Desglose de cortes de un producto, ordenado de mayor a menor: es la orden de
     trabajo real. Se muestra siempre que haya al menos una preparación elegida
     (si TODO va de una sola forma, igual conviene decirlo). */
  function prepsHTML(r) {
    const ps = Object.keys(r.preps).map((k) => r.preps[k]).sort((a, b) => b.cant - a.cant);
    if (!ps.length) return '';
    return '<ul class="pr-preps">' + ps.map((x) =>
      '<li><span class="pr-tick-mini"></span>' + esc(x.prep) + ' <b>' + nUm(x.cant) + ' ' + esc(unidadTxt(x.unidad, x.cant)) + '</b></li>'
    ).join('') + '</ul>';
  }
  // Aclaraciones de los clientes, con la cantidad sobre la que aplican y SIN
  // decir de quién son (eso está en la hoja de detalle).
  function notasHTML(r) {
    if (!r.notas.length) return '';
    return '<div class="pr-notas">⚠️ ' + r.notas.map((n) =>
      '<span>' + esc(n.texto) + ' <b>(' + nUm(n.cant) + ' ' + esc(unidadTxt(n.unidad, n.cant)) + ')</b></span>'
    ).join(' · ') + '</div>';
  }


  /* Hoja de ARMADO de un pedido: lo que lleva, por categoría, con un espacio a la
     derecha de cada producto para anotar a mano el peso REAL de la balanza (lo
     que se pidió en kilos casi nunca pesa exacto: 5 kg de suprema son 5,12). */
  function hojaPedido(p, orden) {
    const items = (p.items || []).map((it, i) => ({ it: it, i: i, cat: categoriaDe(it) }))
      .sort((a, b) => (posCat(orden, a.cat) - posCat(orden, b.cat)) || (a.i - b.i));
    const grupos = porCategoria(items, (x) => x.cat);
    const donde = esRetiro(p)
      ? '🏪 <b>Retira en el local</b>' + (p.ventana ? ' · ' + esc(p.ventana) : ' · horario a coordinar')
      : '🚚 <b>Envío</b> · ' + esc(p.direccion || '') + (p.localidad ? ', ' + esc(p.localidad) : '') + (p.entrecalles ? ' <span class="muted">(' + esc(p.entrecalles) + ')</span>' : '') + (p.ventana ? ' · ' + esc(p.ventana) : '');
    return `
      <div class="pr-ped">
        <div class="pr-ped-h">
          <div class="pr-ped-cli"><b>${esc(p.cliente)}</b>${listaSel === 'todas' ? ' <span class="chip ' + (listaDe(p) === 'minorista' ? 'chip-retiro' : 'chip-envio') + '" style="font-size:10px">' + (listaDe(p) === 'minorista' ? '🏠 Minorista' : '🏪 Mayorista') + '</span>' : ''}${vendedorChip(p)}${p.prioridad === 'alta' ? ' <span class="chip chip-no" style="font-size:10px">★ alta</span>' : ''}
            ${p.telefono ? '<span class="pr-ped-tel">📞 ' + esc(p.telefono) + '</span>' : ''}</div>
          <div class="pr-ped-donde">${donde}</div>
        </div>
        ${items.length ? `<table class="pr-arm"><thead><tr>
            <th style="width:26px"></th><th>Producto</th><th>Total</th><th>Fracción</th><th>Cantidad</th><th class="pr-bal-h">Peso real (balanza)</th>
          </tr></thead><tbody>${grupos.map((g) => `
            <tr class="pr-cat"><td colspan="6">${esc(g.cat)}</td></tr>
            ${g.filas.map((x) => {
              const it = x.it;
              const prep = String(it.preparacion || '').trim();
              const nota = String(it.nota || '').trim();
              const pt = partesDe(it);
              return `<tr>
                <td class="pr-tick"></td>
                <td><b>${esc(nomProd(it))}</b>${prep ? '<div class="pr-prep">✂️ ' + esc(prep) + '</div>' : ''}${nota ? '<div class="pr-nota">📝 ' + esc(nota) + '</div>' : ''}</td>
                <td class="pr-cant">${esc(totalTxt(pt))}</td>
                <td class="pr-frac">${esc(fracTxt(pt))}</td>
                <td class="pr-cant">${esc(cantNum(pt))}</td>
                <td class="pr-bal"><span class="pr-linea"></span> kg</td>
              </tr>`;
            }).join('')}`).join('')}</tbody></table>`
          : '<div class="muted small" style="padding:8px 0">Sin detalle de productos</div>'}
        ${p.especificaciones ? '<div class="pr-esp">📝 ' + esc(p.especificaciones) + '</div>' : ''}
        <div class="pr-firma"><span>Armó: <span class="pr-linea"></span></span><span>Bultos: <span class="pr-linea corta"></span></span><span>Controló: <span class="pr-linea"></span></span></div>
      </div>`;
  }

  /* ─────────────────────────── pantalla ─────────────────────────── */
  GDO.Views.produccion = function (c) {
    // Solo administración, igual que Métricas: acá está todo lo que se vende en
    // el día junto, cliente por cliente.
    if (Store.rolActivo() !== 'admin') {
      c.innerHTML = '<div class="empty">Esta sección es solo para la administración.</div>';
      return;
    }
    /* Las listas de precios dicen a qué CATEGORÍA pertenece cada producto. Se piden
       una vez por sesión y, cuando llegan, se vuelve a pintar ordenado. */
    if (GDO.Lista && !_listasPedidas) {
      _listasPedidas = true;
      Promise.all([GDO.Lista.cargar('mayorista'), GDO.Lista.cargar('minorista')])
        .then(() => { if (document.body.contains(c)) GDO.Views.produccion(c); })
        .catch(() => {});
    }
    const delDia = pedidosDelDia(true);
    const nLista = { mayorista: delDia.filter((p) => listaDe(p) === 'mayorista').length, minorista: delDia.filter((p) => listaDe(p) === 'minorista').length, todas: delDia.length };
    const list = pedidosDelDia();
    const com = consolidar(list);
    const orden = ordenCategorias();
    const gruposCom = porCategoria(com, (r) => r.cat);
    const nRet = list.filter((p) => esRetiro(p)).length;
    const kgTot = com.reduce((a, r) => a + r.kg, 0);
    const total = list.reduce((a, p) => a + (GDO.CRM ? GDO.CRM.montoDe(p) : 0), 0);

    c.innerHTML = `
      <div class="section-title"><h2>Producción</h2></div>

      <div class="toolbar no-print">
        <div class="p-fechas" title="Día a producir">
          <span class="ic">📅</span>
          <input type="date" id="pr-dia" value="${esc(dia)}"/>
        </div>
        <button class="btn btn-ghost btn-sm" id="pr-hoy">Hoy</button>
        <button class="btn btn-ghost btn-sm" id="pr-man">Mañana</button>
        <label class="pr-check"><input type="checkbox" id="pr-cerr" ${incluirCerrados ? 'checked' : ''}/> Incluir lo ya entregado / retirado</label>
        <div class="spacer"></div>
        <button class="btn btn-ghost" id="pr-xls" title="Comanda y pedidos para armar, en dos hojas">📊 Excel</button>
        <button class="btn btn-ghost" data-pdf="com">📄 PDF comanda</button>
        <button class="btn btn-ghost" data-pdf="ped">📄 PDF pedidos para armar</button>
      </div>
      <div class="crm-tabs no-print pr-listas">
        <button class="crm-tab ${listaSel === 'mayorista' ? 'on' : ''}" data-lista="mayorista">🏪 Planilla MAYORISTA <span class="crm-badge sec">${nLista.mayorista}</span></button>
        <button class="crm-tab ${listaSel === 'minorista' ? 'on' : ''}" data-lista="minorista">🏠 Planilla MINORISTA <span class="crm-badge sec">${nLista.minorista}</span></button>
        <button class="crm-tab ${listaSel === 'todas' ? 'on' : ''}" data-lista="todas">Ambas <span class="crm-badge sec">${nLista.todas}</span></button>
      </div>
      <div class="toolbar no-print pr-imprimir">
        <b>🖨 Imprimir:</b>
        <button class="btn btn-primary btn-sm" data-imp="com">Comanda ${esc(listaSel === 'todas' ? '' : listaSel)}</button>
        <button class="btn btn-primary btn-sm" data-imp="ped">Pedidos para armar ${esc(listaSel === 'todas' ? '' : listaSel)}</button>
        <button class="btn btn-ghost btn-sm" data-imp="todo">Todo</button>
        <label class="pr-check"><input type="checkbox" id="pr-una" ${unoPorHoja ? 'checked' : ''}/> Un pedido por hoja</label>
      </div>

      ${!list.length ? `<div class="empty">No hay pedidos ${listaSel === 'todas' ? '' : esc(listaSel === 'mayorista' ? 'mayoristas' : 'minoristas') + ' '}para el ${esc(largo(dia))}.</div>` : `
      <div class="cards no-print" style="margin-bottom:18px">
        <div class="card kpi naranja"><span class="ic">📦</span><span class="num">${list.length}</span><span class="lbl">Pedidos del día${nRet ? ' · ' + nRet + ' de retiro' : ''}</span></div>
        <div class="card kpi negro"><span class="ic">🧾</span><span class="num">${com.length}</span><span class="lbl">Productos distintos</span></div>
        <div class="card kpi amarillo"><span class="ic">⚖️</span><span class="num">${kgTot ? nUm(kgTot) + ' kg' : '—'}</span><span class="lbl">Kilos declarados</span></div>
        <div class="card kpi negro"><span class="ic">💰</span><span class="num">${total ? fmtM(total) : '—'}</span><span class="lbl">Valor del día</span></div>
      </div>

      <div class="pr-bloque-com">
        <div class="solo-print pr-hoja">
          <div class="pr-hoja-h">
            <img src="assets/logo-horizontal-color.svg" alt="Granja del Oeste"/>
            <div><b>Comanda de producción · ${esc(LISTA_T[listaSel])}</b><span>${esc(largo(dia))} · ${list.length} pedidos</span></div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-h">
            <h3>🍗 Hay que preparar</h3>
            <span class="small muted no-print">Sumado entre los ${list.length} pedidos del día · por categoría, como la lista de precios</span>
          </div>
          <div class="panel-b flush">
            <table class="pr-com"><thead><tr>
              <th style="width:34px"></th><th>Producto</th><th>Total</th><th>Fracción</th><th>Cantidad</th><th class="no-print">En pedidos</th>
            </tr></thead><tbody>${gruposCom.map((g) => `
              <tr class="pr-cat"><td colspan="6">${esc(g.cat)}</td></tr>
              ${g.filas.map((r) => `
              <tr>
                <td class="pr-tick"></td>
                <td>
                  <b>${esc(r.nombre)}</b>
                  ${prepsHTML(r)}
                  ${notasHTML(r)}
                </td>
                <td class="pr-cant">${esc(totalTxt(r))}</td>
                <td class="pr-frac">${esc(fracTxt(r))}</td>
                <td class="pr-cant">${esc(cantNum(r))}</td>
                <td class="small muted no-print">${r.pedidos}</td>
              </tr>`).join('')}`).join('')}</tbody></table>
            <div class="help no-print" style="padding:10px 18px;line-height:1.6">
              Las cantidades se suman <b>por unidad y por presentación</b>: cajones, kilos y paquetes no se mezclan
              en un solo número, y cada presentación del producto es su propia fila. <b>Kg</b> es el peso que informa el pedido, cuando lo trae.
            </div>
          </div>
        </div>
      </div>

      <div class="pr-bloque-ped pr-salto${unoPorHoja ? ' pr-una' : ''}">
        <div class="solo-print pr-hoja">
          <div class="pr-hoja-h">
            <img src="assets/logo-horizontal-color.svg" alt="Granja del Oeste"/>
            <div><b>Pedidos para armar · ${esc(LISTA_T[listaSel])}</b><span>${esc(largo(dia))} · ${list.length} pedidos · anotá el peso real al lado de cada producto</span></div>
          </div>
        </div>
        <div class="panel-h no-print" style="background:#fff;border:1px solid var(--gris-bd);border-radius:var(--radio) var(--radio) 0 0">
          <h3>📋 Pedidos para armar</h3>
          <span class="small muted">Uno por uno, con lugar para anotar el peso real de la balanza</span>
        </div>
        <div class="pr-peds">${list.map((p) => hojaPedido(p, orden)).join('')}</div>
      </div>`}`;

    const repintar = () => GDO.Views.produccion(c);
    const inD = c.querySelector('#pr-dia');
    inD.onfocus = inD.onclick = () => { try { inD.showPicker && inD.showPicker(); } catch (e) {} };
    inD.onchange = () => { if (!inD.value) { inD.value = dia; return; } dia = inD.value; repintar(); };
    c.querySelector('#pr-hoy').onclick = () => { dia = hoyISO(); repintar(); };
    c.querySelector('#pr-man').onclick = () => { dia = masDias(1); repintar(); };
    c.querySelector('#pr-cerr').onchange = (e) => { incluirCerrados = e.target.checked; repintar(); };
    c.querySelector('#pr-una').onchange = (e) => { unoPorHoja = e.target.checked; repintar(); };
    c.querySelectorAll('[data-lista]').forEach((b) => b.onclick = () => { listaSel = b.dataset.lista; repintar(); });
    /* Qué se imprime: la comanda, los pedidos para armar o todo. Se marca en el
       <body> y el CSS de impresión esconde lo que no va. */
    c.querySelectorAll('[data-imp]').forEach((b) => b.onclick = () => {
      if (!list.length) { toast('No hay pedidos para imprimir en ese día', 'err'); return; }
      document.body.setAttribute('data-pr', b.dataset.imp);
      const limpiar = () => { document.body.removeAttribute('data-pr'); window.removeEventListener('afterprint', limpiar); };
      window.addEventListener('afterprint', limpiar);
      window.print();
    });
    c.querySelector('#pr-xls').onclick = () => bajarExcel(com, list);
    c.querySelectorAll('[data-pdf]').forEach((b) => b.onclick = () => bajarPDF(b.dataset.pdf, c));
  };

  /* ─────────────────────────── exportar ───────────────────────────
     EXCEL de verdad (.xlsx con formato: categorías en naranja, encabezados,
     anchos de columna) y PDF igual a la hoja impresa. Antes era un CSV: se abría
     en Excel como texto pelado y se veía mal. Las librerías se bajan de la CDN
     recién cuando se toca el botón, así el panel no carga peso de más. */
  const LIB_XLSX = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
  const LIB_PDF = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
  const _libs = {};
  function cargarLib(url, global) {
    if (window[global]) return Promise.resolve(window[global]);
    if (!_libs[url]) {
      _libs[url] = new Promise((ok, mal) => {
        const s = document.createElement('script');
        s.src = url; s.async = true;
        s.onload = () => (window[global] ? ok(window[global]) : mal(new Error('lib')));
        s.onerror = () => { delete _libs[url]; mal(new Error('red')); };
        document.head.appendChild(s);
      });
    }
    return _libs[url];
  }
  const nombreArchivo = (qué, ext) => 'gdo-' + qué + '-' + listaSel + '-' + dia + '.' + ext;
  const prepsTxt = (r) => Object.keys(r.preps).map((k) => r.preps[k]).sort((a, b) => b.cant - a.cant)
    .map((x) => x.prep + ' ' + nUm(x.cant) + ' ' + unidadTxt(x.unidad, x.cant)).join(' · ');
  const notasTxt = (r) => r.notas.map((n) => n.texto + ' (' + nUm(n.cant) + ' ' + unidadTxt(n.unidad, n.cant) + ')').join(' · ');

  function bajarExcel(com, list) {
    if (!list.length) { toast('No hay pedidos ese día', 'err'); return; }
    toast('Armando el Excel…', '');
    cargarLib(LIB_XLSX, 'XLSX').then((X) => {
      const NAR = 'F58220', NEG = '111111';
      const borde = { style: 'thin', color: { rgb: 'D9D9D9' } };
      const st = {
        titulo: { font: { bold: true, sz: 15 } },
        sub: { font: { italic: true, color: { rgb: '555555' } } },
        head: { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: NEG } }, alignment: { vertical: 'center', wrapText: true } },
        cat: { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: NAR } } },
        cli: { font: { bold: true, sz: 12 }, fill: { fgColor: { rgb: 'FFF1E3' } } },
        info: { font: { color: { rgb: '444444' } }, fill: { fgColor: { rgb: 'FFF8F0' } }, alignment: { wrapText: true } },
        txt: { border: { bottom: borde }, alignment: { vertical: 'top', wrapText: true } },
        num: { font: { bold: true }, border: { bottom: borde }, alignment: { horizontal: 'center', vertical: 'top' } },
        peso: { border: { bottom: { style: 'medium', color: { rgb: '333333' } } } },
      };
      function hoja(filas, anchos) {
        const ws = X.utils.aoa_to_sheet(filas.map((f) => f.v));
        ws['!cols'] = anchos.map((w) => ({ wch: w }));
        ws['!merges'] = [];
        filas.forEach((f, r) => {
          f.v.forEach((_, c) => {
            const ref = X.utils.encode_cell({ r: r, c: c });
            if (!ws[ref]) ws[ref] = { t: 's', v: '' };
            const s = (f.estilos && f.estilos[c]) || f.estilo;
            if (s) ws[ref].s = s;
          });
          if (f.unir) ws['!merges'].push({ s: { r: r, c: 0 }, e: { r: r, c: anchos.length - 1 } });
        });
        return ws;
      }
      const titulo = (t) => ({ v: [t], estilo: st.titulo, unir: true });
      const subt = (t) => ({ v: [t], estilo: st.sub, unir: true });
      const vacia = { v: [''] };

      // Hoja 1: COMANDA
      const f1 = [titulo('COMANDA DE PRODUCCIÓN · ' + LISTA_T[listaSel]), subt(largo(dia) + ' · ' + list.length + ' pedidos'), vacia,
        { v: ['Producto', 'Total', 'Fracción', 'Cantidad', 'Preparación / aclaraciones', 'En pedidos'], estilo: st.head }];
      porCategoria(com, (r) => r.cat).forEach((g) => {
        f1.push({ v: [g.cat, '', '', '', '', ''], estilo: st.cat, unir: true });
        g.filas.forEach((r) => {
          const extra = [prepsTxt(r), notasTxt(r)].filter(Boolean).join(' — ');
          f1.push({ v: [r.nombre, totalTxt(r), fracTxt(r), r.cant == null ? '—' : r.cant, extra, r.pedidos],
            estilos: [st.txt, st.num, st.num, st.num, st.txt, st.num] });
        });
      });

      // Hoja 2: PEDIDOS PARA ARMAR (uno debajo del otro, con la columna para el peso)
      const orden = ordenCategorias();
      const f2 = [titulo('PEDIDOS PARA ARMAR · ' + LISTA_T[listaSel]), subt(largo(dia) + ' · anotá el peso real de la balanza en cada producto'), vacia];
      list.forEach((p) => {
        const donde = esRetiro(p)
          ? 'Retira en el local' + (p.ventana ? ' · ' + p.ventana : ' · horario a coordinar')
          : 'Envío · ' + (p.direccion || '') + (p.localidad ? ', ' + p.localidad : '') + (p.ventana ? ' · ' + p.ventana : '');
        const v = GDO.UI.vendedorDe ? GDO.UI.vendedorDe(p) : null;
        f2.push({ v: [p.cliente + (p.telefono ? '   ·   ' + p.telefono : '') + (v ? '   ·   Vendedor: ' + v.nombre : ''), '', '', '', '', ''], estilo: st.cli, unir: true });
        f2.push({ v: [donde + (p.especificaciones ? '   ·   ' + p.especificaciones : ''), '', '', '', '', ''], estilo: st.info, unir: true });
        f2.push({ v: ['Producto', 'Total', 'Fracción', 'Cantidad', 'Peso real (kg)', 'Aclaración'], estilo: st.head });
        const items = (p.items || []).map((it, i) => ({ it: it, i: i, cat: categoriaDe(it) }))
          .sort((a, b) => (posCat(orden, a.cat) - posCat(orden, b.cat)) || (a.i - b.i));
        porCategoria(items, (x) => x.cat).forEach((g) => {
          f2.push({ v: [g.cat, '', '', '', '', ''], estilo: st.cat, unir: true });
          g.filas.forEach((x) => {
            const it = x.it, pt = partesDe(it);
            const acl = [String(it.preparacion || '').trim(), String(it.nota || '').trim()].filter(Boolean).join(' — ');
            f2.push({ v: [nomProd(it), totalTxt(pt), fracTxt(pt), pt.cant == null ? '—' : pt.cant, '', acl],
              estilos: [st.txt, st.num, st.num, st.num, st.peso, st.txt] });
          });
        });
        f2.push(vacia);
      });

      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, hoja(f1, [52, 14, 20, 11, 42, 11]), 'Comanda');
      X.utils.book_append_sheet(wb, hoja(f2, [52, 14, 20, 11, 18, 36]), 'Pedidos para armar');
      X.writeFile(wb, nombreArchivo('produccion', 'xlsx'));
      toast('Excel descargado ✓', 'ok');
    }).catch(() => toast('No se pudo armar el Excel (¿sin internet?)', 'err'));
  }

  /* PDF: la MISMA hoja que se imprime (logo, categorías, líneas para el peso),
     armada aparte con los estilos de impresión y pasada a PDF. */
  function bajarPDF(qué, c) {
    const bloques = qué === 'com' ? ['.pr-bloque-com'] : qué === 'ped' ? ['.pr-bloque-ped'] : ['.pr-bloque-com', '.pr-bloque-ped'];
    const nodos = bloques.map((s) => c.querySelector(s)).filter(Boolean);
    if (!nodos.length) { toast('No hay pedidos ese día', 'err'); return; }
    toast('Armando el PDF…', '');
    cargarLib(LIB_PDF, 'html2pdf').then((h2p) => {
      const cont = document.createElement('div');
      cont.className = 'pr-pdf' + (unoPorHoja ? ' pr-una' : '');
      nodos.forEach((n, i) => {
        const cl = n.cloneNode(true);
        cl.classList.remove('pr-salto');
        if (i > 0) cl.classList.add('pr-pdf-salto');
        // El logo es un SVG sin medidas propias: sin ancho y alto fijos no se dibuja.
        // Lo pasamos a PNG dibujándolo en un lienzo (html2canvas no dibuja ese SVG).
        cl.querySelectorAll('img').forEach((im) => {
          const orig = c.querySelector('img[src="' + im.getAttribute('src') + '"]');
          const r = (orig && orig.naturalWidth && orig.naturalHeight) ? orig.naturalWidth / orig.naturalHeight : 3.2;
          const h = 40, w = Math.round(40 * r);
          im.height = h; im.width = w;
          try {
            if (orig && orig.complete) {
              const cv = document.createElement('canvas');
              cv.width = w * 3; cv.height = h * 3;
              cv.getContext('2d').drawImage(orig, 0, 0, cv.width, cv.height);
              im.src = cv.toDataURL('image/png');
            }
          } catch (e) { /* si no se puede, va sin logo */ }
        });
        cont.appendChild(cl);
      });
      // Fuera de pantalla, pero en el flujo normal: si el contenedor mismo fuera
      // "fixed", la copia que arma la librería queda con alto 0 y el PDF sale en blanco.
      const holder = document.createElement('div');
      holder.className = 'pr-pdf-holder';
      holder.appendChild(cont);
      document.body.appendChild(holder);
      return h2p().set({
        margin: [10, 10, 12, 10],
        filename: nombreArchivo(qué === 'com' ? 'comanda' : qué === 'ped' ? 'pedidos' : 'produccion', 'pdf'),
        image: { type: 'jpeg', quality: 0.96 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'], before: '.pr-pdf-salto' + (unoPorHoja ? ', .pr-una .pr-ped + .pr-ped' : ''), avoid: ['tr', '.pr-ped', '.pr-ped-h'] },
      }).from(cont).save().then(() => { holder.remove(); toast('PDF descargado ✓', 'ok'); }, () => { holder.remove(); toast('No se pudo armar el PDF', 'err'); });
    }).catch(() => toast('No se pudo armar el PDF (¿sin internet?)', 'err'));
  }
})();
