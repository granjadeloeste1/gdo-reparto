/* ====== Vista: Vendedores y comisiones ======
   - #/vendedores          (solo admin) lista de vendedores con lo facturado, la
                           comisión generada, lo pagado y lo que se les debe.
   - #/vendedores/<id>     (solo admin) el detalle de un vendedor: configurar su
                           comisión, ver sus ventas y marcar comisiones pagadas.
   - #/mis-ventas          (vendedor) lo MISMO que el detalle, pero de solo lectura
                           y SOLO con sus propias ventas.

   DE DÓNDE SALE CADA COSA
   - Una "venta" de un vendedor es un pedido con `vendedorId` = el vendedor (los
     que entran por su link de la tienda o los que se le asignan en el formulario).
   - La comisión se GANA cuando el pedido se ENTREGA. Mientras está en curso se
     muestra como estimada; un "no entregado" no comisiona.
   - La configuración vive en el usuario (`users/<id>.comision`):
       { pct: 3, especiales: [{ nombre: 'SUPREMAS', pct: 5 }] }
     `pct` es el general sobre la facturación; `especiales` pisa ese % para los
     productos elegidos. Se calcula renglón por renglón con el valor de cada
     producto (el mismo que usa Métricas: descuentos incluidos).
   - Los pagos también viven en el usuario (`users/<id>.comPagos`): cada pago
     guarda los pedidos que salda y el MONTO CONGELADO de cada uno, así un cambio
     de porcentaje posterior no cambia lo que ya se pagó.
   Todo en `users` a propósito: esa colección ya la lee todo el personal y la
   escribe el panel, así que no hizo falta tocar las reglas de Firestore. */
