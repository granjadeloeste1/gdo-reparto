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

  // ---- Cobertura: TODA la provincia de Buenos Aires + CABA ----------------
  // GDO entrega en varias zonas (siempre Ramos Mejía/La Matanza, y eventualmente
  // cualquier punto de la provincia). NO restringimos la búsqueda a partidos
  // fijos: Google (motor principal) ubica cualquier dirección de Argentina, y
  // acá cubrimos toda la provincia. La lista `partidos` se usa SOLO para ORDENAR
  // las sugerencias (primero las zonas más habituales, cerca del depósito en
  // Villa Tesei); NO filtra. Si una dirección está fuera, igual se ubica.
  const ZONA = {
    provincia: 'Buenos Aires',
    // Orden = prioridad para MOSTRAR primero (no es filtro). Las más habituales.
    partidos: ['Hurlingham', 'Ituzaingó', 'Morón', 'Tres de Febrero',
      'La Matanza', 'General San Martín', 'San Miguel', 'Malvinas Argentinas',
      'José C. Paz'],
    // Caja geográfica: toda la provincia de Buenos Aires + CABA. Solo se usa
    // para sesgar sugerencias y acotar el respaldo OSM/Nominatim; Google no se
    // limita a esto (ubica en cualquier lado).
    box: { minLng: -63.5, minLat: -41.1, maxLng: -56.6, maxLat: -33.2 },
  };
  const _sinAcento = (s) => String(s || '').toLowerCase()
    .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
    .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').trim();
  const _zonaSet = ZONA.partidos.map(_sinAcento);
  // Posición en el orden de cercanía (0 = más habitual). -1 = no listado.
  const zonaRank = (partido) => _zonaSet.indexOf(_sinAcento(partido));
  // Ya no filtramos por zona: aceptamos toda la provincia (la lista solo ordena).
  const inZona = (partido) => true;

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

  // Localidad -> partido. Sirve para chequear que lo que devuelve el geocodificador
  // sea de la localidad del pedido: "Luzuriaga 532" existe en Hurlingham y en Barracas,
  // "Tigre 1080" en Villa Tesei y en otros partidos. Sin este chequeo Google elegía
  // la homónima de otro lado y el chofer iba a cualquier parte.
  const PARTIDO_DE = {
    'hurlingham': 'hurlingham', 'william morris': 'hurlingham', 'william c morris': 'hurlingham', 'villa tesei': 'hurlingham', 'villa club': 'hurlingham',
    'moron': 'moron', 'castelar': 'moron', 'el palomar': 'moron', 'palomar': 'moron', 'haedo': 'moron', 'villa sarmiento': 'moron',
    'ituzaingo': 'ituzaingo', 'villa udaondo': 'ituzaingo', 'udaondo': 'ituzaingo', 'parque leloir': 'ituzaingo', 'villa gobernador udaondo': 'ituzaingo',
    'caseros': 'tres de febrero', 'santos lugares': 'tres de febrero', 'saenz pena': 'tres de febrero', 'jose ingenieros': 'tres de febrero',
    'ciudadela': 'tres de febrero', 'el libertador': 'tres de febrero', 'churruca': 'tres de febrero', 'martin coronado': 'tres de febrero',
    'pablo podesta': 'tres de febrero', 'loma hermosa': 'tres de febrero', 'ciudad jardin': 'tres de febrero', 'tres de febrero': 'tres de febrero',
    'barrio altos de podesta': 'tres de febrero', 'ciudad jardin lomas del palomar': 'tres de febrero',
    'ramos mejia': 'la matanza', 'san justo': 'la matanza', 'lomas del mirador': 'la matanza', 'villa luzuriaga': 'la matanza',
    'isidro casanova': 'la matanza', 'la tablada': 'la matanza', 'tapiales': 'la matanza', 'la matanza': 'la matanza',
    'san martin': 'general san martin', 'general san martin': 'general san martin', 'villa ballester': 'general san martin',
    'jose leon suarez': 'general san martin', 'billinghurst': 'general san martin', 'san andres': 'general san martin',
    'san miguel': 'san miguel', 'bella vista': 'san miguel', 'muniz': 'san miguel',
    'merlo': 'merlo', 'san antonio de padua': 'merlo', 'padua': 'merlo', 'libertad': 'merlo', 'parque san martin': 'merlo',
    'moreno': 'moreno', 'paso del rey': 'moreno', 'francisco alvarez': 'moreno',
  };
  // Localidades partidas entre dos partidos: vale cualquiera de los dos.
  const PARTIDO_ALT = { 'palomar': ['tres de febrero'], 'el palomar': ['tres de febrero'], 'ciudad jardin': ['moron'],
    'loma hermosa': ['general san martin'], 'villa sarmiento': ['la matanza', 'tres de febrero'] };
  const PARTIDOS_REPARTO = {}; Object.keys(PARTIDO_DE).forEach((k) => { PARTIDOS_REPARTO[PARTIDO_DE[k]] = 1; });
  // "Morón (barrio Gaona)": lo que va entre paréntesis es una aclaración, no la localidad.
  const _locNorm = (s) => _sinAcento(s).replace(/\([^)]*\)?/g, ' ').replace(/[.,]/g, ' ').replace(/^(partido de|ciudad de)\s+/, '').replace(/\s+/g, ' ').trim();
  // ¿Los nombres (localidad, partido, barrio) que trae el resultado son de la localidad pedida?
  // Sin localidad en el pedido no hay con qué comparar: se acepta.
  function coincideLocalidad(localidad, nombres) {
    const l = _locNorm(localidad);
    if (!l) return true;
    const part = PARTIDO_DE[l] || l;
    return (nombres || []).some((n) => { const x = _locNorm(n); return x && (x === l || x === part || PARTIDO_DE[x] === part); });
  }

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
    // "Agustín Álvarez y Curuzucuatiá (frente a la plaza)": las aclaraciones no son calles.
    let s = _sinAcento(entrecalles).replace(/\([^)]*\)?/g, ' ')
      .replace(/\b(frente|casi|cerca|al lado|a metros|pasando|altura)\b.*$/, ' ')
      .replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return [];
    s = s.replace(/^entre\s+/, '').replace(/\besquina\b|\besq\b/g, ' y ');
    return s.split(/\s+y\s+|\s*\/\s*/).map((x) => x.trim()).filter(Boolean).slice(0, 2);
  }

  // Geolocaliza por intersección (esquina): "calle y cruce". Si hay dos cruces,
  // promedia las dos esquinas para caer a mitad de cuadra (lo más cercano a la
  // casa). Devuelve {lat,lng,...} o null. Es lo más PRECISO y además distingue
  // calles homónimas (p. ej. Valentín Alsina de Hurlingham vs. la de W. Morris):
  // un cruce dado existe en una sola de las dos.
  /* Nombres más cortos de una calle para buscar la esquina. Georef guarda "TGRL ROCA" y
     "MTRA PIOVANO": con "Teniente General Julio Argentino Roca y Piovano" no encuentra nada,
     con "Roca y Piovano" sí (caso Gral. Roca 2376, Morris, 24-nov-2026: sin esquinas quedó
     el punto de Google, que estaba sobre Delfor Díaz, a otra cuadra). Se prueba primero el
     nombre completo y después sin títulos ni nombres de pila: el apellido solo. */
  const _TITULOS = /^(av|avda|avenida|calle|pasaje|pje|teniente general|tte gral|tte|teniente|general|gral|coronel|cnel|doctor|dr|ingeniero|ing|presidente|pte|maestra|mtra|almirante|alte|comodoro|brigadier|capitan|sargento|santa|san|padre|monseñor|mons|intendente|int|profesor|prof)\s+/;
  function _variantesCalle(s) {
    const full = _sinAcento(s).replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
    const out = [full];
    let t = full, prev;
    do { prev = t; t = t.replace(_TITULOS, ''); } while (t !== prev && t);
    if (t && out.indexOf(t) < 0) out.push(t);
    const w = t.split(' ');
    // El apellido solo ("julio argentino roca" -> "roca"), si no es un número ni muy corto.
    const ult = w[w.length - 1];
    if (w.length > 1 && ult && ult.length >= 4 && !/^\d+$/.test(ult) && out.indexOf(ult) < 0) out.push(ult);
    return out;
  }
  async function _esquina(calle, cr, localidad) {
    const vc = _variantesCalle(calle), vx = _variantesCalle(cr);
    // Pares a probar, del más completo al más corto (como mucho 4 consultas).
    const pares = [];
    vc.forEach((a, i) => vx.forEach((b, j) => pares.push({ a, b, k: i + j })));
    pares.sort((x, y) => x.k - y.k);
    for (const { a, b } of pares.filter((p) => localidad || p.k === 0).slice(0, 4)) {
      const q = a + ' y ' + b;
      let inter = (await _georefQuery(q, ZONA.provincia, null, 3, localidad))
        .filter((it) => it.lat != null && inZona(it.partido))
        .sort((a2, b2) => zonaRank(a2.partido) - zonaRank(b2.partido));
      // Sin localidad, un nombre acortado ("Roca y Borda") puede estar en otro partido: no se arriesga.
      if (!inter.length && localidad) {
        inter = (await _georefQuery(q, ZONA.provincia, null, 5))
          .filter((it) => it.lat != null && coincideLocalidad(localidad, [it.localidad, it.partido]))
          .sort((a2, b2) => zonaRank(a2.partido) - zonaRank(b2.partido));
      }
      if (inter.length) return inter[0];
    }
    return null;
  }
  async function geocodeInterseccion(calle, cruces, localidad) {
    const pts = [];
    for (const cr of cruces) {
      const e = await _esquina(calle, cr, localidad);
      if (e) pts.push(e);
    }
    if (!pts.length) return null;
    const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    const lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
    // `largo`: metros entre las dos esquinas (0 si se encontró una sola).
    const largo = pts.length === 2 ? _metros(pts[0], pts[1]) : 0;
    return { lat, lng, display: pts[0].label, localidad: pts[0].localidad || '', partido: pts[0].partido || '', aprox: pts.length < 2, largo,
      esquinas: pts.map((p) => ({ lat: p.lat, lng: p.lng })) };
  }
  // Metros desde un punto al tramo de calle entre dos esquinas (a la recta, sin salirse del tramo).
  function _metrosAlTramo(p, a, b) {
    const k = Math.cos(a.lat * Math.PI / 180) * 111320, m = 110540; // grados -> metros
    const ax = a.lng * k, ay = a.lat * m, bx = b.lng * k - ax, by = b.lat * m - ay, px = p.lng * k - ax, py = p.lat * m - ay;
    const L = bx * bx + by * by;
    const t = L ? Math.max(0, Math.min(1, (px * bx + py * by) / L)) : 0;
    return Math.hypot(px - t * bx, py - t * by);
  }
  // Distancia en metros entre dos puntos {lat,lng}.
  function _metros(a, b) {
    const R = 6371000, toR = (d) => d * Math.PI / 180;
    const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  /* ¿En qué provincia y partido cae un punto? Dato oficial (Georef /ubicacion). Sirve para
     NO aceptar una ubicación fuera de donde se reparte: "Cosquín 1587" o "Maipú 987" existen
     también en CABA, y una calle homónima manda al chofer a otra ciudad. null = no se pudo
     consultar (sin red): en ese caso no se descarta nada. */
  const _ubi = {};
  async function ubicacionDe(lat, lng) {
    const k = (+lat).toFixed(4) + ',' + (+lng).toFixed(4);
    if (_ubi[k]) return _ubi[k];
    try {
      const r = await fetch(GEOREF + '/ubicacion?' + new URLSearchParams({ lat: String(lat), lon: String(lng) }), { headers: { Accept: 'application/json' } });
      if (!r.ok) return null;
      const u = ((await r.json()) || {}).ubicacion || {};
      const out = { provincia: (u.provincia && u.provincia.nombre) || '', partido: (u.departamento && u.departamento.nombre) || '' };
      if (!out.provincia) return null;
      _ubi[k] = out; return out;
    } catch (e) { return null; }
  }
  // Con localidad conocida: el punto tiene que caer en SU partido. Sin localidad: en alguno
  // de los partidos donde se reparte. Nunca en CABA ni en otra provincia.
  async function enZonaDeReparto(lat, lng, localidad) {
    if (lat == null || lng == null) return false;
    const u = await ubicacionDe(lat, lng);
    if (!u) return true;
    if (_locNorm(u.provincia) !== 'buenos aires') return false;
    const l = _locNorm(localidad), part = PARTIDO_DE[l], pu = _locNorm(u.partido);
    if (part) return pu === part || (PARTIDO_ALT[l] || []).indexOf(pu) >= 0;
    if (l) return true; // localidad que no está en la tabla (la cargó el operador): alcanza con que no sea CABA
    return !!PARTIDOS_REPARTO[pu];
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
  // Si Google falla, se pausa 2 minutos (antes quedaba apagado hasta recargar la página).
  let _gToken = null, _gDisabled = 0;
  async function suggestGoogle(text) {
    try {
      if (_gDisabled && Date.now() - _gDisabled < 120000) return null;
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
    } catch (e) { _gDisabled = Date.now(); return null; }
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
    const max = opts.max || 8;
    /* Google + Georef juntos (20-nov-2026, caso "Berón de Astrada 238"): Google da solo 5
       sugerencias y ninguna era la de Morón (salían El Palomar, CABA, Remedios de Escalada...),
       así que la dirección correcta no aparecía. Ahora: primero las de Google que caen en la
       zona de reparto, después las de Georef de la zona (Georef sí tiene la de Morón), y recién
       si no hay nada en la zona, las de Google de otros lados. */
    let goo = [];
    try { goo = (await suggestGoogle(q)) || []; } catch (e) { goo = []; }
    const locsZona = Object.keys(PARTIDO_DE);
    const gooEnZona = goo.filter((it) => { const t = ' ' + _locNorm(it.label) + ' '; return locsZona.some((l) => t.indexOf(' ' + l + ' ') >= 0); });
    let geo = [];
    try { geo = await _suggestGeoref(q, max); } catch (e) { geo = []; }
    const titulo = (s) => String(s || '').toLowerCase().replace(/(^|[\s(])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
    const geoEnZona = geo.filter((it) => PARTIDOS_REPARTO[_locNorm(it.partido)])
      .map((it) => Object.assign({}, it, { label: titulo(it.label) }));
    const out = [], visto = {};
    const clave = (it) => _locNorm(String(it.label).split(',').slice(0, 2).join(' ')).replace(/\b(provincia de buenos aires|buenos aires|argentina)\b/g, '').replace(/\s+/g, ' ').trim();
    for (const it of gooEnZona.slice(0, 3).concat(geoEnZona, gooEnZona.slice(3))) { const k = clave(it); if (visto[k]) continue; visto[k] = 1; out.push(it); }
    if (out.length) return out.slice(0, max);
    if (goo.length) return goo.slice(0, max);
    return geo.slice(0, max);
  }

  async function _suggestGeoref(q, max) {
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
  async function _googleGeocode(direccion, localidad) {
    try {
      if (!GDO.Google) return null;
      if (!GDO.Google.disponible) { const ok = await GDO.Google.ready; if (!ok) return null; }
      if (typeof google === 'undefined' || !google.maps || !google.maps.Geocoder) return null;
      const b = ZONA.box;
      const bounds = new google.maps.LatLngBounds(
        new google.maps.LatLng(b.minLat, b.minLng),
        new google.maps.LatLng(b.maxLat, b.maxLng));
      const conLoc = localidad && !_sinAcento(direccion).includes(_sinAcento(localidad)) ? direccion + ', ' + localidad : direccion;
      const q = /argentina/i.test(conLoc) ? conLoc : conLoc + ', Buenos Aires, Argentina';
      const geocoder = new google.maps.Geocoder();
      const dentro = (lat, lng) => lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
      return await new Promise((resolve) => {
        // RED DE SEGURIDAD: si la clave de Google rechaza el dominio
        // (RefererNotAllowedMapError) o la red se corta, el callback del
        // geocoder NO se llama NUNCA y la promesa queda colgada para siempre.
        // Eso dejaba el botón "Guardar" del pedido en "Ubicando…" sin salida y
        // el pedido sin cargarse. A los 6 segundos seguimos con Georef/OSM.
        let listo = false;
        const fin = (v) => { if (!listo) { listo = true; resolve(v); } };
        setTimeout(() => fin(null), 6000);
        geocoder.geocode({ address: q, bounds, region: 'ar', componentRestrictions: { country: 'AR' } }, (results, status) => {
          if (status !== 'OK' || !results || !results.length) { fin(null); return; }
          // Preferimos un resultado dentro de la zona de reparto, pero si la
          // dirección cae AFUERA igual la aceptamos: Google ya está restringido a
          // Argentina y es preciso en todo el AMBA. (Antes la rechazábamos y la
          // dirección quedaba sin ubicar / sin mapa; ahora SIEMPRE ubica.)
          // Con localidad en el pedido, el resultado TIENE que ser de esa localidad (o de su
          // partido). Si ninguno lo es, null: siguen Georef/OSM filtrando por localidad.
          const nombres = (x) => (x.address_components || []).filter((c) => c.types.some((t) => /locality|sublocality|administrative_area_level_2|neighborhood/.test(t))).map((c) => c.long_name);
          // SOLO resultados a nivel de CASA (calle + altura). Cuando Google no encuentra la
          // altura devuelve la localidad entera ("Hurlingham") y su punto es el centro de la
          // localidad: así un pedido de Luzuriaga terminaba en la plaza de Hurlingham. Eso
          // no sirve para repartir: se descarta y siguen Georef/OSM.
          const esCasa = (x) => (x.types || []).some((t) => t === 'street_address' || t === 'premise' || t === 'subpremise');
          const casas = results.filter(esCasa);
          let r;
          if (localidad) r = casas.find((x) => coincideLocalidad(localidad, nombres(x)));
          else r = casas.find((x) => { const l = x.geometry.location; return dentro(l.lat(), l.lng()); }) || casas[0];
          if (!r) { fin(null); return; }
          const lat = r.geometry.location.lat(), lng = r.geometry.location.lng();
          const lt = r.geometry.location_type; // ROOFTOP > RANGE_INTERPOLATED > GEOMETRIC_CENTER > APPROXIMATE
          const aprox = !(lt === 'ROOFTOP' || lt === 'RANGE_INTERPOLATED');
          let loc = '';
          (r.address_components || []).forEach((c) => {
            if (!loc && (c.types.indexOf('locality') >= 0 || c.types.indexOf('sublocality') >= 0)) loc = c.long_name;
          });
          fin({ lat, lng, display: r.formatted_address, localidad: loc, partido: '', aprox, puerta: lt === 'ROOFTOP' });
        });
      });
    } catch (e) { return null; }
  }

  // Devuelve una Promesa con {lat,lng,display,aprox} o null si no se encontró.
  // Orden de motores: Google (si hay clave, lo más preciso) → Georef (oficial AR)
  // → OSM/Nominatim. OSM en esta zona muchas veces no tiene la altura exacta; si
  // la dirección completa falla, reintenta sin el número para caer al menos a
  // nivel de calle (marca aprox:true) en vez de no ubicar nada.
  async function geocode(direccion, entrecalles, localidadPedido) {
    // "Vigo 3641 entre Cuzco y Amberes": las entrecalles pegadas a la dirección rompen la búsqueda.
    // "Calle Vigo 3641": con el "Calle" adelante Georef no encuentra la calle.
    // "García Silva 434 - Timbre 6": la tienda pega el timbre / dto a la dirección; para ubicarla se saca.
    const base = String(direccion || '').replace(/\s+-\s+(timbre|tbre|dto|dpto|depto|departamento|piso|casa|ph|fondo|local|lote|uf)(?![a-z]).*$/i, '').replace(/\s+entre\s+.*$/i, '').replace(/^calle\s+/i, '').trim();
    if (!base) return null;
    const ec = String(entrecalles || '').trim();
    const locP = String(localidadPedido || '').replace(/\([^)]*\)?/g, ' ').replace(/\s+/g, ' ').trim();
    // Clave de caché versionada ('z6'): incluye las entrecalles (cambian el
    // resultado) e invalida lo guardado por versiones anteriores. z6 fuerza
    // re-geocodificar con Google y limpia los "no encontrada" cacheados cuando
    // la zona estaba restringida (p. ej. Ramos Mejía, que antes daba null).
    // z7: suma la localidad del pedido (antes se ubicaba sin ella y caía en calles homónimas).
    // z8: Google solo vale a nivel de casa y las entrecalles mandan (ver abajo).
    // z9: solo vale un punto que caiga en el partido de la localidad del pedido (nunca CABA).
    // z10: esquinas con el nombre corto de la calle y Google solo si cae sobre el tramo (24-nov-2026).
    const key = 'z10|' + norm(base) + '|' + norm(ec) + '|' + norm(locP);
    const cache = loadCache();
    if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
    let res = null;
    // Google (si hay clave): solo devuelve algo cuando encontró la casa (calle + altura).
    const goo = await _googleGeocode(base, locP);
    // Separamos la localidad (si viene pegada) para no romper el parser de Georef.
    const pd = partirDireccion(base);
    const calle = pd.calle, localidad = pd.localidad || _locNorm(locP);
    const okLoc = (it) => coincideLocalidad(locP, [it.localidad, it.partido]);
    const qCalle = calle || base;
    // Georef por calle y altura, filtrando por la localidad / el partido del pedido.
    const georefCalle = async () => {
      let list = [];
      if (localidad) {
        list = (await _georefQuery(qCalle, ZONA.provincia, null, 5, localidad))
          .filter((it) => it.lat != null && inZona(it.partido))
          .sort((a, b) => zonaRank(a.partido) - zonaRank(b.partido));
      }
      if (!list.length && localidad && PARTIDO_DE[localidad]) {
        list = (await _georefQuery(qCalle, ZONA.provincia, PARTIDO_DE[localidad], 5)).filter((it) => it.lat != null);
      }
      if (!list.length) list = (await _georefQuery(qCalle, ZONA.provincia, 'Hurlingham', 3)).filter((it) => it.lat != null && okLoc(it));
      if (!list.length) {
        const prov = await _georefQuery(qCalle, ZONA.provincia, null, 30);
        list = prov.filter((it) => inZona(it.partido) && it.lat != null && okLoc(it))
          .sort((a, b) => zonaRank(a.partido) - zonaRank(b.partido));
      }
      return list.map((s) => ({ lat: s.lat, lng: s.lng, display: s.label, localidad: s.localidad || '', partido: s.partido || '', aprox: false }));
    };
    try {
      /* Las ENTRECALLES mandan: las escribe el cliente y dicen en qué cuadra está la casa.
         - Con las dos esquinas ubicadas, la casa está entre ellas. Se toma el punto de Google
           solo si es a nivel de puerta y cae en esa cuadra; si no, la mitad de la cuadra
           (a lo sumo media cuadra de error, pero siempre en la cuadra correcta).
         - Con una sola esquina, se elige el candidato (Google o Georef) más cercano a ella;
           si ninguno queda a menos de 4 cuadras, la esquina.
         Dos "esquinas" a más de 6 cuadras entre sí no son una cuadra: no se usan como tal. */
      const cruces = crucesDe(ec);
      // Si la consulta de las esquinas falla (sin red, límite de consultas), se sigue sin ellas.
      let esq = null;
      try { esq = cruces.length ? await geocodeInterseccion(_soloCalle(qCalle), cruces, localidad) : null; } catch (e) { esq = null; }
      if (esq && esq.largo > 600) esq = null;
      if (esq && esq.largo > 0 && esq.largo <= 600) {
        // El punto de Google tiene que estar SOBRE el tramo de calle entre las dos esquinas (35 m:
        // ancho de una avenida + la vereda). Antes alcanzaba con estar cerca de la mitad de la cuadra
        // y un punto mal cargado en la calle paralela (a 65 m) pasaba como bueno.
        const enCuadra = goo && goo.puerta && esq.esquinas && esq.esquinas.length === 2
          && _metrosAlTramo(goo, esq.esquinas[0], esq.esquinas[1]) <= 35;
        res = enCuadra ? goo : esq;
      } else if (esq) {
        const cands = (goo && !goo.aprox ? [goo] : []).concat(await georefCalle())
          .map((c) => ({ c, d: _metros(c, esq) })).sort((a, b) => a.d - b.d);
        res = cands.length && cands[0].d <= 400 ? cands[0].c : Object.assign({}, esq, { aprox: true });
      }
      // Sin entrecalles: Google a nivel de casa y, si no, Georef por calle y altura.
      if (!res && goo && !goo.aprox) res = goo;
      if (!res) { const l = await georefCalle(); if (l.length) res = l[0]; }
      if (!res && goo) res = goo;
    } catch (e) { if (!res && goo) res = goo; }
    // Lo elegido tiene que estar en la zona de reparto; si no, se prueba con los otros candidatos.
    const valido = async (r) => !!r && await enZonaDeReparto(r.lat, r.lng, locP);
    if (res && !(await valido(res))) {
      res = null;
      let alt = goo ? [goo] : [];
      try { alt = alt.concat(await georefCalle()); } catch (e) {}
      for (const c of alt) { if (await valido(c)) { res = c; break; } }
    }
    // 3) Fallback a OSM/Nominatim, SIEMPRE acotado a la zona; reintento sin altura.
    const baseOsm = locP && !_sinAcento(base).includes(_sinAcento(locP)) ? base + ', ' + locP : base;
    if (!res) { const o = await _queryBounded(baseOsm, false); if (await valido(o)) res = o; }
    if (!res) {
      const b2 = sinAltura(baseOsm);
      if (norm(b2) !== norm(baseOsm)) { const o = await _queryBounded(b2, true); if (await valido(o)) res = o; }
    }
    // Solo cacheamos resultados POSITIVOS: si no se encontró (null), NO lo
    // guardamos, así la próxima vez se reintenta (evita que un "no encontrada"
    // viejo quede pegado y nunca muestre el mapa).
    if (res) { cache[key] = res; saveCache(cache); }
    return res;
  }

  // Zona oeste donde reparte GDO (Hurlingham, Morón, Ituzaingó, Tres de Febrero, Ramos Mejía,
  // San Martín, San Miguel, Merlo, Moreno). Barracas, Floresta o Berazategui quedan afuera.
  const enZonaOeste = (lat, lng) => lat <= -34.48 && lat >= -34.80 && lng <= -58.48 && lng >= -58.90;

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
        const g = await geocode(p.direccion, p.entrecalles, p.localidad);
        if (g) { p.lat = g.lat; p.lng = g.lng; if (g.localidad && !p.localidad) p.localidad = g.localidad; GDO.Store.save(); if (onUpdate) try { onUpdate(p); } catch (e) {} }
        await new Promise((res) => setTimeout(res, 1100));
      }
      /* Re-chequeo de los pedidos activos que YA tienen coordenadas, una sola vez por dirección
         (geoRevisado). Hasta la v120 Google podía devolver el centro de la localidad (la plaza
         de Hurlingham) o una calle homónima de otro partido, y eso quedó guardado en el pedido.
         Se corrige solo si lo nuevo es confiable (o lo viejo estaba fuera de la zona oeste) y
         queda a más de 250 m; lo anterior queda anotado en la historia del pedido. */
      /* v10 (18-nov-2026): la tienda ubica con su copia vieja y guarda el punto interpolado de
         Google, que cae en la ESQUINA (Juan de Garay 3493 quedó en Olascoaga). Como la mitad de
         la cuadra está a menos de 250 m de esa esquina, el re-chequeo no lo corregía nunca.
         Ahora, si la ubicación nueva sale de las dos entrecalles (g.largo > 0) o es de Google
         a nivel de puerta, se corrige a partir de 30 m. Lo que una persona fijó a mano
         (geoManual: GPS o coordenadas pegadas) no se toca. */
      // v11 (24-nov-2026): las esquinas ahora se encuentran con el nombre corto de la calle; se
      // revisan de nuevo los pedidos activos una vez.
      const marca = (p) => 'v11|' + norm(p.direccion + '|' + (p.entrecalles || '') + '|' + (p.localidad || ''));
      const revisar = GDO.Store.pedidos().filter((p) => p.lat != null && p.lng != null && p.direccion && activos.includes(p.estado)
        && p.modalidad !== 'retiro' && p.geoRevisado !== marca(p));
      for (const p of revisar) {
        const g = await geocode(p.direccion, p.entrecalles, p.localidad);
        const cambio = { geoRevisado: marca(p) };
        const fuera = !enZonaOeste(p.lat, p.lng) || !(await enZonaDeReparto(p.lat, p.lng, p.localidad));
        const dist = g ? _metros({ lat: p.lat, lng: p.lng }, g) : 0;
        const fino = g && (g.largo > 0 || g.puerta) && dist > 30;
        const grueso = g && (!g.aprox || fuera) && dist > 250;
        if (!p.geoManual && (fino || grueso)) {
          cambio.lat = g.lat; cambio.lng = g.lng;
          cambio.historia = (p.historia || []).concat([{ ts: Date.now(), por: 'sistema', detalle: 'Ubicación corregida (antes ' + Number(p.lat).toFixed(5) + ',' + Number(p.lng).toFixed(5) + ')', est: 'editado' }]);
        }
        GDO.Store.upsertPedido(Object.assign({ id: p.id }, cambio)); GDO.Store.save();
        if (cambio.lat != null && onUpdate) try { onUpdate(p); } catch (e) {}
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

  /* Castelar Sur e Ituzaingó Sur: por ahora NO se entrega (decisión de Matías, 16-nov-2026). Morón se entrega entero.
     El código postal no los separa (Castelar entero es 1712, Ituzaingó entero 1714): el límite son
     las vías del tren Sarmiento. Tendido tomado de OpenStreetMap, [lng, lat] de oeste a este. */
  const VIAS = [[-58.7000, -34.66575], [-58.6900, -34.66445], [-58.6775, -34.66286], [-58.6725, -34.66168], [-58.6650, -34.65921], [-58.6575, -34.65686], [-58.6500, -34.65429], [-58.6425, -34.65233], [-58.6375, -34.65071], [-58.6300, -34.64912], [-58.6250, -34.64841], [-58.6225, -34.64824], [-58.6175, -34.64818], [-58.6125, -34.64731], [-58.5950, -34.64490], [-58.5655, -34.64060]];
  function latVias(lng) {
    let i = 0;
    while (i < VIAS.length - 2 && lng > VIAS[i + 1][0]) i++;
    const a = VIAS[i], b = VIAS[i + 1];
    return a[1] + (b[1] - a[1]) * (lng - a[0]) / (b[0] - a[0]);
  }
  const sinTilde = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // ¿En esa localidad hay un lado al que no vamos?
  const conVias = (localidad) => { const l = sinTilde(localidad); return /castelar/.test(l) ? 'Castelar' : /ituzaingo/.test(l) ? 'Ituzaingó' : ''; };
  // 'Castelar Sur' / 'Ituzaingó Sur' / 'Morón Sur' si el punto cae al sur de las vías; '' si se entrega.
  function sinEntrega(lat, lng, localidad) {
    const m = conVias(localidad);
    if (!m || lat == null || lng == null || isNaN(+lat) || isNaN(+lng)) return '';
    if (+lng < -58.72 || +lng > -58.5655) return '';   // lejos de ese tramo: lo resuelve el control de partido
    return +lat < latVias(+lng) ? m + ' Sur' : '';
  }

  GDO.Geo = { sinEntrega, enZonaDeReparto, geocode, suggest, attachAutocomplete, locatePending, parseLatLng, esLinkCorto };
})();
