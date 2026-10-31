'use strict';

/**
 * 下载 rcedit 到 vendor/rcedit-x64.exe
 * 用于给打包后的 exe 写入图标与版本信息（任务管理器显示名/图标）
 * 用法: npm run fetch-rcedit
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const VERSION = process.env.RCEDIT_VERSION || 'v2.0.0';
const FILE = 'rcedit-x64.exe';
const MIRRORS = [
  `https://ghfast.top/https://github.com/electron/rcedit/releases/download/${VERSION}/${FILE}`,
  `https://gh-proxy.com/https://github.com/electron/rcedit/releases/download/${VERSION}/${FILE}`,
  `https://github.com/electron/rcedit/releases/download/${VERSION}/${FILE}`,
];

const outDir = path.join(__dirname, '..', 'vendor');
const target = path.join(outDir, FILE);

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('重定向过多'));
    https
      .get(url, { headers: { 'User-Agent': 'IPHealth-build' }, timeout: 30000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(download(new URL(res.headers.location, url).toString(), dest, redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        const total = Number(res.headers['content-length'] || 0);
        let got = 0;
        const file = fs.createWriteStream(dest);
        res.on('data', (c) => {
          got += c.length;
          if (total) process.stdout.write(`\r下载中 ${((got / total) * 100).toFixed(1)}%`);
        });
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            process.stdout.write('\n');
            resolve(dest);
          });
        });
      })
      .on('timeout', function onTimeout() {
        this.destroy(new Error('超时'));
      })
      .on('error', reject);
  });
}

(async () => {
  if (fs.existsSync(target) && !process.argv.includes('--force')) {
    console.log('已存在 vendor/rcedit-x64.exe，跳过（加 --force 强制重新下载）');
    return;
  }
  fs.mkdirSync(outDir, { recursive: true });

  // 先看 electron-builder 缓存里有没有现成的
  const cache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
  if (fs.existsSync(cache)) {
    for (const dir of fs.readdirSync(cache)) {
      const p = path.join(cache, dir, 'rcedit-x64.exe');
      if (fs.existsSync(p)) {
        fs.copyFileSync(p, target);
        console.log('已从 electron-builder 缓存复制:', target);
        return;
      }
    }
  }

  for (const url of MIRRORS) {
    try {
      console.log('尝试下载:', url);
      // eslint-disable-next-line no-await-in-loop
      await download(url, target);
      console.log('完成:', target);
      return;
    } catch (e) {
      console.log('失败:', e.message);
    }
  }
  console.error('rcedit 下载失败，可手动下载后放到 vendor/rcedit-x64.exe');
  process.exit(1);
})();
