/* ====== Vistas: Rutas (listado + armador) ====== */
window.GDO = window.GDO || {}; GDO.Views = GDO.Views || {};
(function () {
  const { Store, Route } = GDO;
  const { esc, h, toast, modal, confirmDlg, fmtFecha, fmtHora, fmtDur } = GDO.UI;
  const go = (hash) => { location.hash = hash; };

  const ESTADO_RUTA = {
    borrador: '<span class="chip chip-pend">Borrador</span>',
    asignada: '<span class="chip chip-asig">Asignada</span>',
    aceptada: '<span class="chip chip-ruta">Aceptada</span>',
    en_curso: '<span class="chip chip-ruta">En curso</span>',
    finalizada: '<span class="chip chip-entreg">Finalizada</span>',
  };
  GDO.Views.ESTADO_RUTA = ESTADO_RUTA;

  /* ---------------- Listado de rutas ---------------- */
  GDO.Views.rutas = function (c) {
    c.innerHTML = `
      <div class="section-title"><h2>Rutas de reparto</h2></div>
      <div class="toolbar"><div class="spacer"></div><button class="btn btn-primary" id="r-new">+ Armar nueva ruta</button></div>
      <div class="panel"><div class="panel-b flush"><div id="r-tabla"></div></div></div>`;
    const list = Store.rutas().slice().reverse();
    const box = c.querySelector('#r-tabla');
    box.innerHTML = list.length ? `<table><thead><tr>
        <th>Ruta</th><th>Fecha</th><th>Repartidor</th><th>Vehículo</th><th>Paradas</th><th>Estado</th><th></th>
      </tr></thead><tbody>${list.map((r) => {
        const rep = Store.user(r.repartidorId);
        const veh = Store.vehiculos().find((v) => v.id === r.vehiculoId);
        return `<tr>
          <td><b>${esc(r.nombre)}</b></td><td class="small">${fmtFecha(r.fecha)}</td>
          <td class="small">${rep ? esc(rep.nombre) : '<span class="muted">—</span>'}</td>
          <td class="small">${veh ? esc(veh.nombre) : '<span class="muted">—</span>'}</td>
          <td>${r.pedidoIds.length}</td>
          <td>${ESTADO_RUTA[r.estado] || r.estado}${(() => {
            const pr = r.progreso || {};
            const e = r.pedidoIds.filter((id) => pr[id] === 'entregado').length;
            const n = r.pedidoIds.filter((id) => pr[id] === 'no_entregado').length;
            return (e || n) ? `<div class="small muted" style="margin-top:4px">✓ ${e} entregados${n ? ` · ✕ ${n} no` : ''} de ${r.pedidoIds.length}</div>` : '';
          })()}</td>
          <td class="t-actions">
            <button class="btn btn-ghost btn-sm" data-open="${r.id}">Abrir</button>
            <button class="btn btn-ghost btn-sm" data-del="${r.id}">🗑</button>
          </td></tr>`;
      }).join('')}</tbody></table>` : `<div class="empty">Todavía no hay rutas. Tocá “Armar nueva ruta”.</div>`;
    box.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => go('#/rutas/' + b.dataset.open));
    box.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
      confirmDlg('¿Eliminar la ruta? Los pedidos vuelven a “pendiente”.', () => { Store.deleteRuta(b.dataset.del); toast('Ruta eliminada', 'ok'); GDO.App.render(); });
    });
    c.querySelector('#r-new').onclick = () => go('#/rutas/nueva');
  };

  /* ---------------- Armador / editor de ruta ---------------- */
  GDO.Views.rutaEditor = function (c, rutaId) {
    const esNueva = rutaId === 'nueva';
    let ruta = esNueva ? {
      nombre: 'Ruta ' + new Date().toLocaleDateString('es-AR'),
      fecha: new Date().toISOString().slice(0, 10),
      repartidorId: '', vehiculoId: '',
      origen: { ...Store.depot() }, destino: { ...Store.depot() }, sameAsOrigin: true,
      pedidoIds: [], orden: [], estado: 'borrador',
      demoraDefaultMin: 10, salidaMin: Route.SALIDA_DEFAULT, salirAhora: true, demoraPorId: {},
      creadaPor: Store.current().id,
    } : JSON.parse(JSON.stringify(Store.ruta(rutaId)));
    if (!ruta) { c.innerHTML = '<div class="empty">Ruta no encontrada.</div>'; return; }
    ruta.demoraPorId = ruta.demoraPorId || {};
    ruta.progreso = ruta.progreso || {};
    // Estado al abrir el editor: sirve para no degradar/pisar una ruta que el
    // chofer ya aceptó o está haciendo, y para detectar paradas agregadas.
    const yaAsignada = !esNueva && ruta.estado !== 'borrador';
    const enMarcha = !esNueva && ['asignada', 'aceptada', 'en_curso'].includes(ruta.estado);
    const idsOriginales = new Set((ruta.pedidoIds || []).slice());
    const repOriginal = ruta.repartidorId;

    const repartidores = Store.users().filter((u) => u.roles.includes('repartidor') && u.activo);
    // pedidos elegibles: pendientes + los que ya están en esta ruta
    // Elegibles: pendientes (o ya en esta ruta), TENGAN O NO ubicación. Los que
    // no tienen coords (p. ej. una dirección fuera de zona) se pueden asignar
    // igual: van al final del recorrido y el chofer los navega por la dirección.
    // IMPORTANTE: un pedido que ya pertenece a OTRA ruta NO aparece acá, así no
    // se asigna dos veces por error (rutas duplicadas). Solo vuelven a estar
    // disponibles si se elimina/edita esa ruta o se reabren con "↻ Reasignar".
    const elegibles = Store.pedidos().filter((p) =>
      ruta.pedidoIds.includes(p.id) ||
      (p.estado === 'pendiente' && (!p.rutaId || p.rutaId === ruta.id))
    );

    c.innerHTML = `
      <div class="section-title">
        <h2>${esNueva ? 'Armar ruta' : 'Editar ruta'}</h2>
        <button class="btn btn-ghost btn-sm" id="r-volver">← Volver</button>
      </div>
      <div class="note">Punto A y B fijados al depósito <b>Acuña 1334, Villa Tesei</b>. Podés modificarlos por cualquier inconveniente.</div>
      ${yaAsignada ? `<div class="note" style="background:#fff7e6;border-color:#f0c97a;color:#8a5a00">✏️ Estás editando una ruta <b>ya asignada</b>. Las paradas que agregues se suman al final del recorrido; al guardar, el chofer ve los cambios en su panel y puede volver a optimizar.</div>` : ''}
      <div class="panel"><div class="panel-b">
        <div class="form-grid">
          <div class="field"><label>Nombre de la ruta</label><input id="r-nom" value="${esc(ruta.nombre)}"/></div>
          <div class="field"><label>Fecha</label><input id="r-fec" type="date" value="${esc(ruta.fecha)}"/></div>
          <div class="field"><label>Repartidor (chofer)</label>
            <select id="r-rep"><option value="">— Seleccionar —</option>${repartidores.map((u) => `<option value="${u.id}"${u.id===ruta.repartidorId?' selected':''}>${esc(u.nombre)}</option>`).join('')}</select></div>
          <div class="field"><label>Vehículo</label>
            <select id="r-veh"><option value="">— Seleccionar —</option>${Store.vehiculos().map((v) => `<option value="${v.id}"${v.id===ruta.vehiculoId?' selected':''}>${esc(v.nombre)} (${esc(v.patente)})</option>`).join('')}</select></div>
          <div class="field"><label>Salida</label>
            <span class="help">⏱ <b>Automática.</b> Los horarios de llegada se calculan SIEMPRE desde la <b>hora en vivo</b> y la <b>ubicación real</b> del chofer mientras reparte — nunca desde una hora fija ni la de confirmación. Si el chofer se demora, el ETA se ajusta solo.</span></div>
          <div class="field"><label>Demora por parada (min)</label><input id="r-dem" type="number" min="0" value="${ruta.demoraDefaultMin}"/>
            <span class="help">Tiempo estimado de descarga/entrega por cliente.</span></div>
          <div class="field col-2"><label><input type="checkbox" id="r-same" ${ruta.sameAsOrigin?'checked':''} style="width:auto"/> Finalizar en el mismo punto de salida (depósito)</label></div>
          <div class="field"><label>Punto A — Salida</label><input id="r-orig" value="${esc(ruta.origen.nombre)}"/>
            <input id="r-orig-c" value="${ruta.origen.lat}, ${ruta.origen.lng}" class="small" style="margin-top:6px"/></div>
          <div class="field" id="r-dest-wrap"><label>Punto B — Regreso</label><input id="r-dest" value="${esc(ruta.destino.nombre)}"/>
            <input id="r-dest-c" value="${ruta.destino.lat}, ${ruta.destino.lng}" class="small" style="margin-top:6px"/></div>
        </div>
      </div></div>

      <div class="panel"><div class="panel-h"><h3>Pedidos a incluir</h3><span class="muted small" id="r-count"></span></div>
        <div class="panel-b flush"><div id="r-peds"></div></div></div>

      <div class="route-layout">
        <div class="panel"><div class="panel-h"><h3>Mapa de la ruta optimizada</h3><a class="btn btn-ghost btn-sm" id="r-navlink" target="_blank">Abrir en Google Maps ↗</a></div>
          <div class="panel-b flush"><div id="map" class="mapbox"></div></div></div>
        <div class="panel"><div class="panel-h"><h3>Orden y tiempos</h3><button class="btn btn-dark btn-sm" id="r-opt">↻ Optimizar</button></div>
          <div class="panel-b"><div id="r-sumario"></div><div class="stop-list" id="r-stops"></div></div></div>
      </div>

      <div class="toolbar" style="margin-top:18px">
        <div class="spacer"></div>
        <button class="btn btn-ghost" id="r-save">Guardar borrador</button>
        <button class="btn btn-primary" id="r-asignar">${yaAsignada ? 'Guardar y avisar al chofer' : 'Optimizar y asignar al chofer'}</button>
      </div>`;

    const $ = (s) => c.querySelector(s);
    const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
    const iniciada = !esNueva && ['aceptada', 'en_curso', 'finalizada'].includes(ruta.estado);
    const toggleDest = () => { $('#r-dest-wrap').style.display = $('#r-same').checked ? 'none' : ''; };
    const toggleAhora = () => { $('#r-sal').style.display = $('#r-ahora').checked ? 'none' : ''; };
    toggleDest(); toggleAhora();
    $('#r-same').onchange = toggleDest;
    $('#r-ahora').onchange = () => { toggleAhora(); recompute(); };
    $('#r-volver').onclick = () => go('#/rutas');

    // lista de pedidos elegibles con checkbox
    const pedsBox = $('#r-peds');
    const drawPeds = () => {
      if (!elegibles.length) { pedsBox.innerHTML = `<div class="empty">No hay pedidos pendientes.</div>`; return; }
      pedsBox.innerHTML = `<table><thead><tr><th style="width:40px"></th><th>Cliente</th><th>Dirección</th><th>Pedido</th><th>Prioridad</th></tr></thead><tbody>
        ${elegibles.map((p) => `<tr>
          <td><input type="checkbox" data-pid="${p.id}" ${ruta.pedidoIds.includes(p.id)?'checked':''} style="width:auto"/></td>
          <td><b>${esc(p.cliente)}</b></td><td class="small">${esc(p.direccion)}${p.lat == null ? ' <span class="chip chip-no" style="font-size:10px">📍 sin ubicar · va al final</span>' : ''}</td>
          <td class="small">${(p.items||[]).map((i)=>i.cantidad+'× '+i.producto).join(', ')}</td>
          <td>${p.prioridad==='alta'?'<span class="chip chip-no">Alta</span>':p.prioridad==='baja'?'<span class="chip chip-pend">Baja</span>':'<span class="chip chip-asig">Normal</span>'}</td>
        </tr>`).join('')}</tbody></table>`;
      pedsBox.querySelectorAll('[data-pid]').forEach((cb) => cb.onchange = () => {
        const id = cb.dataset.pid;
        if (cb.checked) { if (!ruta.pedidoIds.includes(id)) ruta.pedidoIds.push(id); }
        else { ruta.pedidoIds = ruta.pedidoIds.filter((x) => x !== id); delete ruta.demoraPorId[id]; }
        recompute();
      });
      $('#r-count').textContent = `${ruta.pedidoIds.length} seleccionados`;
    };

    const parseCoord = (s, fb) => { const a = s.split(',').map((x) => parseFloat(x.trim())); return (a.length===2 && !isNaN(a[0]) && !isNaN(a[1])) ? { lat: a[0], lng: a[1] } : fb; };
    const readForm = () => {
      ruta.nombre = $('#r-nom').value.trim() || ruta.nombre;
      ruta.fecha = $('#r-fec').value;
      ruta.repartidorId = $('#r-rep').value;
      ruta.vehiculoId = $('#r-veh').value;
      // Horario SIEMPRE en vivo: ya no hay hora de inicio configurable. Para la
      // previsualización usamos la hora actual; en el reparto, el ETA se calcula
      // en vivo desde la posición real del chofer (ver app del chofer y la página
      // de seguimiento del cliente).
      ruta.salirAhora = true;
      ruta.salidaMin = nowMin();
      ruta.demoraDefaultMin = Math.max(0, +$('#r-dem').value || 0);
      ruta.sameAsOrigin = $('#r-same').checked;
      ruta.origen = { nombre: $('#r-orig').value.trim(), ...parseCoord($('#r-orig-c').value, ruta.origen) };
      ruta.destino = ruta.sameAsOrigin ? { ...ruta.origen } : { nombre: $('#r-dest').value.trim(), ...parseCoord($('#r-dest-c').value, ruta.destino) };
    };

    let calc = null, _roadToken = 0;
    const recompute = () => {
      readForm();
      const paradas = ruta.pedidoIds.map((id) => Store.pedido(id)).filter(Boolean);
      let orden;
      let ordenIds = (ruta.orden || []).filter((id) => ruta.pedidoIds.includes(id));
      const faltan = ruta.pedidoIds.filter((id) => !ordenIds.includes(id));
      if (enMarcha && ordenIds.length) {
        // Ruta ya asignada/en curso: NO reordenes lo que el chofer ya está
        // recorriendo. Mantené el orden actual y agregá las paradas nuevas al final.
        ordenIds = ordenIds.concat(faltan);
        orden = ordenIds.map((id) => Store.pedido(id)).filter(Boolean);
        ruta.orden = orden.map((p) => p.id);
      } else if (ordenIds.length === paradas.length && ordenIds.length) {
        orden = ordenIds.map((id) => Store.pedido(id)).filter(Boolean);
        ruta.orden = orden.map((p) => p.id);
      } else {
        orden = Route.optimizar(ruta.origen, paradas, ruta.destino);
        ruta.orden = orden.map((p) => p.id);
      }
      calc = Route.calcular(ruta.origen, orden, ruta.destino, ruta.demoraDefaultMin, ruta.demoraPorId, ruta.salidaMin);
      drawSumario(orden);
      Route.render('map', ruta.origen, orden, ruta.destino, { sameAsOrigin: ruta.sameAsOrigin });
      $('#r-navlink').href = Route.navLink(ruta.origen, orden, ruta.destino);
      $('#r-count').textContent = `${ruta.pedidoIds.length} seleccionados`;
      // Mejora asíncrona: trazado y tiempos reales por calle (OSRM).
      const tok = ++_roadToken;
      if (orden.length) Route.fetchRoad(ruta.origen, orden, ruta.destino).then((road) => {
        if (!road || tok !== _roadToken || !c.isConnected) return;
        calc = Route.calcular(ruta.origen, orden, ruta.destino, ruta.demoraDefaultMin, ruta.demoraPorId, ruta.salidaMin, road);
        drawSumario(orden);
        Route.render('map', ruta.origen, orden, ruta.destino, { sameAsOrigin: ruta.sameAsOrigin, geometry: road.geometry });
      });
    };

    const drawSumario = (orden) => {
      $('#r-sumario').innerHTML = `<div class="route-summary">
        <div class="it"><span class="v">${orden.length}</span><span class="l">Paradas</span></div>
        <div class="it"><span class="v">${calc.totalKm} km</span><span class="l">Distancia</span></div>
        <div class="it"><span class="v">${fmtDur(calc.totalMin)}</span><span class="l">Duración total</span></div>
        <div class="it"><span class="v">${fmtHora(calc.regresoMin)}</span><span class="l">Regreso estimado</span></div>
      </div>`;
      $('#r-stops').innerHTML = `
        <div class="stop depot"><div class="seq">A</div><div class="body"><div class="cli">${esc(ruta.origen.nombre)}</div><div class="dir">Salida ${fmtHora(calc.salidaMin)}</div></div></div>
        ${orden.map((p, i) => {
          const st = ruta.progreso && ruta.progreso[p.id];
          const stChip = st === 'entregado' ? ' <span class="chip chip-entreg">✓ Entregado</span>'
            : st === 'no_entregado' ? ' <span class="chip chip-no">✕ No entregado</span>'
            : st === 'salteado' ? ' <span class="chip chip-salt">↷ Salteado</span>' : '';
          const noEnt = st === 'no_entregado' ? (p.historia || []).slice().reverse().find((e) => e.est === 'no_entregado' && e.detalle) : null;
          return `
          <div class="stop"><div class="seq">${i+1}</div>
            <div class="body"><div class="cli">${esc(p.cliente)}${stChip}${p.lat == null ? ' <span class="chip chip-no" style="font-size:10px">📍 sin ubicar</span>' : ''}</div><div class="dir">${esc(p.direccion)}</div>
              ${noEnt ? `<div class="small" style="color:#c62828;margin-top:4px">Motivo: ${esc(noEnt.detalle)}</div>` : ''}
              <div style="margin-top:6px;display:flex;align-items:center;gap:6px">
                <span class="small muted">Demora:</span>
                <input type="number" min="0" data-dem="${p.id}" value="${ruta.demoraPorId[p.id]!=null?ruta.demoraPorId[p.id]:ruta.demoraDefaultMin}" style="width:70px;padding:5px 8px"/>
                <span class="small muted">min</span>
              </div></div>
            <div class="eta">${fmtHora(calc.llegada[i])}</div></div>`;
        }).join('')}
        <div class="stop depot"><div class="seq">B</div><div class="body"><div class="cli">${esc(ruta.destino.nombre)}</div><div class="dir">Regreso ${fmtHora(calc.regresoMin)}</div></div></div>`;
      $('#r-stops').querySelectorAll('[data-dem]').forEach((el) => el.onchange = () => {
        ruta.demoraPorId[el.dataset.dem] = Math.max(0, +el.value || 0); recompute();
      });
    };

    drawPeds();
    recompute();

    ['#r-nom','#r-fec','#r-rep','#r-veh','#r-sal','#r-dem','#r-orig','#r-orig-c','#r-dest','#r-dest-c'].forEach((s) => {
      const el = $(s); if (el) el.addEventListener('change', recompute);
    });
    $('#r-opt').onclick = () => { ruta.orden = []; recompute(); toast('Ruta optimizada', 'ok'); };

    const persist = (estado) => {
      readForm();
      if (estado) ruta.estado = estado;
      const saved = Store.upsertRuta(ruta);
      ruta.id = saved.id;
      // Estado de los pedidos según el estado de la ruta. No pisamos los que el
      // chofer ya resolvió (entregado / no entregado).
      const estadoPed = ruta.estado === 'borrador' ? null
        : ruta.estado === 'asignada' ? 'asignado' : 'en_ruta'; // aceptada / en_curso
      ruta.pedidoIds.forEach((id) => {
        const p = Store.pedido(id); if (!p) return;
        p.rutaId = saved.id; p.fechaEntrega = ruta.fecha;
        const resuelto = ['entregado', 'no_entregado'].includes(ruta.progreso[id]);
        if (estadoPed && !resuelto) p.estado = estadoPed;
      });
      Store.save();
      return saved;
    };

    $('#r-save').onclick = () => { persist('borrador'); toast('Borrador guardado', 'ok'); go('#/rutas'); };
    $('#r-asignar').onclick = () => {
      readForm();
      if (!ruta.repartidorId) { toast('Asigná un repartidor', 'err'); return; }
      if (!ruta.pedidoIds.length) { toast('Seleccioná al menos un pedido', 'err'); return; }
      // No degradamos una ruta que el chofer ya aceptó / está haciendo: queda
      // en su estado actual; si todavía no estaba asignada, pasa a "asignada".
      const yaEnCurso = ['aceptada', 'en_curso', 'finalizada'].includes(ruta.estado);
      const cambioChofer = repOriginal !== ruta.repartidorId;
      const agregados = ruta.pedidoIds.filter((id) => !idsOriginales.has(id));
      const saved = persist(yaEnCurso ? ruta.estado : 'asignada');
      // Aviso al chofer según el caso.
      if (!yaAsignada || cambioChofer) {
        Store.pushNotif(ruta.repartidorId, `Te asignaron la ruta "${ruta.nombre}" con ${ruta.pedidoIds.length} paradas.`, { tipo: 'ruta', rutaId: saved.id });
      } else if (agregados.length) {
        Store.pushNotif(ruta.repartidorId, `Se actualizó tu ruta "${ruta.nombre}": +${agregados.length} parada(s) (ahora ${ruta.pedidoIds.length}). Si querés, volvé a optimizar el recorrido.`, { tipo: 'ruta', rutaId: saved.id });
      } else {
        Store.pushNotif(ruta.repartidorId, `Se actualizó tu ruta "${ruta.nombre}".`, { tipo: 'ruta', rutaId: saved.id });
      }
      toast(yaAsignada ? 'Ruta actualizada · se avisó al chofer' : 'Ruta asignada al chofer', 'ok');
      go('#/rutas');
    };
  };
})();
