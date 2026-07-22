/* ====== GDO Reparto — app shell + router ====== */
window.GDO = window.GDO || {};
(function () {
  const { Store } = GDO;
  const { esc, h, hace } = GDO.UI;
  const V = GDO.Views;
  const root = () => document.getElementById('app');
  // Versión visible en el pie (subir junto con el CACHE del sw.js en cada deploy)
  // para verificar de un vistazo que la app esté actualizada.
  const VERSION = 'v65';
  GDO.VERSION = VERSION;
  GDO.footHTML = () => `<div class="gdo-foot" style="text-align:center;font-size:10.5px;color:#9a9a9d;padding:16px 10px 26px;opacity:.85;line-height:1.4">Propiedad de Granja del Oeste<sup style="font-size:8px">®</sup> · ${VERSION}</div>`;

  const NAV = {
    admin: [
      { hash: '#/panel', ic: '📊', t: 'Tablero' },
      { hash: '#/pedidos', ic: '📦', t: 'Pedidos' },
      { hash: '#/rutas', ic: '🗺️', t: 'Rutas' },
      { hash: '#/club', ic: '⭐', t: 'GDO Club' },
      { hash: '#/usuarios', ic: '👥', t: 'Usuarios y roles' },
      { hash: '#/vehiculos', ic: '🚚', t: 'Vehículos' },
    ],
    vendedor: [
      { hash: '#/pedidos', ic: '📦', t: 'Carga de pedidos' },
    ],
    cajero: [
      { hash: '#/pedidos', ic: '📦', t: 'Carga de pedidos' },
      { hash: '#/club', ic: '⭐', t: 'GDO Club' },
    ],
  };

  function rolesDisponibles(u) { return u.roles; }

  function go(hash) { location.hash = hash; }

  const App = {
    // Cerrar sesión: limpia la sesión local + cierra Firebase Auth y recarga
    // para dejar todo en estado limpio (sin listeners de Firestore colgados).
    logout() { Store.logout(); location.reload(); },
    render,
    go,
  };
  GDO.App = App;

  let _pendingHash = null;   // ruta a retomar después del login (p. ej. validar voucher)

  function render() {
    const u = Store.current();
    const hash = location.hash || (u ? '#/inicio' : '#/login');

    if (!u) {
      if (hash.indexOf('#/v/') === 0) _pendingHash = hash;  // venía a validar un voucher
      V.login(root(), () => { afterLogin(); }); return;
    }

    // Validar voucher por link (QR del voucher = link a esta ruta). Pantalla propia,
    // sirve para cualquier rol del personal (las reglas exigen staff igual).
    if (hash.indexOf('#/v/') === 0 && V.validarVoucher) { return V.validarVoucher(root(), hash.split('/')[2]); }

    const rol = Store.rolActivo();

    // ---- socio del GDO CLUB (no es personal): su tarjeta + puntos + aviso ----
    if (rol === 'socio') return renderSocio(u && u.socio);

    // ---- experiencia repartidor (mobile, sin sidebar) ----
    if (rol === 'repartidor') {
      if (hash.startsWith('#/ruta/')) return V.rutaChofer(root(), hash.split('/')[2]);
      return V.misRutas(root());
    }

    // ---- experiencia admin / vendedor (sidebar) ----
    renderShell(u, rol);
    const content = document.getElementById('app-content');
    routeContent(content, hash, rol);
  }

  function afterLogin() {
    const u = Store.current();
    const rol = Store.rolActivo();
    if (GDO.Notify) { GDO.Notify.rebaseline(); GDO.Notify.request(); }
    if (_pendingHash) { const h = _pendingHash; _pendingHash = null; go(h); render(); return; }
    go(rol === 'socio' ? '#/socio' : (rol === 'repartidor' ? '#/mis-rutas' : (rol === 'vendedor' ? '#/pedidos' : '#/panel')));
    render();
  }

  function routeContent(c, hash, rol) {
    const parts = hash.split('/');
    if (hash.startsWith('#/rutas/')) return V.rutaEditor(c, parts[2]);
    switch (hash) {
      case '#/panel': return rol === 'admin' ? V.dashboard(c) : V.pedidos(c);
      case '#/pedidos': return V.pedidos(c);
      case '#/rutas': return V.rutas(c);
      case '#/club': return (rol === 'admin' || rol === 'cajero') ? V.club(c) : V.pedidos(c);
      case '#/usuarios': return rol === 'admin' ? V.usuarios(c) : V.pedidos(c);
      case '#/vehiculos': return rol === 'admin' ? V.vehiculos(c) : V.pedidos(c);
      default: return rol === 'admin' ? V.dashboard(c) : V.pedidos(c);
    }
  }

  function renderShell(u, rol) {
    const nav = NAV[rol] || NAV.vendedor;
    const hash = location.hash;
    const noLeidas = Store.noLeidas(u.id);
    root().className = '';
    root().innerHTML = `
      <div class="app">
        <aside class="sidebar">
          <div class="brand"><img src="assets/logo-horizontal-blanco.svg" alt="Granja del Oeste"/></div>
          <nav class="nav">
            ${nav.map((n) => `<a data-hash="${n.hash}" class="${hash.startsWith(n.hash) ? 'active' : ''}"><span class="ic">${n.ic}</span>${n.t}</a>`).join('')}
          </nav>
          <div class="user-box">
            <div class="name">${esc(u.nombre)}</div>
            <div style="margin:6px 0">${u.roles.map((r) => GDO.UI.ROL_CHIP[r]).join(' ')}</div>
            ${u.roles.length > 1 ? `<select id="rol-sw" style="margin-top:6px">${u.roles.map((r) => `<option value="${r}"${r===rol?' selected':''}>Ver como: ${r}</option>`).join('')}</select>` : ''}
            <button class="btn btn-ghost btn-sm btn-block" id="sb-logout" style="margin-top:10px;color:#fff;border-color:#3a3a3d">Cerrar sesión</button>
          </div>
        </aside>
        <div class="main">
          <header class="topbar">
            <h1 id="tb-title">${titleFor(hash, rol)}</h1>
            <div class="actions">
              <span class="tb-user" title="Sesión activa">${esc(u.nombre.split(' ')[0])}</span>
              <button class="bell" id="bell">🔔${noLeidas ? `<span class="badge">${noLeidas}</span>` : ''}</button>
              <button class="bell tb-logout" id="tb-logout" title="Cerrar sesión" aria-label="Cerrar sesión">🚪</button>
            </div>
          </header>
          <div class="content" id="app-content"></div>
          ${GDO.footHTML()}
        </div>
      </div>
      <nav class="mobile-tabbar">
        ${nav.slice(0, 5).map((n) => `<a data-hash="${n.hash}" class="${hash.startsWith(n.hash) ? 'active' : ''}"><span class="ic">${n.ic}</span>${n.t.split(' ')[0]}</a>`).join('')}
      </nav>`;

    root().querySelectorAll('[data-hash]').forEach((a) => a.onclick = () => go(a.dataset.hash));
    root().querySelector('#sb-logout').onclick = () => App.logout();
    const tbLo = root().querySelector('#tb-logout');
    if (tbLo) tbLo.onclick = () => App.logout();
    const sw = root().querySelector('#rol-sw');
    if (sw) sw.onchange = () => { Store.setRolActivo(sw.value); afterLogin(); };
    root().querySelector('#bell').onclick = (e) => { e.stopPropagation(); toggleNotif(u); };
  }

  function titleFor(hash, rol) {
    if (hash.startsWith('#/rutas/')) return 'Armador de ruta';
    const map = { '#/panel': 'Tablero', '#/pedidos': rol === 'vendedor' ? 'Carga de pedidos' : 'Pedidos', '#/rutas': 'Rutas', '#/club': 'GDO Club', '#/usuarios': 'Usuarios y roles', '#/vehiculos': 'Vehículos' };
    return map[hash] || 'Granja del Oeste';
  }

  /* ---------- Notificaciones ---------- */
  function toggleNotif(u) {
    const ex = document.querySelector('.notif-pop');
    if (ex) { ex.remove(); return; }
    const list = Store.notifDe(u.id);
    const pop = h(`<div class="notif-pop">
      <div class="nh"><b>Notificaciones</b>${list.length ? '<span class="nh-acc"><button class="btn btn-ghost btn-sm" id="n-read">Marcar leídas</button><button class="btn btn-ghost btn-sm" id="n-clear">Borrar todas</button></span>' : ''}</div>
      <div class="notif-list">${list.length ? list.map((n) => `
        <div class="notif-item ${n.leida ? '' : 'unread'}">
          ${n.leida ? '' : '<div class="dot"></div>'}
          <div class="notif-tx"><div class="tx">${esc(n.mensaje)}</div><div class="ts">${hace(n.ts)}</div></div>
          <button class="notif-del" data-id="${n.id}" title="Borrar" aria-label="Borrar">✕</button>
        </div>`).join('') : '<div class="empty">Sin notificaciones.</div>'}</div>
    </div>`);
    document.body.appendChild(pop);
    const rb = pop.querySelector('#n-read');
    if (rb) rb.onclick = () => { Store.marcarLeidas(u.id); pop.remove(); render(); };
    const cb = pop.querySelector('#n-clear');
    if (cb) cb.onclick = () => { Store.borrarNotifsDe(u.id); pop.remove(); render(); };
    pop.querySelectorAll('.notif-del').forEach((b) => {
      b.onclick = (ev) => {
        ev.stopPropagation();
        Store.borrarNotif(b.getAttribute('data-id'));
        pop.remove(); toggleNotif(u); render();
      };
    });
    setTimeout(() => document.addEventListener('click', function cls(e) {
      if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', cls); }
    }), 0);
  }

  function landingHash() {
    const u = Store.current();
    if (!u) return '#/login';
    const rol = Store.rolActivo();
    return rol === 'socio' ? '#/socio' : (rol === 'repartidor' ? '#/mis-rutas' : (rol === 'vendedor' ? '#/pedidos' : '#/panel'));
  }

  // Vista del SOCIO del club cuando entra al sistema de reparto (su cuenta es de
  // socio, no de personal): le mostramos su tarjeta + puntos y lo derivamos a la
  // tienda (lista.granjadeloeste.com/club), que es donde el club funciona para socios.
  function renderSocio(s) {
    s = s || {};
    const nro = ('0000' + (s.nroSocio || 0)).slice(-4);
    const pts = Number(s.puntos || 0).toLocaleString('es-AR');
    root().className = '';
    root().innerHTML = `
      <div style="min-height:100vh;background:#0f0f0f;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;gap:16px">
        <div style="width:100%;max-width:400px">
          <div style="background:linear-gradient(135deg,#1f1f22,#000);border:1px solid #333;border-radius:18px;padding:22px;color:#fff;box-shadow:0 14px 44px rgba(0,0,0,.55)">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
              <span style="width:40px;height:40px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 0 0 2px rgba(245,130,32,.6)"><img src="assets/isotipo-color.svg" alt="GDO" style="width:27px;height:27px"/></span>
              <div style="font-family:'Zilla Slab',serif;font-weight:800;font-size:18px;letter-spacing:.5px">GDO <span style="color:#F58220">CLUB</span></div>
            </div>
            <div style="font-size:12px;color:#9a9a9d;text-transform:uppercase;letter-spacing:.5px">Socio</div>
            <div style="font-size:21px;font-weight:800;line-height:1.15">${esc(s.nombre || 'Socio')}</div>
            <div style="font-size:12.5px;color:#8a8a8d;margin-top:3px">N° ${nro}</div>
            <div style="margin-top:18px;display:flex;align-items:baseline;gap:9px;border-top:1px solid #2a2a2d;padding-top:14px">
              <span style="font-size:13px;color:#9a9a9d">Tus puntos</span>
              <span style="font-size:32px;font-weight:900;color:#F58220;font-family:'Zilla Slab',serif">${pts}</span>
            </div>
          </div>
          <div style="background:#15110a;border:1px solid #3a2a12;border-left:4px solid #F58220;color:#e8d4b0;border-radius:12px;padding:14px 16px;margin-top:16px;text-align:center;font-size:14px;line-height:1.55">
            🐔 Esta es la app del <b>equipo de reparto</b>.<br>Para ver tu tarjeta y <b>canjear tus Puntos GDO</b>, entrá al Club:
          </div>
          <a href="https://lista.granjadeloeste.com/club.html" style="display:block;margin-top:12px;padding:13px;background:#F58220;color:#111;border-radius:11px;text-align:center;text-decoration:none;font-weight:800">Ir al GDO CLUB →</a>
          <button class="btn btn-ghost btn-block" id="socio-logout" style="margin-top:12px;color:#fff;border-color:#3a3a3d">Cerrar sesión</button>
        </div>
        ${GDO.footHTML()}
      </div>`;
    const lo = root().querySelector('#socio-logout');
    if (lo) lo.onclick = () => App.logout();
  }

  // Cambios llegados desde Firestore (otro dispositivo): re-render del contenido
  // actual. No interrumpe formularios: data.js ya evita disparar si hay un modal
  // abierto. El re-pintado respeta la sesión local de cada dispositivo.
  GDO._dataChanged = function () {
    if (GDO.Notify) GDO.Notify.check(); // avisos al celular (corre siempre)
    if (document.querySelector('.modal-bg, .notif-pop')) return; // no interrumpir formularios
    render();
  };

  /* ---------- Botón "Instalar app" (solo celular, se va al instalar) ---------- */
  function setupInstall() {
    // Si ya está instalada (se abrió desde el ícono), corre en modo standalone:
    // ahí NUNCA mostramos el botón.
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (standalone) return;
    const ua = navigator.userAgent || '';
    const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /android/i.test(ua);
    if (!isIOS && !isAndroid) return;                 // solo en celular
    if (sessionStorage.getItem('gdo_install_off')) return; // ya lo cerró/instaló en esta sesión

    let deferred = null, btn = null;

    function hide() { if (btn) { btn.remove(); btn = null; } }
    function makeBtn(onTap) {
      if (btn) return btn;
      btn = document.createElement('button');
      btn.id = 'gdo-install';
      btn.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:9999;background:#F58220;color:#fff;border:none;border-radius:999px;padding:13px 20px;font:600 15px/1 Inter,system-ui,sans-serif;box-shadow:0 6px 22px rgba(0,0,0,.28);cursor:pointer;display:flex;align-items:center;gap:10px';
      const label = document.createElement('span');
      label.textContent = '📲 Instalar app';
      const x = document.createElement('span');
      x.textContent = '✕';
      x.style.cssText = 'opacity:.85;font-size:14px;padding:0 2px';
      x.onclick = (e) => { e.stopPropagation(); sessionStorage.setItem('gdo_install_off', '1'); hide(); };
      btn.appendChild(label); btn.appendChild(x);
      btn.onclick = onTap;
      document.body.appendChild(btn);
      return btn;
    }

    function iosHelp() {
      const o = document.createElement('div');
      o.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center';
      o.innerHTML = '<div style="background:#fff;border-radius:18px 18px 0 0;max-width:430px;width:100%;padding:22px 22px 32px;font:400 15px/1.5 Inter,system-ui,sans-serif;color:#1a1a1a">'
        + '<div style="font-weight:700;font-size:17px;margin-bottom:12px">Instalar en tu iPhone</div>'
        + '<ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:10px">'
        + '<li>Abrí esta página en <b>Safari</b>.</li>'
        + '<li>Tocá <b>Compartir</b> ⬆️ (abajo, el cuadrado con la flecha).</li>'
        + '<li>Deslizá y tocá <b>«Agregar a inicio»</b>.</li>'
        + '<li>Tocá <b>Agregar</b>. ¡Listo!</li>'
        + '</ol>'
        + '<button id="ios-ok" style="margin-top:18px;width:100%;background:#F58220;color:#fff;border:none;border-radius:12px;padding:13px;font:600 15px Inter,system-ui,sans-serif;cursor:pointer">Entendido</button>'
        + '</div>';
      document.body.appendChild(o);
      const close = () => o.remove();
      o.querySelector('#ios-ok').onclick = close;
      o.onclick = (e) => { if (e.target === o) close(); };
    }

    if (isAndroid) {
      // Chrome avisa cuándo se puede instalar; recién ahí mostramos el botón.
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferred = e;
        makeBtn(async () => {
          if (!deferred) return;
          deferred.prompt();
          await deferred.userChoice.catch(() => {});
          deferred = null;
          hide();
        });
      });
    } else if (isIOS) {
      // iOS no permite instalación automática: mostramos el botón con el paso a paso.
      makeBtn(iosHelp);
    }

    // Al instalarse, se va y no vuelve.
    window.addEventListener('appinstalled', () => { sessionStorage.setItem('gdo_install_off', '1'); hide(); });
  }
  window.addEventListener('hashchange', render);
  // Pedidos entrantes desde la tienda online (otra pestaña/mismo navegador).
  window.addEventListener('storage', (e) => {
    if (e.key === 'gdo_reparto_inbox' && Store.sync()) render();
  });
  window.addEventListener('focus', () => { if (Store.sync()) render(); });
  window.addEventListener('DOMContentLoaded', () => {
    if (!location.hash || location.hash === '#/inicio') location.hash = landingHash();
    render();
    // El botón "Instalar" va al final y blindado: si algo falla en un celular,
    // JAMÁS puede impedir que la app se dibuje ni que los botones respondan.
    try { setupInstall(); } catch (_) {}
  });
})();
