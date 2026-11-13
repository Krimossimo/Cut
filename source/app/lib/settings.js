/*
 * Cut — paramètres stockés localement (%APPDATA%\Cut\settings.json sous Windows).
 */
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  exportDir: null, // null = même dossier que la vidéo source
  lastOpenDir: null,
  mode: 'copy', // 'copy' (sans perte) | 'precise' (réencodage)
  snap: 'prev', // image clé 'prev' | 'next' en mode copie
  volume: 0.8,
  muted: false,
  window: null,
};

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = { ...DEFAULTS };
    this.timer = null;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && typeof raw === 'object') this.data = { ...DEFAULTS, ...raw };
    } catch { /* premier lancement ou fichier corrompu : valeurs par défaut */ }
  }

  get(key) {
    return key ? this.data[key] : { ...this.data };
  }

  set(patch) {
    for (const [k, v] of Object.entries(patch || {})) {
      if (k in DEFAULTS) this.data[k] = v;
    }
    this.scheduleSave();
    return this.get();
  }

  scheduleSave() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), 300);
  }

  saveNow() {
    clearTimeout(this.timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch { /* non bloquant */ }
  }
}

module.exports = { Settings, DEFAULTS };
