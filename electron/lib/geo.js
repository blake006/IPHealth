'use strict';

/**
 * IP 归属地 / 类型 / 黑名单 / 健康度评分
 */

const http = require('http');
const dns = require('dns');

const GEO_FIELDS =
  'status,message,country,countryCode,regionName,city,isp,org,as,asname,mobile,proxy,hosting,query';

function httpPostJson(host, path, payload, timeout = 9000) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload));
    const req = http.request(
      {
        host,
        path,
        method: 'POST',
        timeout,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
          'User-Agent': 'IPHealth/1.0',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('响应解析失败'));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('超时')));
    req.on('error', reject);
    req.end(body);
  });
}

function httpGetJson(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : http;
    const req = mod.get(url, { timeout, headers: { 'User-Agent': 'IPHealth/1.0' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('响应解析失败'));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('超时')));
    req.on('error', reject);
  });
}

/** 简单并发池 */
async function pool(list, limit, worker) {
  const arr = list.slice();
  const n = Math.max(1, Math.min(limit, arr.length));
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (arr.length) {
        const item = arr.shift();
        try {
          // eslint-disable-next-line no-await-in-loop
          await worker(item);
        } catch (e) {
          /* 单个失败不影响整体 */
        }
      }
    })
  );
}

/** 批量查询归属地 + 类型（多源并行，一次最多 100 个走 ip-api 批量） */
async function lookupBatch(ips, opts = {}) {
  const unique = [...new Set(ips.filter((ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)))];
  const result = new Map();
  if (!unique.length) return result;

  const chunks = [];
  for (let i = 0; i < unique.length; i += 100) chunks.push(unique.slice(i, i + 100));

  for (const chunk of chunks) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const list = await httpPostJson('ip-api.com', `/batch?fields=${GEO_FIELDS}&lang=zh-CN`, chunk);
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item && item.query && item.status === 'success') {
            result.set(item.query, {
              country: item.country || '',
              countryCode: item.countryCode || '',
              region: item.regionName || '',
              city: item.city || '',
              isp: item.isp || '',
              org: item.org || '',
              asn: (item.as || '').split(' ')[0] || '',
              asText: item.as || '',
              mobile: !!item.mobile,
              proxy: !!item.proxy,
              hosting: !!item.hosting,
              ptr: '',
            });
          }
        }
      }
    } catch (e) {
      /* 批量失败，走单条兜底 */
    }
  }

  // 哪些需要再补一刀：
  //   a) ip-api 没有明确标记的（机房/代理/移动都没命中）—— 住宅判断就靠这一步
  //   b) ip-api 完全没返回的
  const needExtra = unique.filter((ip) => {
    const g = result.get(ip);
    return !g || (!g.proxy && !g.hosting && !g.mobile);
  });

  await pool(needExtra, Math.max(1, Number(opts.concurrency) || 8), async (ip) => {
    const [info, ptr] = await Promise.all([
      httpGetJson(`https://ipinfo.io/${ip}/json`, 5000).catch(() => null),
      reverseLookup(ip, 1500),
    ]);
    const cur = result.get(ip) || {
      country: '',
      countryCode: '',
      region: '',
      city: '',
      isp: '',
      org: '',
      asn: '',
      asText: '',
      mobile: false,
      proxy: false,
      hosting: false,
      ptr: '',
    };
    cur.ptr = ptr || '';
    if (info && info.ip) {
      cur.country = cur.country || info.country || '';
      cur.countryCode = cur.countryCode || info.country || '';
      cur.region = cur.region || info.region || '';
      cur.city = cur.city || info.city || '';
      cur.isp = cur.isp || info.org || '';
      cur.org = cur.org || info.org || '';
      cur.asn = cur.asn || (info.org || '').split(' ')[0] || '';
      cur.asText = cur.asText || info.org || '';
      cur.ipinfoOrg = info.org || '';
    }
    result.set(ip, cur);
  });

  // 统一算类型（含 ip-api 已判定的，保证每条都有 ipClass）
  for (const [ip, g] of result) {
    const verdict = classifyIp({ ipApi: g, ipinfo: g.ipinfoOrg ? { org: g.ipinfoOrg } : null, ptr: g.ptr });
    g.ipClass = verdict.cls;
    g.ipConfidence = verdict.confidence;
    g.ipNotes = verdict.notes;
    result.set(ip, g);
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* IP 类型判定：多源并行 + 加权投票                                     */
/* ------------------------------------------------------------------ */

/** 已知云厂商 / IDC 的 ASN（命中直接判机房，权重 2） */
const ASN_HOSTING = new Set([
  16509, 14618, 8987, // Amazon
  15169, 396982, 19527, // Google
  8075, 8068, 12076, // Microsoft
  14061, // DigitalOcean
  20473, 11508, // Vultr / Choopa
  63949, 20940, // Akamai / Linode
  24940, // Hetzner
  16276, // OVH
  51167, // Contabo
  13335, // Cloudflare
  45102, 37963, 45102, // Alibaba
  132203, 45090, // Tencent
  31898, 14544, // Oracle
  9009, 62240, // M247 / Clouvider
  12876, // Scaleway
  36352, 53667, 40676, 29802, 25820, 46844, 30083, 40676, // 各类 VPS 机房
  6939, 41378, // Hurricane Electric 等
]);

/** 名字里带这些词，基本就是机房 */
const HOSTING_NAME_RE =
  /(amazon|aws|google|microsoft|azure|digitalocean|linode|vultr|choopa|ovh|hetzner|contabo|scaleway|aliyun|alibaba|tencent cloud|huawei cloud|oracle|cloudflare|fastly|akamai|leaseweb|psychz|colocrossing|m247|clouvider|gcore|servers|server|hosting|host\b|datacenter|data center|idc|colo|vps|dedicated|cloud|compute|虚拟机|机房|数据中心)/i;

/** 名字里带这些词，更像家宽 / 移动网络 */
const RESIDENTIAL_NAME_RE =
  /(broadband|telecom|unicom|comcast|verizon|at&t|charter|cox\b|centurylink|frontier|virgin|orange|deutsche telekom|kddi|softbank|ntt|sk broadband|singtel|starhub|pccw|hkbn|hkt|chinanet|cnc|cmnet|电信|联通|移动|铁通|广电|有线|cable|fiber|fibre|dsl|adsl)/i;

/** PTR 主机名启发式 */
const PTR_HOSTING_RE =
  /(^|[.\-_])(vps|srv|server|host|hosting|cloud|dedicated|dedi|colo|datacenter|dc\d|idc|node|compute|instance|virtual)([.\-_]|$)/i;
const PTR_RESIDENTIAL_RE =
  /(^|[.\-_])(dynamic|dyn|ppp|pppoe|dsl|adsl|broadband|bb|dial|dialup|pool|client|customer|cust|home|res|residential|mobile|4g|5g|lte)([.\-_]|$)/i;

const IP_CLASS_LABEL = {
  residential: '住宅宽带',
  hosting: '机房 IDC',
  proxy: '代理/VPN',
  mobile: '移动网络',
  plain: '普通 IP',
  unknown: '未知',
};

/** 反向解析（PTR），失败就当没有 */
function reverseLookup(ip, timeout = 1500) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (!done) {
        done = true;
        resolve('');
      }
    }, timeout);
    dns.reverse(ip, (err, names) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(!err && names && names.length ? names[0] : '');
    });
  });
}

