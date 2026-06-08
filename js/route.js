/* ====== GDO Reparto — optimización y mapa ======
   Prototipo: optimización por vecino-más-cercano (nearest neighbor) sobre
   coordenadas, distancia haversine y tiempos estimados con velocidad urbana.
   En producción se reemplaza por OpenRouteService / Google Directions con
   optimización real de waypoints y tráfico en vivo (misma firma de salida). */
window.GDO = window.GDO || {};
(function () {
  const VEL_KMH = 24;          // velocidad urbana promedio estimada
  const SALIDA_DEFAULT = 8 * 60; // 08:00 hs por defecto

  function haversine(a, b) {
    const R = 6371, toR = (d) => d * Math.PI / 180;
    const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); // km
  }

  // Optimiza el orden de paradas para una ruta en herradura (circuito cerrado):
  // salida (origen) -> paradas -> regreso (destino, normalmente el mismo depósito).
  // Paso 1: ruta inicial por vecino más cercano. Paso 2: 2-opt, que invierte
  // tramos para deshacer los cruces; así la ruta no pasa dos veces por el mismo
  // lugar ni queda "estirada" terminando en el punto más lejano. Es la mejora
  // clásica de TSP y da la forma de herradura/lazo que se quiere.
  // paradas: [{lat,lng,...}]  origen/destino: {lat,lng}
  function vecinoMasCercano(origen, paradas) {
    const pend = paradas.slice();
    const orden = [];
    let actual = origen;
    while (pend.length) {
      let bi = 0, bd = Infinity;
      pend.forEach((p, i) => { const d = haversine(actual, p); if (d < bd) { bd = d; bi = i; } });
      const next = pend.splice(bi, 1)[0];
      orden.push(next); actual = next;
    }
    return orden;
  }

  // 2-opt sobre el circuito origen -> orden -> destino (extremos fijos).
  // Invierte el tramo [i..k] solo si acorta la distancia total. Usa el delta
  // local (las 2 aristas que cambian) en vez de recalcular todo el recorrido.
  function dosOpt(origen, orden, destino) {
    const ruta = orden.slice();
    const n = ruta.length;
    if (n < 2) return ruta;
    let mejoro = true, vueltas = 0;
    const MAX = 50; // tope de seguridad
    while (mejoro && vueltas++ < MAX) {
      mejoro = false;
      for (let i = 0; i < n - 1; i++) {
        const A = i === 0 ? origen : ruta[i - 1];
        const B = ruta[i];
        for (let k = i + 1; k < n; k++) {
          const C = ruta[k];
          const D = k === n - 1 ? destino : ruta[k + 1];
          const delta = (haversine(A, C) + haversine(B, D)) - (haversine(A, B) + haversine(C, D));
          if (delta < -1e-9) {
            let a = i, b = k;
            while (a < b) { const t = ruta[a]; ruta[a] = ruta[b]; ruta[b] = t; a++; b--; }
            mejoro = true;
            break; // B cambió; rehago el barrido desde i
          }
        }
        if (mejoro) break;
      }
    }
    return ruta;
  }

  function optimizar(origen, paradas, destino) {
    if (paradas.length <= 2) return vecinoMasCercano(origen, paradas);
    const inicial = vecinoMasCercano(origen, paradas);
    return dosOpt(origen, inicial, destino || origen);
  }

  // Calcula tiempos acumulados. demoraPorParada en minutos (puede ser por parada).
  // Si se pasa `road` (resultado de fetchRoad con legs por tramo), usa distancias
  // y tiempos REALES por calle; si no, cae a la estimación haversine.
  // Devuelve {tramos, totalKm, totalMin, llegada[], salida[], road}
  function calcular(origen, ordenParadas, destino, demoraGlobalMin, demoraPorId, salidaMin, road) {
    const salida = salidaMin == null ? SALIDA_DEFAULT : salidaMin;
    // legs reales esperados: origen→p1, p1→p2, …, pn→destino (length = n+1)
    const useRoad = road && road.legs && road.legs.length === ordenParadas.length + 1;
    let t = salida, km = 0;
    const llegada = [], salidaArr = [];
    let prev = origen;
    ordenParadas.forEach((p, i) => {
      let d, min;
      if (useRoad) { d = road.legs[i].km; min = road.legs[i].min; }
      else { d = haversine(prev, p); min = (d / VEL_KMH) * 60; }
      km += d; t += min;
      llegada.push(t);
      const dem = (demoraPorId && demoraPorId[p.id] != null) ? demoraPorId[p.id] : demoraGlobalMin;
      t += dem;
      salidaArr.push(t);
      prev = p;
    });
    // regreso al destino
    let dv, dvmin;
    if (useRoad) { dv = road.legs[ordenParadas.length].km; dvmin = road.legs[ordenParadas.length].min; }
    else { dv = haversine(prev, destino); dvmin = (dv / VEL_KMH) * 60; }
    km += dv; t += dvmin;
    return {
      totalKm: Math.round(km * 10) / 10,
      totalMin: Math.round(t - salida),
      regresoMin: t,
      salidaMin: salida,
      llegada, salida: salidaArr,
      road: useRoad,
    };
  }

  /* ---------- Ruteo real por calles (OSRM, gratis y sin API key) ----------
     Servidor público de demostración de OSRM. Devuelve la geometría del
     recorrido siguiendo las calles + distancia y duración reales por tramo.
     Se cachea por secuencia de coordenadas para no repetir consultas (cambiar
     una demora no vuelve a pedir el trazado). En producción se apunta a un
     OSRM propio u OpenRouteService con la misma firma. */
  const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  const _roadCache = {};
  const _sig = (pts) => pts.map((c) => c[0].toFixed(5) + ',' + c[1].toFixed(5)).join(';');

  // origen/destino: {lat,lng}; ordenParadas: [{lat,lng,...}]
  // Devuelve {geometry:[[lat,lng]...], legs:[{km,min}], totalKm, totalMin} o null.
  async function fetchRoad(origen, ordenParadas, destino) {
    if (!origen || !destino) return null;
    const pts = [[origen.lng, origen.lat], ...ordenParadas.map((p) => [p.lng, p.lat]), [destino.lng, destino.lat]];
    if (pts.some((c) => c[0] == null || c[1] == null)) return null;
    const key = _sig(pts);
    if (_roadCache[key]) return _roadCache[key];
    try {
      const url = OSRM + pts.map((c) => c[0] + ',' + c[1]).join(';') + '?overview=full&geometries=geojson';
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) return null;
      const j = await r.json();
      if (!j || !j.routes || !j.routes.length) return null;
      const rt = j.routes[0];
      const out = {
        geometry: (rt.geometry.coordinates || []).map((c) => [c[1], c[0]]),
        legs: (rt.legs || []).map((l) => ({ km: l.distance / 1000, min: l.duration / 60 })),
        totalKm: rt.distance / 1000,
        totalMin: rt.duration / 60,
      };
      _roadCache[key] = out;
      return out;
    } catch (e) { return null; }
  }

  /* ---------- Mapa Leaflet ---------- */
  let _map = null, _layers = [];
  function clearLayers() { _layers.forEach((l) => { try { _map.removeLayer(l); } catch (e) {} }); _layers = []; }

  function pinIcon(txt, color) {
    if (!window.L) return null;
    return L.divIcon({
      className: '', iconSize: [30, 30], iconAnchor: [15, 15],
      html: `<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center">
               <span style="transform:rotate(45deg);color:#fff;font-weight:700;font-size:12px;font-family:sans-serif">${txt}</span></div>`,
    });
  }

  // Dibuja origen + paradas numeradas + destino y une con polilínea.
  function render(elId, origen, ordenParadas, destino, opts) {
    if (!window.L) return false;
    opts = opts || {};
    const el = document.getElementById(elId);
    if (!el) return false;
    // recrear si no hay mapa, o si el contenedor fue reemplazado por un re-render
    if (!_map || _map.getContainer() !== el || !document.body.contains(_map.getContainer())) {
      if (_map) { try { _map.remove(); } catch (e) {} }
      _map = L.map(el, { zoomControl: true, attributionControl: false });
      _map._gdoEl = elId;
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(_map);
    }
    clearLayers();
    const NEG = '#0f0f0f', NAR = '#F58220';
    const all = [];
    const mo = L.marker([origen.lat, origen.lng], { icon: pinIcon('A', NAR) }).addTo(_map).bindPopup('Salida: ' + (origen.nombre || 'Depósito'));
    _layers.push(mo); all.push([origen.lat, origen.lng]);
    ordenParadas.forEach((p, i) => {
      const m = L.marker([p.lat, p.lng], { icon: pinIcon(String(i + 1), NEG) }).addTo(_map)
        .bindPopup(`<b>${i + 1}. ${p.cliente}</b><br>${p.direccion}`);
      _layers.push(m); all.push([p.lat, p.lng]);
    });
    if (!opts.sameAsOrigin) {
      const md = L.marker([destino.lat, destino.lng], { icon: pinIcon('B', NAR) }).addTo(_map).bindPopup('Regreso: ' + (destino.nombre || 'Depósito'));
      _layers.push(md);
    }
    all.push([destino.lat, destino.lng]);
    // Trazado: si tenemos la geometría real por calles (opts.geometry) la usamos;
    // si no, unimos los puntos con líneas rectas (estimación).
    const trazo = (opts.geometry && opts.geometry.length) ? opts.geometry : all;
    const line = L.polyline(trazo, { color: NAR, weight: 5, opacity: .85, lineJoin: 'round', lineCap: 'round' }).addTo(_map);
    _layers.push(line);
    try { _map.fitBounds(L.latLngBounds(trazo).pad(0.18)); } catch (e) {}
    setTimeout(() => { try { _map.invalidateSize(); } catch (e) {} }, 120);
    return true;
  }

  // Punto para Google Maps: prioriza las COORDENADAS sobre el texto. Maps
  // siempre resuelve un lat/lng, mientras que las direcciones argentinas con
  // localidad secundaria o abreviaturas ("Bmé.", "Villa Tesei") a veces Google
  // "no las encuentra". Como los pedidos reales se geocodifican (las coords
  // salen de la propia dirección), el lat/lng apunta al lugar correcto. El texto
  // queda de respaldo solo si el pedido todavía no tiene coordenadas.
  function locParam(p) {
    if (!p) return '';
    if (p.lat != null) return `${p.lat},${p.lng}`;
    const dir = String(p.direccion || '').trim();
    if (dir) return encodeURIComponent(/argentina/i.test(dir) ? dir : dir + ', Buenos Aires, Argentina');
    const nom = String(p.nombre || '').trim();
    return nom ? encodeURIComponent(nom) : '';
  }

  // Link de navegación a TODA la ruta (vista previa para el admin).
  function navLink(origen, paradas, destino) {
    const way = paradas.map(locParam).filter(Boolean).join('|');
    return `https://www.google.com/maps/dir/?api=1&origin=${locParam(origen)}&destination=${locParam(destino)}&waypoints=${way}&travelmode=driving`;
  }

  // Link a UNA sola parada para el chofer: no pasamos origen, así Google Maps
  // usa la ubicación GPS actual del celular y navega solo a ese destino. El
  // chofer vuelve a la app (botón atrás) para confirmar y seguir con la próxima.
  function navStop(parada) {
    if (!parada) return '#';
    const dest = locParam(parada);
    return dest ? `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving` : '#';
  }

  GDO.Route = { haversine, optimizar, calcular, fetchRoad, render, navLink, navStop, locParam, VEL_KMH, SALIDA_DEFAULT };
})();
