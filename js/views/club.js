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
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        <button class="btn btn-sm ${tab === 'mostrador' ? '' : 'btn-ghost'}" data-tab="mostrador">📍 Mostrador <span id="mb-badge"></span></button>
        <button class="btn btn-sm ${tab === 'socios' ? '' : 'btn-ghost'}" data-tab="socios">👥 Socios</button>
        <button class="btn btn-sm ${tab === 'premios' ? '' : 'btn-ghost'}" data-tab="premios">🎁 Premios</button>
        <button class="btn btn-sm ${tab === 'canjes' ? '' : 'btn-ghost'}" data-tab="canjes">📋 Canjes</button>
      </div>
      <div id="club-body"><div class="empty">Cargando…</div></div>`;
    c.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; GDO.Views.club(c); });
    const body = c.querySelector('#club-body');
    if (tab === 'mostrador') renderMostrador(body, c);
    else if (tab === 'socios') renderSocios(body);
    else if (tab === 'premios') renderPremios(body);
    else renderCanjes(body);
  };

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
        `<table><thead><tr><th>N°</th><th>Socio</th><th>Email</th><th>Puntos</th><th>Desde</th><th></th></tr></thead><tbody>` +
        arr.map((s) => `<tr>
          <td><b>${padNro(s.nroSocio)}</b></td>
          <td>${esc(s.nombre || '')}</td>
          <td class="small">${esc(s.email || '')}</td>
          <td><b style="color:#F58220">${fmt(s.puntos)}</b></td>
          <td class="small">${fechaCorta(s.creado)}</td>
          <td class="t-actions"><button class="btn btn-ghost btn-sm" data-pts="${esc(s._id)}" title="Cargar puntos">＋ puntos</button></td>
        </tr>`).join('') + `</tbody></table>`;
      box.querySelectorAll('[data-pts]').forEach((b) => b.onclick = () => cargarPuntos(arr.find((x) => x._id === b.dataset.pts)));
    }, () => { box.innerHTML = '<div class="empty">No se pudieron cargar los socios.</div>'; }));
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
        `<div style="margin-bottom:6px"><button class="btn" id="cj-scan">🎟️ Validar voucher por código</button></div>
         <div class="small muted" style="margin-bottom:12px">💡 El cajero también puede <b>escanear el QR del voucher con la cámara del celular</b>: abre un link y lo valida solo (no hace falta este botón).</div>` +
        (arr.length
          ? `<table><thead><tr><th>Premio</th><th>Socio</th><th>Código</th><th>Estado</th></tr></thead><tbody>` +
            arr.map((c) => `<tr>
              <td>${c.premioIco || '🎁'} ${esc(c.premioNombre || '')}</td>
              <td class="small">${esc(c.socioNombre || '')}<br><span class="muted">N° ${padNro(c.socioNro)}</span></td>
              <td class="small" style="font-family:monospace">${esc(c.codigo || '')}</td>
              <td>${c.usado ? '<span class="chip chip-entreg">✔ Usado</span>' : '<span class="chip chip-pend">🎟️ Vigente</span>'}</td>
            </tr>`).join('') + `</tbody></table>`
          : '<div class="empty">Todavía no hay canjes. Cuando un socio canjee un premio, su voucher aparece acá.</div>');
      box.querySelector('#cj-scan').onclick = validarPorCodigo;
    }, () => { box.innerHTML = '<div class="empty">No se pudieron cargar los canjes.</div>'; }));
  }

  // Fallback manual: el cajero tipea el código del voucher. Reusa la misma
  // pantalla de validación que el escaneo (vía hash #/v/<id>).
  function validarPorCodigo() {
    modal({
      title: 'Validar voucher por código', width: 420,
      bodyHTML:
        `<label style="font-size:13px;color:#5b6470;font-weight:600">Código del voucher</label>` +
        `<input id="vc-cod" placeholder="GDO-XXXX-XXXX-XXXX" style="width:100%;padding:11px;border:1px solid #cfd4da;border-radius:9px;font-family:monospace;text-transform:uppercase;font-size:15px"/>` +
        `<div id="vc-msg" class="small muted" style="margin-top:8px"></div>`,
      footHTML: `<button class="btn btn-ghost" data-no>Cerrar</button><button class="btn" data-yes>Buscar</button>`,
      onMount(m, close) {
        const msg = m.querySelector('#vc-msg');
        m.querySelector('[data-no]').onclick = close;
        m.querySelector('[data-yes]').onclick = () => {
          const cod = (m.querySelector('#vc-cod').value || '').trim().toUpperCase();
          if (!cod) return;
          db().collection('canjes').where('codigo', '==', cod).limit(1).get()
            .then((s) => { if (s.empty) { msg.textContent = 'No se encontró ese código.'; return; } close(); location.hash = '#/v/' + s.docs[0].id; })
            .catch(() => { msg.textContent = 'Error al buscar. Reintentá.'; });
        };
      },
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
