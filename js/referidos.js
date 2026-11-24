/* ====== GDO CLUB — REFERIDOS ======
   Un socio comparte su link (club.html?ref=<N° de socio>). El amigo que se asocia
   por ese link queda con  referidoPor: <N° del que lo invitó>  en su perfil.

   REGLA (Matías, nov-2026): la PRIMERA carga de puntos del referido le suma
   EXACTAMENTE lo mismo al que lo invitó. Las compras siguientes, no.

   Cómo se garantiza "una sola vez": el renglón del que invitó se guarda en
   /puntos_log con un id FIJO  ref_<uid del referido>. Ese documento solo se puede
   crear (las reglas no dejan editar ni borrar el registro), así que el segundo
   intento choca aunque dos cajas carguen a la vez. Va en la MISMA transacción que
   la carga del referido: o entran las dos cosas, o ninguna.

   Lo usan TODOS los caminos que suman puntos: carga a mano y por ticket
   (views/club.js) y la entrega del chofer (views/repartidor.js). El bot de
   WhatsApp tiene su copia (src/puntos.js): si se cambia algo acá, cambiarlo allá. */
window.GDO = window.GDO || {};
(function () {
  const padNro = (n) => ('0000' + (n || 0)).slice(-4);
  const idLog = (referidoUid) => 'ref_' + referidoUid;
  const motivo = (nroReferido) => 'Puntos por referido, socio N° ' + padNro(nroReferido);

  /* PASO 1 — ANTES de la transacción (una búsqueda no puede ir adentro).
     Devuelve { refUid, refNro } si el socio fue invitado por otro que existe, o
     null si no hay nada que pagar. Si falla la lectura, falla la carga entera:
     es preferible reintentar antes que dejar pasar la primera compra sin pagarle
     al que invitó. */
  function preparar(fdb, clienteUid) {
    return fdb.collection('clientes').doc(clienteUid).get().then((cd) => {
      const c = cd.exists ? (cd.data() || {}) : null;
      const refNro = c ? parseInt(c.referidoPor, 10) : 0;
      if (!refNro || refNro <= 0) return null;
      return fdb.collection('clientes').where('nroSocio', '==', refNro).limit(2).get().then((s) => {
        if (s.size !== 1 || s.docs[0].id === clienteUid) return null;   // no existe, repetido o él mismo
        return { refUid: s.docs[0].id, refNro: refNro };
      });
    });
  }

  /* PASO 2 — DENTRO de la transacción, junto con las demás lecturas y antes de
     escribir nada. Devuelve el estado para pagar(), o null si ya se pagó. */
  function leer(tx, fdb, plan, clienteUid) {
    if (!plan) return Promise.resolve(null);
    const mref = fdb.collection('puntos_log').doc(idLog(clienteUid));
    const rref = fdb.collection('clientes').doc(plan.refUid);
    return tx.get(mref).then((md) => {
      if (md.exists) return null;                       // ese referido ya pagó su primera compra
      return tx.get(rref).then((rd) => (rd.exists ? { mref: mref, rref: rref, rd: rd } : null));
    });
  }

  /* PASO 3 — DENTRO de la transacción, con las escrituras. `cd` es el perfil del
     referido leído en esta misma transacción. Devuelve { nro, nombre, pts, saldo }
     del que invitó si se le pagó, o null. extra: { por, ts, ticketNro }. */
  function pagar(tx, st, cd, clienteUid, pts, extra) {
    if (!st || !(pts > 0)) return null;
    const c = cd.data() || {}, r = st.rd.data() || {};
    const refNro = parseInt(c.referidoPor, 10) || 0;
    if (!refNro || Number(r.nroSocio) !== refNro) return null;        // cambió entre la búsqueda y ahora
    if (st.rd.id === clienteUid) return null;                          // nadie se refiere a sí mismo
    if (Number(c.nroSocio) && refNro >= Number(c.nroSocio)) return null; // el que invita es socio de antes
    extra = extra || {};
    const saldo = (r.puntos || 0) + pts;
    tx.update(st.rref, { puntos: saldo, ultimoReferido: idLog(clienteUid) });
    const log = {
      clienteUid: st.rd.id, delta: pts, motivo: motivo(c.nroSocio), saldo: saldo, tipo: 'referido',
      referidoUid: clienteUid, referidoNro: Number(c.nroSocio) || 0, por: extra.por || null, ts: extra.ts,
    };
    if (extra.ticketNro) log.ticketNro = String(extra.ticketNro);
    tx.set(st.mref, log);
    return { nro: refNro, nombre: r.nombre || '', pts: pts, saldo: saldo };
  }

  // Texto corto para el aviso en pantalla después de cargar.
  function aviso(ref, fmt) {
    return ref ? ' + ' + (fmt ? fmt(ref.pts) : ref.pts) + ' al socio N° ' + padNro(ref.nro) + ' que lo invitó' : '';
  }

  GDO.Referidos = { preparar: preparar, leer: leer, pagar: pagar, aviso: aviso, idLog: idLog, motivo: motivo };
})();
