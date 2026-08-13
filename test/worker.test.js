// Regression tests for bugs found in src/worker.js.
// Run: node test/worker.test.js
const assert = require('assert');
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

const w = loadWorker();

// ---------- Bug 1: xray vless with streamSettings.security="tls" must output security=tls ----------
const xrayVlessTcpTls = {
  protocol: 'vless',
  settings: {
    vnext: [{ address: 'tls.example.com', port: 443, users: [{ id: '11111111-1111-1111-1111-111111111111', encryption: 'none' }] }],
  },
  streamSettings: { network: 'tcp', security: 'tls', tlsSettings: { serverName: 'tls.example.com', fingerprint: 'chrome' } },
};
check('vless tcp+tls keeps security=tls', () => {
  const out = w.parse_vle55(xrayVlessTcpTls);
  assert(out.includes('security=tls'), `missing security=tls: ${out}`);
});

// ---------- Bug 2: vmess with security "none" must not emit tls="none" ----------
const xrayVmessTcpNone = {
  protocol: 'vmess',
  settings: {
    vnext: [{ address: 'plain.example.com', port: 8080, users: [{ id: '55555555-5555-5555-5555-555555555555', alterId: 0, security: 'auto' }] }],
  },
  streamSettings: { network: 'tcp', security: 'none' },
};
check('vmess tcp+none does not emit tls=none', () => {
  const out = w.parse_vme55(xrayVmessTcpNone);
  const json = JSON.parse(w.base64Decode(out.replace('vmess://', '')));
  assert(json.tls === '', `tls should be empty, got ${JSON.stringify(json.tls)}`);
});

// ---------- Bug 3: bare IPv6 in hy2 must be bracketed and get port ----------
check('hy2 bare IPv6 is bracketed with port', () => {
  const out = w.parse_hy2({ server: '2001:db8::1', port: 443, password: 'pw' });
  assert(out.startsWith('hy2://pw@[2001:db8::1]:443'), `bad link: ${out}`);
});
check('hy2 server already with port is not doubled', () => {
  const out = w.parse_hy2({ server: 'h.example.com:8443', password: 'pw' });
  assert(out.includes('@h.example.com:8443?'), `bad link: ${out}`);
});
check('hysteria server already with port is not doubled', () => {
  const out = w.parse_hysteria({ server: 'hy1.example.com:8443', up_mbps: 20, down_mbps: 100, auth_str: 'a' });
  assert(out.includes('hysteria://hy1.example.com:8443?'), `bad link: ${out}`);
});

// ---------- Bug 4: single-node hy2 must not emit empty insecure= ----------
check('single-node hy2 has no empty insecure param', () => {
  const w2 = loadWorker(async () => new Response(JSON.stringify({
    server: 'sg1.example.com',
    auth: 'h2password',
    tls: { sni: 'sg1.example.com', insecure: false },
  }), { status: 200 }));
  return w2.fetchAndProcessUrl('https://t/x').then((out) => {
    assert(!out.includes('insecure='), `empty insecure param: ${out}`);
    assert(out.startsWith('hy2://h2password@sg1.example.com:443?'), `bad link: ${out}`);
  });
});

// ---------- Round-trip: every generated link can be parsed by parseShareLink ----------
const links = [
  w.parse_vle55(xrayVlessTcpTls),
  w.parse_hy2({ server: '2001:db8::1', port: 443, password: 'pw' }),
  w.parse_hysteria({ server: 'hy1.example.com', up_mbps: 20, down_mbps: 100, auth_str: 'a', alpn: 'h3' }),
  w.parse_tr0jan({ server: 't.example.com', port: 443, password: 'pw', sni: 't.example.com' }),
  w.parse_shadowsocks({ server: 's.example.com', port: 8388, method: 'aes-256-gcm', password: 'pw' }),
  w.parse_tuic({ server: 'tuic.example.com', port: 443, uuid: '66666666-6666-6666-6666-666666666666', password: 'pw', alpn: ['h3'], sni: 'tuic.example.com' }),
  w.parse_vme55(xrayVmessTcpNone),
];
check('all generated links parse back via parseShareLink', () => {
  for (const link of links) {
    assert(link && link !== '', 'generated link is empty');
    const node = w.parseShareLink(link);
    assert(node && node.server, `cannot parse back: ${link}`);
  }
});

