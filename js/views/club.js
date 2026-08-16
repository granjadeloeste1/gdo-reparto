/* ====== GDO Reparto — Panel GDO CLUB (fidelización) ======
   Gestión del programa de socios: ver socios, cargar puntos a mano, administrar
   premios y aprobar canjes. SEGURIDAD: los puntos los mueve SOLO el personal,
   siempre en una transacción atómica + registro en /puntos_log. El cliente nunca
   escribe sus puntos (ver firestore.rules). Lee/escribe Firestore directo (uso
   online del staff), no usa la cache local de pedidos. */
window.GDO = window.GDO || {}; GDO.Views = GDO.Views || {};
(function () {
  const { esc, toast, modal, confirmDlg } = GDO.UI;
  const fmt = (n) => Number(n || 0).toLocaleString('es-AR');
  const db = () => (GDO.FB && GDO.FB.enabled && GDO.FB.db) ? GDO.FB.db : null;
  const FV = () => firebase.firestore.FieldValue;
  const staffUid = () => (GDO.FB && GDO.FB.uid) ? GDO.FB.uid : null;
  // El CAJERO solo carga puntos y escanea vouchers: sin premios, sin toggles, sin eliminar.
  const esCajero = () => !!(GDO.Store && GDO.Store.rolActivo && GDO.Store.rolActivo() === 'cajero');
  const padNro = (n) => ('0000' + (n || 0)).slice(-4);
  function fechaCorta(ts) {
    try { const d = ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
      return d ? d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'; }
    catch (e) { return '—'; }
  }
  function horaCorta(ts) {
    try { const d = ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
      return d ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : 'recién'; }
    catch (e) { return 'recién'; }
  }

  let tab = 'mostrador';
  let subs = [];
  function clearSubs() { subs.forEach((u) => { try { u(); } catch (e) {} }); subs = []; }

  GDO.Views.club = function (c) {
    clearSubs();
    if (!db()) { c.innerHTML = '<div class="empty">Sin conexión con la base. Reintentá en un momento.</div>'; return; }
    const cajero = esCajero();
    if (cajero && tab === 'premios') tab = 'mostrador';   // el cajero no administra premios
    c.innerHTML = `
      ${cajero ? '' : `<div id="club-onoff" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:#fff;border:1px solid var(--gris-bd);border-radius:12px;padding:12px 16px;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:10px">
          <span id="club-dot" style="width:11px;height:11px;border-radius:50%;background:#bbb;flex-shrink:0"></span>
          <div><b>GDO CLUB</b><div class="small muted" id="club-estado">Consultando estado…</div></div>
        </div>
        <button class="btn btn-sm btn-ghost" id="club-toggle" disabled>…</button>
      </div>
      <div id="canje-onoff" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:#fff;border:1px solid var(--gris-bd);border-radius:12px;padding:12px 16px;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:10px">
          <span id="canje-dot" style="width:11px;height:11px;border-radius:50%;background:#bbb;flex-shrink:0"></span>
          <div><b>Canje de premios</b><div class="small muted" id="canje-estado">Consultando estado…</div></div>
        </div>
        <button class="btn btn-sm btn-ghost" id="canje-toggle" disabled>…</button>
      </div>
      <div id="juego-onoff" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:#fff;border:1px solid var(--gris-bd);border-radius:12px;padding:12px 16px;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:10px">
          <span id="juego-dot" style="width:11px;height:11px;border-radius:50%;background:#bbb;flex-shrink:0"></span>
          <div><b>Juego DIEZ EXACTO</b><div class="small muted" id="juego-estado">Consultando estado…</div></div>
        </div>
        <button class="btn btn-sm btn-ghost" id="juego-toggle" disabled>…</button>
      </div>`}
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        <button class="btn btn-sm ${tab === 'mostrador' ? '' : 'btn-ghost'}" data-tab="mostrador">📍 Mostrador <span id="mb-badge"></span></button>
        <button class="btn btn-sm ${tab === 'socios' ? '' : 'btn-ghost'}" data-tab="socios">👥 Socios</button>
        ${cajero ? '' : `<button class="btn btn-sm ${tab === 'premios' ? '' : 'btn-ghost'}" data-tab="premios">🎁 Premios</button>`}
        <button class="btn btn-sm ${tab === 'canjes' ? '' : 'btn-ghost'}" data-tab="canjes">📋 Canjes</button>
      </div>
      <div id="club-body"><div class="empty">Cargando…</div></div>`;
    if (!cajero) { renderOnOff(c); renderCanjeToggle(c); renderJuegoToggle(c); }
    c.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; GDO.Views.club(c); });
    const body = c.querySelector('#club-body');
    if (tab === 'mostrador') renderMostrador(body, c);
    else if (tab === 'socios') renderSocios(body);
    else if (tab === 'premios' && !cajero) renderPremios(body);
    else renderCanjes(body);
  };

  /* ---------------- ON / OFF del club ----------------
     Doc club_config/flags { activo }. Si está apagado, el club NO aparece en la
     tienda (lista mayorista/minorista) ni en la web (lo leen esas superficies). */
  function renderOnOff(c) {
    const dot = c.querySelector('#club-dot'), est = c.querySelector('#club-estado'), btn = c.querySelector('#club-toggle');
    let actual = false;
    function pintar(activo) {
      actual = !!activo;
      if (dot) dot.style.background = activo ? '#2e9e5b' : '#c0392b';
      if (est) est.textContent = activo ? 'Activado · visible para los clientes' : 'Desactivado · oculto en la tienda y la web';
      if (btn) { btn.disabled = false; btn.textContent = activo ? '⏸ Desactivar club' : '▶ Activar club'; btn.className = 'btn btn-sm ' + (activo ? 'btn-ghost' : ''); }
      return activo;
    }
    db().collection('club_config').doc('flags').get()
      .then((d) => pintar(d.exists && d.data().activo === true))
      .catch(() => pintar(false));
    if (btn) btn.onclick = () => {
      const nuevo = !actual;
      confirmDlg(
        nuevo ? '¿Activar el GDO CLUB? Va a aparecer en la tienda y la web para los clientes.'
              : '¿Desactivar el GDO CLUB? Se va a ocultar en la tienda y la web (los clientes no lo verán).',
        () => {
          btn.disabled = true; btn.textContent = 'Guardando…';
          db().collection('club_config').doc('flags').set({ activo: nuevo, por: staffUid(), ts: FV().serverTimestamp() }, { merge: true })
            .then(() => { pintar(nuevo); toast(nuevo ? '✓ Club ACTIVADO.' : '✓ Club DESACTIVADO.'); })
            .catch(() => { pintar(actual); toast('No se pudo cambiar el estado.', 'error'); });
        },
        nuevo ? 'Activar' : 'Desactivar'
      );
    };
  }

  /* ---------------- ON / OFF del CANJE (modo intriga) ----------------
     El club puede estar ACTIVO (la gente se asocia y suma puntos) pero con el CANJE
     en pausa → en club.html los premios muestran "muy pronto". Doc
     club_config/flags { canjeActivo }. Sin el campo = canje EN PAUSA (default). */
  function renderCanjeToggle(c) {
    const dot = c.querySelector('#canje-dot'), est = c.querySelector('#canje-estado'), btn = c.querySelector('#canje-toggle');
    let actual = false;
    function pintar(activo) {
      actual = !!activo;
      if (dot) dot.style.background = activo ? '#2e9e5b' : '#e08a1e';
      if (est) est.textContent = activo ? 'Activado · los socios pueden canjear premios' : 'En pausa (modo intriga) · se asocian y suman, pero todavía no canjean';
      if (btn) { btn.disabled = false; btn.textContent = activo ? '⏸ Pausar canje' : '▶ Activar canje'; btn.className = 'btn btn-sm ' + (activo ? 'btn-ghost' : ''); }
      return activo;
    }
    db().collection('club_config').doc('flags').get()
      .then((d) => pintar(d.exists && d.data().canjeActivo === true))
      .catch(() => pintar(false));
    if (btn) btn.onclick = () => {
      const nuevo = !actual;
      confirmDlg(
        nuevo ? '¿Activar el CANJE de premios? Los socios van a poder canjear sus puntos.'
              : '¿Pausar el canje? Los socios se asocian y suman puntos, pero al ir a canjear verán "muy pronto".',
        () => {
          btn.disabled = true; btn.textContent = 'Guardando…';
          db().collection('club_config').doc('flags').set({ canjeActivo: nuevo, canjePor: staffUid(), canjeTs: FV().serverTimestamp() }, { merge: true })
            .then(() => { pintar(nuevo); toast(nuevo ? '✓ Canje ACTIVADO.' : '✓ Canje EN PAUSA.'); })
            .catch(() => { pintar(actual); toast('No se pudo cambiar el canje.', 'error'); });
        },
        nuevo ? 'Activar canje' : 'Pausar canje'
      );
    };
  }

  /* ---------------- ON / OFF del JUEGO "DIEZ EXACTO" ----------------
     club_config/flags { juegoActivo }. Sin el campo = juego APAGADO (default).
     APAGADO NO ESCONDE EL JUEGO: lo deja en modo PRÓXIMAMENTE. La tarjeta sigue
     en la lista (en gris) y el socio puede entrar y ver cómo va a ser, pero no
     se habilita ninguna partida. Encendido = se puede jugar en sucursal. */
  function renderJuegoToggle(c) {
    const dot = c.querySelector('#juego-dot'), est = c.querySelector('#juego-estado'), btn = c.querySelector('#juego-toggle');
    let actual = false;
    function pintar(activo) {
      actual = !!activo;
      if (dot) dot.style.background = activo ? '#2e9e5b' : '#bbb';
      if (est) est.textContent = activo
        ? 'Activado · se puede jugar en sucursal'
        : 'En modo PRÓXIMAMENTE · la tarjeta se ve en gris y no se habilita ninguna partida';
      if (btn) { btn.disabled = false; btn.textContent = activo ? '⏸ Pasar a Próximamente' : '▶ Activar juego'; btn.className = 'btn btn-sm ' + (activo ? 'btn-ghost' : ''); }
      return activo;
    }
    db().collection('club_config').doc('flags').get()
      .then((d) => pintar(d.exists && d.data().juegoActivo === true))
      .catch(() => pintar(false));
    if (btn) btn.onclick = () => {
      const nuevo = !actual;
      confirmDlg(
        nuevo ? '¿Activar el juego DIEZ EXACTO? Los socios van a poder jugar en sucursal según las bases publicadas.'
              : '¿Pasar el juego a modo PRÓXIMAMENTE? La tarjeta queda en gris, nadie puede jugar y las partidas en curso se cierran.',
        () => {
          btn.disabled = true; btn.textContent = 'Guardando…';
          db().collection('club_config').doc('flags').set({ juegoActivo: nuevo, juegoPor: staffUid(), juegoTs: FV().serverTimestamp() }, { merge: true })
            .then(() => { pintar(nuevo); toast(nuevo ? '✓ Juego ACTIVADO.' : '✓ Juego en modo PRÓXIMAMENTE.'); })
            .catch(() => { pintar(actual); toast('No se pudo cambiar el juego.', 'error'); });
        },
        nuevo ? 'Activar juego' : 'Pasar a Próximamente'
      );
    };
  }

  /* ---------------- MOSTRADOR (check-ins por QR) ----------------
     El socio escanea el QR único → se crea una /visitas 'pendiente'. Acá el
     cajero la ve en vivo y le carga los puntos de la compra. Los puntos los
     pone SIEMPRE el personal (el QR no lleva monto). */
  function renderMostrador(box, c) {
    subs.push(db().collection('visitas').where('estado', '==', 'pendiente').onSnapshot((snap) => {
      const arr = []; snap.forEach((d) => { const x = d.data(); x._id = d.id; arr.push(x); });
      arr.sort((a, b) => ((a.ts && a.ts.toMillis ? a.ts.toMillis() : 0) - (b.ts && b.ts.toMillis ? b.ts.toMillis() : 0)));
      const badge = c && c.querySelector('#mb-badge');
      if (badge) badge.innerHTML = arr.length ? `<span style="background:#fff;color:#F58220;border-radius:10px;padding:1px 7px;font-weight:900;font-size:12px">${arr.length}</span>` : '';
      if (!arr.length) { box.innerHTML = '<div class="empty">Nadie escaneó el QR todavía.<br><span class="small muted">Cuando un socio escanee el código del mostrador, va a aparecer acá para cargarle los puntos.</span></div>'; return; }
      box.innerHTML =
        `<table><thead><tr><th>N°</th><th>Socio</th><th>Escaneó</th><th></th></tr></thead><tbody>` +
        arr.map((v) => `<tr>
          <td><b>${padNro(v.nroSocio)}</b></td>
          <td>${esc(v.nombre || 'Socio')}</td>
          <td class="small">${horaCorta(v.ts)}</td>
          <td class="t-actions"><button class="btn btn-sm" data-at="${esc(v._id)}">＋ Cargar puntos</button> <button class="btn btn-ghost btn-sm" data-desc="${esc(v._id)}" title="Descartar">✕</button></td>
        </tr>`).join('') + `</tbody></table>`;
      box.querySelectorAll('[data-at]').forEach((b) => b.onclick = () => atenderVisita(arr.find((x) => x._id === b.dataset.at)));
      box.querySelectorAll('[data-desc]').forEach((b) => b.onclick = () => {
        const v = arr.find((x) => x._id === b.dataset.desc);
        confirmDlg('¿Descartar este check-in? No se cargan puntos.', () => {
          db().collection('visitas').doc(v._id).update({ estado: 'descartado', por: staffUid(), cierreTs: FV().serverTimestamp() })
            .then(() => toast('Check-in descartado.')).catch(() => toast('Error.', 'error'));
        }, 'Descartar');
      });
    }, () => { box.innerHTML = '<div class="empty">No se pudieron cargar los check-ins.</div>'; }));
  }

  // Trae el saldo fresco del socio y abre el modal de carga, ligado a la visita.
  function atenderVisita(v) {
    if (!v) return;
    db().collection('clientes').doc(v.clienteUid).get().then((d) => {
      if (!d.exists) { toast('No se encontró el socio.', 'error'); return; }
      const s = d.data(); s._id = d.id;
      cargarPuntos(s, v._id);
    }).catch(() => toast('No se pudo abrir. Reintentá.', 'error'));
  }

  /* ---------------- SOCIOS ---------------- */
  function renderSocios(box) {
    // Input de búsqueda FIJO (se crea una vez): así no pierde foco ni el texto
    // tipeado cuando llega una actualización en vivo (onSnapshot re-pinta la lista).
    box.innerHTML =
      `<input id="soc-q" type="search" placeholder="🔎 Buscar socio por nombre, N°, email o teléfono…" autocomplete="off"
         style="width:100%;padding:10px 12px;border:1px solid #d0d4da;border-radius:9px;font-size:14px;margin-bottom:10px;font-family:inherit"/>` +
      `<div id="soc-lista"></div>`;
    const lista = box.querySelector('#soc-lista');
    const inp = box.querySelector('#soc-q');
    let socios = [];
    const pintar = () => {
      if (!socios.length) { lista.innerHTML = '<div class="empty">Todavía no hay socios registrados.</div>'; return; }
      const q = (inp.value || '').trim().toLowerCase();
      const vis = q ? socios.filter((s) => (
        (s.nombre || '') + ' ' + padNro(s.nroSocio) + ' ' + (s.nroSocio || '') + ' ' +
        (s.email || '') + ' ' + (s.telefono || '') + ' ' + (s.dni || '')
      ).toLowerCase().includes(q)) : socios;
      if (!vis.length) { lista.innerHTML = `<div class="empty">Ningún socio coincide con “${esc(inp.value)}”.</div>`; return; }
      lista.innerHTML =
        `<div class="small muted" style="margin-bottom:8px">${vis.length} de ${socios.length} socio${socios.length === 1 ? '' : 's'} · tocá uno para ver sus datos (DNI, dirección, teléfono, email).</div>` +
        `<table><thead><tr><th>N°</th><th>Socio</th><th>Email</th><th>Puntos</th><th>Desde</th><th></th></tr></thead><tbody>` +
        vis.map((s) => `<tr data-ver="${esc(s._id)}" style="cursor:pointer">
          <td><b>${padNro(s.nroSocio)}</b></td>
          <td>${esc(s.nombre || '')}</td>
          <td class="small">${esc(s.email || '')}</td>
          <td><b style="color:#F58220">${fmt(s.puntos)}</b></td>
          <td class="small">${fechaCorta(s.creado)}</td>
          <td class="t-actions"><button class="btn btn-ghost btn-sm" data-hist="${esc(s._id)}" title="Historial de cargas de puntos">📜</button><button class="btn btn-ghost btn-sm" data-pts="${esc(s._id)}" title="Cargar puntos">＋ puntos</button></td>
        </tr>`).join('') + `</tbody></table>`;
      lista.querySelectorAll('[data-ver]').forEach((tr) => tr.onclick = () => verSocio(socios.find((x) => x._id === tr.dataset.ver)));
      lista.querySelectorAll('[data-pts]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); cargarPuntos(socios.find((x) => x._id === b.dataset.pts)); });
      lista.querySelectorAll('[data-hist]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); historialPuntos(socios.find((x) => x._id === b.dataset.hist)); });
    };
    inp.oninput = pintar;
    subs.push(db().collection('clientes').onSnapshot((snap) => {
      socios = []; snap.forEach((d) => { const x = d.data(); x._id = d.id; socios.push(x); });
      socios.sort((a, b) => (a.nroSocio || 0) - (b.nroSocio || 0));
      pintar();
    }, () => { lista.innerHTML = '<div class="empty">No se pudieron cargar los socios.</div>'; }));
  }

  // Detalle del socio: muestra los datos que cargó al registrarse.
  function filaDato(label, val) {
    return `<div style="padding:9px 0;border-bottom:1px solid #eee">
      <div style="font-size:11.5px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.3px">${label}</div>
      <div style="font-size:15px;margin-top:2px">${esc(val || '—')}</div></div>`;
  }
  function verSocio(s) {
    if (!s) return;
    modal({
      title: `Socio N° ${padNro(s.nroSocio)}`, width: 440,
      bodyHTML:
        `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <div style="font-size:13px;color:#6b7280">Puntos</div>
          <div style="font-weight:900;color:#F58220;font-size:20px">${fmt(s.puntos)}</div>
          <button class="btn btn-ghost btn-sm" data-hist style="margin-left:auto">📜 Historial de cargas</button>
        </div>` +
        filaDato('Nombre y apellido', s.nombre) +
        filaDato('DNI', s.dni) +
        filaDato('Teléfono / WhatsApp', s.telefono) +
        filaDato('Email', s.email) +
        filaDato('Dirección', s.direccion) +
        filaDato('Socio desde', fechaCorta(s.creado)),
      footHTML: `<button class="btn btn-ghost" data-no>Cerrar</button>${esCajero() ? '' : '<button class="btn btn-ghost" data-del style="color:#c0392b">🗑 Eliminar</button>'}<button class="btn" data-pts>＋ Cargar puntos</button>`,
      onMount(m, close) {
        m.querySelector('[data-no]').onclick = close;
        m.querySelector('[data-pts]').onclick = () => { close(); cargarPuntos(s); };
        m.querySelector('[data-hist]').onclick = () => { close(); historialPuntos(s); };
        const delB = m.querySelector('[data-del]'); if (delB) delB.onclick = () => { close(); eliminarSocioAdmin(s); };
      },
    });
  }

  // Eliminar socio desde el panel: borra su PERFIL y PUNTOS (datos personales).
  // OJO: el login por email NO se puede borrar sin Admin SDK (servidor). Si la
  // persona vuelve a entrar, se le crea un perfil nuevo en 0.
  function eliminarSocioAdmin(s) {
    if (!s) return;
    confirmDlg(
      '¿Eliminar al socio "' + (s.nombre || '') + '" (N° ' + padNro(s.nroSocio) + ')? Se borran sus datos y sus puntos. ' +
      'El acceso por email NO se borra desde acá: si vuelve a entrar, se le crea un perfil nuevo en 0. No se puede deshacer.',
      () => {
        db().collection('clientes').doc(s._id).delete()
          .then(() => toast('Socio eliminado.'))
          .catch(() => toast('No se pudo eliminar.', 'error'));
      },
      'Eliminar'
    );
  }

  // Carga MANUAL de puntos (compra en el local). Transacción atómica.
  // visitaId (opcional): si viene de un check-in del QR, lo marca atendido.
  function cargarPuntos(socio, visitaId) {
    if (!socio) return;
    modal({
      title: `Cargar puntos · ${socio.nombre || 'Socio'} (N° ${padNro(socio.nroSocio)})`, width: 440,
      bodyHTML:
        `<p class="small muted" style="margin:0 0 10px">Saldo actual: <b style="color:#F58220">${fmt(socio.puntos)}</b> puntos</p>` +
        `<button class="btn btn-sm" id="cp-foto" type="button" style="width:100%;margin-bottom:6px">📷 Leer ticket (foto)</button>` +
        `<input id="cp-file" type="file" accept="image/*" capture="environment" style="display:none"/>` +
        `<div id="cp-tmsg" class="small" style="margin:0 0 8px;text-align:center;display:none"></div>` +
        `<label style="font-size:13px;color:#5b6470;font-weight:600">Monto de la compra ($)</label>` +
        `<input id="cp-monto" type="number" inputmode="numeric" min="1" placeholder="ej: 15000" style="width:100%;padding:11px;border:1px solid #cfd4da;border-radius:9px;font-size:15px"/>` +
        `<div id="cp-prev" style="margin-top:8px;font-size:13px;color:#5b6470">= <b style="color:#F58220">0</b> Puntos GDO <span class="muted">(1 punto cada $100)</span></div>` +
        `<label style="font-size:13px;color:#5b6470;font-weight:600;margin-top:10px;display:block">N° de ticket <span style="font-weight:400;color:#8a93a0">${esCajero() ? '(<b style=\"color:#c0392b\">obligatorio</b> · escaneá la foto o ponelo a mano)' : '(opcional · evita cargar 2 veces el mismo)'}</span></label>` +
        `<input id="cp-nro" type="text" inputmode="numeric" placeholder="ej: 10080" style="width:100%;padding:11px;border:1px solid #cfd4da;border-radius:9px;font-size:15px"/>` +
        `<label style="font-size:13px;color:#5b6470;font-weight:600;margin-top:10px;display:block">Motivo (opcional)</label>` +
        `<input id="cp-mot" type="text" placeholder="ej: compra en el local" style="width:100%;padding:11px;border:1px solid #cfd4da;border-radius:9px;font-size:15px"/>` +
        (GDO.Wpp && GDO.Wpp.tieneTel(socio.telefono)
          ? `<label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:14px;cursor:pointer"><input id="cp-wpp" type="checkbox" checked/> 💬 Avisarle por WhatsApp al ${esc(socio.telefono)}</label>`
          : `<div class="small muted" style="margin-top:12px">💬 Este socio no tiene teléfono cargado: no se le puede avisar por WhatsApp.</div>`),
      footHTML: `<button class="btn btn-ghost" data-no>Cancelar</button><button class="btn" data-yes>Sumar puntos</button>`,
      onMount(m, close) {
        const ptsDe = (monto) => Math.floor((parseInt(monto, 10) || 0) / 100);   // $100 = 1 punto
        const inp = m.querySelector('#cp-monto');
        const prev = m.querySelector('#cp-prev');
        const refreshPrev = () => { prev.innerHTML = '= <b style="color:#F58220">' + fmt(ptsDe(inp.value)) + '</b> Puntos GDO <span class="muted">(1 punto cada $100)</span>'; };
        inp.oninput = refreshPrev;
        let ticketFecha = '';
        // Leer ticket por FOTO: código de barras (N° exacto) + OCR (sugiere total y fecha).
        // Best-effort: lo que no lee, lo completa el cajero a mano.
        const fileInp = m.querySelector('#cp-file'), tmsg = m.querySelector('#cp-tmsg');
        m.querySelector('#cp-foto').onclick = () => fileInp.click();
        fileInp.onchange = () => {
          const f = fileInp.files && fileInp.files[0]; if (!f) return;
          tmsg.style.display = 'block'; tmsg.style.color = '#5b6470'; tmsg.textContent = 'Leyendo el ticket…';
          leerTicket(f, (s) => { tmsg.textContent = s; }).then((r) => {
            if (r.monto) { inp.value = r.monto; refreshPrev(); }
            if (r.nro) m.querySelector('#cp-nro').value = r.nro;
            ticketFecha = r.fecha || '';
            tmsg.innerHTML = (r.monto || r.nro)
              ? '✓ Leí ' + (r.monto ? '<b>$' + fmt(r.monto) + '</b>' : '') + (r.nro ? ' · N° ' + esc(r.nro) : '') + ' — <b style="color:#b9770e">verificá el total antes de cargar.</b>'
              : 'No pude leer el ticket. Cargalo a mano 👇';
          }).catch(() => { tmsg.textContent = 'No se pudo leer la foto. Cargalo a mano.'; });
          fileInp.value = '';
        };
        m.querySelector('[data-no]').onclick = close;
        m.querySelector('[data-yes]').onclick = () => {
          const monto = parseInt(inp.value, 10);
          const pts = ptsDe(monto);
          const nro = (m.querySelector('#cp-nro').value || '').replace(/\D/g, '');
          const mot = (m.querySelector('#cp-mot').value || '').trim() || (nro ? ('Ticket ' + nro) : ('Compra $' + fmt(monto)));
          if (!monto || monto <= 0) { toast('Poné el monto de la compra.', 'error'); return; }
          if (!pts || pts <= 0) { toast('El monto es muy chico para sumar puntos (mínimo $100).', 'error'); return; }
          // Para el CAJERO el ticket es OBLIGATORIO (escaneo o manual): evita carga sin respaldo.
          if (esCajero() && !nro) { toast('Cargá el N° de ticket (escaneá la foto o ponelo a mano). Es obligatorio.', 'error'); return; }
          const wppCb = m.querySelector('#cp-wpp');
          const avisar = !!(wppCb && wppCb.checked);
          const btn = m.querySelector('[data-yes]'); btn.disabled = true; btn.textContent = 'Sumando…';
          const op = nro ? acreditarPorTicket(socio._id, nro, ticketFecha, monto) : acreditar(socio._id, pts, mot, null, { monto: monto });
          op.then((saldo) => {
              if (visitaId) {
                db().collection('visitas').doc(visitaId).update({ estado: 'atendido', puntos: pts, por: staffUid(), cierreTs: FV().serverTimestamp() }).catch(() => {});
              }
              toast('✓ ' + fmt(pts) + ' puntos cargados.'); close();
              if (avisar) avisoPuntosWpp(socio, pts, saldo, monto);
            })
            .catch((e) => {
              const mm = (e && e.message) || '';
              toast(mm === 'duplicado' ? ('Ese ticket (N° ' + nro + ') ya fue cargado antes.') : 'No se pudo cargar. Reintentá.', 'error');
              btn.disabled = false; btn.textContent = 'Sumar puntos';
            });
        };
      },
    });
  }

  /* ---------------- AVISO AL SOCIO POR WHATSAPP ----------------
     Al cargar los puntos se le avisa al socio automáticamente. Sin servidor ni
     API paga: se abre WhatsApp con el mensaje ya escrito al número del socio y
     solo queda tocar "Enviar" (mismo mecanismo que los avisos de reparto).
     El envío 100% desatendido necesitaría la API de WhatsApp Business (paga). */
  function textoPuntosWpp(socio, pts, saldo, monto) {
    const nom = ((socio.nombre || '').trim().split(/\s+/)[0] || '').trim();
    return (nom ? '¡Hola ' + nom + '! 👋 ' : '¡Hola! 👋 ') +
      'Te acreditamos *' + fmt(pts) + ' Puntos GDO* por tu compra' + (monto ? ' de $' + fmt(monto) : '') + '. 🧡\n\n' +
      '⭐ Saldo actual: *' + fmt(saldo) + ' Puntos GDO*\n' +
      '🎁 Mirá tu credencial y los premios para canjear acá:\n' +
      'https://lista.granjadeloeste.com/club.html\n\n' +
      '¡Gracias por ser parte del GDO CLUB!\n— Granja del Oeste 🐔';
  }

  // Copia al portapapeles (con respaldo para navegadores viejos / sin permiso).
  function copiar(texto) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(texto);
    } catch (e) {}
    return new Promise((res, rej) => {
      try {
        const ta = document.createElement('textarea');
        ta.value = texto; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy'); ta.remove();
        ok ? res() : rej();
      } catch (e) { rej(e); }
    });
  }

  function avisoPuntosWpp(socio, pts, saldo, monto) {
    if (!GDO.Wpp || !GDO.Wpp.tieneTel(socio.telefono)) return;
    const texto = textoPuntosWpp(socio, pts, Number(saldo) || ((socio.puntos || 0) + pts), monto);
    const link = GDO.Wpp.link(socio.telefono, texto);
    if (!link) return;
    // RED DE SEGURIDAD DE LOS EMOJIS: hay teléfonos/versiones de WhatsApp que, al
    // recibir el mensaje por el link (?text=), pierden los emojis y los muestran
    // como "?". Dejamos el mensaje COMPLETO en el portapapeles: si llega mal, el
    // operador borra y pega, y sale perfecto.
    copiar(texto).catch(() => {});
    // Intento automático. Si el navegador bloquea la ventana emergente, cae al
    // modal de abajo (ahí el clic es un gesto directo del usuario y siempre abre).
    let w = null;
    try { w = window.open(link, '_blank'); } catch (e) {}
    if (w) { toast('💬 WhatsApp abierto — tocá Enviar. (El mensaje quedó copiado por si los emojis salen mal: pegalo.)'); return; }
    modal({
      title: 'Avisar a ' + (socio.nombre || 'el socio') + ' por WhatsApp', width: 520,
      bodyHTML:
        `<p class="small muted" style="margin:0 0 8px">Se cargaron <b style="color:#F58220">${fmt(pts)}</b> puntos. Mensaje listo para ${esc(socio.telefono)}:</p>` +
        `<pre id="ap-txt" style="white-space:pre-wrap;background:#f6f7f9;border:1px solid #e3e6ea;border-radius:9px;padding:10px;font-family:inherit;font-size:13.5px;margin:0">${esc(texto)}</pre>` +
        `<div class="note" style="margin-top:8px">Se abre WhatsApp con el mensaje escrito. Vos tocás <b>Enviar</b>. Si los emojis llegan como “?”, borrá y <b>pegá</b> (ya está copiado).</div>`,
      footHTML: `<button class="btn btn-ghost" data-no>Ahora no</button><button class="btn btn-ghost" data-copy>📋 Copiar</button><a class="btn btn-verde" data-send target="_blank">💬 Abrir WhatsApp</a>`,
      onMount(m, close) {
        m.querySelector('[data-no]').onclick = close;
        m.querySelector('[data-copy]').onclick = () => copiar(texto).then(() => toast('Mensaje copiado ✓')).catch(() => toast('No se pudo copiar.', 'error'));
        const send = m.querySelector('[data-send]');
        send.href = link;
        send.onclick = () => { toast('WhatsApp abierto con el mensaje'); setTimeout(close, 300); };
      },
    });
  }

  // ---- Lector de ticket (foto): barcode → N° ; OCR → total/fecha. Todo best-effort. ----
  function tkSoloDig(s){ return String(s == null ? '' : s).replace(/\D/g, ''); }
  function tkTotal(txt){
    // Busca "Total" y el número que lo sigue. Formato del remito: $93,700.00 (coma=miles).
    const m = /total[^0-9]{0,14}\$?\s*([0-9][0-9.,]*)/i.exec(txt || '');
    if (!m) return 0;
    let s = m[1].replace(/[.,]\s*\d{2}\s*$/, '');   // saca centavos finales (.00)
    s = s.replace(/[.,\s]/g, '');                   // saca separadores de miles
    const n = parseInt(s, 10); return isNaN(n) ? 0 : n;
  }
  function tkFecha(txt){ const m = /(\d{4}-\d{2}-\d{2})/.exec(txt || '') || /(\d{2}\/\d{2}\/\d{4})/.exec(txt || ''); return m ? m[1] : ''; }
  function tkNro(txt){ const m = /n[°ºo:\.\s]{0,4}\s*([0-9]{3,})/i.exec(txt || ''); return m ? m[1] : ''; }
  function leerTicket(file, prog){
    const out = { nro: '', fecha: '', monto: 0 };
    const pBar = new Promise((res) => {
      if (typeof Html5Qrcode === 'undefined' || typeof Html5QrcodeSupportedFormats === 'undefined') return res();
      let el = document.createElement('div'); el.id = 'tk-scan-' + Math.floor(Math.random() * 1e9);
      el.style.cssText = 'position:fixed;left:-99999px;top:0;width:320px;height:320px';
      document.body.appendChild(el);
      try {
        const fmts = [Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39, Html5QrcodeSupportedFormats.CODE_93, Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.ITF];
        const tmp = new Html5Qrcode(el.id, { formatsToSupport: fmts, verbose: false });
        tmp.scanFile(file, false)
          .then((t) => { out.nro = tkSoloDig(t); })
          .catch(() => {})
          .finally(() => { try { tmp.clear(); } catch (e) {} try { el.remove(); } catch (e) {} res(); });
      } catch (e) { try { el.remove(); } catch (e2) {} res(); }
    });
    const pOcr = new Promise((res) => {
      if (typeof Tesseract === 'undefined') return res();
      if (prog) prog('Reconociendo el texto del ticket…');
      try {
        Tesseract.recognize(file, 'eng').then((r) => {
          const txt = (r && r.data && r.data.text) || '';
          out.monto = tkTotal(txt); out.fecha = tkFecha(txt);
          if (!out.nro) out.nro = tkNro(txt);
        }).catch(() => {}).finally(res);
      } catch (e) { res(); }
    });
    return Promise.all([pBar, pOcr]).then(() => out);
  }

  // Acredita puntos a partir de un TICKET, en transacción, con anti-duplicado por N°.
  // Guarda el ticket en /tickets (id = N°): si ya existe, NO vuelve a cargar.
  // El log guarda TAMBIÉN el monto y la fecha del ticket: así el historial del
  // socio se puede auditar sin tener que abrir /tickets uno por uno.
  function acreditarPorTicket(clienteUid, nro, fecha, monto){
    const mn = parseInt(monto, 10) || 0;
    const pts = Math.floor(mn / 100);
    const cref = db().collection('clientes').doc(clienteUid);
    const tref = db().collection('tickets').doc(String(nro));
    const lref = db().collection('puntos_log').doc();
    return db().runTransaction((tx) => tx.get(tref).then((td) => {
      if (td.exists) throw new Error('duplicado');
      return tx.get(cref).then((cd) => {
        if (!cd.exists) throw new Error('socio');
        const nuevo = (cd.data().puntos || 0) + pts;
        tx.update(cref, { puntos: nuevo });
        tx.set(tref, { nro: String(nro), fecha: String(fecha || ''), monto: mn, puntos: pts, clienteUid: clienteUid, por: staffUid(), ts: FV().serverTimestamp() });
        tx.set(lref, { clienteUid: clienteUid, delta: pts, motivo: 'Ticket ' + nro, saldo: nuevo, ticketNro: String(nro), monto: mn, ticketFecha: String(fecha || ''), por: staffUid(), ts: FV().serverTimestamp() });
        return nuevo;
      });
    }));
  }

  // Suma/resta puntos en transacción + log de auditoría. delta>0 acredita.
  // extra (opcional): datos de respaldo de la carga (ej. { monto }).
  function acreditar(clienteUid, delta, motivo, canjeId, extra) {
    const cref = db().collection('clientes').doc(clienteUid);
    const lref = db().collection('puntos_log').doc();
    return db().runTransaction((tx) => tx.get(cref).then((cd) => {
      if (!cd.exists) throw new Error('socio inexistente');
      const actual = cd.data().puntos || 0;
      const nuevo = actual + delta;
      if (nuevo < 0) throw new Error('saldo insuficiente');
      tx.update(cref, { puntos: nuevo });
      const log = { clienteUid: clienteUid, delta: delta, motivo: motivo || '', saldo: nuevo, canjeId: canjeId || null, por: staffUid(), ts: FV().serverTimestamp() };
      if (extra && extra.monto) log.monto = parseInt(extra.monto, 10) || 0;
      tx.set(lref, log);
      return nuevo;
    }));
  }

  /* ---------------- HISTORIAL DE PUNTOS DEL SOCIO ----------------
     Todo movimiento queda en /puntos_log (inmutable). Acá lo mostramos por
     socio para poder auditar una carga: cuándo, cuánto compró, qué ticket,
     cuántos puntos y con qué saldo quedó. Ordenamos en el navegador (no pide
     índice compuesto en Firestore). */
  function nombreStaff(uid) {
    if (!uid) return '—';
    try { const u = GDO.Store && GDO.Store.user && GDO.Store.user(uid); if (u && u.nombre) return u.nombre; } catch (e) {}
    return String(uid).slice(0, 6) + '…';
  }
  function fechaHora(ts) {
    try { const d = ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
      return d ? d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '—'; }
    catch (e) { return '—'; }
  }

  function historialPuntos(s) {
    if (!s) return;
    const m = modal({
      title: `Historial de puntos · ${s.nombre || 'Socio'} (N° ${padNro(s.nroSocio)})`, width: 640,
      bodyHTML: '<div id="hp-body"><div class="empty">Cargando movimientos…</div></div>',
      footHTML: `<button class="btn btn-ghost" data-no>Cerrar</button><button class="btn" data-pts>＋ Cargar puntos</button>`,
      onMount(mm, close) {
        mm.querySelector('[data-no]').onclick = close;
        mm.querySelector('[data-pts]').onclick = () => { close(); cargarPuntos(s); };
      },
    });
    const box = m.node.querySelector('#hp-body');
    db().collection('puntos_log').where('clienteUid', '==', s._id).limit(300).get().then((snap) => {
      const arr = []; snap.forEach((d) => { const x = d.data(); x._id = d.id; arr.push(x); });
      arr.sort((a, b) => ((b.ts && b.ts.toMillis ? b.ts.toMillis() : 0) - (a.ts && a.ts.toMillis ? a.ts.toMillis() : 0)));
      if (!arr.length) { box.innerHTML = '<div class="empty">Este socio todavía no tiene movimientos de puntos.</div>'; return; }
      const sumas = arr.filter((x) => (x.delta || 0) > 0).reduce((t, x) => t + x.delta, 0);
      const restas = arr.filter((x) => (x.delta || 0) < 0).reduce((t, x) => t - x.delta, 0);
      box.innerHTML =
        `<div class="small muted" style="margin-bottom:10px">${arr.length} movimiento${arr.length === 1 ? '' : 's'} · sumados <b style="color:#2e9e5b">+${fmt(sumas)}</b> · canjeados <b style="color:#c0392b">−${fmt(restas)}</b> · saldo actual <b style="color:#F58220">${fmt(s.puntos)}</b></div>` +
        `<div style="overflow-x:auto"><table><thead><tr><th>Fecha</th><th>Motivo</th><th>Ticket</th><th>Compra</th><th>Puntos</th><th>Saldo</th><th>Cargó</th></tr></thead><tbody>` +
        arr.map((x) => {
          const d = x.delta || 0;
          return `<tr>
            <td class="small">${fechaHora(x.ts)}</td>
            <td>${esc(x.motivo || (d < 0 ? 'Canje' : 'Carga'))}</td>
            <td class="small">${x.ticketNro ? esc(x.ticketNro) : '—'}</td>
            <td class="small">${x.monto ? '$' + fmt(x.monto) : '—'}</td>
            <td><b style="color:${d < 0 ? '#c0392b' : '#2e9e5b'}">${d < 0 ? '−' : '+'}${fmt(Math.abs(d))}</b></td>
            <td class="small">${fmt(x.saldo)}</td>
            <td class="small">${esc(nombreStaff(x.por))}</td>
          </tr>`;
        }).join('') + `</tbody></table></div>` +
        `<div class="small muted" style="margin-top:8px">La columna <b>Compra</b> aparece en las cargas hechas desde esta versión. En las anteriores el monto está en el ticket.` +
        (arr.length >= 300 ? ' Se muestran los primeros 300 movimientos.' : '') + `</div>`;
    }).catch(() => { box.innerHTML = '<div class="empty">No se pudo cargar el historial.</div>'; });
  }

  /* ---------------- PREMIOS ---------------- */
  function renderPremios(box) {
    subs.push(db().collection('premios').onSnapshot((snap) => {
      const arr = []; snap.forEach((d) => { const x = d.data(); x._id = d.id; arr.push(x); });
      arr.sort((a, b) => (a.costo || 0) - (b.costo || 0));
      box.innerHTML =
        `<div style="margin-bottom:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">` +
          `<button class="btn" id="pr-add">＋ Nuevo premio</button>` +
          (arr.length
            ? `<button class="btn btn-ghost" id="pr-act">✅ Activar seleccionados</button>` +
              `<button class="btn btn-ghost" id="pr-des">🚫 Desactivar seleccionados</button>` +
              `<button class="btn btn-ghost" id="pr-delsel" style="color:#c0392b">🗑 Eliminar seleccionados</button>`
            : '') +
        `</div>` +
        (arr.length
          ? `<table><thead><tr><th style="width:34px"><input type="checkbox" id="pr-all" title="Seleccionar todos"/></th><th></th><th>Premio</th><th>Costo</th><th>Estado</th><th></th></tr></thead><tbody>` +
            arr.map((p) => `<tr>
              <td><input type="checkbox" data-selp="${esc(p._id)}"/></td>
              <td style="font-size:22px">${p.ico || '🎁'}</td>
              <td>${esc(p.nombre || '')}</td>
              <td><b style="color:#F58220">${fmt(p.costo)}</b> pts</td>
              <td>${p.activo ? '<span class="chip chip-entreg">Activo</span>' : '<span class="chip chip-no">Inactivo</span>'}</td>
              <td class="t-actions"><button class="btn btn-ghost btn-sm" data-edit="${esc(p._id)}">✎</button><button class="btn btn-ghost btn-sm" data-del="${esc(p._id)}">🗑</button></td>
            </tr>`).join('') + `</tbody></table>`
          : '<div class="empty">No hay premios cargados. Agregá el primero.</div>');
      box.querySelector('#pr-add').onclick = () => premioModal(null);
      if (arr.length) {
        // Casillero "todos" (arriba): tilda/destilda todos. Cada premio tiene el suyo,
        // así podés excluir alguno antes de activar/desactivar/eliminar.
        const all = box.querySelector('#pr-all');
        all.onchange = () => box.querySelectorAll('[data-selp]').forEach((cb) => { cb.checked = all.checked; });
        // Ids de los premios TILDADOS ahora mismo (lectura directa del DOM).
        const seleccion = () => Array.prototype.map.call(box.querySelectorAll('[data-selp]:checked'), (cb) => cb.dataset.selp);
        // Aplica una operación de batch sobre los tildados, con confirmación.
        const sobreSel = (verbo, fn, hecho) => {
          const ids = seleccion();
          if (!ids.length) { toast('Tildá al menos un premio.', 'error'); return; }
          confirmDlg('¿' + verbo + ' ' + ids.length + ' premio(s) seleccionado(s)?', () => {
            const batch = db().batch();
            ids.forEach((id) => fn(batch, db().collection('premios').doc(id)));
            batch.commit().then(() => toast(ids.length + ' premio(s) ' + hecho + '.')).catch(() => toast('No se pudo.', 'error'));
          });
        };
        box.querySelector('#pr-act').onclick = () => sobreSel('Activar', (b, ref) => b.update(ref, { activo: true }), 'activado(s)');
        box.querySelector('#pr-des').onclick = () => sobreSel('Desactivar', (b, ref) => b.update(ref, { activo: false }), 'desactivado(s)');
        box.querySelector('#pr-delsel').onclick = () => sobreSel('⚠️ ELIMINAR (no se puede deshacer)', (b, ref) => b.delete(ref), 'eliminado(s)');
      }
      box.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => premioModal(arr.find((x) => x._id === b.dataset.edit)));
      box.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
        const p = arr.find((x) => x._id === b.dataset.del);
        confirmDlg('¿Borrar el premio "' + (p.nombre || '') + '"?', () => {
          db().collection('premios').doc(p._id).delete().then(() => toast('Premio borrado.')).catch(() => toast('No se pudo borrar.', 'error'));
        });
      });
    }, () => { box.innerHTML = '<div class="empty">No se pudieron cargar los premios.</div>'; }));
  }

  function premioModal(p) {
    const ed = !!p;
    modal({
      title: ed ? 'Editar premio' : 'Nuevo premio', width: 440,
      bodyHTML:
        `<label style="font-size:13px;color:#5b6470;font-weight:600">Emoji / ícono</label>` +
        `<input id="pm-ico" type="text" maxlength="2" value="${ed ? esc(p.ico || '') : '🎁'}" style="width:80px;padding:11px;border:1px solid #cfd4da;border-radius:9px;font-size:18px;text-align:center"/>` +
        `<label style="font-size:13px;color:#5b6470;font-weight:600;margin-top:10px;display:block">Nombre del premio</label>` +
        `<input id="pm-nom" type="text" value="${ed ? esc(p.nombre || '') : ''}" placeholder="ej: 1 kg de hamburguesas de pollo" style="width:100%;padding:11px;border:1px solid #cfd4da;border-radius:9px;font-size:15px"/>` +
        `<label style="font-size:13px;color:#5b6470;font-weight:600;margin-top:10px;display:block">Valor del premio $ <span style="font-weight:400;color:#8a93a0">(precio de venta del producto, o monto del voucher)</span></label>` +
        `<input id="pm-valor" type="number" inputmode="numeric" min="1" value="${ed ? (p.valorPesos || '') : ''}" placeholder="ej: 7000" style="width:100%;padding:11px;border:1px solid #cfd4da;border-radius:9px;font-size:15px"/>` +
        `<div class="small muted" style="margin-top:4px">Puntos sugeridos = valor ÷ 2 (devolvés ~2% del valor). Lo podés ajustar abajo.</div>` +
        `<label style="font-size:13px;color:#5b6470;font-weight:600;margin-top:10px;display:block">Costo en Puntos GDO</label>` +
        `<input id="pm-costo" type="number" inputmode="numeric" min="1" value="${ed ? (p.costo || '') : ''}" placeholder="ej: 3500" style="width:100%;padding:11px;border:1px solid #cfd4da;border-radius:9px;font-size:15px"/>` +
        `<label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:14px;cursor:pointer"><input id="pm-act" type="checkbox" ${(!ed || p.activo) ? 'checked' : ''}/> Activo (visible para los socios)</label>`,
      footHTML: `<button class="btn btn-ghost" data-no>Cancelar</button><button class="btn" data-yes>Guardar</button>`,
      onMount(m, close) {
        // Al escribir el VALOR en $, sugiere los puntos (valor ÷ 2 = 2% de devolución).
        const cp = m.querySelector('#pm-valor'), cpts = m.querySelector('#pm-costo');
        cp.oninput = () => { const v = parseInt(cp.value, 10) || 0; if (v > 0) cpts.value = Math.round(v / 2); };
        m.querySelector('[data-no]').onclick = close;
        m.querySelector('[data-yes]').onclick = () => {
          const ico = (m.querySelector('#pm-ico').value || '🎁').trim() || '🎁';
          const nom = (m.querySelector('#pm-nom').value || '').trim();
          const valorPesos = parseInt(cp.value, 10) || 0;
          const costo = parseInt(cpts.value, 10);
          const activo = m.querySelector('#pm-act').checked;
          if (!nom) { toast('Poné el nombre del premio.', 'error'); return; }
          if (!costo || costo <= 0) { toast('Poné el costo en puntos.', 'error'); return; }
          const data = { ico: ico, nombre: nom, costo: costo, valorPesos: valorPesos, activo: activo };
          const ref = ed ? db().collection('premios').doc(p._id) : db().collection('premios').doc();
          const op = ed ? ref.update(data) : ref.set(data);
          op.then(() => { toast('Premio guardado.'); close(); }).catch(() => toast('No se pudo guardar.', 'error'));
        };
      },
    });
  }

  /* ---------------- CANJES / VOUCHERS ----------------
     El canje es AUTOMÁTICO: el socio ya descontó sus puntos y tiene el voucher.
     Acá el personal lo ESCANEA en el mostrador y lo marca USADO (single-use). */
  function renderCanjes(box) {
    subs.push(db().collection('canjes').onSnapshot((snap) => {
      const arr = []; snap.forEach((d) => { const x = d.data(); x._id = d.id; arr.push(x); });
      // Orden: primero los que hay que entregar (vigentes), después vencidos y usados.
      const peso = (x) => x.usado ? 2 : (vencido(x) ? 1 : 0);
      arr.sort((a, b) => (peso(a) - peso(b)) ||
        ((b.ts && b.ts.toMillis ? b.ts.toMillis() : 0) - (a.ts && a.ts.toMillis ? a.ts.toMillis() : 0)));
      const puedeBorrar = !esCajero();   // el cajero escanea pero NO elimina vouchers
      box.innerHTML =
        `<div style="margin-bottom:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">` +
          `<button class="btn" id="cj-scan">📷 Escanear voucher</button>` +
          (arr.length && puedeBorrar ? `<button class="btn btn-ghost" id="cj-delsel" style="color:#c0392b">🗑 Eliminar seleccionados</button>` : '') +
        `</div>` +
        (arr.length
          ? `<table><thead><tr>${puedeBorrar ? '<th style="width:34px"><input type="checkbox" id="cj-all" title="Seleccionar todos"/></th>' : ''}<th>Premio</th><th>Socio</th><th>Código</th><th>Estado</th></tr></thead><tbody>` +
            arr.map((c) => `<tr>
              ${puedeBorrar ? `<td><input type="checkbox" data-selc="${esc(c._id)}"/></td>` : ''}
              <td>${esc(c.premioIco || '🎁')} ${esc(c.premioNombre || '')}</td>
              <td class="small">${esc(c.socioNombre || '')}<br><span class="muted">N° ${padNro(c.socioNro)}</span></td>
              <td class="small" style="font-family:monospace">${esc(c.codigo || '')}</td>
              <td>${c.usado ? '<span class="chip chip-entreg">✔ Usado</span>'
                    : vencido(c) ? `<span class="chip chip-no">⌛ Vencido ${fechaCorta(c.venceMs)}</span>`
                    : `<span class="chip chip-pend">🎟️ Vigente</span> <span class="small muted">vence ${fechaCorta(c.venceMs)}</span>`}</td>
            </tr>`).join('') + `</tbody></table>`
          : '<div class="empty">Todavía no hay canjes. Cuando un socio canjee un premio, su voucher aparece acá.</div>');
      box.querySelector('#cj-scan').onclick = escanearVoucher;
      if (arr.length && puedeBorrar) {
        // Limpieza de vouchers (p. ej. los de prueba viejos): casillero arriba (todos)
        // + uno por voucher; "Eliminar seleccionados" borra los tildados en un batch.
        const all = box.querySelector('#cj-all');
        all.onchange = () => box.querySelectorAll('[data-selc]').forEach((cb) => { cb.checked = all.checked; });
        box.querySelector('#cj-delsel').onclick = () => {
          const ids = Array.prototype.map.call(box.querySelectorAll('[data-selc]:checked'), (cb) => cb.dataset.selc);
          if (!ids.length) { toast('Tildá al menos un voucher.', 'error'); return; }
          confirmDlg('⚠️ ¿ELIMINAR ' + ids.length + ' voucher(s) seleccionado(s)? No se puede deshacer.', () => {
            const batch = db().batch();
            ids.forEach((id) => batch.delete(db().collection('canjes').doc(id)));
            batch.commit().then(() => toast('Se eliminaron ' + ids.length + ' voucher(s).')).catch(() => toast('No se pudo.', 'error'));
          });
        };
      }
    }, () => { box.innerHTML = '<div class="empty">No se pudieron cargar los canjes.</div>'; }));
  }

  // Escáner EN LA APP: abre la cámara, lee el QR del voucher y valida SOLO (sin
  // tocar links). Apenas lee, apaga la cámara (como una foto) y marca usado.
  // Acepta el QR como link (.../#/v/<id>) o el código a mano. Vigía MutationObserver:
  // la cámara se corta sí o sí al cerrar (✕, fondo, Escape, botón) — sin esto queda
  // grabando porque sacar el div NO frena el stream.
  function escanearVoucher() {
    let h5 = null, done = false;
    modal({
      title: '📷 Escanear voucher', width: 440,
      bodyHTML:
        `<div id="qr-reader" style="width:100%;min-height:240px;background:#000;border-radius:10px;overflow:hidden"></div>` +
        `<div id="qr-msg" class="small muted" style="margin-top:8px;text-align:center">Apuntá la cámara al QR del voucher. Se valida solo y la cámara se apaga al leer.</div>` +
        `<div style="margin-top:10px;border-top:1px solid #e6e8eb;padding-top:10px">` +
          `<label style="font-size:12px;color:#5b6470;font-weight:600">¿No lee? Ingresá el código a mano</label>` +
          `<div style="display:flex;gap:6px;margin-top:4px"><input id="qr-cod" placeholder="GDO-XXXX-XXXX-XXXX" style="flex:1;padding:9px;border:1px solid #cfd4da;border-radius:8px;font-family:monospace;text-transform:uppercase"/><button class="btn btn-sm" id="qr-buscar">Validar</button></div>` +
        `</div>`,
      footHTML: `<button class="btn btn-ghost" data-no>Cerrar</button>`,
      onMount(m, close) {
        const msg = m.querySelector('#qr-msg');
        const stopCam = () => { if (h5) { const x = h5; h5 = null; try { x.stop().then(() => { try { x.clear(); } catch (e) {} }).catch(() => {}); } catch (e) {} } };
        const cerrar = () => { stopCam(); close(); };
        const _obs = new MutationObserver(() => { if (!document.body.contains(m)) { stopCam(); _obs.disconnect(); } });
        _obs.observe(document.body, { childList: true, subtree: true });
        const procesar = (canjeId) => usarVoucher(canjeId)
          .then((x) => { cerrar(); resultadoOk(x); })
          .catch((e) => {
            const mm = (e && e.message) || '';
            const denegado = (e && e.code === 'permission-denied');
            msg.innerHTML = mm === 'usado' ? '<b style="color:#c0392b">❌ Este voucher YA fue usado.</b>'
              : mm === 'vencido' ? '<b style="color:#c0392b">⌛ Voucher VENCIDO' + (e.venceMs ? ' el ' + fechaCorta(e.venceMs) : '') + ' — no se entrega.</b>'
              : mm === 'inexistente' ? '<b style="color:#c0392b">❌ Voucher inexistente.</b>'
              // El servidor puede rechazarlo por vencido aunque el reloj del
              // dispositivo diga otra cosa: lo decimos en vez de "reintentá".
              : denegado ? '<b style="color:#c0392b">❌ Rechazado por el servidor: el voucher está vencido o ya se usó.</b>'
              : '<b style="color:#c0392b">❌ No se pudo validar. Reintentá.</b>';
            done = false; // permite reintentar sin cerrar
          });
        const idDe = (text) => {
          const t = String(text || '');
          const m2 = t.match(/\/v\/([^/?#\s]+)/);          // link .../#/v/<id>
          if (m2) return m2[1];
          if (t.indexOf('GDOCANJE:') === 0) return t.slice(9);  // compat
          return null;
        };
        m.querySelector('[data-no]').onclick = cerrar;
        m.querySelector('#qr-buscar').onclick = () => {
          const cod = (m.querySelector('#qr-cod').value || '').trim().toUpperCase();
          if (!cod) return;
          db().collection('canjes').where('codigo', '==', cod).limit(1).get()
            .then((s) => { if (s.empty) { msg.innerHTML = 'No se encontró ese código.'; return; } procesar(s.docs[0].id); })
            .catch(() => { msg.innerHTML = 'Error al buscar el código.'; });
        };
        if (typeof Html5Qrcode === 'undefined') { msg.innerHTML = 'La cámara no está disponible acá. Usá el código a mano.'; return; }
        h5 = new Html5Qrcode('qr-reader');
        h5.start({ facingMode: 'environment' }, { fps: 10, qrbox: 220 }, (text) => {
          if (done) return;
          const id = idDe(text);
          if (!id) { msg.innerHTML = 'Ese QR no es un voucher GDO.'; return; }
          done = true; procesar(id);   // procesar OK → cerrar() apaga la cámara
        }, () => {}).catch(() => { msg.innerHTML = 'No se pudo abrir la cámara. Usá el código a mano.'; });
      },
    });
  }

  function resultadoOk(x) {
    modal({
      title: '✅ Voucher válido', width: 380,
      bodyHTML: `<div style="text-align:center">
        <div style="font-size:42px">${esc(x.premioIco || '🎁')}</div>
        <div style="font-weight:800;font-size:17px;margin-top:4px">${esc(x.premioNombre || '')}</div>
        <div class="small muted" style="margin-top:6px">Entregar a <b>${esc(x.socioNombre || '')}</b> · N° ${padNro(x.socioNro)}</div>
        <div style="margin-top:12px"><span class="chip chip-entreg">Marcado como USADO ✔</span></div></div>`,
      footHTML: `<button class="btn btn-verde" data-yes>Listo</button>`,
      onMount(m, close) { m.querySelector('[data-yes]').onclick = close; },
    });
  }

  // ¿El voucher pasó los 30 días? venceMs lo fijó el servidor al emitirlo (las
  // reglas acotan el máximo con request.time), así que es dato confiable.
  function vencido(x) { return !!(x && x.venceMs && Date.now() > x.venceMs); }

  // Marca el voucher USADO en transacción (single-use). Si ya estaba usado falla:
  // no se puede canjear dos veces (ni con fotocopias del mismo código).
  // VENCIMIENTO AUTOMÁTICO: pasados los 30 días no se entrega. Acá lo cortamos
  // antes de escribir para dar un mensaje claro; la palabra final igual la tiene
  // la regla de Firestore (allow update … venceMs > request.time), que usa el
  // reloj del SERVIDOR y no se puede saltear cambiando la hora del dispositivo.
  function usarVoucher(canjeId) {
    const ref = db().collection('canjes').doc(canjeId);
    return db().runTransaction((tx) => tx.get(ref).then((cd) => {
      if (!cd.exists) throw new Error('inexistente');
      const x = cd.data();
      if (x.usado) throw new Error('usado');
      if (vencido(x)) { const ev = new Error('vencido'); ev.venceMs = x.venceMs; throw ev; }
      // Defensa en profundidad: nombre/ico/costo del voucher los escribió el cliente.
      // Re-leemos el premio real y mostramos SIEMPRE esos valores, no los del canje.
      const pref = x.premioId ? db().collection('premios').doc(x.premioId) : null;
      return (pref ? tx.get(pref) : Promise.resolve(null)).then((pd) => {
        if (pd && pd.exists) { const p = pd.data(); x.premioNombre = p.nombre; x.premioIco = p.ico; x.costo = p.costo; }
        tx.update(ref, { usado: true, estado: 'usado', usadoPor: staffUid(), usadoTs: FV().serverTimestamp() });
        x._id = cd.id; return x;
      });
    }));
  }

  // ---- Pantalla de validación de voucher (la abre el LINK del QR: #/v/<id>) ----
  // El cajero escanea con la cámara del celular → toca el link → cae acá. Muestra
  // el voucher, confirma y lo marca usado. Las reglas exigen staff igual.
  function vvCard(ico, titulo, sub, color) {
    return `<div style="background:#fff;border:1px solid #e6e8eb;border-left:5px solid ${color};border-radius:14px;padding:22px;text-align:center">
      <div style="font-size:46px;line-height:1">${ico}</div>
      <h2 style="margin:10px 0 6px;color:${color};font-size:20px">${esc(titulo)}</h2>
      <div class="small muted">${sub}</div></div>`;
  }
  function vvDetalle(x) {
    return `<div style="background:#111;color:#fff;border-radius:14px;padding:18px;text-align:center;margin-bottom:10px">
      <div style="font-size:38px">${esc(x.premioIco || '🎁')}</div>
      <div style="font-weight:800;font-size:18px">${esc(x.premioNombre || '')}</div>
      <div class="small" style="color:#bbb;margin-top:4px">Socio ${esc(x.socioNombre || '')} · N° ${padNro(x.socioNro)}</div>
      <div class="small" style="color:#F58220;font-family:monospace;margin-top:6px">${esc(x.codigo || '')}</div></div>`;
  }
  GDO.Views.validarVoucher = function (mount, canjeId) {
    const wrap = (inner) => `<div style="max-width:460px;margin:36px auto;padding:0 16px">${inner}
      <div style="margin-top:16px"><button class="btn btn-ghost" id="vv-back">← Volver al panel</button></div></div>`;
    const wireBack = () => { const b = mount.querySelector('#vv-back'); if (b) b.onclick = () => { location.hash = '#/club'; }; };
    if (!db()) { mount.innerHTML = wrap(vvCard('📡', 'Sin conexión', 'Revisá tu internet y reintentá.', '#c0392b')); wireBack(); return; }
    if (!canjeId) { mount.innerHTML = wrap(vvCard('❌', 'Voucher inválido', 'El link no trae un código de voucher.', '#c0392b')); wireBack(); return; }
    mount.innerHTML = wrap('<div class="empty">Validando voucher…</div>');
    db().collection('canjes').doc(canjeId).get().then((d) => {
      if (!d.exists) { mount.innerHTML = wrap(vvCard('❌', 'Voucher inexistente', 'Ese código no corresponde a ningún voucher.', '#c0392b')); wireBack(); return; }
      const x = d.data(); x._id = d.id;
      if (x.usado) {
        const cuando = (x.usadoTs && x.usadoTs.toDate) ? ' el ' + x.usadoTs.toDate().toLocaleString('es-AR') : '';
        mount.innerHTML = wrap(vvDetalle(x) + vvCard('⚠️', 'Ya fue usado', 'Este voucher ya se canjeó' + cuando + '. No es válido de nuevo.', '#c0392b')); wireBack(); return;
      }
      // VENCIDO: ni siquiera se ofrece el botón de entregar (el voucher dura 30 días).
      if (vencido(x)) {
        mount.innerHTML = wrap(vvDetalle(x) + vvCard('⌛', 'Voucher vencido',
          'Venció el <b>' + fechaCorta(x.venceMs) + '</b> (los vouchers duran 30 días). <b>No se entrega el premio.</b>', '#c0392b')); wireBack(); return;
      }
      mount.innerHTML = wrap(vvDetalle(x) + `<div class="small muted" style="text-align:center;margin-bottom:8px">Vence el <b>${fechaCorta(x.venceMs)}</b></div><button class="btn btn-verde" id="vv-ok" style="width:100%">✓ Validar y entregar</button>`);
      wireBack();
      mount.querySelector('#vv-ok').onclick = () => {
        const b = mount.querySelector('#vv-ok'); b.disabled = true; b.textContent = 'Validando…';
        usarVoucher(canjeId).then((y) => {
          mount.innerHTML = wrap(vvCard('✅', 'Voucher válido', 'Entregá <b>' + esc(y.premioIco || '🎁') + ' ' + esc(y.premioNombre || '') + '</b> a <b>' + esc(y.socioNombre || '') + '</b> (N° ' + padNro(y.socioNro) + ').', '#1e8449')); wireBack();
        }).catch((e) => {
          const mm = (e && e.message) || ''; b.disabled = false; b.textContent = '✓ Validar y entregar';
          toast(mm === 'usado' ? 'Recién se usó este voucher.'
            : mm === 'vencido' ? '⌛ Voucher vencido: no se entrega.'
            : (e && e.code === 'permission-denied') ? 'Rechazado: el voucher está vencido o ya se usó.'
            : 'No se pudo validar (¿iniciaste sesión como personal?).', 'error');
        });
      };
    }).catch(() => { mount.innerHTML = wrap(vvCard('🔒', 'No se pudo leer', 'Entrá como personal (admin/chofer) para validar vouchers.', '#c0392b')); wireBack(); });
  };
})();
