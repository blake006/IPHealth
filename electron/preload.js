'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  info: () => ipcRenderer.invoke('app:info'),
  getStore: (key) => ipcRenderer.invoke('store:get', key),
  setStore: (key, value) => ipcRenderer.invoke('store:set', key, value),

  parseImport: (text, opts) => ipcRenderer.invoke('import:parse', { text, opts }),
  fetchSubscription: (url) => ipcRenderer.invoke('import:fetch', url),
  importFile: () => ipcRenderer.invoke('import:file'),

  runTest: (payload) => ipcRenderer.invoke('test:run', payload),
  cancelTest: () => ipcRenderer.invoke('test:cancel'),

  exportFile: (payload) => ipcRenderer.invoke('export:save', payload),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),

  onTestEvent: (cb) => {
    const handler = (_e, ev) => cb(ev);
    ipcRenderer.on('test:event', handler);
    return () => ipcRenderer.removeListener('test:event', handler);
  },
  onCoreLog: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on('core:log', handler);
    return () => ipcRenderer.removeListener('core:log', handler);
  },
});
