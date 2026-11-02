'use strict';

/** 订阅拉取（多 UA 重试、跟随重定向、大小限制） */

const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');

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
          const err = new Error('HTTP ' + res.statusCode);
          err.status = res.statusCode;
          return reject(err);
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

/** 已知的 DNS 污染 / 黑洞地址（GFW 常用注入 IP） */
const POISON_IPS = new Set([
  // GFW 常见的 DNS 注入 / 黑洞地址
  '93.46.8.90', '46.82.174.69', '59.24.3.174', '159.24.3.173', '159.24.3.174',
  '8.7.198.45', '37.61.54.158', '78.16.49.15', '4.36.66.178', '203.98.7.65',
  '207.123.56.89', '243.185.187.39', '10.10.34.34', '10.10.34.35', '10.10.34.36',
  '127.0.0.1', '0.0.0.0',
]);

/** 代理地址规范化：支持 "7890" / "http://127.0.0.1:7890" / "127.0.0.1:7890" */
function normalizeProxy(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  // 协议名里可能带数字（socks5://、h2://），不能只匹配字母
  s = s.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '').replace(/\/+$/, '');
  if (/^\d+$/.test(s)) return `127.0.0.1:${s}`;
  return s;
}

/** TCP 端口探测：用来判断「填的代理端口到底有没有在监听」 */
function probeTcp(host, port, timeout = 900) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeout);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
  });
}

/** 常见的本地代理端口（Clash Verge 7897 / CFW·mihomo 7890 / v2rayN 10809 …） */
const COMMON_PROXY_PORTS = [7890, 7897, 7891, 10808, 10809, 1080, 2080];

/** 扫一遍本机常见代理端口，返回第一个在监听的端口号（没有则 0） */
async function detectLocalProxy(ports = COMMON_PROXY_PORTS) {
  for (const port of ports) {
    // eslint-disable-next-line no-await-in-loop
    if (await probeTcp('127.0.0.1', port, 350)) return port;
  }
  return 0;
}

/** 拆分 "127.0.0.1:7890" */
function parseProxy(proxy) {
  const m = /^\[?([^\]]+?)\]?:([0-9]+)$/.exec(String(proxy || ''));
  return m ? { host: m[1], port: Number(m[2]) } : null;
}

/**
 * 用 Electron 的 net 模块拉取（走 Chromium 网络栈）
 * 好处：自动使用系统代理、支持 HTTP/2、TLS 指纹与浏览器一致
 */
async function fetchWithNet(url, timeout = 20000, proxy = '') {
  let subSession = null;
  if (proxy) {
    try {
      const { session } = require('electron');
      subSession = session.fromPartition('iphealth-subfetch');
      await subSession.setProxy({
        mode: 'fixed_servers',
        proxyRules: `http=${proxy};https=${proxy}`,
        proxyBypassRules: '<local>',
      });
    } catch (e) {
      subSession = null;
    }
  }
  return new Promise((resolve, reject) => {
    let net;
    try {
      net = require('electron').net;
    } catch (e) {
      return reject(new Error('NET_UNAVAILABLE'));
    }
    if (!net || typeof net.request !== 'function') return reject(new Error('NET_UNAVAILABLE'));

    let settled = false;
    let timer = null;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(val);
    };

    let request;
    try {
      request = net.request({ url, method: 'GET', redirect: 'follow', ...(subSession ? { session: subSession } : {}) });
    } catch (e) {
      return reject(e);
    }
    request.setHeader('User-Agent', SUB_UA[0]);
    request.setHeader('Accept', '*/*');

    timer = setTimeout(() => {
      try {
        request.abort();
      } catch (e) {}
      finish(reject, new Error(`订阅拉取超时（${Math.round(timeout / 1000)}s）`));
    }, timeout);

    request.on('response', (res) => {
      if (res.statusCode >= 400) {
        const err = new Error('HTTP ' + res.statusCode);
        err.status = res.statusCode;
        finish(reject, err);
        try {
          res.resume();
        } catch (e) {}
        return;
      }
      let size = 0;
      const chunks = [];
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) {
          try {
            request.abort();
          } catch (e) {}
          finish(reject, new Error('订阅内容超过 12MB'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => finish(resolve, decodeBuffer(Buffer.concat(chunks))));
      res.on('error', (e) => finish(reject, e));
    });

    request.on('error', (e) => finish(reject, e));
    request.end();
  });
}

/** 失败时给出可操作的诊断信息 */
async function diagnose(url) {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch (e) {
    return '订阅链接格式无效。';
  }
  let ips = [];
  try {
    ips = await dns.promises.resolve4(host);
  } catch (e) {
    const code = e.code || '';
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      return `域名 ${host} 解析不到记录，请检查链接或 DNS。`;
    }
    return `域名 ${host} 解析失败（${code || e.message}）。`;
  }
  if (!ips.length) return `域名 ${host} 解析不到 A 记录。`;
  if (ips.some((ip) => POISON_IPS.has(ip))) {
    return `域名 ${host} 被解析到 ${ips[0]}（典型的 DNS 污染地址）。请先开启系统代理/VPN，或在「设置 → 订阅拉取代理」里填本机代理端口（如 127.0.0.1:7890）后重试。`;
  }
  return `域名 ${host} 解析到 ${ips[0]}，但连接失败（可能被墙或服务端不可达）。`;
}