/**
 * 加权投票判定 IP 类型（纯函数，便于单测）
 * @param {object} p
 * @param {object|null} p.ipApi  ip-api 结果（proxy/hosting/mobile/isp/asn/asText）
 * @param {object|null} p.ipinfo ipinfo.io 结果（org）
 * @param {string} [p.ptr]       反向解析主机名
 */
function classifyIp({ ipApi, ipinfo, ptr } = {}) {
  const w = { hosting: 0, proxy: 0, mobile: 0, residential: 0 };
  const notes = [];

  if (ipApi) {
    if (ipApi.proxy) {
      w.proxy += 2;
      notes.push('ip-api:代理');
    }
    if (ipApi.hosting) {
      w.hosting += 2;
      notes.push('ip-api:机房');
    }
    if (ipApi.mobile) {
      w.mobile += 2;
      notes.push('ip-api:移动');
    }
  }

  const asnNum = (v) => {
    const m = /(\d{1,10})/.exec(String(v || ''));
    return m ? Number(m[1]) : 0;
  };

  const asn = asnNum(ipApi && ipApi.asn) || asnNum(ipinfo && ipinfo.org) || 0;
  if (asn && ASN_HOSTING.has(asn)) {
    w.hosting += 2;
    notes.push(`AS${asn} 云厂商`);
  }

  const orgName = [ipApi && ipApi.isp, ipApi && ipApi.org, ipApi && ipApi.asText, ipinfo && ipinfo.org]
    .filter(Boolean)
    .join(' ');
  if (orgName) {
    if (HOSTING_NAME_RE.test(orgName)) {
      w.hosting += 1;
      notes.push('ISP 名称像机房');
    }
    if (RESIDENTIAL_NAME_RE.test(orgName)) {
      w.residential += 1;
      notes.push('ISP 名称像家宽');
    }
  }

  if (ptr) {
    if (PTR_HOSTING_RE.test(ptr)) {
      w.hosting += 1;
      notes.push('PTR 像机房');
    }
    if (PTR_RESIDENTIAL_RE.test(ptr)) {
      w.residential += 1;
      notes.push('PTR 像家宽');
    }
  }

  let cls = 'plain';
  if (w.hosting > 0 && w.proxy > 0) cls = 'proxy';
  else if (w.hosting >= 2) cls = 'hosting';
  else if (w.proxy >= 2) cls = 'proxy';
  else if (w.mobile >= 2) cls = 'mobile';
  else if (w.mobile >= 1 && w.residential >= 1 && w.hosting === 0) cls = 'mobile';
  else if (w.hosting === 1) cls = 'hosting';
  else if (w.residential >= 1) cls = 'residential';

  const total = w.hosting + w.proxy + w.mobile + w.residential;
  const confidence = total >= 4 ? 'high' : total >= 2 ? 'medium' : total >= 1 ? 'low' : 'none';

  return { cls, weights: w, notes, confidence };
}

