/* ====== Vistas: Administración / Vendedor ====== */
window.GDO = window.GDO || {}; GDO.Views = GDO.Views || {};
(function () {
  const { Store } = GDO;
  const { esc, h, toast, modal, confirmDlg, fmtFecha, ESTADO_CHIP, ROL_CHIP } = GDO.UI;
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
    renderPedidosTabla(c.querySelector('#d-tabla'), peds.slice(-6).reverse());
    c.querySelector('#d-new').onclick = () => pedidoModal(null, () => GDO.App.render());
  };

  /* ---------------- Pedidos ---------------- */
  GDO.Views.pedidos = function (c) {
    const soyVend = Store.rolActivo() === 'vendedor';
    c.innerHTML = `
      <div class="section-title"><h2>${soyVend ? 'Carga de pedidos' : 'Pedidos'}</h2></div>
      <div class="toolbar">
        <input type="search" id="p-q" placeholder="Buscar cliente o dirección…"/>
        <select id="p-est">
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option><option value="asignado">Asignado</option>
          <option value="en_ruta">En ruta</option><option value="entregado">Entregado</option>
          <option value="no_entregado">No entregado</option><option value="salteado">Salteado</option>
        </select>
        <div class="spacer"></div>
        <a class="btn btn-ghost" href="tienda.html" target="_blank">🛒 Tienda online ↗</a>
        <button class="btn btn-primary" id="p-new">+ Nuevo pedido</button>
      </div>
      <div class="note">Los pedidos hechos por los clientes en la <b>tienda online</b> entran acá automáticamente como “pendientes”. Solo resta ubicarlos en el mapa y asignarles chofer.</div>
      <div class="panel"><div class="panel-b flush"><div id="p-tabla"></div></div></div>`;
    const draw = () => {
      const q = c.querySelector('#p-q').value.toLowerCase();
      const est = c.querySelector('#p-est').value;
      let list = Store.pedidos().slice().reverse();
      if (soyVend) list = list.filter((p) => p.creadoPor === Store.current().id);
      if (q) list = list.filter((p) => (p.cliente + ' ' + p.direccion).toLowerCase().includes(q));
      if (est) list = list.filter((p) => p.estado === est);
      renderPedidosTabla(c.querySelector('#p-tabla'), list);
    };
    c.querySelector('#p-q').oninput = draw;
    c.querySelector('#p-est').onchange = draw;
    c.querySelector('#p-new').onclick = () => pedidoModal(null, draw);
    draw();
    if (GDO.Geo) GDO.Geo.locatePending(() => { if (document.body.contains(c)) draw(); });
  };

  function renderPedidosTabla(box, list) {
    if (!list.length) { box.innerHTML = `<div class="empty">No hay pedidos para mostrar.</div>`; return; }
    box.innerHTML = `<table><thead><tr>
        <th>Cliente</th><th>Dirección</th><th>Pedido</th><th>Entrega</th><th>Estado</th><th></th>
      </tr></thead><tbody>${list.map((p) => `
        <tr>
          <td><b>${esc(p.cliente)}</b>${p.prioridad === 'alta' ? ' <span class="chip chip-no" style="font-size:10px">★ alta</span>' : ''}${p.origen === 'tienda' ? ' <span class="chip chip-asig" style="font-size:10px">🛒 Tienda</span>' : ''}<div class="small muted">${esc(p.entrecalles || '')}</div></td>
          <td class="small">${esc(p.direccion)}${p.lat == null ? ' <span class="chip chip-no" style="font-size:10px">📍 falta ubicar</span>' : ''}</td>
          <td class="small">${esc(resumenItems(p.items))}</td>
          <td class="small">${p.fechaEntrega ? fmtFecha(p.fechaEntrega) : '<span class="chip chip-pend" style="font-size:10px">A asignar</span>'}</td>
          <td>${ESTADO_CHIP[p.estado] || p.estado}</td>
          <td class="t-actions">
            <button class="btn btn-ghost btn-sm" data-edit="${p.id}">✎</button>
            <button class="btn btn-ghost btn-sm" data-del="${p.id}">🗑</button>
          </td>
        </tr>`).join('')}</tbody></table>`;
    box.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => pedidoModal(b.dataset.edit, () => GDO.App.render()));
    box.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
      const p = Store.pedido(b.dataset.del);
      confirmDlg(`¿Eliminar el pedido de "${p.cliente}"?`, () => { Store.deletePedido(p.id); toast('Pedido eliminado', 'ok'); GDO.App.render(); });
    });
  }
  const resumenItems = (items) => (items || []).map((i) => `${i.cantidad}× ${i.producto}`).join(', ');

  /* ---- Modal cargar / editar pedido ---- */
  function pedidoModal(id, after) {
    const p = id ? Store.pedido(id) : null;
    const items = p ? JSON.parse(JSON.stringify(p.items || [])) : [{ producto: '', cantidad: 1 }];
    const m = modal({
      title: p ? 'Editar pedido' : 'Nuevo pedido', width: 680,
      bodyHTML: `
        <div class="form-grid">
          <div class="field col-2"><label>Cliente *</label><input id="f-cli" value="${esc(p ? p.cliente : '')}" placeholder="Nombre del cliente / comercio"/></div>
          <div class="field col-2"><label>Dirección de entrega *</label><input id="f-dir" value="${esc(p ? p.direccion : '')}" placeholder="Calle 1234, Localidad"/></div>
          <div class="field"><label>Entre calles</label><input id="f-ec" value="${esc(p ? p.entrecalles : '')}" placeholder="Calle A y Calle B"/></div>
          <div class="field"><label>Teléfono</label><input id="f-tel" value="${esc(p ? p.telefono : '')}" placeholder="11 5555-5555"/></div>
          <div class="field"><label>Fecha de entrega</label><input id="f-fec" type="date" value="${esc(p ? p.fechaEntrega : '')}"/>
            <span class="help">Opcional. Se asigna sola al armar la ruta.</span></div>
          <div class="field"><label>Ventana horaria</label><input id="f-vent" value="${esc(p ? p.ventana : '')}" placeholder="Ej: 8 a 11 hs"/></div>
          <div class="field"><label>Prioridad</label>
            <select id="f-prio">
              <option value="baja"${p&&p.prioridad==='baja'?' selected':''}>Baja</option>
              <option value="normal"${!p||p.prioridad==='normal'?' selected':''}>Normal</option>
              <option value="alta"${p&&p.prioridad==='alta'?' selected':''}>Alta</option>
            </select></div>
          <div class="field"><label>Ubicación en el mapa (lat, lng)</label>
            <div style="display:flex;gap:8px">
              <input id="f-coord" value="${p && p.lat != null ? p.lat + ', ' + p.lng : ''}" placeholder="Se completa al ubicar la dirección" style="flex:1"/>
              <button class="btn btn-dark btn-sm" id="f-geo" type="button" style="white-space:nowrap">📍 Ubicar</button>
            </div>
            <span class="help">Se ubica sola desde la dirección al guardar. También podés tocar “Ubicar” para verlo antes.</span></div>
          <div class="field col-2"><label>Pedido (productos)</label><div id="f-items"></div>
            <button class="btn btn-ghost btn-sm" id="f-additem" style="align-self:flex-start;margin-top:6px">+ Agregar producto</button></div>
          <div class="field col-2"><label>Comentarios / especificaciones de entrega</label>
            <textarea id="f-esp" placeholder="Aclaraciones para el repartidor: a quién entregar, accesos, formas de pago, demoras habituales…">${esc(p ? p.especificaciones : '')}</textarea></div>
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

        const coordFromInput = () => {
          const cm = node.querySelector('#f-coord').value.split(',').map((x) => parseFloat(x.trim()));
          if (cm.length === 2 && !isNaN(cm[0]) && !isNaN(cm[1])) return { lat: cm[0], lng: cm[1] };
          return null;
        };

        node.querySelector('#f-geo').onclick = async () => {
          const dir = node.querySelector('#f-dir').value.trim();
          if (!dir) { toast('Escribí la dirección primero', 'err'); return; }
          const btn = node.querySelector('#f-geo');
          const prev = btn.textContent;
          btn.disabled = true; btn.textContent = 'Ubicando…';
          const g = GDO.Geo ? await GDO.Geo.geocode(dir) : null;
          btn.disabled = false; btn.textContent = prev;
          if (g) {
            node.querySelector('#f-coord').value = g.lat.toFixed(6) + ', ' + g.lng.toFixed(6);
            toast('Dirección ubicada ✓', 'ok');
          } else {
            toast('No se pudo ubicar la dirección. Revisala o cargá las coordenadas a mano.', 'err');
          }
        };

        if (GDO.Geo && GDO.Geo.attachAutocomplete) {
          GDO.Geo.attachAutocomplete(node.querySelector('#f-dir'), (it) => {
            if (it.lat != null) node.querySelector('#f-coord').value = it.lat.toFixed(6) + ', ' + it.lng.toFixed(6);
          }, { provincia: 'Buenos Aires', departamento: 'Hurlingham' });
        }

        node.querySelector('[data-save]').onclick = async () => {
          const cli = node.querySelector('#f-cli').value.trim();
          const dir = node.querySelector('#f-dir').value.trim();
          if (!cli || !dir) { toast('Completá cliente y dirección', 'err'); return; }
          let coord = coordFromInput();
          if (!coord && GDO.Geo) {
            const btn = node.querySelector('[data-save]');
            const prev = btn.textContent;
            btn.disabled = true; btn.textContent = 'Ubicando…';
            const g = await GDO.Geo.geocode(dir);
            btn.disabled = false; btn.textContent = prev;
            if (g) coord = { lat: g.lat, lng: g.lng };
            else toast('No se pudo ubicar la dirección. El pedido se guarda, ubicalo luego con 📍.', 'err');
          }
          const clean = items.filter((i) => i.producto.trim());
          const data = {
            id: p ? p.id : undefined, cliente: cli, direccion: dir,
            entrecalles: node.querySelector('#f-ec').value.trim(),
            telefono: node.querySelector('#f-tel').value.trim(),
            fechaEntrega: node.querySelector('#f-fec').value,
            ventana: node.querySelector('#f-vent').value.trim(),
            prioridad: node.querySelector('#f-prio').value,
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
          <div class="field"><label>Email *</label><input id="u-email" type="email" value="${esc(u ? u.email : '')}"/></div>
          <div class="field"><label>Contraseña</label><input id="u-pass" value="${esc(u ? u.pass : '1234')}"/></div>
          <div class="field col-2"><label>Roles asignados</label>
            <div class="roles-pick">${rolBox('admin', '👑 Administrador')}${rolBox('vendedor', '🏷️ Vendedor')}${rolBox('repartidor', '🚚 Repartidor')}</div>
            <span class="help">Administrador: acceso total · Vendedor: carga pedidos · Repartidor: ve sus rutas.</span></div>
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
          Store.upsertUser({ id: u ? u.id : undefined, nombre: nom, email, pass: node.querySelector('#u-pass').value, roles: rs, activo: node.querySelector('#u-act').checked });
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
