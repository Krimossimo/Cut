/*
 * Cut — processus principal (Electron).
 */
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const ff = require('./lib/ffmpeg');
const { Settings } = require('./lib/settings');

const IS_WIN = process.platform === 'win32';
const APP_ID = 'com.krimossimo.cut';
const VIDEO_EXT = ['mp4', 'mkv', 'mov', 'm4v', 'webm', 'ts', 'mts', 'm2ts', 'flv', 'avi'];

// --- Emplacements des données : paramètres dans %APPDATA%\Cut, caches dans %LOCALAPPDATA%\Cut
app.setName('Cut');
const userDataDir = process.env.CUT_USER_DATA || path.join(app.getPath('appData'), 'Cut');
app.setPath('userData', userDataDir);
const localBase = IS_WIN && process.env.LOCALAPPDATA && !process.env.CUT_USER_DATA
  ? path.join(process.env.LOCALAPPDATA, 'Cut')
  : path.join(userDataDir, 'Local');
app.setPath('sessionData', path.join(localBase, 'Session'));
app.setPath('crashDumps', path.join(localBase, 'Crashpad'));
if (IS_WIN) app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let settings;
let win = null;
let currentJob = null;
let pendingOpen = findVideoArg(process.argv);

function findVideoArg(argv) {
  for (const a of argv.slice(1)) {
    if (!a || a.startsWith('-')) continue;
    const ext = path.extname(a).slice(1).toLowerCase();
    if (!VIDEO_EXT.includes(ext)) continue;
    try {
      if (fs.statSync(a).isFile()) return path.resolve(a);
    } catch { /* ignore */ }
  }
  return null;
}

function iconPath() {
  return path.join(__dirname, 'assets', IS_WIN ? 'icon.ico' : 'icon-256.png');
}

function restoreBounds() {
  const saved = settings.get('window');
  const def = { width: 1280, height: 860 };
  if (!saved || !saved.width) return def;
  const area = screen.getDisplayMatching(saved).workArea;
  const visible = saved.x >= area.x - 50 && saved.y >= area.y - 50
    && saved.x + 200 <= area.x + area.width && saved.y + 100 <= area.y + area.height;
  return visible ? saved : { width: saved.width, height: saved.height };
}

function createWindow() {
  const bounds = restoreBounds();
  win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: 'Cut',
    icon: iconPath(),
    backgroundColor: '#0B0B0C',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0B0B0C', symbolColor: '#A1A1A8', height: 48 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  if (settings.get('window') && settings.get('window').maximized) win.maximize();

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Aucune navigation hors de l'application (un fichier déposé hors zone ne doit pas l'ouvrir).
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const saveBounds = () => {
    if (!win || win.isDestroyed()) return;
    const maximized = win.isMaximized();
    const b = maximized ? (settings.get('window') || win.getNormalBounds()) : win.getBounds();
    settings.set({ window: { ...b, maximized } });
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);

  win.on('close', (e) => {
    if (currentJob) {
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning',
        buttons: ['Annuler l\'export et quitter', 'Continuer l\'export'],
        defaultId: 1,
        cancelId: 1,
        title: 'Cut',
        message: 'Un export est en cours.',
        detail: 'Quitter maintenant annulera l\'export et supprimera le fichier incomplet.',
      });
      if (choice === 1) {
        e.preventDefault();
        return;
      }
      currentJob.cancel();
    }
    saveBounds();
  });
  win.on('closed', () => { win = null; });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Journal du dernier export (%APPDATA%\Cut\logs\dernier-export.txt), utile en cas de souci.
function writeExportLog(opts, keyframes, plan, result) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const lines = [
      `Cut ${app.getVersion()} — ${new Date().toISOString()}`,
      `Source : ${opts.input}`,
      `Sortie : ${opts.output}`,
      `Mode : ${opts.mode}  ·  image clé : ${opts.snap}`,
      `Début demandé : ${opts.start}  ·  Fin : ${opts.end}`,
      `Début du fichier (start_time) : ${opts.info && opts.info.startTime}`,
      `Images clés : précédente=${keyframes && keyframes.prev}  suivante=${keyframes && keyframes.next}`,
      plan ? `Début réel : ${plan.effectiveStart}  ·  durée prévue : ${plan.clipDuration}` : '',
      plan ? `Commande : ffmpeg ${plan.args.map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(' ')}` : '',
      `Résultat : ${JSON.stringify({ ok: result.ok, cancelled: result.cancelled, error: result.error, warning: result.warning, duration: result.clipDuration, detail: result.detail })}`,
    ];
    fs.writeFileSync(path.join(dir, 'dernier-export.txt'), lines.filter(Boolean).join('\r\n'), 'utf8');
  } catch { /* non bloquant */ }
}

