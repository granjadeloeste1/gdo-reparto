/* ====== GDO Reparto — geocodificación (dirección → coordenadas) ======
   Usa Nominatim (OpenStreetMap): gratis, sin API key ni tarjeta. Cachea los
   resultados en localStorage para no repetir consultas. Política de uso de
   Nominatim: máx ~1 consulta por segundo (por eso locatePending va con pausa).
   En producción se puede cambiar por OpenRouteService/Google con la misma firma. */
window.GDO = window.GDO || {};
(function () {
  const CACHE = 'gdo_geo_cache';
  // Georef: normalizador oficial de direcciones de Argentina (apis.datos.gob.ar).
  // Gratis, sin API key ni tarjeta, CORS habilitado, coordenadas a nivel de casa
  // y mucha mejor cobertura que OSM en Hurlingham/Villa Tesei.
  const GEOREF = 'https://apis.datos.gob.ar/georef/api';
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  function loadCache() { try { return JSON.parse(localStorage.getItem(CACHE) || '{}'); } catch (e) { return {}; } }
  function saveCache(c) { try { localStorage.setItem(CACHE, JSON.stringify(c)); } catch (e) {} }

  // Una consulta a Georef /direcciones. Devuelve [{label,direccion,lat,lng,...}].
  async function _georefQuery(q, provincia, departamento, max) {
    const params = { direccion: q, provincia: provincia || 'Buenos Aires', max: String(max || 6), campos: 'estandar' };
    if (departamento) params.departamento = departamento;
    const r = await fetch(GEOREF + '/direcciones?' + new URLSearchParams(params), { headers: { Accept: 'application/json' } });
    if (!r.ok) return [];
    const data = await r.json();
    const arr = (data && data.direcciones) || [];
    const out = [];
    for (const d of arr) {
      const u = d.ubicacion || {};
      const calle = (d.calle && d.calle.nombre) || '';
      if (!calle) continue;
      const altura = (d.altura && d.altura.valor) ? (' ' + d.altura.valor) : '';
      const loc = (d.localidad_censal && d.localidad_censal.nombre) || '';
      const part = (d.departamento && d.departamento.nombre) || '';
      const direccion = (calle + altura).trim() + (loc ? ', ' + loc : '');
      out.push({
        label: d.nomenclatura || direccion, direccion,
        lat: (u.lat != null ? +u.lat : null), lng: (u.lon != null ? +u.lon : null),
        localidad: loc, partido: part,
      });
    }
    return out;
  }

  // Sugerencias de direcciones mientras se escribe (autocompletado). Consulta
  // Georef /direcciones y devuelve [{label, direccion, lat, lng, localidad, partido}].
  // opts.departamento se usa como SESGO (no filtro duro): primero trae resultados
  // de ese partido (zona de reparto de GDO) y luego completa con resultados de
  // toda la provincia, así no se ocultan los partidos vecinos (Morón, Tres de
  // Febrero, etc.). opts: { provincia, departamento, max }
  async function suggest(text, opts) {
    const q = String(text || '').trim();
    if (q.length < 4) return [];
    opts = opts || {};
    const max = opts.max || 6;
    try {
      const out = [], seen = {};
      const push = (list) => {
        for (const it of list) {
          const key = norm(it.label);
          if (seen[key]) continue;
          seen[key] = 1; out.push(it);
          if (out.length >= max) break;
        }
      };
      if (opts.departamento) push(await _georefQuery(q, opts.provincia, opts.departamento, max));
      if (out.length < max) push(await _georefQuery(q, opts.provincia, null, max));
      return out;
    } catch (e) { return []; }
  }

  // Una consulta a Nominatim. Devuelve {lat,lng,display,aprox} o null.
  async function _query(q, aprox) {
    try {
      const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
        q, format: 'jsonv2', limit: '1', countrycodes: 'ar',
      });
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) return null;
      const arr = await r.json();
      return (arr && arr.length)
        ? { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon), display: arr[0].display_name, aprox: !!aprox }
        : null;
    } catch (e) { return null; }
  }

  // Quita la altura (número de calle) para un fallback a nivel de calle:
  // "Jauretche 410, Villa Tesei" -> "Jauretche, Villa Tesei".
  function sinAltura(base) {
    const partes = base.split(',');
    partes[0] = partes[0].replace(/\s*\d+\s*$/, '').trim();
    return partes.map((s) => s.trim()).filter(Boolean).join(', ');
  }

  // Devuelve una Promesa con {lat,lng,display,aprox} o null si no se encontró.
  // OSM en esta zona muchas veces no tiene la altura exacta; si la dirección
  // completa falla, reintenta sin el número para caer al menos a nivel de calle
  // (marca aprox:true) en vez de no ubicar nada.
  async function geocode(direccion) {
    const base = String(direccion || '').trim();
    if (!base) return null;
    const q = /argentina/i.test(base) ? base : base + ', Buenos Aires, Argentina';
    const key = norm(q);
    const cache = loadCache();
    if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
    // 1) Georef (oficial AR, mejor cobertura) — busca la altura exacta.
    let res = null;
    try {
      const sug = await suggest(base, { max: 1 });
      if (sug.length && sug[0].lat != null) {
        res = { lat: sug[0].lat, lng: sug[0].lng, display: sug[0].label, aprox: false };
      }
    } catch (e) {}
    // 2) Fallback a Nominatim/OSM con reintento sin altura (nivel de calle).
    if (!res) res = await _query(q, false);
    if (!res) {
      const q2 = /argentina/i.test(base) ? sinAltura(base) : sinAltura(base) + ', Buenos Aires, Argentina';
      if (norm(q2) !== key) res = await _query(q2, true);
    }
    cache[key] = res; saveCache(cache);
    return res;
  }

  // Geolocaliza en segundo plano los pedidos pendientes que no tienen coords.
  // Llama onUpdate() cada vez que ubica uno. Va de a uno con pausa (Nominatim).
  let _running = false;
  async function locatePending(onUpdate) {
    if (_running || !GDO.Store) return;
    _running = true;
    try {
      const pend = GDO.Store.pedidos().filter((p) => p.estado === 'pendiente' && p.lat == null && p.direccion);
      for (const p of pend) {
        const g = await geocode(p.direccion);
        if (g) { p.lat = g.lat; p.lng = g.lng; GDO.Store.save(); if (onUpdate) try { onUpdate(p); } catch (e) {} }
        await new Promise((res) => setTimeout(res, 1100));
      }
    } finally { _running = false; }
  }

  // Autocompletado de direcciones sobre un <input>. Sin dependencias. El
  // dropdown se cuelga del <body> con position:fixed anclado al campo, así
  // NINGÚN contenedor con overflow (modales, drawers) lo puede recortar. Muestra
  // sugerencias de Georef mientras se escribe (debounce). Al elegir una, completa
  // el input y llama onPick({ direccion, lat, lng, localidad, partido }).
  function attachAutocomplete(input, onPick, opts) {
    if (!input || input._gdoAuto) return;
    input._gdoAuto = true;
    opts = opts || {};
    input.setAttribute('autocomplete', 'off');

    const box = document.createElement('div');
    box.className = 'gdo-ac';
    box.style.cssText = 'position:fixed;z-index:99999;background:#fff;border:1px solid #ddd;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);max-height:240px;overflow:auto;display:none';
    document.body.appendChild(box);

    let timer = null, lastQ = '', items = [];
    const place = () => {
      const r = input.getBoundingClientRect();
      box.style.left = r.left + 'px';
      box.style.top = (r.bottom + 2) + 'px';
      box.style.width = r.width + 'px';
    };
    const hide = () => { box.style.display = 'none'; box.innerHTML = ''; items = []; };
    const render = (list) => {
      items = list;
      if (!list.length) { hide(); return; }
      box.innerHTML = list.map((it, i) =>
        `<div class="gdo-ac-item" data-i="${i}" style="padding:9px 11px;cursor:pointer;font-size:14px;border-top:${i ? '1px solid #f0f0f0' : '0'}">${
          String(it.label).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
        }</div>`).join('');
      place();
      box.style.display = 'block';
    };
    const pick = (it) => {
      input.value = it.direccion || it.label || input.value;
      hide();
      if (onPick) try { onPick(it); } catch (e) {}
    };

    box.addEventListener('mousedown', (e) => {
      const el = e.target.closest('.gdo-ac-item');
      if (!el) return;
      e.preventDefault();
      const it = items[+el.dataset.i];
      if (it) pick(it);
    });
    box.addEventListener('mouseover', (e) => {
      const el = e.target.closest('.gdo-ac-item');
      [...box.children].forEach((c) => { c.style.background = ''; });
      if (el) el.style.background = '#fff4ea';
    });

    input.addEventListener('input', () => {
      const q = input.value.trim();
      if (timer) clearTimeout(timer);
      if (q.length < 4) { hide(); return; }
      timer = setTimeout(async () => {
        if (q === lastQ) return;
        lastQ = q;
        const list = await suggest(q, opts);
        if (input.value.trim() === q) render(list);
      }, 350);
    });
    // reubicar mientras está abierto (scroll del modal / resize)
    const onMove = () => { if (box.style.display === 'block') place(); };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    input.addEventListener('blur', () => setTimeout(hide, 150));
  }

  GDO.Geo = { geocode, suggest, attachAutocomplete, locatePending };
})();
