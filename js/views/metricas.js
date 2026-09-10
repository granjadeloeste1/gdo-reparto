/* ====== Vista: Métricas ======
   Qué se vendió, a quién, cuándo y qué productos — en el período que se elija.
   Todo se CALCULA en el momento desde /pedidos: no hay ningún número guardado
   que pueda quedar viejo. La fecha de cada venta y el monto salen de las mismas
   funciones que usa el CRM (GDO.CRM.fechaDe / montoDe), así que la ficha del
   cliente y estas métricas nunca se contradicen.

   Criterio de qué cuenta como venta: todo pedido con fecha dentro del período,
   salvo los "no entregados" (esos no se los llevó nadie). Los que todavía no se
   entregaron/retiraron SÍ cuentan (ya están vendidos) y se avisan aparte. */
window.GDO = window.GDO || {}; GDO.Views = GDO.Views || {};
(function () {
  const { Store } = GDO;
  const { esc, toast, esRetiro } = GDO.UI;

  const fmtM = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
  const fmtN = (n) => Number(n || 0).toLocaleString('es-AR');
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const DIAS_C = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const hoyISO = () => iso(new Date());
  const masDias = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

  // Estado de la pantalla (se conserva mientras no se cambie de sección).
  let per = '30d';
  let desde = masDias(-29), hasta = hoyISO();
  let mod = '';              // '' | 'envio' | 'retiro'
  let tab = 'clientes';
  let ordProd = 'unidades';  // unidades | pedidos | monto

  /* Período elegido → rango de fechas (ISO, ambos inclusive). '' = sin límite. */
  function rangoDe(clave) {
    const h = new Date(); h.setHours(0, 0, 0, 0);
    const d = new Date(h);
    switch (clave) {
      case 'hoy': return { desde: iso(h), hasta: iso(h) };
      case '7d': d.setDate(d.getDate() - 6); return { desde: iso(d), hasta: iso(h) };
      case '30d': d.setDate(d.getDate() - 29); return { desde: iso(d), hasta: iso(h) };
      case '90d': d.setDate(d.getDate() - 89); return { desde: iso(d), hasta: iso(h) };
      case 'mes': return { desde: iso(new Date(h.getFullYear(), h.getMonth(), 1)), hasta: iso(new Date(h.getFullYear(), h.getMonth() + 1, 0)) };
      case 'mesant': return { desde: iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), hasta: iso(new Date(h.getFullYear(), h.getMonth(), 0)) };
      case 'anio': return { desde: iso(new Date(h.getFullYear(), 0, 1)), hasta: iso(new Date(h.getFullYear(), 11, 31)) };
      case 'todo': return { desde: '', hasta: '' };
      default: return { desde: desde, hasta: hasta };
    }
  }
  const PERIODOS = [
    { k: 'hoy', t: 'Hoy' }, { k: '7d', t: '7 días' }, { k: '30d', t: '30 días' },
    { k: 'mes', t: 'Este mes' }, { k: 'mesant', t: 'Mes pasado' }, { k: '90d', t: '90 días' },
    { k: 'anio', t: 'Este año' }, { k: 'todo', t: 'Todo' }, { k: 'custom', t: '📅 Elegir fechas' },
  ];

  /* Ventas del período: cada pedido con su fecha y su monto ya resueltos. */
  function ventas() {
    const r = rangoDe(per);
    const t0 = r.desde ? Date.parse(r.desde + 'T00:00:00') : -Infinity;
    const t1 = r.hasta ? Date.parse(r.hasta + 'T23:59:59') : Infinity;
    const out = [];
    (Store.pedidos() || []).forEach((p) => {
      if (p.estado === 'no_entregado') return;                 // no se lo llevó nadie
      if (mod === 'retiro' && !esRetiro(p)) return;
      if (mod === 'envio' && esRetiro(p)) return;
      const ts = GDO.CRM ? GDO.CRM.fechaDe(p) : null;
      if (!ts || ts < t0 || ts > t1) return;
      out.push({ p: p, ts: ts, monto: GDO.CRM ? GDO.CRM.montoDe(p) : 0 });
    });
    return out.sort((a, b) => a.ts - b.ts);
  }

  /* ─────────────────────────── pantalla ─────────────────────────── */
  GDO.Views.metricas = function (c) {
    const vs = ventas();
    const r = rangoDe(per);
    const total = vs.reduce((a, v) => a + v.monto, 0);
    const conMonto = vs.filter((v) => v.monto > 0).length;
    const ticket = conMonto ? Math.round(total / conMonto) : 0;
    const nRet = vs.filter((v) => esRetiro(v.p)).length;
    const nEnv = vs.length - nRet;
    const abiertos = vs.filter((v) => v.p.estado !== 'entregado').length;
    const sinPrecio = vs.length - conMonto;
    const clientes = agrupaClientes(vs);
    const rotulo = r.desde ? (fFecha(r.desde) + ' → ' + fFecha(r.hasta)) : 'Desde el primer pedido cargado';

    c.innerHTML = `
      <div class="section-title"><h2>Métricas</h2></div>

      <div class="mx-filtros">
        <div class="mx-chips" id="mx-per">
          ${PERIODOS.map((x) => `<button type="button" data-per="${x.k}" class="${per === x.k ? 'on' : ''}">${x.t}</button>`).join('')}
        </div>
        <div class="mx-fechas" id="mx-fechas" style="display:${per === 'custom' ? 'flex' : 'none'}">
          <label>Desde <input type="date" id="mx-d" value="${esc(desde)}"/></label>
          <label>Hasta <input type="date" id="mx-h" value="${esc(hasta)}"/></label>
          <button class="btn btn-dark btn-sm" id="mx-aplicar">Aplicar</button>
        </div>
        <div class="mx-chips" id="mx-mod">
          <button type="button" data-mod="" class="${mod === '' ? 'on' : ''}">Envíos y retiros</button>
          <button type="button" data-mod="envio" class="${mod === 'envio' ? 'on' : ''}">🚚 Envíos</button>
          <button type="button" data-mod="retiro" class="${mod === 'retiro' ? 'on' : ''}">🏪 Retiros</button>
        </div>
        <div class="mx-rotulo">${esc(rotulo)}</div>
      </div>

      <div class="cards" style="margin-bottom:18px">
        <div class="card kpi naranja"><span class="ic">📦</span><span class="num">${fmtN(vs.length)}</span><span class="lbl">Pedidos${abiertos ? ' · ' + abiertos + ' sin cerrar' : ''}</span></div>
        <div class="card kpi negro"><span class="ic">💰</span><span class="num">${fmtM(total)}</span><span class="lbl">Facturado${sinPrecio ? ' · ' + sinPrecio + ' sin precio' : ''}</span></div>
        <div class="card kpi amarillo"><span class="ic">🧾</span><span class="num">${fmtM(ticket)}</span><span class="lbl">Pedido promedio</span></div>
        <div class="card kpi naranja"><span class="ic">👥</span><span class="num">${fmtN(clientes.length)}</span><span class="lbl">Clientes distintos</span></div>
        <div class="card kpi negro"><span class="ic">🏪</span><span class="num">${fmtN(nRet)}<span style="font-size:16px;color:var(--gris)"> / ${fmtN(nEnv)} 🚚</span></span><span class="lbl">Retiros / envíos</span></div>
      </div>

      ${sinPrecio ? `<div class="note">${sinPrecio} de los ${vs.length} pedidos del período <b>no tienen precio cargado</b>, así que no suman a la facturación (sí cuentan como pedidos y como unidades). Los pedidos que entran por la tienda online sí traen el monto.</div>` : ''}

      <div class="panel">
        <div class="panel-h">
          <div class="mx-tabs" id="mx-tabs">
            <button type="button" data-tab="clientes" class="${tab === 'clientes' ? 'on' : ''}">Por cliente</button>
            <button type="button" data-tab="dias" class="${tab === 'dias' ? 'on' : ''}">Por día</button>
            <button type="button" data-tab="meses" class="${tab === 'meses' ? 'on' : ''}">Por mes</button>
            <button type="button" data-tab="productos" class="${tab === 'productos' ? 'on' : ''}">Productos más vendidos</button>
          </div>
          <button class="btn btn-ghost btn-sm" id="mx-csv">⬇ Exportar CSV</button>
        </div>
        <div class="panel-b ${tab === 'clientes' || tab === 'productos' ? 'flush' : ''}" id="mx-cuerpo"></div>
      </div>`;

    const cuerpo = c.querySelector('#mx-cuerpo');
    if (!vs.length) cuerpo.innerHTML = '<div class="empty">No hay pedidos en el período elegido.</div>';
    else if (tab === 'clientes') pintarClientes(cuerpo, clientes);
    else if (tab === 'dias') pintarDias(cuerpo, vs, r);
    else if (tab === 'meses') pintarMeses(cuerpo, vs);
    else pintarProductos(cuerpo, vs);

    const repintar = () => GDO.Views.metricas(c);
    c.querySelectorAll('#mx-per [data-per]').forEach((b) => b.onclick = () => {
      per = b.dataset.per;
      if (per !== 'custom') { const x = rangoDe(per); desde = x.desde || desde; hasta = x.hasta || hasta; }
      repintar();
    });
    c.querySelectorAll('#mx-mod [data-mod]').forEach((b) => b.onclick = () => { mod = b.dataset.mod; repintar(); });
    c.querySelectorAll('#mx-tabs [data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; repintar(); });
    const ap = c.querySelector('#mx-aplicar');
    if (ap) ap.onclick = () => {
      const d = c.querySelector('#mx-d').value, h = c.querySelector('#mx-h').value;
      if (!d || !h) { toast('Elegí las dos fechas', 'err'); return; }
      if (d > h) { toast('La fecha "desde" tiene que ser anterior a la de "hasta"', 'err'); return; }
      desde = d; hasta = h; per = 'custom'; repintar();
    };
    const so = c.querySelector('#mx-ord');
    if (so) so.onchange = () => { ordProd = so.value; repintar(); };
    c.querySelector('#mx-csv').onclick = () => exportarCSV(vs, clientes, rotulo);
  };

  const fFecha = (isoStr) => {
    if (!isoStr) return '';
    const d = new Date(isoStr + 'T00:00:00');
    return d.getDate() + ' ' + MESES[d.getMonth()] + ' ' + d.getFullYear();
  };

  /* ─────────────────────────── por cliente ───────────────────────────
     Agrupamos con las fichas del CRM (que ya unifican al mismo cliente aunque
     esté cargado con el nombre escrito distinto o con otro teléfono). Si el CRM
     no estuviera disponible, caemos a agrupar por nombre. */
  function agrupaClientes(vs) {
    const porPedido = {};
    vs.forEach((v) => { porPedido[v.p.id] = v; });
    const filas = [];
    let fichas = null;
    try { fichas = GDO.CRM ? GDO.CRM.fichas() : null; } catch (e) { fichas = null; }
    if (fichas) {
      fichas.forEach((f) => {
        const mios = (f.pedidos || []).map((p) => porPedido[p.id]).filter(Boolean);
        if (!mios.length) return;
        filas.push(fila(f.nombre, f.telefono, mios, f.id));
      });
    } else {
      const g = {};
      vs.forEach((v) => { const k = (v.p.cliente || '—').toLowerCase(); (g[k] = g[k] || []).push(v); });
      Object.keys(g).forEach((k) => filas.push(fila(g[k][0].p.cliente, g[k][0].p.telefono, g[k], null)));
    }
    return filas.sort((a, b) => b.total - a.total || b.n - a.n);

    function fila(nombre, tel, mios, fichaId) {
      return {
        fichaId: fichaId, nombre: nombre || 'Sin nombre', telefono: tel || '',
        n: mios.length,
        total: mios.reduce((a, v) => a + v.monto, 0),
        retiros: mios.filter((v) => esRetiro(v.p)).length,
        envios: mios.filter((v) => !esRetiro(v.p)).length,
        ultima: mios.reduce((a, v) => Math.max(a, v.ts), 0),
      };
    }
  }

  function pintarClientes(box, filas) {
    const max = filas.reduce((a, f) => Math.max(a, f.total), 0) || 1;
    box.innerHTML = `<table><thead><tr>
        <th>Cliente</th><th>Pedidos</th><th>🚚 / 🏪</th><th>Facturado</th><th>Última compra</th>
      </tr></thead><tbody>${filas.map((f) => `
        <tr${f.fichaId ? ' data-ficha="' + esc(f.fichaId) + '" style="cursor:pointer"' : ''} title="${f.fichaId ? 'Abrir la ficha del cliente' : ''}">
          <td><b>${esc(f.nombre)}</b>${f.telefono ? '<div class="small muted">' + esc(f.telefono) + '</div>' : ''}</td>
          <td>${fmtN(f.n)}</td>
          <td class="small">${f.envios} / ${f.retiros}</td>
          <td style="min-width:170px">
            <b>${fmtM(f.total)}</b>
            <div class="mx-barra"><span style="width:${Math.max(2, Math.round(f.total / max * 100))}%"></span></div>
          </td>
          <td class="small muted">${new Date(f.ultima).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
        </tr>`).join('')}</tbody></table>`;
    box.querySelectorAll('[data-ficha]').forEach((tr) => tr.onclick = () => {
      if (GDO.Views.fichaClienteModal && Store.puedeCRM()) GDO.Views.fichaClienteModal(tr.dataset.ficha, () => GDO.App.render());
    });
  }

  /* ─────────────────────────── por día / por mes ─────────────────────────── */
  function pintarDias(box, vs, r) {
    const g = {};
    vs.forEach((v) => { const k = iso(new Date(v.ts)); (g[k] = g[k] || { n: 0, total: 0, ret: 0 }); g[k].n++; g[k].total += v.monto; if (esRetiro(v.p)) g[k].ret++; });
    // Todos los días del rango, incluso los que no tuvieron ventas: un hueco es
    // información (ese día no se vendió), no algo para esconder.
    let claves;
    if (r.desde && r.hasta && (Date.parse(r.hasta) - Date.parse(r.desde)) / 86400000 <= 120) {
      claves = [];
      const d = new Date(r.desde + 'T00:00:00'), fin = new Date(r.hasta + 'T00:00:00');
      while (d <= fin) { claves.push(iso(d)); d.setDate(d.getDate() + 1); }
    } else {
      claves = Object.keys(g).sort();
    }
    const rot = (k) => { const d = new Date(k + 'T00:00:00'); return DIAS_C[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth() + 1); };
    box.innerHTML = grafico(claves.map((k) => ({
      k: k, rot: rot(k), n: (g[k] || {}).n || 0, total: (g[k] || {}).total || 0, ret: (g[k] || {}).ret || 0,
    })), 'No hubo pedidos en estos días.');
  }

  function pintarMeses(box, vs) {
    const g = {};
    vs.forEach((v) => {
      const d = new Date(v.ts);
      const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      (g[k] = g[k] || { n: 0, total: 0, ret: 0 }); g[k].n++; g[k].total += v.monto; if (esRetiro(v.p)) g[k].ret++;
    });
    const claves = Object.keys(g).sort();
    box.innerHTML = grafico(claves.map((k) => ({
      k: k, rot: MESES[Number(k.slice(5)) - 1] + ' ' + k.slice(2, 4), n: g[k].n, total: g[k].total, ret: g[k].ret,
    })), 'No hubo pedidos en estos meses.');
  }

  /* Gráfico de barras: la barra mide FACTURACIÓN (o cantidad de pedidos si en
     todo el período no hay ningún precio cargado, así nunca se ve vacío). */
  function grafico(datos, vacio) {
    if (!datos.length) return '<div class="empty">' + vacio + '</div>';
    const usaMonto = datos.some((x) => x.total > 0);
    const max = datos.reduce((a, x) => Math.max(a, usaMonto ? x.total : x.n), 0) || 1;
    const barras = datos.map((x) => {
      const val = usaMonto ? x.total : x.n;
      const alto = Math.round(val / max * 100);
      const ttl = x.rot + ': ' + x.n + ' pedido' + (x.n === 1 ? '' : 's') + (x.total ? ' · ' + fmtM(x.total) : '') + (x.ret ? ' · ' + x.ret + ' de retiro' : '');
      // Un día con pedidos pero sin precios cargados igual se marca (barra mínima
      // + la cantidad): si no, parecería que ese día no se vendió nada.
      const etq = val ? (usaMonto ? fmtCorto(x.total) : x.n) : (x.n ? x.n + 'p' : '');
      return `<div class="mx-col" title="${esc(ttl)}">
          <span class="mx-val">${etq}</span>
          <div class="mx-bar"><span style="height:${val ? Math.max(2, alto) : (x.n ? 2 : 0)}%"></span></div>
          <span class="mx-rot">${esc(x.rot)}</span>
        </div>`;
    }).join('');
    const tot = datos.reduce((a, x) => a + x.total, 0);
    const nped = datos.reduce((a, x) => a + x.n, 0);
    const mejor = datos.slice().sort((a, b) => (usaMonto ? b.total - a.total : b.n - a.n))[0];
    return `<div class="mx-graf">${barras}</div>
      <div class="help" style="margin-top:12px">
        Cada barra es ${usaMonto ? 'lo <b>facturado</b>' : 'la <b>cantidad de pedidos</b>'} de ese período · pasá el mouse por arriba para ver el detalle.
        ${mejor ? ' El mejor fue <b>' + esc(mejor.rot) + '</b> (' + mejor.n + ' pedidos' + (mejor.total ? ' · ' + fmtM(mejor.total) : '') + ').' : ''}
        Total: <b>${fmtN(nped)} pedidos</b>${tot ? ' · <b>' + fmtM(tot) + '</b>' : ''}.
      </div>`;
  }
  const fmtCorto = (n) => {
    n = Math.round(Number(n) || 0);
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(1).replace('.0', '') + 'M';
    if (n >= 1000) return '$' + Math.round(n / 1000) + 'k';
    return '$' + n;
  };

  /* ─────────────────────────── productos ─────────────────────────── */
  function agrupaProductos(vs) {
    const g = {};
    vs.forEach((v) => {
      (v.p.items || []).forEach((it) => {
        const nom = String(it.producto || it.nombre || '').trim();
        if (!nom) return;
        const k = GDO.CRM ? GDO.CRM.prodKey(nom) : nom.toLowerCase();
        const cant = Number(it.cantidad != null ? it.cantidad : it.cant) || 0;
        const r = g[k] || (g[k] = { nombre: nom, pedidos: 0, unidades: 0, kg: 0, monto: 0, clientes: {} });
        r.nombre = nom;                    // nos quedamos con la escritura más nueva
        r.pedidos++;
        r.unidades += cant;
        r.kg += Number(it.kg) || 0;
        r.monto += cant * (Number(it.precio) || 0);
        r.clientes[(v.p.cliente || '').toLowerCase()] = 1;
      });
    });
    return Object.keys(g).map((k) => {
      const r = g[k]; r.nClientes = Object.keys(r.clientes).length; return r;
    }).sort((a, b) => (b[ordProd] || 0) - (a[ordProd] || 0));
  }

  function pintarProductos(box, vs) {
    const filas = agrupaProductos(vs);
    if (!filas.length) { box.innerHTML = '<div class="empty">Los pedidos del período no tienen productos cargados.</div>'; return; }
    const max = filas.reduce((a, f) => Math.max(a, f[ordProd] || 0), 0) || 1;
    box.innerHTML = `
      <div class="toolbar" style="padding:12px 18px;margin:0;border-bottom:1px solid var(--gris-bd)">
        <label class="small muted" style="font-weight:600">Ordenar por</label>
        <select id="mx-ord" style="max-width:220px">
          <option value="unidades"${ordProd === 'unidades' ? ' selected' : ''}>Unidades vendidas</option>
          <option value="pedidos"${ordProd === 'pedidos' ? ' selected' : ''}>Cantidad de pedidos</option>
          <option value="monto"${ordProd === 'monto' ? ' selected' : ''}>Facturación</option>
        </select>
      </div>
      <table><thead><tr>
        <th style="width:34px">#</th><th>Producto</th><th>Unidades</th><th>Kg</th><th>Pedidos</th><th>Clientes</th><th>Facturado</th>
      </tr></thead><tbody>${filas.map((f, i) => `
        <tr>
          <td class="muted">${i + 1}</td>
          <td><b>${esc(f.nombre)}</b>
            <div class="mx-barra"><span style="width:${Math.max(2, Math.round((f[ordProd] || 0) / max * 100))}%"></span></div></td>
          <td>${fmtN(Math.round(f.unidades * 100) / 100)}</td>
          <td class="small">${f.kg ? fmtN(Math.round(f.kg * 10) / 10) : '<span class="muted">—</span>'}</td>
          <td>${fmtN(f.pedidos)}</td>
          <td class="small">${fmtN(f.nClientes)}</td>
          <td>${f.monto ? fmtM(f.monto) : '<span class="muted">—</span>'}</td>
        </tr>`).join('')}</tbody></table>`;
  }

  /* ─────────────────────────── exportar ───────────────────────────
     Un CSV con TODAS las ventas del período (una fila por pedido), para abrirlo
     en Excel y cruzarlo con lo que haga falta. Separador ";" y BOM al principio:
     así el Excel en español lo abre en columnas sin tener que importar nada. */
  function exportarCSV(vs, clientes, rotulo) {
    if (!vs.length) { toast('No hay datos para exportar', 'err'); return; }
    const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    const L = [];
    L.push(['Fecha', 'Cliente', 'Teléfono', 'Modalidad', 'Estado', 'Localidad', 'Productos', 'Unidades', 'Monto', 'Origen'].map(q).join(';'));
    vs.forEach((v) => {
      const p = v.p;
      const uds = (p.items || []).reduce((a, it) => a + (Number(it.cantidad != null ? it.cantidad : it.cant) || 0), 0);
      L.push([
        iso(new Date(v.ts)), p.cliente || '', p.telefono || '',
        esRetiro(p) ? 'Retiro en sucursal' : 'Envío a domicilio',
        esRetiro(p) && p.estado === 'entregado' ? 'retirado' : (p.estado || ''),
        p.localidad || '',
        (p.items || []).map((it) => (it.cantidad || 1) + '× ' + (it.producto || it.nombre || '')).join(' | '),
        uds, Math.round(v.monto), p.origen || 'panel',
      ].map(q).join(';'));
    });
    const nombre = 'gdo-metricas-' + (rangoDe(per).desde || 'todo') + '_' + (rangoDe(per).hasta || 'hoy') + (mod ? '-' + mod : '') + '.csv';
    try {
      const blob = new Blob(['﻿' + L.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nombre;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      toast('Archivo descargado: ' + nombre, 'ok');
    } catch (e) { toast('No se pudo generar el archivo en este dispositivo', 'err'); }
  }
})();
