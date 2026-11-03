'use strict';

/** IP 类型判定 / 评分 单测 */

const assert = require('assert');
const geo = require('../electron/lib/geo');

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

const cls = (o) => geo.classifyIp(o).cls;

t('机房 + 代理 → 代理/VPN', () => {
  assert.strictEqual(cls({ ipApi: { proxy: true, hosting: true, isp: 'Google LLC', asn: 'AS15169' } }), 'proxy');
});

t('ip-api 明确标记机房 → 机房', () => {
  assert.strictEqual(cls({ ipApi: { hosting: true, isp: 'Some Hosting Ltd', asn: 'AS99999' } }), 'hosting');
});

t('云厂商 ASN 命中 → 机房', () => {
  assert.strictEqual(cls({ ipApi: { isp: 'DigitalOcean, LLC', asn: 'AS14061' } }), 'hosting');
  assert.strictEqual(cls({ ipApi: { isp: 'Amazon.com, Inc.', asn: 'AS16509' } }), 'hosting');
});

t('家宽 ISP + PTR dynamic → 住宅', () => {
  const r = geo.classifyIp({
    ipApi: { isp: 'China Telecom', asn: 'AS4134' },
    ptr: '1-2-3-4.dynamic.cttelecom.net',
  });
  assert.strictEqual(r.cls, 'residential');
  assert.ok(r.notes.some((x) => /家宽/.test(x)), r.notes.join(','));
});

t('只有 PTR 提示也能判住宅', () => {
  assert.strictEqual(cls({ ipApi: { isp: 'Unknown ISP', asn: 'AS65000' }, ptr: 'ppp-42.pool.example.net' }), 'residential');
});

t('移动网络优先于住宅', () => {
  assert.strictEqual(cls({ ipApi: { mobile: true, isp: 'China Mobile' } }), 'mobile');
});

t('毫无线索 → 普通 IP（不再默认当住宅）', () => {
  assert.strictEqual(cls({ ipApi: { isp: 'Some Unknown Ltd', asn: 'AS65001' } }), 'plain');
  assert.strictEqual(cls({}), 'plain');
});

t('代理标记 + PTR 像机房 → 仍判代理', () => {
  assert.strictEqual(cls({ ipApi: { proxy: true }, ptr: 'vps-12.example.com' }), 'proxy');
});

t('机房与家宽冲突时以机房为准', () => {
  assert.strictEqual(
    cls({ ipApi: { hosting: true, isp: 'Vultr Holdings', asn: 'AS20473' }, ptr: 'x.dynamic.example.net' }),
    'hosting'
  );
});

t('可信度分级', () => {
  assert.strictEqual(geo.classifyIp({ ipApi: { proxy: true, hosting: true } }).confidence, 'high');
  assert.strictEqual(geo.classifyIp({ ipApi: { hosting: true } }).confidence, 'medium');
  assert.strictEqual(geo.classifyIp({ ptr: 'a.dynamic.b.net' }).confidence, 'low');
  assert.strictEqual(geo.classifyIp({}).confidence, 'none');
});

t('ipTypeLabel 映射（含兼容旧数据）', () => {
  assert.strictEqual(geo.ipTypeLabel({ ipClass: 'residential' }), '住宅宽带');
  assert.strictEqual(geo.ipTypeLabel({ ipClass: 'hosting' }), '机房 IDC');
  assert.strictEqual(geo.ipTypeLabel({ ipClass: 'plain' }), '普通 IP');
  assert.strictEqual(geo.ipTypeLabel({ hosting: true }), '机房 IDC');
  assert.strictEqual(geo.ipTypeLabel(null), '未知');
});

t('评分：住宅加分、机房扣分、黑名单扣分', () => {
  assert.strictEqual(geo.scoreHealth({ geo: { ipClass: 'residential' }, latency: 100, speed: 20 }).score, 100);
  const host = geo.scoreHealth({ geo: { ipClass: 'hosting', hosting: true }, latency: 100, speed: 20 });
  assert.strictEqual(host.score, 78);
  const listed = geo.scoreHealth({ geo: { ipClass: 'residential' }, dnsbl: { listed: ['Spamhaus'] }, latency: 100, speed: 20 });
  assert.strictEqual(listed.score, 91); // 100 + 3(住宅) - 12(黑名单)
  assert.ok(listed.reasons.some((r) => /黑名单/.test(r)));
});

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);
