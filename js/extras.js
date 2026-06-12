/* ====== GDO Reparto — utilidades extra (estilo Circuit) ======
   Tres ayudantes livianos, sin dependencias, que usan las vistas:
   - GDO.Wpp : avisar al cliente por WhatsApp (link wa.me con texto armado).
   - GDO.Img : comprimir la foto del comprobante para que no infle Firestore.
   - GDO.Sign: pad de firma sobre un <canvas> (dedo o mouse).
   Todo gratis, sin API ni tarjeta. */
window.GDO = window.GDO || {};
(function () {

  /* ---------------- WhatsApp ---------------- */
  // Normaliza un teléfono argentino a formato internacional para wa.me.
  // Reglas de AR: país 54, celular agrega 9. Aceptamos lo que el operador
  // haya cargado (con/ sin 0, con/ sin 15, con guiones o espacios) y lo dejamos
  // como 549XXXXXXXXXX. Si ya viene con 54 lo respetamos.
  function telWpp(raw) {
    let d = String(raw || '').replace(/[^\d]/g, '');
    if (!d) return '';
    // saca prefijo internacional 00
    if (d.startsWith('00')) d = d.slice(2);
    // ya viene con código de país
    if (d.startsWith('54')) {
      let rest = d.slice(2);
      if (rest.startsWith('9')) rest = rest.slice(1); // normalizo, lo re-agrego abajo
      rest = rest.replace(/^0/, '').replace(/^15/, '');
      return '549' + rest;
    }
    // saca 0 inicial (larga distancia) y el 15 de celular
    d = d.replace(/^0/, '');
    // si quedó un 15 al principio del abonado lo sacamos
    d = d.replace(/^15/, '');
    return '549' + d;
  }

  // ¿Tenemos un teléfono usable? (al menos ~8 dígitos de abonado)
  function tieneTel(raw) {
    const d = String(raw || '').replace(/[^\d]/g, '');
    return d.length >= 8;
  }

  function linkWpp(tel, texto) {
    const t = telWpp(tel);
    const q = texto ? '?text=' + encodeURIComponent(texto) : '';
    return t ? 'https://wa.me/' + t + q : '';
  }

  // Mensajes listos para distintos momentos del reparto.
  function msg(tipo, p, extra) {
    extra = extra || {};
    // Solo el PRIMER nombre del cliente, para que el mensaje sea más cercano.
    const nom = ((p.cliente || '').trim().split(/\s+/)[0] || '').trim();
    const saludo = nom ? '¡Hola ' + nom + '! 👋 ' : '¡Hola! 👋 ';
    const firma = '\n\n— Granja del Oeste 🐔';
    if (tipo === 'salio') {
      return saludo + '🚚 Tu pedido ya salió para entrega' +
        (extra.eta ? ' y llegaría aproximadamente a las ' + extra.eta + ' hs ⏰' : '') + '.' +
        (extra.link ? '\n\n📍 Seguí tu entrega en vivo acá:\n' + extra.link : '') + firma;
    }
    if (tipo === 'cerca') {
      return saludo + '📍 ¡Tu pedido está por llegar!' +
        (extra.eta ? ' (aprox. ' + extra.eta + ' hs ⏰)' : '') + ' Te pedimos que estés atento/a. 🙌' +
        (extra.link ? '\n\n📍 Seguimiento en vivo:\n' + extra.link : '') + firma;
    }
    if (tipo === 'entregado') {
      const rec = ((p.pod && p.pod.receptor) || '').trim();
      return saludo + '✅ Te confirmamos que tu pedido fue entregado' + (rec ? ', recibido por ' + rec : '') + '. ¡Gracias por tu compra! 🙏' + firma;
    }
    if (tipo === 'reprogramar') {
      return saludo + '🔁 No pudimos completar la entrega de tu pedido hoy. Nos comunicamos para reprogramarla. 📅' + firma;
    }
    // genérico
    return saludo + '📦 Te escribimos por tu pedido.' + firma;
  }

  // Link público de seguimiento en vivo (página servida en el dominio de la
  // tienda para clientes; vive en tienda/seguir.html → lista.granjadeloeste.com).
  function seguimientoUrl(pedidoId) {
    return 'https://lista.granjadeloeste.com/seguir.html?p=' + encodeURIComponent(pedidoId);
  }

  GDO.Wpp = { tel: telWpp, tieneTel, link: linkWpp, msg, seguimientoUrl };

  /* ---------------- Compresión de imagen ---------------- */
  // Toma un File (foto de la cámara) y devuelve un dataURL JPEG reducido.
  // Reduce el lado mayor a maxLado px y baja la calidad para quedar en ~50-150KB,
  // muy por debajo del límite de 1MB por documento de Firestore.
  function comprimir(file, maxLado, calidad) {
    maxLado = maxLado || 1000; calidad = calidad || 0.6;
    return new Promise((resolve, reject) => {
      if (!file) { reject(new Error('sin archivo')); return; }
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('no se pudo leer'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('imagen inválida'));
        img.onload = () => {
          let { width: w, height: h } = img;
          if (w > h && w > maxLado) { h = Math.round(h * maxLado / w); w = maxLado; }
          else if (h >= w && h > maxLado) { w = Math.round(w * maxLado / h); h = maxLado; }
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const ctx = cv.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          try { resolve(cv.toDataURL('image/jpeg', calidad)); }
          catch (e) { reject(e); }
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  GDO.Img = { comprimir };

  /* ---------------- Pad de firma ---------------- */
  // Engancha eventos de dibujo a un <canvas>. Devuelve { limpiar, vacio, dataURL }.
  // Funciona con dedo (touch) y mouse. Trazo negro sobre fondo blanco.
  function pad(canvas) {
    const ctx = canvas.getContext('2d');
    // escala para pantallas retina sin deformar el trazo
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
    let dibujando = false, vacio = true, lx = 0, ly = 0;
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    const start = (e) => { e.preventDefault(); dibujando = true; const p = pos(e); lx = p.x; ly = p.y; };
    const move = (e) => {
      if (!dibujando) return; e.preventDefault();
      const p = pos(e);
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(p.x, p.y); ctx.stroke();
      lx = p.x; ly = p.y; vacio = false;
    };
    const end = () => { dibujando = false; };
    canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
    return {
      limpiar() { ctx.clearRect(0, 0, canvas.width, canvas.height); vacio = true; },
      vacio() { return vacio; },
      dataURL() { return vacio ? '' : canvas.toDataURL('image/png'); },
    };
  }

  GDO.Sign = { pad };

  /* ---------------- CSV ---------------- */
  // Detecta el separador (coma, punto y coma o tab) mirando la primera línea.
  function detectarSep(texto) {
    const linea = (texto.split(/\r?\n/)[0] || '');
    const cand = [[';', (linea.match(/;/g) || []).length], [',', (linea.match(/,/g) || []).length], ['\t', (linea.match(/\t/g) || []).length]];
    cand.sort((a, b) => b[1] - a[1]);
    return cand[0][1] > 0 ? cand[0][0] : ',';
  }

  // Parser CSV que respeta comillas dobles (incluye saltos de línea y comillas
  // escapadas ""). Devuelve un array de filas (array de celdas string).
  function parseCSV(texto, sep) {
    sep = sep || detectarSep(texto);
    const filas = [];
    let fila = [], celda = '', i = 0, enComillas = false;
    const t = texto.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    while (i < t.length) {
      const c = t[i];
      if (enComillas) {
        if (c === '"') {
          if (t[i + 1] === '"') { celda += '"'; i += 2; continue; }
          enComillas = false; i++; continue;
        }
        celda += c; i++; continue;
      }
      if (c === '"') { enComillas = true; i++; continue; }
      if (c === sep) { fila.push(celda); celda = ''; i++; continue; }
      if (c === '\n') { fila.push(celda); filas.push(fila); fila = []; celda = ''; i++; continue; }
      celda += c; i++;
    }
    fila.push(celda); filas.push(fila);
    // descarta filas totalmente vacías
    return filas.filter((f) => f.some((x) => String(x).trim() !== ''));
  }

  // Convierte un texto de productos ("Pollo x40, Huevos x 20", "40 pollo; 20 huevos")
  // en items [{producto, cantidad}]. Si no encuentra cantidad, asume 1.
  function parseItems(texto) {
    const s = String(texto || '').trim();
    if (!s) return [];
    return s.split(/[,;\n]+/).map((parte) => {
      const p = parte.trim();
      if (!p) return null;
      // "Producto x40" / "Producto 40"
      let m = p.match(/^(.+?)\s*[x×]?\s*(\d+)\s*$/i);
      if (m && m[1].replace(/[x×]/i, '').trim()) return { producto: m[1].replace(/\s*[x×]\s*$/i, '').trim(), cantidad: parseInt(m[2], 10) || 1 };
      // "40 Producto" / "40x Producto"
      m = p.match(/^(\d+)\s*[x×]?\s*(.+)$/i);
      if (m) return { producto: m[2].trim(), cantidad: parseInt(m[1], 10) || 1 };
      return { producto: p, cantidad: 1 };
    }).filter(Boolean);
  }

  GDO.CSV = { parse: parseCSV, detectarSep, parseItems };
})();