/**
 * 拉取订阅。
 *
 * 被墙的订阅站只有「走代理」能通，所以有代理时**代理与直连并发竞速**：
 * 谁先拿到内容就用谁，避免先干等 25s 代理超时再等直连超时（那种体验就是「卡住」）。
 *   0) 填了代理 → 先探测端口，没在监听就直接说清楚（这是最常见的「填了代理也没用」）
 *   1) 代理（若配置）+ 直连 并发，先成功者胜
 *   2) 都失败 → Node https 多 UA 兜底（老订阅站 / 证书链异常）
 *   3) 按失败原因给结论：4xx=链接失效、5xx=服务端异常、超时、连接失败（附 DNS 诊断）
 */
async function fetchSubscription(url, opts = {}) {
  const proxy = normalizeProxy(opts.proxy);
  const timeout = Math.max(8000, Number(opts.timeout) || 25000);
  const seen = []; // { label, message, status }
  const tried = proxy ? `已尝试代理 ${proxy} 与直连` : '未配置拉取代理，仅尝试直连';

  if (proxy) {
    const addr = parseProxy(proxy);
    if (!addr) throw new Error(`订阅拉取代理格式不正确：${proxy}。应形如 127.0.0.1:7890`);
    const alive = await probeTcp(addr.host, addr.port);
    if (!alive) {
      throw new Error(
        `订阅拉取代理 ${proxy} 没有在监听：代理客户端没启动，或端口填错了` +
          `（Clash Verge 默认 7897，Clash for Windows / mihomo 默认 7890）。` +
          '请先启动代理再重试，或清空「设置 → 订阅拉取代理」改走系统代理。'
      );
    }
  }

  const record = (label, e) => {
    seen.push({ label, message: (e && e.message) || '未知错误', status: (e && e.status) || 0 });
  };

  const attempt = (label, proxyAddr, ms) =>
    new Promise((resolve) => {
      fetchWithNet(url, ms, proxyAddr)
        .then((text) => {
          if (text && text.trim()) return resolve(text);
          record(label, new Error('内容为空'));
          resolve(null);
        })
        .catch((e) => {
          // 非 Electron 环境（单测 / CLI）没有 net 模块，静默跳过
          if (!e || e.message !== 'NET_UNAVAILABLE') record(label, e);
          resolve(null);
        });
    });

  const tasks = [];
  if (proxy) tasks.push(attempt(`代理 ${proxy}`, proxy, Math.max(timeout, 30000)));
  tasks.push(attempt('直连', '', timeout));

  // 竞速：第一个成功即返回，其余请求留在后台自然结束
  const winner = await new Promise((resolve) => {
    let pending = tasks.length;
    tasks.forEach((p) =>
      p.then((text) => {
        if (text) return resolve(text);
        pending -= 1;
        if (pending === 0) resolve(null);
      })
    );
  });
  if (winner) return winner;

  // Node https 兜底：超时说明网络根本不通，没必要把 3 个 UA 都跑一遍
  for (let i = 0; i < SUB_UA.length; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const text = await fetchUrl(url, i);
      if (text && text.trim()) return text;
      record('直连（Node）', new Error('内容为空'));
    } catch (e) {
      record('直连（Node）', e);
      if (/超时/.test(e.message)) break;
    }
  }

  // 4xx：链接本身的问题，跟网络无关，别让用户去折腾代理
  const clientErr = seen.find((x) => x.status >= 400 && x.status < 500);
  if (clientErr) {
    throw new Error(
      `订阅链接无效：服务端返回 HTTP ${clientErr.status}。` +
        '链接可能已过期、被重置，或更换设备后需要重新复制，请到服务商后台重新获取订阅链接。' +
        `（${tried}）`
    );
  }
  const serverErr = seen.find((x) => x.status >= 500);
  if (serverErr) {
    throw new Error(`订阅服务端异常：HTTP ${serverErr.status}，请稍后重试。（${tried}）`);
  }

  const detail = await diagnose(url);
  const timedOut = seen.some((x) => /超时/.test(x.message));
  const head = timedOut ? '订阅拉取超时' : '订阅拉取失败';
  throw new Error(`${head}。${detail}（${tried}${await proxyHint(proxy, opts.proxyCandidates)}）`);
}

/**
 * 直连失败且没配代理时，扫一下本机常见端口：
 * 有代理在跑就告诉用户填哪个端口，没有就提醒先启动客户端——
 * 比「可能被墙」这种只能干瞪眼的提示有用。
 */
async function proxyHint(proxy, candidates) {
  if (proxy) return '';
  const port = await detectLocalProxy(candidates);
  if (port) return `；检测到本机 127.0.0.1:${port} 有代理在监听，可在「设置 → 订阅拉取代理」填该端口后重试`;
  return '；本机未检测到常见代理端口（7890 / 7897 / 10809），如需经代理拉取请先启动代理客户端';
}

module.exports = { detectLocalProxy, proxyHint, COMMON_PROXY_PORTS, fetchSubscription, fetchUrl, fetchWithNet, diagnose, normalizeProxy, decodeBuffer, probeTcp, parseProxy, SUB_UA, POISON_IPS };
