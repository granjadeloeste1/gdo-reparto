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

  let tab = 'socios';
  let subs = [];
  function clearSubs() { subs.forEach((u) => { try { u(); } catch (e) {} }); subs = []; }

  GDO.Views.club = function (c) {
    clearSubs();
    if (!db()) { c.innerHTML = '<div class="empty">Sin conexión con la base. Reintentá en un momento.</div>'; return; }
    c.innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        <button class="btn btn-sm ${tab === 'socios' ? '' : 'btn-ghost'}" data-tab="socios">👥 Socios</button>
        <button class="btn btn-sm ${tab === 'premios' ? '' : 'btn-ghost'}" data-tab="premios">🎁 Premios</button>
        <button class="btn btn-sm ${tab === 'canjes' ? '' : 'btn-ghost'}" data-tab="canjes">📋 Canjes</button>
      </div>
      <div id="club-body"><div class="empty">Cargando…</div></div>`;
    c.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; GDO.Views.club(c); });
    const body = c.querySelector('#club-body');
    if (tab === 'socios') renderSocios(body);
    else if (tab === 'premios') renderPremios(body);
    else renderCanjes(body);
  };

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
  function cargarPuntos(socio) {
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
            .then(() => { toast('✓ ' + fmt(pts) + ' puntos cargados.'); close(); })
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

  /* ---------------- CANJES ---------------- */
  function renderCanjes(box) {
    subs.push(db().collection('canjes').onSnapshot((snap) => {
      const arr = []; snap.forEach((d) => { const x = d.data(); x._id = d.id; arr.push(x); });
      const orden = { solicitado: 0, aprobado: 1, entregado: 2, rechazado: 3 };
      arr.sort((a, b) => ((orden[a.estado] || 9) - (orden[b.estado] || 9)) ||
        ((b.ts && b.ts.toMillis ? b.ts.toMillis() : 0) - (a.ts && a.ts.toMillis ? a.ts.toMillis() : 0)));
      if (!arr.length) { box.innerHTML = '<div class="empty">No hay canjes solicitados.</div>'; return; }
      const chip = { solicitado: '<span class="chip chip-pend">⏳ Solicitado</span>', aprobado: '<span class="chip chip-asig">✅ Aprobado</span>', entregado: '<span class="chip chip-entreg">🎁 Entregado</span>', rechazado: '<span class="chip chip-no">❌ Rechazado</span>' };
      box.innerHTML = `<table><thead><tr><th>Fecha</th><th>Premio</th><th>Puntos</th><th>Socio</th><th>Estado</th><th></th></tr></thead><tbody>` +
        arr.map((cj) => `<tr>
          <td class="small">${fechaCorta(cj.ts)}</td>
          <td>${esc(cj.premioNombre || '')}</td>
          <td><b style="color:#F58220">${fmt(cj.puntos)}</b></td>
          <td class="small" title="${esc(cj.clienteUid || '')}">${esc((cj.clienteUid || '').slice(0, 8))}…</td>
          <td>${chip[cj.estado] || cj.estado}</td>
          <td class="t-actions">${cj.estado === 'solicitado'
            ? `<button class="btn btn-sm" data-ap="${esc(cj._id)}">Aprobar</button> <button class="btn btn-ghost btn-sm" data-rj="${esc(cj._id)}">Rechazar</button>`
            : (cj.estado === 'aprobado' ? `<button class="btn btn-ghost btn-sm" data-eg="${esc(cj._id)}">Marcar entregado</button>` : '')}</td>
        </tr>`).join('') + `</tbody></table>`;
      box.querySelectorAll('[data-ap]').forEach((b) => b.onclick = () => aprobarCanje(arr.find((x) => x._id === b.dataset.ap)));
      box.querySelectorAll('[data-rj]').forEach((b) => b.onclick = () => {
        const cj = arr.find((x) => x._id === b.dataset.rj);
        confirmDlg('¿Rechazar este canje? No se descuentan puntos.', () => {
          db().collection('canjes').doc(cj._id).update({ estado: 'rechazado' }).then(() => toast('Canje rechazado.')).catch(() => toast('Error.', 'error'));
        }, 'Rechazar');
      });
      box.querySelectorAll('[data-eg]').forEach((b) => b.onclick = () => {
        const cj = arr.find((x) => x._id === b.dataset.eg);
        db().collection('canjes').doc(cj._id).update({ estado: 'entregado' }).then(() => toast('Marcado como entregado.')).catch(() => toast('Error.', 'error'));
      });
    }, () => { box.innerHTML = '<div class="empty">No se pudieron cargar los canjes.</div>'; }));
  }

  // Aprobar canje: descuenta los puntos del socio (transacción) y marca el canje.
  function aprobarCanje(cj) {
    if (!cj) return;
    confirmDlg(`¿Aprobar el canje de "${cj.premioNombre}" por ${fmt(cj.puntos)} puntos? Se descuentan del socio.`, () => {
      const cref = db().collection('clientes').doc(cj.clienteUid);
      const jref = db().collection('canjes').doc(cj._id);
      const lref = db().collection('puntos_log').doc();
      db().runTransaction((tx) => tx.get(cref).then((cd) => {
        if (!cd.exists) throw new Error('socio inexistente');
        const actual = cd.data().puntos || 0;
        if (actual < (cj.puntos || 0)) throw new Error('saldo insuficiente');
        tx.update(cref, { puntos: actual - cj.puntos });
        tx.update(jref, { estado: 'aprobado', aprobadoPor: staffUid(), aprobadoTs: FV().serverTimestamp() });
        tx.set(lref, { clienteUid: cj.clienteUid, delta: -cj.puntos, motivo: 'Canje: ' + (cj.premioNombre || ''), saldo: actual - cj.puntos, canjeId: cj._id, por: staffUid(), ts: FV().serverTimestamp() });
      })).then(() => toast('✓ Canje aprobado y puntos descontados.'))
        .catch((e) => toast(String((e && e.message) || '').indexOf('insuficiente') >= 0 ? 'El socio no tiene puntos suficientes.' : 'No se pudo aprobar.', 'error'));
    }, 'Aprobar', 'btn');
  }
})();
