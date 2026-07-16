/* ====== Vistas: Administración / Vendedor ====== */
window.GDO = window.GDO || {}; GDO.Views = GDO.Views || {};
(function () {
  const { Store } = GDO;
  const { esc, h, toast, modal, confirmDlg, fmtFecha, proximoDiaFecha, diaSemanaDe, ESTADO_CHIP, ROL_CHIP } = GDO.UI;
  // Exponemos el detalle del pedido para poder abrirlo desde otras vistas (rutas) al tocar el pedido.
  GDO.pedidoModal = function (id, after, prefill) { return pedidoModal(id, after, prefill); };
  const go = (hash) => { location.hash = hash; };

  /* ---------------- Tablero ---------------- */
  GDO.Views.dashboard = function (c) {
    const peds = Store.pedidos();
    const cont = (e) => peds.filter((p) => p.estado === e).length;
    const rutasAct = Store.rutas().filter((r) => ['asignada', 'aceptada', 'en_curso'].includes(r.estado));
    c.innerHTML = `
      <div class="cards" style="margin-bottom:22px">
        <div class="card kpi naranja"><span class="ic">📦</span><span class="num">${peds.length}</span><span class="lbl">Pedidos totales</span></div>
        <div class="card kpi negro"><span class="ic">🕓</span><span class="num">${cont('pendiente')}</span><span class="lbl">Pendientes de asignar</span></div>
        <div class="card kpi amarillo"><span class="ic">🚚</span><span class="num">${rutasAct.length}</span><span class="lbl">Rutas activas</span></div>
        <div class="card kpi rojo"><span class="ic">⚠️</span><span class="num">${cont('no_entregado')}</span><span class="lbl">No entregados</span></div>
      </div>
      <div class="panel">
        <div class="panel-h"><h3>Pedidos recientes</h3><button class="btn btn-primary btn-sm" id="d-new">+ Nuevo pedido</button></div>
        <div class="panel-b flush"><div id="d-tabla"></div></div>
      </div>`;
    // Solo pedidos ACTIVOS (los entregados no ensucian el tablero; quedan guardados y se ven en Pedidos → "Entregado").
    renderPedidosTabla(c.querySelector('#d-tabla'), peds.filter((p) => p.estado !== 'entregado').slice(-6).reverse());
    c.querySelector('#d-new').onclick = () => pedidoModal(null, () => GDO.App.render());
  };

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
        <div class="spacer"></div>
        <a class="btn btn-ghost" href="tienda/index.html" target="_blank">🛒 Tienda online ↗</a>
        <button class="btn btn-ghost" id="p-ocr">📷 Desde imagen</button>
        <button class="btn btn-ghost" id="p-import">📥 Importar</button>
        <button class="btn btn-primary" id="p-new">+ Nuevo pedido</button>
      </div>
      <div class="note">Los pedidos hechos por los clientes en la <b>tienda online</b> entran acá automáticamente como “pendientes”. Solo resta ubicarlos en el mapa y asignarles chofer. El panel muestra los <b>pedidos activos</b>; los <b>entregados</b> quedan guardados (con su comprobante) y los ves eligiendo “Entregado” o “Todos”.</div>
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
      // Mantenemos tildado solo lo que se sigue viendo (al cambiar filtro/busqueda).
      const visibles = new Set(list.map((p) => p.id));
      [...sel].forEach((id) => { if (!visibles.has(id)) sel.delete(id); });
      renderPedidosTabla(c.querySelector('#p-tabla'), list, { sel, onSel: refreshBulk });
      refreshBulk();
    };
    c.querySelector('#p-q').oninput = draw;
    c.querySelector('#p-est').onchange = () => { sel.clear(); draw(); };
    c.querySelector('#p-new').onclick = () => pedidoModal(null, draw);
    c.querySelector('#p-ocr').onclick = () => ocrPedidoModal(draw);
    c.querySelector('#p-import').onclick = () => importModal(draw);
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
  function efFechaEntrega(p) { return (p && p.fechaEntrega) || (p && p.diaEntrega ? proximoDiaFecha(p.diaEntrega) : ''); }
  // Celda "Entrega": día de la semana (resaltado) + fecha, para armar rutas ordenado.
  function celdaEntrega(p) {
    const f = efFechaEntrega(p);
    if (!f) return '<span class="chip chip-pend" style="font-size:10px">A asignar</span>';
    return '<b>' + esc(diaSemanaDe(f)) + '</b><div class="small muted">' + fmtFecha(f) + '</div>';
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
          <td><b data-ver="${p.id}" style="cursor:pointer;text-decoration:underline;text-decoration-style:dotted" title="Ver detalle del pedido">${esc(p.cliente)}</b>${p.prioridad === 'alta' ? ' <span class="chip chip-no" style="font-size:10px">★ alta</span>' : ''}${p.origen === 'tienda' ? ' <span class="chip chip-asig" style="font-size:10px">🛒 Tienda</span>' : ''}<div class="small muted">${esc(p.entrecalles || '')}</div></td>
          <td class="small">${esc(p.direccion)}${p.lat == null ? ' <span class="chip chip-no" style="font-size:10px">📍 falta ubicar</span>' : ''}</td>
          <td class="small">${p.localidad ? esc(p.localidad) : '<span class="muted">—</span>'}</td>
          <td class="small">${celdaEntrega(p)}</td>
          <td>${ESTADO_CHIP[p.estado] || p.estado}${asignacionInfo(p)}</td>
          <td class="t-actions">
            ${p.estado === 'no_entregado' ? `<button class="btn btn-ghost btn-sm" data-reasig="${p.id}" title="Reabrir para reasignar a otra ruta">↻</button>` : ''}
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

  /* ---- Modal cargar / editar pedido ---- */
  function pedidoModal(id, after, prefill) {
    const p = id ? Store.pedido(id) : null;
    // Valores pre-cargados (p. ej. extraídos de una imagen) para un pedido NUEVO.
    const pf = (!p && prefill) ? prefill : {};
    const items = p ? JSON.parse(JSON.stringify(p.items || [])) : [{ producto: '', cantidad: 1 }];
    const m = modal({
      title: p ? 'Editar pedido' : 'Nuevo pedido', width: 680,
      bodyHTML: `
        <div class="form-grid">
          <div class="field col-2"><label>Cliente *</label><input id="f-cli" value="${esc(p ? p.cliente : (pf.cliente || ''))}" placeholder="Nombre del cliente / comercio"/></div>
          <div class="field col-2"><label>Dirección de entrega *</label><input id="f-dir" value="${esc(p ? p.direccion : (pf.direccion || ''))}" placeholder="Calle 1234, Localidad"/></div>
          <div class="field"><label>Localidad</label><input id="f-loc" value="${esc(p ? (p.localidad || '') : (pf.localidad || ''))}" placeholder="Se completa al elegir la dirección"/></div>
          <div class="field"><label>Entre calles</label><input id="f-ec" value="${esc(p ? p.entrecalles : (pf.entrecalles || ''))}" placeholder="Calle A y Calle B"/></div>
          <div class="field"><label>Teléfono</label><input id="f-tel" value="${esc(p ? p.telefono : (pf.telefono || ''))}" placeholder="11 5555-5555"/></div>
          <div class="field"><label>Fecha de entrega</label><input id="f-fec" type="date" value="${esc(p ? efFechaEntrega(p) : '')}"/>
            <span class="help">${p && p.diaEntrega ? 'El cliente eligió <b>' + esc(p.diaEntrega) + '</b> · agendada al próximo. ' : ''}Podés cambiarla a mano.</span></div>
          <div class="field"><label>Ventana horaria</label><input id="f-vent" value="${esc(p ? p.ventana : '')}" placeholder="Ej: 8 a 11 hs"/></div>
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
          <div class="field"><label>Ubicación (coordenadas o link de Google Maps)</label>
            <input id="f-coord" value="${p && p.lat != null ? p.lat + ', ' + p.lng : ''}" placeholder="Se completa sola con la dirección"/>
            <button class="btn btn-dark btn-sm" id="f-geo" type="button" style="margin-top:6px;white-space:nowrap">📍 Usar mi ubicación actual</button>
            <span class="help">Se ubica sola desde la dirección al guardar. Si no la encuentra (o querés el punto exacto): abrí <b>Google Maps</b>, mantené apretado / clic derecho en el lugar, copiá el <b>link</b> o las <b>coordenadas</b> y pegalas acá. También podés tocar “Usar mi ubicación actual” si estás en la puerta.</span></div>
          <div class="field col-2"><label>Pedido (productos)</label><div id="f-items"></div>
            <button class="btn btn-ghost btn-sm" id="f-additem" style="align-self:flex-start;margin-top:6px">+ Agregar producto</button></div>
          <div class="field col-2"><label>Comentarios / especificaciones de entrega</label>
            <textarea id="f-esp" placeholder="Aclaraciones para el repartidor: a quién entregar, accesos, formas de pago, demoras habituales…">${esc(p ? p.especificaciones : (pf.especificaciones || ''))}</textarea></div>
        </div>`,
      footHTML: `<button class="btn btn-ghost" data-cancel>Cancelar</button><button class="btn btn-primary" data-save>${p ? 'Guardar cambios' : 'Crear pedido'}</button>`,
      onMount(node, close) {
        const itemsBox = node.querySelector('#f-items');
        const drawItems = () => {
          itemsBox.innerHTML = items.map((it, i) => `
            <div style="display:flex;gap:8px;margin-bottom:6px">
              <input data-it-prod="${i}" placeholder="Producto" value="${esc(it.producto)}" style="flex:1"/>
              <input data-it-cant="${i}" type="number" min="1" value="${esc(it.cantidad)}" style="width:90px"/>
              <button class="btn btn-ghost btn-sm" data-it-del="${i}">✕</button>
            </div>`).join('');
          itemsBox.querySelectorAll('[data-it-prod]').forEach((el) => el.oninput = (e) => items[+el.dataset.itProd].producto = e.target.value);
          itemsBox.querySelectorAll('[data-it-cant]').forEach((el) => el.oninput = (e) => items[+el.dataset.itCant].cantidad = +e.target.value);
          itemsBox.querySelectorAll('[data-it-del]').forEach((el) => el.onclick = () => { items.splice(+el.dataset.itDel, 1); if (!items.length) items.push({ producto: '', cantidad: 1 }); drawItems(); });
        };
        drawItems();
        node.querySelector('#f-additem').onclick = () => { items.push({ producto: '', cantidad: 1 }); drawItems(); };
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
          if (!cli || !dir) { toast('Completá cliente y dirección', 'err'); return; }
          let coord = coordFromInput();
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
          if (!coord && GDO.Geo) {
            const btn = node.querySelector('[data-save]');
            const prev = btn.textContent;
            btn.disabled = true; btn.textContent = 'Ubicando…';
            const g = await GDO.Geo.geocode(dir, node.querySelector('#f-ec').value.trim());
            btn.disabled = false; btn.textContent = prev;
            if (g) { coord = { lat: g.lat, lng: g.lng }; if (g.localidad && !node.querySelector('#f-loc').value.trim()) node.querySelector('#f-loc').value = g.localidad; }
            else toast('No se pudo ubicar la dirección. El pedido se guarda, ubicalo luego con 📍.', 'err');
          }
          const clean = items.filter((i) => i.producto.trim());
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
            creadoPor: p ? p.creadoPor : Store.current().id,
          };
          Store.upsertPedido(data);
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
          <td>${u.roles.map((r) => ROL_CHIP[r]).join(' ')}</td>
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
          Store.upsertUser({ id: u ? u.id : undefined, nombre: nom, email, roles: rs, activo: node.querySelector('#u-act').checked });
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
