'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

const { Store, DEFAULT_SETTINGS } = require('./lib/store');
const parser = require('./lib/parser');
const { CoreManager } = require('./lib/core');
const { Runner } = require('./lib/runner');
const clash = require('./lib/clash');

const isDev = process.argv.includes('--dev');

// 进程/窗口层面统一使用 IPHealth 这个名称
app.setName('IPHealth');

// 只允许运行一个实例，避免两个窗口同时读写同一份节点数据
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) {
  app.quit();
}

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

const { fetchSubscription, decodeBuffer } = require('./lib/subscribe');

/* ------------------------------------------------------------------ */
/* 窗口                                                                */
/* ------------------------------------------------------------------ */

/** 窗口/任务栏图标（打包后在 resources/icon.ico，开发时用 build/icon.ico） */
function resolveIconPath() {
  const cands = [];
  if (app.isPackaged) cands.push(path.join(process.resourcesPath, 'icon.ico'));
  cands.push(path.join(__dirname, '..', 'build', 'icon.ico'));
  return cands.find((p) => fs.existsSync(p));
}

/** 读取上次窗口位置/大小，并做越界校正（换显示器后不会跑到屏幕外） */
function loadWindowState() {
  try {
    const saved = store.read('settings.json', {});
    const b = saved.windowBounds;
    if (!b || typeof b.width !== 'number' || typeof b.height !== 'number') return {};
    const { screen } = require('electron');
    const area = screen.getPrimaryDisplay().workArea;
    const out = { width: Math.max(1080, Math.min(b.width, area.width)), height: Math.max(660, Math.min(b.height, area.height)) };
    if (typeof b.x === 'number' && typeof b.y === 'number') {
      const visible = b.x < area.x + area.width - 120 && b.x + 200 > area.x && b.y < area.y + area.height - 80 && b.y + 80 > area.y;
      if (visible) {
        out.x = b.x;
        out.y = b.y;
      }
    }
    return { bounds: out, maximized: !!saved.maximized };
  } catch (e) {
    return {};
  }
}

function saveWindowState() {
  try {
    if (!win || win.isDestroyed()) return;
    const saved = store.read('settings.json', {});
    saved.windowBounds = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
    saved.maximized = win.isMaximized();
    store.write('settings.json', saved);
  } catch (e) {}
}

function createWindow() {
  const state = loadWindowState();
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 660,
    ...(state.bounds || {}),
    show: false,
    icon: resolveIconPath(),
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
      sandbox: true,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (state.maximized) win.maximize();
    win.show();
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  });

  win.on('close', saveWindowState);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* ------------------------------------------------------------------ */
/* 初始化                                                              */
/* ------------------------------------------------------------------ */

app.on('second-instance', () => {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.focus();
    // 告诉界面「你点的那份没起来，已经在跑的是这一份」，避免误以为新版本没生效
    win.webContents.send('app:second-instance', {
      version: app.getVersion(),
      execPath: process.execPath,
    });
  }
});

app.whenReady().then(async () => {
  if (!isPrimaryInstance) return;
  // 独立的 AppUserModelID，避免任务栏把本应用与其它 Electron 应用合并
  if (process.platform === 'win32') app.setAppUserModelId('com.iphealth.desktop');
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
  if (core) {
    const cfg = core.configPath;
    await core.stop();
    // 配置文件里有节点密码，退出时清掉
    try {
      if (cfg && fs.existsSync(cfg)) fs.rmSync(cfg, { force: true });
    } catch (e) {}
  }
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
    execPath: process.execPath,
    isPackaged: app.isPackaged,
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
  const settings = store.read('settings.json', {});
  const text = await fetchSubscription(url, { proxy: settings.subProxy || '' });
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
  const text = decodeBuffer(fs.readFileSync(file));
  const res = parser.parseText(text, { group: path.basename(file), source: file });
  return { file, nodes: res.nodes, errors: res.errors, format: res.format };
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

/** 导出为 Clash / mihomo 配置（YAML），只做格式转换与落盘 */
ipcMain.handle('export:clash', async (e, payload) => {
  const { nodes, defaultName, opts } = payload || {};
  let built;
  try {
    built = clash.buildClashYaml(nodes || [], opts || {});
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const r = await dialog.showSaveDialog(win, {
    title: '导出 Clash 配置',
    defaultPath: defaultName || 'iphealth-clash',
    filters: [{ name: 'Clash 配置', extensions: ['yaml', 'yml'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(r.filePath, built.text, 'utf8');
  } catch (err) {
    return { ok: false, error: err.message };
  }
  return { ok: true, path: r.filePath, count: built.count };
});

ipcMain.handle('clipboard:write', (e, text) => {
  clipboard.writeText(String(text == null ? '' : text));
  return true;
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
