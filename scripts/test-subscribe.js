'use strict';

/**
 * 订阅拉取单测（不依赖外网）
 * - 代理地址规范化
 * - Node 兜底：直连 / 重定向 / 非 200 / 大小上限
 * - fetchSubscription 在无 Electron net 环境下的回退与错误文案
 */

const http = require('http');
const assert = require('assert');
const sub = require('../electron/lib/subscribe');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    pass += 1;
    console.log('✔ ' + name);
  } catch (e) {
    fail += 1;
    console.log('✘ ' + name + '\n   ' + (e && e.message));
  }
}

async function ta(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log('✔ ' + name);
  } catch (e) {
    fail += 1;
    console.log('✘ ' + name + '\n   ' + (e && e.message));
  }
}

const BODY = 'ss://YWVzLTI1Ni1nY206cHc@1.1.1.1:8388#A';

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(BODY);
      } else if (req.url === '/redirect') {
        res.writeHead(302, { Location: '/ok' });
        res.end();
      } else if (req.url === '/empty') {
        res.writeHead(200);
        res.end('');
      } else if (req.url === '/big') {
        res.writeHead(200);
        const chunk = Buffer.alloc(1024 * 1024, 0x61);
        let sent = 0;
        const push = () => {
          while (sent < 13 && res.write(chunk)) sent += 1;
          if (sent >= 13) res.end();
          else res.once('drain', push);
        };
        push();
      } else {
        res.writeHead(404);
        res.end('nope');
      }
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  t('normalizeProxy 支持端口/协议/空值', () => {
    assert.strictEqual(sub.normalizeProxy(''), '');
    assert.strictEqual(sub.normalizeProxy('7890'), '127.0.0.1:7890');
    assert.strictEqual(sub.normalizeProxy('http://127.0.0.1:7890'), '127.0.0.1:7890');
    assert.strictEqual(sub.normalizeProxy(' socks5://10.0.0.1:1080/ '), '10.0.0.1:1080');
  });

  t('decodeBuffer 兼容 GBK', () => {
    const gbk = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]); // "你好" 的 GBK
    assert.strictEqual(sub.decodeBuffer(gbk), '你好');
    assert.strictEqual(sub.decodeBuffer(Buffer.from('abc', 'utf8')), 'abc');
  });

  const srv = await startServer();
  const base = `http://127.0.0.1:${srv.address().port}`;

  await ta('fetchUrl 直连取到内容', async () => {
    const text = await sub.fetchUrl(base + '/ok');
    assert.ok(text.includes('ss://'));
  });

  await ta('fetchUrl 跟随 302 重定向', async () => {
    const text = await sub.fetchUrl(base + '/redirect');
    assert.ok(text.includes('ss://'));
  });

  await ta('fetchUrl 非 200 报错', async () => {
    await assert.rejects(() => sub.fetchUrl(base + '/404'), /HTTP 404/);
  });

  await ta('fetchUrl 超出 12MB 上限报错', async () => {
    await assert.rejects(() => sub.fetchUrl(base + '/big'), /12MB/);
  });

  await ta('无 net 模块时 fetchSubscription 回退到 Node', async () => {
    const text = await sub.fetchSubscription(base + '/ok', { timeout: 8000 });
    assert.ok(text.includes('ss://'));
  });

  await ta('全失败时给出诊断与「已尝试」说明', async () => {
    let err = null;
    try {
      await sub.fetchSubscription(`http://127.0.0.1:${srv.address().port}/404`, { timeout: 8000 });
    } catch (e) {
      err = e;
    }
    assert.ok(err, '应当抛错');
    assert.ok(/订阅拉取失败|订阅拉取超时/.test(err.message), err.message);
    assert.ok(/已尝试代理|未配置拉取代理/.test(err.message), err.message);
  });

  await ta('配置代理时错误信息里带上代理地址', async () => {
    let err = null;
    try {
      // 指向一个必然失败的代理端口，直连也失败（404）
      await sub.fetchSubscription(`http://127.0.0.1:${srv.address().port}/404`, {
        timeout: 8000,
        proxy: '127.0.0.1:1',
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err && /127\.0\.0\.1:1/.test(err.message), err && err.message);
  });

  srv.close();
  console.log(`\n通过 ${pass} / ${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