// ---------- Bug 5: hysteria obfs/auth must map to valid clash/sing-box fields ----------
const hy1Link = w.parseShareLink(
  w.parse_hysteria({ server: 'hy1.example.com', up_mbps: 20, down_mbps: 100, auth_str: 'auth123', obfs: 'obfspw', alpn: ['h3'] })
);
check('clash hysteria uses auth-str + obfs (not obfs-param)', () => {
  const p = w.toClashHysteria(hy1Link);
  assert.strictEqual(p['auth-str'], 'auth123', `auth-str missing: ${JSON.stringify(p)}`);
  assert.strictEqual(p.obfs, 'obfspw', `obfs wrong: ${JSON.stringify(p)}`);
  assert(!('obfs-param' in p), 'obfs-param must not be emitted');
});
check('sing-box hysteria uses obfs password, no invalid fields', () => {
  const ob = w.singboxHysteria(hy1Link);
  assert.strictEqual(ob.obfs, 'obfspw', `obfs wrong: ${JSON.stringify(ob)}`);
  assert(!('obfs_param' in ob), 'obfs_param must not be emitted');
  assert(!('protocol' in ob), 'protocol must not be emitted');
});

// ---------- Bug 6: base64url / unpadded base64 subscriptions must be accepted ----------
const subPlain = 'vless://99999999-9999-9999-9999-999999999999@rv.example.com:443?security=tls&sni=rv.example.com&type=ws&host=rv.example.com&path=%2Fws#[vless]_rv.example.com:443';
const subBase64Url = Buffer.from(subPlain).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
check('base64url unpadded subscription decodes to links', () => {
  const out = w.v2rayLinksHandle(subBase64Url);
  assert(out.includes('vless://'), `did not decode: ${out}`);
});
check('unpadded standard base64 subscription decodes to links', () => {
  const unpadded = Buffer.from(subPlain).toString('base64').replace(/=+$/, '');
  const out = w.v2rayLinksHandle(unpadded);
  assert(out.includes('vless://'), `did not decode: ${out}`);
});
check('plain v2ray links are not mistaken for base64', () => {
  assert.strictEqual(w.v2rayLinksHandle(subPlain), subPlain);
});

// ---------- Bug 7: sing-box vmess keeps alterId ----------
check('sing-box vmess emits alter_id', () => {
  const node = w.parseShareLink('vmess://' + w.base64Encode(JSON.stringify({ v: '2', ps: 'x', add: 'vm.example.com', port: 443, id: 'idididid-idid-idid-idid-idididididid', aid: 64, scy: 'auto', net: 'tcp', type: 'none' })));
  const ob = w.singboxVmess(node);
  assert.strictEqual(ob.alter_id, 64, `alter_id missing: ${JSON.stringify(ob)}`);
});

// ---------- Bug 8: sing-box source configs (server_port, tls object, transport.type) ----------
const singboxVlessReality = {
  type: 'vless',
  tag: 'sb-vless',
  server: 'sb.example.com',
  server_port: 443,
  uuid: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  tls: { enabled: true, server_name: 'www.microsoft.com', utls: { fingerprint: 'chrome' }, reality: { enabled: true, public_key: 'pbkX', short_id: 'sidY' } },
};
check('sing-box vless reality has port + reality params', () => {
  const out = w.parse_vle55(singboxVlessReality);
  assert(out.includes('@sb.example.com:443?'), `bad link: ${out}`);
  assert(out.includes('security=reality'), `missing reality: ${out}`);
  assert(out.includes('pbk=pbkX') && out.includes('sid=sidY'), `missing pbk/sid: ${out}`);
});

const singboxVlessWsTls = {
  type: 'vless',
  tag: 'sb-vless-ws',
  server: 'sbws.example.com',
  server_port: 443,
  uuid: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  tls: { enabled: true, server_name: 'sbws.example.com' },
  transport: { type: 'ws', path: '/sbws', headers: { Host: 'sbws.example.com' } },
};
check('sing-box vless ws+tls has port, tls, ws transport', () => {
  const out = w.parse_vle55(singboxVlessWsTls);
  assert(out.includes('@sbws.example.com:443?'), `bad link: ${out}`);
  assert(out.includes('security=tls'), `missing tls: ${out}`);
  assert(out.includes('type=ws') && out.includes('path=%2Fsbws') && out.includes('host=sbws.example.com'), `missing ws: ${out}`);
});

