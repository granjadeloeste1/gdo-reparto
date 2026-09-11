/* ====== Vistas: CÓDIGOS DE DESCUENTO ======
   · El administrador de códigos (pestaña de "Promos y descuentos").
   · "Ofrecer descuento" desde Clientes: crea un código personal y abre
     WhatsApp con el mensaje ya escrito.
   · El TICKET: la tarjeta con forma de cupón que usan las dos pantallas.
   La lógica (validar, aplicar, generar códigos, mensajes) está en
   js/descuentos.js; acá solo se dibuja. */
window.GDO = window.GDO || {}; GDO.Views = GDO.Views || {};
(function () {
  const { esc, toast, modal, confirmDlg } = GDO.UI;
  const D = () => GDO.Desc;
  const S = () => GDO.Store;
  const DIA = 86400000;

  let filtro = 'activos';

  /* ─────────────── ayudantes ─────────────── */

  function copiar(txt, okMsg) {
    const hecho = () => toast(okMsg || 'Copiado ✓', 'ok');
    const viejo = () => {
      const ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); hecho(); } catch (e) { toast('No se pudo copiar', 'err'); }
      ta.remove();
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(hecho, viejo); return; }
    } catch (e) { /* cae al método viejo */ }
    viejo();
  }
  // WhatsApp sin número (para estados o listas de difusión): el que lo manda
  // elige a quién. En la computadora va por WhatsApp Web para no perder emojis.
  function linkSinNumero(txt) {
    const t = encodeURIComponent(txt);
    return (GDO.Wpp && GDO.Wpp.esMovil && !GDO.Wpp.esMovil()) ? 'https://web.whatsapp.com/send?text=' + t : 'https://wa.me/?text=' + t;
  }
  const venceEn = (n) => D().iso(new Date(Date.now() + n * DIA));
  const finDeMes = () => { const h = new Date(); return D().iso(new Date(h.getFullYear(), h.getMonth() + 1, 0)); };
  const venDe = (k) => (k === '' ? '' : (k === 'mes' ? finDeMes() : venceEn(+k)));

  function venceTxt(d) {
    const n = D().diasParaVencer(d);
    if (n == null) return '♾️ Sin vencimiento';
    if (n < 0) return '⌛ Venció el ' + D().fmtDia(d.vence);
    if (n === 0) return '⏳ Vence hoy';
    if (n === 1) return '⏳ Vence mañana';
    return '⏳ Vence en ' + n + ' días · ' + D().fmtDia(d.vence);
  }

  /* EL TICKET. A la izquierda el % bien grande (naranja en las campañas, negro
     en los personales), una línea troquelada, y a la derecha el código —que se
     copia con un toque—, para quién es, cuándo vence y cuánto se usó. */
  function ticketHTML(d, opts) {
    opts = opts || {};
    const est = opts.preview ? 'activo' : D().estado(d);
    const us = opts.preview ? [] : D().usos(d.id);
    const plata = us.reduce((a, p) => a + (Number(p.descuento && p.descuento.monto) || 0), 0);
    const ESTADO = { pausado: '⏸ Pausado', vencido: '⌛ Vencido', usado: '✓ Ya se usó' };
    const personal = d.tipo === 'personal';
    const negro = D().colorDe(d) === 'negro';
    return `<div class="dc-wrap${est !== 'activo' ? ' off' : ''}"><div class="dc-ticket${negro ? ' negro' : ''}">
        <div class="dc-pct"><b>${esc(String(d.pct || 0))}%</b><span>OFF</span></div>
        <div class="dc-body">
          <div class="dc-h">
            <span class="dc-tipo">${personal ? '👤 Personal' : '📣 Campaña'}</span>
            ${ESTADO[est] ? `<span class="dc-est ${est}">${ESTADO[est]}</span>` : ''}
          </div>
          <div class="dc-code"${opts.preview ? '' : ` data-copy="${esc(d.id)}" title="Tocá para copiar"`}>${esc(d.id || 'CODIGO')}</div>
          <div class="dc-nom">${esc(personal ? (d.clienteNombre || 'Elegí un cliente') : (d.nombre || 'Nombre de la campaña'))}</div>
          <div class="dc-meta">
            <span>${venceTxt(d)}</span>
            <span>${d.soloEnvio ? '🚚 Solo envío a domicilio' : '🛍️ Envío o retiro en el local'}</span>
            ${opts.preview ? '' : `<span>${us.length ? '🎯 ' + us.length + ' pedido' + (us.length === 1 ? '' : 's') + (plata ? ' · ' + D().fmtM(plata) + ' descontados' : '') : '🎯 Todavía sin usar'}</span>`}
          </div>
        </div>
      </div></div>`;
  }
  GDO.Views.ticketDescuento = ticketHTML;

  // La ficha del CRM de un código personal (por su teléfono), para mandárselo.
  function fichaDe(d) {
    if (!d || !d.tel8 || !GDO.CRM) return null;
    try { return GDO.CRM.fichas().find((f) => GDO.CRM.telKey(f.telefono) === d.tel8) || null; } catch (e) { return null; }
  }

  /* ─────────────── el administrador de códigos ─────────────── */

  GDO.Views.descuentos = function (box) {
    const lista = D().todos().slice().sort((a, b) => (b.creado || 0) - (a.creado || 0));
    const est = (d) => D().estado(d);
    const G = {
      activos: { t: '✅ Activos', l: lista.filter((d) => est(d) === 'activo') },
      campanas: { t: '📣 Campañas', l: lista.filter((d) => d.tipo !== 'personal') },
      personales: { t: '👤 Personales', l: lista.filter((d) => d.tipo === 'personal') },
      terminados: { t: 'Vencidos, usados o pausados', l: lista.filter((d) => est(d) !== 'activo') },
    };
    if (!G[filtro]) filtro = 'activos';
    const vis = G[filtro].l;

    // Cuánto se movió este mes: pedidos con código y plata descontada.
    const mes = D().hoyISO().slice(0, 7);
    const delMes = (S().pedidos() || []).filter((p) => p.descuento && p.descuento.codigo && p.estado !== 'no_entregado'
      && D().iso(new Date(p.creado || p.ts || 0)).slice(0, 7) === mes);
    const plataMes = delMes.reduce((a, p) => a + (Number(p.descuento.monto) || 0), 0);

    box.innerHTML = `
      <div class="dc-hero">
        <div class="dc-hero-tx">
          <h3>🎟️ Códigos de descuento</h3>
          <p>El cliente carga el código en la tienda <b>antes de mandar el pedido</b>, o se lo cargás vos en el formulario del pedido.
            Cada cliente puede usar cada código <b>una sola vez</b>. Los personales, además, solo los puede usar su dueño.</p>
        </div>
        <div class="dc-hero-ac">
          <button class="btn btn-primary" id="dc-new-c">+ Nueva campaña</button>
          <button class="btn btn-dark" id="dc-new-p">👤 Código personal</button>
        </div>
      </div>
      <div class="dc-stats">
        <div><b>${G.activos.l.length}</b><span>códigos activos</span></div>
        <div><b>${delMes.length}</b><span>pedidos con descuento este mes</span></div>
        <div><b>${D().fmtM(plataMes)}</b><span>descontado este mes</span></div>
      </div>
      <div class="dc-chips" style="margin-bottom:16px">${Object.keys(G).map((k) =>
        `<button type="button" class="dc-chip${filtro === k ? ' on' : ''}" data-fil="${k}">${G[k].t} · ${G[k].l.length}</button>`).join('')}</div>
      ${vis.length ? `<div class="dc-grid">${vis.map((d, i) => {
        const nUsos = D().usos(d.id).length;
        return `<div class="dc-item" data-i="${i}">
          ${ticketHTML(d)}
          <div class="dc-ac">
            <button class="btn btn-ghost btn-sm" data-cp>📋 Copiar</button>
            <button class="btn btn-verde btn-sm" data-msg>💬 ${d.tipo === 'personal' ? 'Mandárselo' : 'Mensaje'}</button>
            <button class="btn btn-ghost btn-sm" data-on>${d.activo ? '⏸ Pausar' : '▶ Activar'}</button>
            <button class="btn btn-ghost btn-sm" data-ed title="Editar">✎</button>
            ${nUsos ? '' : '<button class="btn btn-ghost btn-sm" data-del title="Borrar">🗑</button>'}
          </div>
        </div>`;
      }).join('')}</div>`
      : `<div class="panel"><div class="panel-b"><div class="empty" style="padding:44px 20px">
          <div style="font-size:42px;margin-bottom:8px">🎟️</div>
          <b style="display:block;font-size:16px;color:var(--negro);margin-bottom:6px">${lista.length ? 'No hay códigos en este grupo' : 'Todavía no hay códigos'}</b>
          ${lista.length ? '' : 'Creá una <b>campaña</b> (un código para todos, con vencimiento) o un <b>código personal</b> para un cliente puntual.<br>También se generan solos desde <b>Clientes</b>, en los que <b>se están yendo</b>.'}
        </div></div></div>`}`;

    const redibujar = () => GDO.Views.descuentos(box);
    box.querySelector('#dc-new-c').onclick = () => codigoModal('campana', null, redibujar);
    box.querySelector('#dc-new-p').onclick = () => codigoModal('personal', null, redibujar);
    box.querySelectorAll('[data-fil]').forEach((b) => b.onclick = () => { filtro = b.dataset.fil; redibujar(); });
    box.querySelectorAll('[data-copy]').forEach((el) => el.onclick = () => copiar(el.dataset.copy, 'Código ' + el.dataset.copy + ' copiado ✓'));

    box.querySelectorAll('[data-i]').forEach((el) => {
      const d = vis[+el.dataset.i];
      const q = (s) => el.querySelector(s);
      q('[data-cp]').onclick = () => copiar(d.id, 'Código ' + d.id + ' copiado ✓');
      q('[data-msg]').onclick = () => enviarModal(d, d.tipo === 'personal' ? fichaDe(d) : null, redibujar);
      q('[data-on]').onclick = () => {
        D().guardar(Object.assign({}, d, { activo: !d.activo }), d);
        toast(d.activo ? 'Código ' + d.id + ' activado ✓' : 'Código ' + d.id + ' pausado', 'ok');
        redibujar();
      };
      q('[data-ed]').onclick = () => codigoModal(d.tipo, d, redibujar);
      const bd = q('[data-del]');
      // Un código que ya se usó NO se borra: los pedidos que lo tienen lo
      // necesitan para seguir mostrando su descuento. Se pausa.
      if (bd) bd.onclick = () => confirmDlg('¿Borrar el código ' + d.id + '? Deja de funcionar en la tienda y en el panel.', () => {
        S().deleteDescuento(d.id); toast('Código borrado', 'ok'); redibujar();
      });
    });
  };

  /* ─────────────── crear / editar un código ─────────────── */

  function codigoModal(tipo, d, after) {
    const edit = !!d;
    const personal = (d ? d.tipo : tipo) === 'personal';
    const st = {
      tipo: personal ? 'personal' : 'campana',
      nombre: d ? (d.nombre || '') : '',
      codigo: d ? d.id : '',
      pct: d ? d.pct : 10,
      vence: d ? (d.vence || '') : venceEn(personal ? 15 : 30),
      soloEnvio: d ? !!d.soloEnvio : true,
      color: d ? D().colorDe(d) : (personal ? 'negro' : 'naranja'),
      clienteNombre: d ? (d.clienteNombre || '') : '',
      telefono: '',
      codigoTocado: false,
    };
    modal({
      title: edit ? 'Editar el código ' + d.id : (personal ? '👤 Nuevo código personal' : '📣 Nueva campaña de descuento'), width: 600,
      bodyHTML: `
        <div class="dc-prev" id="cm-prev"></div>
        <div class="form-grid">
          ${personal ? `<div class="field col-2" style="position:relative"><label>¿Para qué cliente?</label>
              <input id="cm-cli" autocomplete="off" value="${esc(st.clienteNombre)}" placeholder="Buscalo por nombre o teléfono" ${edit ? 'disabled' : ''}/>
              <div class="crm-ac" id="cm-cli-sug"></div>
              <span class="help" id="cm-cli-info">El código queda atado a su teléfono: nadie más lo puede usar.</span></div>`
          : `<div class="field col-2"><label>Nombre de la campaña</label>
              <input id="cm-nom" value="${esc(st.nombre)}" maxlength="80" placeholder="Ej: Volvé a GDO — septiembre"/>
              <span class="help">Es para vos: el cliente ve el código y el porcentaje.</span></div>`}
          <div class="field"><label>Código</label>
            <div style="display:flex;gap:6px">
              <input id="cm-cod" class="dc-in-cod" value="${esc(st.codigo)}" maxlength="30" ${edit ? 'disabled' : ''} placeholder="${personal ? 'Se arma solo' : 'Ej: VOLVE10'}"/>
              ${!edit && personal ? '<button class="btn btn-ghost" type="button" id="cm-regen" title="Generar otro">↻</button>' : ''}
            </div>
            <span class="help">${edit ? 'El código no se puede cambiar (el cliente ya lo puede tener).' : 'Así lo escribe el cliente: solo letras, números y guiones.'}</span></div>
          <div class="field"><label>Descuento</label>
            <div class="dc-chips">${[5, 10, 15, 20, 25].map((n) => `<button type="button" class="dc-chip" data-pct="${n}">${n}%</button>`).join('')}</div>
            <input id="cm-pct" type="number" min="1" max="50" value="${esc(String(st.pct))}" style="margin-top:8px"/></div>
          <div class="field col-2"><label>Color del voucher</label>
            <div class="dc-colores">
              <button type="button" class="dc-color" data-color="naranja"><span class="sw naranja"></span>Naranja</button>
              <button type="button" class="dc-color" data-color="negro"><span class="sw negro"></span>Negro</button>
            </div></div>
          <div class="field col-2"><label>¿Hasta cuándo vale?</label>
            <div class="dc-chips">
              <button type="button" class="dc-chip" data-ven="7">7 días</button>
              <button type="button" class="dc-chip" data-ven="15">15 días</button>
              <button type="button" class="dc-chip" data-ven="30">30 días</button>
              <button type="button" class="dc-chip" data-ven="mes">Fin de mes</button>
              <button type="button" class="dc-chip" data-ven="">Sin vencimiento</button>
            </div>
            <input id="cm-ven" type="date" value="${esc(st.vence)}" style="margin-top:8px"/></div>
          <div class="field col-2"><label style="display:flex;align-items:center;gap:8px;font-weight:600">
              <input type="checkbox" id="cm-env" ${st.soloEnvio ? 'checked' : ''} style="width:auto;margin:0"/>
              Solo para pedidos con envío a domicilio</label>
            <span class="help">Si lo destildás, vale también para retirar en el local (lista mayorista).</span></div>
        </div>
        <div class="desc-msg err" id="cm-err"></div>`,
      footHTML: `<button class="btn btn-ghost" data-cancel>Cancelar</button><button class="btn btn-primary" data-save>${edit ? 'Guardar cambios' : (personal ? 'Crear código' : 'Crear campaña')}</button>`,
      onMount(node, close) {
        const $ = (s) => node.querySelector(s);
        const pintar = () => {
          $('#cm-prev').innerHTML = ticketHTML({
            id: st.codigo || (personal ? 'VOLVE-·····' : 'CODIGO'), tipo: st.tipo, pct: st.pct, nombre: st.nombre,
            clienteNombre: st.clienteNombre, vence: st.vence, soloEnvio: st.soloEnvio, activo: true, color: st.color,
          }, { preview: true });
          node.querySelectorAll('[data-pct]').forEach((b) => b.classList.toggle('on', +b.dataset.pct === +st.pct));
          node.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('on', b.dataset.color === st.color));
          node.querySelectorAll('[data-ven]').forEach((b) => b.classList.toggle('on', venDe(b.dataset.ven) === st.vence));
        };
        // En una campaña, el código se sugiere del nombre y el % mientras la
        // persona no lo haya escrito a mano.
        const sugerir = () => {
          if (edit || personal || st.codigoTocado) return;
          st.codigo = st.nombre ? D().codigoCampana(st.nombre, st.pct) : '';
          $('#cm-cod').value = st.codigo;
        };
        node.querySelectorAll('[data-pct]').forEach((b) => b.onclick = () => { st.pct = +b.dataset.pct; $('#cm-pct').value = st.pct; sugerir(); pintar(); });
        $('#cm-pct').oninput = (e) => { st.pct = +e.target.value || 0; sugerir(); pintar(); };
        node.querySelectorAll('[data-ven]').forEach((b) => b.onclick = () => { st.vence = venDe(b.dataset.ven); $('#cm-ven').value = st.vence; pintar(); });
        $('#cm-ven').onchange = (e) => { st.vence = e.target.value; pintar(); };
        $('#cm-env').onchange = (e) => { st.soloEnvio = e.target.checked; pintar(); };
        node.querySelectorAll('[data-color]').forEach((b) => b.onclick = () => { st.color = b.dataset.color; pintar(); });
        $('#cm-cod').oninput = (e) => { st.codigoTocado = true; st.codigo = D().normCodigo(e.target.value); pintar(); };
        $('#cm-cod').onblur = (e) => { e.target.value = st.codigo; };
        const nom = $('#cm-nom');
        if (nom) nom.oninput = () => { st.nombre = nom.value; sugerir(); pintar(); };
        const regen = $('#cm-regen');
        if (regen) regen.onclick = () => { st.codigo = D().codigoPersonal(st.clienteNombre || 'CLIENTE'); $('#cm-cod').value = st.codigo; pintar(); };

        // Buscador de cliente (personal): las fichas del CRM que tienen teléfono.
        const cli = $('#cm-cli');
        if (cli && !edit) {
          const sug = $('#cm-cli-sug');
          let fichas = null;
          cli.oninput = () => {
            const q = GDO.CRM ? GDO.CRM.norm(cli.value) : '';
            const dig = cli.value.replace(/\D/g, '');
            if (!fichas) { try { fichas = GDO.CRM.fichas().filter((f) => f.telefono); } catch (e) { fichas = []; } }
            const vis = (q.length < 2 && dig.length < 3) ? [] : fichas.filter((f) =>
              GDO.CRM.norm(f.nombre).indexOf(q) >= 0 || (dig.length >= 3 && String(f.telefono).replace(/\D/g, '').indexOf(dig) >= 0)).slice(0, 8);
            sug.innerHTML = vis.map((f, i) => `<button type="button" class="crm-ac-i" data-k="${i}"><b>${esc(f.nombre)}</b><span>${esc(f.telefono)} · ${f.nCompras} compra${f.nCompras === 1 ? '' : 's'}</span></button>`).join('');
            sug.classList.toggle('on', vis.length > 0);
            sug.querySelectorAll('[data-k]').forEach((b) => b.onmousedown = (e) => {
              e.preventDefault();
              const f = vis[+b.dataset.k];
              st.clienteNombre = f.nombre; st.telefono = f.telefono;
              cli.value = f.nombre; sug.classList.remove('on');
              $('#cm-cli-info').innerHTML = '✓ Queda atado al teléfono <b>' + esc(f.telefono) + '</b>.';
              st.codigo = D().codigoPersonal(f.nombre); $('#cm-cod').value = st.codigo;
              pintar();
            });
          };
          cli.onblur = () => setTimeout(() => sug.classList.remove('on'), 150);
        }
        pintar();

        $('[data-cancel]').onclick = close;
        $('[data-save]').onclick = () => {
          const err = (m) => { $('#cm-err').textContent = '⚠️ ' + m; };
          if (nom) st.nombre = nom.value.trim();
          if (!edit) st.codigo = D().normCodigo($('#cm-cod').value);
          st.pct = +$('#cm-pct').value; st.vence = $('#cm-ven').value; st.soloEnvio = $('#cm-env').checked;
          if (!edit) {
            if (!st.codigo || st.codigo.length < 4) return err('El código tiene que tener al menos 4 letras o números.');
            if (D().buscar(st.codigo)) return err('Ya existe un código ' + st.codigo + '. Elegí otro.');
            if (personal && !(GDO.CRM && GDO.CRM.telKey(st.telefono))) return err('Elegí un cliente con teléfono: el código queda atado a ese número.');
          }
          if (!personal && !st.nombre) return err('Ponele un nombre a la campaña (es para vos, para reconocerla).');
          if (!(st.pct >= 1 && st.pct <= 50)) return err('El descuento tiene que ser entre 1% y 50%.');
          if (st.vence && st.vence < D().hoyISO()) return err('La fecha de vencimiento ya pasó.');
          const doc = D().guardar({
            codigo: st.codigo, tipo: st.tipo, pct: st.pct, nombre: st.nombre, vence: st.vence, soloEnvio: st.soloEnvio,
            activo: d ? d.activo : true, clienteNombre: st.clienteNombre, telefono: st.telefono, color: st.color,
          }, d);
          toast(edit ? 'Código guardado ✓' : 'Código ' + doc.id + ' creado ✓', 'ok');
          close();
          after && after(doc);
          // Un código personal recién hecho casi siempre se manda en el momento.
          if (!edit && personal) enviarModal(doc, fichaDe(doc), after);
        };
      },
    });
  }

  /* ─────────────── mandar un código ya creado ─────────────── */

  function enviarModal(d, ficha, after) {
    const personal = d.tipo === 'personal';
    const tel = (personal && ficha && ficha.telefono && GDO.Wpp.tieneTel(ficha.telefono)) ? ficha.telefono : '';
    const texto = personal ? D().mensajeVuelta(ficha || { nombre: d.clienteNombre }, d) : D().mensajeCampana(d);
    modal({
      title: personal ? '💬 Mandarle el código a ' + (ficha ? ficha.nombre : (d.clienteNombre || 'el cliente')) : '📣 Mensaje de la campaña ' + d.id,
      width: 560,
      bodyHTML: `
        <div class="dc-prev">${ticketHTML(d, { preview: true })}</div>
        <div class="field"><label>Mensaje (podés editarlo)</label><textarea id="em-msg" rows="10">${esc(texto)}</textarea></div>
        <div class="help">${personal
          ? (tel ? 'Se abre WhatsApp con el mensaje listo; vos tocás <b>Enviar</b>. Queda anotado en la ficha del cliente.'
            : 'No encuentro el teléfono de este cliente: copiá el mensaje y mandáselo por donde puedas.')
          : 'Para estados de WhatsApp, listas de difusión o redes: copialo, o abrí WhatsApp y elegí a quién mandarlo.'}</div>`,
      footHTML: `<button class="btn btn-ghost" data-cancel>Cerrar</button><button class="btn btn-ghost" data-copy-msg>📋 Copiar mensaje</button>${(!personal || tel) ? '<a class="btn btn-verde" data-send target="_blank" rel="noopener">💬 Abrir WhatsApp</a>' : ''}`,
      onMount(node, close) {
        const ta = node.querySelector('#em-msg');
        const send = node.querySelector('[data-send]');
        const refresh = () => { if (send) send.href = tel ? GDO.Wpp.link(tel, ta.value) : linkSinNumero(ta.value); };
        ta.oninput = refresh; refresh();
        node.querySelector('[data-cancel]').onclick = close;
        node.querySelector('[data-copy-msg]').onclick = () => copiar(ta.value, 'Mensaje copiado ✓');
        if (send) send.onclick = () => {
          if (personal && ficha && GDO.CRM) {
            GDO.CRM.registrarContacto(ficha, { canal: 'whatsapp', resultado: 'enviado',
              nota: 'Se le mandó el código ' + d.id + ' (' + d.pct + '% de descuento).', motivoAviso: 'Código de descuento' }, 'descuento');
          }
          setTimeout(() => { close(); after && after(); }, 400);
        };
      },
    });
  }

  /* ─────────────── "🎁 Ofrecer descuento" (desde Clientes) ───────────────
     El caso para el que se pensó todo esto: el cliente que se está yendo. En
     un solo paso se crea su código personal (o se usa una campaña activa), se
     arma el mensaje y se abre WhatsApp. Queda anotado en su ficha. Si ya tenía
     un código personal sin usar, se le vuelve a mandar ese: no se le hace otro. */
  GDO.Views.ofrecerDescuento = function (ficha, after, sug) {
    const tel = (ficha.telefono && GDO.Wpp.tieneTel(ficha.telefono)) ? ficha.telefono : '';
    const t8 = GDO.CRM ? GDO.CRM.telKey(ficha.telefono) : '';
    const ctx = { telefono: ficha.telefono, modalidad: 'envio' };
    const camps = D().todos().filter((d) => d.tipo !== 'personal' && D().estado(d) === 'activo' && D().validar(d.id, ctx).ok);
    const propio = t8 ? (D().todos().filter((d) => d.tipo === 'personal' && d.tel8 === t8 && D().estado(d) === 'activo')[0] || null) : null;
    const st = {
      modo: 'personal', pct: 10, venK: '15', soloEnvio: true, color: 'negro',
      camp: camps[0] ? camps[0].id : '',
      codigo: D().codigoPersonal(ficha.nombre),
    };
    // El código que se va a mandar, según lo elegido.
    const actual = () => {
      if (st.modo === 'campana') return D().buscar(st.camp);
      if (propio) return propio;
      return { id: st.codigo, tipo: 'personal', pct: st.pct, vence: venDe(st.venK), soloEnvio: st.soloEnvio, clienteNombre: ficha.nombre, activo: true, color: st.color };
    };

    modal({
      title: '🎁 Ofrecerle un descuento a ' + ficha.nombre, width: 600,
      bodyHTML: `
        ${sug && sug.motivo ? `<div class="note" style="margin-bottom:14px">${esc(sug.ic || '😴')} <b>${esc(sug.titulo)}</b> — ${esc(sug.motivo)}</div>` : ''}
        <div class="modsel" id="of-modo">
          <button type="button" data-modo="personal">👤 ${propio ? 'Su código personal' : 'Código personal nuevo'}</button>
          <button type="button" data-modo="campana"${camps.length ? '' : ' disabled title="No hay campañas activas que este cliente pueda usar"'}>📣 Una campaña activa</button>
        </div>
        <div id="of-opts" style="margin-top:14px"></div>
        <div class="dc-prev" id="of-prev"></div>
        <div class="field"><label>Mensaje (podés editarlo)</label><textarea id="of-msg" rows="10"></textarea></div>
        <div class="help">${tel
          ? 'Al tocar el botón verde ' + (propio ? '' : 'se crea el código, ') + 'se abre WhatsApp con el mensaje listo y queda anotado en la ficha. Si cambiás las opciones, el mensaje se vuelve a armar.'
          : '⚠️ Este cliente no tiene teléfono cargado: el código se crea igual y copiás el mensaje para mandárselo por otro lado.'}</div>`,
      footHTML: `<button class="btn btn-ghost" data-cancel>Cancelar</button>
        ${tel ? '<a class="btn btn-verde" data-send target="_blank" rel="noopener"></a>' : '<button class="btn btn-primary" data-copy-msg>📋 Crear código y copiar mensaje</button>'}`,
      onMount(node, close) {
        const $ = (s) => node.querySelector(s);
        const ta = $('#of-msg');
        const send = $('[data-send]');
        const refrescarLink = () => { if (send) send.href = GDO.Wpp.link(tel, ta.value); };

        const pintarOpts = () => {
          node.querySelectorAll('#of-modo [data-modo]').forEach((b) => b.classList.toggle('on', b.dataset.modo === st.modo));
          const box = $('#of-opts');
          if (st.modo === 'campana') {
            box.innerHTML = `<div class="field"><label>¿Qué campaña?</label>
              <select id="of-camp">${camps.map((d) => `<option value="${esc(d.id)}"${d.id === st.camp ? ' selected' : ''}>${esc(d.id)} · ${d.pct}% · ${esc(d.nombre || '')}</option>`).join('')}</select></div>`;
            $('#of-camp').onchange = (e) => { st.camp = e.target.value; pintar(); };
          } else if (propio) {
            box.innerHTML = `<div class="note">Ya tiene el código <b>${esc(propio.id)}</b> (${propio.pct}%) sin usar: se lo volvemos a mandar. No se crea otro.</div>`;
          } else {
            box.innerHTML = `<div class="form-grid">
              <div class="field"><label>Descuento</label>
                <div class="dc-chips">${[5, 10, 15, 20].map((n) => `<button type="button" class="dc-chip${st.pct === n ? ' on' : ''}" data-pct="${n}">${n}%</button>`).join('')}</div></div>
              <div class="field"><label>Vale por</label>
                <div class="dc-chips">${[['7', '7 días'], ['15', '15 días'], ['30', '30 días']].map((v) => `<button type="button" class="dc-chip${st.venK === v[0] ? ' on' : ''}" data-ven="${v[0]}">${v[1]}</button>`).join('')}</div></div>
              <div class="field col-2"><label>Color del voucher</label>
                <div class="dc-colores">${[['naranja', 'Naranja'], ['negro', 'Negro']].map((c) => `<button type="button" class="dc-color${st.color === c[0] ? ' on' : ''}" data-color="${c[0]}"><span class="sw ${c[0]}"></span>${c[1]}</button>`).join('')}</div></div>
              <div class="field col-2"><label style="display:flex;align-items:center;gap:8px;font-weight:600">
                <input type="checkbox" id="of-env" ${st.soloEnvio ? 'checked' : ''} style="width:auto;margin:0"/> Solo para pedidos con envío a domicilio</label></div>
            </div>`;
            box.querySelectorAll('[data-pct]').forEach((b) => b.onclick = () => { st.pct = +b.dataset.pct; pintarOpts(); pintar(); });
            box.querySelectorAll('[data-ven]').forEach((b) => b.onclick = () => { st.venK = b.dataset.ven; pintarOpts(); pintar(); });
            box.querySelectorAll('[data-color]').forEach((b) => b.onclick = () => { st.color = b.dataset.color; pintarOpts(); pintar(); });
            $('#of-env').onchange = (e) => { st.soloEnvio = e.target.checked; pintar(); };
          }
        };
        const pintar = () => {
          const d = actual();
          if (!d) return;
          $('#of-prev').innerHTML = ticketHTML(d, { preview: true });
          ta.value = D().mensajeVuelta(ficha, d);
          if (send) send.innerHTML = '💬 ' + (st.modo === 'personal' && !propio ? 'Crear código y abrir WhatsApp' : 'Abrir WhatsApp');
          refrescarLink();
        };
        ta.oninput = refrescarLink;
        node.querySelectorAll('#of-modo [data-modo]').forEach((b) => b.onclick = () => {
          if (b.disabled) return;
          st.modo = b.dataset.modo; pintarOpts(); pintar();
        });
        pintarOpts(); pintar();

        // Crea el código (si hace falta) y lo anota en la ficha. Se hace al
        // tocar el botón: si la persona cancela, no queda ningún código suelto.
        const confirmar = () => {
          let d = actual();
          if (st.modo === 'personal' && !propio) {
            d = D().guardar({ codigo: st.codigo, tipo: 'personal', pct: st.pct, vence: venDe(st.venK), soloEnvio: st.soloEnvio, color: st.color,
              nombre: 'Volvé a Granja del Oeste', clienteNombre: ficha.nombre, telefono: ficha.telefono });
          }
          if (GDO.CRM) {
            GDO.CRM.registrarContacto(ficha, { canal: tel ? 'whatsapp' : 'otro', resultado: 'enviado',
              nota: 'Se le ofreció el código ' + d.id + ' (' + d.pct + '% de descuento).', motivoAviso: 'Código de descuento' }, 'descuento');
          }
          return d;
        };
        $('[data-cancel]').onclick = close;
        if (send) send.onclick = () => {
          const d = confirmar();
          toast('Código ' + d.id + ' listo · quedó anotado en la ficha', 'ok');
          setTimeout(() => { close(); after && after(); }, 400);
        };
        const bc = $('[data-copy-msg]');
        if (bc) bc.onclick = () => {
          const d = confirmar();
          copiar(ta.value, 'Código ' + d.id + ' creado · mensaje copiado ✓');
          close(); after && after();
        };
      },
    });
  };
})();