const DNSBL_ZONES = [
  { zone: 'zen.spamhaus.org', name: 'Spamhaus' },
  { zone: 'bl.spamcop.net', name: 'SpamCop' },
  { zone: 'all.s5h.net', name: 's5h.net' },
  { zone: 'dnsbl-1.uceprotect.net', name: 'UCEPROTECT' },
];

function resolve4WithTimeout(name, timeout = 3000) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (!done) {
        done = true;
        resolve([]);
      }
    }, timeout);
    dns.resolve4(name, (err, addrs) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(err ? [] : addrs || []);
    });
  });
}

/** DNSBL 黑名单查询 */
async function checkDnsbl(ip) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return { listed: [], checked: 0 };
  const rev = ip.split('.').reverse().join('.');
  const results = await Promise.all(
    DNSBL_ZONES.map(async (z) => {
      const addrs = await resolve4WithTimeout(`${rev}.${z.zone}`, 2500);
      const hit = addrs.find((a) => a.startsWith('127.') && !a.startsWith('127.255.255'));
      return hit ? z.name : null;
    })
  );
  return { listed: results.filter(Boolean), checked: DNSBL_ZONES.length };
}

/** IP 类型标签 */
function ipTypeLabel(geo) {
  if (!geo) return '未知';
  if (geo.ipClass) return IP_CLASS_LABEL[geo.ipClass] || '普通 IP';
  // 兼容旧数据：只有 flags
  if (geo.mobile) return '移动网络';
  if (geo.proxy && geo.hosting) return '代理/VPN';
  if (geo.hosting) return '机房 IDC';
  if (geo.proxy) return '代理/VPN';
  return '普通 IP';
}

/**
 * 健康度评分 0-100
 * 维度：代理特征 / 机房特征 / 黑名单 / 延迟 / 速度
 */
function scoreHealth({ geo, dnsbl, latency, speed }) {
  let score = 100;
  const reasons = [];

  if (geo) {
    if (geo.proxy && geo.hosting) {
      score -= 45;
      reasons.push('检测为代理且为机房 IP');
    } else if (geo.proxy) {
      score -= 32;
      reasons.push('检测为代理/VPN');
    } else if (geo.hosting) {
      score -= 22;
      reasons.push('机房/IDC IP');
    }
    if (geo.ipClass === 'residential') {
      score += 3;
      reasons.push('住宅宽带出口');
    } else if (geo.mobile) {
      score += 2;
      reasons.push('移动网络出口');
    }
  } else {
    score -= 10;
    reasons.push('归属地未知');
  }

  if (dnsbl && dnsbl.listed && dnsbl.listed.length) {
    const pen = Math.min(30, dnsbl.listed.length * 12);
    score -= pen;
    reasons.push(`黑名单命中 ${dnsbl.listed.join('/')}`);
  }

  if (typeof latency === 'number' && latency > 0) {
    if (latency > 2000) score -= 18;
    else if (latency > 1000) score -= 10;
    else if (latency > 500) score -= 5;
  }

  if (typeof speed === 'number' && speed > 0) {
    if (speed < 0.5) score -= 14;
    else if (speed < 2) score -= 8;
    else if (speed < 8) score -= 3;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, reasons };
}

function healthLevel(score) {
  if (score == null) return { key: 'unknown', text: '未检测' };
  if (score >= 85) return { key: 'excellent', text: '优秀' };
  if (score >= 70) return { key: 'good', text: '良好' };
  if (score >= 50) return { key: 'fair', text: '一般' };
  return { key: 'bad', text: '较差' };
}

module.exports = {
  lookupBatch,
  checkDnsbl,
  ipTypeLabel,
  scoreHealth,
  healthLevel,
  classifyIp,
  reverseLookup,
  DNSBL_ZONES,
  ASN_HOSTING,
  IP_CLASS_LABEL,
};
