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

    const doLogin = (u) => {
      if (!u) { toast('Email o contraseña incorrectos', 'err'); return; }
      toast('Bienvenido/a ' + u.nombre.split(' ')[0], 'ok');
      onLogin();
    };
    mount.querySelector('#lg-go').onclick = () => {
      doLogin(Store.login(mount.querySelector('#lg-email').value.trim(), mount.querySelector('#lg-pass').value));
    };
    mount.querySelector('#lg-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') mount.querySelector('#lg-go').click(); });
  };
})();
