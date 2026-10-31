'use strict';

/**
 * 来源筛选 / 导出 / 右键菜单 端到端测试
 * 运行：npx electron scripts/test-export-ui.js
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

function mk(id, o) {
  return Object.assign(
    {
      id,
      name: id.toUpperCase(),
      type: 'ss',
      server: `${id}.example.com`,
      port: 443,
      conf: {},
      group: '',
      source: '',
      status: 'ok',
      latency: 100,
      speed: 10,
      health: 90,
      ip: '1.1.1.1',
      country: '中国香港',
      countryCode: 'HK',
      city: '香港',
      isp: 'HKT',
      asn: 'AS1',
      dnsbl: [],
      raw: `ss://${id}`,
    },
    o
  );
}

const SRC_A = 'https://alpha.example.com/sub?token=1';
const SRC_B = 'https://beta.example.com/sub';

const nodes = [
  mk('a', { source: SRC_A, status: 'ok' }),
  mk('b', { source: SRC_A, status: 'ok', latency: 300 }),
  mk('c', { source: SRC_B, status: 'fail', latency: null }),
  mk('d', { source: '', status: 'ok' }),
];

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? '✔' : '✘'} ${name}${cond ? '' : '  → ' + JSON.stringify(detail)}`);
}

let copiedText = null;
let clashPayload = null;

ipcMain.handle('app:info', () => ({
  appVersion: '1.0.3', electron: process.versions.electron, node: process.versions.node,
  platform: 'win32', arch: 'x64', coreVersion: 'test', corePath: 'x', coreFound: true,
  userData: 'x', execPath: 'C:\\tmp\\IPHealth.exe', isPackaged: true,
}));
ipcMain.handle('store:get', (e, k) => {
  if (k === 'nodes') return JSON.parse(JSON.stringify(nodes));
  if (k === 'sources') return [];
  if (k === 'settings') return {};
  return null;
});
ipcMain.handle('store:set', () => true);
ipcMain.handle('theme:set', () => true);
ipcMain.handle('clipboard:write', (e, text) => {
  copiedText = text;
  return true;
});
ipcMain.handle('export:clash', (e, payload) => {
  clashPayload = payload;
  return { ok: true, path: 'C:\\tmp\\out.yaml', count: payload.nodes.length };
});
ipcMain.handle('export:save', () => ({ ok: true, path: 'C:\\tmp\\out.csv' }));

process.on('unhandledRejection', (e) => {
  console.log('✘ 未捕获异常：' + (e && e.message ? e.message : e));
  app.exit(1);
});

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

  /* ---------- 来源分面 ---------- */
  let r = (await run(`(() => {
    const block = document.querySelector('#sourceBlock');
    const items = [...document.querySelectorAll('#sourceList .sb-item')].map(el => ({
      label: el.querySelector('.sb-name').textContent.trim(),
      count: Number(el.querySelector('.sb-num').textContent.trim()),
    }));
    return { hidden: block.style.display === 'none', items };
  })()`));
  check('来源区块可见', !r.hidden, r);
  check('来源分面列出 2 个订阅源 + 手动添加', r.items.length === 3, r.items);
  const byLabel = Object.fromEntries(r.items.map((x) => [x.label, x.count]));
  check('订阅源计数正确', byLabel['alpha.example.com'] === 2 && byLabel['beta.example.com'] === 1, byLabel);
  check('手动添加计数正确', byLabel['手动添加'] === 1, byLabel);

  /* ---------- 点击来源筛选 ---------- */
  await run(`(() => {
    const el = [...document.querySelectorAll('#sourceList .sb-item')]
      .find(x => x.querySelector('.sb-name').textContent.trim() === 'alpha.example.com');
    el.click();
  })()`);
  await new Promise((res) => setTimeout(res, 300));
  r = (await run(`(() => ({
    rows: [...document.querySelectorAll('#tbody tr')].filter(tr => tr.style.display !== 'none').length,
    chips: [...document.querySelectorAll('#activeFilters .af-chip')].map(c => c.textContent.trim()).join('|'),
    active: document.querySelectorAll('#sourceList .sb-item.active').length,
  }))()`));
  check('按来源筛选后只剩该源节点', r.rows === 2, r);
  check('来源条件显示为筛选 chip', /来源/.test(r.chips), r.chips);
  check('来源项高亮', r.active === 1, r.active);

  /* ---------- 导出弹窗 ---------- */
  await run(`document.querySelector('#btnClearFilters').click()`);
  await new Promise((res) => setTimeout(res, 200));
  await run(`document.querySelector('#btnExport').click()`);
  await new Promise((res) => setTimeout(res, 250));
  r = (await run(`(() => {
    const btns = [...document.querySelectorAll('.modal-mask.open [data-fmt]')].map(b => b.dataset.fmt);
    return { btns };
  })()`));
  check('导出弹窗包含 5 种方式', r.btns.length === 5, r.btns);
  check('导出弹窗包含 Clash 配置与复制链接', r.btns.includes('clash') && r.btns.includes('copy'), r.btns);

  /* ---------- 导出 Clash ---------- */
  await run(`document.querySelector('.modal-mask.open [data-fmt="clash"]').click()`);
  await new Promise((res) => setTimeout(res, 350));
  check('导出 Clash 只带可用节点', clashPayload && clashPayload.nodes.length === 3, clashPayload && clashPayload.nodes.length);
  check('导出 Clash 带上了订阅来源信息以外的必要字段', !!clashPayload && clashPayload.nodes.every((n) => n.type && n.server && n.port), clashPayload);

  /* ---------- 复制链接 ---------- */
  await run(`document.querySelector('#btnExport').click()`);
  await new Promise((res) => setTimeout(res, 200));
  await run(`document.querySelector('.modal-mask.open [data-fmt="copy"]').click()`);
  await new Promise((res) => setTimeout(res, 250));
  check('复制链接包含全部节点', !!copiedText && copiedText.split(String.fromCharCode(10)).length === 4, copiedText);

  /* ---------- 右键菜单 ---------- */
  r = (await run(`(() => {
    const tr = document.querySelector('#tbody tr[data-id]');
    const rect = tr.getBoundingClientRect();
    tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: rect.left + 40, clientY: rect.top + 10 }));
    const menu = document.querySelector('.ctx-menu');
    return { items: menu ? [...menu.querySelectorAll('button')].map(b => b.textContent.trim()) : [] };
  })()`));
  check('右键菜单出现', r.items.length >= 6, r.items);
  check('右键菜单含复制链接 / 重命名 / 删除', r.items.includes('复制节点链接') && r.items.includes('重命名…') && r.items.includes('删除节点'), r.items);

  /* ---------- 无脚本错误 ---------- */
  check('无脚本错误', errs.length === 0, errs);

  const pass = results.filter((x) => x.ok).length;
  console.log(`\n通过 ${pass}/${results.length}`);
  app.exit(pass === results.length ? 0 : 1);
});
