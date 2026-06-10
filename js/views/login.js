/* ====== Vista: Login ====== */
window.GDO = window.GDO || {}; GDO.Views = GDO.Views || {};
(function () {
  const { Store } = GDO, { h, toast } = GDO.UI;

  GDO.Views.login = function (mount, onLogin) {
    mount.className = '';
    mount.innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <div class="lg"><img src="assets/logo-horizontal-color.svg" alt="Granja del Oeste"/></div>
          <p class="sub">Sistema de reparto y optimización de rutas</p>
          <div class="field"><label>Email</label><input id="lg-email" type="email" placeholder="tu@gdo.com" autocomplete="username"/></div>
          <div class="field"><label>Contraseña</label><input id="lg-pass" type="password" placeholder="••••" autocomplete="current-password"/></div>
          <button class="btn btn-primary btn-block btn-lg" id="lg-go" style="margin-top:6px">Ingresar</button>
        </div>
      </div>`;

    const btn = mount.querySelector('#lg-go');
    const doLogin = () => {
      if (btn.disabled) return;
      const email = mount.querySelector('#lg-email').value.trim();
      const pass = mount.querySelector('#lg-pass').value;
      btn.disabled = true; const txt = btn.textContent; btn.textContent = 'Ingresando…';
      // Store.login siempre devuelve una Promesa (valida contra Firebase Auth).
      Promise.resolve(Store.login(email, pass)).then((u) => {
        btn.disabled = false; btn.textContent = txt;
        if (!u) { toast('Email o contraseña incorrectos', 'err'); return; }
        toast('Bienvenido/a ' + u.nombre.split(' ')[0], 'ok');
        onLogin();
      }).catch(() => {
        btn.disabled = false; btn.textContent = txt;
        toast('Email o contraseña incorrectos', 'err');
      });
    };
    btn.onclick = doLogin;
    mount.querySelector('#lg-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  };
})();
