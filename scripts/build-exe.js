'use strict';

/**
 * 生成单文件便携版 exe
 * 版本号自动取自 package.json，用法：npm run dist:exe
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;

function findMakensis() {
  const candidates = [];
  if (process.env.MAKENSIS) candidates.push(process.env.MAKENSIS);
  candidates.push(path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'nsis'));

  // electron-builder 缓存里的 nsis（递归找一层）
  const cacheRoot = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'nsis');
  if (fs.existsSync(cacheRoot)) {
    for (const dir of fs.readdirSync(cacheRoot)) {
      const exe = path.join(cacheRoot, dir, 'Bin', 'makensis.exe');
      if (fs.existsSync(exe)) candidates.push(exe);
    }
  }
  candidates.push('C:\\Program Files (x86)\\NSIS\\makensis.exe');
  candidates.push('C:\\Program Files\\NSIS\\makensis.exe');

  for (const c of candidates) {
    if (c && fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  // 交给 PATH
  try {
    execFileSync('makensis', ['/VERSION'], { stdio: 'ignore' });
    return 'makensis';
  } catch (e) {
    return null;
  }
}

const makensis = findMakensis();
if (!makensis) {
  console.error('未找到 makensis（NSIS）。请安装 NSIS，或设置环境变量 MAKENSIS 指向 makensis.exe。');
  process.exit(1);
}

const outFile = path.join(root, 'dist', `IPHealth-${version}-win-x64-portable.exe`);
if (!fs.existsSync(path.join(root, 'dist', 'win-unpacked'))) {
  console.error('缺少 dist/win-unpacked，请先执行 npm run dist 生成应用目录。');
  process.exit(1);
}

console.log(`版本: ${version}`);
console.log(`编译器: ${makensis}`);
console.log(`输出: ${outFile}`);

try {
  execFileSync(makensis, [`/DVERSION=${version}`, 'portable.nsi'], {
    cwd: path.join(root, 'build'),
    stdio: 'inherit',
  });
} catch (e) {
  console.error('编译失败');
  process.exit(1);
}

const size = (fs.statSync(outFile).size / 1048576).toFixed(1);
console.log(`完成: ${path.relative(root, outFile)} (${size} MB)`);
