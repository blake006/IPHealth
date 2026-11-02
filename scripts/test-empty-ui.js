'use strict';

/**
 * 首次使用（空列表）引导的界面检查
 * 运行：npx electron scripts/test-empty-ui.js
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? '✔' : '✘'} ${name}${cond ? '' : '  → ' + JSON.stringify(detail)}`);
}

ipcMain.handle('app:info', () => ({
  appVersion: '1.0.9', electron: process.versions.electron, node: process.versions.node,
  platform: 'win32', arch: 'x64', coreVersion: 'test', corePath: 'x', coreFound: true,
  userData: 'x', execPath: 'C:\\tmp\\IPHealth.exe', isPackaged: true,
}));
ipcMain.handle('store:get', (e, k) => {
  if (k === 'nodes') return [];
  if (k === 'sources') return [];
  if (k === 'settings') return {};
  return null;
});
ipcMain.handle('store:set', () => true);
ipcMain.handle('theme:set', () => true);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  const errs = [];
  win.webContents.on('console-message', (e, l, m) => {
    if (l >= 2) errs.push(m);
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 900));
  const run = (code) => win.webContents.executeJavaScript(code);

  const r = await run(`(() => {
    const empty = document.querySelector('#emptyState');
    const tips = document.querySelector('.empty-tips');
    const box = empty ? empty.getBoundingClientRect() : null;
    const t = tips ? tips.getBoundingClientRect() : null;
    return {
      emptyShown: !!empty && getComputedStyle(empty).display !== 'none',
      tipsText: tips ? tips.textContent.replace(/\\s+/g, ' ').trim() : '',
      fitsWidth: !!(box && t && t.width <= box.width + 1),
      overflowX: empty ? empty.scrollWidth - empty.clientWidth : -1,
    };
  })()`);

  check('空列表时显示空态', r.emptyShown, r);
  check('空态里有首次使用指引', /第一次用/.test(r.tipsText) && /自动借用/.test(r.tipsText), r.tipsText);
  check('指引不超出空态宽度', r.fitsWidth, r);
  check('空态没有横向溢出', r.overflowX <= 0, r.overflowX);
  check('无脚本错误', errs.length === 0, errs);

  const pass = results.filter((x) => x.ok).length;
  console.log(`\n通过 ${pass}/${results.length}`);
  app.exit(pass === results.length ? 0 : 1);
});

process.on('unhandledRejection', (e) => {
  console.log('✘ 未捕获异常：' + (e && e.message ? e.message : e));
  app.exit(1);
});
