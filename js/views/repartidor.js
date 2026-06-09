/* ====== Vistas: Repartidor (mobile) ====== */
window.GDO = window.GDO || {}; GDO.Views = GDO.Views || {};
(function () {
  const { Store, Route } = GDO;
  const { esc, h, toast, modal, confirmDlg, fmtFecha, fmtHora, fmtDur } = GDO.UI;
  const go = (hash) => { location.hash = hash; };

  /* ---------- Lista de rutas del chofer ---------- */
  GDO.Views.misRutas = function (mount) {
    const me = Store.current();
    const rutas = Store.rutasDe(me.id).filter((r) => r.estado !== 'borrador').sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
    mount.className = '';
    mount.innerHTML = `
      <div class="driver">
        ${driverTop(me, false)}
        <div class="driver-body">
          <h2 style="margin:6px 0 14px">Mis rutas</h2>
          ${rutas.length ? rutas.map((r) => {
            const veh = Store.vehiculos().find((v) => v.id === r.vehiculoId);
            return `<div class="dstop" data-open="${r.id}" style="cursor:pointer">
              <div class="hd"><div><div class="cli">${esc(r.nombre)}</div>
                <div class="dir">${fmtFecha(r.fecha)} · ${r.pedidoIds.length} paradas${veh ? ' · ' + esc(veh.nombre) : ''}</div></div>
                ${GDO.Views.ESTADO_RUTA[r.estado] || ''}</div>
              <div class="eta">Tocar para ver →</div></div>`;
          }).join('') : `<div class="empty">No tenés rutas asignadas todavía.</div>`}
        </div>
      </div>`;
    mount.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => go('#/ruta/' + b.dataset.open));
    wireTop(mount);
  };

  function driverTop(me, back) {
    return `<div class="driver-top">
      ${back ? '<button class="logout" id="d-back">← Atrás</button>' : '<img src="assets/logo-horizontal-blanco.svg" alt="GDO"/>'}
      <span style="font-weight:700;font-size:14px">${back ? '' : esc(me.nombre.split(' ')[0])}</span>
      <button class="logout" id="d-logout">Salir</button>
    </div>`;
  }
  function wireTop(mount) {
    const lo = mount.querySelector('#d-logout'); if (lo) lo.onclick = () => GDO.App.logout();
    const bk = mount.querySelector('#d-back'); if (bk) bk.onclick = () => go('#/mis-rutas');
  }

  /* ---------- Ejecución de ruta ---------- */
  GDO.Views.rutaChofer = function (mount, rutaId) {
    const me = Store.current();
    const ruta = Store.ruta(rutaId);
    if (!ruta || ruta.repartidorId !== me.id) { mount.innerHTML = '<div class="empty">Ruta no disponible.</div>'; return; }
    ruta.demoraPorId = ruta.demoraPorId || {};
    ruta.progreso = ruta.progreso || {}; // pedidoId -> 'entregado'|'no_entregado'|'salteado'

    const orden = () => (ruta.orden && ruta.orden.length ? ruta.orden : ruta.pedidoIds).map((id) => Store.pedido(id)).filter(Boolean);

    // Ruteo real por calles (OSRM): se pide una vez por orden de paradas y se
    // cachea en _road; cuando llega, se redibuja con tiempos y trazado reales.
    let _road = null, _roadSig = '';
    const ordSig = (ord) => ord.map((p) => p.id).join(',') + '|' + ruta.origen.lat + ',' + ruta.origen.lng;
    const recalc = () => {
      const ord = orden();
      return Route.calcular(ruta.origen, ord, ruta.destino, ruta.demoraDefaultMin, ruta.demoraPorId, ruta.salidaMin, _road);
    };

    function avisar(p, accion, detalle) {
      const autor = Store.user(p.creadoPor);
      const msg = `Pedido "${p.cliente}" — ${accion}${detalle ? ': ' + detalle : ''} (ruta ${ruta.nombre}, repartidor ${me.nombre.split(' ')[0]}).`;
      const destinos = new Set();
      if (p.creadoPor) destinos.add(p.creadoPor);
      Store.admins().forEach((a) => destinos.add(a.id));
      destinos.delete(me.id);
      destinos.forEach((uid) => Store.pushNotif(uid, msg, { tipo: 'cambio', pedidoId: p.id, rutaId: ruta.id }));
    }

    function setEstado(p, est, accionLabel, detalle) {
      ruta.progreso[p.id] = est;
      p.estado = est === 'salteado' ? 'salteado' : est;
      if (est === 'salteado') p.salteado = true;
      p.historia = p.historia || [];
      p.historia.push({ ts: Date.now(), est, detalle: detalle || '', por: me.id });
      Store.upsertRuta(ruta); Store.save();
      avisar(p, accionLabel, detalle);
      render();
    }

    function render() {
      const ord = orden();
      const calc = recalc();
      const hechos = ord.filter((p) => ruta.progreso[p.id] === 'entregado' || ruta.progreso[p.id] === 'no_entregado').length;
      const pendientes = ord.filter((p) => !ruta.progreso[p.id] || ruta.progreso[p.id] === 'salteado');
      // índice de la parada actual (primera no resuelta y no salteada en esta pasada)
      const curId = (() => { const f = ord.find((p) => !ruta.progreso[p.id]); return f ? f.id : (pendientes[0] ? pendientes[0].id : null); })();

      const aceptada = ['aceptada', 'en_curso', 'finalizada'].includes(ruta.estado);
      mount.className = '';
      mount.innerHTML = `
        <div class="driver">
          ${driverTop(me, true)}
          <div class="driver-body">
            <div class="route-pill">
              <h3>${esc(ruta.nombre)}</h3>
              <div class="gps-line" style="color:#ffe9d2"><span class="gps-dot"></span> GPS activo · optimización en vivo</div>
              <div class="meta">
                <div><b>${ord.length}</b>Paradas</div>
                <div><b>${calc.totalKm} km</b>Distancia</div>
                <div><b>${fmtDur(calc.totalMin)}</b>Duración</div>
                <div><b>${fmtHora(calc.regresoMin)}</b>Regreso</div>
              </div>
            </div>

            ${ruta.estado === 'finalizada' ? `<div class="note" style="background:#e3f5ea;border-color:#9ad9b4;color:#1d7a44"><b>Ruta finalizada.</b> ${hechos} de ${ord.length} paradas resueltas.</div>` : ''}

            <div class="panel" style="margin-bottom:14px"><div class="panel-b flush"><div id="dmap" class="mapbox" style="height:240px"></div></div></div>

            ${ruta.estado !== 'finalizada' && pendientes.length >= 2 ? `<button class="btn btn-dark btn-block" id="d-reopt" style="margin-bottom:14px">↻ Optimizar el recorrido que falta</button>` : ''}

            ${!aceptada ? `
              <div class="dstop cur" style="text-align:center">
                <p style="margin:0 0 10px">Revisá la ruta y aceptala para comenzar el reparto.</p>
                <button class="btn btn-primary btn-lg btn-block" id="d-aceptar">✓ Aceptar ruta y comenzar</button>
              </div>` : ''}

            <div id="d-stops"></div>
          </div>
          ${aceptada && ruta.estado !== 'finalizada' ? `<div class="driver-foot">
            <a class="btn btn-dark" id="d-nav" target="_blank">🧭 Navegar</a>
            <button class="btn btn-verde" id="d-fin">Finalizar ruta</button>
          </div>` : ''}
        </div>`;

      // mapa (con trazado real por calles si ya lo tenemos cacheado)
      Route.render('dmap', ruta.origen, ord, ruta.destino, { sameAsOrigin: ruta.sameAsOrigin, geometry: _road ? _road.geometry : null });
      // pedir ruteo real una vez por orden; al llegar, redibujar
      const sig = ordSig(ord);
      if (sig !== _roadSig && ord.length) {
        _roadSig = sig; _road = null;
        Route.fetchRoad(ruta.origen, ord, ruta.destino).then((road) => {
          if (!road || ordSig(orden()) !== sig || !mount.isConnected) return;
          _road = road; render();
        });
      }
      // ¿ya están resueltas todas las paradas? entonces la próxima "parada" es
      // el regreso al punto final (depósito).
      const allResolved = ord.length > 0 && ord.every((p) => ruta.progreso[p.id] === 'entregado' || ruta.progreso[p.id] === 'no_entregado');
      // Punto de regreso robusto: destino → si no tiene coords, el origen → si
      // tampoco, el depósito. Así el regreso SIEMPRE es un destino navegable y la
      // app no se queda "pegada" en el último pedido.
      const retPoint = (ruta.destino && ruta.destino.lat != null) ? ruta.destino
        : (ruta.origen && ruta.origen.lat != null) ? ruta.origen
        : (Store.depot && Store.depot().lat != null ? Store.depot() : null);
      const retNav = retPoint ? `https://www.google.com/maps/dir/?api=1&destination=${retPoint.lat},${retPoint.lng}&travelmode=driving` : '#';

      // navegación del pie: SOLO la parada actual (no todo el recorrido). Al
      // volver de Maps, el chofer confirma y la próxima pasa a ser la actual.
      const cur = curId ? Store.pedido(curId) : null;
      const nav = mount.querySelector('#d-nav');
      if (nav) {
        if (cur && (cur.direccion || cur.lat != null)) { nav.href = Route.navStop(cur); nav.textContent = `🧭 Navegar a ${esc((cur.cliente || '').split(' ')[0])}`; nav.style.opacity = ''; nav.style.pointerEvents = ''; }
        else if (allResolved && retNav !== '#') { nav.href = retNav; nav.textContent = '🧭 Volver al depósito'; nav.style.opacity = ''; nav.style.pointerEvents = ''; }
        else { nav.href = '#'; nav.textContent = '🧭 Sin parada'; nav.style.opacity = '.5'; nav.style.pointerEvents = 'none'; }
      }

      // paradas
      const box = mount.querySelector('#d-stops');
      box.innerHTML = ord.map((p, i) => {
        const st = ruta.progreso[p.id];
        const done = st === 'entregado' || st === 'no_entregado';
        const isCur = p.id === curId && aceptada && ruta.estado !== 'finalizada';
        let badge = '';
        if (st === 'entregado') badge = '<span class="chip chip-entreg">✓ Entregado</span>';
        else if (st === 'no_entregado') badge = '<span class="chip chip-no">✕ No entregado</span>';
        else if (st === 'salteado') badge = '<span class="chip chip-salt">↷ Salteado (pendiente)</span>';
        return `<div class="dstop ${done ? 'done' : ''} ${isCur ? 'cur' : ''}">
          <div class="hd"><div style="display:flex;gap:10px"><div class="seq">${i + 1}</div>
            <div><div class="cli">${esc(p.cliente)}</div><div class="dir">${esc(p.direccion)}${p.entrecalles ? ' · ' + esc(p.entrecalles) : ''}</div></div></div>
            ${badge}</div>
          <div class="eta">⏱ Llegada estimada ${fmtHora(calc.llegada[i])} · ${(p.items||[]).map((x)=>x.cantidad+'× '+x.producto).join(', ')}</div>
          ${p.especificaciones ? `<div class="spec">📌 ${esc(p.especificaciones)}</div>` : ''}
          ${aceptada && ruta.estado !== 'finalizada' && !done ? `<div class="acts">
              <a class="btn btn-dark full" data-nav="${p.id}" href="${(p.direccion || p.lat != null) ? Route.navStop(p) : '#'}" target="_blank"${!(p.direccion || p.lat != null) ? ' style="opacity:.5;pointer-events:none"' : ''}>🧭 Navegar a esta parada</a>
              <button class="btn btn-verde" data-ok="${p.id}">✓ Entregado</button>
              <button class="btn btn-rojo" data-no="${p.id}">✕ No entregado</button>
              <button class="btn btn-amarillo full" data-skip="${p.id}">↷ Saltear parada</button>
            </div>` : ''}
          ${aceptada && ruta.estado !== 'finalizada' && done ? `<div class="acts">
              <button class="btn btn-ghost full" data-undo="${p.id}">↩ Corregir · volver a marcar</button>
            </div>` : ''}
        </div>`;
      }).join('') + `
        <div class="dstop final ${allResolved && aceptada && ruta.estado !== 'finalizada' ? 'cur' : ''}">
          <div class="hd"><div style="display:flex;gap:10px"><div class="seq">🏁</div>
            <div><div class="cli">Volver al punto final</div><div class="dir">${esc((retPoint && retPoint.nombre) || ruta.destino.nombre || 'Depósito')}</div></div></div>
            ${ruta.estado === 'finalizada' ? '<span class="chip chip-entreg">✓ Ruta finalizada</span>' : ''}</div>
          <div class="eta">⏱ Regreso estimado ${fmtHora(calc.regresoMin)}</div>
          ${aceptada && ruta.estado !== 'finalizada' ? `<div class="acts">
              <a class="btn btn-dark full" href="${retNav}" target="_blank"${retNav === '#' ? ' style="opacity:.5;pointer-events:none"' : ''}>🧭 Navegar al depósito</a>
              <button class="btn btn-verde full" data-volvi>✓ Llegué al depósito · finalizar ruta</button>
            </div>` : ''}
        </div>`;

      // acciones
      const ac = mount.querySelector('#d-aceptar');
      if (ac) ac.onclick = () => { ruta.estado = 'aceptada'; Store.upsertRuta(ruta); ruta.pedidoIds.forEach((id)=>{const p=Store.pedido(id); if(p)p.estado='en_ruta';}); Store.save(); toast('Ruta aceptada. ¡Buen reparto!', 'ok'); render(); };
      box.querySelectorAll('[data-ok]').forEach((b) => b.onclick = () => { ruta.estado='en_curso'; setEstado(Store.pedido(b.dataset.ok), 'entregado', 'Entregado'); toast('Entrega confirmada', 'ok'); });
      box.querySelectorAll('[data-no]').forEach((b) => b.onclick = () => {
        const p = Store.pedido(b.dataset.no);
        motivoModal('Motivo de no entrega', (mot) => { ruta.estado='en_curso'; setEstado(p, 'no_entregado', 'No entregado', mot); toast('Marcado como no entregado · aviso enviado', 'err'); });
      });
      box.querySelectorAll('[data-skip]').forEach((b) => b.onclick = () => {
        const p = Store.pedido(b.dataset.skip);
        confirmDlg(`Saltear "${p.cliente}". Pasás a la próxima entrega y esta queda PENDIENTE en el recorrido. Se avisa a quien cargó el pedido y a administración. ¿Confirmás?`, () => {
          ruta.estado='en_curso'; setEstado(p, 'salteado', 'Parada salteada (queda pendiente)'); toast('Parada salteada · vuelve como pendiente', '');
        }, 'Saltear');
      });
      // corregir: reabre una parada ya marcada (error del chofer) para volver a marcarla
      box.querySelectorAll('[data-undo]').forEach((b) => b.onclick = () => {
        const p = Store.pedido(b.dataset.undo);
        confirmDlg(`Reabrir la entrega de "${p.cliente}" para volver a marcarla. ¿Confirmás?`, () => {
          delete ruta.progreso[p.id];
          p.estado = 'en_ruta'; p.salteado = false;
          p.historia = p.historia || [];
          p.historia.push({ ts: Date.now(), est: 'reabierto', detalle: 'Corrección del chofer', por: me.id });
          Store.upsertRuta(ruta); Store.save();
          avisar(p, 'Entrega reabierta para corrección');
          toast('Entrega reabierta · podés volver a marcarla', '');
          render();
        }, 'Reabrir');
      });
      const finalizar = (msg) => confirmDlg(msg, () => {
        ruta.estado = 'finalizada';
        orden().forEach((p) => { const st = ruta.progreso[p.id]; if (st !== 'entregado' && st !== 'no_entregado') { p.estado = 'pendiente'; p.rutaId = null; } });
        Store.upsertRuta(ruta); Store.save();
        Store.admins().forEach((a) => Store.pushNotif(a.id, `Ruta "${ruta.nombre}" finalizada por ${me.nombre.split(' ')[0]}.`, { tipo: 'ruta', rutaId: ruta.id }));
        toast('Ruta finalizada', 'ok'); render();
      });
      const fin = mount.querySelector('#d-fin');
      if (fin) fin.onclick = () => finalizar('¿Finalizar la ruta? Las paradas salteadas o sin marcar quedarán pendientes.');
      const volvi = mount.querySelector('[data-volvi]');
      if (volvi) volvi.onclick = () => finalizar('¿Confirmás que llegaste al depósito y finalizás la ruta?');
      // Reoptimizar: reordena SOLO lo que falta (las entregadas/no entregadas
      // quedan donde están). Útil cuando llega una parada nueva o cambió algo.
      const reopt = mount.querySelector('#d-reopt');
      if (reopt) reopt.onclick = () => {
        const ordA = orden();
        const hechos = ordA.filter((p) => ['entregado', 'no_entregado'].includes(ruta.progreso[p.id]));
        const restantes = ordA.filter((p) => !['entregado', 'no_entregado'].includes(ruta.progreso[p.id]));
        if (restantes.length < 2) { toast('No hay suficientes paradas para optimizar', ''); return; }
        const opt = Route.optimizar(ruta.origen, restantes, ruta.destino);
        ruta.orden = hechos.map((p) => p.id).concat(opt.map((p) => p.id));
        _road = null; _roadSig = ''; // forzar recálculo del trazado real por calles
        Store.upsertRuta(ruta); Store.save();
        toast('Recorrido reoptimizado ✓', 'ok');
        render();
      };
      wireTop(mount);
    }

    function motivoModal(title, onOk) {
      modal({
        title, width: 440,
        bodyHTML: `<div class="field"><label>Detalle (opcional)</label><textarea id="mot" placeholder="Ej: local cerrado, cliente ausente, rechazó mercadería…"></textarea></div>`,
        footHTML: `<button class="btn btn-ghost" data-c>Cancelar</button><button class="btn btn-primary" data-ok>Confirmar</button>`,
        onMount(node, close) { node.querySelector('[data-c]').onclick = close; node.querySelector('[data-ok]').onclick = () => { close(); onOk(node.querySelector('#mot').value.trim()); }; },
      });
    }

    render();
  };
})();
