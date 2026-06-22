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

  // Escáner del mostrador: cámara (QR del voucher) + ingreso manual del código.
  function escanearVoucher() {
    let h5 = null, done = false;
    modal({
      title: '📷 Escanear voucher', width: 440,
      bodyHTML:
        `<div id="qr-reader" style="width:100%;min-height:240px;background:#000;border-radius:10px;overflow:hidden"></div>` +
        `<div id="qr-msg" class="small muted" style="margin-top:8px;text-align:center">Apuntá la cámara al QR del voucher del socio.</div>` +
        `<div style="margin-top:10px;border-top:1px solid #e6e8eb;padding-top:10px">` +
          `<label style="font-size:12px;color:#5b6470;font-weight:600">¿No lee? Ingresá el código a mano</label>` +
          `<div style="display:flex;gap:6px;margin-top:4px"><input id="qr-cod" placeholder="GDO-XXXX-XXXX-XXXX" style="flex:1;padding:9px;border:1px solid #cfd4da;border-radius:8px;font-family:monospace;text-transform:uppercase"/><button class="btn btn-sm" id="qr-buscar">Validar</button></div>` +
        `</div>`,
      footHTML: `<button class="btn btn-ghost" data-no>Cerrar</button>`,
      onMount(m, close) {
        const msg = m.querySelector('#qr-msg');
        const stopCam = () => { if (h5) { const x = h5; h5 = null; try { x.stop().then(() => { try { x.clear(); } catch (e) {} }).catch(() => {}); } catch (e) {} } };
        const cerrar = () => { stopCam(); close(); };
        // Vigía: apaga la cámara pase lo que pase (cerrar con la ✕, tocando el
        // fondo, Escape o el botón). Sacar el div NO corta el stream: hay que
        // llamar stop(). Sin esto la cámara queda grabando.
        const _obs = new MutationObserver(() => { if (!document.body.contains(m)) { stopCam(); _obs.disconnect(); } });
        _obs.observe(document.body, { childList: true, subtree: true });
        const procesar = (canjeId) => usarVoucher(canjeId)
          .then((x) => { cerrar(); resultadoOk(x); })
          .catch((e) => {
            const mm = (e && e.message) || '';
            msg.innerHTML = mm === 'usado' ? '<b style="color:#c0392b">❌ Este voucher YA fue usado.</b>'
              : mm === 'inexistente' ? '<b style="color:#c0392b">❌ Voucher inexistente.</b>'
              : '<b style="color:#c0392b">❌ No se pudo validar. Reintentá.</b>';
            done = false; // permite reintentar
          });
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
          let id = text || '';
          if (id.indexOf('GDOCANJE:') !== 0) { msg.innerHTML = 'Ese QR no es un voucher GDO.'; return; }
          id = id.slice(9); done = true; procesar(id);
        }, () => {}).catch(() => { msg.innerHTML = 'No se pudo abrir la cámara. Usá el código a mano.'; });
      },
    });
  }
})();
