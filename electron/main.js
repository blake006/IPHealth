'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

const { Store, DEFAULT_SETTINGS } = require('./lib/store');
const parser = require('./lib/parser');
const { CoreManager } = require('./lib/core');
const { Runner } = require('./lib/runner');

const isDev = process.argv.includes('--dev');

let win = null;
let store = null;
let core = null;
let runner = null;

/* ------------------------------------------------------------------ */
/* 路径                                                                */
/* ------------------------------------------------------------------ */

function resolveCorePath() {
  const candidates = [];
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'core', 'mihomo.exe'));
  }
  candidates.push(path.join(__dirname, '..', 'vendor', 'mihomo.exe'));
  candidates.push(path.join(app.getPath('userData'), 'core', 'mihomo.exe'));
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[candidates.length - 1];
}

/* ------------------------------------------------------------------ */
/* 订阅拉取                                                            */
/* ------------------------------------------------------------------ */

const { fetchSubscription } = require('./lib/subscribe');

/* ------------------------------------------------------------------ */
/* 窗口                                                                */
/* ------------------------------------------------------------------ */

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 660,
    show: false,
    backgroundColor: '#0e1015',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0e1015',
      symbolColor: '#9aa3b2',
      height: 44,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    win.show();
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* ------------------------------------------------------------------ */
/* 初始化                                                              */
/* ------------------------------------------------------------------ */

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  store = new Store(userData);
  nativeTheme.themeSource = 'dark';

  core = new CoreManager({
    corePath: resolveCorePath(),
    dataDir: path.join(userData, 'core-data'),
    onLog: (msg) => {
      if (win && !win.isDestroyed()) win.webContents.send('core:log', msg);
    },
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  if (core) await core.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  if (core) await core.stop();
});

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

ipcMain.handle('app:info', async () => {
  const coreVersion = await core.version();
  return {
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    coreVersion,
    corePath: core.corePath,
    coreFound: fs.existsSync(core.corePath),
    userData: app.getPath('userData'),
  };
});

ipcMain.handle('store:get', (e, key) => {
  if (key === 'nodes') return store.read('nodes.json', []);
  if (key === 'settings') return { ...DEFAULT_SETTINGS, ...store.read('settings.json', {}) };
  if (key === 'sources') return store.read('sources.json', []);
  return null;
});

ipcMain.handle('store:set', (e, key, value) => {
  if (key === 'nodes') return store.write('nodes.json', value);
  if (key === 'settings') return store.write('settings.json', value);
  if (key === 'sources') return store.write('sources.json', value);
  return false;
});

ipcMain.handle('import:parse', (e, payload) => {
  const { text, opts } = payload || {};
  const res = parser.parseText(text, opts || {});
  return res;
});

ipcMain.handle('import:fetch', async (e, url) => {
  const text = await fetchSubscription(url);
  const res = parser.parseText(text, { group: new URL(url).hostname, source: url });
  return { nodes: res.nodes, errors: res.errors, format: res.format, bytes: text.length };
});

ipcMain.handle('import:file', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择代理配置文件',
    properties: ['openFile'],
    filters: [
      { name: '代理配置', extensions: ['txt', 'yaml', 'yml', 'json', 'conf', 'list'] },
      { name: '全部文件', extensions: ['*'] },
    ],
  });
  if (r.canceled || !r.filePaths.length) return null;
  const file = r.filePaths[0];
  const text = fs.readFileSync(file, 'utf8');
  const res = parser.parseText(text, { group: path.basename(file), source: file });
  return { file, text, ...res };
});

ipcMain.handle('test:run', async (e, payload) => {
  if (runner) return { error: '已有测试任务在运行' };
  const { nodes, mode, settings } = payload || {};
  if (!nodes || !nodes.length) return { error: '没有可测试的节点' };

  runner = new Runner({
    core,
    settings: settings || {},
    emit: (ev) => {
      if (win && !win.isDestroyed()) win.webContents.send('test:event', ev);
    },
  });

  try {
    const r = await runner.run(nodes, mode || 'full');
    return r;
  } catch (err) {
    return { error: err.message };
  } finally {
    runner = null;
    await core.stop();
  }
});

ipcMain.handle('test:cancel', async () => {
  if (runner) runner.cancel();
  return true;
});

ipcMain.handle('core:restart', async (e, nodes) => {
  await core.start(nodes || []);
  return { ok: true, ports: core.portMap.size };
});

ipcMain.handle('export:save', async (e, payload) => {
  const { format, content, defaultName } = payload || {};
  const filters =
    format === 'json'
      ? [{ name: 'JSON', extensions: ['json'] }]
      : format === 'csv'
        ? [{ name: 'CSV', extensions: ['csv'] }]
        : [{ name: '文本', extensions: ['txt'] }];
  const r = await dialog.showSaveDialog(win, {
    title: '导出结果',
    defaultPath: defaultName || 'iphealth-export',
    filters,
  });
  if (r.canceled || !r.filePath) return { ok: false };
  fs.writeFileSync(r.filePath, content, 'utf8');
  return { ok: true, path: r.filePath };
});

ipcMain.handle('theme:set', (e, theme) => {
  const light = theme === 'light';
  nativeTheme.themeSource = light ? 'light' : 'dark';
  if (win && !win.isDestroyed()) {
    try {
      win.setTitleBarOverlay({
        color: light ? '#f5f7fb' : '#0e1015',
        symbolColor: light ? '#5c6579' : '#9aa3b2',
        height: 44,
      });
    } catch (err) {}
    win.setBackgroundColor(light ? '#f5f7fb' : '#0e1015');
  }
  return true;
});

ipcMain.handle('shell:open', (e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

ipcMain.handle('app:openDataDir', () => {
  shell.openPath(app.getPath('userData'));
});