const singboxVmess = {
  type: 'vmess',
  tag: 'sb-vmess',
  server: 'sbvm.example.com',
  server_port: 443,
  uuid: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  security: 'auto',
  tls: { enabled: true, server_name: 'sbvm.example.com' },
  transport: { type: 'ws', path: '/vm', headers: { Host: 'sbvm.example.com' } },
};
check('sing-box vmess has port and tls', () => {
  const out = w.parse_vme55(singboxVmess);
  const json = JSON.parse(w.base64Decode(out.replace('vmess://', '')));
  assert.strictEqual(json.port, 443, `port wrong: ${JSON.stringify(json)}`);
  assert.strictEqual(json.tls, 'tls', `tls wrong: ${JSON.stringify(json)}`);
  assert.strictEqual(json.net, 'ws', `net wrong: ${JSON.stringify(json)}`);
});

const singboxTrojan = {
  type: 'trojan',
  tag: 'sb-trojan',
  server: 'sbt.example.com',
  server_port: 8443,
  password: 'sbtpw',
  tls: { enabled: true, server_name: 'sbt.example.com' },
};
check('sing-box trojan has port and tls', () => {
  const out = w.parse_tr0jan(singboxTrojan);
  assert(out.includes('@sbt.example.com:8443?'), `bad link: ${out}`);
  assert(out.includes('security=tls'), `missing tls: ${out}`);
});

const singboxHy2 = {
  type: 'hysteria2',
  tag: 'sb-hy2',
  server: 'sbhy2.example.com',
  server_port: 443,
  password: 'sbhy2pw',
  up_mbps: 30,
  down_mbps: 90,
  obfs: { type: 'salamander', password: 'obfspw2' },
  tls: { enabled: true, server_name: 'sbhy2.example.com' },
};
check('sing-box hysteria2 keeps obfs object and up/down', () => {
  const out = w.parse_hy2(singboxHy2);
  assert(out.includes('@sbhy2.example.com:443?'), `bad link: ${out}`);
  assert(out.includes('obfs=salamander') && out.includes('obfs-password=obfspw2'), `obfs lost: ${out}`);
  assert(out.includes('upmbps=30') && out.includes('downmbps=90'), `up/down lost: ${out}`);
});

const singboxTuic = {
  type: 'tuic',
  tag: 'sb-tuic',
  server: 'sbtuic.example.com',
  server_port: 443,
  uuid: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  password: 'sbtuicpw',
  congestion_control: 'bbr',
  udp_relay_mode: 'native',
  tls: { enabled: true, server_name: 'sbtuic.example.com', alpn: ['h3'] },
};
check('sing-box tuic keeps port and congestion control', () => {
  const out = w.parse_tuic(singboxTuic);
  assert(out.includes('@sbtuic.example.com:443?'), `bad link: ${out}`);
  assert(out.includes('congestion_control=bbr'), `missing congestion: ${out}`);
});

const singboxSs = { type: 'shadowsocks', tag: 'sb-ss', server: 'sbss.example.com', server_port: 8388, method: 'aes-256-gcm', password: 'sbsspw' };
check('sing-box shadowsocks has port', () => {
  const out = w.parse_shadowsocks(singboxSs);
  assert(out.includes('@sbss.example.com:8388'), `bad link: ${out}`);
});

// ---------- Bug 9: 特殊字符密码的 userinfo 百分号编码 + 往返解析 ----------
check('hy2 password with special chars round-trips', () => {
  const link = w.parse_hy2({ server: 'h2.example.com', port: 443, password: 'p@ss:word?x#y' });
  const node = w.parseShareLink(link);
  assert.strictEqual(node.password, 'p@ss:word?x#y', `password mangled: ${link}`);
});
check('trojan password with special chars round-trips', () => {
  const link = w.parse_tr0jan({ server: 't.example.com', port: 443, password: 'p@ss' });
  const node = w.parseShareLink(link);
  assert.strictEqual(node.password, 'p@ss', `password mangled: ${link}`);
});
check('tuic uuid/password with special chars round-trips', () => {
  const link = w.parse_tuic({ server: 'tuic.example.com', port: 443, uuid: 'uu@id', password: 'p@ss' });
  const node = w.parseShareLink(link);
  assert.strictEqual(node.uuid, 'uu@id', `uuid mangled: ${link}`);
  assert.strictEqual(node.password, 'p@ss', `password mangled: ${link}`);
});

