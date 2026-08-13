// 检查 targetUrls 里每个链接:HTTP状态 + 内容是否像有效订阅数据
// 用法: node test/check-urls.js
const yaml = require('js-yaml');

// 从 src/worker.js 中提取 targetUrls
const fs = require('fs');
const src = fs.readFileSync('src/worker.js', 'utf8');
const m = src.match(/const targetUrls = \[([\s\S]*?)\n\];/);
const urls = [...m[1].matchAll(/'(https:\/\/[^']+)'/g)].map((x) => x[1]);

const PREFIXES = ['hysteria://', 'hy2://', 'vless://', 'vmess://', 'trojan://', 'ss://', 'tuic://', 'naive+https://'];

function looksLikeLinks(text) {
  return PREFIXES.some((p) => text.includes(p));
}

function looksLikeBase64(text) {
  const t = text.replace(/\s+/g, '');
  if (t.length < 40) return false;
  if (!/^[A-Za-z0-9+/=_-]+$/.test(t)) return false;
  const padded = t.replace(/-/g, '+').replace(/_/g, '/');
  const np = padded.replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]+$/.test(np)) return false;
  try {
    const decoded = Buffer.from(np, 'base64').toString('utf8');
    return looksLikeLinks(decoded);
  } catch (e) {
    return false;
  }
}

function classify(text) {
  if (!text) return 'EMPTY';
  // JSON?
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object') {
      const keys = Object.keys(obj);
      if (keys.includes('outbounds')) return 'JSON-config(outbounds)';
      if (keys.some((k) => ['server', 'auth', 'proxy', 'listen', 'profiles', 'outbounds'].includes(k))) {
        return 'JSON-config(single-node?)';
      }
      return 'JSON-other';
    }
  } catch (e) {
    /* not json */
  }
  // YAML?
  try {
    const obj = yaml.load(text);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      if (Array.isArray(obj.proxies)) return 'YAML-clash(proxies)';
      if (Object.keys(obj).length > 0) return 'YAML-other';
    }
  } catch (e) {
    // 聚合clash配置顶层key重复,单个yaml.load会报错,但内容仍是有效订阅
    if (/<!DOCTYPE/i.test(text)) {
      /* 是HTML页面,不是yaml */
    } else if (text.includes('proxies:') && !/^\s*proxies:\s*$/m.test(text) === false) {
      return 'YAML-clash(aggregated)';
    }
  }
  // 明文链接 / base64
  if (looksLikeLinks(text)) return 'plain-links';
  if (looksLikeBase64(text)) return 'base64-links';
  return 'UNKNOWN/HTML';
}

(async () => {
  let ok = 0,
    dead = 0;
  const results = [];
  for (const url of urls) {
    let status = 'ERR';
    let kind = 'FETCH-FAIL';
    let size = 0;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: 'follow' });
      status = resp.status;
      const text = await resp.text();
      size = text.length;
      kind = classify(text);
    } catch (e) {
      status = 'ERR:' + e.name;
    }
    const good = status === 200 && kind !== 'UNKNOWN/HTML' && kind !== 'EMPTY' && kind !== 'JSON-other';
    results.push({ url, status, kind, size, good });
    if (good) ok++;
    else dead++;
    console.log(`${good ? 'OK ' : 'BAD'} [${status}] [${kind}] [${size}B] ${url}`);
  }
  console.log(`\n=== 有效: ${ok} / 失效: ${dead} ===`);
})();
