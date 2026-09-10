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
  const { esc, toast, confirmDlg, esRetiro, fechaEfectiva, diaSemanaDe } = GDO.UI;

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
  const largo = (isoStr) => {
    if (!isoStr) return '';
    const d = new Date(isoStr + 'T00:00:00');
    const M = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return diaSemanaDe(isoStr) + ' ' + d.getDate() + ' de ' + M[d.getMonth()] + ' de ' + d.getFullYear();
  };

  // Estado de la pantalla (se conserva mientras no se cambie de sección).
  let dia = hoyISO();
  let incluirCerrados = false;   // sumar también lo ya entregado/retirado

  /* Pedidos de ese día. Se van los "no entregados" (el cliente no se los llevó)
     y, salvo que se pida, también los ya cerrados: si la comanda se imprime a
     media mañana, lo que ya salió no hay que volver a producirlo. */
  function pedidosDelDia() {
    return (Store.pedidos() || []).filter((p) => {
      if (fechaEfectiva(p) !== dia) return false;
      if (p.estado === 'no_entregado') return false;
      if (!incluirCerrados && p.estado === 'entregado') return false;
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
  function consolidar(list) {
    const g = {};
    list.forEach((p) => {
      (p.items || []).forEach((it) => {
        const nom = nomDe(it);
        if (!nom) return;
        const uni = uniDe(it);
        const clave = GDO.CRM ? GDO.CRM.prodKey(nom) : nom.toLowerCase();
        const cant = Number(it.cantidad != null ? it.cantidad : it.cant) || 0;
        const r = g[clave] || (g[clave] = { nombre: nom, unidades: {}, kg: 0, pedidos: 0, preps: {}, notas: [] });
        r.nombre = nom;                 // nos quedamos con la escritura más nueva
        r.unidades[uni] = (r.unidades[uni] || 0) + cant;
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
    return Object.keys(g).map((k) => g[k]).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  // "cajón"→"cajones", "caja"→"cajas", "kg"→"kg". El plural sale de la misma
  // tabla de unidades que usa la lista de precios.
  const unidadTxt = (uni, cant) => (GDO.Lista ? GDO.Lista.etiqueta(uni, cant)
    : (uni || (Number(cant) === 1 ? 'unidad' : 'unidades')));
  const cantTxt = (r) => Object.keys(r.unidades)
    .map((u) => nUm(r.unidades[u]) + ' ' + unidadTxt(u, r.unidades[u]))
    .join(' + ');
  /* Un renglón del detalle. La UNIDAD va SIEMPRE escrita: si el pedido se cargó
     a mano sin unidad, "20" solo no dice si son 20 kilos, 20 cajones o 20 pollos
     — en producción eso es la diferencia entre preparar bien y preparar mal. Sin
     unidad cargada asumimos unidades y lo decimos con esa palabra. Si el
     producto además informa el peso, va entre paréntesis. */
  const itemTxt = (it) => {
    const cant = Number(it.cantidad != null ? it.cantidad : it.cant) || 0;
    const uni = uniDe(it);
    // El peso solo se agrega si la unidad NO es el kilo (si no, se repetiría).
    const kg = uni.toLowerCase() === 'kg' ? 0 : kgDe(it);
    const prep = String(it.preparacion || '').trim();
    return nUm(cant) + ' ' + unidadTxt(uni, cant) + (kg ? ' (' + nUm(kg) + ' kg)' : '')
      + ' · ' + nomDe(it)
      + (prep ? ' — ✂️ ' + prep : '');
  };

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

  /* ─────────────────────────── pantalla ─────────────────────────── */
  GDO.Views.produccion = function (c) {
    // Solo administración, igual que Métricas: acá está todo lo que se vende en
    // el día junto, cliente por cliente.
    if (Store.rolActivo() !== 'admin') {
      c.innerHTML = '<div class="empty">Esta sección es solo para la administración.</div>';
      return;
    }
    const list = pedidosDelDia();
    const com = consolidar(list);
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
        <button class="btn btn-ghost" id="pr-xls-com">⬇ Comanda (Excel)</button>
        <button class="btn btn-ghost" id="pr-xls-det">⬇ Detalle (Excel)</button>
        <button class="btn btn-primary" id="pr-print">🖨 Imprimir</button>
      </div>

      <div class="solo-print pr-hoja">
        <div class="pr-hoja-h">
          <img src="assets/logo-horizontal-color.svg" alt="Granja del Oeste"/>
          <div><b>Comanda de producción</b><span>${esc(largo(dia))}</span></div>
        </div>
      </div>

      ${!list.length ? `<div class="empty">No hay pedidos para el ${esc(largo(dia))}.</div>` : `
      <div class="cards no-print" style="margin-bottom:18px">
        <div class="card kpi naranja"><span class="ic">📦</span><span class="num">${list.length}</span><span class="lbl">Pedidos del día${nRet ? ' · ' + nRet + ' de retiro' : ''}</span></div>
        <div class="card kpi negro"><span class="ic">🧾</span><span class="num">${com.length}</span><span class="lbl">Productos distintos</span></div>
        <div class="card kpi amarillo"><span class="ic">⚖️</span><span class="num">${kgTot ? nUm(kgTot) + ' kg' : '—'}</span><span class="lbl">Kilos declarados</span></div>
        <div class="card kpi negro"><span class="ic">💰</span><span class="num">${total ? fmtM(total) : '—'}</span><span class="lbl">Valor del día</span></div>
      </div>

      <div class="panel">
        <div class="panel-h">
          <h3>🍗 Hay que preparar</h3>
          <span class="small muted no-print">Sumado entre los ${list.length} pedidos del día · orden alfabético</span>
        </div>
        <div class="panel-b flush">
          <table class="pr-com"><thead><tr>
            <th style="width:34px"></th><th>Producto</th><th>Cantidad</th><th>Kg</th><th class="no-print">En pedidos</th>
          </tr></thead><tbody>${com.map((r) => `
            <tr>
              <td class="pr-tick"></td>
              <td>
                <b>${esc(r.nombre)}</b>
                ${prepsHTML(r)}
                ${notasHTML(r)}
              </td>
              <td class="pr-cant">${esc(cantTxt(r))}</td>
              <td>${r.kg ? nUm(r.kg) + ' kg' : '<span class="muted">—</span>'}</td>
              <td class="small muted no-print">${r.pedidos}</td>
            </tr>`).join('')}</tbody></table>
          <div class="help" style="padding:10px 18px;line-height:1.6">
            Las cantidades se suman <b>por unidad</b>: cajones, kilos y unidades no se mezclan
            en un solo número. Si un producto se pidió de las dos formas, la fila muestra las dos
            (“3 cajones + 12 kg”). <b>Kg</b> es el peso que informa el pedido, cuando lo trae.
          </div>
        </div>
      </div>

      <div class="panel pr-salto">
        <div class="panel-h">
          <h3>📋 Detalle por pedido</h3>
          <span class="small muted no-print">Para armar cada pedido cuando la mercadería está lista</span>
        </div>
        <div class="panel-b flush">
          <table class="pr-det"><thead><tr>
            <th style="width:34px"></th><th>Cliente</th><th>Cómo / cuándo</th><th>Qué lleva</th>
          </tr></thead><tbody>${list.map((p) => `
            <tr>
              <td class="pr-tick"></td>
              <td><b>${esc(p.cliente)}</b>${p.prioridad === 'alta' ? ' <span class="chip chip-no" style="font-size:10px">★</span>' : ''}
                ${p.telefono ? '<div class="small muted">' + esc(p.telefono) + '</div>' : ''}</td>
              <td class="small">
                ${esRetiro(p)
                  ? '🏪 <b>Retira en el local</b>' + (p.ventana ? '<div>' + esc(p.ventana) + '</div>' : '<div class="muted">horario a coordinar</div>')
                  : '🚚 <b>Envío</b><div>' + esc(p.direccion || '') + '</div>' + (p.localidad ? '<div class="muted">' + esc(p.localidad) + '</div>' : '') + (p.ventana ? '<div>' + esc(p.ventana) + '</div>' : '')}
              </td>
              <td class="small">
                ${(p.items || []).length
                  ? '<ul class="pr-items">' + (p.items || []).map((it) => '<li>' + esc(itemTxt(it)) + (it.nota && String(it.nota).trim() ? ' <i>— ' + esc(String(it.nota).trim()) + '</i>' : '') + '</li>').join('') + '</ul>'
                  : '<span class="muted">Sin detalle</span>'}
                ${p.especificaciones ? '<div class="pr-esp">📝 ' + esc(p.especificaciones) + '</div>' : ''}
              </td>
            </tr>`).join('')}</tbody></table>
        </div>
      </div>`}`;

    const repintar = () => GDO.Views.produccion(c);
    const inD = c.querySelector('#pr-dia');
    inD.onfocus = inD.onclick = () => { try { inD.showPicker && inD.showPicker(); } catch (e) {} };
    inD.onchange = () => { if (!inD.value) { inD.value = dia; return; } dia = inD.value; repintar(); };
    c.querySelector('#pr-hoy').onclick = () => { dia = hoyISO(); repintar(); };
    c.querySelector('#pr-man').onclick = () => { dia = masDias(1); repintar(); };
    c.querySelector('#pr-cerr').onchange = (e) => { incluirCerrados = e.target.checked; repintar(); };
    c.querySelector('#pr-print').onclick = () => {
      if (!list.length) { toast('No hay pedidos para imprimir en ese día', 'err'); return; }
      window.print();
    };
    c.querySelector('#pr-xls-com').onclick = () => bajarComanda(com, list);
    c.querySelector('#pr-xls-det').onclick = () => bajarDetalle(list);
  };

  /* ─────────────────────────── exportar ───────────────────────────
     CSV con separador ";" y BOM al principio: así el Excel en español lo abre
     en columnas sin tener que importar nada. */
  function csv(nombre, filas) {
    // Los decimales van con COMA: el Excel en español lee "2.5" como texto y
    // después no se puede sumar la columna.
    const q = (s) => {
      const v = (typeof s === 'number') ? String(s).replace('.', ',') : String(s == null ? '' : s);
      return '"' + v.replace(/"/g, '""') + '"';
    };
    const txt = filas.map((f) => f.map(q).join(';')).join('\r\n');
    try {
      const blob = new Blob(['﻿' + txt], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nombre;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      toast('Archivo descargado: ' + nombre, 'ok');
    } catch (e) { toast('No se pudo generar el archivo en este dispositivo', 'err'); }
  }

  function bajarComanda(com, list) {
    if (!com.length) { toast('No hay nada para producir ese día', 'err'); return; }
    const filas = [['COMANDA DE PRODUCCIÓN — ' + largo(dia)], ['Sumado entre ' + list.length + ' pedidos'], [],
      ['Producto', 'Preparación', 'Cantidad', 'Unidad', 'Kg', 'En pedidos', 'Aclaraciones']];
    /* Una fila por producto Y unidad; y si el producto se pide cortado de varias
       formas, una fila POR PREPARACIÓN. Así en Excel cada cantidad es un número
       suelto en su celda y se puede filtrar por corte. */
    com.forEach((r) => {
      const notas = r.notas.map((n) => n.texto + ' (' + n.cant + ' ' + unidadTxt(n.unidad, n.cant) + ')').join(' · ');
      const preps = Object.keys(r.preps).map((k) => r.preps[k]);
      if (preps.length) {
        preps.sort((a, b) => b.cant - a.cant).forEach((x, i) => {
          filas.push([r.nombre, x.prep, x.cant, unidadTxt(x.unidad, x.cant),
            i === 0 ? (r.kg || '') : '', i === 0 ? r.pedidos : '', i === 0 ? notas : '']);
        });
        return;
      }
      Object.keys(r.unidades).forEach((u, i) => {
        filas.push([r.nombre, '', r.unidades[u], unidadTxt(u, r.unidades[u]),
          i === 0 ? (r.kg || '') : '', i === 0 ? r.pedidos : '', i === 0 ? notas : '']);
      });
    });
    csv('gdo-comanda-' + dia + '.csv', filas);
  }

  function bajarDetalle(list) {
    if (!list.length) { toast('No hay pedidos ese día', 'err'); return; }
    // Una fila POR PRODUCTO (no por pedido): así en Excel se puede filtrar,
    // ordenar y hacer tabla dinámica sin desarmar nada a mano.
    const filas = [['DETALLE DE PEDIDOS — ' + largo(dia)], [],
      ['Cliente', 'Teléfono', 'Modalidad', 'Horario', 'Dirección', 'Localidad', 'Producto', 'Preparación', 'Cantidad', 'Unidad', 'Kg', 'Aclaración del producto', 'Comentarios del pedido', 'Estado']];
    list.forEach((p) => {
      const base = [p.cliente || '', p.telefono || '', esRetiro(p) ? 'Retiro en sucursal' : 'Envío a domicilio',
        p.ventana || 'A coordinar', esRetiro(p) ? '' : (p.direccion || ''), p.localidad || ''];
      const cola = [p.especificaciones || '', esRetiro(p) && p.estado === 'entregado' ? 'retirado' : (p.estado || '')];
      if (!(p.items || []).length) { filas.push(base.concat(['(sin detalle)', '', '', '', '', ''], cola)); return; }
      (p.items || []).forEach((it) => {
        filas.push(base.concat([
          nomDe(it),
          String(it.preparacion || '').trim(),
          (it.cantidad != null ? it.cantidad : it.cant) || 0,
          unidadTxt(uniDe(it), Number(it.cantidad != null ? it.cantidad : it.cant) || 0),
          kgDe(it) || '', (it.nota || '').toString().trim(),
        ], cola));
      });
    });
    csv('gdo-pedidos-detalle-' + dia + '.csv', filas);
  }
})();
