/* ====== Vistas: CLIENTES (CRM) ======
   Dos pantallas en una:
   · "Para hacer hoy" → la agenda de contacto. Lo que el motor de js/crm.js
     detectó solo: a quién llamar, por qué, y qué ofrecerle. Con el mensaje de
     WhatsApp ya escrito.
   · "Todos los clientes" → el listado + la ficha de cada uno (historial, ritmo
     de compra, productos, notas y recordatorios).
   Nada de esto se carga a mano: sale de los pedidos que ya existen. */
window.GDO = window.GDO || {}; GDO.Views = GDO.Views || {};
(function () {
  const { Store } = GDO;
  const { esc, h, toast, modal, confirmDlg, fmtFecha, ESTADO_CHIP } = GDO.UI;
  const CRM = () => GDO.CRM;

  const fmtM = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
  const fmtD = (ts) => (ts ? new Date(ts).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
  const hoyISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const enDias = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  // Estado de la pantalla (vive mientras no se cambie de sección).
  let tab = 'hoy';
  let filtro = '';
  let filtroTipo = '';

  /* ─────────────────────────── pantalla ─────────────────────────── */

  GDO.Views.clientes = function (c) {
    const fichas = CRM().fichas();
    const part = CRM().agendaPartida(fichas);   // { hoy, luego } — una tarjeta por cliente
    const sugs = part.hoy;
    const huerfanos = CRM().sinFecha();         // pedidos que no se pueden ubicar en el tiempo
    const dobles = CRM().posiblesDuplicados(fichas);  // fichas que serían el mismo cliente

    // Todo lo hablado con todos los clientes, del más nuevo al más viejo. Es la
    // vista que responde "¿qué hizo el vendedor esta semana?" sin preguntarle.
    const cts = [];
    fichas.forEach((f) => (f.contactos || []).forEach((ct) => cts.push({ ct: ct, f: f })));
    cts.sort((a, b) => b.ct.ts - a.ct.ts);
    const totalCts = cts.length;

    // Los indicadores cuentan la historia del negocio, no el estado de la app:
    // cuántos repiten (la base real), cuántos vinieron una sola vez (la
    // oportunidad más grande) y cuántos se están yendo (lo que se pierde hoy).
    const conCompras = fichas.filter((f) => f.nCompras > 0);
    const repiten = conCompras.filter((f) => f.nCompras >= 2);
    const unaVez = conCompras.length - repiten.length;
    const dormidos = conCompras.filter((f) => CRM().dormido(f)).length;

    c.innerHTML = `
      <div class="cards" style="margin-bottom:20px">
        <div class="card kpi naranja"><span class="ic">📇</span><span class="num">${conCompras.length}</span><span class="lbl">Clientes con compras</span></div>
        <div class="card kpi negro"><span class="ic">🔁</span><span class="num">${repiten.length}</span><span class="lbl">Repiten (2 compras o más)</span></div>
        <div class="card kpi amarillo"><span class="ic">🌱</span><span class="num">${unaVez}</span><span class="lbl">Compraron una sola vez</span></div>
        <div class="card kpi rojo"><span class="ic">😴</span><span class="num">${dormidos}</span><span class="lbl">Se están yendo</span></div>
      </div>

      ${dobles.length ? `<div class="note" id="crm-dobles" style="cursor:pointer;background:#eef4ff;border-color:#c3d6f5;color:#1e3d78">
        🔍 Hay <b>${dobles.length} cliente${dobles.length === 1 ? '' : 's'} que podría${dobles.length === 1 ? '' : 'n'} estar cargado${dobles.length === 1 ? '' : 's'} dos veces</b> (mismo nombre o misma dirección, con teléfonos distintos).
        Si son el mismo, al unirlos se le junta el historial y recién ahí se ve que repitió. <b>Tocá acá para revisarlos.</b>
      </div>` : ''}

      ${huerfanos.length ? `<div class="note" id="crm-huerf" style="cursor:pointer">
        ⚠️ Hay <b>${huerfanos.length} pedido${huerfanos.length === 1 ? '' : 's'} sin fecha</b> (se cargaron sin fecha de entrega y nunca se despacharon).
        No cuentan para el historial ni para el ritmo de compra. <b>Tocá acá para verlos y completarlos.</b>
      </div>` : ''}

      <div class="crm-tabs">
        <button class="crm-tab ${tab === 'hoy' ? 'on' : ''}" data-tab="hoy">📞 Para hacer hoy${sugs.length ? ' <span class="crm-badge">' + sugs.length + '</span>' : ''}</button>
        <button class="crm-tab ${tab === 'lista' ? 'on' : ''}" data-tab="lista">📇 Todos los clientes <span class="crm-badge sec">${fichas.length}</span></button>
        <button class="crm-tab ${tab === 'contactos' ? 'on' : ''}" data-tab="contactos">📋 Qué se habló${totalCts ? ' <span class="crm-badge sec">' + totalCts + '</span>' : ''}</button>
      </div>
      <div id="crm-body"></div>`;

    c.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; GDO.Views.clientes(c); });
    const hb = c.querySelector('#crm-huerf');
    if (hb) hb.onclick = () => sinFechaModal(huerfanos, () => GDO.Views.clientes(c));
    const db = c.querySelector('#crm-dobles');
    if (db) db.onclick = () => duplicadosModal(dobles, () => GDO.Views.clientes(c));

    const body = c.querySelector('#crm-body');
    if (tab === 'hoy') renderAgenda(body, part, c);
    else if (tab === 'contactos') renderContactos(body, cts, c);
    else renderLista(body, fichas, c);
  };

  const recargar = (cont) => GDO.Views.clientes(cont);

  /* ─────────────────────── "Para hacer hoy" ─────────────────────── */

  let verTodoHoy = false, verTodoLuego = false;
  const TOPE = 10;   // una agenda de más de 10 llamados no se hace: no se mira

  function renderAgenda(box, part, cont) {
    const hoy = part.hoy, luego = part.luego;
    const todas = hoy.concat(luego);

    if (!todas.length) {
      box.innerHTML = `<div class="panel"><div class="panel-b">
        <div class="empty" style="padding:44px 20px">
          <div style="font-size:38px;margin-bottom:8px">✅</div>
          <b style="display:block;font-size:16px;color:var(--negro);margin-bottom:6px">No hay nada pendiente</b>
          Ningún cliente está atrasado con su pedido y no quedan recordatorios para hoy.<br>
          A medida que se carguen pedidos, acá van a aparecer solos los avisos.
        </div></div></div>`;
      return;
    }

    const hoyVis = verTodoHoy ? hoy : hoy.slice(0, TOPE);
    const luegoVis = verTodoLuego ? luego : luego.slice(0, TOPE);

    box.innerHTML = `
      <div class="note">Esta lista se arma <b>sola</b> con los pedidos ya cargados: ritmo de compra de cada cliente, qué dejó de llevar y qué nunca probó. Tocá <b>WhatsApp</b> y el mensaje ya sale escrito (podés editarlo antes de enviar).</div>

      <div class="crm-sec">
        <h3>📞 Hoy${hoy.length ? ' · ' + hoy.length : ''}</h3>
        <p>Clientes que <b>ya te venían comprando</b> y algo cambió. Es lo que se pierde si nadie llama.</p>
      </div>
      ${hoy.length
        ? `<div class="crm-sugs">${hoyVis.map((s, i) => tarjeta(s, i, 'h')).join('')}</div>
           ${hoy.length > TOPE ? `<button class="btn btn-ghost btn-block" data-mas="hoy" style="margin-bottom:20px">${verTodoHoy ? 'Mostrar solo los ' + TOPE + ' primeros' : 'Ver los ' + (hoy.length - TOPE) + ' restantes'}</button>` : ''}`
        : `<div class="panel"><div class="panel-b"><div class="empty" style="padding:26px 20px">
             <b style="color:var(--negro)">Nada urgente hoy</b><br>Ningún cliente que compra seguido está atrasado.
           </div></div></div>`}

      ${luego.length ? `
      <div class="crm-sec">
        <h3>🌱 Para cuando tengas un rato · ${luego.length}</h3>
        <p>Sobre todo <b>primeras compras que nunca repitieron</b>. Vale mucho recuperarlas, pero es una tanda para hacer de a poco — no algo de hoy.</p>
      </div>
      <div class="crm-sugs">${luegoVis.map((s, i) => tarjeta(s, i, 'l')).join('')}</div>
      ${luego.length > TOPE ? `<button class="btn btn-ghost btn-block" data-mas="luego">${verTodoLuego ? 'Mostrar solo los ' + TOPE + ' primeros' : 'Ver los ' + (luego.length - TOPE) + ' restantes'}</button>` : ''}
      ` : ''}`;

    box.querySelectorAll('[data-mas]').forEach((b) => b.onclick = () => {
      if (b.dataset.mas === 'hoy') verTodoHoy = !verTodoHoy; else verTodoLuego = !verTodoLuego;
      recargar(cont);
    });

    box.querySelectorAll('[data-sug]').forEach((el) => {
      const ref = el.dataset.sug;
      const s = (ref[0] === 'h' ? hoyVis : luegoVis)[+ref.slice(1)];
      const q = (sel) => el.querySelector(sel);
      const bw = q('[data-wsp]'); if (bw) bw.onclick = () => mensajeModal(s, () => recargar(cont));
      const bo = q('[data-ok]'); if (bo) bo.onclick = () => contactoModal(s.ficha, s, () => recargar(cont));
      const bp = q('[data-snz]'); if (bp) bp.onclick = () => posponerModal(s, () => recargar(cont));
      const bf = q('[data-ficha]'); if (bf) bf.onclick = () => fichaModal(s.ficha.id, () => recargar(cont));
    });
  }

  // Qué ofrecerle: lo del motivo principal más lo que aporten los otros avisos
  // del mismo cliente (sin repetir), para que el llamado sea uno solo.
  function ofertaDe(s) {
    const vistos = {};
    const add = (txt) => String(txt || '').split(',').map((x) => x.trim()).filter(Boolean)
      .forEach((x) => { if (!vistos[x.toLowerCase()]) vistos[x.toLowerCase()] = x; });
    add(s.oferta);
    (s.otras || []).forEach((o) => add(o.oferta));
    return Object.keys(vistos).map((k) => vistos[k]).slice(0, 4).join(', ');
  }

  function tarjeta(s, i, pref) {
    const f = s.ficha;
    const tel = f.telefono && GDO.Wpp.tieneTel(f.telefono);
    return `
      <div class="crm-sug prio-${s.prio >= 90 ? 'alta' : (s.prio >= 65 ? 'media' : 'baja')}" data-sug="${(pref || '') + i}">
        <div class="crm-sug-ic">${s.ic}</div>
        <div class="crm-sug-tx">
          <div class="crm-sug-h">
            <b>${esc(f.nombre)}</b>
            <span class="chip ${f.tipoChip}">${esc(f.tipoLabel)}</span>
            ${f.socio ? '<span class="chip chip-socio">⭐ Socio</span>' : ''}
          </div>
          <div class="crm-sug-t">${esc(s.titulo)}</div>
          <div class="crm-sug-m">${esc(s.motivo)}</div>
          ${(s.otras && s.otras.length) ? `<div class="crm-sug-mas">${s.otras.map((o) => o.ic + ' ' + esc(o.titulo)).join(' · ')}</div>` : ''}
          ${ofertaDe(s) ? `<div class="crm-sug-o"><b>Ofrecele:</b> ${esc(ofertaDe(s))}</div>` : ''}
        </div>
        <div class="crm-sug-ac">
          ${tel ? '<button class="btn btn-verde btn-sm" data-wsp>💬 WhatsApp</button>' : '<span class="help">Sin teléfono</span>'}
          <button class="btn btn-ghost btn-sm" data-ok>✓ Ya lo contacté…</button>
          <button class="btn btn-ghost btn-sm" data-snz>🕓 Más adelante</button>
          <button class="btn btn-ghost btn-sm" data-ficha>Ver ficha</button>
        </div>
      </div>`;
  }

  /* Mensaje de WhatsApp: se abre editable. Igual que en pedidos, la app NO envía
     nada sola — abre WhatsApp con el texto puesto y la persona toca Enviar. */
  function mensajeModal(s, after) {
    const f = s.ficha;
    modal({
      title: 'Escribirle a ' + f.nombre, width: 540,
      bodyHTML: `
        <div class="note" style="margin-bottom:12px">${esc(s.titulo)} — ${esc(s.motivo)}</div>
        <div class="field"><label>Mensaje (podés editarlo)</label>
          <textarea id="m-msg" rows="7">${esc(s.msg)}</textarea></div>
        <div class="help">Se abre WhatsApp con el mensaje listo. Vos tocás <b>Enviar</b> allá. Al salir queda anotado que lo contactaste y no te lo vuelve a sugerir por unos días.</div>`,
      footHTML: `<button class="btn btn-ghost" data-cancel>Cancelar</button><a class="btn btn-verde" data-send target="_blank">💬 Abrir WhatsApp</a>`,
      onMount(node, close) {
        const ta = node.querySelector('#m-msg');
        const send = node.querySelector('[data-send]');
        const refresh = () => { send.href = GDO.Wpp.link(f.telefono, ta.value); };
        ta.oninput = refresh; refresh();
        node.querySelector('[data-cancel]').onclick = close;
        // Abrir WhatsApp ya deja registrado el contacto (canal WhatsApp, "mensaje
        // enviado"). Lo que contestó se agrega después desde la ficha, cuando se
        // sepa: obligar a completar un formulario acá frenaría el envío.
        send.onclick = () => {
          CRM().marcarContactado(f, s.tipo, 'whatsapp');
          toast('Mensaje enviado · queda registrado en la ficha', 'ok');
          setTimeout(() => { close(); after && after(); }, 400);
        };
      },
    });
  }

  function posponerModal(s, after) {
    modal({
      title: 'Recordármelo más adelante', width: 420,
      bodyHTML: `
        <p style="margin:0 0 12px;font-size:15px">${esc(s.ficha.nombre)} — ${esc(s.titulo)}</p>
        <div class="field"><label>Volver a avisarme en</label>
          <select id="p-dias">
            <option value="3">3 días</option>
            <option value="7" selected>1 semana</option>
            <option value="15">15 días</option>
            <option value="30">1 mes</option>
          </select></div>`,
      footHTML: `<button class="btn btn-ghost" data-cancel>Cancelar</button><button class="btn btn-primary" data-ok>Posponer</button>`,
      onMount(node, close) {
        node.querySelector('[data-cancel]').onclick = close;
        node.querySelector('[data-ok]').onclick = () => {
          CRM().posponer(s.ficha, s.tipo, +node.querySelector('#p-dias').value);
          close(); toast('Listo, te aviso más adelante', 'ok'); after && after();
        };
      },
    });
  }

  /* ─────────────────────── "Qué se habló" ───────────────────────
     Todo lo registrado con todos los clientes, del más nuevo al más viejo, con
     quién lo hizo. Es la vista para el dueño: sin esto, saber qué hizo un
     vendedor implica preguntarle. Se puede filtrar por persona. */
  let filtroPor = '';

  function renderContactos(box, cts, cont) {
    if (!cts.length) {
      box.innerHTML = `<div class="panel"><div class="panel-b"><div class="empty" style="padding:40px 20px">
        <div style="font-size:34px;margin-bottom:8px">📋</div>
        <b style="display:block;font-size:16px;color:var(--negro);margin-bottom:6px">Todavía no hay contactos registrados</b>
        Cada vez que alguien toque <b>WhatsApp</b> o <b>Ya lo contacté…</b> en la lista de hoy, va a quedar acá:
        con quién habló, por dónde, en qué quedaron y qué dijo el cliente.
      </div></div></div>`;
      return;
    }
    const personas = [];
    cts.forEach((x) => { const n = x.ct.porNombre || '—'; if (personas.indexOf(n) < 0) personas.push(n); });

    box.innerHTML = `
      <div class="toolbar">
        <select id="ct-por" style="max-width:240px">
          <option value="">Todo el equipo</option>
          ${personas.map((n) => `<option value="${esc(n)}"${filtroPor === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}
        </select>
        <div class="spacer"></div>
        <span class="help" id="ct-n"></span>
      </div>
      <div class="panel"><div class="panel-b"><div id="ct-lista"></div></div></div>`;

    const draw = () => {
      const list = (filtroPor ? cts.filter((x) => (x.ct.porNombre || '—') === filtroPor) : cts).slice(0, 200);
      box.querySelector('#ct-n').textContent = list.length + ' de ' + cts.length;
      box.querySelector('#ct-lista').innerHTML = list.length
        ? '<div class="crm-cts">' + list.map((x) => `<div data-ficha="${esc(x.f.id)}" style="cursor:pointer">${lineaContacto(x.ct, x.f.nombre)}</div>`).join('') + '</div>'
        : '<div class="empty">Sin contactos de esa persona.</div>';
      box.querySelectorAll('[data-ficha]').forEach((el) => el.onclick = () => fichaModal(el.dataset.ficha, () => recargar(cont)));
    };
    draw();
    box.querySelector('#ct-por').onchange = (e) => { filtroPor = e.target.value; draw(); };
  }

  /* ───────────────────── "Todos los clientes" ───────────────────── */

  function renderLista(box, fichas, cont) {
    box.innerHTML = `
      <div class="toolbar">
        <input type="search" id="cl-q" placeholder="Buscar por nombre, teléfono o dirección…" value="${esc(filtro)}"/>
        <select id="cl-tipo" style="max-width:200px">
          <option value="">Todos los tipos</option>
          <option value="revendedor">Revendedor</option>
          <option value="volumen">Consumidor volumen</option>
          <option value="plumanegra">Pluma Negra</option>
          <option value="_sin">Sin clasificar</option>
        </select>
        <div class="spacer"></div>
        <span class="help" id="cl-n"></span>
      </div>
      <div class="panel"><div class="panel-b flush"><div id="cl-tabla"></div></div></div>`;

    const sel = box.querySelector('#cl-tipo');
    sel.value = filtroTipo;

    const draw = () => {
      const q = CRM().norm(filtro);
      const qDig = String(filtro || '').replace(/\D/g, '');
      const list = fichas.filter((f) => {
        if (filtroTipo === '_sin' && f.tipo) return false;
        if (filtroTipo && filtroTipo !== '_sin' && f.tipo !== filtroTipo) return false;
        if (!q) return true;
        const texto = CRM().norm(f.nombre + ' ' + f.direccion + ' ' + f.localidad);
        if (texto.indexOf(q) >= 0) return true;
        // Buscar por teléfono: comparamos solo dígitos, así da igual cómo esté escrito.
        return qDig.length >= 3 && String(f.telefono || '').replace(/\D/g, '').indexOf(qDig) >= 0;
      });
      box.querySelector('#cl-n').textContent = list.length + ' de ' + fichas.length;
      box.querySelector('#cl-tabla').innerHTML = list.length ? `<table><thead><tr>
          <th>Cliente</th><th>Tipo</th><th>Compras</th><th>Ritmo</th><th>Última</th><th>Total</th><th></th>
        </tr></thead><tbody>
        ${list.map((f) => {
          const alerta = CRM().dormido(f);
          return `<tr data-f="${esc(f.id)}" style="cursor:pointer">
            <td><b>${esc(f.nombre)}</b>${f.socio ? ' ⭐' : ''}<div class="small">${esc(f.direccion || 'Sin dirección')}</div></td>
            <td><span class="chip ${f.tipoChip}">${esc(f.tipoLabel)}</span></td>
            <td>${f.nCompras}</td>
            <td>${f.ritmo != null ? 'cada ' + f.ritmo + ' d' : '<span class="help">—</span>'}</td>
            <td class="${alerta ? 'crm-alerta' : ''}">${fmtD(f.ultima)}${f.diasDesde != null ? '<div class="small">hace ' + f.diasDesde + ' d</div>' : ''}</td>
            <td>${f.total ? fmtM(f.total) : '<span class="help">—</span>'}</td>
            <td style="text-align:right"><button class="btn btn-ghost btn-sm" data-ver="${esc(f.id)}">Ficha</button></td>
          </tr>`;
        }).join('')}
        </tbody></table>` : '<div class="empty">No hay clientes que coincidan con la búsqueda.</div>';

      box.querySelectorAll('[data-f]').forEach((tr) => tr.onclick = () => fichaModal(tr.dataset.f, () => recargar(cont)));
    };
    draw();

    const inp = box.querySelector('#cl-q');
    inp.oninput = () => { filtro = inp.value; draw(); };
    sel.onchange = () => { filtroTipo = sel.value; draw(); };
  }

  /* ───────────────────────────── ficha ───────────────────────────── */

  function buscarFicha(id) { return CRM().fichas().filter((f) => f.id === id)[0] || null; }

  function fichaModal(id, after) {
    const f = buscarFicha(id);
    if (!f) { toast('No se encontró el cliente', 'err'); return; }
    const compras = f._compras.slice().reverse();
    const tel = f.telefono && GDO.Wpp.tieneTel(f.telefono);

    modal({
      title: f.nombre, width: 720,
      bodyHTML: `
        <div class="crm-ficha-kpi">
          <div><span class="n">${f.nCompras}</span><span class="l">compras</span></div>
          <div><span class="n">${f.ritmo != null ? f.ritmo + ' d' : '—'}</span><span class="l">cada</span></div>
          <div><span class="n">${f.diasDesde != null ? f.diasDesde + ' d' : '—'}</span><span class="l">desde la última</span></div>
          <div><span class="n">${f.ticket ? fmtM(f.ticket) : '—'}</span><span class="l">pedido promedio</span></div>
          <div><span class="n">${f.total ? fmtM(f.total) : '—'}</span><span class="l">total comprado</span></div>
        </div>

        <div class="form-grid" style="margin-top:16px">
          <div class="field"><label>Tipo de cliente</label>
            <select id="fi-tipo">
              <option value=""${!f.tipo ? ' selected' : ''}>Sin clasificar</option>
              <option value="revendedor"${f.tipo === 'revendedor' ? ' selected' : ''}>Revendedor</option>
              <option value="volumen"${f.tipo === 'volumen' ? ' selected' : ''}>Consumidor volumen</option>
              <option value="plumanegra"${f.tipo === 'plumanegra' ? ' selected' : ''}>Pluma Negra</option>
            </select>
            <span class="help">Sirve para saber qué ofrecerle: la app compara a cada cliente con los del mismo tipo.</span></div>
          <div class="field"><label>Teléfono</label><input id="fi-tel" value="${esc(f.telefono)}" placeholder="11 5555-5555"/></div>
          <div class="field col-2"><label>Dirección</label><input id="fi-dir" value="${esc(f.direccion)}" placeholder="Calle 1234, Localidad"/></div>

          <div class="field"><label>🔔 Recordarme contactarlo el</label>
            <input id="fi-rfec" type="date" value="${esc(f.recordatorio ? f.recordatorio.fecha : '')}"/>
            <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
              <button class="btn btn-ghost btn-sm" data-rec="0" type="button">Hoy</button>
              <button class="btn btn-ghost btn-sm" data-rec="7" type="button">En 1 semana</button>
              <button class="btn btn-ghost btn-sm" data-rec="30" type="button">En 1 mes</button>
            </div></div>
          <div class="field"><label>Motivo del recordatorio</label>
            <input id="fi-rmot" value="${esc(f.recordatorio ? (f.recordatorio.motivo || '') : '')}" placeholder="Ej: pasarle precio de 50 kg de milanesa"/></div>

          <div class="field col-2"><label>Notas del cliente</label>
            <textarea id="fi-notas" rows="3" placeholder="Lo que conviene recordar: quién atiende, cómo paga, qué le importa, acuerdos…">${esc(f.notas)}</textarea></div>

          <div class="field col-2">
            <label style="display:flex;align-items:center;gap:8px;font-weight:600">
              <input type="checkbox" id="fi-pausa" ${f.pausado ? 'checked' : ''} style="width:auto;margin:0"/>
              No sugerirme contactar a este cliente
            </label>
            <span class="help">Para clientes que ya no compran o que atiende otra persona. Sigue apareciendo en la lista, pero no en “Para hacer hoy”.</span></div>
        </div>

        ${(f.alias.length > 1 || f.telefonos.length > 1 || f.direcciones.length > 1) ? `
        <div class="crm-bloque">
          <h4>Cómo se unificó</h4>
          <div class="help" style="margin-bottom:8px">Esta ficha junta <b>${f.pedidos.length} pedidos</b> que estaban cargados con datos distintos. La app los reconoció por el teléfono, la dirección o el nombre.</div>
          ${f.alias.length > 1 ? `<div class="crm-union"><b>Nombres:</b> ${f.alias.map((x) => '<span>' + esc(x) + '</span>').join('')}</div>` : ''}
          ${f.telefonos.length > 1 ? `<div class="crm-union"><b>Teléfonos:</b> ${f.telefonos.map((x) => '<span>' + esc(x) + '</span>').join('')}</div>` : ''}
          ${f.direcciones.length > 1 ? `<div class="crm-union"><b>Direcciones:</b> ${f.direcciones.map((x) => '<span>' + esc(x) + '</span>').join('')}</div>` : ''}
        </div>` : ''}

        ${f.productos.length ? `
        <div class="crm-bloque">
          <h4>Qué compra</h4>
          <div class="crm-prods">${f.productos.slice(0, 12).map((p) => `
            <span class="crm-prod${f.habituales.indexOf(p) >= 0 ? ' hab' : ''}" title="En ${p.n} de sus ${f.nCompras} compras">${esc(p.nombre)} <b>×${p.n}</b></span>`).join('')}</div>
          <div class="help" style="margin-top:8px">En <b>naranja</b>, lo que lleva siempre: eso es lo que hay que ofrecerle sin preguntar.</div>
        </div>` : ''}

        <div class="crm-bloque">
          <h4>Contactos (${f.contactos.length})</h4>
          ${f.contactos.length
            ? '<div class="crm-cts">' + f.contactos.slice(0, 25).map((ct) => lineaContacto(ct)).join('') + '</div>'
            : '<div class="help">Todavía no se registró ningún contacto con este cliente.</div>'}
          <button class="btn btn-ghost btn-sm" data-ct style="margin-top:10px">+ Registrar un contacto</button>
        </div>

        <div class="crm-bloque">
          <h4>Historial de pedidos (${compras.length})</h4>
          ${compras.length ? `<table class="crm-hist"><tbody>${compras.slice(0, 30).map((c) => `
            <tr data-ped="${esc(c.p.id)}" style="cursor:pointer">
              <td style="white-space:nowrap">${fmtD(c.ts)}</td>
              <td>${esc((c.p.items || []).map((i) => (i.cantidad || 1) + ' ' + (i.producto || i.nombre || '')).join(', ')) || '<span class="help">Sin detalle</span>'}</td>
              <td style="white-space:nowrap;text-align:right">${GDO.CRM.montoDe(c.p) ? fmtM(GDO.CRM.montoDe(c.p)) : ''}</td>
              <td>${ESTADO_CHIP[c.p.estado] || ''}</td>
            </tr>`).join('')}</tbody></table>` : '<div class="empty">Todavía no tiene compras registradas.</div>'}
        </div>`,
      footHTML: `
        ${tel ? '<button class="btn btn-verde" data-wsp>💬 WhatsApp</button>' : ''}
        <button class="btn btn-dark" data-nuevo>+ Nuevo pedido</button>
        <button class="btn btn-ghost" data-unir title="Si el mismo cliente quedó dividido en dos fichas">🔗 Unir</button>
        <div class="spacer" style="flex:1"></div>
        <button class="btn btn-ghost" data-cancel>Cerrar</button>
        <button class="btn btn-primary" data-save>Guardar</button>`,
      onMount(node, close) {
        node.querySelectorAll('[data-rec]').forEach((b) => b.onclick = () => {
          node.querySelector('#fi-rfec').value = +b.dataset.rec === 0 ? hoyISO() : enDias(+b.dataset.rec);
        });
        node.querySelectorAll('[data-ped]').forEach((tr) => tr.onclick = () => {
          close(); GDO.pedidoModal(tr.dataset.ped, () => { after && after(); });
        });

        const bw = node.querySelector('[data-wsp]');
        if (bw) bw.onclick = () => {
          close();
          mensajeModal({ ficha: f, tipo: 'manual', titulo: 'Mensaje', motivo: 'Contacto directo desde la ficha', msg: 'Hola ' + (f.nombre.split(' ')[0] || '') + '! ' }, after);
        };

        node.querySelector('[data-nuevo]').onclick = () => {
          close();
          GDO.pedidoModal(null, () => { after && after(); }, {
            cliente: f.nombre, direccion: f.direccion, localidad: f.localidad,
            entrecalles: f.entrecalles, telefono: f.telefono,
            especificaciones: f.notas || '',
          });
        };

        node.querySelector('[data-unir]').onclick = () => { close(); unirModal(f, after); };
        node.querySelector('[data-ct]').onclick = () => { close(); contactoModal(f, null, after); };

        node.querySelector('[data-cancel]').onclick = close;
        node.querySelector('[data-save]').onclick = () => {
          const rfec = node.querySelector('#fi-rfec').value;
          const rmot = node.querySelector('#fi-rmot').value.trim();
          CRM().guardar(f, {
            tipo: node.querySelector('#fi-tipo').value,
            telefono: node.querySelector('#fi-tel').value.trim(),
            direccion: node.querySelector('#fi-dir').value.trim(),
            notas: node.querySelector('#fi-notas').value.trim(),
            pausado: node.querySelector('#fi-pausa').checked,
            recordatorio: rfec ? { fecha: rfec, motivo: rmot } : null,
          });
          toast('Ficha guardada', 'ok');
          close(); after && after();
        };
      },
    });
  }
  GDO.Views.fichaClienteModal = fichaModal;

  /* REGISTRAR CONTACTO. Lo importante acá es que sea corto: dos listas y un
     campo de texto. Si registrar lleva más de 15 segundos, nadie registra nada
     y el CRM se vuelve mentira. Queda guardado quién habló, por dónde, en qué
     quedó y si hay que volver a llamarlo. */
  function contactoModal(f, sug, after) {
    const C = CRM().CANALES, R = CRM().RESULTADOS;
    const canalPorDefecto = (f.telefono && GDO.Wpp.tieneTel(f.telefono)) ? 'whatsapp' : 'llamada';
    modal({
      title: 'Contacto con ' + f.nombre, width: 520,
      bodyHTML: `
        ${sug && sug.titulo ? `<div class="note" style="margin-bottom:14px">Lo tenías en la lista por: <b>${esc(sug.titulo)}</b> — ${esc(sug.motivo)}</div>` : ''}
        <div class="form-grid">
          <div class="field"><label>¿Por dónde lo contactaste?</label>
            <select id="ct-canal">${Object.keys(C).map((k) => `<option value="${k}"${k === canalPorDefecto ? ' selected' : ''}>${C[k]}</option>`).join('')}</select></div>
          <div class="field"><label>¿En qué quedaron?</label>
            <select id="ct-res">${Object.keys(R).map((k) => `<option value="${k}"${k === 'pide' ? ' selected' : ''}>${esc(R[k].t)}</option>`).join('')}</select></div>
          <div class="field col-2"><label>¿Qué te dijo?</label>
            <textarea id="ct-nota" rows="3" placeholder="Ej: está con stock hasta el jueves · pidió precio por 20 kg · se quejó de que la milanesa vino chica"></textarea></div>
          <div class="field"><label>¿Hay que volver a contactarlo?</label>
            <input id="ct-prox" type="date" value=""/>
            <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
              <button class="btn btn-ghost btn-sm" data-prox="3" type="button">En 3 días</button>
              <button class="btn btn-ghost btn-sm" data-prox="7" type="button">En 1 semana</button>
              <button class="btn btn-ghost btn-sm" data-prox="" type="button">No hace falta</button>
            </div></div>
          <div class="field"><label>¿Para qué? (opcional)</label>
            <input id="ct-motivo" placeholder="Ej: pasarle el precio de la milanesa"/></div>
        </div>
        <div class="help" id="ct-aviso" style="margin-top:10px"></div>`,
      footHTML: `<button class="btn btn-ghost" data-cancel>Cancelar</button><button class="btn btn-primary" data-save>Guardar contacto</button>`,
      onMount(node, close) {
        const res = node.querySelector('#ct-res');
        const aviso = node.querySelector('#ct-aviso');
        const refresh = () => {
          aviso.innerHTML = res.value === 'nocompra'
            ? '⚠️ Al guardar, este cliente <b>deja de aparecer</b> en la lista de contactos. Se puede volver a activar desde su ficha.'
            : 'Si no ponés fecha, la app lo vuelve a proponer sola cuando le toque el próximo pedido.';
        };
        res.onchange = refresh; refresh();
        node.querySelectorAll('[data-prox]').forEach((b) => b.onclick = () => {
          node.querySelector('#ct-prox').value = b.dataset.prox ? enDias(+b.dataset.prox) : '';
        });
        node.querySelector('[data-cancel]').onclick = close;
        node.querySelector('[data-save]').onclick = () => {
          CRM().registrarContacto(f, {
            canal: node.querySelector('#ct-canal').value,
            resultado: res.value,
            nota: node.querySelector('#ct-nota').value.trim(),
            proximo: node.querySelector('#ct-prox').value,
            motivoProximo: node.querySelector('#ct-motivo').value.trim(),
            motivoAviso: sug ? sug.titulo : '',
          }, sug ? sug.tipo : 'manual');
          toast('Contacto registrado ✓', 'ok');
          close(); after && after();
        };
      },
    });
  }

  // Una línea del historial de contactos (se usa en la ficha y en la pestaña Contactos).
  function lineaContacto(ct, nombreCliente) {
    const C = CRM().CANALES, R = CRM().RESULTADOS;
    const r = R[ct.resultado] || { t: ct.resultado, chip: 'crm-r-neu' };
    return `<div class="crm-ct">
      <div class="crm-ct-h">
        ${nombreCliente ? '<b>' + esc(nombreCliente) + '</b> · ' : ''}
        <span class="crm-ct-f">${fmtD(ct.ts)}</span>
        <span class="chip ${r.chip}">${esc(r.t)}</span>
        <span class="crm-ct-c">${C[ct.canal] || ct.canal}</span>
        ${ct.porNombre ? '<span class="crm-ct-p">por ' + esc(String(ct.porNombre).split(' ')[0]) + '</span>' : ''}
      </div>
      ${ct.nota ? '<div class="crm-ct-n">' + esc(ct.nota) + '</div>' : ''}
    </div>`;
  }

  /* Posibles duplicados: pares de fichas que serían el mismo cliente. La app NO los
     une sola (unir mal es peor que no unir), pero los muestra lado a lado para
     decidir en un toque. Es la causa más común de "este cliente volvió a comprar y
     me aparece con una sola compra". */
  function duplicadosModal(pares, after) {
    const fila = (p, i) => `
      <div class="crm-dup" data-par="${i}">
        <div class="crm-dup-m">${esc(p.motivo)}</div>
        <div class="crm-dup-c">
          <div class="crm-dup-f">
            <b>${esc(p.a.nombre)}</b>
            <span>${p.a.nCompras} compra${p.a.nCompras === 1 ? '' : 's'}${p.a.ultima ? ' · última ' + fmtD(p.a.ultima) : ''}</span>
            <span>${esc(p.a.telefono || 'sin teléfono')}</span>
            <span>${esc(p.a.direccion || 'sin dirección')}</span>
          </div>
          <div class="crm-dup-x">+</div>
          <div class="crm-dup-f">
            <b>${esc(p.b.nombre)}</b>
            <span>${p.b.nCompras} compra${p.b.nCompras === 1 ? '' : 's'}${p.b.ultima ? ' · última ' + fmtD(p.b.ultima) : ''}</span>
            <span>${esc(p.b.telefono || 'sin teléfono')}</span>
            <span>${esc(p.b.direccion || 'sin dirección')}</span>
          </div>
        </div>
        <div class="crm-dup-a">
          <button class="btn btn-primary btn-sm" data-unir>🔗 Es el mismo · unir</button>
          <button class="btn btn-ghost btn-sm" data-no>Son distintos</button>
        </div>
      </div>`;

    modal({
      title: '¿Son el mismo cliente?', width: 660,
      bodyHTML: `
        <div class="note">La app une sola a los clientes cuando comparten teléfono, dirección o nombre, pero <b>nunca junta dos teléfonos distintos</b> — si no, mezclaría vecinos del mismo edificio. Estos quedaron separados por eso. Miralos y decidí vos.</div>
        <div id="dup-lista">${pares.map(fila).join('')}</div>`,
      footHTML: `<button class="btn btn-ghost" data-cancel>Cerrar</button>`,
      onMount(node, close) {
        node.querySelector('[data-cancel]').onclick = close;
        node.querySelectorAll('[data-par]').forEach((el) => {
          const p = pares[+el.dataset.par];
          el.querySelector('[data-unir]').onclick = () => {
            CRM().unir(p.a, p.b);
            el.innerHTML = '<div class="crm-dup-ok">✓ Unidos: <b>' + esc(p.a.nombre) + '</b> — ahora tiene ' + (p.a.nCompras + p.b.nCompras) + ' compras</div>';
            toast('Fichas unidas ✓', 'ok');
            after && after();
          };
          // "Son distintos": queda GUARDADO en la ficha, si no la app volvía a
          // proponer el mismo par cada vez que se abría la pantalla.
          el.querySelector('[data-no]').onclick = () => {
            CRM().rechazarUnion(p.a, p.b);
            el.innerHTML = '<div class="crm-dup-ok">✓ Anotado: son clientes distintos. No te lo vuelve a proponer.</div>';
            after && after();
          };
        });
      },
    });
  }

  /* Pedidos sin fecha: los lista para poder completarlos de a uno (abre el pedido)
     o de una vez con "Usar la fecha de hoy" (para los que ya se entregaron y nadie
     registró cuándo). Sin fecha, un pedido no puede entrar en el historial. */
  function sinFechaModal(lista, after) {
    modal({
      title: lista.length + ' pedido' + (lista.length === 1 ? '' : 's') + ' sin fecha', width: 620,
      bodyHTML: `
        <div class="note">Estos pedidos no tienen <b>fecha de entrega</b> ni entrega registrada, así que la app no sabe cuándo fueron y no los puede sumar al historial del cliente.<br>
        Tocá uno para abrirlo y ponerle la fecha, o usá el botón de abajo si ya se entregaron y no importa el día exacto.</div>
        <div class="crm-unir-lista">${lista.map((p) => `
          <button class="crm-unir-item" data-ped="${esc(p.id)}">
            <b>${esc(p.cliente || 'Sin nombre')}</b>
            <span>${esc(p.direccion || 'sin dirección')} · ${esc((p.items || []).map((i) => (i.cantidad || 1) + ' ' + (i.producto || i.nombre || '')).join(', ') || 'sin detalle')}</span>
          </button>`).join('')}</div>`,
      footHTML: `<button class="btn btn-ghost" data-cancel>Cerrar</button><button class="btn btn-primary" data-todos>Ponerles la fecha de hoy</button>`,
      onMount(node, close) {
        node.querySelectorAll('[data-ped]').forEach((b) => b.onclick = () => {
          close(); GDO.pedidoModal(b.dataset.ped, () => { after && after(); });
        });
        node.querySelector('[data-cancel]').onclick = close;
        node.querySelector('[data-todos]').onclick = () => {
          confirmDlg(
            'Se le va a poner la fecha de HOY a los ' + lista.length + ' pedidos. Es una fecha aproximada: sirve para que entren al historial, pero el ritmo de compra de esos clientes va a quedar distorsionado. ¿Seguimos?',
            () => {
              const hoy = hoyISO();
              lista.forEach((p) => Store.upsertPedido({ id: p.id, fechaEntrega: hoy }));
              close(); toast(lista.length + ' pedidos fechados ✓', 'ok'); after && after();
            }, 'Poner fecha de hoy', 'btn-primary');
        };
      },
    });
  }

  /* Unir dos fichas a mano. La app une sola cuando dos pedidos comparten teléfono,
     dirección o nombre, pero nunca junta dos teléfonos distintos (para no mezclar
     dos vecinos del mismo edificio). Cuando SÍ es la misma persona con dos números
     —se cambió de celular, tiene el del local y el personal— se une desde acá. */
  function unirModal(f, after) {
    const otras = CRM().fichas().filter((x) => x.id !== f.id);
    modal({
      title: 'Unir ' + f.nombre + ' con otra ficha', width: 560,
      bodyHTML: `
        <div class="note">Elegí la ficha que en realidad es <b>el mismo cliente</b>. Se juntan los dos historiales en uno solo y la unión queda guardada para siempre (aunque tengan teléfonos distintos).</div>
        <div class="field"><input type="search" id="un-q" placeholder="Buscar por nombre, teléfono o dirección…"/></div>
        <div id="un-lista" class="crm-unir-lista"></div>`,
      footHTML: `<button class="btn btn-ghost" data-cancel>Cancelar</button>`,
      onMount(node, close) {
        const lista = node.querySelector('#un-lista');
        const draw = (q) => {
          const nq = CRM().norm(q || '');
          const dig = String(q || '').replace(/\D/g, '');
          const vis = otras.filter((x) => {
            if (!nq) return true;
            if (CRM().norm(x.nombre + ' ' + x.direccion).indexOf(nq) >= 0) return true;
            return dig.length >= 3 && String(x.telefono || '').replace(/\D/g, '').indexOf(dig) >= 0;
          }).slice(0, 40);
          lista.innerHTML = vis.length ? vis.map((x) => `
            <button class="crm-unir-item" data-id="${esc(x.id)}">
              <b>${esc(x.nombre)}</b>
              <span>${x.nCompras} compra${x.nCompras === 1 ? '' : 's'} · ${esc(x.telefono || 'sin teléfono')} · ${esc(x.direccion || 'sin dirección')}</span>
            </button>`).join('') : '<div class="empty">No hay otras fichas que coincidan.</div>';
          lista.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => {
            const otra = otras.filter((x) => x.id === b.dataset.id)[0];
            confirmDlg(
              '¿Unir "' + f.nombre + '" con "' + otra.nombre + '"? Van a quedar como un solo cliente, con los ' + (f.nCompras + otra.nCompras) + ' pedidos juntos.',
              () => { CRM().unir(f, otra); close(); toast('Fichas unidas ✓', 'ok'); after && after(); },
              'Unir', 'btn-primary');
          });
        };
        draw('');
        node.querySelector('#un-q').oninput = (e) => draw(e.target.value);
        node.querySelector('[data-cancel]').onclick = close;
      },
    });
  }
})();
