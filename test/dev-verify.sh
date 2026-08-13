#!/bin/bash
# 启动 wrangler dev -> 探测就绪 -> 验证各格式输出 -> 关闭
set -u
PORT=8787
LOG=/tmp/wrangler-dev.log

# wrangler dev 会把缓存持久化到 .wrangler/state(跨重启保留),会读到修复前的旧数据,每次验证前清空
rm -rf .wrangler/state

# wrangler 3.25 的 miniflare 与 Node 22 不兼容(ReadableStream API 变更),用 Node 18 运行
npx -y node@18 node_modules/wrangler/bin/wrangler.js dev --port $PORT --ip 127.0.0.1 > "$LOG" 2>&1 &
WPID=$!
echo "wrangler dev PID=$WPID"

# 等待服务就绪(最多90秒)
READY=""
for i in $(seq 1 45); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://127.0.0.1:$PORT/" 2>/dev/null)
  if [ "$code" = "200" ] || [ "$code" = "500" ]; then
    READY="yes"
    echo "服务就绪 (第${i}次探测, HTTP $code)"
    break
  fi
  sleep 2
done

if [ -z "$READY" ]; then
  echo "!! 服务未在预期时间内就绪"
  tail -30 "$LOG"
  kill $WPID 2>/dev/null
  exit 1
fi

echo "=================================================="
echo "第一次请求会抓取 35 个订阅源,可能需要一些时间..."
echo "=================================================="

# 1) 默认 base64 格式
echo ""
echo "########## 1/4 默认 base64 ##########"
curl -s --max-time 300 -D /tmp/h1.txt "http://127.0.0.1:$PORT/" -o /tmp/out_base64.txt
head -5 /tmp/h1.txt | grep -iE "HTTP|content-type|cache-control"
echo "base64 长度: $(wc -c < /tmp/out_base64.txt) 字节"
# macOS 的 base64 -d 参数不兼容,用 node 解码验证
echo "解码后节点数: $(node -e "const s=require('fs').readFileSync('/tmp/out_base64.txt','utf8').trim();const d=Buffer.from(s,'base64').toString('utf8');console.log(d.split('\n').filter(l=>l.includes('://')).length)")"
echo "示例节点:"
node -e "const s=require('fs').readFileSync('/tmp/out_base64.txt','utf8').trim();const d=Buffer.from(s,'base64').toString('utf8');console.log(d.split('\n').slice(0,2).join('\n'))"

# 2) plain
echo ""
echo "########## 2/4 plain ##########"
curl -s --max-time 120 "http://127.0.0.1:$PORT/?format=plain" -o /tmp/out_plain.txt
echo "节点数: $(grep -c '://' /tmp/out_plain.txt)"
head -2 /tmp/out_plain.txt

# 3) clash
echo ""
echo "########## 3/4 clash ##########"
curl -s --max-time 120 -D /tmp/h3.txt "http://127.0.0.1:$PORT/?format=clash" -o /tmp/out_clash.yaml
head -5 /tmp/h3.txt | grep -iE "HTTP|content-type"
echo "clash yaml 行数: $(wc -l < /tmp/out_clash.yaml)"
head -12 /tmp/out_clash.yaml

# 4) sing-box
echo ""
echo "########## 4/4 singbox ##########"
curl -s --max-time 120 -D /tmp/h4.txt "http://127.0.0.1:$PORT/?format=singbox" -o /tmp/out_singbox.json
head -5 /tmp/h4.txt | grep -iE "HTTP|content-type"
echo "singbox json 行数: $(wc -l < /tmp/out_singbox.json)"
head -16 /tmp/out_singbox.json

echo ""
echo "=================================================="
echo "各格式内容校验:"
# 用 node 校验 clash yaml 和 singbox json 的合法性
node -e "
const fs = require('fs');
let ok = true;
// clash yaml 无法用外部解析器验证时,至少检查基本结构
const c = fs.readFileSync('/tmp/out_clash.yaml', 'utf8');
if (!c.includes('proxies:')) { ok = false; console.log('✗ clash 缺少 proxies'); } else console.log('✓ clash 含 proxies 段');
try {
  const j = JSON.parse(fs.readFileSync('/tmp/out_singbox.json', 'utf8'));
  console.log('✓ singbox json 合法, outbounds 数量:', Array.isArray(j.outbounds) ? j.outbounds.length : '?');
} catch (e) { ok = false; console.log('✗ singbox json 解析失败:', e.message); }
const p = fs.readFileSync('/tmp/out_plain.txt', 'utf8');
const types = [...new Set(p.split('\n').map(l => l.split('://')[0].replace('naive+https','naive')).filter(Boolean))];
console.log('✓ plain 节点类型:', types.join(','));
// 检查坏链接(占位符值: =undefined / :null / null@ / [object)
const lines = p.split('\n').filter(l => l.includes('://'));
const bad = lines.filter(l => /(?:=|:)undefined|:null|null@|\[object/.test(l));
if (bad.length > 0) {
  ok = false;
  console.log('✗ 发现 ' + bad.length + ' 个坏链接(undefined/null占位符):');
  bad.slice(0, 5).forEach(l => console.log('   ' + l.slice(0, 120)));
} else {
  console.log('✓ 无 undefined/null 占位符坏链接 (' + lines.length + ' 节点)');
}
if (!ok) process.exit(1);
"
echo "=================================================="
echo "wrangler 日志最后 15 行:"
tail -15 "$LOG"

kill $WPID 2>/dev/null
echo "已关闭 wrangler dev (PID $WPID)"
