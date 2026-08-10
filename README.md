# config_to_sub

免费在 Cloudflare Workers / Papes 中，搭建一个节点订阅网站，提取 [ChromeGo/EdgeGo](ChromeGo/EdgeGo) 订阅链接的代理节点，转换为 **vless、vmess、trojan、ss、hysteria、hy2、tuic、naiveproxy**分享链接，提供给 NekoBox、v2rayN 等代理软件使用。

支持：xray(json)、singbox(json)、clash(yaml)、明文的v2ray订阅/base64编码的v2ray订阅 ==> base64编码的v2ray订阅（nekoray_v3.26）。

**输出支持多种订阅格式**：在订阅地址后面加 `?format=` 参数即可切换输出格式（base64 / 明文 / clash / sing-box），转换在 Worker 本地完成，不依赖任何外部转换服务，详见[三、输出多种订阅格式](#三输出多种订阅格式)。

<img src="images\转换示意.png" />

### 一、搭建教程

- Cloudflare Workers

将 `_worker.js` 的代码复制到您的 `cloudflare worker` 应用程序中，替换掉原来的 `worker.js` 代码，部署。

- Cloudflare Pages

将`_worker.js`的代码下载到本地电脑，文件名称要一样，不能修改，然后在文件外面套一层文件夹，也就是将 `_worker.js` 下载到一个空文件夹中，然后使用 git 工具，在这个文件夹的目录中执行 `git init` 命令（貌似不用做这步），最后将这个文件夹以zip格式压缩，或者直接以文件夹的形式上传到 `Cloudflare Pages` 中，完成部署。

### 二、输出多种订阅格式

部署完成后，在订阅地址后面添加 `?format=` 参数即可获得不同格式的订阅，无需改动代码，不同格式共用同一份抓取缓存：

| 参数 | 说明 |
| --- | --- |
| 不带参数 / `?format=base64` | base64 编码的 v2ray 分享链接（默认，兼容性最好） |
| `?format=plain` | 明文 v2ray 分享链接（也支持 `v2ray`、`text`、`txt`） |
| `?format=clash` | clash / clash.meta 的 yaml 订阅（自动带上 `proxy-groups`，也支持 `yaml`、`clashyaml`） |
| `?format=singbox` | sing-box 的 json 订阅（`{version: 1, outbounds: [...]}`，也支持 `sing-box`、`json`） |

例如您的订阅地址是 `https://xxx.workers.dev/sub`：

```
https://xxx.workers.dev/sub                    # base64 编码的 v2ray 订阅（默认）
https://xxx.workers.dev/sub?format=plain      # 明文 v2ray 分享链接
https://xxx.workers.dev/sub?format=clash      # clash yaml 订阅
https://xxx.workers.dev/sub?format=singbox    # sing-box json 订阅
```

### 三、遇到问题

#### 1、出现 1102 页面错误

遇到1102错误，可以稍等一下（大概等几分钟到十多分钟，最长也就是几十分钟），再次访问应该能解决。

<img src="images\错误1102.png" />

#### 2、出现 FortiGuard Intrusion Prevention - Access Blocked 页面错误

如果绑定了自己的域名，而且使用代理访问，代理的IP地址又不干净的情况下，可能遇到下图的页面错误。

解决方法：更换其它干净的代理或不使用代理访问。

<img src="images\FortiGuard Intrusion Prevention - Access Blocked.png" />

#### 3、出现 Error: Too many subrequests 错误

原因是 `_worker.js` 中 `targetUrls`（在文件中搜索 `const targetUrls` 即可找到）的链接太多了，尽可能减少链接的数量（cloudflare免费用户：控制50条以内），重点剔除内容相同的链接。

#### 4、获取到的节点太少

在剔除重复节点的情况下，获取到的节点数 **少于** 配置文件中的**实际节点数**，原因：
- 1、出现没有检查到的代码 bug ，导致配置文件转换为分享的链接失败，亦或者不支持这个节点转换为分享链接。
- 2、 因为`_worker.js` 中 `targetUrls` 的链接太多了，出现 `Error: Too many subrequests` 错误，只处理到没有报 `Error: Too many subrequests` 错误之前的代理节点，导致获取到节点太少。