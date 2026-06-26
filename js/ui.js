/* ====== GDO Reparto — helpers de UI ====== */
window.GDO = window.GDO || {};
(function () {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // crea elementos desde HTML string
  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function toast(msg, type) {
    let box = document.getElementById('toasts');
    if (!box) { box = h('<div id="toasts"></div>'); document.body.appendChild(box); }
    const t = h(`<div class="toast ${type || ''}">${esc(msg)}</div>`);
    box.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = '.3s'; setTimeout(() => t.remove(), 300); }, 3200);
  }

  // modal genérico. opts: {title, bodyHTML, footHTML, onMount(node), width}
  function modal(opts) {
    const bg = h(`<div class="modal-bg"></div>`);
    const m = h(`<div class="modal" ${opts.width ? `style="max-width:${opts.width}px"` : ''}>
        <div class="modal-h"><h3>${esc(opts.title || '')}</h3><button class="x" aria-label="cerrar">&times;</button></div>
        <div class="modal-b"></div>
        ${opts.footHTML ? `<div class="modal-f">${opts.footHTML}</div>` : ''}
      </div>`);
    m.querySelector('.modal-b').innerHTML = opts.bodyHTML || '';
    bg.appendChild(m);
    document.body.appendChild(bg);
    const close = () => bg.remove();
    m.querySelector('.x').onclick = close;
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    if (opts.onMount) opts.onMount(m, close);
    return { node: m, close };
  }

  function confirmDlg(msg, onYes, yesLabel, yesClass) {
    modal({
      title: 'Confirmar', width: 440,
      bodyHTML: `<p style="margin:0;font-size:15px">${esc(msg)}</p>`,
      footHTML: `<button class="btn btn-ghost" data-no>Cancelar</button><button class="btn ${yesClass || 'btn-rojo'}" data-yes>${esc(yesLabel || 'Eliminar')}</button>`,
      onMount(m, close) {
        m.querySelector('[data-no]').onclick = close;
        m.querySelector('[data-yes]').onclick = () => { close(); onYes(); };
      },
    });
  }

  function fmtFecha(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
  }
  const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const DIA_IDX = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, 'miércoles': 3, jueves: 4, viernes: 5, sabado: 6, 'sábado': 6 };
  // Fecha ISO (YYYY-MM-DD) del PRÓXIMO día de la semana ("Jueves"). Regla: si hoy ya es
  // ese día, devuelve el de la semana que viene (nunca hoy). 'desde' opcional (Date).
  function proximoDiaFecha(nombreDia, desde) {
    const di = DIA_IDX[String(nombreDia == null ? '' : nombreDia).trim().toLowerCase()];
    if (di == null) return '';
    const b = desde ? new Date(desde) : new Date(); b.setHours(0, 0, 0, 0);
    let diff = (di - b.getDay() + 7) % 7; if (diff === 0) diff = 7;
    b.setDate(b.getDate() + diff);
    return b.getFullYear() + '-' + String(b.getMonth() + 1).padStart(2, '0') + '-' + String(b.getDate()).padStart(2, '0');
  }
  // Nombre del día de la semana de una fecha ISO ("Jueves").
  function diaSemanaDe(iso) {
    if (!iso) return '';
    return DIAS_SEMANA[new Date(iso + 'T00:00:00').getDay()] || '';
  }
  function fmtHora(min) { // minutos desde 00:00 -> "HH:MM"
    const h = Math.floor(min / 60) % 24, m = Math.round(min % 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  function fmtDur(min) {
    const hh = Math.floor(min / 60), mm = Math.round(min % 60);
    return hh ? `${hh}h ${mm}m` : `${mm} min`;
  }
  function hace(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'hace instantes';
    if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
    if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
    return new Date(ts).toLocaleDateString('es-AR');
  }

  const ESTADO_CHIP = {
    pendiente: '<span class="chip chip-pend">Pendiente</span>',
    asignado: '<span class="chip chip-asig">Asignado</span>',
    en_ruta: '<span class="chip chip-ruta">En ruta</span>',
    entregado: '<span class="chip chip-entreg">✓ Entregado</span>',
    no_entregado: '<span class="chip chip-no">✕ No entregado</span>',
    salteado: '<span class="chip chip-salt">↷ Salteado</span>',
  };
  const ROL_CHIP = {
    admin: '<span class="chip chip-rol">Administrador</span>',
    vendedor: '<span class="chip chip-rol vendedor">Vendedor</span>',
    repartidor: '<span class="chip chip-rol repartidor">Repartidor</span>',
  };

  GDO.UI = { esc, h, toast, modal, confirmDlg, fmtFecha, fmtHora, fmtDur, hace, proximoDiaFecha, diaSemanaDe, ESTADO_CHIP, ROL_CHIP };
})();
