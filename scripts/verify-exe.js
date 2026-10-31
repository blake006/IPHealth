'use strict';

/**
 * 打包产物自检：确认 exe 里写进了 IPHealth 的图标与版本信息。
 *
 * 任务管理器里显示成 "Electron" 的根因就是这些资源没写进去，
 * 所以每次打包后跑一遍，比肉眼看任务管理器可靠。
 *
 * 用法：node scripts/verify-exe.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const targets = [
  { label: '应用主程序', file: path.join(root, 'dist', 'win-unpacked', 'IPHealth.exe') },
  { label: '便携版启动器', file: path.join(root, 'dist', `IPHealth-${pkg.version}-win-x64-portable.exe`) },
];

function versionInfo(file) {
  const script = `$v=(Get-Item -LiteralPath '${file.replace(/'/g, "''")}').VersionInfo;` +
    `@{FileDescription=$v.FileDescription;ProductName=$v.ProductName;FileVersion=$v.FileVersion;` +
    `ProductVersion=$v.ProductVersion;OriginalFilename=$v.OriginalFilename} | ConvertTo-Json -Compress`;
  const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
  });
  return JSON.parse(out.trim());
}

let fail = 0;

for (const t of targets) {
  if (!fs.existsSync(t.file)) {
    console.log(`✘ ${t.label}: 找不到 ${path.relative(root, t.file)}（先执行 npm run dist / dist:exe）`);
    fail += 1;
    continue;
  }
  let info;
  try {
    info = versionInfo(t.file);
  } catch (e) {
    console.log(`✘ ${t.label}: 读取版本资源失败 ${e.message}`);
    fail += 1;
    continue;
  }
  const problems = [];
  if (info.FileDescription !== 'IPHealth') problems.push(`FileDescription=${info.FileDescription || '(空)'}`);
  if (info.ProductName !== 'IPHealth') problems.push(`ProductName=${info.ProductName || '(空)'}`);
  if (info.OriginalFilename && info.OriginalFilename !== 'IPHealth.exe') problems.push(`OriginalFilename=${info.OriginalFilename}`);
  if (!String(info.ProductVersion || '').includes(pkg.version)) problems.push(`ProductVersion=${info.ProductVersion}（期望 ${pkg.version}）`);

  if (problems.length) {
    console.log(`✘ ${t.label}: ${problems.join('，')}`);
    fail += 1;
  } else {
    console.log(`✔ ${t.label}: ${info.FileDescription} v${info.ProductVersion} · ${path.basename(t.file)}`);
  }
}

if (fail) {
  console.log(`\n❌ 有 ${fail} 项不通过：任务管理器里可能仍显示 Electron`);
  process.exit(1);
}
console.log('\n✅ 版本资源与产品名检查通过（任务管理器显示 IPHealth）');
