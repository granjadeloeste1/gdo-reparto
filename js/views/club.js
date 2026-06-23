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
    c.innerHTML = `
      <div id="club-onoff" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:#fff;border:1px solid var(--gris-bd);border-radius:12px;padding:12px 16px;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:10px">
          <span id="club-dot" style="width:11px;height:11px;border-radius:50%;background:#bbb;flex-shrink:0"></span>
          <div><b>GDO CLUB</b><div class="small muted" id="club-estado">Consultando estado…</div></div>
        </div>
        <button class="btn btn-sm btn-ghost" id="club-toggle" disabled>…</button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        <button class="btn btn-sm ${tab === 'mostrador' ? '' : 'btn-ghost'}" data-tab="mostrador">📍 Mostrador <span id="mb-badge"></span></button>
        <button class="btn btn-sm ${tab === 'socios' ? '' : 'btn-ghost'}" data-tab="socios">👥 Socios</button>
        <button class="btn btn-sm ${tab === 'premios' ? '' : 'btn-ghost'}" data-tab="premios">🎁 Premios</button>
        <button class="btn btn-sm ${tab === 'canjes' ? '' : 'btn-ghost'}" data-tab="canjes">📋 Canjes</button>
      </div>
      <div id="club-body"><div class="empty">Cargando…</div></div>`;
    renderOnOff(c);
    c.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; GDO.Views.club(c); });
    const body = c.querySelector('#club-body');
    if (tab === 'mostrador') renderMostrador(body, c);
    else if (tab === 'socios') renderSocios(body);
    else if (tab === 'premios') renderPremios(body);
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
    subs.push(db().collection('clientes').onSnapshot((snap) => {
      const arr = []; snap.forEach((d) => { const x = d.data(); x._id = d.id; arr.push(x); });
      arr.sort((a, b) => (a.nroSocio || 0) - (b.nroSocio || 0));
      if (!arr.length) { box.innerHTML = '<div class="empty">Todavía no hay socios registrados.</div>'; return; }
      box.innerHTML =
        `<div class="small muted" style="margin-bottom:8px">Tocá un socio para ver sus datos (DNI, dirección, teléfono, email).</div>` +
        `<table><thead><tr><th>N°</th><th>Socio</th><th>Email</th><th>Puntos</th><th>Desde</th><th></th></tr></thead><tbody>` +
        arr.map((s) => `<tr data-ver="${esc(s._id)}" style="cursor:pointer">
          <td><b>${padNro(s.nroSocio)}</b></td>
          <td>${esc(s.nombre || '')}</td>
          <td class="small">${esc(s.email || '')}</td>
          <td><b style="color:#F58220">${fmt(s.puntos)}</b></td>
          <td class="small">${fechaCorta(s.creado)}</td>
          <td class="t-actions"><button class="btn btn-ghost btn-sm" data-pts="${esc(s._id)}" title="Cargar puntos">＋ puntos</button></td>
        </tr>`).join('') + `</tbody></table>`;
      box.querySelectorAll('[data-ver]').forEach((tr) => tr.onclick = () => verSocio(arr.find((x) => x._id === tr.dataset.ver)));
      box.querySelectorAll('[data-pts]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); cargarPuntos(arr.find((x) => x._id === b.dataset.pts)); });
    }, () => { box.innerHTML = '<div class="empty">No se pudieron cargar los socios.</div>'; }));
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
        </div>` +
        filaDato('Nombre y apellido', s.nombre) +
        filaDato('DNI', s.dni) +
        filaDato('Teléfono / WhatsApp', s.telefono) +
        filaDato('Email', s.email) +
        filaDato('Dirección', s.direccion) +
        filaDato('Socio desde', fechaCorta(s.creado)),
      footHTML: `<button class="btn btn-ghost" data-no>Cerrar</button><button class="btn" data-pts>＋ Cargar puntos</button>`,
      onMount(m, close) {
        m.querySelector('[data-no]').onclick = close;
        m.querySelector('[data-pts]').onclick = () => { close(); cargarPuntos(s); };
      },
    });
  }

  // Carga MANUAL de puntos (compra en el local). Transacción atómica.
  // visitaId (opcional): si viene de un check-in del QR, lo marca atendido.
  function cargarPuntos(socio, visitaId) {
    if (!socio) return;
    modal({
      title: `Cargar puntos · ${socio.nombre || 'Socio'} (N° ${padNro(socio.nroSocio)})`, width: 440,
      bodyHTML:
        `<p class="small muted" style="margin:0 0 10px">Saldo actual: <b style="color:#F58220">${fmt(socio.puntos)}</b> puntos</p>` +
        `<label style="font-size:13px;color:#5b6470;font-weight:600">Puntos a sumar</label>` +
        `<input id="cp-pts" type="number" inputmode="numeric" min="1" placeholder="ej: 5000" style="width:100%;padding:11px;border:1px solid #cfd4da;border-radius:9px;font-size:15px"/>` +
        `<label style="font-size:13px;color:#5b6470;font-weight:600;margin-top:10px;display:block">Motivo (opcional)</label>` +
        `<input id="cp-mot" type="text" placeholder="ej: compra en el local" style="width:100%;padding:11px;border:1px solid #cfd4da;border-radius:9px;font-size:15px"/>`,
      footHTML: `<button class="btn btn-ghost" data-no>Cancelar</button><button class="btn" data-yes>Sumar puntos</button>`,
      onMount(m, close) {
        m.querySelector('[data-no]').onclick = close;
        m.querySelector('[data-yes]').onclick = () => {
          const pts = parseInt(m.querySelector('#cp-pts').value, 10);
          const mot = (m.querySelector('#cp-mot').value || '').trim() || 'Carga manual';
          if (!pts || pts <= 0) { toast('Poné una cantidad válida de puntos.', 'error'); return; }
          const btn = m.querySelector('[data-yes]'); btn.disabled = true; btn.textContent = 'Sumando…';
          acreditar(socio._id, pts, mot, null)
            .then(() => {
              if (visitaId) {
                db().collection('visitas').doc(visitaId).update({ estado: 'atendido', puntos: pts, por: staffUid(), cierreTs: FV().serverTimestamp() }).catch(() => {});
              }
              toast('✓ ' + fmt(pts) + ' puntos cargados.'); close();
            })
            .catch(() => { toast('No se pudo cargar. Reintentá.', 'error'); btn.disabled = false; btn.textContent = 'Sumar puntos'; });
        };
      },
    });
  }

  // Suma/resta puntos en transacción + log de auditoría. delta>0 acredita.
  function acreditar(clienteUid, delta, motivo, canjeId) {
    const cref = db().collection('clientes').doc(clienteUid);
    const lref = db().collection('puntos_log').doc();
    return db().runTransaction((tx) => tx.get(cref).then((cd) => {
      if (!cd.exists) throw new Error('socio inexistente');
      const actual = cd.data().puntos || 0;
      const nuevo = actual + delta;
      if (nuevo < 0) throw new Error('saldo insuficiente');
      tx.update(cref, { puntos: nuevo });
      tx.set(lref, { clienteUid: clienteUid, delta: delta, motivo: motivo || '', saldo: nuevo, canjeId: canjeId || null, por: staffUid(), ts: FV().serverTimestamp() });
      return nuevo;
    }));
  }

  /* ---------------- PREMIOS ---------------- */
  function renderPremios(box) {
    subs.push(db().collection('premios').onSnapshot((snap) => {
      const arr = []; snap.forEach((d) => { const x = d.data(); x._id = d.id; arr.push(x); });
      arr.sort((a, b) => (a.costo || 0) - (b.costo || 0));
      box.innerHTML =
        `<div style="margin-bottom:12px"><button class="btn" id="pr-add">＋ Nuevo premio</button></div>` +
        (arr.length
          ? `<table><thead><tr><th></th><th>Premio</th><th>Costo</th><th>Estado</th><th></th></tr></thead><tbody>` +
            arr.map((p) => `<tr>
              <td style="font-size:22px">${p.ico || '🎁'}</td>
              <td>${esc(p.nombre || '')}</td>
              <td><b style="color:#F58220">${fmt(p.costo)}</b> pts</td>
              <td>${p.activo ? '<span class="chip chip-entreg">Activo</span>' : '<span class="chip chip-no">Inactivo</span>'}</td>
              <td class="t-actions"><button class="btn btn-ghost btn-sm" data-edit="${esc(p._id)}">✎</button><button class="btn btn-ghost btn-sm" data-del="${esc(p._id)}">🗑</button></td>
            </tr>`).join('') + `</tbody></table>`
          : '<div class="empty">No hay premios cargados. Agregá el primero.</div>');
      box.querySelector('#pr-add').onclick = () => premioModal(null);
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
        `<label style="font-size:13px;color:#5b6470;font-weight:600;margin-top:10px;display:block">Costo en Puntos GDO</label>` +
        `<input id="pm-costo" type="number" inputmode="numeric" min="1" value="${ed ? (p.costo || '') : ''}" placeholder="ej: 500000" style="width:100%;padding:11px;border:1px solid #cfd4da;border-radius:9px;font-size:15px"/>` +
        `<label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:14px;cursor:pointer"><input id="pm-act" type="checkbox" ${(!ed || p.activo) ? 'checked' : ''}/> Activo (visible para los socios)</label>`,
      footHTML: `<button class="btn btn-ghost" data-no>Cancelar</button><button class="btn" data-yes>Guardar</button>`,
      onMount(m, close) {
        m.querySelector('[data-no]').onclick = close;
        m.querySelector('[data-yes]').onclick = () => {
          const ico = (m.querySelector('#pm-ico').value || '🎁').trim() || '🎁';
          const nom = (m.querySelector('#pm-nom').value || '').trim();
          const costo = parseInt(m.querySelector('#pm-costo').value, 10);
          const activo = m.querySelector('#pm-act').checked;
          if (!nom) { toast('Poné el nombre del premio.', 'error'); return; }
          if (!costo || costo <= 0) { toast('Poné el costo en puntos.', 'error'); return; }
          const data = { ico: ico, nombre: nom, costo: costo, activo: activo };
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
      arr.sort((a, b) => (Number(!!a.usado) - Number(!!b.usado)) ||
        ((b.ts && b.ts.toMillis ? b.ts.toMillis() : 0) - (a.ts && a.ts.toMillis ? a.ts.toMillis() : 0)));
      box.innerHTML =
        `<div style="margin-bottom:12px"><button class="btn" id="cj-scan">📷 Escanear voucher</button></div>` +
        (arr.length
          ? `<table><thead><tr><th>Premio</th><th>Socio</th><th>Código</th><th>Estado</th></tr></thead><tbody>` +
            arr.map((c) => `<tr>
              <td>${c.premioIco || '🎁'} ${esc(c.premioNombre || '')}</td>
              <td class="small">${esc(c.socioNombre || '')}<br><span class="muted">N° ${padNro(c.socioNro)}</span></td>
              <td class="small" style="font-family:monospace">${esc(c.codigo || '')}</td>
              <td>${c.usado ? '<span class="chip chip-entreg">✔ Usado</span>' : '<span class="chip chip-pend">🎟️ Vigente</span>'}</td>
            </tr>`).join('') + `</tbody></table>`
          : '<div class="empty">Todavía no hay canjes. Cuando un socio canjee un premio, su voucher aparece acá.</div>');
      box.querySelector('#cj-scan').onclick = escanearVoucher;
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
            msg.innerHTML = mm === 'usado' ? '<b style="color:#c0392b">❌ Este voucher YA fue usado.</b>'
              : mm === 'inexistente' ? '<b style="color:#c0392b">❌ Voucher inexistente.</b>'
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
        <div style="font-size:42px">${x.premioIco || '🎁'}</div>
        <div style="font-weight:800;font-size:17px;margin-top:4px">${esc(x.premioNombre || '')}</div>
        <div class="small muted" style="margin-top:6px">Entregar a <b>${esc(x.socioNombre || '')}</b> · N° ${padNro(x.socioNro)}</div>
        <div style="margin-top:12px"><span class="chip chip-entreg">Marcado como USADO ✔</span></div></div>`,
      footHTML: `<button class="btn btn-verde" data-yes>Listo</button>`,
      onMount(m, close) { m.querySelector('[data-yes]').onclick = close; },
    });
  }

  // Marca el voucher USADO en transacción (single-use). Si ya estaba usado falla:
  // no se puede canjear dos veces (ni con fotocopias del mismo código).
  function usarVoucher(canjeId) {
    const ref = db().collection('canjes').doc(canjeId);
    return db().runTransaction((tx) => tx.get(ref).then((cd) => {
      if (!cd.exists) throw new Error('inexistente');
      const x = cd.data();
      if (x.usado) throw new Error('usado');
      tx.update(ref, { usado: true, estado: 'usado', usadoPor: staffUid(), usadoTs: FV().serverTimestamp() });
      x._id = cd.id; return x;
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
      <div style="font-size:38px">${x.premioIco || '🎁'}</div>
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
      mount.innerHTML = wrap(vvDetalle(x) + `<button class="btn btn-verde" id="vv-ok" style="width:100%">✓ Validar y entregar</button>`);
      wireBack();
      mount.querySelector('#vv-ok').onclick = () => {
        const b = mount.querySelector('#vv-ok'); b.disabled = true; b.textContent = 'Validando…';
        usarVoucher(canjeId).then((y) => {
          mount.innerHTML = wrap(vvCard('✅', 'Voucher válido', 'Entregá <b>' + (y.premioIco || '🎁') + ' ' + esc(y.premioNombre || '') + '</b> a <b>' + esc(y.socioNombre || '') + '</b> (N° ' + padNro(y.socioNro) + ').', '#1e8449')); wireBack();
        }).catch((e) => {
          const mm = (e && e.message) || ''; b.disabled = false; b.textContent = '✓ Validar y entregar';
          toast(mm === 'usado' ? 'Recién se usó este voucher.' : 'No se pudo validar (¿iniciaste sesión como personal?).', 'error');
        });
      };
    }).catch(() => { mount.innerHTML = wrap(vvCard('🔒', 'No se pudo leer', 'Entrá como personal (admin/chofer) para validar vouchers.', '#c0392b')); wireBack(); });
  };
})();