// ---------------------------------------------------------------- IPC
function registerIpc() {
  ipcMain.handle('app:info', async () => ({
    version: app.getVersion(),
    ffmpeg: await ff.version(),
    ffmpegBundled: ff.resolveBinaries().bundled,
    platform: process.platform,
  }));

  ipcMain.handle('app:takePendingOpen', () => {
    const p = pendingOpen;
    pendingOpen = null;
    return p;
  });

  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:set', (_e, patch) => settings.set(patch));

  ipcMain.handle('dialog:openVideo', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Ouvrir une vidéo',
      defaultPath: settings.get('lastOpenDir') || app.getPath('videos'),
      properties: ['openFile'],
      filters: [
        { name: 'Vidéos', extensions: VIDEO_EXT },
        { name: 'Tous les fichiers', extensions: ['*'] },
      ],
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('dialog:chooseFolder', async (_e, current) => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Dossier d\'exportation',
      defaultPath: current || app.getPath('videos'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('dialog:confirmOverwrite', async (_e, file) => {
    const res = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Remplacer', 'Annuler'],
      defaultId: 1,
      cancelId: 1,
      title: 'Cut',
      message: `« ${path.basename(file)} » existe déjà.`,
      detail: 'Voulez-vous le remplacer ?',
    });
    return res.response === 0;
  });

  ipcMain.handle('dialog:farKeyframe', async (_e, { offsetText, startText }) => {
    const res = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Utiliser « Début exact »', 'Exporter quand même', 'Annuler'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      title: 'Cut',
      message: 'Pas d\'image clé proche de votre point de début.',
      detail: `Sans réencodage, le clip commencerait à ${startText}, soit ${offsetText} avant votre point de début.\n\n`
        + '« Début exact » réencode seulement le passage jusqu\'à la première image clé et copie le reste sans perte.',
    });
    return ['smart', 'copy', 'cancel'][res.response];
  });

  ipcMain.handle('video:probe', async (_e, file) => {
    try {
      const info = await ff.probe(file);
      info.url = pathToFileURL(file).href;
      settings.set({ lastOpenDir: info.dir });
      return { ok: true, info };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('video:keyframes', async (_e, file, t, info) => {
    try {
      return { ok: true, ...(await ff.keyframesAround(file, t, info)) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('fs:exists', (_e, p) => {
    try { return fs.existsSync(p); } catch { return false; }
  });

  ipcMain.handle('fs:dirOk', (_e, p) => {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  });

  ipcMain.handle('path:join', (_e, ...parts) => path.join(...parts));

  ipcMain.handle('shell:showItem', (_e, p) => {
    shell.showItemInFolder(p);
    return true;
  });

  ipcMain.handle('export:start', async (_e, opts) => {
    if (currentJob) return { ok: false, error: 'Un export est déjà en cours.' };
    try {
      const { input, info } = opts;
      let keyframes = null;
      if (opts.mode !== 'precise' && opts.start > 0.0005) {
        keyframes = await ff.keyframesAround(input, opts.start, info);
      }
      fs.mkdirSync(path.dirname(opts.output), { recursive: true });
      const job = ff.exportClip({ ...opts, keyframes }, (p) => send('export:progress', p));
      currentJob = job;
      send('export:started', { args: job.plan.args, reencode: job.plan.reencode, encoderLabel: job.plan.encoderLabel });
      const result = await job.promise;
      writeExportLog(opts, keyframes, job.plan, result);
      delete result.outInfo;
      return result;
    } catch (err) {
      writeExportLog(opts, null, null, { ok: false, error: err.message || String(err) });
      return { ok: false, error: err.message || String(err) };
    } finally {
      currentJob = null;
    }
  });

  ipcMain.handle('export:cancel', () => {
    if (currentJob) currentJob.cancel();
    return true;
  });
}

// ---------------------------------------------------------------- Cycle de vie
app.on('second-instance', (_e, argv) => {
  const file = findVideoArg(argv);
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
    if (file) send('app:open', file);
  }
});

app.whenReady().then(() => {
  settings = new Settings(app.getPath('userData'));
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => {
  if (settings) settings.saveNow();
  app.quit();
});
