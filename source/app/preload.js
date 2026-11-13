/*
 * Cut — pont sécurisé entre l'interface et le processus principal.
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

function on(channel, cb) {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('cut', {
  appInfo: () => ipcRenderer.invoke('app:info'),
  takePendingOpen: () => ipcRenderer.invoke('app:takePendingOpen'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  openVideoDialog: () => ipcRenderer.invoke('dialog:openVideo'),
  chooseFolder: (current) => ipcRenderer.invoke('dialog:chooseFolder', current),
  confirmOverwrite: (file) => ipcRenderer.invoke('dialog:confirmOverwrite', file),
  confirmFarKeyframe: (payload) => ipcRenderer.invoke('dialog:farKeyframe', payload),
  probe: (file) => ipcRenderer.invoke('video:probe', file),
  keyframes: (file, t, info) => ipcRenderer.invoke('video:keyframes', file, t, info),
  exists: (p) => ipcRenderer.invoke('fs:exists', p),
  dirOk: (p) => ipcRenderer.invoke('fs:dirOk', p),
  joinPath: (...parts) => ipcRenderer.invoke('path:join', ...parts),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  startExport: (opts) => ipcRenderer.invoke('export:start', opts),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },
  onOpen: (cb) => on('app:open', cb),
  onExportProgress: (cb) => on('export:progress', cb),
  onExportStarted: (cb) => on('export:started', cb),
  platform: process.platform,
});
