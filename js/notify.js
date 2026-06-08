/* ====== GDO Reparto — avisos en el celular (gratis) ======
   Cuando le llega una notificación nueva al usuario logueado (por ejemplo al
   chofer cuando le asignan una ruta), mostramos una notificación del navegador.
   Funciona con la app abierta o de fondo, sin servidor ni tarjeta. El "push"
   con la app totalmente cerrada requeriría el plan pago de Firebase. */
window.GDO = window.GDO || {};
(function () {
  const KEY = 'gdo_notify_seen';
  const load = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch (e) { return new Set(); } };
  const save = (set) => { try { localStorage.setItem(KEY, JSON.stringify([...set].slice(-300))); } catch (e) {} };
  const has = () => typeof window.Notification !== 'undefined';

  function show(title, body) {
    if (!has() || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(title, { body: body || '', icon: 'assets/isotipo-color.svg', tag: 'gdo-' + Date.now() });
      n.onclick = () => { try { window.focus(); } catch (e) {} n.close(); };
    } catch (e) {}
  }

  const Notify = {
    _seen: load(),
    _baselined: false,
    permission() { return has() ? Notification.permission : 'denied'; },
    request() { if (has() && Notification.permission === 'default') { try { Notification.requestPermission(); } catch (e) {} } },
    // En el próximo check, los avisos actuales se toman como punto de partida
    // (no se re-alertan). Se llama al cambiar de usuario.
    rebaseline() { this._baselined = false; },

    check() {
      const u = GDO.Store && GDO.Store.current();
      if (!u) return;
      const fresh = GDO.Store.notifDe(u.id).filter((n) => !n.leida && !this._seen.has(n.id));
      // Primera pasada tras login/recarga: marcar lo existente sin avisar.
      if (!this._baselined) {
        fresh.forEach((n) => this._seen.add(n.id));
        this._baselined = true; save(this._seen); return;
      }
      if (!fresh.length) return;
      fresh.forEach((n) => this._seen.add(n.id));
      save(this._seen);
      if (fresh.length === 1) show('Granja del Oeste', fresh[0].mensaje);
      else show('Granja del Oeste', fresh.length + ' avisos nuevos · abrí la app');
    },
  };

  GDO.Notify = Notify;
})();