window.GDO = window.GDO || {}; GDO.Views = GDO.Views || {};
(function () {
  const { Store } = GDO;
  const { esc, toast, confirmDlg, modal, fmtFecha, estadoChip, vendedorDe } = GDO.UI;

  const fmtM = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
  const fmtP = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-AR') + '%';
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const isoDeTs = (t) => (t ? iso(new Date(t)) : '');
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const nid = () => 'cp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---------------- cálculo ---------------- */

  function cfgDe(u) {
    const c = (u && u.comision) || {};
    return {
      pct: Number(c.pct) || 0,
      especiales: (Array.isArray(c.especiales) ? c.especiales : []).filter((e) => e && e.nombre),
    };
  }
  /* Producto "base" para comparar: sin la marca entre paréntesis ni la forma
     suelta (" · PIEZA SUELTA"), normalizado igual que el CRM. Así un % especial
     puesto a un producto vale para todas las formas en que se lo pide. */
  function baseProd(nombre) {
    const s = String(nombre || '').split(' · ')[0].replace(/\s*\([^)]*\)\s*$/, '');
    return GDO.CRM ? GDO.CRM.prodKey(s) : norm(s);
  }
  const nombreDe = (it) => (GDO.Lista ? GDO.Lista.nombreItem(it) : String((it && (it.producto || it.nombre)) || ''));

  /* Comisión de UN pedido con la configuración ACTUAL del vendedor.
     Devuelve { base, com, detalle:[{producto, monto, pct, com, especial}] }. */
  function calcular(p, cfg) {
    const items = p.items || [];
    const vals = (GDO.Metricas && GDO.Metricas.valoresDe) ? GDO.Metricas.valoresDe(p) : [];
    const suma = vals.reduce((a, v) => a + (v.monto || 0), 0);
    if (!items.length || !suma) {
      // Sin valor por renglón: la comisión general sobre el total del pedido.
      const base = GDO.CRM ? GDO.CRM.montoDe(p) : (Number(p.totalEstimado) || 0);
      return { base, com: base * cfg.pct / 100, detalle: [{ producto: 'Total del pedido', monto: base, pct: cfg.pct, com: base * cfg.pct / 100, especial: false }] };
    }
    const esp = cfg.especiales.map((e) => ({ k: baseProd(e.nombre), pct: Number(e.pct) || 0 }));
    const detalle = items.map((it, i) => {
      const monto = (vals[i] && vals[i].monto) || 0;
      const k = baseProd(nombreDe(it));
      const e = esp.find((x) => x.k === k);
      const pct = e ? e.pct : cfg.pct;
      return { producto: nombreDe(it), monto, pct, com: monto * pct / 100, especial: !!e };
    });
    return { base: suma, com: detalle.reduce((a, d) => a + d.com, 0), detalle };
  }

  const pagosDe = (u) => (u && Array.isArray(u.comPagos) ? u.comPagos : []);
  // pedidoId -> { pago, monto } de todo lo ya pagado a ese vendedor.
  function pagadosDe(u) {
    const m = {};
    pagosDe(u).forEach((pg) => Object.keys(pg.items || {}).forEach((pid) => { m[pid] = { pago: pg, monto: Number(pg.items[pid]) || 0 }; }));
    return m;
  }

  const fechaVenta = (p) => (GDO.CRM ? GDO.CRM.fechaDe(p) : (p.creado || p.ts)) || p.creado || p.ts || null;
  const ventasDe = (vid) => Store.pedidos().filter((p) => p.vendedorId === vid);

  /* Una venta ya resuelta: fecha, estado, facturación y comisión (la pagada, si
     ya se pagó; si no, la calculada con la configuración de hoy). */
  function filas(vid) {
    const u = Store.user(vid);
    const cfg = cfgDe(u);
    const pag = pagadosDe(u);
    return ventasDe(vid).map((p) => {
      const c = calcular(p, cfg);
      const t = fechaVenta(p);
      const entregada = p.estado === 'entregado';
      const pg = pag[p.id] || null;
      return {
        p, c, ts: t, fecha: isoDeTs(t), entregada,
        anulada: p.estado === 'no_entregado',
        pagada: !!pg, pago: pg && pg.pago,
        // Lo que vale la comisión: lo pagado (congelado) o lo que da hoy.
        com: pg ? pg.monto : (entregada ? c.com : 0),
        estimada: !entregada && p.estado !== 'no_entregado' ? c.com : 0,
      };
    }).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  }

  /* Cómo va el pedido, en palabras del vendedor. Se lee en vivo: cuando el
     chofer acepta la ruta o entrega, el panel se repinta solo. */
  function estadoVenta(p) {
    const r = p.rutaId ? Store.ruta(p.rutaId) : null;
    const chofer = r && r.repartidorId ? Store.user(r.repartidorId) : null;
    const quien = chofer ? ' · ' + esc(chofer.nombre.split(' ')[0]) : '';
    if (p.estado === 'entregado') return '<span class="chip chip-entreg">✓ Entregado</span>';
    if (p.estado === 'no_entregado') return '<span class="chip chip-no">✕ No entregado</span>';
    if (p.estado === 'salteado') return '<span class="chip chip-salt">↷ Salteado · se reprograma</span>';
    if (p.enCamino) return '<span class="chip chip-ruta">🚚 En camino al cliente' + quien + '</span>';
    if (r && (r.estado === 'en_curso' || p.estado === 'en_ruta')) return '<span class="chip chip-ruta">🚚 En reparto' + quien + '</span>';
    if (r && r.estado === 'aceptada') return '<span class="chip chip-ruta">👍 Chofer aceptó la ruta' + quien + '</span>';
    if (r && r.estado === 'asignada') return '<span class="chip chip-asig">🗺️ En ruta · falta que el chofer acepte' + quien + '</span>';
    if (p.estado === 'pendiente') return '<span class="chip chip-pend">Recibido · a armar</span>';
    return estadoChip(p);
  }

  /* ---------------- lista de vendedores (admin) ---------------- */

  function vendedores() {
    const m = new Map();
    Store.users().filter((u) => u.roles && u.roles.includes('vendedor')).forEach((u) => m.set(u.id, u.nombre));
    Store.pedidos().forEach((p) => { const v = vendedorDe(p); if (v && !m.has(v.id)) m.set(v.id, v.nombre); });
    return [...m].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  GDO.Views.vendedores = function (c, vid) {
    if (Store.rolActivo() !== 'admin') { c.innerHTML = '<div class="empty">Esta sección es solo del administrador.</div>'; return; }
    if (vid) return detalle(c, vid, true);
    const rows = vendedores().map((v) => {
      const u = Store.user(v.id);
      const cfg = cfgDe(u);
      const fs = filas(v.id);
      const ent = fs.filter((f) => f.entregada);
      const fact = ent.reduce((a, f) => a + f.c.base, 0);
      const gen = ent.reduce((a, f) => a + f.com, 0);
      const pagado = fs.filter((f) => f.pagada).reduce((a, f) => a + f.com, 0);
      const curso = fs.filter((f) => !f.entregada && !f.anulada).length;
      return { v, u, cfg, n: fs.length, curso, fact, gen, pagado, saldo: gen - pagado };
    });
    c.innerHTML = `
      <div class="section-title"><h2>Vendedores</h2></div>
      <div class="note">Cada vendedor tiene una <b>comisión general</b> sobre lo que factura y puede tener <b>% especiales</b> para los productos que elijas. La comisión se gana cuando el pedido se <b>entrega</b>. Entrá a un vendedor para configurarla, ver sus ventas y marcar lo que ya le pagaste.</div>
      <div class="panel"><div class="panel-b flush">${rows.length ? `<table><thead><tr>
          <th>Vendedor</th><th>Comisión</th><th>Ventas</th><th>Facturado (entregado)</th><th>Comisión generada</th><th>Pagado</th><th>A pagar</th><th></th>
        </tr></thead><tbody>${rows.map((r) => `<tr>
          <td><b>${esc(r.v.nombre)}</b>${r.u ? '' : ' <span class="chip chip-no" style="font-size:10px">ya no es usuario</span>'}</td>
          <td class="small">${fmtP(r.cfg.pct)} general${r.cfg.especiales.length ? `<div class="muted">+ ${r.cfg.especiales.length} producto${r.cfg.especiales.length === 1 ? '' : 's'} especial${r.cfg.especiales.length === 1 ? '' : 'es'}</div>` : ''}</td>
          <td class="small">${r.n}${r.curso ? `<div class="muted">${r.curso} en curso</div>` : ''}</td>
          <td>${fmtM(r.fact)}</td>
          <td>${fmtM(r.gen)}</td>
          <td>${fmtM(r.pagado)}</td>
          <td><b style="color:${r.saldo > 0.5 ? 'var(--naranja)' : 'inherit'}">${fmtM(r.saldo)}</b></td>
          <td class="t-actions"><button class="btn btn-ghost btn-sm" data-vend="${esc(r.v.id)}">Ver ›</button></td>
        </tr>`).join('')}</tbody></table>` : '<div class="empty">Todavía no hay vendedores. Dale el rol <b>Vendedor</b> a alguien en <b>Usuarios y roles</b>.</div>'}</div></div>`;
    c.querySelectorAll('[data-vend]').forEach((b) => b.onclick = () => { location.hash = '#/vendedores/' + encodeURIComponent(b.dataset.vend); });
  };

  /* ---------------- mis ventas (vendedor) ---------------- */

  GDO.Views.misVentas = function (c) {
    const u = Store.current();
    if (!u) return;
    detalle(c, u.id, false);
  };

  /* ---------------- detalle (admin y vendedor) ----------------
     El estado de la pantalla (filtros, selección, borrador de la configuración)
     vive FUERA de la vista: el panel se repinta solo cada vez que cambia un
     pedido en la nube (así el vendedor ve la entrega en vivo) y no queremos que
     eso borre lo que el admin estaba tocando. */
  const EST = {};
  function estadoDe(vid) {
    if (!EST[vid]) EST[vid] = { d: '', h: '', q: '', est: '', pago: '', sel: new Set(), draft: null };
    return EST[vid];
  }

  function detalle(c, vid, esAdmin) {
    const u = Store.user(vid);
    const st = estadoDe(vid);
    const nombre = (u && u.nombre) || ((ventasDe(vid).map(vendedorDe).find(Boolean) || {}).nombre) || 'Vendedor';
    const cfg = cfgDe(u);
    const todas = filas(vid);

    // --- filtros ---
    let list = todas;
    if (st.d) list = list.filter((f) => f.fecha && f.fecha >= st.d);
    if (st.h) list = list.filter((f) => f.fecha && f.fecha <= st.h);
    if (st.q) { const q = norm(st.q); list = list.filter((f) => norm([f.p.cliente, f.p.razonSocial, f.p.cuit, f.p.direccion, f.p.localidad].join(' ')).includes(q)); }
    if (st.est === 'curso') list = list.filter((f) => !f.entregada && !f.anulada);
    else if (st.est === 'entregada') list = list.filter((f) => f.entregada);
    else if (st.est === 'no') list = list.filter((f) => f.anulada);
    if (st.pago === 'pagada') list = list.filter((f) => f.pagada);
    else if (st.pago === 'apagar') list = list.filter((f) => f.entregada && !f.pagada);

    // --- números del período ---
    const ent = list.filter((f) => f.entregada);
    const fact = ent.reduce((a, f) => a + f.c.base, 0);
    const gen = ent.reduce((a, f) => a + f.com, 0);
    const pagado = list.filter((f) => f.pagada).reduce((a, f) => a + f.com, 0);
    const estim = list.reduce((a, f) => a + f.estimada, 0);
    const factCurso = list.filter((f) => !f.entregada && !f.anulada).reduce((a, f) => a + f.c.base, 0);
    const saldoTotal = todas.filter((f) => f.entregada && !f.pagada).reduce((a, f) => a + f.com, 0);
    const hayFiltro = st.d || st.h || st.q || st.est || st.pago;

    // Seleccionables (admin): entregadas y sin pagar que se están viendo.
    const pagables = esAdmin ? list.filter((f) => f.entregada && !f.pagada) : [];
    [...st.sel].forEach((id) => { if (!pagables.some((f) => f.p.id === id)) st.sel.delete(id); });
    const selTotal = pagables.filter((f) => st.sel.has(f.p.id)).reduce((a, f) => a + f.com, 0);

    const hoy = new Date();
    const mes0 = iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
    const mesP0 = iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1));
    const mesP1 = iso(new Date(hoy.getFullYear(), hoy.getMonth(), 0));
    const atajo = (d, h, t) => `<button type="button" class="btn btn-sm ${st.d === d && st.h === h ? '' : 'btn-ghost'}" data-rango="${d}|${h}">${t}</button>`;

    const draft = st.draft || { pct: cfg.pct, especiales: cfg.especiales.map((e) => ({ nombre: e.nombre, pct: Number(e.pct) || 0 })) };
    const pagos = pagosDe(u).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));

    c.innerHTML = `
      <div class="section-title"><h2>${esAdmin ? '🏷️ ' + esc(nombre) : 'Mis ventas'}</h2>
        ${esAdmin ? '<button class="btn btn-ghost btn-sm" id="v-volver">← Vendedores</button>' : ''}</div>
      ${esAdmin ? '' : `<div class="note">Acá ves <b>solo tus ventas</b>: las que entraron por tu link y las que se cargaron a tu nombre. El estado se actualiza solo cuando el chofer acepta la ruta o entrega. La comisión se gana cuando el pedido se <b>entrega</b>.</div>`}

      ${esAdmin ? `
      <div class="panel"><div class="panel-h"><h3>Comisión</h3>${st.draft ? '<span class="chip chip-pend">Sin guardar</span>' : ''}</div><div class="panel-b">
        ${u ? `
        <div class="form-grid">
          <div class="field"><label>Comisión general sobre la facturación (%)</label>
            <input id="v-pct" type="number" min="0" max="100" step="0.1" inputmode="decimal" value="${esc(String(draft.pct))}"/>
            <span class="help">Se aplica a todo lo que venda, salvo a los productos de abajo.</span></div>
          <div class="field col-2"><label>Productos con % especial</label>
            <div id="v-esp">${draft.especiales.length ? `<table><thead><tr><th>Producto</th><th style="width:130px">% comisión</th><th style="width:40px"></th></tr></thead><tbody>
              ${draft.especiales.map((e, i) => `<tr><td class="small"><b>${esc(e.nombre)}</b></td>
                <td><input type="number" min="0" max="100" step="0.1" inputmode="decimal" data-esp-pct="${i}" value="${esc(String(e.pct))}" style="width:100%"/></td>
                <td><button class="btn btn-ghost btn-sm" data-esp-del="${i}" title="Quitar">✕</button></td></tr>`).join('')}
              </tbody></table>` : '<div class="small muted">Ninguno: todo comisiona el % general.</div>'}</div>
            <div style="position:relative;margin-top:8px">
              <input id="v-prod" autocomplete="off" placeholder="Escribí un producto de la lista para darle otro %…"/>
              <div id="v-prod-sug" class="crm-ac"></div>
            </div>
            <span class="help" id="v-prod-help">Elegilo de la lista y ponele el % que quieras. Vale para todas las formas del producto (caja, pieza, por kg).</span></div>
        </div>
        <div class="toolbar" style="margin:6px 0 0"><div class="spacer"></div>
          ${st.draft ? '<button class="btn btn-ghost" id="v-cfg-undo">Descartar cambios</button>' : ''}
          <button class="btn btn-primary" id="v-cfg-save">Guardar comisión</button></div>
        <div class="small muted" style="margin-top:8px">Los cambios de % valen para lo que todavía no se pagó. Lo ya pagado queda con el monto con el que se pagó.</div>
        ` : '<div class="small muted">Este vendedor ya no está entre los usuarios: se muestran sus ventas, pero no se puede cambiar su comisión ni registrar pagos.</div>'}
      </div></div>` : `
      <div class="note">💼 <b>Tu comisión:</b> ${fmtP(cfg.pct)} sobre lo facturado${cfg.especiales.length ? ' · <b>especiales:</b> ' + cfg.especiales.map((e) => esc(e.nombre) + ' ' + fmtP(e.pct)).join(' · ') : ''}.</div>`}

      <div class="toolbar">
        <input type="search" id="v-q" placeholder="Buscar cliente, razón social o CUIT…" value="${esc(st.q)}"/>
        <select id="v-est">
          <option value="">Todos los estados</option>
          <option value="curso"${st.est === 'curso' ? ' selected' : ''}>En curso</option>
          <option value="entregada"${st.est === 'entregada' ? ' selected' : ''}>Entregadas</option>
          <option value="no"${st.est === 'no' ? ' selected' : ''}>No entregadas</option>
        </select>
        <select id="v-pago">
          <option value="">Pagadas y a pagar</option>
          <option value="apagar"${st.pago === 'apagar' ? ' selected' : ''}>Comisión a cobrar</option>
          <option value="pagada"${st.pago === 'pagada' ? ' selected' : ''}>Comisión pagada</option>
        </select>
        <div class="p-fechas" title="Fecha de la venta">
          <span class="ic">📅</span>
          <input type="date" id="v-d" title="Desde" value="${esc(st.d)}"/>
          <span class="fl">→</span>
          <input type="date" id="v-h" title="Hasta" value="${esc(st.h)}"/>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:-4px 0 12px">
        ${atajo(mes0, iso(hoy), 'Este mes')}${atajo(mesP0, mesP1, 'Mes pasado')}${atajo('', '', 'Todo')}
        ${hayFiltro ? '<button type="button" class="btn btn-sm btn-ghost" id="v-limpiar">✕ Limpiar filtros</button>' : ''}
      </div>

      <div class="cards" style="margin-bottom:18px">
        <div class="card kpi negro"><span class="ic">💰</span><span class="num">${fmtM(fact)}</span><span class="lbl">Facturación entregada${factCurso ? ' · ' + fmtM(factCurso) + ' en curso' : ''}</span></div>
        <div class="card kpi naranja"><span class="ic">🏷️</span><span class="num">${fmtM(gen)}</span><span class="lbl">Comisión generada${estim ? ' · ~' + fmtM(estim) + ' más al entregar' : ''}</span></div>
        <div class="card kpi amarillo"><span class="ic">✅</span><span class="num">${fmtM(pagado)}</span><span class="lbl">Comisión pagada</span></div>
        <div class="card kpi rojo"><span class="ic">⏳</span><span class="num">${fmtM(gen - pagado)}</span><span class="lbl">${esAdmin ? 'A pagar' : 'A cobrar'}${hayFiltro ? ' (con estos filtros)' : ''}</span></div>
      </div>
      ${hayFiltro && Math.abs(saldoTotal - (gen - pagado)) > 0.5 ? `<div class="note">Saldo total ${esAdmin ? 'a pagar' : 'a cobrar'}, de todas las fechas: <b>${fmtM(saldoTotal)}</b></div>` : ''}

      ${esAdmin && u && pagables.length ? `
      <div class="toolbar" style="align-items:center;background:var(--gris-cl);border:1px solid var(--gris-bd);border-radius:10px;padding:8px 12px;margin-bottom:10px">
        <b>${st.sel.size ? st.sel.size + ' seleccionada' + (st.sel.size === 1 ? '' : 's') + ' · ' + fmtM(selTotal) : pagables.length + ' venta' + (pagables.length === 1 ? '' : 's') + ' con comisión sin pagar'}</b>
        <div class="spacer"></div>
        <button class="btn btn-ghost btn-sm" id="v-sel-all">Seleccionar todas las que se ven</button>
        ${st.sel.size ? '<button class="btn btn-ghost btn-sm" id="v-sel-none">Quitar selección</button><button class="btn btn-primary btn-sm" id="v-pagar">✓ Marcar como pagadas</button>' : ''}
      </div>` : ''}

      <div class="panel"><div class="panel-b flush">${list.length ? `<table><thead><tr>
          ${esAdmin && u ? '<th style="width:34px"></th>' : ''}
          <th>Fecha</th><th>Cliente</th><th>Estado</th><th>Facturación</th><th>Comisión</th><th>Pago</th>
        </tr></thead><tbody>${list.map((f) => {
          const p = f.p;
          const puedeSel = esAdmin && u && f.entregada && !f.pagada;
          const comTxt = f.anulada ? '<span class="muted">—</span>'
            : f.entregada ? '<b>' + fmtM(f.com) + '</b>'
            : '<span class="muted" title="Se gana cuando se entrega">~' + fmtM(f.estimada) + '</span>';
          const conEsp = f.c.detalle.some((d) => d.especial);
          return `<tr${puedeSel && st.sel.has(p.id) ? ' style="background:var(--gris-cl)"' : ''}>
            ${esAdmin && u ? `<td>${puedeSel ? `<input type="checkbox" data-sel="${p.id}" ${st.sel.has(p.id) ? 'checked' : ''}/>` : ''}</td>` : ''}
            <td class="small">${f.fecha ? fmtFecha(f.fecha) : '<span class="muted">—</span>'}</td>
            <td><b data-det="${p.id}" style="cursor:pointer;text-decoration:underline;text-decoration-style:dotted" title="Ver el detalle de la comisión">${esc(p.cliente)}</b>
              ${p.razonSocial || p.cuit ? `<div class="small muted">${esc(p.razonSocial || '')}${p.cuit ? ' · CUIT ' + esc(p.cuit) : ''}</div>` : ''}</td>
            <td>${estadoVenta(p)}</td>
            <td class="small">${fmtM(f.c.base)}</td>
            <td class="small">${comTxt}${!f.anulada && conEsp ? '<div class="muted">incluye % especial</div>' : ''}</td>
            <td class="small">${f.pagada ? '<span class="chip chip-entreg">✓ Pagada</span><div class="muted">' + fmtFecha(isoDeTs(f.pago.ts)) + '</div>' : (f.entregada ? '<span class="chip chip-pend">A pagar</span>' : '<span class="muted">—</span>')}</td>
          </tr>`;
        }).join('')}</tbody></table>` : `<div class="empty">${todas.length ? 'No hay ventas con estos filtros.' : 'Todavía no hay ventas.'}</div>`}</div></div>

      <div class="panel"><div class="panel-h"><h3>Pagos de comisiones</h3></div><div class="panel-b flush">
        ${pagos.length ? `<table><thead><tr><th>Fecha de pago</th><th>Período</th><th>Ventas</th><th>Monto</th>${esAdmin ? '<th></th>' : ''}</tr></thead><tbody>
          ${pagos.map((pg) => `<tr>
            <td class="small">${fmtFecha(isoDeTs(pg.ts))}</td>
            <td class="small">${pg.desde || pg.hasta ? (pg.desde ? fmtFecha(pg.desde) : '…') + ' → ' + (pg.hasta ? fmtFecha(pg.hasta) : '…') : '<span class="muted">Ventas elegidas</span>'}</td>
            <td class="small">${Object.keys(pg.items || {}).length}</td>
            <td><b>${fmtM(pg.total)}</b></td>
            ${esAdmin ? `<td class="t-actions"><button class="btn btn-ghost btn-sm" data-anular="${esc(pg.id)}" title="Anular este pago: esas ventas vuelven a quedar a pagar">Anular</button></td>` : ''}
          </tr>`).join('')}</tbody></table>` : '<div class="empty">Todavía no se registraron pagos.</div>'}
      </div></div>`;

    const $ = (s) => c.querySelector(s);
    const repintar = () => detalle(c, vid, esAdmin);

    // --- filtros ---
    $('#v-q').oninput = () => {
      st.q = $('#v-q').value;
      const pos = $('#v-q').selectionStart;
      repintar();
      const q = $('#v-q'); q.focus(); try { q.setSelectionRange(pos, pos); } catch (e) {}
    };
    $('#v-est').onchange = () => { st.est = $('#v-est').value; repintar(); };
    $('#v-pago').onchange = () => { st.pago = $('#v-pago').value; repintar(); };
    const vD = $('#v-d'), vH = $('#v-h');
    [vD, vH].forEach((el) => { el.onclick = () => { try { el.showPicker && el.showPicker(); } catch (e) {} }; });
    vD.onchange = () => { st.d = vD.value; if (st.h && st.d && st.h < st.d) st.h = st.d; repintar(); };
    vH.onchange = () => { st.h = vH.value; if (st.d && st.h && st.h < st.d) st.d = st.h; repintar(); };
    c.querySelectorAll('[data-rango]').forEach((b) => b.onclick = () => { const [d, h] = b.dataset.rango.split('|'); st.d = d; st.h = h; repintar(); });
    if ($('#v-limpiar')) $('#v-limpiar').onclick = () => { st.d = st.h = st.q = st.est = st.pago = ''; repintar(); };
    if ($('#v-volver')) $('#v-volver').onclick = () => { location.hash = '#/vendedores'; };
    c.querySelectorAll('[data-det]').forEach((b) => b.onclick = () => verDetalle(todas.find((f) => f.p.id === b.dataset.det), esAdmin));

    if (!esAdmin || !u) return;

    // --- selección y pago ---
    c.querySelectorAll('[data-sel]').forEach((cb) => cb.onchange = () => { if (cb.checked) st.sel.add(cb.dataset.sel); else st.sel.delete(cb.dataset.sel); repintar(); });
    if ($('#v-sel-all')) $('#v-sel-all').onclick = () => { pagables.forEach((f) => st.sel.add(f.p.id)); repintar(); };
    if ($('#v-sel-none')) $('#v-sel-none').onclick = () => { st.sel.clear(); repintar(); };
    if ($('#v-pagar')) $('#v-pagar').onclick = () => {
      const elegidas = pagables.filter((f) => st.sel.has(f.p.id));
      if (!elegidas.length) return;
      const total = elegidas.reduce((a, f) => a + f.com, 0);
      confirmDlg(`¿Registrar el pago de ${fmtM(total)} a ${nombre} por ${elegidas.length} venta${elegidas.length === 1 ? '' : 's'}? Lo va a ver en su panel como comisión pagada.`, () => {
        const items = {};
        elegidas.forEach((f) => { items[f.p.id] = Math.round(f.com * 100) / 100; });
        const pago = { id: nid(), ts: Date.now(), por: (Store.current() || {}).id || null, desde: st.d || '', hasta: st.h || '', total: Math.round(total * 100) / 100, items };
        const fresco = Store.user(vid);
        Store.upsertUser({ id: vid, comPagos: pagosDe(fresco).concat([pago]) });
        Store.pushNotif && Store.pushNotif(vid, `Se registró el pago de tu comisión: ${fmtM(total)} (${elegidas.length} venta${elegidas.length === 1 ? '' : 's'}).`, { tipo: 'comision' });
        st.sel.clear();
        toast('Pago registrado ✓', 'ok');
        repintar();
      }, 'Registrar pago', 'btn-verde');
    };
    c.querySelectorAll('[data-anular]').forEach((b) => b.onclick = () => {
      const pg = pagosDe(u).find((x) => x.id === b.dataset.anular);
      if (!pg) return;
      confirmDlg(`¿Anular el pago de ${fmtM(pg.total)} del ${fmtFecha(isoDeTs(pg.ts))}? Esas ventas vuelven a quedar como comisión a pagar.`, () => {
        Store.upsertUser({ id: vid, comPagos: pagosDe(Store.user(vid)).filter((x) => x.id !== pg.id) });
        toast('Pago anulado', 'ok');
        repintar();
      }, 'Anular pago');
    });

    // --- configuración de la comisión (borrador que sobrevive al repintado) ---
    const tocar = () => { st.draft = draft; };
    $('#v-pct').oninput = () => { draft.pct = parseFloat($('#v-pct').value) || 0; tocar(); };
    c.querySelectorAll('[data-esp-pct]').forEach((inp) => inp.oninput = () => { draft.especiales[+inp.dataset.espPct].pct = parseFloat(inp.value) || 0; tocar(); });
    c.querySelectorAll('[data-esp-del]').forEach((b) => b.onclick = () => { draft.especiales.splice(+b.dataset.espDel, 1); tocar(); repintar(); });
    if ($('#v-cfg-undo')) $('#v-cfg-undo').onclick = () => { st.draft = null; repintar(); };
    $('#v-cfg-save').onclick = () => {
      const pct = Math.max(0, Math.min(100, Number(draft.pct) || 0));
      const especiales = draft.especiales.map((e) => ({ nombre: e.nombre, pct: Math.max(0, Math.min(100, Number(e.pct) || 0)) }));
      Store.upsertUser({ id: vid, comision: { pct, especiales } });
      st.draft = null;
      toast('Comisión guardada ✓', 'ok');
      repintar();
    };

    // Buscador de productos de la lista (el mismo catálogo que usa el panel).
    const inp = $('#v-prod'), sug = $('#v-prod-sug');
    let opciones = [];
    const pintarSug = () => {
      const t = inp.value.trim();
      if (t.length < 2 || !GDO.Lista) { sug.classList.remove('on'); sug.innerHTML = ''; return; }
      const vistos = {};
      opciones = GDO.Lista.buscar(t, 12, 'mayorista').filter((o) => {
        const k = baseProd(o.nombre); if (vistos[k]) return false; vistos[k] = 1; return true;
      }).slice(0, 8);
      if (!opciones.length) {
        sug.innerHTML = `<div class="small muted" style="padding:10px 13px">${GDO.Lista.hay() ? 'No está en la lista.' : 'Cargando la lista de precios…'}</div>`;
        sug.classList.add('on'); return;
      }
      sug.innerHTML = opciones.map((o, i) => `<button type="button" class="crm-ac-i" data-op="${i}"><b>${esc(String(o.nombre).split(' · ')[0])}</b>${o.seccion ? `<span class="small muted">${esc(o.seccion)}</span>` : ''}</button>`).join('');
      sug.classList.add('on');
      sug.querySelectorAll('[data-op]').forEach((b) => b.onmousedown = (e) => {
        e.preventDefault();
        const o = opciones[+b.dataset.op];
        const nom = String(o.nombre).split(' · ')[0];
        if (draft.especiales.some((x) => baseProd(x.nombre) === baseProd(nom))) { toast('Ese producto ya tiene su %', ''); return; }
        draft.especiales.push({ nombre: nom, pct: Number(draft.pct) || 0 });
        tocar();
        repintar();
        const nuevo = c.querySelector(`[data-esp-pct="${draft.especiales.length - 1}"]`);
        if (nuevo) { nuevo.focus(); nuevo.select(); }
      });
    };
    inp.oninput = pintarSug;
    inp.onblur = () => setTimeout(() => sug.classList.remove('on'), 150);
    if (GDO.Lista && !GDO.Lista.hay()) {
      const pr = GDO.Lista.cargar('mayorista');
      if (pr && pr.then) pr.then(() => { if (document.activeElement === inp) pintarSug(); }).catch(() => {});
    }
  }

  /* Detalle de la comisión de una venta, producto por producto. */
  function verDetalle(f, esAdmin) {
    if (!f) return;
    const p = f.p;
    modal({
      title: 'Comisión · ' + p.cliente, width: 620,
      bodyHTML: `
        <div class="small muted" style="margin-bottom:10px">${f.fecha ? fmtFecha(f.fecha) + ' · ' : ''}${estadoVenta(p)}</div>
        <table><thead><tr><th>Producto</th><th>Facturación</th><th>%</th><th>Comisión</th></tr></thead><tbody>
          ${f.c.detalle.map((d) => `<tr>
            <td class="small">${esc(d.producto)}${d.especial ? ' <span class="chip chip-rol vendedor" style="font-size:10px">especial</span>' : ''}</td>
            <td class="small">${fmtM(d.monto)}</td><td class="small">${fmtP(d.pct)}</td><td class="small">${fmtM(d.com)}</td></tr>`).join('')}
          <tr><td><b>Total</b></td><td><b>${fmtM(f.c.base)}</b></td><td></td><td><b>${fmtM(f.c.com)}</b></td></tr>
        </tbody></table>
        ${f.pagada ? `<div class="note" style="margin-top:12px">✅ Comisión <b>pagada</b> el ${fmtFecha(isoDeTs(f.pago.ts))}: <b>${fmtM(f.com)}</b>${Math.abs(f.com - f.c.com) > 0.5 ? ' (se pagó con el % de ese momento)' : ''}.</div>`
          : f.entregada ? '<div class="note" style="margin-top:12px">Comisión ganada, <b>pendiente de pago</b>.</div>'
          : f.anulada ? '<div class="note" style="margin-top:12px">El pedido <b>no se entregó</b>: no comisiona.</div>'
          : '<div class="note" style="margin-top:12px">Estimado: la comisión se gana cuando el pedido se <b>entrega</b>.</div>'}`,
      footHTML: `<button class="btn btn-primary" data-ok>Cerrar</button>`,
      onMount(node, close) { node.querySelector('[data-ok]').onclick = close; },
    });
  }

  GDO.Comisiones = { calcular, cfgDe, pagadosDe, filas };
})();
