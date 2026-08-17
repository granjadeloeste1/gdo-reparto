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
          <div class="field"><label>Contraseña</label>
            <div style="position:relative">
              <input id="lg-pass" type="password" placeholder="••••" autocomplete="current-password" style="padding-right:46px"/>
              <button type="button" id="lg-ojo" aria-label="Mostrar contraseña"
                style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:0;font-size:18px;line-height:1;cursor:pointer;padding:6px 8px;opacity:.65">👁</button>
            </div>
          </div>
          <button class="btn btn-primary btn-block btn-lg" id="lg-go" style="margin-top:6px">Ingresar</button>
        </div>
      </div>
      ${GDO.footHTML ? `<div style="position:fixed;left:0;right:0;bottom:0;pointer-events:none">${GDO.footHTML()}</div>` : ''}`;

    const btn = mount.querySelector('#lg-go');
    // Ver / ocultar la contraseña: en el celular, tipear a ciegas es donde más se
    // equivoca el personal y después parece que la clave está mal.
    const ojo = mount.querySelector('#lg-ojo'), pw = mount.querySelector('#lg-pass');
    ojo.onclick = () => {
      const ver = pw.type === 'password';
      pw.type = ver ? 'text' : 'password';
      ojo.textContent = ver ? '🙈' : '👁';
      ojo.style.opacity = ver ? '1' : '.65';
      ojo.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
      try { pw.focus(); pw.setSelectionRange(pw.value.length, pw.value.length); } catch (e) {}
    };
    const doLogin = () => {
      if (btn.disabled) return;
      const email = mount.querySelector('#lg-email').value.trim();
      const pass = mount.querySelector('#lg-pass').value;
      btn.disabled = true; const txt = btn.textContent; btn.textContent = 'Ingresando…';
      // Store.login siempre devuelve una Promesa (valida contra Firebase Auth).
      Promise.resolve(Store.login(email, pass)).then((u) => {
        btn.disabled = false; btn.textContent = txt;
        if (!u) {
          // Si Firebase no está disponible no se puede validar la contraseña:
          // distinguimos "sin conexión" de "credenciales incorrectas".
          if (GDO.FB && GDO.FB.enabled === false) { toast('Necesitás conexión a internet para iniciar sesión.', 'err'); return; }
          toast('Email o contraseña incorrectos', 'err'); return;
        }
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