// ---------- Bug 10: ss 插件参数(SIP002)保留 ----------
check('ss plugin survives parse -> clash/sing-box', () => {
  const link = w.parse_shadowsocks({ server: 's.example.com', port: 8388, method: 'aes-256-gcm', password: 'pw', plugin: 'obfs-local', 'plugin-opts': 'obfs=http;obfs-host=x.com' });
  assert(link.includes('plugin='), `plugin param missing: ${link}`);
  const node = w.parseShareLink(link);
  const cp = w.toClashSs(node);
  assert.strictEqual(cp.plugin, 'obfs-local', `clash plugin wrong: ${JSON.stringify(cp)}`);
  assert.strictEqual(cp['plugin-opts'], 'obfs=http;obfs-host=x.com', `clash plugin-opts wrong: ${JSON.stringify(cp)}`);
  const sp = w.singboxSs(node);
  assert.strictEqual(sp.plugin, 'obfs-local', `singbox plugin wrong: ${JSON.stringify(sp)}`);
  assert.strictEqual(sp.plugin_opts, 'obfs=http;obfs-host=x.com', `singbox plugin_opts wrong: ${JSON.stringify(sp)}`);
});

// ---------- Bug 11: clash 输出 IPv6 服务器加中括号 ----------
check('clash output brackets IPv6 server', () => {
  const link = w.parse_hy2({ server: '2001:db8::1', port: 443, password: 'pw' });
  const node = w.parseShareLink(link);
  const cp = w.toClashHy2(node);
  assert.strictEqual(cp.server, '[2001:db8::1]', `clash server not bracketed: ${JSON.stringify(cp)}`);
  const sp = w.singboxHy2(node);
  assert.strictEqual(sp.server, '2001:db8::1', `sing-box server should stay unbracketed: ${JSON.stringify(sp)}`);
});

// ---------- Bug 12: 全部节点转换失败时不生成空 proxy-groups ----------
check('buildClashConfig handles all-failed conversion', () => {
  const cfg = w.buildClashConfig([{ type: 'unknown', name: 'x', server: 'a', port: 1 }]);
  assert(Array.isArray(cfg.proxies) && cfg.proxies.length === 0, JSON.stringify(cfg));
  assert(!('proxy-groups' in cfg), 'should not emit empty proxy-groups');
});

// ---------- Bug 13: 链接尾部 \r 不影响解析 ----------
check('parseShareLink trims trailing CR', () => {
  const node = w.parseShareLink('vless://99999999-9999-9999-9999-999999999999@rv.example.com:443?security=tls&sni=rv.example.com&type=ws&host=rv.example.com&path=%2Fws#[vless]_rv.example.com:443\r');
  assert(node && node.server === 'rv.example.com', 'CR broke parsing');
});

// ---------- Bug 14: 自研 YAML 解析器(零第三方依赖) ----------
const sampleYaml = `# 注释行
allow-lan: false
mixed-port: 7890
dns:
  enabled: true
  nameserver:
    - 119.29.29.29
    - 223.5.5.5
proxies:
  - name: 'node \'A\''
    type: hysteria2
    server: h2.example.com
    port: 443
    password: p@ss:word
    sni: h2.example.com
    tls: false
  - name: nodeB
    type: vless
    server: v.example.com
    port: 443
    uuid: u-u-i-d
    tls: true
    ws-opts:
      headers:
        Host: v.example.com
      path: /ws
proxy-groups:
  - name: 🚀 节点选择
    type: select
    proxies:
      - nodeB
`;
check('yaml parser: nested maps, same-indent seq, quotes, comments', () => {
  const doc = w.yamlParse(sampleYaml);
  assert.strictEqual(doc['allow-lan'], false);
  assert(Array.isArray(doc.dns.nameserver) && doc.dns.nameserver.join(',') === '119.29.29.29,223.5.5.5');
  assert.strictEqual(doc.proxies.length, 2);
  assert.strictEqual(doc.proxies[0].name, "node 'A'");
  assert.strictEqual(doc.proxies[0].password, 'p@ss:word');
  assert.strictEqual(doc.proxies[1]['ws-opts'].headers.Host, 'v.example.com');
});

const anchorYaml = `proxies: &shared
- name: a
  type: ss
- name: b
  type: ss
proxy-groups:
- name: g1
  proxies: *shared
`;
check('yaml parser: anchors and aliases', () => {
  const doc = w.yamlParse(anchorYaml);
  assert.strictEqual(doc.proxies.length, 2);
  assert.strictEqual(doc['proxy-groups'][0].proxies.length, 2);
});

