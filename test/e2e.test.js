// End-to-end test of the full worker flow with mocked sources.
// Run: node test/e2e.test.js
const assert = require('assert');
const yaml = require('js-yaml');
const { loadWorker } = require('./harness');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.message}`);
    process.exitCode = 1;
  }
}

// Mock sources
const plainSub = [
  'vless://99999999-9999-9999-9999-999999999999@rv.example.com:443?security=tls&sni=rv.example.com&type=ws&host=rv.example.com&path=%2Fws#[vless]_rv.example.com:443',
  'ss://YWVzLTI1Ni1nY206c3NwYXNz@rss.example.com:8388#[ss]_rss.example.com',
].join('\n');

const base64urlSub = Buffer.from(plainSub).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const clashSrc = yaml.dump({
  proxies: [
    { name: 'C1', type: 'vless', server: 'cv.example.com', port: 443, uuid: '77777777-7777-7777-7777-777777777777', network: 'ws', tls: true, servername: 'cv.example.com', 'ws-opts': { path: '/cws', headers: { Host: 'cv.example.com' } } },
    { name: 'C2', type: 'hysteria2', server: 'ch2.example.com', port: 443, password: 'chpw', sni: 'ch2.example.com', obfs: 'salamander', 'obfs-password': 'obfspw' },
    { name: 'C3', type: 'hysteria', server: 'chy.example.com', port: 443, 'auth-str': 'auth', up: '20', down: '100', obfs: 'obfspw1' },
    { name: 'C4', type: 'trojan', server: 'ct.example.com', port: 443, password: 'ctpw', sni: 'ct.example.com' },
    { name: 'C5', type: 'tuic', server: 'ctu.example.com', port: 443, uuid: 'tuic-uuid', password: 'tuicpw', 'congestion-controller': 'bbr', 'udp-relay-mode': 'native', alpn: ['h3'], sni: 'ctu.example.com' },
  ],
});

const xrayJson = JSON.stringify({
  outbounds: [
    { protocol: 'vless', settings: { vnext: [{ address: 'jv.example.com', port: 443, users: [{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', encryption: 'none', flow: 'xtls-rprx-vision' }] }] }, streamSettings: { network: 'tcp', security: 'reality', realitySettings: { serverName: 'www.microsoft.com', fingerprint: 'chrome', publicKey: 'pbk123', shortId: 'sid123' } } },
    { protocol: 'vmess', settings: { vnext: [{ address: 'jvm.example.com', port: 443, users: [{ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', alterId: 0, security: 'auto' }] }] }, streamSettings: { network: 'ws', security: 'tls', tlsSettings: { serverName: 'jvm.example.com' }, wsSettings: { path: '/vm', headers: { Host: 'jvm.example.com' } } } },
  ],
});

const singleNodeHy2 = JSON.stringify({ server: 'sg1.example.com', auth: 'h2password', tls: { sni: 'sg1.example.com', insecure: false } });

const singboxSrc = JSON.stringify({
  version: 1,
  outbounds: [
    { type: 'vless', tag: 'sb1', server: 'sb.example.com', server_port: 443, uuid: 'cccccccc-cccc-cccc-cccc-cccccccccccc', tls: { enabled: true, server_name: 'www.microsoft.com', utls: { fingerprint: 'chrome' }, reality: { enabled: true, public_key: 'pbkX', short_id: 'sidY' } } },
    { type: 'hysteria2', tag: 'sb2', server: 'sbhy2.example.com', server_port: 443, password: 'sbhy2pw', up_mbps: 30, down_mbps: 90, obfs: { type: 'salamander', password: 'obfspw2' }, tls: { enabled: true, server_name: 'sbhy2.example.com' } },
    { type: 'shadowsocks', tag: 'sb3', server: 'sbss.example.com', server_port: 8388, method: 'aes-256-gcm', password: 'sbsspw' },
  ],
});

let urlIdx = 0;
const sources = [plainSub, base64urlSub, clashSrc, xrayJson, singleNodeHy2, singboxSrc];
const mockFetch = async (input) => {
  const u = String(input);
  // serve sources round-robin by URL to exercise all paths
  const content = sources[urlIdx % sources.length];
  urlIdx++;
  return new Response(content, { status: 200 });
};

(async () => {
  const w = loadWorker(mockFetch);
  const req = new Request('https://worker.example/sub', { method: 'GET' });
  const resp = await w.workerDefault.fetch(req, {}, { waitUntil: () => {} });
  const text = await resp.text();
  const links = Buffer.from(text, 'base64').toString('utf8').split('\n').filter(Boolean);

  check('base64 output contains all node types', () => {
    const types = links.map((l) => l.split('://')[0].replace('naive+https', 'naive'));
    for (const t of ['vless', 'ss', 'hy2', 'hysteria', 'trojan', 'tuic', 'vmess']) {
      assert(types.includes(t), `missing type ${t} in: ${types.join(',')}`);
    }
  });

  check('base64 output from sing-box source has no :null ports', () => {
    const bad = links.filter((l) => l.includes(':null') || l.includes(':undefined'));
    assert(bad.length === 0, `broken links: ${bad.join('\n')}`);
    assert(links.some((l) => l.includes('pbk=pbkX')), 'sing-box reality node missing');
    assert(links.some((l) => l.includes('obfs-password=obfspw2')), 'sing-box hy2 obfs missing');
  });

  check('base64 output has no empty lines / no "null"', () => {
    assert(!links.some((l) => l.includes('null')), `link contains null: ${links.filter((l) => l.includes('null')).join('\n')}`);
  });

  // clash output
  const clashResp = await w.workerDefault.fetch(new Request('https://worker.example/sub?format=clash'), {}, { waitUntil: () => {} });
  const clashText = await clashResp.text();
  check('clash yaml parses and contains valid proxy types', () => {
    const cfg = yaml.load(clashText);
    assert(Array.isArray(cfg.proxies) && cfg.proxies.length > 0, 'no proxies');
    const types = new Set(cfg.proxies.map((p) => p.type));
    for (const t of ['vless', 'vmess', 'trojan', 'ss', 'hysteria', 'hysteria2', 'tuic']) {
      assert(types.has(t), `missing clash type ${t}: ${[...types].join(',')}`);
    }
    const hy2 = cfg.proxies.find((p) => p.type === 'hysteria2');
    assert.strictEqual(hy2['obfs-password'], 'obfspw', `obfs-password lost: ${JSON.stringify(hy2)}`);
  });

  // sing-box output
  const sbResp = await w.workerDefault.fetch(new Request('https://worker.example/sub?format=singbox'), {}, { waitUntil: () => {} });
  const sbText = await sbResp.text();
  check('sing-box json parses with only known outbound fields', () => {
    const cfg = JSON.parse(sbText);
    assert(Array.isArray(cfg.outbounds) && cfg.outbounds.length > 0, 'no outbounds');
    const validFields = new Set([
      'type', 'tag', 'server', 'server_port', 'uuid', 'password', 'method', 'security',
      'flow', 'packet_encoding', 'tls', 'transport', 'alter_id', 'up_mbps', 'down_mbps',
      'auth_str', 'obfs', 'congestion_control', 'udp_relay_mode', 'username',
      'plugin', 'plugin_opts',
    ]);
    for (const ob of cfg.outbounds) {
      for (const key of Object.keys(ob)) {
        assert(validFields.has(key), `unknown sing-box field "${key}" in ${ob.tag}`);
      }
    }
    const hy1 = cfg.outbounds.find((o) => o.type === 'hysteria');
    assert.strictEqual(hy1.obfs, 'obfspw1', `hysteria obfs wrong: ${JSON.stringify(hy1)}`);
  });

  console.log(`\n${passed} checks passed`);
})();
