'use strict';

/**
 * electron-builder afterPack 钩子
 * 给 app 主 exe 写入自定义图标与版本信息（否则任务管理器里会显示成 "Electron" + 原子图标）
 *
 * 这里不用 electron-builder 自带的 rcedit（它依赖 app-builder 下载 winCodeSign，
 * 在部分环境会卡住），改为直接调用 rcedit 可执行文件。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function findRcedit(root) {
  const cands = [];
  if (process.env.RCEDIT) cands.push(process.env.RCEDIT);
  cands.push(path.join(root, 'vendor', 'rcedit-x64.exe'));

  // electron-builder 的 winCodeSign 缓存里自带一份
  const cache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
  if (fs.existsSync(cache)) {
    for (const dir of fs.readdirSync(cache)) {
      const p = path.join(cache, dir, 'rcedit-x64.exe');
      if (fs.existsSync(p)) cands.push(p);
    }
  }
  cands.push(path.join(root, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe'));
  return cands.find((p) => p && fs.existsSync(p)) || null;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const root = context.packager.projectDir;
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  if (!fs.existsSync(exePath)) return;

  const rcedit = findRcedit(root);
  if (!rcedit) {
    console.warn('[after-pack] 未找到 rcedit，跳过图标与版本信息写入（可执行 npm run fetch-rcedit）');
    return;
  }

  const version = context.packager.appInfo.version;
  const icon = path.join(root, 'build', 'icon.ico');
  const args = [exePath];
  if (fs.existsSync(icon)) args.push('--set-icon', icon);
  args.push('--set-file-version', version, '--set-product-version', version);

  const strings = {
    FileDescription: 'IPHealth',
    ProductName: 'IPHealth',
    CompanyName: 'IPHealth',
    LegalCopyright: 'Copyright © 2026 IPHealth',
    InternalName: 'IPHealth',
    OriginalFilename: 'IPHealth.exe',
  };
  for (const [k, v] of Object.entries(strings)) {
    args.push('--set-version-string', k, v);
  }

  try {
    execFileSync(rcedit, args, { stdio: 'inherit' });
    console.log(`[after-pack] 已写入图标与版本信息: ${exeName} v${version}`);
  } catch (e) {
    console.warn('[after-pack] 写入失败（不影响打包）:', e.message);
  }
};