const aggYaml = `secret: a
proxies:
- name: x
  type: ss
  server: s1.example.com
secret: b
proxies:
- name: y
  type: ss
  server: s2.example.com
`;
check('yaml parser: aggregated duplicated-key config merges all proxies', () => {
  const docs = w.yamlParseAll(aggYaml);
  const all = docs.filter((o) => Array.isArray(o && o.proxies)).reduce((n, o) => n + o.proxies.length, 0);
  assert.strictEqual(all, 2, 'should extract proxies from both chunks');
});

check('yaml serializer output parses back (round-trip via own parser)', () => {
  const cfg = {
    proxies: [
      { name: "node 'A' 🚀", type: 'vless', server: 'v.example.com', port: 443, uuid: 'u', tls: true, alpn: ['h3', 'h2'] },
      { name: 'ss-node', type: 'ss', server: 's.example.com', port: 8388, cipher: 'aes-256-gcm', password: 'pw:with@chars', udp: true },
    ],
    'proxy-groups': [{ name: '🚀 节点选择', type: 'select', proxies: ["node 'A' 🚀", 'ss-node'] }],
  };
  const dumped = w.yamlDump(cfg);
  const parsed = w.yamlParse(dumped);
  assert.strictEqual(parsed.proxies[0].name, "node 'A' 🚀");
  assert(Array.isArray(parsed.proxies[0].alpn) && parsed.proxies[0].alpn.join(',') === 'h3,h2');
  assert.strictEqual(parsed.proxies[1].password, 'pw:with@chars');
  assert.strictEqual(parsed['proxy-groups'][0].proxies[0], "node 'A' 🚀");
});

check('yaml serializer: numbers/booleans stay typed', () => {
  const dumped = w.yamlDump({ proxies: [{ name: 'x', type: 'ss', port: 8388, udp: true, tls: false }] });
  const parsed = w.yamlParse(dumped);
  assert.strictEqual(parsed.proxies[0].port, 8388);
  assert.strictEqual(parsed.proxies[0].udp, true);
  assert.strictEqual(parsed.proxies[0].tls, false);
});

// ---------- Bug 15: 过滤源订阅自带的坏链接(占位符值) ----------
check('bad links with placeholder values are filtered', () => {
  assert.strictEqual(w.isBrokenLink('hysteria://5.83.129.90:54177?upmbps=100&auth=x&obfsParam=undefined'), true);
  assert.strictEqual(w.isBrokenLink('vless://u@host:null?security=tls'), true);
  assert.strictEqual(w.isBrokenLink('ss://xxx@null.example.com:8388'), false); // 域名含 null 不是坏链接
  assert.strictEqual(w.isBrokenLink('hy2://pw@h.example.com:443?upmbps=80'), false);
  // 从含坏链接的订阅中只保留好链接
  const plainSub = 'hysteria://5.83.129.90:54177?upmbps=100&auth=dongtaiwang.com&obfsParam=undefined\nvless://99999999-9999-9999-9999-999999999999@rv.example.com:443?security=tls&sni=rv.example.com\n';
  const w2 = loadWorker(async () => new Response(plainSub, { status: 200 }));
  return w2.fetchAndProcessUrl('https://t/x').then((res) => {
    assert.strictEqual(res.length, 1, `should keep only 1 good link: ${res.join('|')}`);
    assert(res[0].startsWith('vless://'), 'good link should survive');
  });
});
check('base64 subscription with obfsParam=undefined links is filtered (chg64 scenario)', () => {
  const sub =
    'hysteria://45.150.65.154:47119?upmbps=100&downmbps=100&auth=dongtaiwang.com&insecure=1&peer=bing.com&alpn=h3&obfsParam=undefined\n' +
    'hy2://p%40ss@h2.example.com:443?upmbps=80&downmbps=100&sni=h2.example.com&insecure=1#[hy2]_h2.example.com:443\n';
  const b64 = Buffer.from(sub).toString('base64');
  const w2 = loadWorker(async () => new Response(b64, { status: 200 }));
  return w2.fetchAndProcessUrl('https://t/x').then((res) => {
    assert.strictEqual(res.length, 1, `should keep only the good hy2 link: ${res.join('|')}`);
    assert(res[0].startsWith('hy2://'), 'good hy2 link should survive');
  });
});

// ---------- hy2/IPv6 round-trip keeps correct host & port ----------
check('hy2 bare IPv6 round-trips to bracketed host', () => {
  const link = w.parse_hy2({ server: '2001:db8::1', port: 443, password: 'pw' });
  const node = w.parseShareLink(link);
  assert.strictEqual(node.server, '2001:db8::1');
  assert.strictEqual(node.port, 443);
});

console.log(`\n${passed} checks passed`);
