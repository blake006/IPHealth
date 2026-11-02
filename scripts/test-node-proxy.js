'use strict';

/**
 * 「借道可用节点拉订阅」链路验证
 *
 * 用一个假的 SOCKS5 服务冒充代理节点，让 mihomo 起一个 mixed 端口，
 * 再像主进程那样用 127.0.0.1:<节点端口> 作为代理去拉订阅。
 * 验证的是：节点端口确实能当订阅拉取的出口用。
 *
 * 运行：node scripts/test-node-proxy.js
 */

const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { CoreManager } = require('../electron/lib/core');
const { fetchSubscription } = require('../electron/lib/subscribe');

const BODY = 'c3M6Ly9ZV1Z6TFRJMU5pMW5ZMjA2Y0hjQDFKUTEuMS4xLjE6ODM4OCNBPQ=='; // 任意内容，只要能取回即可

let pass = 0;
let fail = 0;
function check(ok, label, extra) {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? '✔' : '✘'} ${label}${extra ? '  ' + extra : ''}`);
}

/* ---------- 订阅服务（HTTP） ---------- */
function startSubServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(BODY);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

/* ---------- 假 SOCKS5 代理 ---------- */
function startSocks5(targetHost, targetPort) {
  return new Promise((resolve) => {
    const srv = net.createServer((sock) => {
      let stage = 0;
      let buf = Buffer.alloc(0);
      sock.on('error', () => {});
      sock.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        if (stage === 0) {
          if (buf.length < 2) return;
          const n = buf[1];
          if (buf.length < 2 + n) return;
          buf = buf.subarray(2 + n);
          sock.write(Buffer.from([0x05, 0x00])); // 无需认证
          stage = 1;
          return;
        }
        if (stage === 1) {
          if (buf.length < 4) return;
          const atyp = buf[3];
          let need = 4;
          if (atyp === 1) need = 4 + 4 + 2;
          else if (atyp === 3) need = 4 + 1 + buf[4] + 2;
          else if (atyp === 4) need = 4 + 16 + 2;
          if (buf.length < need) return;
          buf = buf.subarray(need);
          stage = 2;
          const upstream = net.connect(targetPort, targetHost, () => {
            sock.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
            if (buf.length) upstream.write(buf);
            sock.pipe(upstream);
            upstream.pipe(sock);
          });
          upstream.on('error', () => sock.destroy());
        }
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  const subSrv = await startSubServer();
  const subPort = subSrv.address().port;
  const socks = await startSocks5('127.0.0.1', subPort);
  const socksPort = socks.address().port;

  const coreExe = path.join(__dirname, '..', 'vendor', 'mihomo.exe');
  if (!fs.existsSync(coreExe)) {
    console.log('… 跳过：未找到 vendor/mihomo.exe');
    process.exit(0);
  }

  const tmp = path.join(os.tmpdir(), 'iph-nodeproxy');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });

  const core = new CoreManager({ corePath: coreExe, dataDir: tmp });
  const node = {
    id: 'test-node',
    type: 'socks5',
    server: '127.0.0.1',
    port: socksPort,
    conf: { udp: true },
  };

  try {
    await core.start([node]);
    const port = core.portOf('test-node');
    check(!!port, `内核为节点分配了本地端口 ${port}`);

    const text = await fetchSubscription(`http://127.0.0.1:${subPort}/sub`, {
      proxy: `127.0.0.1:${port}`,
      timeout: 15000,
    });
    check(text === BODY, '经节点端口成功拉取订阅内容', text ? text.slice(0, 24) : '(空)');
  } catch (e) {
    check(false, '经节点端口拉取订阅', e && e.message);
  } finally {
    await core.stop();
    subSrv.close();
    socks.close();
  }

  console.log(`\n通过 ${pass} / ${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
