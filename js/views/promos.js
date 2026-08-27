/* ====== GDO Reparto — Promos de la tienda ======
   Las imágenes que van rotando arriba de la lista de precios
   (lista.granjadeloeste.com). Son las mismas piezas verticales que se suben a
   los estados de WhatsApp: formato 9:16.

   DÓNDE SE GUARDAN: en Firestore, colección `promos`, con la imagen embebida
   como dataURL dentro del documento. No usamos Firebase Storage porque el plan
   gratis (Spark) no lo incluye. Es el mismo criterio que ya se usa para la foto
   del comprobante de entrega. Por eso la imagen se COMPRIME antes de subir:
   1080 px de lado mayor, calidad 0.65 → unos 120-200 KB. El límite duro de
   Firestore es 1 MB por documento y el base64 infla ~33%, así que rechazamos
   cualquier cosa que pase de 700 KB ya comprimida.

   La tienda las lee sin login (regla `allow read: if true`): son piezas de
   publicidad, están hechas para que las vea cualquiera. Escribir, solo staff. */
window.GDO = window.GDO || {}; GDO.Views = GDO.Views || {};
(function () {
  const { esc, h, toast, modal, confirmDlg } = GDO.UI;
  const db = () => (GDO.FB && GDO.FB.enabled && GDO.FB.db) ? GDO.FB.db : null;
  const staffUid = () => (GDO.FB && GDO.FB.uid) ? GDO.FB.uid : null;

  const MAX_LADO = 1080;      // px del lado más largo (alto, en las verticales)
  const CALIDAD = 0.65;
  const MAX_BYTES = 700 * 1024;
  const SEG_DEF = 5;          // segundos por imagen si nunca se configuró
  const kb = (s) => Math.round(String(s || '').length * 0.75 / 1024);  // dataURL → KB reales

  let cache = [];

  GDO.Views.promos = function (c) {
    c.innerHTML = `
      <div class="section-title"><h2>Promos de la tienda</h2></div>
      <div class="note">Estas imágenes se muestran en el <b>menú inicial</b> de
        <b>lista.granjadeloeste.com</b>, antes de que el cliente elija la lista. Son las mismas
        piezas <b>verticales</b> que subís a los estados de WhatsApp (formato 9:16).
        Se ven <b>de a dos</b> y se corren solas de derecha a izquierda; el cliente también las
        puede pasar con las flechitas. Si toca una, se abre en pantalla completa.
        Si no hay ninguna activa, no se muestra nada.</div>
      <div class="toolbar">
        <label class="pr-seg">⏱️ Cada imagen se ve
          <select id="pr-seg">${[3, 4, 5, 6, 8, 10, 15].map((s) => `<option value="${s}">${s} segundos</option>`).join('')}</select>
        </label>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="pr-new">+ Subir promo</button>
      </div>
      <div id="pr-cont"><div class="empty">Cargando…</div></div>`;

    const cont = c.querySelector('#pr-cont');
    c.querySelector('#pr-new').onclick = () => promoModal(null, () => cargar(cont));
    montarSegundos(c.querySelector('#pr-seg'));
    cargar(cont);
  };

  /* Cuántos segundos se ve cada promo antes de pasar a la siguiente. Vive en un
     documento aparte, `promos/_config`, que NO tiene imagen — por eso la tienda
     lo saltea al armar el carrusel y nunca se dibuja como una promo más. */
  function montarSegundos(sel) {
    const fdb = db();
    if (!fdb || !sel) return;
    fdb.collection('promos').doc('_config').get().then((d) => {
      const s = (d.exists && d.data().segundos) || SEG_DEF;
      sel.value = String(s);
    }).catch(() => { sel.value = String(SEG_DEF); });

    sel.onchange = () => {
      fdb.collection('promos').doc('_config').set({ segundos: +sel.value }, { merge: true })
        .then(() => toast('Listo: cada imagen se ve ' + sel.value + ' segundos', 'ok'))
        .catch(() => toast('No se pudo guardar el tiempo', 'err'));
    };
  }

  function cargar(cont) {
    const fdb = db();
    if (!fdb) {
      cont.innerHTML = '<div class="empty">Sin conexión. Las promos se administran online.</div>';
      return;
    }
    fdb.collection('promos').get().then((snap) => {
      // `_config` guarda el tiempo por imagen, no es una promo: fuera de la grilla.
      cache = snap.docs.filter((d) => d.id !== '_config').map((d) => Object.assign({}, d.data(), { id: d.id }));
      cache.sort((a, b) => (a.orden || 0) - (b.orden || 0));
      dibujar(cont);
    }).catch((e) => {
      console.warn('[GDO] promos', e && e.code);
      cont.innerHTML = '<div class="empty">No se pudieron cargar las promos. '
        + (e && e.code === 'permission-denied' ? 'Faltan publicar las reglas de <b>/promos</b> en Firestore.' : '') + '</div>';
    });
  }

  function dibujar(cont) {
    if (!cache.length) {
      cont.innerHTML = `<div class="panel"><div class="panel-b"><div class="empty" style="padding:44px 20px">
        <div style="font-size:36px;margin-bottom:8px">🖼️</div>
        <b style="display:block;font-size:16px;color:var(--negro);margin-bottom:6px">Todavía no hay promos</b>
        Subí la primera con “+ Subir promo”. Podés usar la misma imagen que armás para el estado de WhatsApp.
      </div></div></div>`;
      return;
    }
    const activas = cache.filter((p) => p.activo).length;
    cont.innerHTML = `
      <div class="help" style="margin-bottom:10px">${activas} activa${activas === 1 ? '' : 's'} de ${cache.length} · el cliente las ve en este orden</div>
      <div class="promo-grid">${cache.map((p, i) => `
        <div class="promo-card ${p.activo ? '' : 'off'}">
          <div class="promo-img"><img src="${p.img}" alt="${esc(p.titulo || 'promo')}"/></div>
          <div class="promo-tx">
            <b>${esc(p.titulo || 'Sin título')}</b>
            <span>${kb(p.img)} KB${p.link ? ' · con link' : ''}</span>
          </div>
          <div class="promo-ac">
            <button class="btn btn-ghost btn-sm" data-mv="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="Subir">↑</button>
            <button class="btn btn-ghost btn-sm" data-mv="${i}" data-dir="1" ${i === cache.length - 1 ? 'disabled' : ''} title="Bajar">↓</button>
            <button class="btn ${p.activo ? 'btn-verde' : 'btn-ghost'} btn-sm" data-on="${p.id}">${p.activo ? 'Activa' : 'Pausada'}</button>
            <button class="btn btn-ghost btn-sm" data-ed="${p.id}">✎</button>
            <button class="btn btn-ghost btn-sm" data-del="${p.id}">🗑</button>
          </div>
        </div>`).join('')}</div>`;

    cont.querySelectorAll('[data-on]').forEach((b) => b.onclick = () => {
      const p = cache.filter((x) => x.id === b.dataset.on)[0];
      db().collection('promos').doc(p.id).set({ activo: !p.activo }, { merge: true })
        .then(() => { toast(!p.activo ? 'Promo activada ✓' : 'Promo pausada', 'ok'); cargar(cont); })
        .catch(() => toast('No se pudo guardar', 'err'));
    });
    cont.querySelectorAll('[data-ed]').forEach((b) => b.onclick = () =>
      promoModal(cache.filter((x) => x.id === b.dataset.ed)[0], () => cargar(cont)));
    cont.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
      const p = cache.filter((x) => x.id === b.dataset.del)[0];
      confirmDlg('¿Borrar la promo "' + (p.titulo || 'sin título') + '"? Deja de verse en la tienda.', () => {
        db().collection('promos').doc(p.id).delete()
          .then(() => { toast('Promo borrada', 'ok'); cargar(cont); })
          .catch(() => toast('No se pudo borrar', 'err'));
      });
    });
    cont.querySelectorAll('[data-mv]').forEach((b) => b.onclick = () => {
      const i = +b.dataset.mv, j = i + (+b.dataset.dir);
      if (j < 0 || j >= cache.length) return;
      const a = cache[i], z = cache[j];
      // Se reescribe TODO el orden, no solo los dos que se mueven: así queda
      // consistente aunque las promos vengan con números repetidos o salteados.
      const tmp = cache.slice();
      tmp[i] = z; tmp[j] = a;
      const lote = db().batch();
      tmp.forEach((p, k) => lote.set(db().collection('promos').doc(p.id), { orden: k }, { merge: true }));
      lote.commit().then(() => cargar(cont)).catch(() => toast('No se pudo reordenar', 'err'));
    });
  }

  /* ---- Subir / editar una promo ---- */
  function promoModal(p, after) {
    let img = p ? p.img : '';
    modal({
      title: p ? 'Editar promo' : 'Subir promo', width: 560,
      bodyHTML: `
        <div class="note" style="margin-bottom:14px">Usá la imagen <b>vertical</b> del estado de WhatsApp (9:16).
          Se achica sola a 1080 px de alto para que no consuma datos del cliente; la proporción no se toca.</div>
        <div class="form-grid">
          <div class="field col-2"><label>Imagen</label>
            <input type="file" id="pm-file" accept="image/*"/>
            <span class="help" id="pm-info">${p ? 'Ya tiene una imagen cargada (' + kb(p.img) + ' KB). Elegí otra solo si querés reemplazarla.' : 'JPG o PNG. Se comprime sola.'}</span></div>
          <div class="field col-2" style="align-items:center">
            <div class="promo-prev" id="pm-prev" style="${img ? '' : 'display:none'}"><img id="pm-img" src="${img || ''}" alt=""/></div>
          </div>
          <div class="field col-2"><label>Título (para vos, no se muestra al cliente)</label>
            <input id="pm-tit" value="${esc(p ? (p.titulo || '') : '')}" placeholder="Ej: Promo milanesas — semana del 1/9"/></div>
          <div class="field col-2"><label>Link al tocarla (opcional)</label>
            <input id="pm-link" value="${esc(p ? (p.link || '') : '')}" placeholder="https://… — vacío = solo se agranda la imagen"/>
            <span class="help">Si lo dejás vacío, al tocarla el cliente la ve en pantalla completa. Si ponés un link, lo abre.</span></div>
          <div class="field col-2"><label style="display:flex;align-items:center;gap:8px;font-weight:600">
            <input type="checkbox" id="pm-act" ${(!p || p.activo) ? 'checked' : ''} style="width:auto;margin:0"/>
            Mostrarla en la tienda</label></div>
        </div>`,
      footHTML: `<button class="btn btn-ghost" data-cancel>Cancelar</button><button class="btn btn-primary" data-save>${p ? 'Guardar' : 'Subir promo'}</button>`,
      onMount(node, close) {
        const info = node.querySelector('#pm-info');
        const prev = node.querySelector('#pm-prev');
        const prevImg = node.querySelector('#pm-img');
        const save = node.querySelector('[data-save]');

        node.querySelector('#pm-file').onchange = async (e) => {
          const f = e.target.files && e.target.files[0];
          if (!f) return;
          info.textContent = 'Procesando la imagen…';
          save.disabled = true;
          try {
            const d = await GDO.Img.comprimir(f, MAX_LADO, CALIDAD);
            if (d.length * 0.75 > MAX_BYTES) {
              info.innerHTML = '⚠️ La imagen quedó en ' + kb(d) + ' KB, demasiado pesada. Probá con una más simple o recortada.';
              info.style.color = 'var(--rojo)';
              save.disabled = false;
              return;
            }
            img = d;
            prevImg.src = d; prev.style.display = '';
            info.innerHTML = '✓ Lista · ' + kb(d) + ' KB';
            info.style.color = '#1d7a44';
          } catch (err) {
            info.textContent = 'No se pudo procesar esa imagen.';
            info.style.color = 'var(--rojo)';
          }
          save.disabled = false;
        };

        node.querySelector('[data-cancel]').onclick = close;
        save.onclick = () => {
          if (!img) { toast('Elegí una imagen', 'err'); return; }
          const fdb = db();
          if (!fdb) { toast('Sin conexión: las promos se suben online', 'err'); return; }
          const datos = {
            img: img,
            titulo: node.querySelector('#pm-tit').value.trim(),
            link: node.querySelector('#pm-link').value.trim(),
            activo: node.querySelector('#pm-act').checked,
            orden: p ? (p.orden || 0) : cache.length,
            actualizado: Date.now(),
            por: staffUid(),
          };
          if (!p) datos.creado = Date.now();
          save.disabled = true;
          const ref = p ? fdb.collection('promos').doc(p.id) : fdb.collection('promos').doc();
          ref.set(datos, { merge: true })
            .then(() => { toast(p ? 'Promo guardada ✓' : 'Promo subida ✓', 'ok'); close(); after && after(); })
            .catch((e) => {
              save.disabled = false;
              toast(e && e.code === 'permission-denied'
                ? 'Faltan publicar las reglas de /promos en Firestore'
                : 'No se pudo guardar', 'err');
            });
        };
      },
    });
  }
})();
