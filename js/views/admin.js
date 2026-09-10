/* ====== Vistas: Administración / Vendedor ====== */
window.GDO = window.GDO || {}; GDO.Views = GDO.Views || {};
(function () {
  const { Store } = GDO;
  const { esc, h, toast, modal, confirmDlg, fmtFecha, proximoDiaFecha, diaSemanaDe, ESTADO_CHIP, ROL_CHIP,
          estadoChip, esRetiro, modalidadChip } = GDO.UI;
  // Exponemos el detalle del pedido para poder abrirlo desde otras vistas (rutas) al tocar el pedido.
  GDO.pedidoModal = function (id, after, prefill) { return pedidoModal(id, after, prefill); };
  const go = (hash) => { location.hash = hash; };
  // Fecha de HOY en formato ISO, con la hora LOCAL (no UTC): con toISOString(),
  // después de las 21 hs de Argentina el "hoy" saltaba al día siguiente.
  function isoHoy(d) {
    const x = d ? new Date(d) : new Date();
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  }
  GDO.isoHoy = isoHoy;

  /* Franjas horarias de retiro: una hora, de 6:30 a 13:30 (la última, 12:30 a
     13:30). Son las mismas que elige el cliente en la tienda; acá sirven para
     que el mostrador pueda cargarlas o corregirlas sin escribirlas a mano. */
  const FRANJAS = (() => {
    const hhmm = (m) => Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
    const out = [];
    for (let m = 6 * 60 + 30; m + 60 <= 13 * 60 + 30; m += 60) out.push(hhmm(m) + ' a ' + hhmm(m + 60) + ' hs');
    return out;
  })();
  GDO.FRANJAS_RETIRO = FRANJAS;

  /* ---------------- Tablero ---------------- */
  GDO.Views.dashboard = function (c) {
    const peds = Store.pedidos();
    const cont = (e) => peds.filter((p) => p.estado === e).length;
    const rutasAct = Store.rutas().filter((r) => ['asignada', 'aceptada', 'en_curso'].includes(r.estado));
    // Aviso del CRM: cuántos clientes hay para contactar hoy. Es lo primero que
    // conviene ver al abrir la app, porque es lo único que se pierde si nadie mira.
    // El aviso cuenta SOLO lo urgente (clientes que ya compraban y algo cambió).
    // Si sumáramos las primeras compras sin repetir, el número sería enorme todos
    // los días y dejaría de significar nada.
    let sugs = [];
    try { sugs = (GDO.CRM && Store.puedeCRM()) ? GDO.CRM.agendaPartida().hoy : []; } catch (e) { sugs = []; }
    // RETIROS EN SUCURSAL: no van a ninguna ruta, así que si no tuvieran su propio
    // lugar en el tablero no se verían hasta que alguien entre a Pedidos. Van
    // ordenados por el día que el cliente dijo que pasa (lo de hoy, primero).
    const retiros = peds.filter((p) => esRetiro(p) && p.estado !== 'entregado')
      .sort((a, b) => {
        const fa = efFechaEntrega(a), fb = efFechaEntrega(b);
        if (fa && fb) return fa < fb ? -1 : (fa > fb ? 1 : 0);
        return fa ? -1 : (fb ? 1 : 0);
      });
    const retirosHoy = retiros.filter((p) => efFechaEntrega(p) === isoHoy()).length;
    c.innerHTML = `
      ${sugs.length ? `<div class="crm-aviso" id="d-crm">
        <span class="ic">📞</span>
        <div class="tx"><b>${sugs.length} cliente${sugs.length === 1 ? '' : 's'} para contactar hoy</b>
          <span>${esc(sugs.slice(0, 3).map((s) => s.ficha.nombre).join(', '))}${sugs.length > 3 ? ' y ' + (sugs.length - 3) + ' más' : ''}</span></div>
        <button class="btn btn-primary btn-sm">Ver</button>
      </div>` : ''}
      <div class="cards" style="margin-bottom:22px">
        <div class="card kpi naranja"><span class="ic">📦</span><span class="num">${peds.length}</span><span class="lbl">Pedidos totales</span></div>
        <div class="card kpi negro"><span class="ic">🕓</span><span class="num">${cont('pendiente')}</span><span class="lbl">Pendientes de asignar</span></div>
        <div class="card kpi amarillo"><span class="ic">🚚</span><span class="num">${rutasAct.length}</span><span class="lbl">Rutas activas</span></div>
        <div class="card kpi negro" id="d-kpi-ret" style="cursor:pointer" title="Ver los retiros en sucursal"><span class="ic">🏪</span><span class="num">${retiros.length}</span><span class="lbl">Retiros en sucursal${retirosHoy ? ' · ' + retirosHoy + ' hoy' : ''}</span></div>
        <div class="card kpi rojo"><span class="ic">⚠️</span><span class="num">${cont('no_entregado')}</span><span class="lbl">No entregados</span></div>
      </div>
      ${retiros.length ? `<div class="panel" id="d-retiros">
        <div class="panel-h"><h3>🏪 Retiro en sucursal</h3><span class="chip chip-retiro">${retiros.length} pedido${retiros.length === 1 ? '' : 's'} esperando</span></div>
        <div class="panel-b flush"><div id="d-tabla-ret"></div></div>
      </div>` : ''}
      <div class="panel">
        <div class="panel-h"><h3>Pedidos recientes</h3><button class="btn btn-primary btn-sm" id="d-new">+ Nuevo pedido</button></div>
        <div class="panel-b flush"><div id="d-tabla"></div></div>
      </div>`;
    // Solo pedidos ACTIVOS (los entregados no ensucian el tablero; quedan guardados y se ven en Pedidos → "Entregado").
    renderPedidosTabla(c.querySelector('#d-tabla'), peds.filter((p) => p.estado !== 'entregado').slice(-6).reverse());
    // Los retiros van APARTE, con la fecha en la que el cliente dijo que pasa: es
    // lo que hay que tener preparado en el mostrador, no algo para rutear.
    const boxRet = c.querySelector('#d-tabla-ret');
    if (boxRet) renderRetirosTabla(boxRet, retiros.slice(0, 10));
    const kpiRet = c.querySelector('#d-kpi-ret');
    if (kpiRet) kpiRet.onclick = () => {
      const t = c.querySelector('#d-retiros');
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else { go('#/pedidos'); GDO.App.render(); }
    };
    c.querySelector('#d-new').onclick = () => pedidoModal(null, () => GDO.App.render());
    const crmBox = c.querySelector('#d-crm');
    if (crmBox) crmBox.onclick = () => { go('#/clientes'); GDO.App.render(); };
  };

  /* ---- Exportar pedidos como mensajes de WhatsApp (por día de entrega) ----
     Sirve para recuperar/reenviar pedidos que no llegaron por WhatsApp. */
  function pedidoWspTexto(p) {
    const m = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
    const f = efFechaEntrega(p);
    const L = [];
    const ret = esRetiro(p);
    L.push(ret ? '🏪 *PEDIDO PARA RETIRAR*' : '🛒 *NUEVO PEDIDO MINORISTA*');
    L.push('*Granja del Oeste*');
    L.push('━━━━━━━━━━━━━━');
    L.push('👤 *DATOS DEL CLIENTE*');
    L.push('• *Nombre:* ' + (p.cliente || ''));
    if (p.telefono) L.push('• *Teléfono:* ' + p.telefono);
    L.push('• *Modalidad:* ' + (ret ? 'Retiro en sucursal' : 'Envío a domicilio'));
    if (ret) {
      L.push('• *Retiro en:* Acuña 1334, Villa Tesei');
      if (f) L.push('• *Día de retiro:* ' + diaSemanaDe(f) + ' ' + fmtFecha(f));
      L.push('• *Horario:* ' + (p.ventana || 'A coordinar'));
    } else {
      if (p.zona) L.push('• *Zona:* ' + p.zona);
      if (f) L.push('• *Día de entrega:* ' + diaSemanaDe(f) + ' ' + fmtFecha(f));
      L.push('• *Dirección:* ' + (p.direccion || ''));
      if (p.localidad) L.push('• *Localidad:* ' + p.localidad);
      if (p.entrecalles) L.push('• *Entre calles:* ' + p.entrecalles);
    }
    if (p.formaPago) L.push('• *Forma de pago:* ' + p.formaPago);
    L.push('━━━━━━━━━━━━━━');
    L.push('📦 *DETALLE DEL PEDIDO*');
    let sub = 0;
    (p.items || []).forEach((it, i) => {
      const cant = (it.cantidad != null) ? it.cantidad : (it.cant || 0);
      const pr = it.precio || 0, u = it.unidad || it.u || 'un';
      const st = cant * pr; sub += st;
      L.push('*' + (i + 1) + ') ' + (it.producto || it.nombre || '') + '*');
      L.push('    ' + cant + ' ' + u + (pr ? (' × ' + m(pr) + ' = *' + m(st) + '*') : ''));
    });
    L.push('━━━━━━━━━━━━━━');
    L.push('💰 *TOTAL: ' + m(p.totalEstimado || sub) + '*');
    return L.join('\n');
  }
  function wspDelDiaModal() {
    const peds = Store.pedidos().filter((p) => p.estado !== 'entregado');
    if (!peds.length) { toast('No hay pedidos pendientes.', 'error'); return; }
    const grupos = {};
    peds.forEach((p) => { const f = efFechaEntrega(p) || 'sin'; (grupos[f] = grupos[f] || []).push(p); });
    const fechas = Object.keys(grupos).filter((k) => k !== 'sin').sort();
    if (grupos['sin']) fechas.push('sin');
    const chip = (f) => `<button type="button" class="btn btn-sm btn-ghost" data-f="${esc(f)}">${f === 'sin' ? 'Sin fecha' : (esc(diaSemanaDe(f)) + ' ' + fmtFecha(f))} (${grupos[f].length})</button>`;
    modal({
      title: '📋 Pedidos en formato WhatsApp', width: 580,
      bodyHTML:
        `<div class="small muted" style="margin:0 0 8px">Elegí el día y copiá los pedidos para pegarlos en WhatsApp.</div>` +
        `<div id="wsp-dias" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${fechas.map(chip).join('')}</div>` +
        `<textarea id="wsp-txt" readonly style="width:100%;height:300px;font-family:monospace;font-size:12px;line-height:1.4;padding:10px;border:1px solid #cfd4da;border-radius:9px"></textarea>`,
      footHTML: `<button class="btn btn-ghost" data-no>Cerrar</button><button class="btn" id="wsp-copy">📋 Copiar</button>`,
      onMount(node, close) {
        const ta = node.querySelector('#wsp-txt');
        const pintar = (f) => {
          ta.value = grupos[f].map(pedidoWspTexto).join('\n\n──────────────────────\n\n');
          node.querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('btn-ghost', b.dataset.f !== f));
        };
        node.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => pintar(b.dataset.f));
        if (fechas.length) pintar(fechas[0]);
        node.querySelector('[data-no]').onclick = close;
        node.querySelector('#wsp-copy').onclick = () => {
          ta.focus(); ta.select();
          const ok = () => toast('Copiado ✓ — pegalo en WhatsApp');
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(ta.value).then(ok, () => { try { document.execCommand('copy'); ok(); } catch (e) { toast('Seleccioná y copiá a mano.', 'error'); } });
            } else { document.execCommand('copy'); ok(); }
          } catch (e) { toast('Seleccioná y copiá a mano.', 'error'); }
        };
      },
    });
  }

  /* ---------------- Pedidos ---------------- */
  GDO.Views.pedidos = function (c) {
    const soyVend = Store.rolActivo() === 'vendedor';
    // Conjunto de ids tildados para acciones masivas (vive mientras dure la vista).
    const sel = new Set();
    c.innerHTML = `
      <div class="section-title"><h2>${soyVend ? 'Carga de pedidos' : 'Pedidos'}</h2></div>
      <div class="toolbar">
        <input type="search" id="p-q" placeholder="Buscar cliente, dirección o localidad…"/>
        <select id="p-est">
          <option value="activos">Activos (sin entregados)</option>
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option><option value="asignado">Asignado</option>
          <option value="en_ruta">En ruta</option><option value="entregado">Entregado</option>
          <option value="no_entregado">No entregado</option><option value="salteado">Salteado</option>
        </select>
        <select id="p-mod" title="Envío a domicilio o retiro en sucursal">
          <option value="">Envíos y retiros</option>
          <option value="envio">🚚 Solo envíos a domicilio</option>
          <option value="retiro">🏪 Solo retiros en sucursal</option>
        </select>
        <div class="p-fechas" title="Buscar por día de entrega o de retiro">
          <span class="ic">📅</span>
          <input type="date" id="p-d" title="Desde"/>
          <span class="fl">→</span>
          <input type="date" id="p-h" title="Hasta"/>
          <button class="btn btn-ghost btn-sm" id="p-fclear" title="Ver todas las fechas" style="display:none">✕</button>
        </div>
        <div class="spacer"></div>
        <!-- La tienda EN VIVO es lista.granjadeloeste.com (repo gdo-tienda). La
             carpeta tienda/ de este repo es una copia vieja de julio que quedó
             congelada: abrirla mostraba precios y un formulario desactualizados. -->
        <a class="btn btn-ghost" href="https://lista.granjadeloeste.com" target="_blank" rel="noopener">🛒 Tienda online ↗</a>
        <button class="btn btn-ghost" id="p-wsp">📋 WhatsApp del día</button>
        <button class="btn btn-ghost" id="p-ocr">📷 Desde imagen</button>
        <button class="btn btn-ghost" id="p-import">📥 Importar</button>
        <button class="btn btn-primary" id="p-new">+ Nuevo pedido</button>
      </div>
      <div class="note">Los pedidos hechos por los clientes en la <b>tienda online</b> entran acá automáticamente como “pendientes”. Solo resta ubicarlos en el mapa y asignarles chofer. El panel muestra los <b>pedidos activos</b>; los <b>entregados</b> quedan guardados (con su comprobante) y los ves eligiendo “Entregado” o “Todos”.<br>Los de <b>🏪 retiro en sucursal</b> no entran al armado de rutas: se cierran acá con <b>✓</b> cuando el cliente los pasa a buscar, o se pasan a envío con <b>🚚</b> si hace falta llevárselos.</div>
      <div id="p-bulk" class="toolbar" style="display:none;align-items:center;background:var(--gris-cl);border:1px solid var(--gris-bd);border-radius:10px;padding:8px 12px;margin-bottom:10px">
        <b id="p-bulk-n">0 seleccionados</b>
        <div class="spacer"></div>
        <button class="btn btn-ghost btn-sm" id="p-bulk-clear">Quitar selección</button>
        <button class="btn btn-rojo btn-sm" id="p-bulk-del">🗑 Eliminar seleccionados</button>
      </div>
      <div class="panel"><div class="panel-b flush"><div id="p-tabla"></div></div></div>`;
    const bulk = c.querySelector('#p-bulk');
    const refreshBulk = () => {
      const n = sel.size;
      bulk.style.display = n ? 'flex' : 'none';
      if (n) c.querySelector('#p-bulk-n').textContent = n + (n === 1 ? ' pedido seleccionado' : ' pedidos seleccionados');
    };
    const draw = () => {
      const q = c.querySelector('#p-q').value.toLowerCase();
      const est = c.querySelector('#p-est').value;
      let list = Store.pedidos().slice();
      // Orden por fecha de entrega: la más cercana arriba, la más lejana abajo; los que
      // no tienen fecha quedan al fondo; a igualdad de fecha, el más nuevo primero.
      list.sort((a, b) => {
        const fa = efFechaEntrega(a), fb = efFechaEntrega(b);
        if (fa && fb) { if (fa !== fb) return fa < fb ? -1 : 1; }
        else if (fa) return -1;
        else if (fb) return 1;
        return (b.ts || 0) - (a.ts || 0);
      });
      if (soyVend) list = list.filter((p) => p.creadoPor === Store.current().id);
      if (q) list = list.filter((p) => (p.cliente + ' ' + p.direccion + ' ' + (p.localidad || '')).toLowerCase().includes(q));
      if (est === 'activos') list = list.filter((p) => p.estado !== 'entregado');
      else if (est) list = list.filter((p) => p.estado === est);
      const mod = c.querySelector('#p-mod').value;
      if (mod === 'retiro') list = list.filter((p) => esRetiro(p));
      else if (mod === 'envio') list = list.filter((p) => !esRetiro(p));
      /* Búsqueda por fecha: el día de entrega (o de retiro) del pedido. Sirve
         para contestar "¿qué entregamos el jueves pasado?" — se combina con el
         estado, así que con "Entregado" + un día quedan las entregas de ese día.
         Con una sola fecha cargada el rango queda abierto de ese lado. Un pedido
         SIN fecha no puede entrar en ninguna búsqueda por fecha. */
      const fD = c.querySelector('#p-d').value, fH = c.querySelector('#p-h').value;
      if (fD || fH) {
        list = list.filter((p) => {
          const f = efFechaEntrega(p);
          return f && (!fD || f >= fD) && (!fH || f <= fH);
        });
      }
      c.querySelector('#p-fclear').style.display = (fD || fH) ? '' : 'none';
      // Mantenemos tildado solo lo que se sigue viendo (al cambiar filtro/busqueda).
      const visibles = new Set(list.map((p) => p.id));
      [...sel].forEach((id) => { if (!visibles.has(id)) sel.delete(id); });
      renderPedidosTabla(c.querySelector('#p-tabla'), list, { sel, onSel: refreshBulk });
      refreshBulk();
    };
    c.querySelector('#p-q').oninput = draw;
    c.querySelector('#p-est').onchange = () => { sel.clear(); draw(); };
    c.querySelector('#p-mod').onchange = () => { sel.clear(); draw(); };
    // Calendario: al tocar el campo se abre el almanaque, y el filtro se aplica
    // solo. Si el "hasta" queda antes del "desde", se acomodan solos.
    const pD = c.querySelector('#p-d'), pH = c.querySelector('#p-h');
    [pD, pH].forEach((el) => { el.onfocus = el.onclick = () => { try { el.showPicker && el.showPicker(); } catch (e) {} }; });
    pD.onchange = () => { if (pH.value && pH.value < pD.value) pH.value = pD.value; sel.clear(); draw(); };
    pH.onchange = () => { if (pD.value && pH.value < pD.value) pD.value = pH.value; sel.clear(); draw(); };
    c.querySelector('#p-fclear').onclick = () => { pD.value = ''; pH.value = ''; sel.clear(); draw(); };
    c.querySelector('#p-new').onclick = () => pedidoModal(null, draw);
    c.querySelector('#p-ocr').onclick = () => ocrPedidoModal(draw);
    c.querySelector('#p-import').onclick = () => importModal(draw);
    c.querySelector('#p-wsp').onclick = () => wspDelDiaModal();
    c.querySelector('#p-bulk-clear').onclick = () => { sel.clear(); draw(); };
    c.querySelector('#p-bulk-del').onclick = () => {
      const ids = [...sel];
      if (!ids.length) return;
      const enRuta = ids.filter((id) => { const p = Store.pedido(id); return p && p.rutaId; }).length;
      const aviso = enRuta
        ? `Vas a eliminar ${ids.length} pedido(s). ⚠️ ${enRuta} está(n) asignado(s) a una ruta y se quitará(n) también de ahí. Esta acción no se puede deshacer. ¿Confirmás?`
        : `Vas a eliminar ${ids.length} pedido(s). Esta acción no se puede deshacer. ¿Confirmás?`;
      confirmDlg(aviso, () => {
        const n = Store.deletePedidos(ids);
        sel.clear();
        toast(n + (n === 1 ? ' pedido eliminado' : ' pedidos eliminados'), 'ok');
        GDO.App.render();
      }, 'Eliminar');
    };
    draw();
    if (GDO.Geo) GDO.Geo.locatePending(() => { if (document.body.contains(c)) draw(); });
  };

  /* ---- Importar pedidos desde Excel/CSV ---- */
  // Pegás o elegís un CSV (Excel: Guardar como CSV), la app detecta columnas
  // por su nombre, te deja revisar el mapeo y previsualizar, y da de alta todo
  // de una. Después geocodifica en segundo plano las direcciones que pueda.
  function importModal(after) {
    // Campos destino y los nombres de columna que reconocemos para cada uno.
    const CAMPOS = [
      { k: 'cliente', lbl: 'Cliente *', alias: ['cliente', 'nombre', 'comercio', 'razon social', 'razonsocial'] },
      { k: 'direccion', lbl: 'Dirección *', alias: ['direccion', 'domicilio', 'calle', 'direccion de entrega'] },
      { k: 'localidad', lbl: 'Localidad', alias: ['localidad', 'ciudad', 'barrio', 'partido'] },
      { k: 'entrecalles', lbl: 'Entre calles', alias: ['entrecalles', 'entre calles', 'referencia', 'referencias'] },
      { k: 'telefono', lbl: 'Teléfono', alias: ['telefono', 'tel', 'celular', 'whatsapp', 'cel', 'contacto'] },
      { k: 'items', lbl: 'Pedido / productos', alias: ['items', 'pedido', 'productos', 'producto', 'detalle', 'mercaderia'] },
      { k: 'prioridad', lbl: 'Prioridad', alias: ['prioridad'] },
      { k: 'ventana', lbl: 'Ventana horaria', alias: ['ventana', 'horario', 'franja'] },
      { k: 'fechaEntrega', lbl: 'Fecha de entrega', alias: ['fecha', 'fecha de entrega', 'fechaentrega', 'entrega'] },
      { k: 'especificaciones', lbl: 'Comentarios', alias: ['especificaciones', 'comentarios', 'observaciones', 'notas', 'aclaraciones'] },
    ];
    const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

    let filas = [], headers = [], mapeo = {};

    const m = modal({
      title: 'Importar pedidos desde Excel/CSV', width: 720,
      bodyHTML: `
        <div class="note">Exportá tu planilla como <b>CSV</b> (en Excel/Drive: “Descargar → CSV”) y elegí el archivo, o pegá las filas acá abajo. La primera fila debe tener los <b>títulos</b> de columna.</div>
        <div class="field"><label>Archivo CSV</label><input type="file" accept=".csv,text/csv,text/plain" id="imp-file"/></div>
        <div class="field"><label>…o pegar el contenido</label><textarea id="imp-text" rows="4" placeholder="cliente,direccion,telefono,pedido&#10;Kiosco Ana,Av. Vergara 1234 Hurlingham,11 5555 5555,20 huevos; 10 pollo"></textarea>
          <button class="btn btn-ghost btn-sm" id="imp-parse" style="align-self:flex-start;margin-top:6px">Analizar pegado</button></div>
        <div id="imp-conf"></div>`,
      footHTML: `<button class="btn btn-ghost" data-cancel>Cancelar</button><button class="btn btn-primary" data-save disabled>Importar</button>`,
      onMount(node, close) {
        const conf = node.querySelector('#imp-conf');
        const saveBtn = node.querySelector('[data-save]');

        const analizar = (texto) => {
          const rows = GDO.CSV.parse(texto);
          if (rows.length < 2) { toast('El CSV no tiene filas de datos (¿falta la fila de títulos?)', 'err'); return; }
          headers = rows[0].map((h) => h.trim());
          filas = rows.slice(1);
          // auto-mapeo por nombre de columna
          mapeo = {};
          CAMPOS.forEach((campo) => {
            const idx = headers.findIndex((h) => campo.alias.includes(norm(h)));
            if (idx >= 0) mapeo[campo.k] = idx;
          });
          dibujarConf();
        };

        const dibujarConf = () => {
          const opts = (sel) => `<option value="-1">(ninguna)</option>` +
            headers.map((h, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(h || ('Columna ' + (i + 1)))}</option>`).join('');
          conf.innerHTML = `
            <div class="note">Detectamos <b>${filas.length}</b> filas. Revisá qué columna va en cada campo:</div>
            <div class="form-grid">
              ${CAMPOS.map((campo) => `<div class="field"><label>${campo.lbl}</label>
                <select data-map="${campo.k}">${opts(mapeo[campo.k] == null ? -1 : mapeo[campo.k])}</select></div>`).join('')}
            </div>
            <label style="font-weight:600;margin:8px 0 4px;display:block">Vista previa (primeras 5)</label>
            <div id="imp-prev"></div>`;
          conf.querySelectorAll('[data-map]').forEach((s) => s.onchange = () => {
            const v = +s.value; mapeo[s.dataset.map] = v < 0 ? null : v; dibujarPrev();
          });
          dibujarPrev();
          saveBtn.disabled = !(mapeo.cliente != null && mapeo.direccion != null);
        };

        const val = (fila, k) => (mapeo[k] != null && fila[mapeo[k]] != null) ? String(fila[mapeo[k]]).trim() : '';
        const dibujarPrev = () => {
          const prev = conf.querySelector('#imp-prev');
          if (!prev) return;
          const muestra = filas.slice(0, 5);
          prev.innerHTML = `<table><thead><tr><th>Cliente</th><th>Dirección</th><th>Localidad</th><th>Tel</th><th>Pedido</th></tr></thead><tbody>
            ${muestra.map((f) => `<tr>
              <td class="small">${esc(val(f, 'cliente')) || '<span class="chip chip-no" style="font-size:10px">falta</span>'}</td>
              <td class="small">${esc(val(f, 'direccion')) || '<span class="chip chip-no" style="font-size:10px">falta</span>'}</td>
              <td class="small">${esc(val(f, 'localidad'))}</td>
              <td class="small">${esc(val(f, 'telefono'))}</td>
              <td class="small">${esc(val(f, 'items'))}</td>
            </tr>`).join('')}</tbody></table>`;
          saveBtn.disabled = !(mapeo.cliente != null && mapeo.direccion != null);
        };

        node.querySelector('#imp-file').onchange = (e) => {
          const f = e.target.files && e.target.files[0];
          if (!f) return;
          const fr = new FileReader();
          fr.onload = () => { node.querySelector('#imp-text').value = ''; analizar(String(fr.result || '')); };
          fr.onerror = () => toast('No se pudo leer el archivo', 'err');
          fr.readAsText(f, 'UTF-8');
        };
        node.querySelector('#imp-parse').onclick = () => {
          const t = node.querySelector('#imp-text').value;
          if (!t.trim()) { toast('Pegá el contenido del CSV primero', 'err'); return; }
          analizar(t);
        };

        node.querySelector('[data-cancel]').onclick = close;
        saveBtn.onclick = () => {
          const prioNorm = (s) => { const v = norm(s); return ['alta', 'baja', 'normal'].includes(v) ? v : 'normal'; };
          let n = 0;
          filas.forEach((f) => {
            const cli = val(f, 'cliente'), dir = val(f, 'direccion');
            if (!cli || !dir) return;
            Store.upsertPedido({
              cliente: cli, direccion: dir,
              localidad: val(f, 'localidad'), entrecalles: val(f, 'entrecalles'),
              telefono: val(f, 'telefono'), ventana: val(f, 'ventana'),
              fechaEntrega: val(f, 'fechaEntrega'), prioridad: prioNorm(val(f, 'prioridad')),
              especificaciones: val(f, 'especificaciones'),
              items: GDO.CSV.parseItems(val(f, 'items')),
              lat: null, lng: null, creadoPor: Store.current().id, origen: 'importado',
            });
            n++;
          });
          toast(n + ' pedido' + (n === 1 ? '' : 's') + ' importado' + (n === 1 ? '' : 's') + ' ✓', 'ok');
          close();
          after && after();
          // geocodifica en segundo plano lo que se pueda
          if (GDO.Geo) GDO.Geo.locatePending(() => { GDO.App && GDO.App.render && GDO.App.render(); });
        };
      },
    });
    return m;
  }
  GDO.Views.importModal = importModal;

  /* ---- Cargar pedido desde una IMAGEN (OCR) o pegando el texto ----
     Pegás la captura de un pedido (de otra app / WhatsApp) y la app extrae los
     datos de CONTACTO (nombre, dirección, localidad, entre calles, teléfono,
     forma de pago) y abre "Nuevo pedido" precargado para revisar y guardar.
     OCR 100% en el navegador con Tesseract.js (gratis, sin servidores). Si se
     puede copiar el texto, pegarlo es más exacto que la imagen. */
  let _tessLoading = null;
  function cargarTesseract() {
    if (window.Tesseract) return Promise.resolve();
    if (_tessLoading) return _tessLoading;
    _tessLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    return _tessLoading;
  }
  // Pasa la imagen a gris y, si el fondo es oscuro (chat dark), la invierte: el
  // OCR lee mucho mejor texto oscuro sobre claro. Devuelve un dataURL.
  function preprocesarImagen(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const escala = Math.min(2, 1500 / Math.max(img.width, img.height)) || 1;
          const cv = document.createElement('canvas');
          cv.width = Math.round(img.width * escala); cv.height = Math.round(img.height * escala);
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          const d = ctx.getImageData(0, 0, cv.width, cv.height); const px = d.data;
          let sum = 0, n = 0;
          for (let i = 0; i < px.length; i += 40) { sum += (px[i] + px[i + 1] + px[i + 2]) / 3; n++; }
          const inv = (sum / Math.max(n, 1)) < 115; // fondo oscuro → invertir
          for (let i = 0; i < px.length; i += 4) {
            let g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
            if (inv) g = 255 - g;
            px[i] = px[i + 1] = px[i + 2] = g;
          }
          ctx.putImageData(d, 0, 0);
          resolve(cv.toDataURL('image/png'));
        } catch (e) { resolve(dataUrl); }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }
  async function ocrImagen(dataUrl, onProgress) {
    await cargarTesseract();
    const proc = await preprocesarImagen(dataUrl);
    const { data } = await Tesseract.recognize(proc, 'spa', {
      logger: (m) => { if (m.status === 'recognizing text' && onProgress) onProgress(Math.round((m.progress || 0) * 100)); },
    });
    return (data && data.text) || '';
  }

  // Extrae los datos de contacto de un texto con etiquetas (formato de las apps
  // de pedidos / WhatsApp). Busca cada etiqueta y toma el valor de la misma
  // línea (tras ':') o de la línea siguiente.
  function parsePedidoDeTexto(txt) {
    const sinac = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const limpiar = (s) => String(s || '').replace(/[*_#>•·]+/g, ' ').replace(/\s+/g, ' ').trim();
    const lineas = String(txt || '').split(/\r?\n/).map(limpiar).filter((l) => l.length > 0);
    const ETIQUETAS = ['nombre', 'apellido', 'direccion', 'domicilio', 'localidad', 'entrecalle', 'entre calle',
      'telefono', 'whatsapp', 'celular', 'metodo de pago', 'forma de pago', 'enviamos', 'seleccione la zona',
      'pedido', 'subtotal', 'total', 'cant. articulo', 'articulo'];
    const esEtiqueta = (ln) => { const n = sinac(ln); return ETIQUETAS.some((e) => n.includes(e)); };
    const valorTras = (i) => {
      const partes = lineas[i].split(':');
      if (partes.length > 1) { const v = limpiar(partes.slice(1).join(':')); if (v) return v; }
      for (let j = i + 1; j < lineas.length; j++) { if (esEtiqueta(lineas[j])) return ''; return lineas[j]; }
      return '';
    };
    const buscar = (claves) => {
      for (let i = 0; i < lineas.length; i++) { const n = sinac(lineas[i]); if (claves.some((c) => n.includes(c))) return valorTras(i); }
      return '';
    };
    const out = {};
    out.cliente = buscar(['nombre y apellido', 'nombre', 'apellido']);
    out.direccion = buscar(['direccion', 'domicilio']);
    out.localidad = buscar(['localidad', 'ciudad', 'partido']);
    out.entrecalles = buscar(['entrecalle', 'entre calle']);
    out.telefono = buscar(['telefono', 'whatsapp', 'celular']).replace(/[^\d]/g, '');
    const pago = sinac(buscar(['metodo de pago', 'forma de pago']));
    if (pago.indexOf('transfer') >= 0) out.formaPago = 'Transferencia previo a la entrega';
    else if (pago.indexOf('efectivo') >= 0) out.formaPago = 'Efectivo al momento de la entrega';
    else if (pago.indexOf('qr') >= 0) out.formaPago = 'QR al momento de la entrega';
    else out.formaPago = '';
    const zona = buscar(['enviamos', 'seleccione la zona']);
    if (zona) out.especificaciones = 'Zona/día: ' + zona;
    return out;
  }

  function ocrPedidoModal(after) {
    let imgData = null;
    modal({
      title: 'Cargar pedido desde imagen o texto', width: 600,
      bodyHTML: `
        <div class="note">Pegá (Ctrl+V) la captura del pedido, subí la imagen, o pegá el texto. La app lee los <b>datos de contacto</b> y abre el formulario para que los <b>revises y confirmes</b>.</div>
        <div class="field"><label>Imagen del pedido</label>
          <div id="ocr-drop" style="border:2px dashed var(--gris-bd);border-radius:10px;padding:20px;text-align:center;color:#888;cursor:pointer">Pegá la imagen acá (Ctrl+V) o tocá para elegir un archivo</div>
          <input type="file" accept="image/*" id="ocr-file" style="display:none"/>
          <img id="ocr-prev" style="display:none;max-width:100%;margin-top:10px;border-radius:8px;border:1px solid var(--gris-bd)"/>
        </div>
        <div class="field"><label>…o pegá el texto del pedido (más exacto)</label>
          <textarea id="ocr-text" rows="4" placeholder="Si podés copiar el texto del pedido, pegalo acá."></textarea></div>
        <div id="ocr-msg" class="help" style="min-height:18px"></div>`,
      footHTML: `<button class="btn btn-ghost" data-cancel>Cancelar</button><button class="btn btn-primary" data-go>Leer datos →</button>`,
      onMount(node, close) {
        const drop = node.querySelector('#ocr-drop');
        const file = node.querySelector('#ocr-file');
        const prev = node.querySelector('#ocr-prev');
        const msg = node.querySelector('#ocr-msg');
        const setImg = (url) => { imgData = url; prev.src = url; prev.style.display = 'block'; drop.textContent = '✓ Imagen lista (tocá para cambiar)'; };
        drop.onclick = () => file.click();
        file.onchange = () => { const f = file.files && file.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => setImg(r.result); r.readAsDataURL(f); };
        node.addEventListener('paste', (e) => {
          const items = (e.clipboardData && e.clipboardData.items) || [];
          for (let i = 0; i < items.length; i++) {
            if (items[i].type && items[i].type.indexOf('image') === 0) {
              const f = items[i].getAsFile(); if (!f) continue;
              const r = new FileReader(); r.onload = () => setImg(r.result); r.readAsDataURL(f);
              e.preventDefault(); return;
            }
          }
        });
        node.querySelector('[data-cancel]').onclick = close;
        node.querySelector('[data-go]').onclick = async () => {
          let texto = node.querySelector('#ocr-text').value.trim();
          if (!texto && imgData) {
            const btn = node.querySelector('[data-go]'); btn.disabled = true;
            msg.textContent = 'Leyendo la imagen… (la primera vez descarga el lector, puede tardar unos segundos)';
            try { texto = await ocrImagen(imgData, (p) => { msg.textContent = 'Leyendo la imagen… ' + p + '%'; }); }
            catch (e) { msg.textContent = '⚠️ No se pudo leer la imagen. Probá pegar el texto.'; btn.disabled = false; return; }
            btn.disabled = false;
          }
          if (!texto) { msg.textContent = 'Pegá una imagen o el texto del pedido primero.'; return; }
          const datos = parsePedidoDeTexto(texto);
          if (!datos.cliente && !datos.direccion && !datos.telefono) { msg.textContent = '⚠️ No reconocí datos de contacto. Revisá la imagen o pegá el texto.'; return; }
          close();
          toast('Datos leídos · revisá y guardá', 'ok');
          pedidoModal(null, after, datos);
        };
      },
    });
  }
  GDO.Views.ocrPedidoModal = ocrPedidoModal;

  // Fecha de entrega EFECTIVA: la cargada, o la derivada del día elegido en la tienda
  // (próximo ese día). Permite ordenar y mostrar aunque falte la fecha exacta.
  function efFechaEntrega(p) { return GDO.UI.fechaEfectiva(p); }
  // Celda "Entrega": día de la semana (resaltado) + fecha, para armar rutas ordenado.
  // En un pedido de retiro es el día que el cliente dijo que pasa a buscarlo.
  function celdaEntrega(p) {
    const f = efFechaEntrega(p);
    if (!f) return '<span class="chip chip-pend" style="font-size:10px">' + (esRetiro(p) ? 'Día a coordinar' : 'A asignar') + '</span>';
    return '<b>' + esc(diaSemanaDe(f)) + '</b><div class="small muted">' + fmtFecha(f)
      + (esRetiro(p) ? ' · retira' + (p.ventana ? ' ' + esc(p.ventana) : '') : '') + '</div>';
  }
  function renderPedidosTabla(box, list, opts) {
    if (!list.length) { box.innerHTML = `<div class="empty">No hay pedidos para mostrar.</div>`; return; }
    const sel = opts && opts.sel;            // Set de ids tildados (si la vista lo pide)
    const onSel = (opts && opts.onSel) || function () {};
    const checkable = !!sel;
    const todos = checkable && list.every((p) => sel.has(p.id));
    box.innerHTML = `<table><thead><tr>
        ${checkable ? `<th style="width:34px"><input type="checkbox" id="p-all" ${todos ? 'checked' : ''} title="Seleccionar todos"/></th>` : ''}
        <th>Cliente</th><th>Dirección</th><th>Localidad</th><th>Entrega</th><th>Estado</th><th></th>
      </tr></thead><tbody>${list.map((p) => `
        <tr${checkable && sel.has(p.id) ? ' style="background:var(--gris-cl)"' : ''}>
          ${checkable ? `<td><input type="checkbox" data-sel="${p.id}" ${sel.has(p.id) ? 'checked' : ''}/></td>` : ''}
          <td><b data-ver="${p.id}" style="cursor:pointer;text-decoration:underline;text-decoration-style:dotted" title="Ver detalle del pedido">${esc(p.cliente)}</b>${p.prioridad === 'alta' ? ' <span class="chip chip-no" style="font-size:10px">★ alta</span>' : ''}${p.origen === 'tienda' ? ' <span class="chip chip-asig" style="font-size:10px">🛒 Tienda</span>' : ''}${esRetiro(p) ? ' <span class="chip chip-retiro" style="font-size:10px">🏪 Retiro en sucursal</span>' : ''}<div class="small muted">${esc(p.entrecalles || '')}</div></td>
          <td class="small">${esRetiro(p) ? '<span class="muted">🏪 Retira en el local</span>' : esc(p.direccion) + (p.lat == null ? ' <span class="chip chip-no" style="font-size:10px">📍 falta ubicar</span>' : '')}</td>
          <td class="small">${p.localidad ? esc(p.localidad) : '<span class="muted">—</span>'}</td>
          <td class="small">${celdaEntrega(p)}</td>
          <td>${estadoChip(p)}${asignacionInfo(p)}</td>
          <td class="t-actions">
            ${esRetiro(p) && p.estado === 'pendiente' ? `<button class="btn btn-ghost btn-sm" data-retirado="${p.id}" title="Marcar como retirado por el cliente">✓</button>` : ''}
            ${esRetiro(p) ? `<button class="btn btn-ghost btn-sm" data-modo="${p.id}" title="Este pedido necesita envío: pasarlo a reparto">🚚</button>` : ''}
            ${p.estado === 'no_entregado' || p.estado === 'salteado' ? `<button class="btn btn-ghost btn-sm" data-reasig="${p.id}" title="Reabrir para reasignar a otra ruta">↻</button>` : ''}
            ${p.pod ? `<button class="btn btn-ghost btn-sm" data-pod="${p.id}" title="Ver comprobante de entrega">🧾</button>` : ''}
            ${GDO.Wpp && GDO.Wpp.tieneTel(p.telefono) ? `<button class="btn btn-ghost btn-sm" data-wpp="${p.id}" title="Avisar al cliente por WhatsApp">💬</button>` : ''}
            <button class="btn btn-ghost btn-sm" data-edit="${p.id}">✎</button>
            <button class="btn btn-ghost btn-sm" data-del="${p.id}">🗑</button>
          </td>
        </tr>`).join('')}</tbody></table>`;
    if (checkable) {
      const all = box.querySelector('#p-all');
      box.querySelectorAll('[data-sel]').forEach((cb) => cb.onchange = () => {
        if (cb.checked) sel.add(cb.dataset.sel); else sel.delete(cb.dataset.sel);
        const tr = cb.closest('tr'); if (tr) tr.style.background = cb.checked ? 'var(--gris-cl)' : '';
        if (all) all.checked = list.every((p) => sel.has(p.id));
        onSel();
      });
      if (all) all.onchange = () => {
        list.forEach((p) => { if (all.checked) sel.add(p.id); else sel.delete(p.id); });
        box.querySelectorAll('[data-sel]').forEach((cb) => {
          cb.checked = all.checked;
          const tr = cb.closest('tr'); if (tr) tr.style.background = all.checked ? 'var(--gris-cl)' : '';
        });
        onSel();
      };
    }
    box.querySelectorAll('[data-reasig]').forEach((b) => b.onclick = () => {
      const p = Store.pedido(b.dataset.reasig);
      confirmDlg(`Reabrir el pedido de "${p.cliente}" para reasignarlo. Vuelve a “Pendientes” y podés incluirlo en otra ruta. ¿Confirmás?`, () => {
        Store.reasignarPedido(p.id); toast('Pedido reabierto · ya podés reasignarlo', 'ok'); GDO.App.render();
      }, 'Reabrir');
    });
    box.querySelectorAll('[data-retirado]').forEach((b) => b.onclick = () => retiradoModal(Store.pedido(b.dataset.retirado)));
    box.querySelectorAll('[data-modo]').forEach((b) => b.onclick = () => modalidadModal(Store.pedido(b.dataset.modo)));
    box.querySelectorAll('[data-asig]').forEach((b) => b.onclick = () => asignacionModal(Store.pedido(b.dataset.asig)));
    box.querySelectorAll('[data-pod]').forEach((b) => b.onclick = () => podModal(Store.pedido(b.dataset.pod)));
    box.querySelectorAll('[data-wpp]').forEach((b) => b.onclick = () => wppModal(Store.pedido(b.dataset.wpp)));
    box.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => pedidoModal(b.dataset.edit, () => GDO.App.render()));
    box.querySelectorAll('[data-ver]').forEach((b) => b.onclick = () => pedidoModal(b.dataset.ver, () => GDO.App.render()));
    box.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
      const p = Store.pedido(b.dataset.del);
      confirmDlg(`¿Eliminar el pedido de "${p.cliente}"?`, () => { Store.deletePedido(p.id); toast('Pedido eliminado', 'ok'); GDO.App.render(); });
    });
  }
  /* ---- Tabla de RETIROS EN SUCURSAL (tablero) ----
     Mira otra cosa que la tabla de pedidos: acá no importa la dirección ni el
     chofer, importa QUÉ hay que preparar y PARA CUÁNDO dijo el cliente que pasa. */
  function renderRetirosTabla(box, list) {
    if (!list.length) { box.innerHTML = `<div class="empty">No hay retiros pendientes.</div>`; return; }
    const hoy = isoHoy();
    const fmtM = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
    // La franja horaria que eligió el cliente (o el aviso de que hay que
    // acordarla): es lo que dice a qué hora tiene que estar listo el pedido.
    const franja = (p) => p.ventana
      ? '<div class="small"><b>' + esc(p.ventana) + '</b></div>'
      : '<div class="small muted">horario a coordinar</div>';
    const cuando = (p) => {
      const f = efFechaEntrega(p);
      if (!f) return '<span class="chip chip-pend" style="font-size:10px">A coordinar</span>' + franja(p);
      const marca = f === hoy ? ' <span class="chip chip-retiro" style="font-size:10px">hoy</span>'
        : (f < hoy ? ' <span class="chip chip-no" style="font-size:10px">vencido</span>' : '');
      return '<b>' + esc(diaSemanaDe(f)) + '</b> ' + fmtFecha(f) + marca + franja(p);
    };
    box.innerHTML = `<table><thead><tr>
        <th>Cliente</th><th>Pedido</th><th>Pasa a retirar</th><th>Total</th><th></th>
      </tr></thead><tbody>${list.map((p) => `
        <tr>
          <td><b data-ver="${p.id}" style="cursor:pointer;text-decoration:underline;text-decoration-style:dotted" title="Ver detalle del pedido">${esc(p.cliente)}</b>
            ${p.origen === 'tienda' ? ' <span class="chip chip-asig" style="font-size:10px">🛒 Tienda</span>' : ''}
            <div class="small muted">${esc(p.telefono || '')}</div></td>
          <td class="small">${esc(resumenItems(p.items)) || '<span class="muted">Sin detalle</span>'}</td>
          <td class="small">${cuando(p)}</td>
          <td class="small">${p.totalEstimado ? fmtM(p.totalEstimado) : '<span class="muted">—</span>'}</td>
          <td class="t-actions">
            <button class="btn btn-verde btn-sm" data-retirado="${p.id}" title="El cliente ya lo retiró">✓ Retirado</button>
            <button class="btn btn-ghost btn-sm" data-modo="${p.id}" title="Este pedido necesita envío: pasarlo a reparto">🚚</button>
            ${GDO.Wpp && GDO.Wpp.tieneTel(p.telefono) ? `<button class="btn btn-ghost btn-sm" data-wpp="${p.id}" title="Avisar al cliente por WhatsApp">💬</button>` : ''}
            <button class="btn btn-ghost btn-sm" data-edit="${p.id}">✎</button>
          </td>
        </tr>`).join('')}</tbody></table>`;
    box.querySelectorAll('[data-retirado]').forEach((b) => b.onclick = () => retiradoModal(Store.pedido(b.dataset.retirado)));
    box.querySelectorAll('[data-modo]').forEach((b) => b.onclick = () => modalidadModal(Store.pedido(b.dataset.modo)));
    box.querySelectorAll('[data-wpp]').forEach((b) => b.onclick = () => wppModal(Store.pedido(b.dataset.wpp)));
    box.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => pedidoModal(b.dataset.edit, () => GDO.App.render()));
    box.querySelectorAll('[data-ver]').forEach((b) => b.onclick = () => pedidoModal(b.dataset.ver, () => GDO.App.render()));
  }
  GDO.Views.renderRetirosTabla = renderRetirosTabla;

  const resumenItems = (items) => (items || []).map((i) => `${i.cantidad}× ${i.producto}`).join(', ');

  // Si el pedido ya forma parte de un reparto, muestra una carpeta-enlace 🗂️
  // junto al estado. Al tocarla se abre una ventana con la ruta, el chofer y
  // demás datos, en vez de llenar de texto la lista / la página de inicio.
  const asignacionInfo = (p) => {
    if (!p.rutaId) return '';
    const r = Store.ruta(p.rutaId);
    if (!r) return '';
    return ` <button class="btn btn-ghost btn-sm" data-asig="${p.id}" title="Ver ruta y chofer asignados" style="margin-left:2px">🗂️</button>`;
  };

  // Ventana con el detalle de la asignación del pedido (ruta, chofer, vehículo,
  // posición en el recorrido, estado). Botón para abrir la ruta directamente.
  function asignacionModal(p) {
    const r = p && p.rutaId ? Store.ruta(p.rutaId) : null;
    if (!r) { toast('Este pedido no está asignado a ninguna ruta', 'err'); return; }
    const rep = r.repartidorId ? Store.user(r.repartidorId) : null;
    const veh = r.vehiculoId ? Store.vehiculos().find((v) => v.id === r.vehiculoId) : null;
    const orden = (r.orden && r.orden.length ? r.orden : r.pedidoIds) || [];
    const pos = orden.indexOf(p.id);
    const estRuta = (GDO.Views.ESTADO_RUTA && GDO.Views.ESTADO_RUTA[r.estado]) || r.estado;
    const fila = (lbl, val) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #f0f0f0"><span class="muted small">${lbl}</span><span style="text-align:right">${val}</span></div>`;
    modal({
      title: 'Asignación — ' + esc(p.cliente), width: 460,
      bodyHTML: `
        ${fila('Ruta', `<b>${esc(r.nombre)}</b>`)}
        ${fila('Estado de la ruta', estRuta)}
        ${fila('Fecha', r.fecha ? fmtFecha(r.fecha) : '—')}
        ${fila('Chofer', rep ? `<b>${esc(rep.nombre)}</b>${rep.telefono ? '<br><span class="small muted">' + esc(rep.telefono) + '</span>' : ''}` : '<span class="muted">Sin asignar</span>')}
        ${fila('Vehículo', veh ? esc(veh.nombre) + (veh.patente ? ' (' + esc(veh.patente) + ')' : '') : '<span class="muted">—</span>')}
        ${fila('Posición en el recorrido', pos >= 0 ? `Parada ${pos + 1} de ${orden.length}` : `${orden.length} paradas`)}
        ${fila('Estado del pedido', ESTADO_CHIP[p.estado] || p.estado)}`,
      footHTML: `<button class="btn btn-ghost" data-cancel>Cerrar</button><button class="btn btn-primary" data-open>Abrir la ruta ↗</button>`,
      onMount(node, close) {
        node.querySelector('[data-cancel]').onclick = close;
        node.querySelector('[data-open]').onclick = () => { close(); go('#/rutas/' + r.id); };
      },
    });
  }
  GDO.Views.asignacionModal = asignacionModal;

  /* ---- Cerrar un pedido de RETIRO: el cliente lo pasó a buscar ----
     Es el equivalente al "Entregado" del chofer, pero lo hace el mostrador: en
     un retiro no hay ruta ni celular del repartidor que lo marque. Queda como
     'entregado' para que cuente como venta en el CRM y en las métricas. */
  function retiradoModal(p) {
    if (!p) return;
    const f = efFechaEntrega(p);
    modal({
      title: 'Retiro en sucursal — ' + esc(p.cliente), width: 460,
      bodyHTML: `
        <div class="note">Confirmá que <b>${esc(p.cliente)}</b> pasó por el local y se llevó el pedido.
        ${f ? ' Había quedado para el <b>' + esc(diaSemanaDe(f)) + ' ' + fmtFecha(f) + '</b>.' : ''}</div>
        <div class="field"><label>¿Quién lo retiró? (opcional)</label>
          <input id="rt-quien" placeholder="Nombre de quien pasó a buscarlo"/>
          <span class="help">Queda registrado en el historial del pedido.</span></div>`,
      footHTML: `<button class="btn btn-ghost" data-cancel>Cancelar</button><button class="btn btn-verde" data-ok>✓ Sí, ya lo retiró</button>`,
      onMount(node, close) {
        node.querySelector('[data-cancel]').onclick = close;
        node.querySelector('[data-ok]').onclick = () => {
          Store.marcarRetirado(p.id, node.querySelector('#rt-quien').value.trim());
          toast('Pedido marcado como retirado ✓', 'ok');
          close(); GDO.App.render();
        };
      },
    });
  }
  GDO.Views.retiradoModal = retiradoModal;

  /* ---- Pasar un pedido de RETIRO a ENVÍO (y al revés) ----
     Pasa seguido: el cliente pidió para retirar y después no puede venir, o el
     pedido se hizo grande y conviene llevárselo. Al pasar a envío, el pedido
     entra al armado de rutas como cualquier otro (por eso pide dirección y la
     ubica en el mapa). Al pasar a retiro, se lo saca de la ruta en la que esté. */
  function modalidadModal(p, after) {
    if (!p) return;
    const aEnvio = esRetiro(p);
    const f = efFechaEntrega(p);
    modal({
      title: aEnvio ? 'Pasar a envío a domicilio' : 'Pasar a retiro en sucursal', width: 560,
      bodyHTML: aEnvio ? `
        <div class="note">El pedido de <b>${esc(p.cliente)}</b> está como <b>🏪 retiro en sucursal</b>.
          Al pasarlo a <b>🚚 envío a domicilio</b> entra en la lista de pedidos para armar la ruta.</div>
        <div class="form-grid">
          <div class="field col-2"><label>Dirección de entrega *</label>
            <input id="md-dir" autocomplete="off" value="${esc(p.direccion || '')}" placeholder="Calle 1234, Localidad"/></div>
          <div class="field"><label>Localidad</label><input id="md-loc" value="${esc(p.localidad || '')}"/></div>
          <div class="field"><label>Entre calles</label><input id="md-ec" value="${esc(p.entrecalles || '')}" placeholder="Calle A y Calle B"/></div>
          <div class="field"><label>Fecha de entrega</label><input id="md-fec" type="date" value="${esc(f)}"/></div>
          <div class="field"><label>Ventana horaria</label><input id="md-vent" value="${esc(p.ventana || '')}" placeholder="Ej: 8 a 11 hs"/></div>
          <div class="field col-2"><label>Ubicación (coordenadas o link de Google Maps)</label>
            <input id="md-coord" value="${p.lat != null ? p.lat + ', ' + p.lng : ''}" placeholder="Se completa sola con la dirección"/>
            <span class="help">Si no la encuentra, pegá acá el link o las coordenadas de Google Maps.</span></div>
        </div>` : `
        <div class="note">El pedido de <b>${esc(p.cliente)}</b> pasa a <b>🏪 retiro en sucursal</b>: sale del armado de rutas
          ${p.rutaId ? '<b>y se quita de la ruta en la que está</b>' : ''}. La dirección se conserva por si más adelante vuelve a ser un envío.</div>
        <div class="form-grid">
          <div class="field"><label>¿Qué día pasa a retirar?</label>
            <input id="md-fec" type="date" value="${esc(f)}"/>
            <span class="help">Acuña 1334, Villa Tesei · Lun a Sáb de 6:00 a 13:30. Podés dejarlo vacío si todavía no lo definió.</span></div>
          <div class="field"><label>Horario de retiro</label>
            <input id="md-vent" list="md-franjas" value="${esc(p.ventana || '')}" placeholder="Ej: 9:30 a 10:30 hs"/>
            <datalist id="md-franjas">${FRANJAS.map((x) => `<option value="${x}"></option>`).join('')}</datalist>
            <span class="help">Vacío = a coordinar.</span></div>
        </div>`,
      footHTML: `<button class="btn btn-ghost" data-cancel>Cancelar</button><button class="btn btn-primary" data-ok>${aEnvio ? '🚚 Pasar a envío' : '🏪 Pasar a retiro'}</button>`,
      onMount(node, close) {
        node.querySelector('[data-cancel]').onclick = close;
        if (aEnvio && GDO.Geo && GDO.Geo.attachAutocomplete) {
          GDO.Geo.attachAutocomplete(node.querySelector('#md-dir'), (it) => {
            if (it.lat != null) node.querySelector('#md-coord').value = it.lat.toFixed(6) + ', ' + it.lng.toFixed(6);
            if (it.localidad) node.querySelector('#md-loc').value = it.localidad;
          }, { provincia: 'Buenos Aires', departamento: 'Hurlingham' });
        }
        node.querySelector('[data-ok]').onclick = async () => {
          const fec = node.querySelector('#md-fec').value;
          if (!aEnvio) {
            Store.setModalidad(p.id, 'retiro', { fechaEntrega: fec, diaEntrega: '',
              ventana: node.querySelector('#md-vent').value.trim() });
            toast('Pedido pasado a retiro en sucursal', 'ok');
            close(); (after || (() => GDO.App.render()))(); return;
          }
          const dir = node.querySelector('#md-dir').value.trim();
          if (!dir) { toast('Para enviarlo hace falta la dirección', 'err'); return; }
          let coord = null;
          const cv = node.querySelector('#md-coord').value.trim();
          if (cv && GDO.Geo && GDO.Geo.parseLatLng) coord = GDO.Geo.parseLatLng(cv);
          if (!coord && cv) {
            const cm = cv.split(',').map((x) => parseFloat(x.trim()));
            if (cm.length === 2 && !isNaN(cm[0]) && !isNaN(cm[1])) coord = { lat: cm[0], lng: cm[1] };
          }
          const btn = node.querySelector('[data-ok]');
          if (!coord && GDO.Geo) {
            const prev = btn.textContent;
            btn.disabled = true; btn.textContent = 'Ubicando…';
            const g = await GDO.Geo.geocode(dir, node.querySelector('#md-ec').value.trim());
            btn.disabled = false; btn.textContent = prev;
            if (g) coord = { lat: g.lat, lng: g.lng };
            else toast('No se pudo ubicar la dirección: el pedido pasa igual, ubicalo con 📍', 'err');
          }
          Store.setModalidad(p.id, 'envio', {
            direccion: dir,
            localidad: node.querySelector('#md-loc').value.trim(),
            entrecalles: node.querySelector('#md-ec').value.trim(),
            ventana: node.querySelector('#md-vent').value.trim(),
            fechaEntrega: fec, diaEntrega: '',
            lat: coord ? coord.lat : null, lng: coord ? coord.lng : null,
          });
          toast('Pedido pasado a envío ✓ ya podés incluirlo en una ruta', 'ok');
          close(); (after || (() => GDO.App.render()))();
        };
      },
    });
  }
  GDO.Views.modalidadModal = modalidadModal;

  /* ---- Ver comprobante de entrega (foto + firma) ---- */
  function podModal(p) {
    if (!p || !p.pod) { toast('Este pedido no tiene comprobante', 'err'); return; }
    const pod = p.pod;
    const fecha = pod.ts ? new Date(pod.ts).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    modal({
      title: 'Comprobante — ' + esc(p.cliente), width: 480,
      bodyHTML: `
        ${fecha ? `<div class="note">Entregado el <b>${esc(fecha)}</b>${pod.receptor ? ' · recibió <b>' + esc(pod.receptor) + '</b>' : ''}.</div>` : ''}
        ${pod.foto ? `<div class="field"><label>Foto</label><img src="${pod.foto}" style="max-width:100%;border-radius:10px;border:1px solid #e3e3e3"/></div>` : ''}
        ${pod.firma ? `<div class="field"><label>Firma</label><img src="${pod.firma}" style="max-width:100%;border-radius:10px;border:1px solid #e3e3e3;background:#fff"/></div>` : ''}
        ${!pod.foto && !pod.firma ? '<div class="empty">Sin foto ni firma. Solo se registró la confirmación de entrega.</div>' : ''}`,
      footHTML: `<button class="btn btn-primary" data-cancel>Cerrar</button>`,
      onMount(node, close) { node.querySelector('[data-cancel]').onclick = close; },
    });
  }
  GDO.Views.podModal = podModal;

  /* ---- Avisar al cliente por WhatsApp ---- */
  // Abre wa.me con un mensaje armado. El operador elige el momento (salió,
  // está cerca, entregado, reprogramar) y revisa/edita el texto antes de enviar.
  function wppModal(p) {
    if (!p) return;
    if (!GDO.Wpp.tieneTel(p.telefono)) { toast('Este pedido no tiene teléfono cargado', 'err'); return; }
    const link = GDO.Wpp.seguimientoUrl(p.id);
    const plantillas = {
      salio: GDO.Wpp.msg('salio', p, { link }),
      cerca: GDO.Wpp.msg('cerca', p, { link }),
      entregado: GDO.Wpp.msg('entregado', p),
      reprogramar: GDO.Wpp.msg('reprogramar', p),
    };
    modal({
      title: 'Avisar a ' + esc(p.cliente) + ' por WhatsApp', width: 520,
      bodyHTML: `
        <div class="field"><label>Tipo de aviso</label>
          <select id="w-tipo">
            <option value="salio">🚚 Tu pedido salió</option>
            <option value="cerca">📍 Está por llegar</option>
            <option value="entregado">✅ Pedido entregado</option>
            <option value="reprogramar">🔁 Reprogramar entrega</option>
          </select></div>
        <div class="field"><label>Mensaje (podés editarlo)</label>
          <textarea id="w-msg" rows="6">${esc(plantillas.salio)}</textarea></div>
        <div class="note">Se abre WhatsApp con el mensaje listo. Vos tocás <b>Enviar</b> en WhatsApp.</div>`,
      footHTML: `<button class="btn btn-ghost" data-cancel>Cancelar</button><a class="btn btn-verde" data-send target="_blank">💬 Abrir WhatsApp</a>`,
      onMount(node, close) {
        const sel = node.querySelector('#w-tipo');
        const ta = node.querySelector('#w-msg');
        const send = node.querySelector('[data-send]');
        const refresh = () => { send.href = GDO.Wpp.link(p.telefono, ta.value); };
        sel.onchange = () => { ta.value = plantillas[sel.value]; refresh(); };
        ta.oninput = refresh;
        refresh();
        node.querySelector('[data-cancel]').onclick = close;
        // NOTA: el "En camino" del seguimiento lo enciende SOLO el chofer con su botón
        // "Avisar al cliente (está por llegar)" — es el único momento en tiempo real en
        // que sabemos que va hacia ese cliente. Desde el admin NO se marca en camino.
        send.onclick = () => { toast('WhatsApp abierto con el mensaje', 'ok'); setTimeout(close, 300); };
      },
    });
  }
  GDO.Views.wppModal = wppModal;

  /* ---- Buscador de cliente dentro del formulario de pedido ----
     Al escribir el nombre (o el teléfono) muestra los clientes que ya existen.
     Al elegir uno completa nombre, dirección, entre calles, localidad y teléfono
     con los datos EXACTOS de las compras anteriores. Eso es lo que mantiene el
     historial de cada cliente en una sola ficha en vez de partirlo en varias. */
  function montarBuscadorCliente(node) {
    const inp = node.querySelector('#f-cli');
    const box = node.querySelector('#f-cli-sug');
    const info = node.querySelector('#f-cli-info');
    if (!inp || !box || !GDO.CRM) return;

    let fichas = null;                       // se calcula una sola vez, al primer tecleo
    const cerrar = () => { box.innerHTML = ''; box.classList.remove('on'); };

    const completar = (f) => {
      inp.value = f.nombre;
      const set = (sel, v) => { const el = node.querySelector(sel); if (el && v && !el.value) el.value = v; };
      set('#f-dir', f.direccion); set('#f-loc', f.localidad);
      set('#f-ec', f.entrecalles); set('#f-tel', f.telefono);
      info.innerHTML = '✓ Cliente conocido · <b>' + f.nCompras + ' compra' + (f.nCompras === 1 ? '' : 's') + '</b>'
        + (f.ritmo != null ? ' · compra cada ' + f.ritmo + ' días' : '')
        + (f.habituales && f.habituales.length ? ' · suele llevar: ' + esc(GDO.CRM.listaProd(f.habituales)) : '');
      info.style.color = '#1d7a44';
      cerrar();
    };

    const buscar = () => {
      const q = GDO.CRM.norm(inp.value);
      const dig = inp.value.replace(/\D/g, '');
      info.innerHTML = ''; info.style.color = '';
      if (q.length < 2 && dig.length < 3) { cerrar(); return; }
      if (!fichas) fichas = GDO.CRM.fichas().filter((f) => f.pedidos.length);
      const hit = fichas.filter((f) => {
        if (dig.length >= 3 && String(f.telefono || '').replace(/\D/g, '').indexOf(dig) >= 0) return true;
        if (q.length < 2) return false;
        return (f.alias || [f.nombre]).some((n) => GDO.CRM.norm(n).indexOf(q) >= 0);
      }).slice(0, 6);
      if (!hit.length) { cerrar(); return; }
      box.innerHTML = hit.map((f, i) => `
        <button type="button" class="crm-ac-i" data-i="${i}">
          <b>${esc(f.nombre)}</b>
          <span>${f.nCompras} compra${f.nCompras === 1 ? '' : 's'} · ${esc(f.telefono || 'sin teléfono')} · ${esc(f.direccion || 'sin dirección')}</span>
        </button>`).join('');
      box.classList.add('on');
      box.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => completar(hit[+b.dataset.i]));
    };

    inp.addEventListener('input', buscar);
    inp.addEventListener('focus', buscar);
    inp.addEventListener('blur', () => setTimeout(cerrar, 180));  // deja llegar el click
    const tel = node.querySelector('#f-tel');
    if (tel) tel.addEventListener('blur', () => {
      // Si cargaron el teléfono primero, avisamos si ese número ya es de alguien.
      const d = tel.value.replace(/\D/g, '');
      if (d.length < 6 || inp.value.trim()) return;
      if (!fichas) fichas = GDO.CRM.fichas().filter((f) => f.pedidos.length);
      const f = fichas.filter((x) => String(x.telefono || '').replace(/\D/g, '').indexOf(d) >= 0)[0];
      if (f) completar(f);
    });
  }

  /* ---- Buscador de producto contra la LISTA DE PRECIOS ----
     Al elegir una opción se completan nombre exacto, unidad, precio del escalón
     y kilos (si se vende por pieza). La opción queda guardada en el renglón
     (`_op`) para poder recalcular el precio cuando cambie la cantidad; `_op` NO
     se guarda en el pedido (se saca antes de grabar). */
  function montarBuscadorProducto(inp, box, items, redraw, onTotal) {
    const i = +inp.dataset.itProd;
    const sug = box.querySelector('[data-it-sug="' + i + '"]');
    if (!sug || !GDO.Lista) return;
    const cerrar = () => { sug.innerHTML = ''; sug.classList.remove('on'); };

    const pintar = (lista) => {
      if (!lista.length) { cerrar(); return; }
      sug.innerHTML = lista.map((o, k) => {
        const esc2 = esc(o.nombre + (o.marca ? ' (' + o.marca + ')' : ''));
        const desde = o.tiers && o.tiers.length ? '$' + Number(o.tiers[o.tiers.length - 1].price).toLocaleString('es-AR') : '';
        return `<div class="crm-ac-it" data-k="${k}">
          <b>${esc2}</b>
          <span>por ${esc(o.unidad)}${o.kgPor ? ' de ' + o.kgPor + ' kg' : ''} · ${esc(o.seccion)}${desde ? ' · desde ' + desde : ''}</span>
        </div>`;
      }).join('');
      sug.classList.add('on');
      sug.querySelectorAll('[data-k]').forEach((el) => el.onmousedown = (ev) => {
        ev.preventDefault();
        const o = lista[+el.dataset.k];
        const it = items[i];
        // El mínimo de la lista manda (el trozado se vende por 5 kg).
        if (o.min && (Number(it.cantidad) || 0) < o.min) it.cantidad = o.min;
        const r = GDO.Lista.renglon(o, it.cantidad || 1);
        it.producto = r.producto; it.unidad = r.unidad; it.precio = r.precio; it.kg = r.kg;
        it._op = o;
        cerrar();
        redraw(); if (onTotal) onTotal();
      });
    };

    inp.oninput = () => {
      const it = items[i];
      it.producto = inp.value;
      it._op = null;                      // se escribió a mano: ya no es el de la lista
      const q = inp.value.trim();
      if (q.length < 2) { cerrar(); return; }
      if (!GDO.Lista.hay()) { GDO.Lista.cargar(() => pintar(GDO.Lista.buscar(q))); cerrar(); return; }
      pintar(GDO.Lista.buscar(q));
    };
    inp.onblur = () => setTimeout(cerrar, 150);
  }

  /* ---- Modal cargar / editar pedido ---- */
  function pedidoModal(id, after, prefill) {
    const p = id ? Store.pedido(id) : null;
    // Valores pre-cargados (p. ej. extraídos de una imagen) para un pedido NUEVO.
    const pf = (!p && prefill) ? prefill : {};
    const items = p ? JSON.parse(JSON.stringify(p.items || [])) : [{ producto: '', cantidad: 1 }];
    // Modalidad: envío a domicilio (lo de siempre) o retiro en sucursal. Un pedido
    // ya cargado sin el campo es de envío.
    let modIni = (p ? p.modalidad : pf.modalidad) === 'retiro' ? 'retiro' : 'envio';
    const m = modal({
      title: p ? 'Editar pedido' : 'Nuevo pedido', width: 680,
      bodyHTML: `
        <div class="form-grid">
          <div class="field col-2" style="position:relative"><label>Cliente *</label>
            <input id="f-cli" autocomplete="off" value="${esc(p ? p.cliente : (pf.cliente || ''))}" placeholder="Nombre del cliente / comercio — empezá a escribir y te lo busca"/>
            <div id="f-cli-sug" class="crm-ac"></div>
            <span class="help" id="f-cli-info"></span></div>
          <div class="field col-2"><label>¿Cómo lo recibe el cliente?</label>
            <div class="modsel" id="f-mod">
              <button type="button" data-mod="envio"${modIni === 'envio' ? ' class="on"' : ''}>🚚 Envío a domicilio</button>
              <button type="button" data-mod="retiro"${modIni === 'retiro' ? ' class="on"' : ''}>🏪 Retiro en sucursal</button>
            </div>
            <span class="help" id="f-mod-help"></span></div>
          <div class="field col-2" id="f-w-dir"><label id="f-lbl-dir">Dirección de entrega *</label><input id="f-dir" value="${esc(p ? p.direccion : (pf.direccion || ''))}" placeholder="Calle 1234, Localidad"/></div>
          <div class="field" id="f-w-loc"><label>Localidad</label><input id="f-loc" value="${esc(p ? (p.localidad || '') : (pf.localidad || ''))}" placeholder="Se completa al elegir la dirección"/></div>
          <div class="field" id="f-w-ec"><label>Entre calles</label><input id="f-ec" value="${esc(p ? p.entrecalles : (pf.entrecalles || ''))}" placeholder="Calle A y Calle B"/></div>
          <div class="field"><label>Teléfono</label><input id="f-tel" value="${esc(p ? p.telefono : (pf.telefono || ''))}" placeholder="11 5555-5555"/></div>
          <div class="field"><label id="f-lbl-fec">Fecha de entrega</label><input id="f-fec" type="date" value="${esc(p ? efFechaEntrega(p) : '')}"/>
            <span class="help" id="f-help-fec">${p && p.diaEntrega ? 'El cliente eligió <b>' + esc(p.diaEntrega) + '</b> · agendada al próximo. ' : ''}Podés cambiarla a mano.</span></div>
          <div class="field" id="f-w-vent"><label id="f-lbl-vent">Ventana horaria</label>
            <input id="f-vent" list="f-franjas" value="${esc(p ? p.ventana : '')}" placeholder="Ej: 8 a 11 hs"/>
            <datalist id="f-franjas">${FRANJAS.map((f) => `<option value="${f}"></option>`).join('')}</datalist></div>
          <div class="field"><label>Prioridad</label>
            <select id="f-prio">
              <option value="baja"${p&&p.prioridad==='baja'?' selected':''}>Baja</option>
              <option value="normal"${!p||p.prioridad==='normal'?' selected':''}>Normal</option>
              <option value="alta"${p&&p.prioridad==='alta'?' selected':''}>Alta</option>
            </select></div>
          <div class="field"><label>Forma de pago</label>
            <select id="f-pago">
              <option value=""${!(p?p.formaPago:pf.formaPago)?' selected':''}>— Sin especificar —</option>
              <option value="Efectivo al momento de la entrega"${(p?p.formaPago:pf.formaPago)==='Efectivo al momento de la entrega'?' selected':''}>Efectivo al momento de la entrega</option>
              <option value="Transferencia previo a la entrega"${(p?p.formaPago:pf.formaPago)==='Transferencia previo a la entrega'?' selected':''}>Transferencia previo a la entrega</option>
              <option value="QR al momento de la entrega"${(p?p.formaPago:pf.formaPago)==='QR al momento de la entrega'?' selected':''}>QR al momento de la entrega</option>
            </select></div>
          <div class="field"><label>⭐ Puntos GDO (al entregar)</label>
            <input id="f-pts" type="number" min="0" inputmode="numeric" value="${esc(p && p.puntos ? p.puntos : (pf.puntos || ''))}" placeholder="Ej: 12000"/>
            ${(p && p.clienteUid) ? '<span class="help" style="color:#1e8449">🛒 Pedido de un <b>socio del GDO CLUB</b> logueado' + (p.totalEstimado ? ' · el cliente declaró un total de $' + Number(p.totalEstimado).toLocaleString('es-AR') + ' (⚠️ dato del navegador del cliente: verificá el monto REAL antes de cargar los puntos)' : '') + '. Al entregar se le acreditan estos puntos automáticamente (sin escanear).</span>' : '<span class="help">Puntos que suma el socio del Club al confirmar la entrega (el cliente escanea el QR en la puerta). Vacío = no suma.</span>'}</div>
          <div class="field" id="f-w-coord"><label>Ubicación (coordenadas o link de Google Maps)</label>
            <input id="f-coord" value="${p && p.lat != null ? p.lat + ', ' + p.lng : ''}" placeholder="Se completa sola con la dirección"/>
            <button class="btn btn-dark btn-sm" id="f-geo" type="button" style="margin-top:6px;white-space:nowrap">📍 Usar mi ubicación actual</button>
            <span class="help">Se ubica sola desde la dirección al guardar. Si no la encuentra (o querés el punto exacto): abrí <b>Google Maps</b>, mantené apretado / clic derecho en el lugar, copiá el <b>link</b> o las <b>coordenadas</b> y pegalas acá. También podés tocar “Usar mi ubicación actual” si estás en la puerta.</span></div>
          <div class="field col-2"><label>Pedido (productos)</label>
            <div id="f-items"></div>
            <datalist id="f-unidades">${(GDO.Lista ? GDO.Lista.UNIDADES : ['kg', 'unidad']).map((u) => `<option value="${u}"></option>`).join('')}</datalist>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:6px">
              <button class="btn btn-ghost btn-sm" id="f-additem">+ Agregar producto</button>
              <span class="help" id="f-items-total"></span>
            </div>
            <span class="help" id="f-lista-estado">Escribí el producto y elegilo de la <b>lista de precios</b>: así vienen la unidad (kg, cajón, caja…) y el precio del escalón que corresponde.</span></div>
          <div class="field col-2"><label>Comentarios / especificaciones de entrega</label>
            <textarea id="f-esp" placeholder="Aclaraciones para el repartidor: a quién entregar, accesos, formas de pago, demoras habituales…">${esc(p ? p.especificaciones : (pf.especificaciones || ''))}</textarea></div>
        </div>`,
      footHTML: `<button class="btn btn-ghost" data-cancel>Cancelar</button><button class="btn btn-primary" data-save>${p ? 'Guardar cambios' : 'Crear pedido'}</button>`,
      onMount(node, close) {
        /* BUSCADOR DE CLIENTE. Es la pieza que evita que el mismo cliente se
           cargue dos veces con el nombre escrito distinto o con otro teléfono:
           si lo elegís de la lista, el pedido queda con exactamente los mismos
           datos que los anteriores y el historial se junta solo. Además avisa
           "ya compró N veces", que es información útil al tomar el pedido. */
        montarBuscadorCliente(node);

        /* MODALIDAD. Un retiro no tiene ruta ni ventana horaria ni punto en el
           mapa: lo único que hace falta saber es QUÉ DÍA pasa el cliente a
           buscarlo. Por eso el formulario cambia de forma según lo que se elija,
           en vez de pedir siempre todo. */
        let mod = modIni;
        const pintarModo = () => {
          node.querySelectorAll('#f-mod [data-mod]').forEach((b) => b.classList.toggle('on', b.dataset.mod === mod));
          const ret = mod === 'retiro';
          // En un retiro no hay recorrido que armar (fuera el mapa), pero SÍ
          // importa la hora: es cuándo tiene que estar listo el pedido.
          const coord = node.querySelector('#f-w-coord'); if (coord) coord.style.display = ret ? 'none' : '';
          node.querySelector('#f-lbl-vent').textContent = ret ? 'Horario de retiro' : 'Ventana horaria';
          node.querySelector('#f-vent').placeholder = ret ? 'Ej: 9:30 a 10:30 hs' : 'Ej: 8 a 11 hs';
          node.querySelector('#f-lbl-dir').innerHTML = ret ? 'Dirección del cliente <span class="muted">(opcional)</span>' : 'Dirección de entrega *';
          node.querySelector('#f-dir').placeholder = ret ? 'Sirve para la ficha del cliente' : 'Calle 1234, Localidad';
          node.querySelector('#f-lbl-fec').textContent = ret ? '¿Qué día pasa a retirar?' : 'Fecha de entrega';
          node.querySelector('#f-help-fec').innerHTML = ret
            ? 'Acuña 1334, Villa Tesei · Lun a Sáb de 6:00 a 13:30. Si todavía no lo definió, dejalo vacío.'
            : ((p && p.diaEntrega) ? 'El cliente eligió <b>' + esc(p.diaEntrega) + '</b> · agendada al próximo. Podés cambiarla a mano.' : 'Podés cambiarla a mano.');
          node.querySelector('#f-mod-help').innerHTML = ret
            ? '🏪 No entra al armado de rutas: el cliente lo pasa a buscar por el local.'
            : '🚚 Entra en la lista de pedidos para armar la ruta del día.';
        };
        node.querySelectorAll('#f-mod [data-mod]').forEach((b) => b.onclick = () => { mod = b.dataset.mod; pintarModo(); });
        pintarModo();

        /* RENGLONES DEL PEDIDO. Cada uno lleva producto, CANTIDAD y UNIDAD.
           La unidad no se adivina: sale de la lista de precios (un cajón de
           pollo se pide por cajón, la suprema fresca por kg, la congelada por
           caja de 12 kg). Al elegir el producto del buscador vienen pegados el
           nombre exacto, la unidad, el precio del escalón que corresponde a esa
           cantidad y, si se vende por pieza, los kilos. Si el producto no está
           en la lista se puede escribir a mano y elegir la unidad igual: lo que
           NO puede pasar es que quede una cantidad sin unidad, porque después en
           la comanda nadie sabe si son 20 cajones o 20 kilos. */
        const itemsBox = node.querySelector('#f-items');
        const fmtP = (n) => '$' + Number(n || 0).toLocaleString('es-AR');
        const totalItems = () => items.reduce((a, it) => a + (Number(it.cantidad) || 0) * (Number(it.precio) || 0), 0);
        const pintarTotal = () => {
          const t = node.querySelector('#f-items-total');
          const tot = totalItems();
          t.innerHTML = tot ? 'Total del pedido: <b>' + fmtP(tot) + '</b> <span class="muted">(con los precios de la lista)</span>' : '';
        };
        const drawItems = () => {
          itemsBox.innerHTML = items.map((it, i) => `
            <div class="it-row" data-it-row="${i}">
              <div class="it-prod">
                <input data-it-prod="${i}" autocomplete="off" placeholder="Producto — escribí y elegí de la lista" value="${esc(it.producto)}"/>
                <div class="crm-ac" data-it-sug="${i}"></div>
              </div>
              <input data-it-cant="${i}" type="number" min="0" step="any" value="${esc(it.cantidad)}" title="Cantidad"/>
              <input data-it-uni="${i}" list="f-unidades" placeholder="unidad" value="${esc(it.unidad || '')}" title="Unidad (kg, cajón, caja…)"/>
              <input data-it-pre="${i}" type="number" min="0" step="any" value="${esc(it.precio || '')}" placeholder="$ c/u" title="Precio por unidad"/>
              <button class="btn btn-ghost btn-sm" data-it-del="${i}" title="Quitar">✕</button>
            </div>
            ${prepFila(it, i)}
            <div class="it-nota"><input data-it-nota="${i}" value="${esc(it.nota || '')}" maxlength="120" placeholder="📝 Aclaración para este producto (opcional)"/></div>
            <div class="it-sub" data-it-sub="${i}">${subItem(it)}</div>`).join('');

          itemsBox.querySelectorAll('[data-it-cant]').forEach((el) => el.oninput = () => {
            const i = +el.dataset.itCant, it = items[i];
            it.cantidad = el.value === '' ? '' : +el.value;
            recalcPrecios();
            refrescarSub(i); pintarTotal();
          });
          itemsBox.querySelectorAll('[data-it-uni]').forEach((el) => el.oninput = () => {
            items[+el.dataset.itUni].unidad = el.value.trim();
            refrescarSub(+el.dataset.itUni);
          });
          itemsBox.querySelectorAll('[data-it-pre]').forEach((el) => el.oninput = () => {
            items[+el.dataset.itPre].precio = el.value === '' ? 0 : +el.value;
            refrescarSub(+el.dataset.itPre); pintarTotal();
          });
          itemsBox.querySelectorAll('[data-it-del]').forEach((el) => el.onclick = () => {
            items.splice(+el.dataset.itDel, 1);
            if (!items.length) items.push({ producto: '', cantidad: 1 });
            drawItems(); pintarTotal();
          });
          itemsBox.querySelectorAll('[data-it-nota]').forEach((el) => el.oninput = () => {
            items[+el.dataset.itNota].nota = el.value;
          });
          // Cómo lo quiere cortado. Cambiarlo NO redibuja todo: solo se marca el
          // botón elegido, así no se pierde lo que se estaba tipeando al lado.
          itemsBox.querySelectorAll('[data-it-prep]').forEach((el) => el.onclick = () => {
            const i = +el.dataset.itPrep;
            items[i].preparacion = el.dataset.op;
            itemsBox.querySelectorAll('[data-it-prep="' + i + '"]').forEach((b) => b.classList.toggle('on', b === el));
            // Cambiar el corte cambia el precio: el trabajo se cobra aparte.
            recalcPrecios(); pintarTotal();
          });
          /* "➕ otro corte": duplica el renglón para que el mismo producto vaya
             con dos preparaciones (3 kg fileteados + 2 en cubos). Se copia el
             producto, la unidad y el PRECIO —que es el del escalón del total, no
             el de cada pedacito— y se deja la cantidad en 0 para completarla. */
          itemsBox.querySelectorAll('[data-it-partir]').forEach((el) => el.onclick = () => {
            const i = +el.dataset.itPartir, o = items[i];
            const d = GDO.Lista ? GDO.Lista.prepDe(o.producto) : null;
            const usados = items.filter((x) => x.producto === o.producto).map((x) => x.preparacion);
            const libre = d ? (d.opciones.find((x) => usados.indexOf(x) < 0) || d.opciones[0]) : '';
            items.splice(i + 1, 0, { producto: o.producto, cantidad: 0, unidad: o.unidad,
              precio: o.precio, preparacion: libre, nota: '', _op: o._op });
            drawItems(); recalcPrecios(); pintarTotal();
          });
          itemsBox.querySelectorAll('[data-it-prod]').forEach((el) => montarBuscadorProducto(el, itemsBox, items, drawItems, pintarTotal));
          pintarTotal();
        };
        /* Opciones de corte del producto (suprema, cuarto trasero). Son las
           MISMAS que ve el cliente en la tienda: el que toma un pedido por
           teléfono tiene que poder ofrecer exactamente lo mismo. */
        function prepFila(it, i) {
          const d = GDO.Lista ? GDO.Lista.prepDe(it.producto) : null;
          if (!d) return '';
          const sel = it.preparacion || d.opciones[0];
          if (!it.preparacion) it.preparacion = sel;
          const rec = GDO.Lista.RECARGO_KG;
          return `<div class="it-preps"><span class="lbl">✂️ ${esc(d.titulo)}</span>${
            d.opciones.map((o) => `<button type="button" class="prepb${o === sel ? ' on' : ''}" data-it-prep="${i}" data-op="${esc(o)}" title="${GDO.Lista.prepConTrabajo(it.producto, o) ? 'Preparación: +$' + rec + ' por kg' : 'Sin cargo'}">${esc(o)}${GDO.Lista.prepConTrabajo(it.producto, o) ? ' <b>+$' + rec + '</b>' : ''}</button>`).join('')
          }<button type="button" class="btn btn-ghost btn-sm" data-it-partir="${i}" title="El cliente quiere una parte de cada forma">➕ otro corte</button></div>`;
        }
        /* Precios de todos los renglones que vinieron de la lista. El ESCALÓN se
           busca con el TOTAL DEL PRODUCTO, no con el de cada renglón: si un
           cliente pide 60 kg de suprema repartidos en 40 fileteados y 20 enteros,
           esos 60 kg pagan el escalón de 60 — repartir el pedido en dos cortes no
           puede salir más caro que pedirlo todo de una forma. */
        function recalcPrecios() {
          if (!GDO.Lista) return;
          const totales = {};
          items.forEach((x) => {
            if (!x._op) return;
            const k = x._op.nombre;
            totales[k] = (totales[k] || 0) + (Number(x.cantidad) || 0);
          });
          items.forEach((x, i) => {
            if (!x._op) return;
            const tot = totales[x._op.nombre] || 0;
            const r = GDO.Lista.renglon(x._op, Number(x.cantidad) || 0);
            x.kg = r.kg;
            // El trabajo de preparación (fileteado, en cubos, trozado) se cobra
            // $500 el kilo, igual que en la lista mayorista. El producto tal cual
            // no paga nada.
            x.precio = GDO.Lista.precioPorEscalon(x._op.tiers, x._op.kgPor ? tot * x._op.kgPor : tot)
              + GDO.Lista.prepRecargo(x.producto, x.preparacion);
            const pe = itemsBox.querySelector('[data-it-pre="' + i + '"]');
            if (pe) pe.value = x.precio || '';
            refrescarSub(i);
          });
        }
        function subItem(it) {
          const c = Number(it.cantidad) || 0;
          const uni = GDO.Lista ? GDO.Lista.etiqueta(it.unidad, c) : (it.unidad || 'unidades');
          const partes = [];
          if (c) partes.push('<b>' + c + ' ' + esc(uni) + '</b>');
          if (it.preparacion) partes.push('✂️ ' + esc(it.preparacion));
          // Los kilos solo aportan si la unidad NO es el kilo (ahí ya se dijeron).
          if (it.kg && String(it.unidad).toLowerCase() !== 'kg') partes.push(it.kg + ' kg');
          if (it.precio) partes.push(fmtP(it.precio) + ' c/' + esc(it.unidad || 'un') + ' = <b>' + fmtP(c * it.precio) + '</b>');
          return partes.join(' · ');
        }
        function refrescarSub(i) {
          const s = itemsBox.querySelector('[data-it-sub="' + i + '"]');
          if (s) s.innerHTML = subItem(items[i]);
        }
        drawItems();
        node.querySelector('#f-additem').onclick = () => { items.push({ producto: '', cantidad: 1 }); drawItems(); };
        // Traemos la lista de precios (usa la copia guardada al instante y se
        // refresca por atrás). No bloquea nada: si no hay internet ni copia, el
        // producto se escribe a mano y la unidad se elige de la lista fija.
        if (GDO.Lista) GDO.Lista.cargar(() => { const c = node.querySelector('#f-lista-estado'); if (c) c.textContent = ''; });
        node.querySelector('[data-cancel]').onclick = close;

        // Acepta "lat, lng" o un link de Google Maps pegado (saca las coords).
        const coordFromInput = () => {
          const v = node.querySelector('#f-coord').value;
          if (GDO.Geo && GDO.Geo.parseLatLng) {
            const r = GDO.Geo.parseLatLng(v);
            if (r) return r;
            if (GDO.Geo.esLinkCorto && GDO.Geo.esLinkCorto(v)) { toast('Ese es un link corto de Google Maps. Abrilo, copiá el link largo (el de la barra de direcciones) o las coordenadas, y pegalo.', 'err'); return null; }
          }
          const cm = v.split(',').map((x) => parseFloat(x.trim()));
          if (cm.length === 2 && !isNaN(cm[0]) && !isNaN(cm[1])) return { lat: cm[0], lng: cm[1] };
          return null;
        };

        // Tomar la ubicación GPS del dispositivo (ideal cuando el vendedor está
        // parado en la puerta del cliente: fija el punto exacto de entrega).
        node.querySelector('#f-geo').onclick = () => {
          const btn = node.querySelector('#f-geo');
          if (!navigator.geolocation) { toast('Este dispositivo no permite ubicación', 'err'); return; }
          const prev = btn.textContent;
          btn.disabled = true; btn.textContent = 'Ubicando…';
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              btn.disabled = false; btn.textContent = prev;
              node.querySelector('#f-coord').value = pos.coords.latitude.toFixed(6) + ', ' + pos.coords.longitude.toFixed(6);
              toast('Ubicación actual fijada ✓', 'ok');
            },
            (err) => {
              btn.disabled = false; btn.textContent = prev;
              toast(err && err.code === 1
                ? 'Permiso de ubicación denegado. Activalo para usar tu ubicación.'
                : 'No se pudo obtener tu ubicación. Probá de nuevo o cargá la dirección.', 'err');
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
          );
        };

        if (GDO.Geo && GDO.Geo.attachAutocomplete) {
          GDO.Geo.attachAutocomplete(node.querySelector('#f-dir'), (it) => {
            if (it.lat != null) node.querySelector('#f-coord').value = it.lat.toFixed(6) + ', ' + it.lng.toFixed(6);
            if (it.localidad) node.querySelector('#f-loc').value = it.localidad;
          }, { provincia: 'Buenos Aires', departamento: 'Hurlingham' });
        }

        node.querySelector('[data-save]').onclick = async () => {
          const cli = node.querySelector('#f-cli').value.trim();
          const dir = node.querySelector('#f-dir').value.trim();
          const esRet = mod === 'retiro';
          if (!cli) { toast('Completá el nombre del cliente', 'err'); return; }
          if (!esRet && !dir) { toast('Completá la dirección de entrega', 'err'); return; }
          let coord = esRet ? null : coordFromInput();
          // Si se EDITÓ la dirección pero las coordenadas siguen siendo las de antes
          // (el cliente/vendedor tipeó otra dirección sin elegir una sugerencia del
          // autocompletado, o no esperó a que cargue), las coords viejas quedarían
          // pegadas a la dirección nueva y la ruta seguiría apuntando al lugar viejo.
          // En ese caso forzamos re-geocodificar. Si el usuario fijó coords a mano
          // (GPS o pegadas), NO coinciden con las viejas y se respetan.
          if (p && coord && p.lat != null && p.lng != null
              && dir.toLowerCase() !== String(p.direccion || '').toLowerCase()
              && Math.abs(coord.lat - p.lat) < 1e-6 && Math.abs(coord.lng - p.lng) < 1e-6) {
            coord = null;
            node.querySelector('#f-coord').value = '';
          }
          // En un retiro no hace falta ubicar nada en el mapa: no hay recorrido.
          if (!coord && !esRet && GDO.Geo) {
            const btn = node.querySelector('[data-save]');
            const prev = btn.textContent;
            btn.disabled = true; btn.textContent = 'Ubicando…';
            const g = await GDO.Geo.geocode(dir, node.querySelector('#f-ec').value.trim());
            btn.disabled = false; btn.textContent = prev;
            if (g) { coord = { lat: g.lat, lng: g.lng }; if (g.localidad && !node.querySelector('#f-loc').value.trim()) node.querySelector('#f-loc').value = g.localidad; }
            else toast('No se pudo ubicar la dirección. El pedido se guarda, ubicalo luego con 📍.', 'err');
          }
          /* Renglones a guardar. Se saca `_op` (la opción de la lista, que solo
             servía para recalcular el precio mientras se editaba) y se guardan
             cantidad, UNIDAD, precio y kilos. La unidad es la que después deja
             que la comanda diga "20 cajones" y no un "20" a secas. */
          const clean = items.filter((i) => String(i.producto || '').trim()).map((i) => {
            const it = { producto: String(i.producto).trim(), cantidad: Number(i.cantidad) || 0 };
            if (i.unidad) it.unidad = String(i.unidad).trim();
            if (i.precio) it.precio = Number(i.precio) || 0;
            if (i.kg) it.kg = Number(i.kg) || 0;
            if (i.preparacion) it.preparacion = String(i.preparacion).trim();
            if (i.nota) it.nota = String(i.nota).trim();
            return it;
          });
          // Total del pedido con los precios de la lista: es lo que hace que
          // este pedido cuente en la facturación de Métricas (antes, un pedido
          // cargado a mano quedaba sin precio y no sumaba).
          const totalCalc = clean.reduce((a, i) => a + (i.cantidad || 0) * (i.precio || 0), 0);
          const data = {
            id: p ? p.id : undefined, cliente: cli, direccion: dir,
            localidad: node.querySelector('#f-loc').value.trim(),
            entrecalles: node.querySelector('#f-ec').value.trim(),
            telefono: node.querySelector('#f-tel').value.trim(),
            fechaEntrega: node.querySelector('#f-fec').value,
            ventana: node.querySelector('#f-vent').value.trim(),
            prioridad: node.querySelector('#f-prio').value,
            formaPago: node.querySelector('#f-pago').value,
            puntos: parseInt(node.querySelector('#f-pts').value, 10) || 0,
            especificaciones: node.querySelector('#f-esp').value.trim(),
            items: clean, lat: coord ? coord.lat : null, lng: coord ? coord.lng : null,
            modalidad: mod,
            // Solo lo pisamos si hay precios cargados: si el pedido se anotó sin
            // precios, no borramos un total que hubiera declarado el cliente.
            totalEstimado: totalCalc || (p ? p.totalEstimado : 0) || 0,
            creadoPor: p ? p.creadoPor : Store.current().id,
          };
          // Si un pedido que YA estaba en una ruta pasa a retiro, hay que sacarlo
          // de esa ruta (si no, queda una parada fantasma). Eso lo sabe hacer
          // setModalidad, así que en ese caso guardamos por ahí.
          if (p && esRetiro(p) !== esRet) {
            delete data.id;
            Store.setModalidad(p.id, mod, data);
          } else {
            Store.upsertPedido(data);
          }
          toast(p ? 'Pedido actualizado' : 'Pedido creado', 'ok');
          close(); after && after();
        };
      },
    });
    return m;
  }
  GDO.Views.pedidoModal = pedidoModal;

  /* ---------------- Usuarios y roles ---------------- */
  GDO.Views.usuarios = function (c) {
    c.innerHTML = `
      <div class="section-title"><h2>Usuarios y roles</h2></div>
      <div class="note">El <b>administrador</b> asigna los roles. Un usuario puede ser <b>vendedor y repartidor</b> a la vez.</div>
      <div class="toolbar"><div class="spacer"></div><button class="btn btn-primary" id="u-new">+ Nuevo usuario</button></div>
      <div class="panel"><div class="panel-b flush"><div id="u-tabla"></div></div></div>`;
    const draw = () => {
      const list = Store.users();
      c.querySelector('#u-tabla').innerHTML = `<table><thead><tr>
          <th>Nombre</th><th>Email</th><th>Roles</th><th>Estado</th><th></th></tr></thead><tbody>
        ${list.map((u) => `<tr>
          <td><b>${esc(u.nombre)}</b></td><td class="small">${esc(u.email)}</td>
          <td>${u.roles.map((r) => ROL_CHIP[r]).join(' ')}${Store.puedeCRM(u) ? ' <span class="chip crm-t-rev" title="Puede ver la ficha de clientes">📇 Clientes</span>' : ''}${Store.puedePromos(u) ? ' <span class="chip crm-t-vol" title="Puede publicar promos en la tienda">🖼️ Promos</span>' : ''}</td>
          <td>${u.activo ? '<span class="chip chip-entreg">Activo</span>' : '<span class="chip chip-no">Inactivo</span>'}</td>
          <td class="t-actions">
            <button class="btn btn-ghost btn-sm" data-edit="${u.id}">✎ Roles</button>
            ${u.id === Store.current().id ? '' : `<button class="btn btn-ghost btn-sm" data-del="${u.id}">🗑</button>`}
          </td></tr>`).join('')}</tbody></table>`;
      c.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => userModal(b.dataset.edit, draw));
      c.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
        const u = Store.user(b.dataset.del);
        confirmDlg(`¿Eliminar a "${u.nombre}"?`, () => { Store.deleteUser(u.id); toast('Usuario eliminado', 'ok'); draw(); });
      });
    };
    c.querySelector('#u-new').onclick = () => userModal(null, draw);
    draw();
  };

  function userModal(id, after) {
    const u = id ? Store.user(id) : null;
    const roles = u ? u.roles.slice() : ['vendedor'];
    const rolBox = (r, lbl) => `<label><input type="checkbox" value="${r}" ${roles.includes(r) ? 'checked' : ''}/> ${lbl}</label>`;
    modal({
      title: u ? 'Editar usuario' : 'Nuevo usuario', width: 520,
      bodyHTML: `
        <div class="form-grid">
          <div class="field col-2"><label>Nombre y apellido *</label><input id="u-nom" value="${esc(u ? u.nombre : '')}"/></div>
          <div class="field col-2"><label>Email *</label><input id="u-email" type="email" value="${esc(u ? u.email : '')}"/></div>
          <div class="field col-2"><div class="note" style="margin:0;font-size:12.5px">🔑 <b>El acceso (email + contraseña) se crea en la consola de Firebase</b>, no acá. En este panel definís el <b>nombre y los roles</b>; la persona entra por primera vez con la cuenta de Firebase y su perfil se vincula solo.</div></div>
          <div class="field col-2"><label>Roles asignados</label>
            <div class="roles-pick">${rolBox('admin', '👑 Administrador')}${rolBox('vendedor', '🏷️ Vendedor')}${rolBox('cajero', '💳 Cajero')}${rolBox('repartidor', '🚚 Repartidor')}</div>
            <span class="help">Administrador: acceso total · Vendedor: carga pedidos · Cajero: pedidos + Club (cargar puntos y escanear vouchers, con ticket obligatorio; no crea premios ni elimina) · Repartidor: ve sus rutas.</span></div>
          <div class="field col-2"><label>Permisos extra</label>
            <div class="roles-pick">
              <label><input type="checkbox" id="u-crm" ${u && u.crm ? 'checked' : ''}/> 📇 Ver Clientes (CRM)</label>
              <label><input type="checkbox" id="u-promos" ${u && u.promos ? 'checked' : ''}/> 🖼️ Cargar promos</label>
            </div>
            <span class="help">El <b>administrador siempre los tiene</b>; al resto se los habilitás acá, uno por uno. Sin el permiso, esa pestaña ni les aparece.<br>
              <b>Clientes:</b> la ficha de cada cliente, su historial de compras y la agenda de contacto.<br>
              <b>Promos:</b> las imágenes del menú inicial de la tienda. ⚠️ Ojo con este: lo que active esa persona <b>lo ve todo el que entra a la lista de precios</b>, al instante.</span></div>
          <div class="field col-2"><label><input type="checkbox" id="u-act" ${!u || u.activo ? 'checked' : ''} style="width:auto"/> Usuario activo (puede ingresar)</label></div>
        </div>`,
      footHTML: `<button class="btn btn-ghost" data-cancel>Cancelar</button><button class="btn btn-primary" data-save>Guardar</button>`,
      onMount(node, close) {
        node.querySelector('[data-cancel]').onclick = close;
        node.querySelector('[data-save]').onclick = () => {
          const nom = node.querySelector('#u-nom').value.trim();
          const email = node.querySelector('#u-email').value.trim();
          const rs = [...node.querySelectorAll('.roles-pick input:checked')].map((x) => x.value);
          if (!nom || !email) { toast('Completá nombre y email', 'err'); return; }
          if (!rs.length) { toast('Asigná al menos un rol', 'err'); return; }
          Store.upsertUser({
            id: u ? u.id : undefined, nombre: nom, email, roles: rs,
            crm: node.querySelector('#u-crm').checked,
            promos: node.querySelector('#u-promos').checked,
            activo: node.querySelector('#u-act').checked,
          });
          toast('Usuario guardado', 'ok'); close(); after && after();
        };
      },
    });
  }

  /* ---------------- Vehículos ---------------- */
  GDO.Views.vehiculos = function (c) {
    c.innerHTML = `
      <div class="section-title"><h2>Vehículos</h2></div>
      <div class="toolbar"><div class="spacer"></div><button class="btn btn-primary" id="v-new">+ Nuevo vehículo</button></div>
      <div class="panel"><div class="panel-b flush"><div id="v-tabla"></div></div></div>`;
    const draw = () => {
      const list = Store.vehiculos();
      c.querySelector('#v-tabla').innerHTML = list.length ? `<table><thead><tr><th>Vehículo</th><th>Patente</th><th>Tipo</th><th></th></tr></thead><tbody>
        ${list.map((v) => `<tr><td><b>${esc(v.nombre)}</b></td><td>${esc(v.patente)}</td><td class="small">${esc(v.tipo || '')}</td>
          <td class="t-actions"><button class="btn btn-ghost btn-sm" data-edit="${v.id}">✎</button><button class="btn btn-ghost btn-sm" data-del="${v.id}">🗑</button></td></tr>`).join('')}
        </tbody></table>` : `<div class="empty">Sin vehículos cargados.</div>`;
      c.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => vehModal(b.dataset.edit, draw));
      c.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { Store.deleteVehiculo(b.dataset.del); toast('Vehículo eliminado', 'ok'); draw(); });
    };
    c.querySelector('#v-new').onclick = () => vehModal(null, draw);
    draw();
  };
  function vehModal(id, after) {
    const v = id ? Store.vehiculos().find((x) => x.id === id) : null;
    modal({
      title: v ? 'Editar vehículo' : 'Nuevo vehículo', width: 460,
      bodyHTML: `<div class="form-grid">
        <div class="field col-2"><label>Nombre / identificación *</label><input id="v-nom" value="${esc(v ? v.nombre : '')}" placeholder="Ej: Camioneta blanca"/></div>
        <div class="field"><label>Patente</label><input id="v-pat" value="${esc(v ? v.patente : '')}"/></div>
        <div class="field"><label>Tipo</label><input id="v-tipo" value="${esc(v ? v.tipo : '')}" placeholder="Furgón, refrigerado…"/></div>
      </div>`,
      footHTML: `<button class="btn btn-ghost" data-cancel>Cancelar</button><button class="btn btn-primary" data-save>Guardar</button>`,
      onMount(node, close) {
        node.querySelector('[data-cancel]').onclick = close;
        node.querySelector('[data-save]').onclick = () => {
          const nom = node.querySelector('#v-nom').value.trim();
          if (!nom) { toast('Ingresá un nombre', 'err'); return; }
          Store.upsertVehiculo({ id: v ? v.id : undefined, nombre: nom, patente: node.querySelector('#v-pat').value.trim(), tipo: node.querySelector('#v-tipo').value.trim() });
          toast('Vehículo guardado', 'ok'); close(); after && after();
        };
      },
    });
  }
})();
