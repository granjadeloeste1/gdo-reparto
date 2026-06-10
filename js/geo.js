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

  // ---- Zona de reparto de GDO ---------------------------------------------
  // Una misma calle (p. ej. "Jauretche 410") existe en decenas de pueblos de
  // la provincia; sin acotar, Georef devuelve cualquiera (¡Olavarría, a 350 km!).
  // Por eso restringimos TODO a los partidos donde realmente reparte GDO.
  // Hurlingham es la base (Villa Tesei). Editá esta lista si cambia la zona.
  const ZONA = {
    provincia: 'Buenos Aires',
    // Orden = prioridad de cercanía (Hurlingham primero).
    partidos: ['Hurlingham', 'Morón', 'Ituzaingó', 'Tres de Febrero',
      'General San Martín', 'San Miguel', 'Malvinas Argentinas', 'José C. Paz',
      'Merlo', 'Moreno'],
    // Caja geográfica (oeste del GBA) para validar resultados de OSM/Nominatim.
    // El borde este (-58.48) deja afuera CABA (General Paz) pero conserva los
    // partidos del oeste (San Martín, Tres de Febrero) donde sí reparte GDO.
    box: { minLng: -59.05, minLat: -34.86, maxLng: -58.48, maxLat: -34.40 },
  };
  const _sinAcento = (s) => String(s || '').toLowerCase()
    .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
    .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').trim();
  const _zonaSet = ZONA.partidos.map(_sinAcento);
  // Posición del partido en la zona (0 = más cercano). -1 = fuera de zona.
  const zonaRank = (partido) => _zonaSet.indexOf(_sinAcento(partido));
  const inZona = (partido) => zonaRank(partido) >= 0;

  // ---- Localidades de la zona (para separar calle de localidad) -----------
  // Georef necesita SOLO la calle (y la altura) en el campo "direccion". Si el
  // texto trae la localidad pegada (p. ej. "Valentín Alsina William Morris"),
  // la interpreta como nombre de calle y NO encuentra nada. Por eso detectamos
  // la localidad al final de la dirección, la separamos y la mandamos aparte.
  const LOCALIDADES = [
    'hurlingham', 'william morris', 'villa tesei', 'villa club',
    'moron', 'castelar', 'el palomar', 'haedo', 'villa sarmiento',
    'ituzaingo', 'villa udaondo', 'parque leloir', 'villa gobernador udaondo',
    'caseros', 'santos lugares', 'saenz pena', 'jose ingenieros', 'ciudadela',
    'el libertador', 'churruca', 'martin coronado', 'pablo podesta',
    'loma hermosa', 'ciudad jardin', 'tres de febrero',
    'san andres', 'villa ballester', 'jose leon suarez', 'billinghurst',
    'general san martin', 'san martin',
    'san miguel', 'bella vista', 'munro', 'los polvorines', 'pablo nogues',
    'grand bourg', 'tortuguitas', 'del viso', 'jose c paz',
    'merlo', 'san antonio de padua', 'padua', 'libertad', 'parque san martin',
    'moreno', 'paso del rey', 'francisco alvarez',
  ].sort((a, b) => b.length - a.length); // más larga primero (matchea antes)

  // "Calle [altura] [, ] Localidad" -> { calle, localidad }. Trabaja sobre el
  // texto sin acentos y normalizado (Georef es insensible a acentos).
  function partirDireccion(base) {
    const limpio = _sinAcento(base).replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
    for (const loc of LOCALIDADES) {
      if (limpio === loc) return { calle: '', localidad: loc };
      if (limpio.endsWith(' ' + loc)) return { calle: limpio.slice(0, limpio.length - loc.length).trim(), localidad: loc };
    }
    return { calle: limpio, localidad: '' };
  }

  // Saca la altura (número) del final de una calle: "valentin alsina 1200" -> "valentin alsina".
  const _soloCalle = (s) => String(s || '').replace(/\s*\d+\s*$/, '').trim();

  // De un campo "entre calles" saca hasta 2 nombres de calle de cruce. Acepta
  // "Calle A y Calle B", "entre A y B", "A esquina B", "A / B", "A esq. B".
  function crucesDe(entrecalles) {
    let s = _sinAcento(entrecalles).replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return [];
    s = s.replace(/^entre\s+/, '').replace(/\besquina\b|\besq\b/g, ' y ');
    return s.split(/\s+y\s+|\s*\/\s*/).map((x) => x.trim()).filter(Boolean).slice(0, 2);
  }

  // Geolocaliza por intersección (esquina): "calle y cruce". Si hay dos cruces,
  // promedia las dos esquinas para caer a mitad de cuadra (lo más cercano a la
  // casa). Devuelve {lat,lng,...} o null. Es lo más PRECISO y además distingue
  // calles homónimas (p. ej. Valentín Alsina de Hurlingham vs. la de W. Morris):
  // un cruce dado existe en una sola de las dos.
  async function geocodeInterseccion(calle, cruces, localidad) {
    const pts = [];
    for (const cr of cruces) {
      const q = calle + ' y ' + cr;
      let inter = (await _georefQuery(q, ZONA.provincia, null, 3, localidad))
        .filter((it) => it.lat != null && inZona(it.partido))
        .sort((a, b) => zonaRank(a.partido) - zonaRank(b.partido));
      if (!inter.length && localidad) {
        inter = (await _georefQuery(q, ZONA.provincia, null, 5))
          .filter((it) => it.lat != null && inZona(it.partido))
          .sort((a, b) => zonaRank(a.partido) - zonaRank(b.partido));
      }
      if (inter.length) pts.push(inter[0]);
    }
    if (!pts.length) return null;
    const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    const lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
    return { lat, lng, display: pts[0].label, localidad: pts[0].localidad || '', partido: pts[0].partido || '', aprox: pts.length < 2 };
  }
  function loadCache() { try { return JSON.parse(localStorage.getItem(CACHE) || '{}'); } catch (e) { return {}; } }
  function saveCache(c) { try { localStorage.setItem(CACHE, JSON.stringify(c)); } catch (e) {} }

  // Una consulta a Georef /direcciones. Devuelve [{label,direccion,lat,lng,...}].
  async function _georefQuery(q, provincia, departamento, max, localidad) {
    const params = { direccion: q, provincia: provincia || 'Buenos Aires', max: String(max || 6), campos: 'estandar' };
    if (departamento) params.departamento = departamento;
    if (localidad) params.localidad = localidad;
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
  // SIEMPRE acota a la zona de reparto (ZONA.partidos): primero Hurlingham y
  // luego el resto de la provincia filtrado a esos partidos, así nunca se ofrece
  // una calle homónima de un pueblo lejano. opts: { max } (provincia/departamento
  // se mantienen por compatibilidad pero ya no cambian el resultado).
  // ===== Google Places (autocompletado "pro", SDK nuevo) =====
  // Sugerencias mientras se escribe usando Places (AutocompleteSuggestion). Es
  // el motor más confiable en Argentina y trae la ALTURA exacta. Devuelve items
  // SIN coordenadas (solo texto + placePrediction): las coords se resuelven al
  // ELEGIR (1 sola consulta de detalle). Si Google no está / falla, null → Georef.
  let _gToken = null, _gDisabled = false;
  async function suggestGoogle(text) {
    try {
      if (_gDisabled) return null;
      if (!(GDO.Google && GDO.Google.disponible)) return null;
      if (!(window.google && google.maps && google.maps.places)) return null;
      const P = google.maps.places;
      if (!P.AutocompleteSuggestion || !P.AutocompleteSuggestion.fetchAutocompleteSuggestions) return null;
      if (!_gToken && P.AutocompleteSessionToken) _gToken = new P.AutocompleteSessionToken();
      const b = ZONA.box;
      const req = {
        input: text,
        includedRegionCodes: ['ar'],
        language: 'es',
        locationBias: { west: b.minLng, south: b.minLat, east: b.maxLng, north: b.maxLat },
      };
      if (_gToken) req.sessionToken = _gToken;
      const res = await P.AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
      const sugg = (res && res.suggestions) || [];
      const out = [];
      for (const s of sugg) {
        const pp = s.placePrediction;
        if (!pp) continue;
        const label = (pp.text && (pp.text.text || pp.text)) || '';
        if (!label) continue;
        out.push({ label: String(label), _pp: pp, _placeId: pp.placeId || null, lat: null, lng: null, localidad: '' });
      }
      return out;
    } catch (e) { _gDisabled = true; return null; }
  }

  // Resuelve coords + localidad de una sugerencia de Google al elegirla.
  async function placeCoords(item) {
    try {
      if (!(window.google && google.maps && google.maps.places)) return null;
      let place = null;
      if (item._pp && item._pp.toPlace) place = item._pp.toPlace();
      else if (item._placeId && google.maps.places.Place) place = new google.maps.places.Place({ id: item._placeId });
      if (!place) return null;
      await place.fetchFields({ fields: ['location', 'addressComponents', 'formattedAddress'] });
      _gToken = null; // cerrada la sesión: la próxima búsqueda abre una nueva
      const loc = place.location;
      const lat = loc && (typeof loc.lat === 'function' ? loc.lat() : loc.lat);
      const lng = loc && (typeof loc.lng === 'function' ? loc.lng() : loc.lng);
      if (lat == null || lng == null) return null;
      let localidad = '', calle = '', num = '';
      (place.addressComponents || []).forEach((c) => {
        const t = c.types || [];
        const txt = c.longText || c.long_name || '';
        if (!localidad && (t.indexOf('locality') >= 0 || t.indexOf('sublocality') >= 0 || t.indexOf('administrative_area_level_2') >= 0)) localidad = txt;
        if (t.indexOf('route') >= 0) calle = txt;
        if (t.indexOf('street_number') >= 0) num = txt;
      });
      const direccion = calle ? (calle + (num ? ' ' + num : '')) : (place.formattedAddress || item.label);
      return { lat: +lat, lng: +lng, localidad: localidad, direccion: direccion };
    } catch (e) { return null; }
  }

  async function suggest(text, opts) {
    const q = String(text || '').trim();
    if (q.length < 4) return [];
    opts = opts || {};
    const max = opts.max || 6;
    // 1) Google primero (lo más confiable; trae la altura exacta). Si no está
    //    disponible o falla, caemos a Georef (gratis) sin romper la experiencia.
    try { const g = await suggestGoogle(q); if (g && g.length) return g.slice(0, max); } catch (e) {}
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
      // Separamos la localidad si el usuario la escribió pegada a la calle.
      const { calle, localidad } = partirDireccion(q);
      const qCalle = calle || q;
      // 0) Si hay localidad detectada, buscamos la calle filtrando por ella.
      if (localidad) push((await _georefQuery(qCalle, ZONA.provincia, null, max, localidad)).filter((it) => inZona(it.partido)));
      // 1) Base: Hurlingham (zona principal de GDO) — match exacto y rápido.
      if (out.length < max) push(await _georefQuery(qCalle, ZONA.provincia, 'Hurlingham', max));
      // 2) Completar con el resto de la PROVINCIA pero filtrando SOLO a los
      //    partidos de la zona de reparto (Morón, Ituzaingó, etc.). Así nunca
      //    aparece una calle homónima de un pueblo lejano.
      if (out.length < max) {
        const prov = await _georefQuery(qCalle, ZONA.provincia, null, 30);
        push(prov.filter((it) => inZona(it.partido)));
      }
      // Ordenar por cercanía de zona (Hurlingham primero).
      out.sort((a, b) => {
        const ra = zonaRank(a.partido), rb = zonaRank(b.partido);
        return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
      });
      return out.slice(0, max);
    } catch (e) { return []; }
  }

  // Una consulta a Nominatim ACOTADA a la caja de la zona de reparto (bounded=1)
  // y validada contra esa caja: si el único resultado cae fuera del GBA oeste lo
  // descartamos (mejor "sin ubicar" que mandar al chofer a otra ciudad).
  async function _queryBounded(direccion, aprox) {
    try {
      const q = /argentina/i.test(direccion) ? direccion : direccion + ', Buenos Aires, Argentina';
      const b = ZONA.box;
      const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
        q, format: 'jsonv2', limit: '1', countrycodes: 'ar',
        viewbox: [b.minLng, b.minLat, b.maxLng, b.maxLat].join(','), bounded: '1',
      });
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) return null;
      const arr = await r.json();
      if (!arr || !arr.length) return null;
      const lat = parseFloat(arr[0].lat), lng = parseFloat(arr[0].lon);
      if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng) return null;
      return { lat, lng, display: arr[0].display_name, aprox: !!aprox };
    } catch (e) { return null; }
  }

  // Quita la altura (número de calle) para un fallback a nivel de calle:
  // "Jauretche 410, Villa Tesei" -> "Jauretche, Villa Tesei".
  function sinAltura(base) {
    const partes = base.split(',');
    partes[0] = partes[0].replace(/\s*\d+\s*$/, '').trim();
    return partes.map((s) => s.trim()).filter(Boolean).join(', ');
  }

  // Geocodificación con Google (Maps JavaScript API). Solo se usa si hay clave
  // cargada (GDO.CONFIG.googleKey). Es el motor MÁS preciso en Argentina: ubica
  // a nivel de puerta. Igual validamos que el punto caiga dentro de la zona de
  // reparto; si no, devolvemos null para que sigan Georef/OSM. No requiere
  // separar localidad ni calle: Google entiende la dirección completa.
  async function _googleGeocode(direccion) {
    try {
      if (!GDO.Google) return null;
      if (!GDO.Google.disponible) { const ok = await GDO.Google.ready; if (!ok) return null; }
      if (typeof google === 'undefined' || !google.maps || !google.maps.Geocoder) return null;
      const b = ZONA.box;
      const bounds = new google.maps.LatLngBounds(
        new google.maps.LatLng(b.minLat, b.minLng),
        new google.maps.LatLng(b.maxLat, b.maxLng));
      const q = /argentina/i.test(direccion) ? direccion : direccion + ', Buenos Aires, Argentina';
      const geocoder = new google.maps.Geocoder();
      const dentro = (lat, lng) => lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
      return await new Promise((resolve) => {
        geocoder.geocode({ address: q, bounds, region: 'ar', componentRestrictions: { country: 'AR' } }, (results, status) => {
          if (status !== 'OK' || !results || !results.length) { resolve(null); return; }
          // Preferimos un resultado dentro de la zona de reparto, pero si la
          // dirección cae AFUERA igual la aceptamos: Google ya está restringido a
          // Argentina y es preciso en todo el AMBA. (Antes la rechazábamos y la
          // dirección quedaba sin ubicar / sin mapa; ahora SIEMPRE ubica.)
          let r = results.find((x) => { const l = x.geometry.location; return dentro(l.lat(), l.lng()); }) || results[0];
          const lat = r.geometry.location.lat(), lng = r.geometry.location.lng();
          const lt = r.geometry.location_type; // ROOFTOP > RANGE_INTERPOLATED > GEOMETRIC_CENTER > APPROXIMATE
          const aprox = !(lt === 'ROOFTOP' || lt === 'RANGE_INTERPOLATED');
          let loc = '';
          (r.address_components || []).forEach((c) => {
            if (!loc && (c.types.indexOf('locality') >= 0 || c.types.indexOf('sublocality') >= 0)) loc = c.long_name;
          });
          resolve({ lat, lng, display: r.formatted_address, localidad: loc, partido: '', aprox });
        });
      });
    } catch (e) { return null; }
  }

  // Devuelve una Promesa con {lat,lng,display,aprox} o null si no se encontró.
  // Orden de motores: Google (si hay clave, lo más preciso) → Georef (oficial AR)
  // → OSM/Nominatim. OSM en esta zona muchas veces no tiene la altura exacta; si
  // la dirección completa falla, reintenta sin el número para caer al menos a
  // nivel de calle (marca aprox:true) en vez de no ubicar nada.
  async function geocode(direccion, entrecalles) {
    const base = String(direccion || '').trim();
    if (!base) return null;
    const ec = String(entrecalles || '').trim();
    // Clave de caché versionada ('z5'): incluye las entrecalles (cambian el
    // resultado) e invalida coordenadas/no-encontrados de versiones anteriores
    // (z5 fuerza re-geocodificar con Google donde haya clave).
    const key = 'z5|' + norm(base) + '|' + norm(ec);
    const cache = loadCache();
    if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
    let res = null;
    // 0) Google primero (si hay clave): es el más preciso en Argentina.
    res = await _googleGeocode(base);
    // Separamos la localidad (si viene pegada) para no romper el parser de Georef.
    const { calle, localidad } = partirDireccion(base);
    const qCalle = calle || base;
    if (!res) try {
      // 0) Si hay entre-calles, intentamos la ESQUINA primero: es lo más preciso
      //    y distingue calles homónimas (la Valentín Alsina de Hurlingham de la
      //    de William Morris) sin depender de la localidad escrita.
      const cruces = crucesDe(ec);
      if (cruces.length) res = await geocodeInterseccion(_soloCalle(qCalle), cruces, localidad);
      // Si la esquina no resolvió, ubicamos por calle (a nivel de cuadra/altura).
      if (!res) {
        let list = [];
        // 1) Si detectamos localidad, la usamos como filtro (lo más preciso).
        if (localidad) {
          list = (await _georefQuery(qCalle, ZONA.provincia, null, 5, localidad))
            .filter((it) => it.lat != null && inZona(it.partido))
            .sort((a, b) => zonaRank(a.partido) - zonaRank(b.partido));
        }
        // 2) Georef en Hurlingham (base de GDO) con la calle sola.
        if (!list.length) list = (await _georefQuery(qCalle, ZONA.provincia, 'Hurlingham', 3)).filter((it) => it.lat != null);
        // 3) Si no está en Hurlingham, buscar en el resto de la zona de reparto.
        if (!list.length) {
          const prov = await _georefQuery(qCalle, ZONA.provincia, null, 30);
          list = prov.filter((it) => inZona(it.partido) && it.lat != null)
            .sort((a, b) => zonaRank(a.partido) - zonaRank(b.partido));
        }
        if (list.length) {
          const s = list[0];
          res = { lat: s.lat, lng: s.lng, display: s.label, localidad: s.localidad || '', partido: s.partido || '', aprox: false };
        }
      }
    } catch (e) {}
    // 3) Fallback a OSM/Nominatim, SIEMPRE acotado a la zona; reintento sin altura.
    if (!res) res = await _queryBounded(base, false);
    if (!res) {
      const b2 = sinAltura(base);
      if (norm(b2) !== norm(base)) res = await _queryBounded(b2, true);
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
      // Ubica todo pedido activo que tenga dirección y aún no tenga coords
      // (no solo los pendientes): así un pedido ya asignado o en ruta que quedó
      // "sin ubicar" se corrige solo en cuanto mejora el geocodificador.
      const activos = ['pendiente', 'asignado', 'en_ruta', 'salteado'];
      const pend = GDO.Store.pedidos().filter((p) => p.lat == null && p.direccion && activos.includes(p.estado));
      for (const p of pend) {
        const g = await geocode(p.direccion, p.entrecalles);
        if (g) { p.lat = g.lat; p.lng = g.lng; if (g.localidad && !p.localidad) p.localidad = g.localidad; GDO.Store.save(); if (onUpdate) try { onUpdate(p); } catch (e) {} }
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
    const pick = async (it) => {
      hide();
      let enriched = it;
      // Sugerencia de Google: trae solo el texto; resolvemos coords al elegir.
      if (it && it.lat == null && (it._pp || it._placeId) && typeof placeCoords === 'function') {
        const d = await placeCoords(it).catch(() => null);
        if (d) enriched = Object.assign({}, it, d);
      }
      input.value = (enriched && (enriched.direccion || enriched.label)) || input.value;
      if (onPick) try { onPick(enriched); } catch (e) {}
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

  // Extrae {lat,lng} de un texto: coordenadas sueltas o un link de Google Maps.
  // Útil cuando el geocodificador gratuito no tiene la cuadra exacta (algunas
  // zonas de William Morris, etc.): el operador busca el punto en Google Maps,
  // copia el link o las coordenadas y las pega. Es exacto y 100% gratis.
  // Soporta: "lat, lng" · .../@lat,lng,17z · ...!3dlat!4dlng (el pin real) ·
  // ?q=lat,lng / ?query= / ?ll= / destination=lat,lng.
  // OJO: los links cortos (maps.app.goo.gl / goo.gl/maps) NO se pueden resolver
  // desde el navegador (CORS); hay que usar el link largo o las coordenadas.
  function parseLatLng(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    const ok = (a, b) => {
      const lat = +a, lng = +b;
      if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
      return { lat, lng };
    };
    let m = s.match(/^\s*(-?\d{1,3}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)\s*$/); // "lat, lng"
    if (m) return ok(m[1], m[2]);
    m = s.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/); // pin exacto del lugar
    if (m) return ok(m[1], m[2]);
    m = s.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/); // centro del mapa en la URL
    if (m) return ok(m[1], m[2]);
    m = s.match(/[?&](?:q|query|ll|destination|sll|daddr)=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
    if (m) return ok(m[1], m[2]);
    m = s.match(/(-?\d{1,3}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/); // último recurso
    if (m) return ok(m[1], m[2]);
    return null;
  }

  const esLinkCorto = (s) => /(maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(String(s || ''));

  GDO.Geo = { geocode, suggest, attachAutocomplete, locatePending, parseLatLng, esLinkCorto };
})();
