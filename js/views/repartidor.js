/* ====== Vistas: Repartidor (mobile) ====== */
window.GDO = window.GDO || {}; GDO.Views = GDO.Views || {};
(function () {
  const { Store, Route } = GDO;
  const { esc, h, toast, modal, confirmDlg, fmtFecha, fmtHora, fmtDur } = GDO.UI;
  const go = (hash) => { location.hash = hash; };
  const fmtN = (n) => Number(n || 0).toLocaleString('es-AR');

  /* ---- GDO CLUB: acreditar Puntos GDO al socio en la entrega ----
     Online y directo a Firestore (no usa la cache local): transacción atómica
     sobre /clientes + /puntos_log (auditoría) y, si vino de un escaneo del QR,
     marca la /visitas como atendida. Los puntos los mueve SIEMPRE el personal
     (el chofer es staff); ver firestore.rules. */
  const clubDB = () => (GDO.FB && GDO.FB.enabled && GDO.FB.db && window.firebase) ? GDO.FB.db : null;
  function acreditarSocio(clienteUid, delta, motivo, pedidoId, visitaId) {
    const fdb = clubDB();
    if (!fdb || !clienteUid || !(delta > 0)) return Promise.reject(new Error('sin db'));
    const cref = fdb.collection('clientes').doc(clienteUid);
    const lref = fdb.collection('puntos_log').doc();
    const FV = firebase.firestore.FieldValue;
    const por = (GDO.FB && GDO.FB.uid) || null;
    return fdb.runTransaction((tx) => tx.get(cref).then((cd) => {
      if (!cd.exists) throw new Error('socio inexistente');
      const nuevo = (cd.data().puntos || 0) + delta;
      tx.update(cref, { puntos: nuevo });
      tx.set(lref, { clienteUid: clienteUid, delta: delta, motivo: motivo || '', saldo: nuevo, pedidoId: pedidoId || null, por: por, ts: FV.serverTimestamp() });
      if (visitaId) tx.update(fdb.collection('visitas').doc(visitaId), { estado: 'atendido', puntos: delta, por: por, cierreTs: FV.serverTimestamp() });
    }));
  }

  /* ---------- GPS del chofer EN VIVO ----------
     Mientras el chofer está repartiendo (ruta aceptada/en curso), publicamos su
     posición a la ruta cada ~15s. La página de seguimiento del cliente la lee y
     muestra al chofer en el mapa + el ETA real. El estado vive a nivel módulo
     (no en el closure de la vista) para que los re-render NO creen watchers
     duplicados: hay un único watch activo a la vez. */
  let _gpsWatchId = null, _gpsLast = 0, _gpsRutaId = null;
  function pararGPSChofer() {
    if (_gpsWatchId != null && navigator.geolocation) { try { navigator.geolocation.clearWatch(_gpsWatchId); } catch (e) {} }
    _gpsWatchId = null; _gpsRutaId = null;
  }
  function iniciarGPSChofer(rutaId) {
    if (_gpsWatchId != null && _gpsRutaId === rutaId) return; // ya activo para esta ruta
    pararGPSChofer();
    if (!navigator.geolocation) return;
    _gpsRutaId = rutaId; _gpsLast = 0;
    _gpsWatchId = navigator.geolocation.watchPosition(function (pos) {
      const now = Date.now();
      if (now - _gpsLast < 15000) return; // máx 1 escritura cada 15s
      _gpsLast = now;
      try { Store.setChoferPos(rutaId, { lat: pos.coords.latitude, lng: pos.coords.longitude, ts: now }); } catch (e) {}
    }, function () {}, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
  }

  /* ---------- Lista de rutas del chofer ---------- */
  GDO.Views.misRutas = function (mount) {
    const me = Store.current();
    // El chofer ve solo sus rutas activas: NO mostramos borradores ni las
    // FINALIZADAS (una vez que terminó la ruta, desaparece de su panel).
    const rutas = Store.rutasDe(me.id).filter((r) => r.estado !== 'borrador' && r.estado !== 'finalizada').sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
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
          ${GDO.footHTML ? GDO.footHTML() : ''}
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
    const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
    const recalc = () => {
      const ord = orden();
      // "Salir ahora": los horarios se calculan SIEMPRE desde la hora ACTUAL (en
      // vivo), no desde la salida planificada ni congelada al aceptar. Así el ETA
      // que ve el chofer (y el que se informa al cliente) refleja la hora real.
      // Solo una ruta finalizada deja de moverse.
      const sal = (ruta.salirAhora !== false && ruta.estado !== 'finalizada') ? nowMin() : ruta.salidaMin;
      return Route.calcular(ruta.origen, ord, ruta.destino, ruta.demoraDefaultMin, ruta.demoraPorId, sal, _road);
    };

    // ETA EN VIVO de una parada: hora actual + lo que falta desde DONDE está el
    // chofer AHORA (su GPS en vivo si es reciente, si no la última parada ya
    // resuelta), salteando las entregadas. Mismo criterio EXACTO que la página de
    // seguimiento del cliente, para que chofer y cliente vean el MISMO horario.
    // Nunca usa la hora de confirmación de la ruta.
    const VEL_KMH_VIVO = 24;
    const _hav = (a, b) => {
      const R = 6371, toR = (d) => d * Math.PI / 180;
      const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
      const x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
      return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    };
    const etaVivoMin = (targetId) => {
      const ids = (ruta.orden && ruta.orden.length ? ruta.orden : ruta.pedidoIds) || [];
      const idx = ids.indexOf(targetId);
      if (idx < 0) return null;
      const prog = ruta.progreso || {};
      const coord = (id) => { const p = Store.pedido(id); return (p && p.lat != null) ? { lat: p.lat, lng: p.lng } : null; };
      const now = new Date(); let t = now.getHours() * 60 + now.getMinutes();
      const chofer = (ruta.choferPos && ruta.choferPos.lat != null && (Date.now() - (ruta.choferPos.ts || 0) < 300000)) ? ruta.choferPos : null;
      let prev = chofer || ruta.origen;
      if (!chofer) { for (let j = 0; j < idx; j++) { const st = prog[ids[j]]; if (st === 'entregado' || st === 'no_entregado') { const pj = coord(ids[j]); if (pj) prev = pj; } } }
      for (let i = 0; i <= idx; i++) {
        const st = prog[ids[i]];
        if (st === 'entregado' || st === 'no_entregado') continue;
        const p = coord(ids[i]);
        if (p && prev && prev.lat != null) t += (_hav(prev, p) / VEL_KMH_VIVO) * 60;
        if (i < idx) { const dem = (ruta.demoraPorId && ruta.demoraPorId[ids[i]] != null) ? ruta.demoraPorId[ids[i]] : (ruta.demoraDefaultMin || 0); t += dem; }
        if (p) prev = p;
      }
      return t;
    };

    // ETA "como Google Maps": tiempo de manejo REAL (calles + tráfico) desde la
    // posición en vivo del chofer hasta el PRÓXIMO cliente, vía Directions API.
    // Se consulta SOLO para la parada actual y con tope de 1 consulta cada 120s
    // (barato: es interno y lo dispara el chofer, ~1 por entrega). Si Google no
    // está disponible, cae al estimado por calles aproximado (etaVivoMin).
    const _gEta = {}; // pedidoId -> { min, ts }
    const _choferVivo = () => (ruta.choferPos && ruta.choferPos.lat != null && (Date.now() - (ruta.choferPos.ts || 0) < 300000)) ? ruta.choferPos : null;
    function pedirEtaGoogle(stop) {
      try {
        if (!stop || stop.lat == null) return;
        if (!(GDO.Google && GDO.Google.disponible)) return;
        if (!(window.google && google.maps && google.maps.DirectionsService)) return;
        const chofer = _choferVivo(); if (!chofer) return;
        const cached = _gEta[stop.id];
        if (cached && Date.now() - cached.ts < 120000) return; // todavía fresco / consulta en curso
        _gEta[stop.id] = Object.assign({}, cached, { ts: Date.now() }); // marca para no repetir mientras resuelve
        const svc = new google.maps.DirectionsService();
        svc.route({
          origin: { lat: chofer.lat, lng: chofer.lng },
          destination: { lat: stop.lat, lng: stop.lng },
          travelMode: google.maps.TravelMode.DRIVING,
          drivingOptions: { departureTime: new Date(), trafficModel: google.maps.TrafficModel.BEST_GUESS },
        }, (res, status) => {
          if (status !== 'OK' || !res || !res.routes || !res.routes[0] || !res.routes[0].legs[0]) return;
          const leg = res.routes[0].legs[0];
          const durSec = (leg.duration_in_traffic || leg.duration).value;
          const now = new Date();
          _gEta[stop.id] = { min: now.getHours() * 60 + now.getMinutes() + Math.round(durSec / 60), ts: Date.now() };
          if (mount.isConnected) render();
        });
      } catch (e) {}
    }
    // ETA a mostrar/enviar: el de Google si lo tenemos reciente (< 3 min), si no
    // el estimado en vivo. Anclado SIEMPRE a la hora actual.
    const etaMostrar = (p) => {
      const g = _gEta[p.id];
      if (g && g.min != null && Date.now() - g.ts < 180000) return g.min;
      return etaVivoMin(p.id);
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
      Store.upsertRuta(ruta); Store.upsertPedido(p); Store.save();
      avisar(p, accionLabel, detalle);
      render();
    }

    function render() {
      // Si el chofer YA salió de esta ruta (cambió el hash, p. ej. al finalizar y
      // volver a "Mis rutas"), NO re-pintamos. Sin esto, callbacks async que
      // siguen vivos unos segundos (ruteo OSRM, intervalo de ETA, ETA de Google)
      // re-dibujaban la ruta finalizada en el panel "automáticamente".
      if (location.hash !== '#/ruta/' + rutaId) return;
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

            ${ruta.estado !== 'finalizada' && pendientes.length >= 2 && ruta.choferPuedeModificar !== false ? `<button class="btn btn-dark btn-block" id="d-reopt" style="margin-bottom:14px">↻ Optimizar el recorrido que falta</button>` : ''}

            ${!aceptada ? `
              <div class="dstop cur" style="text-align:center">
                <p style="margin:0 0 10px">Revisá la ruta y aceptala para comenzar el reparto.</p>
                <button class="btn btn-primary btn-lg btn-block" id="d-aceptar">✓ Aceptar ruta y comenzar</button>
              </div>` : ''}

            <div id="d-stops"></div>
            ${GDO.footHTML ? GDO.footHTML() : ''}
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
      // Pedimos a Google el tiempo real de manejo hacia el próximo cliente.
      if (cur && aceptada && ruta.estado !== 'finalizada') pedirEtaGoogle(cur);
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
          <div class="eta">${done ? '' : '⏱ Llegada estimada ' + fmtHora(etaMostrar(p)) + ' · '}${(p.items||[]).map((x)=>x.cantidad+'× '+x.producto).join(', ')}</div>
          ${p.especificaciones ? `<div class="spec">📌 ${esc(p.especificaciones)}</div>` : ''}
          ${p.puntos > 0 ? `<div class="spec">⭐ ${p.puntosAcreditados ? 'Puntos GDO acreditados (' + fmtN(p.puntos) + ')' : fmtN(p.puntos) + ' Puntos GDO al entregar'}</div>` : ''}
          ${aceptada && ruta.estado !== 'finalizada' && !done ? `<div class="acts">
              <a class="btn btn-dark full" data-nav="${p.id}" href="${(p.direccion || p.lat != null) ? Route.navStop(p) : '#'}" target="_blank"${!(p.direccion || p.lat != null) ? ' style="opacity:.5;pointer-events:none"' : ''}>🧭 Navegar a esta parada</a>
              ${GDO.Wpp && GDO.Wpp.tieneTel(p.telefono) ? `<a class="btn btn-verde full" href="${GDO.Wpp.link(p.telefono, GDO.Wpp.msg('cerca', p, { eta: fmtHora(etaMostrar(p)), link: GDO.Wpp.seguimientoUrl(p.id) }))}" target="_blank">💬 Avisar al cliente (está por llegar)</a>` : ''}
              <button class="btn btn-verde" data-ok="${p.id}">✓ Entregado</button>
              <button class="btn btn-rojo" data-no="${p.id}">✕ No entregado</button>
              <button class="btn btn-amarillo full" data-skip="${p.id}">↷ Saltear parada</button>
            </div>` : ''}
          ${aceptada && ruta.estado !== 'finalizada' && done ? `<div class="acts">
              ${(st === 'entregado' && p.puntos > 0 && !p.puntosAcreditados && clubDB()) ? `<button class="btn btn-verde full" data-pts="${p.id}">⭐ Sumar ${fmtN(p.puntos)} Puntos GDO</button>` : ''}
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
      if (ac) ac.onclick = () => {
        ruta.estado = 'aceptada';
        // No congelamos la salida: con "salir ahora" los horarios siguen siendo
        // en vivo (hora actual) tanto para el chofer como para el cliente.
        Store.upsertRuta(ruta); ruta.pedidoIds.forEach((id)=>{const p=Store.pedido(id); if(p)p.estado='en_ruta';}); Store.save(); toast('Ruta aceptada. ¡Buen reparto!', 'ok'); render();
      };
      box.querySelectorAll('[data-ok]').forEach((b) => b.onclick = () => {
        const p = Store.pedido(b.dataset.ok);
        comprobanteModal(p, (pod) => {
          ruta.estado = 'en_curso';
          if (pod) p.pod = pod;
          setEstado(p, 'entregado', 'Entregado', pod && pod.receptor ? 'Recibió: ' + pod.receptor : '');
          toast('Entrega confirmada', 'ok');
          // ¿El pedido suma Puntos GDO? Ofrecemos cargarlos al socio (QR en la puerta).
          if (p.puntos > 0 && !p.puntosAcreditados) creditarEntrega(p);
        });
      });
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
      // sumar puntos a posteriori (volvió la señal, o el cliente escaneó tarde)
      box.querySelectorAll('[data-pts]').forEach((b) => b.onclick = () => {
        const p = Store.pedido(b.dataset.pts); if (p) creditarEntrega(p);
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
        pararGPSChofer(); // ruta finalizada: dejamos de publicar el GPS
        Store.upsertRuta(ruta); Store.save();
        Store.admins().forEach((a) => Store.pushNotif(a.id, `Ruta "${ruta.nombre}" finalizada por ${me.nombre.split(' ')[0]}.`, { tipo: 'ruta', rutaId: ruta.id }));
        toast('Ruta finalizada', 'ok'); go('#/mis-rutas'); // cerramos: volvemos a la lista
      }, 'Confirmar', 'btn-verde');
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
        const aplicar = (inicio, enVivo) => {
          const opt = Route.optimizar(inicio, restantes, ruta.destino);
          ruta.orden = hechos.map((p) => p.id).concat(opt.map((p) => p.id));
          _road = null; _roadSig = ''; // forzar recálculo del trazado real por calles
          Store.upsertRuta(ruta); Store.save();
          toast('Recorrido reoptimizado' + (enVivo ? ' desde tu ubicación' : '') + ' ✓', 'ok');
          render();
        };
        // Optimizamos lo que falta DESDE DONDE ESTÁ EL CHOFER AHORA (p. ej. salió
        // desde un proveedor, no del depósito). Tomamos su GPS en vivo; si no se
        // puede, la última posición conocida y, si no, el depósito.
        const prev = reopt.textContent;
        if (navigator.geolocation) {
          reopt.disabled = true; reopt.textContent = 'Ubicándote…';
          navigator.geolocation.getCurrentPosition(
            (pos) => { reopt.disabled = false; reopt.textContent = prev; aplicar({ nombre: 'Mi ubicación', lat: pos.coords.latitude, lng: pos.coords.longitude }, true); },
            () => { reopt.disabled = false; reopt.textContent = prev; const f = _choferVivo(); aplicar(f || ruta.origen, !!f); },
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 }
          );
        } else { const f = _choferVivo(); aplicar(f || ruta.origen, !!f); }
      };
      wireTop(mount);

      // GPS en vivo: encendido solo mientras la ruta está activa (aceptada / en
      // curso). En cuanto se finaliza, se apaga. Es idempotente: no reinicia el
      // watch en cada re-render.
      if (['aceptada', 'en_curso'].includes(ruta.estado)) iniciarGPSChofer(ruta.id);
      else pararGPSChofer();
    }

    // Comprobante de entrega: foto del lugar/mercadería + firma de quien recibe.
    // Todo opcional (el chofer puede confirmar sin nada), pero deja constancia.
    // La foto se comprime antes de guardar para no inflar Firestore.
    function comprobanteModal(p, onOk) {
      const m = modal({
        title: 'Comprobante de entrega', width: 460,
        bodyHTML: `
          <div class="field"><label>📷 Foto (opcional)</label>
            <input type="file" accept="image/*" capture="environment" id="pod-foto"/>
            <img id="pod-prev" style="display:none;margin-top:8px;max-width:100%;border-radius:10px;border:1px solid #e3e3e3"/>
          </div>
          <div class="field"><label>✍️ Firma de quien recibe (opcional)</label>
            <canvas id="pod-firma" style="width:100%;height:150px;border:1px dashed #c8c8c8;border-radius:10px;background:#fff;touch-action:none"></canvas>
            <button class="btn btn-ghost btn-sm" id="pod-clear" type="button" style="align-self:flex-start;margin-top:6px">Borrar firma</button>
          </div>
          <div class="field"><label>Recibió (opcional)</label>
            <input id="pod-rec" placeholder="Nombre de quien recibió"/></div>
          <div class="note">Podés confirmar sin foto ni firma. Quedan guardadas como respaldo de la entrega.</div>`,
        footHTML: `<button class="btn btn-ghost" data-c>Cancelar</button><button class="btn btn-verde" data-ok>✓ Confirmar entrega</button>`,
        onMount(node, close) {
          let fotoData = '';
          const prev = node.querySelector('#pod-prev');
          const inp = node.querySelector('#pod-foto');
          inp.onchange = async () => {
            const f = inp.files && inp.files[0];
            if (!f) { fotoData = ''; prev.style.display = 'none'; return; }
            try { fotoData = await GDO.Img.comprimir(f); prev.src = fotoData; prev.style.display = 'block'; }
            catch (e) { toast('No se pudo procesar la foto', 'err'); fotoData = ''; }
          };
          const firma = GDO.Sign.pad(node.querySelector('#pod-firma'));
          node.querySelector('#pod-clear').onclick = () => firma.limpiar();
          node.querySelector('[data-c]').onclick = close;
          node.querySelector('[data-ok]').onclick = () => {
            const receptor = node.querySelector('#pod-rec').value.trim();
            const firmaData = firma.dataURL();
            const pod = (fotoData || firmaData || receptor)
              ? { foto: fotoData || '', firma: firmaData || '', receptor, ts: Date.now() }
              : null;
            close();
            onOk(pod);
          };
        },
      });
      return m;
    }

    function motivoModal(title, onOk) {
      modal({
        title, width: 440,
        bodyHTML: `<div class="field"><label>Detalle (opcional)</label><textarea id="mot" placeholder="Ej: local cerrado, cliente ausente, rechazó mercadería…"></textarea></div>`,
        footHTML: `<button class="btn btn-ghost" data-c>Cancelar</button><button class="btn btn-primary" data-ok>Confirmar</button>`,
        onMount(node, close) { node.querySelector('[data-c]').onclick = close; node.querySelector('[data-ok]').onclick = () => { close(); onOk(node.querySelector('#mot').value.trim()); }; },
      });
    }

    // Acreditar los Puntos GDO de la entrega: el cliente escanea el QR del Club
    // en la puerta → aparece su check-in en vivo → el chofer toca su nombre y se
    // le suman los puntos que cargó el admin en el pedido. A prueba de doble
    // carga (p.puntosAcreditados) y de fraude (el monto NO viaja en el QR).
    function creditarEntrega(p) {
      if (!p || !(p.puntos > 0) || p.puntosAcreditados) return;
      const fdb = clubDB();
      if (!fdb) { toast('Sin conexión: los Puntos GDO se cargan cuando vuelva la señal (botón ⭐).', ''); return; }
      // Pedido online YA vinculado a un socio (se logueó en la tienda): su identidad
      // quedó probada al loguearse, así que acreditamos directo, sin escanear.
      if (p.clienteUid) {
        fdb.collection('clientes').doc(p.clienteUid).get().then((d) => {
          const nom = esc((d.exists && d.data().nombre) ? d.data().nombre : 'el socio');
          confirmDlg('Sumar ' + fmtN(p.puntos) + ' Puntos GDO a ' + nom + '?', () => {
            acreditarSocio(p.clienteUid, p.puntos, 'Entrega a domicilio (pedido online)', p.id, null)
              .then(() => { Store.upsertPedido({ id: p.id, puntosAcreditados: true }); toast('🎁 ' + fmtN(p.puntos) + ' Puntos GDO acreditados', 'ok'); render(); })
              .catch(() => toast('No se pudo acreditar. Reintentá.', 'err'));
          }, 'Sumar puntos', 'btn-verde');
        }).catch(() => toast('No se pudo leer el socio. Reintentá.', 'err'));
        return;
      }
      let subV = null, hecho = false;
      modal({
        title: '⭐ Sumar ' + fmtN(p.puntos) + ' Puntos GDO',
        width: 460,
        bodyHTML: `
          <div class="note">Pedile al cliente que escanee el <b>QR del GDO CLUB</b> en la puerta. Cuando escanee, aparece acá abajo y tocás su nombre.</div>
          <div id="ce-list" style="margin-top:10px"><div class="empty">Esperando que el cliente escanee el QR…</div></div>`,
        footHTML: `<button class="btn btn-ghost" data-c>El cliente no es socio</button>`,
        onMount(node, close) {
          const list = node.querySelector('#ce-list');
          node.querySelector('[data-c]').onclick = () => { if (subV) { try { subV(); } catch (e) {} } close(); };
          subV = fdb.collection('visitas').where('estado', '==', 'pendiente').onSnapshot((snap) => {
            const arr = []; snap.forEach((d) => { const x = d.data(); x._id = d.id; arr.push(x); });
            arr.sort((a, b) => ((b.ts && b.ts.toMillis ? b.ts.toMillis() : 0) - (a.ts && a.ts.toMillis ? a.ts.toMillis() : 0)));
            if (!arr.length) { list.innerHTML = '<div class="empty">Esperando que el cliente escanee el QR…</div>'; return; }
            list.innerHTML = arr.map((v) => `<button class="btn btn-verde btn-block" data-v="${esc(v._id)}" data-u="${esc(v.clienteUid)}" style="margin-bottom:8px;text-align:left">➕ ${esc(v.nombre || 'Socio')} · N° ${('0000' + (v.nroSocio || 0)).slice(-4)}</button>`).join('');
            list.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => {
              if (hecho) return; hecho = true; b.disabled = true; b.textContent = 'Sumando…';
              acreditarSocio(b.dataset.u, p.puntos, 'Entrega a domicilio', p.id, b.dataset.v)
                .then(() => {
                  Store.upsertPedido({ id: p.id, clienteUid: b.dataset.u, puntosAcreditados: true });
                  if (subV) { try { subV(); } catch (e) {} }
                  close(); toast('🎁 ' + fmtN(p.puntos) + ' Puntos GDO acreditados', 'ok'); render();
                })
                .catch(() => { hecho = false; b.disabled = false; toast('No se pudo acreditar. Reintentá.', 'err'); });
            });
          }, () => { list.innerHTML = '<div class="empty">No se pudieron leer los check-ins. Revisá la conexión.</div>'; });
        },
      });
    }

    render();

    // Refresco en vivo: con "salir ahora" los horarios dependen de la hora
    // actual, así que re-dibujamos cuando cambia el minuto (mientras la ruta
    // siga activa y la vista montada). Así el ETA avanza solo, sin tocar nada.
    let _lastMin = nowMin();
    const _timer = setInterval(() => {
      if (!mount.isConnected || location.hash !== '#/ruta/' + rutaId) { clearInterval(_timer); return; }
      if (ruta.estado === 'finalizada' || ruta.salirAhora === false) return;
      const m = nowMin();
      if (m !== _lastMin) { _lastMin = m; render(); }
    }, 20000);
  };
})();
