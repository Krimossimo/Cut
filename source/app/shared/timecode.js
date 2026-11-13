/*
 * Cut — utilitaires de timecode partagés entre le processus principal et l'interface.
 * Format affiché : HH:MM:SS.mmm
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Timecode = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function pad(n, w) {
    return String(n).padStart(w, '0');
  }

  /** Secondes -> "HH:MM:SS.mmm" */
  function format(seconds, { ms = true } = {}) {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const totalMs = Math.round(seconds * 1000);
    const h = Math.floor(totalMs / 3600000);
    const m = Math.floor((totalMs % 3600000) / 60000);
    const s = Math.floor((totalMs % 60000) / 1000);
    const milli = totalMs % 1000;
    const base = `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}`;
    return ms ? `${base}.${pad(milli, 3)}` : base;
  }

  /** Durée lisible courte : "2 min 56 s", "1 h 04 min", "3,4 s" */
  function human(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    if (seconds < 10) return `${seconds.toFixed(1).replace('.', ',')} s`;
    const t = Math.round(seconds);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    if (h > 0) return `${h} h ${pad(m, 2)} min`;
    if (m > 0) return `${m} min ${pad(s, 2)} s`;
    return `${s} s`;
  }

  /** Compact pour un nom de fichier : "00h12m03s" */
  function forFilename(seconds) {
    const t = Math.floor(Math.max(0, seconds));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return `${pad(h, 2)}h${pad(m, 2)}m${pad(s, 2)}s`;
  }

  /**
   * Analyse une saisie utilisateur. Accepte :
   *   "01:02:03.500", "1:02:03,5", "02:03", "123", "123.25",
   *   "1h02m03s", "2m30", "45s", "1h"
   * Retourne un nombre de secondes, ou null si la saisie est invalide.
   */
  function parse(input) {
    if (input == null) return null;
    let str = String(input).trim().toLowerCase().replace(/,/g, '.').replace(/\s+/g, '');
    if (!str) return null;

    // Notation 1h02m03.5s
    if (/[hms]/.test(str)) {
      const re = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s?)?$/;
      const m = str.match(re);
      if (!m || (!m[1] && !m[2] && !m[3])) return null;
      return (parseFloat(m[1] || 0) * 3600) + (parseFloat(m[2] || 0) * 60) + parseFloat(m[3] || 0);
    }

    // Notation HH:MM:SS.mmm / MM:SS / SS
    const parts = str.split(':');
    if (parts.length > 3) return null;
    if (!parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return null;
    // Seule la dernière composante peut avoir des décimales
    if (parts.slice(0, -1).some((p) => p.includes('.'))) return null;
    let total = 0;
    for (const p of parts) total = total * 60 + parseFloat(p);
    return Number.isFinite(total) ? total : null;
  }

  return { format, human, forFilename, parse };
});
