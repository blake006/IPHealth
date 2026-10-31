'use strict';

/** 订阅拉取（多 UA 重试、跟随重定向、大小限制） */

const http = require('http');
const https = require('https');

const SUB_UA = [
  'clash-verge/v2.4.2',
  'ClashforWindows/0.20.39',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
];

const MAX_BYTES = 12 * 1024 * 1024;
const TIMEOUT = 15000;

function fetchUrl(url, uaIndex = 0, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('重定向次数过多'));
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return reject(new Error('订阅链接格式无效'));
    }
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      {
        host: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        timeout: TIMEOUT,
        headers: {
          'User-Agent': SUB_UA[uaIndex] || SUB_UA[0],
          Accept: '*/*',
          'Accept-Encoding': 'identity',
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          return resolve(fetchUrl(next, uaIndex, redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        let size = 0;
        const chunks = [];
        res.on('data', (c) => {
          size += c.length;
          if (size > MAX_BYTES) {
            req.destroy();
            reject(new Error('订阅内容超过 12MB'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve(decodeBuffer(Buffer.concat(chunks))));
      }
    );
    req.on('timeout', () => req.destroy(new Error('订阅拉取超时')));
    req.on('error', (e) => reject(e));
    req.end();
  });
}

/**
 * 按 UTF-8 解码；出现替换字符时回退到 GBK
 * （国内不少订阅/配置文件是 GBK/ANSI 编码）
 */
function decodeBuffer(buf) {
  if (!buf) return '';
  let text = buf.toString('utf8');
  if (text.includes('\uFFFD')) {
    try {
      const gbk = new TextDecoder('gbk', { fatal: false }).decode(buf);
      // 只有 GBK 结果明显更"干净"时才采用
      const bad = (t) => (t.match(/\uFFFD/g) || []).length;
      if (gbk && bad(gbk) < bad(text)) text = gbk;
    } catch (e) {
      /* 环境不支持 gbk 时忽略 */
    }
  }
  return text;
}

/** 依次尝试多个 User-Agent，兼容 Clash / V2Ray / 通用订阅 */
async function fetchSubscription(url) {
  let lastErr = null;
  for (let i = 0; i < SUB_UA.length; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const text = await fetchUrl(url, i);
      if (text && text.trim()) return text;
      lastErr = new Error('订阅内容为空');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('订阅拉取失败');
}

module.exports = { fetchSubscription, fetchUrl, decodeBuffer, SUB_UA };
