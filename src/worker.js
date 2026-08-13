// ====================================================================================
// 极简 YAML 解析/序列化(零第三方依赖)
// 只实现订阅/代理配置文件用到的 YAML 子集:
//   块状映射/序列、嵌套缩进、同缩进序列、单双引号、注释、锚点/别名、基础流式集合
// 不做完整 YAML 规范支持;遇到不认识的语法时宽容降级,保证不崩溃
// ====================================================================================

// 去掉行尾注释(# 前面必须是空白或行首,引号内的 # 不算注释)
function stripYamlComment(line) {
	let inS = false;
	let inD = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (inS) {
			if (c === "'") inS = false;
			continue;
		}
		if (inD) {
			if (c === '"') inD = false;
			continue;
		}
		if (c === "'") inS = true;
		else if (c === '"') inD = true;
		else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
	}
	return line;
}

// 预处理: 拆行、去注释、去行尾空白、去掉空行
function preprocessYamlLines(text) {
	const lines = [];
	for (const raw of String(text).split(/\r?\n/)) {
		const stripped = stripYamlComment(raw).replace(/[ \t]+$/, '');
		if (stripped.trim() !== '') {
			lines.push(stripped);
		}
	}
	return lines;
}

// 拆 "key: value" 或 "key:"(引号感知,值里的 ": " 不会误伤)
function yamlSplitKeyValue(str) {
	let inS = false;
	let inD = false;
	for (let i = 0; i < str.length; i++) {
		const c = str[i];
		if (inS) {
			if (c === "'") inS = false;
			continue;
		}
		if (inD) {
			if (c === '"') inD = false;
			continue;
		}
		if (c === "'") {
			inS = true;
			continue;
		}
		if (c === '"') {
			inD = true;
			continue;
		}
		if (c === ':' && (i + 1 >= str.length || str[i + 1] === ' ' || str[i + 1] === '\t')) {
			const key = str.slice(0, i).trim();
			const rest = str.slice(i + 1).trim();
			if (key !== '') return { key: key, value: rest, hasValue: rest !== '' };
		}
	}
	return null;
}

// 拆 "&锚点名 值" 或 "&锚点名"
function yamlSplitAnchor(raw) {
	if (!raw.startsWith('&')) return null;
	const sp = raw.indexOf(' ');
	if (sp < 0) return { name: raw.slice(1), rest: '' };
	return { name: raw.slice(1, sp), rest: raw.slice(sp + 1) };
}

// 解析标量(含引号/布尔/数字/空/null/锚点/别名/基础流式集合)
function yamlParseScalar(raw, ctx) {
	if (raw === '') return null;
	if (raw[0] === "'") {
		if (raw.endsWith("'") && raw.length >= 2) return raw.slice(1, -1).replace(/''/g, "'");
		return raw.slice(1);
	}
	if (raw[0] === '"') {
		if (raw.endsWith('"') && raw.length >= 2) {
			return raw
				.slice(1, -1)
				.replace(/\\n/g, '\n')
				.replace(/\\t/g, '\t')
				.replace(/\\"/g, '"')
				.replace(/\\\\/g, '\\');
		}
		return raw.slice(1);
	}
	// 锚点定义(&name value)
	if (raw.startsWith('&')) {
		const anchor = yamlSplitAnchor(raw);
		if (anchor && anchor.rest !== '') {
			const val = yamlParseScalar(anchor.rest, ctx);
			if (anchor.name && ctx) ctx.anchors[anchor.name] = val;
			return val;
		}
		return null;
	}
	// 别名引用(*name)
	if (raw.startsWith('*')) {
		if (ctx && ctx.anchors && ctx.anchors[raw.slice(1)] !== undefined) {
			return ctx.anchors[raw.slice(1)];
		}
		return raw;
	}
	const lower = raw.toLowerCase();
	if (lower === 'true' || lower === 'yes' || lower === 'on') return true;
	if (lower === 'false' || lower === 'no' || lower === 'off') return false;
	if (lower === 'null' || lower === '~') return null;
	if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
	if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
	// 基础流式集合
	if (raw.startsWith('[') && raw.endsWith(']')) {
		const inner = raw.slice(1, -1).trim();
		if (inner === '') return [];
		return inner.split(',').map((s) => yamlParseScalar(s.trim(), ctx));
	}
	if (raw.startsWith('{') && raw.endsWith('}')) {
		const inner = raw.slice(1, -1).trim();
		const obj = {};
		if (inner !== '') {
			for (const part of inner.split(',')) {
				const kv = yamlSplitKeyValue(part.trim());
				if (kv) obj[kv.key] = kv.hasValue ? yamlParseScalar(kv.value, ctx) : null;
			}
		}
		return obj;
	}
	return raw;
}

// 解析一个键的值(行内值 / 锚点 + 后续块 / 后续深缩进块 / 同缩进序列)
// 返回 { value, nextIndex }
function yamlResolveValue(lines, idx, ctx, keyIndent, inlineValue) {
	if (inlineValue !== null && inlineValue !== undefined && inlineValue !== '') {
		const v = inlineValue.trim();
		const anchor = v.startsWith('&') ? yamlSplitAnchor(v) : null;
		if (anchor && anchor.rest !== '') {
			const val = yamlParseScalar(anchor.rest, ctx);
			if (anchor.name && ctx) ctx.anchors[anchor.name] = val;
			return { value: val, nextIndex: idx };
		}
		if (anchor) {
			// 只有锚点名,值在后续块
			const next = lines[idx];
			if (next === undefined) {
				if (anchor.name && ctx) ctx.anchors[anchor.name] = null;
				return { value: null, nextIndex: idx };
			}
			const nind = next.length - next.trimStart().length;
			if (nind > keyIndent) {
				const [child, ni] = yamlParseBlock(lines, idx, ctx, nind);
				if (anchor.name && ctx) ctx.anchors[anchor.name] = child;
				return { value: child, nextIndex: ni };
			}
			if (nind === keyIndent && next.slice(keyIndent).trim().startsWith('-')) {
				const [child, ni] = yamlParseSeq(lines, idx, ctx, keyIndent);
				if (anchor.name && ctx) ctx.anchors[anchor.name] = child;
				return { value: child, nextIndex: ni };
			}
			if (anchor.name && ctx) ctx.anchors[anchor.name] = null;
			return { value: null, nextIndex: idx };
		}
		return { value: yamlParseScalar(v, ctx), nextIndex: idx };
	}
	// 值在后续行
	const next = lines[idx];
	if (next === undefined) return { value: null, nextIndex: idx };
	const nind = next.length - next.trimStart().length;
	if (nind > keyIndent) {
		const [child, ni] = yamlParseBlock(lines, idx, ctx, nind);
		return { value: child, nextIndex: ni };
	}
	if (nind === keyIndent && next.slice(keyIndent).trim().startsWith('-')) {
		const [child, ni] = yamlParseSeq(lines, idx, ctx, keyIndent);
		return { value: child, nextIndex: ni };
	}
	return { value: null, nextIndex: idx };
}

// 继续解析映射条目到 obj 中(从 start 开始,要求缩进 > minIndent)
function yamlParseMapTail(lines, start, ctx, minIndent, obj) {
	let j = start;
	while (j < lines.length) {
		const l = lines[j];
		const ind = l.length - l.trimStart().length;
		if (ind <= minIndent) break;
		const t = l.slice(ind).trim();
		if (t === '' || t.startsWith('-')) {
			j++;
			continue;
		}
		const e = yamlSplitKeyValue(t);
		if (!e) {
			j++;
			continue;
		}
		const r = yamlResolveValue(lines, j + 1, ctx, ind, e.hasValue ? e.value : null);
		obj[e.key] = r.value;
		j = r.nextIndex;
	}
	return j;
}

// 解析块(映射或序列),lines[idx] 的缩进必须等于 indent
function yamlParseBlock(lines, idx, ctx, indent) {
	const trimmed = lines[idx].slice(indent).trim();
	if (trimmed.startsWith('-')) {
		return yamlParseSeq(lines, idx, ctx, indent);
	}
	const kv = yamlSplitKeyValue(trimmed);
	if (kv === null) {
		// 纯标量文档
		return [yamlParseScalar(trimmed, ctx), idx + 1];
	}
	const obj = {};
	let i = idx;
	while (i < lines.length) {
		const l = lines[i];
		const ind = l.length - l.trimStart().length;
		if (ind < indent || ind > indent) break;
		const t = l.slice(ind).trim();
		if (t === '') {
			i++;
			continue;
		}
		if (t.startsWith('-')) break; // 同缩进序列属于父级
		const e = yamlSplitKeyValue(t);
		if (!e) {
			i++;
			continue;
		}
		const r = yamlResolveValue(lines, i + 1, ctx, ind, e.hasValue ? e.value : null);
		obj[e.key] = r.value;
		i = r.nextIndex;
	}
	return [obj, i];
}

// 解析序列(块状),lines[idx] 的缩进必须等于 indent
function yamlParseSeq(lines, idx, ctx, indent) {
	const arr = [];
	let i = idx;
	while (i < lines.length) {
		const l = lines[i];
		const ind = l.length - l.trimStart().length;
		if (ind !== indent) break;
		const t = l.slice(ind).trim();
		if (!t.startsWith('-')) break;
		const itemText = t.slice(1).trim();
		if (itemText === '') {
			// 空项: 内容在下一行(更深缩进)
			const next = lines[i + 1];
			if (next === undefined) {
				arr.push(null);
				i++;
				continue;
			}
			const nind = next.length - next.trimStart().length;
			if (nind > indent) {
				const [child, ni] = yamlParseBlock(lines, i + 1, ctx, nind);
				arr.push(child);
				i = ni;
			} else {
				arr.push(null);
				i++;
			}
			continue;
		}
		const kv = yamlSplitKeyValue(itemText);
		if (kv) {
			// 映射项: "- key: value",其余子键在更深行
			const obj = {};
			// 首键的 keyIndent 按子键所在缩进(indent + 2)计算
			const r = yamlResolveValue(lines, i + 1, ctx, indent + 2, kv.hasValue ? kv.value : null);
			obj[kv.key] = r.value;
			const j = yamlParseMapTail(lines, r.nextIndex, ctx, indent, obj);
			arr.push(obj);
			i = j;
			continue;
		}
		// 标量项
		arr.push(yamlParseScalar(itemText, ctx));
		i++;
	}
	return [arr, i];
}

// 解析单个 YAML 文档(容忍解析失败,返回 null)
function yamlParseSingle(text) {
	const lines = preprocessYamlLines(text);
	if (lines.length === 0) return null;
	const indent = lines[0].length - lines[0].trimStart().length;
	const [node] = yamlParseBlock(lines, 0, { anchors: {} }, indent);
	return node;
}

// 解析整个内容: 先按 --- 文档分隔符拆分,再按顶层key重复边界拆分(聚合配置),
// 返回所有解析成功的文档对象数组
function yamlParseAll(text) {
	const docs = [];
	const raw = String(text);
	// 1) 按 --- / ... 文档分隔符拆分
	const docParts = raw.split(/^---\s*$|^\.\.\.\s*$/m);
	for (const part of docParts) {
		if (!part.trim()) continue;
		// 2) 聚合配置: 顶层key重复即拆分(复用 splitClashDuplicated)
		for (const chunk of splitClashDuplicated(part)) {
			try {
				const node = yamlParseSingle(chunk);
				if (node !== null && node !== undefined) docs.push(node);
			} catch (e) {
				// 单个块解析失败忽略
			}
		}
	}
	return docs;
}

// 解析单个文档(返回第一个非空结果)
function yamlParse(text) {
	const docs = yamlParseAll(text);
	return docs.length > 0 ? docs[0] : null;
}

// ============================= YAML 序列化(生成 clash 配置) =============================

// 判断标量是否需要加单引号(保守策略: 拿不准就加,单引号永远合法)
function yamlQuoteScalar(s) {
	s = String(s);
	if (s === '') return "''";
	const lower = s.toLowerCase();
	const looksNumber = /^-?\d+(\.\d+)?$/.test(s);
	const reserved = ['true', 'false', 'yes', 'no', 'on', 'off', 'null', '~'];
	const needsQuote =
		looksNumber ||
		reserved.includes(lower) ||
		/^[\s\-?:,\[\]{}#&*!|>'"%@`\\]/.test(s) || // 起始字符特殊
		/[\s"'#,:\[\]{}&*!|>%@`\\]/.test(s); // 含空白或特殊字符
	if (!needsQuote) return s;
	return `'${s.replace(/'/g, "''")}'`;
}

// 键一般来自固定字段名;含特殊字符时加引号
function yamlQuoteKey(k) {
	k = String(k);
	if (/^[A-Za-z0-9_-]+$/.test(k)) return k;
	return `'${k.replace(/'/g, "''")}'`;
}

function yamlDumpValue(v) {
	if (v === null || v === undefined) return 'null';
	if (typeof v === 'number') return String(v);
	if (typeof v === 'boolean') return v ? 'true' : 'false';
	if (Array.isArray(v)) return '[' + v.map(yamlDumpValue).join(', ') + ']';
	return yamlQuoteScalar(v);
}

function yamlDumpEntry(lines, indent, key, value) {
	const pad = ' '.repeat(indent);
	if (value === null || value === undefined) {
		lines.push(`${pad}${yamlQuoteKey(key)}:`);
	} else if (Array.isArray(value)) {
		if (value.length === 0) {
			lines.push(`${pad}${yamlQuoteKey(key)}: []`);
		} else {
			lines.push(`${pad}${yamlQuoteKey(key)}:`);
			for (const item of value) {
				if (item && typeof item === 'object') {
					const entries = Object.entries(item);
					if (entries.length === 0) {
						lines.push(`${pad}  - {}`);
						continue;
					}
					// 第一项行内输出,其余子键继续缩进
					const [k0, v0] = entries[0];
					lines.push(`${pad}  - ${yamlQuoteKey(k0)}: ${yamlDumpValue(v0)}`);
					for (let i = 1; i < entries.length; i++) {
						yamlDumpEntry(lines, indent + 4, entries[i][0], entries[i][1]);
					}
				} else {
					lines.push(`${pad}  - ${yamlDumpValue(item)}`);
				}
			}
		}
	} else if (value && typeof value === 'object') {
		lines.push(`${pad}${yamlQuoteKey(key)}:`);
		for (const [k, v] of Object.entries(value)) {
			yamlDumpEntry(lines, indent + 2, k, v);
		}
	} else {
		lines.push(`${pad}${yamlQuoteKey(key)}: ${yamlDumpValue(value)}`);
	}
}

function yamlDump(obj) {
	const lines = [];
	for (const [key, value] of Object.entries(obj || {})) {
		yamlDumpEntry(lines, 0, key, value);
	}
	return lines.join('\n') + (lines.length > 0 ? '\n' : '');
}

// ----------------------------------------- 解析和构建 hysteria 节点 ---------------------------------------

function parse_hysteria(outbounds_n) {
	let server = findFieldValue(outbounds_n, 'server') || '';
	if (server.startsWith('127.0.0.1') || server === '') {
		return '';
	}
	let port = findFieldValue(outbounds_n, 'server_port') || findFieldValue(outbounds_n, 'port') || 443;
	// 只有当server未携带端口号时才拼接端口(兼容 "host:port" / "[ipv6]:port" 已带端口的情况)
	if (!hostAlreadyHasPort(server)) {
		if (server.includes(':') && !server.startsWith('[')) {
			server = `[${server}]`; // 裸IPv6地址需要加中括号
		}
		server = `${server}:${port}`;
	}

	let upmbps_str = findFieldValue(outbounds_n, 'up_mbps') || findFieldValue(outbounds_n, 'up');
	let downmbps_str = findFieldValue(outbounds_n, 'down_mbps') || findFieldValue(outbounds_n, 'down');
	// 提取字符串中的数字，然后转换为数字类型
	let upmbps = parseInt(String(upmbps_str).replace(/\D/g, ''), 10) || 0; // 上传速度
	let downmbps = parseInt(String(downmbps_str).replace(/\D/g, ''), 10) || 0; // 下载速度
	let obfsParam = findFieldValue(outbounds_n, 'obfs') || ''; // 混淆密码
	let auth = findFieldValue(outbounds_n, 'auth_str') || findFieldValue(outbounds_n, 'auth-str'); // 认证有效载荷
	let peer = findFieldValue(outbounds_n, 'server_name') || findFieldValue(outbounds_n, 'sni') || ''; // SNI

	let protocolValue = findFieldValue(outbounds_n, 'protocol');
	let protocol = protocolValue !== 'hysteria' ? protocolValue : '';

	let insecureFieldValue = findFieldValue(outbounds_n, 'insecure');
	let insecure = [null, true].includes(insecureFieldValue) ? 1 : '';

	let alpnValue = findFieldValue(outbounds_n, 'alpn');
	let alpn;
	if (typeof alpnValue === 'string') {
		alpn = alpnValue;
	} else if (Array.isArray(alpnValue) && alpnValue.length > 0) {
		alpn = alpnValue.length === 1 ? alpnValue[0].toString() : alpnValue.join(',');
	} else {
		alpn = '';
	}

	let hysteriaDict = {
		upmbps: upmbps,
		downmbps: downmbps,
		obfsParam: obfsParam,
		auth: auth,
		protocol: protocol,
		insecure: insecure,
		peer: peer,
		alpn: alpn,
	};
	// 过滤掉值为空的键值对
	const filteredParams = Object.fromEntries(
		Object.entries(hysteriaDict).filter(([key, value]) => value !== '' && value !== null && value !== undefined)
	);
	// 进行 URL 参数编码
	const encodedParams = new URLSearchParams(filteredParams).toString();

	return `hysteria://${server}?${encodedParams}#[hysteria]_${server}`;
}

// 判断server是否已经带有端口号("host:port" 或 "[ipv6]:port")
function hostAlreadyHasPort(server) {
	if (/^\[.*\]:\d+$/.test(server)) return true; // 已加中括号的IPv6且带端口
	const idx = server.lastIndexOf(':');
	// 恰好一个冒号且冒号后面是数字才认为是"host:port";多个冒号是裸IPv6,不算已带端口
	return idx >= 0 && server.indexOf(':') === idx && /^\d+$/.test(server.slice(idx + 1));
}

// ------------------------------------------ 解析和构建 hy2 节点 -------------------------------------------

function parse_hy2(outbounds_n) {
	let server = findFieldValue(outbounds_n, 'server') || '';
	if (server.startsWith('127.0.0.1') || server === '') {
		return '';
	}
	let port = findFieldValue(outbounds_n, 'server_port') || findFieldValue(outbounds_n, 'port') || 443;
	// 只有当server未携带端口号时才拼接端口。
	// "host:port" / "[ipv6]:port" 视为已带端口;裸IPv6地址(未加中括号)则补上中括号再拼端口
	if (!hostAlreadyHasPort(server)) {
		if (server.includes(':') && !server.startsWith('[')) {
			server = `[${server}]`; // 裸IPv6地址需要加中括号
		}
		server = `${server}:${port}`;
	}

	let password = findFieldValue(outbounds_n, 'password') || findFieldValue(outbounds_n, 'auth');
	let obfs = findFieldValue(outbounds_n, 'obfs') || '';
	let obfs_password = findFieldValue(outbounds_n, 'obfs-password') || '';
	// sing-box 的 obfs 是对象 {type, password}
	if (obfs && typeof obfs === 'object') {
		obfs_password = obfs.password || '';
		obfs = obfs.type || '';
	}
	let sni = findFieldValue(outbounds_n, 'sni') || findFieldValue(outbounds_n, 'server_name') || '';

	let up = findFieldValue(outbounds_n, 'up') || findFieldValue(outbounds_n, 'up_mbps') || '80';
	let down = findFieldValue(outbounds_n, 'down') || findFieldValue(outbounds_n, 'down_mbps') || '100';
	// 提取字符串中的数字，然后转换为数字类型
	let upmbps = parseInt(String(up).replace(/\D/g, ''), 10) || 0;
	let downmbps = parseInt(String(down).replace(/\D/g, ''), 10) || 0;

	let insecureFieldValue = findFieldValue(outbounds_n, 'insecure');
	let insecure = [null, true].includes(insecureFieldValue) ? 1 : '';

	let hy2Dict = {
		upmbps: upmbps,
		downmbps: downmbps,
		obfs: obfs,
		'obfs-password': obfs_password,
		sni: sni,
		insecure: insecure,
	};

	// 过滤掉值为空的键值对
	const filteredParams = Object.fromEntries(
		Object.entries(hy2Dict).filter(([key, value]) => value !== '' && value !== null && value !== undefined)
	);
	// 进行 URL 参数编码
	const encodedParams = new URLSearchParams(filteredParams).toString();

	// userinfo 做百分号编码,避免密码含 @ ? # : 等特殊字符时链接被解析错
	return `hy2://${encodeURIComponent(password || '')}@${server}?${encodedParams}#[hy2]_${server}`;
}

// ----------------------------------------- 解析和构建 vless 节点 ------------------------------------------

// 从配置中提取TLS状态。xray/clash 的 security/tls 是字符串或布尔值,
// sing-box 的 tls 是对象({enabled, reality, server_name, utls...})
// 返回 'reality' / 'tls' / ''
function resolveTlsSecurity(outbounds_n, publicKey) {
	if (publicKey) return 'reality';
	const raw = findFieldValue(outbounds_n.streamSettings, 'security') || findFieldValue(outbounds_n, 'tls') || '';
	if (raw && typeof raw === 'object') {
		// sing-box 风格
		if (raw.reality && raw.reality.enabled) return 'reality';
		return raw.enabled ? 'tls' : '';
	}
	if (raw === 'none' || raw === '' || raw === false) return '';
	if (raw === true || raw === 'tls') return 'tls';
	return '';
}

function parse_vle55(outbounds_n) {
	let address = findFieldValue(outbounds_n, 'address') || findFieldValue(outbounds_n, 'server') || '';
	if (address === '127.0.0.1' || address === '') {
		return '';
	}
	// sing-box 的端口字段是 server_port
	let port = findFieldValue(outbounds_n, 'port') || findFieldValue(outbounds_n, 'server_port');
	let uuid = findFieldValue(outbounds_n, 'id') || findFieldValue(outbounds_n, 'uuid');
	let encryption = findFieldValue(outbounds_n, 'encryption') || 'none'; // 加密方式
	let flow = findFieldValue(outbounds_n, 'flow') || '';
	// 传输协议(network):xray/clash 用 network 字段,sing-box 用 transport.type
	let network = findFieldValue(outbounds_n.transport, 'type') || findFieldValue(outbounds_n, 'network');
	if (typeof network !== 'string') network = '';
	let host = findFieldValue(outbounds_n, 'Host') || findFieldValue(outbounds_n, 'host') || '';
	let path =
		findFieldValue(outbounds_n, 'path') ||
		findFieldValue(outbounds_n, 'serviceName') ||
		findFieldValue(outbounds_n, 'service_name') ||
		'';
	// 目前发现publicKey和shortId是reality独有
	let public_key =
		findFieldValue(outbounds_n, 'public-key') ||
		findFieldValue(outbounds_n, 'publicKey') ||
		findFieldValue(outbounds_n, 'public_key') ||
		'';
	let short_id =
		findFieldValue(outbounds_n, 'short-id') ||
		findFieldValue(outbounds_n, 'shortId') ||
		findFieldValue(outbounds_n, 'short_id') ||
		'';
	// sni
	let serverName =
		findFieldValue(outbounds_n, 'serverName') ||
		findFieldValue(outbounds_n, 'servername') ||
		findFieldValue(outbounds_n, 'server_name') ||
		'';
	if (host === '' && serverName === '') {
		host = address;
	} else if (host === '' && serverName !== '') {
		host = serverName;
	}
	// 传输层安全(TLS)
	let tls_security = resolveTlsSecurity(outbounds_n, public_key);
	if (tls_security === '' && network === 'ws' && serverName !== '') {
		tls_security = 'tls';
	}
	let fp = findFieldValue(outbounds_n, 'fingerprint') || findFieldValue(outbounds_n, 'client-fingerprint') || '';
	let vle55Dict = {
		encryption: encryption, // 加密方式
		flow: flow,
		security: tls_security, // 传输层安全(TLS)
		sni: serverName,
		fp: fp,
		pbk: public_key,
		sid: short_id,
		type: network, // 传输协议(network)
		host: host, // 伪装域名(host)
		path: path,
		headerType: '', // 伪装类型(type)
	};

	// 过滤掉值为空的键值对
	const filteredParams = Object.fromEntries(
		Object.entries(vle55Dict).filter(([key, value]) => value !== '' && value !== null && value !== undefined)
	);
	// 进行 URL 参数编码
	const encodedParams = new URLSearchParams(filteredParams).toString();

	return `${base64Decode('dmxlc3M6Ly8')}${encodeURIComponent(uuid || '')}@${address}:${port}?${encodedParams}#[${base64Decode('dmxlc3M')}]_${address}:${port}`;
}

// ----------------------------------------- 解析和构建 vmess 节点 ------------------------------------------

function parse_vme55(outbounds_n) {
	let address = findFieldValue(outbounds_n, 'address') || findFieldValue(outbounds_n, 'server') || '';
	if (address === '127.0.0.1' || address === '') {
		return '';
	}
	// sing-box 的端口字段是 server_port
	let port = findFieldValue(outbounds_n, 'port') || findFieldValue(outbounds_n, 'server_port');
	let uuid = findFieldValue(outbounds_n, 'id') || findFieldValue(outbounds_n, 'uuid');
	let alterId = findFieldValue(outbounds_n, 'alterId') || findFieldValue(outbounds_n, 'alter_id') || 0;

	// 加密方式(security)
	let auto_security = findFieldValue(outbounds_n, 'cipher') || findFieldValue(outbounds_n.settings, 'security') || 'auto';

	// 传输协议(network):xray/clash 用 network 字段,sing-box 用 transport.type
	let network = findFieldValue(outbounds_n.transport, 'type') || findFieldValue(outbounds_n, 'network');
	if (typeof network !== 'string') network = '';
	// 伪装类型(type)
	let type_encryption = findFieldValue(outbounds_n, 'encryption') || 'none';

	// 传输层安全(TLS)
	let tls_security = resolveTlsSecurity(outbounds_n, '');

	let path =
		findFieldValue(outbounds_n, 'path') ||
		findFieldValue(outbounds_n, 'ws-path') ||
		findFieldValue(outbounds_n, 'grpc-service-name') ||
		findFieldValue(outbounds_n, 'serviceName') ||
		findFieldValue(outbounds_n, 'service_name') ||
		'/';
	// 伪装域名(host)
	let host = findFieldValue(outbounds_n, 'Host') || findFieldValue(outbounds_n, 'host') || '';
	let serverName =
		findFieldValue(outbounds_n, 'sni') ||
		findFieldValue(outbounds_n, 'serverName') ||
		findFieldValue(outbounds_n, 'server_name') ||
		'';
	if (serverName === '' && host === '') {
		host = address;
	}
	let fp = findFieldValue(outbounds_n, 'client-fingerprint') || findFieldValue(outbounds_n, 'fingerprint') || '';
	let vme55Dict = {
		v: '2',
		ps: `[${base64Decode('dm1lc3M')}]_${address}:${port}`,
		add: address,
		port: port,
		id: uuid,
		aid: alterId, // 额外ID(alterId)
		scy: auto_security, // 加密方式(security)
		net: network, // 传输协议(network)
		type: type_encryption, // 伪装类型(type)
		host: host, // 伪装域名(host)
		path: path, // 路径
		tls: tls_security, // 传输层安全(TLS)
		sni: serverName,
		alpn: '',
		fp: fp,
	};
	// 将对象转换为 JSON 字符串（方便后面进行base64编码）
	const jsonString = JSON.stringify(vme55Dict);

	const base64EncodedString = base64Encode(jsonString);

	return `${base64Decode('dm1lc3M6Ly8')}${base64EncodedString}`;
}

// -------------------------------------- 解析和构建 shadowsocks 节点 ---------------------------------------

function parse_shadowsocks(outbounds_n) {
	let address = findFieldValue(outbounds_n, 'address') || findFieldValue(outbounds_n, 'server') || '';
	if (address === '127.0.0.1' || address === '') {
		return '';
	}

	// sing-box 的端口字段是 server_port
	let port = findFieldValue(outbounds_n, 'port') || findFieldValue(outbounds_n, 'server_port');
	let method = findFieldValue(outbounds_n, 'method') || findFieldValue(outbounds_n, 'cipher');
	let password = findFieldValue(outbounds_n, 'password');
	// SIP002 插件参数(可选):clash 用 plugin/plugin-opts,xray 用 plugin/pluginOpts
	let plugin = findFieldValue(outbounds_n, 'plugin') || '';
	let plugin_opts =
		findFieldValue(outbounds_n, 'plugin-opts') ||
		findFieldValue(outbounds_n, 'plugin_opts') ||
		findFieldValue(outbounds_n, 'pluginOpts') ||
		'';
	let pluginParam = '';
	if (plugin) {
		pluginParam = plugin_opts ? `${plugin};${plugin_opts}` : plugin;
	}
	let method_with_password = `${method}:${password}`;
	let base64EncodedString = base64Encode(method_with_password);
	const query = pluginParam ? `?plugin=${encodeURIComponent(pluginParam)}` : '';

	return `${base64Decode('c3M6Ly8')}${base64EncodedString}@${address}:${port}${query}#[ss]_${address}`;
}

// ----------------------------------------- 解析和构建 trojan 节点 -----------------------------------------

function parse_tr0jan(outbounds_n) {
	let server = findFieldValue(outbounds_n, 'server') || '';
	if (server.startsWith('127.0.0.1') || server === '') {
		return '';
	}
	// sing-box 的端口字段是 server_port
	let port = findFieldValue(outbounds_n, 'port') || findFieldValue(outbounds_n, 'server_port');
	let password = findFieldValue(outbounds_n, 'password');
	// 传输协议(network):xray/clash 用 network 字段,sing-box 用 transport.type
	let network = findFieldValue(outbounds_n.transport, 'type') || findFieldValue(outbounds_n, 'network') || 'tcp';
	if (typeof network !== 'string') network = 'tcp';
	let path =
		findFieldValue(outbounds_n, 'path') ||
		findFieldValue(outbounds_n, 'serviceName') ||
		findFieldValue(outbounds_n, 'service_name') ||
		'';
	let host = findFieldValue(outbounds_n, 'Host') || findFieldValue(outbounds_n, 'host') || '';
	let sni = findFieldValue(outbounds_n, 'sni') || findFieldValue(outbounds_n, 'server_name') || '';
	let fp = findFieldValue(outbounds_n, 'client-fingerprint') || findFieldValue(outbounds_n, 'fingerprint') || '';
	let alpn = findFieldValue(outbounds_n, 'alpn') || ''; // 没有确定字段是否这个名字
	let tls_security = resolveTlsSecurity(outbounds_n, '');
	if (sni) {
		tls_security = 'tls';
	}

	let tr0janDict = {
		security: tls_security,
		allowInsecure: 1,
		sni: sni,
		fp: fp,
		type: network,
		host: host,
		alpn: alpn,
		path: path,
	};

	// 过滤掉值为空的键值对
	const filteredParams = Object.fromEntries(
		Object.entries(tr0janDict).filter(([key, value]) => value !== '' && value !== null && value !== undefined)
	);
	// 进行 URL 参数编码
	const encodedParams = new URLSearchParams(filteredParams).toString();

	// userinfo 做百分号编码,避免密码含特殊字符时链接被解析错
	return `${base64Decode('dHJvamFuOi8v')}${encodeURIComponent(password || '')}@${server}:${port}?${encodedParams}#[${base64Decode('dHJvamFu')}]_${server}`;
}

// ------------------------------------------ 解析和构建 tuic 节点 ------------------------------------------

function parse_tuic(outbounds_n) {
	let uuid = findFieldValue(outbounds_n, 'uuid') || '';
	let password = findFieldValue(outbounds_n, 'password') || '';
	let server = findFieldValue(outbounds_n, 'server') || '';
	if (server === '127.0.0.1' || server === '' || uuid === '' || password === '') {
		return '';
	}
	// sing-box 的端口字段是 server_port
	let port = findFieldValue(outbounds_n, 'port') || findFieldValue(outbounds_n, 'server_port');
	let congestion_controller =
		findFieldValue(outbounds_n, 'congestion-controller') || findFieldValue(outbounds_n, 'congestion_control');
	let udp_relay_mode = findFieldValue(outbounds_n, 'udp-relay-mode') || findFieldValue(outbounds_n, 'udp_relay_mode');
	let sni = findFieldValue(outbounds_n, 'sni') || findFieldValue(outbounds_n, 'server_name') || '';
	let alpnValue = findFieldValue(outbounds_n, 'alpn');
	var alpn;
	if (Array.isArray(alpnValue) && alpnValue.length === 1) {
		// 如果数组只有一个元素，直接获取该元素
		alpn = alpnValue[0].toString();
	} else if (Array.isArray(alpnValue) && alpnValue.length > 1) {
		// 如果数组有多个元素，使用逗号连接
		alpn = alpnValue.join(',');
	} else {
		alpn = '';
	}
	let tuicDict = {
		congestion_control: congestion_controller,
		udp_relay_mode: udp_relay_mode,
		alpn: alpn,
		sni: sni,
		allow_insecure: 1,
	};
	// 过滤掉值为空的键值对
	const filteredParams = Object.fromEntries(
		Object.entries(tuicDict).filter(([key, value]) => value !== '' && value !== null && value !== undefined)
	);
	// 进行 URL 参数编码
	const encodedParams = new URLSearchParams(filteredParams).toString();

	// userinfo 做百分号编码,避免 uuid/密码含特殊字符时链接被解析错
	return `tuic://${encodeURIComponent(uuid)}:${encodeURIComponent(password)}@${server}:${port}?${encodedParams}#[tuic]_${server}`;
}

// ------------------------------------- 判断是否为mieru或juicity的代理 -------------------------------------

function isJuicity(jsonObject) {
	let juicity_listen = findFieldValue(jsonObject, 'listen');
	let juicity_server = findFieldValue(jsonObject, 'server');
	let juicity_uuid = findFieldValue(jsonObject, 'uuid');
	let juicity_password = findFieldValue(jsonObject, 'password');
	let juicity_sni = findFieldValue(jsonObject, 'sni');
	let juicity_allow_insecure = findFieldValue(jsonObject, 'allow_insecure');
	let juicity_congestion_control = findFieldValue(jsonObject, 'congestion_control');

	if (
		juicity_listen &&
		juicity_server &&
		juicity_uuid &&
		juicity_password &&
		juicity_sni &&
		juicity_allow_insecure &&
		juicity_congestion_control
	) {
		return true;
	} else {
		return false;
	}
}

function isMieru(jsonObject) {
	let mieru_exist_profiles = Array.isArray(findFieldValue(jsonObject, 'profiles'));
	let mieru_exist_portBindings = Array.isArray(findFieldValue(jsonObject, 'portBindings'));
	let mieru_ipAddress = findFieldValue(jsonObject, 'ipAddress');
	let mieru_rpcPort = findFieldValue(jsonObject, 'rpcPort');
	let mieru_activeProfile = findFieldValue(jsonObject, 'activeProfile');
	if (mieru_exist_profiles && mieru_exist_portBindings && mieru_ipAddress && mieru_rpcPort && mieru_activeProfile) {
		return true;
	} else {
		return false;
	}
}

// ------------------------------------------- 递归查找字段对应的值 ------------------------------------------

function findFieldValue(obj, targetField) {
	for (const key in obj) {
		if (obj.hasOwnProperty(key)) {
			if (key === targetField) {
				return obj[key];
			} else if (typeof obj[key] === 'object') {
				const result = findFieldValue(obj[key], targetField);
				if (result != undefined) {
					return result;
				}
			}
		}
	}
	return null; // 如果未找到字段，返回null
}

// ------------------------------------------- 抓取网页内容的函数 -------------------------------------------

async function fetchWebPageContent(url) {
	try {
		// 发送请求(8秒超时,防止个别源站挂起拖垮整个worker,免费版单次请求墙钟时间只有30秒)
		let response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'follow' });

		if (!response.ok) {
			throw new Error(`获取失败: ${response.status}`);
		}

		// 读取并返回文本内容，同时替换可能出现的"!<str>"字符
		let content = (await response.text()).replace(/!<str>/g, '');

		// 仅当内容明显是HTML时才去掉标签,避免误伤json/yaml/base64订阅数据中可能出现的<>字符
		if (/<[a-z][^>]*>/i.test(content)) {
			content = stripHtmlTags(content);
		}
		return content;
	} catch (error) {
		console.error(`获取${url} 网页内容失败: ${error.message}`);
		return '';
	}
}

// 删除网页内容中多余的HTML标签
function stripHtmlTags(str) {
	const entities = {
		'&lt;': '<',
		'&gt;': '>',
		// .....
	};
	// 动态生成正则表达式，匹配所有实体
	const regex = new RegExp(
		'&(' +
			Object.keys(entities)
				.map((e) => e.slice(1, -1))
				.join('|') +
			');',
		'g'
	);
	// 替换HTML实体
	let replaced = str.replace(regex, (match) => entities[match]);
	// 去掉HTML标签
	return replaced.replace(/<[^>]*>/g, '');
}

// 拆分拼接在一起的clash聚合配置:顶层key重复出现的位置就是下一份配置的起点
function splitClashDuplicated(content) {
	const lines = content.split(/\r?\n/);
	const chunks = [];
	let current = [];
	const seen = new Set();
	for (const line of lines) {
		const match = line.match(/^([A-Za-z0-9_-]+):\s*/);
		if (match && seen.has(match[1])) {
			chunks.push(current.join('\n'));
			current = [];
			seen.clear();
		}
		if (match) {
			seen.add(match[1]);
		}
		current.push(line);
	}
	if (current.length > 0) {
		chunks.push(current.join('\n'));
	}
	return chunks;
}

// 判断分享链接是否为坏链接(源订阅自带占位符值: =undefined / :null / null@ / [object Object])
function isBrokenLink(link) {
	return (
		link.includes('=undefined') ||
		link.includes(':null') ||
		link.includes('null@') ||
		link.includes('[object')
	);
}

// ---------------------------------- 去抓取网页、处理节点，返回节点的分享链接 ----------------------------------

async function fetchAndProcessUrl(url) {
	const content = await fetchWebPageContent(url);
	let jsonObject;
	let outbounds; // 可能是字段outbounds值的列表，也可能是字段proxies值的列表
	try {
		jsonObject = JSON.parse(content);
		outbounds = findFieldValue(jsonObject, 'outbounds');
	} catch (e) {
		let links = v2rayLinksHandle(content);
		if (links.length > 0) {
			// 存储多个节点链接
			const uniqueSet = new Set();
			// let proxyPrefix = ['hysteria://', 'hy2://', 'vless://', 'vmess://', 'trojan://', 'ss://', 'tuic://', 'naive+https://'];
			let proxyPrefix = [
				'aHlzdGVyaWE6Ly8',
				'aHkyOi8v',
				'dmxlc3M6Ly8',
				'dm1lc3M6Ly8',
				'dHJvamFuOi8v',
				'c3M6Ly8',
				'dHVpYzovLw',
				'bmFpdmUraHR0cHM6Ly8',
			];
			links.split('\n').forEach((link) => {
				// 过滤源订阅自带的坏链接(如 obfsParam=undefined / host:null),这类链接任何客户端都无法使用
				if (isBrokenLink(link)) return;
				if (proxyPrefix.some((prefix) => link.startsWith(base64Decode(prefix)))) uniqueSet.add(link);
			});
			// 转换为数组
			const uniqueArray = Array.from(uniqueSet);
			return uniqueArray;
		} else {
			// 解析yaml(零第三方依赖的自研解析器):
			// 兼容 --- 多文档与顶层key重复的聚合配置(拆分后合并proxies节点)
			const yamlObjects = yamlParseAll(content);
			let mergedProxies = [];
			for (const obj of yamlObjects) {
				if (obj && typeof obj === 'object') {
					const ps = findFieldValue(obj, 'proxies');
					if (Array.isArray(ps)) {
						mergedProxies.push(...ps);
					}
				}
			}
			if (mergedProxies.length > 0) {
				outbounds = mergedProxies;
			}
		}
	}

	if (outbounds === null && jsonObject) {
		/** 处理一个节点 */

		// mieru
		let is_mieru = isMieru(jsonObject);
		if (is_mieru) return ''; // 丢弃

		// juicity
		let is_juicity = isJuicity(jsonObject);
		if (is_juicity) return ''; // 丢弃

		// hy2
		let server = findFieldValue(jsonObject, 'server')?.replace(/,.*$/, '') || ''; // 如果字符串中含有逗号，就删除逗号及其后面的字符
		let pwd_auth = findFieldValue(jsonObject, 'auth');
		let sni = findFieldValue(jsonObject, 'sni');

		let insecureFieldValue = findFieldValue(jsonObject, 'insecure');
		let insecure = [null, true].includes(insecureFieldValue) ? 1 : '';

		// hy1
		let upmbps = findFieldValue(jsonObject, 'up_mbps');
		let downmbps = findFieldValue(jsonObject, 'down_mbps');
		let obfsParam = findFieldValue(jsonObject, 'obfs') || '';
		let auth = findFieldValue(jsonObject, 'auth_str') || '';
		let protocol = findFieldValue(jsonObject, 'protocol') || '';
		let peer = findFieldValue(jsonObject, 'server_name') || '';
		let alpn = findFieldValue(jsonObject, 'alpn');
		let recv_window = findFieldValue(jsonObject, 'recv_window') || '';
		let recv_window_conn = findFieldValue(jsonObject, 'recv_window_conn') || '';

		// naive
		let proxyFieldValue = findFieldValue(jsonObject, 'proxy');

		// 使用正则表达式进行匹配naive配置文件中proxy中的值
		const pattern = /^https:\/\/.*@.*$/;
		const isMatch = pattern.test(proxyFieldValue);

		if (server && pwd_auth) {
			// 判断是hy2

			// 只有当server未携带端口号时才拼接默认端口443
			if (!hostAlreadyHasPort(server)) {
				if (server.includes(':') && !server.startsWith('[')) {
					server = `[${server}]`; // 裸IPv6地址需要加中括号
				}
				server = `${server}:443`;
			}
			// 用URLSearchParams拼接参数,避免出现 insecure= / sni=null 之类的空参数
			const hy2Params = new URLSearchParams();
			if (insecure === 1) hy2Params.set('insecure', '1');
			if (sni) hy2Params.set('sni', sni);
			const hy2Query = hy2Params.toString();

			return `hy2://${encodeURIComponent(pwd_auth)}@${server}${hy2Query ? '?' + hy2Query : ''}#[hy2]_${server}`;
		} else if (server && auth && alpn && upmbps !== null && downmbps !== null) {
			// 判断是hy1

			// 只有当server未携带端口号时才拼接默认端口443
			if (!hostAlreadyHasPort(server)) {
				if (server.includes(':') && !server.startsWith('[')) {
					server = `[${server}]`; // 裸IPv6地址需要加中括号
				}
				server = `${server}:443`;
			}

			let hysteriaDict = {
				upmbps: upmbps,
				downmbps: downmbps,
				obfs: 'xplus',
				obfsParam: obfsParam,
				auth: auth,
				protocol: protocol,
				insecure: insecure,
				peer: peer,
				alpn: alpn,
				recv_window: recv_window,
				recv_window_conn: recv_window_conn,
			};
			// 没有对应的值，就从hysteriaDict中删除
			if (hysteriaDict['obfsParam'] === '') {
				delete hysteriaDict['obfs'];
			}
			// 过滤掉值为空的键值对
			const filteredParams = Object.fromEntries(
				Object.entries(hysteriaDict).filter(([key, value]) => value !== '' && value !== null && value !== undefined)
			);
			// 进行 URL 参数编码
			const encodedParams = new URLSearchParams(filteredParams).toString();

			// hy1的节点链接
			return `${base64Decode('aHlzdGVyaWE6Ly8')}${server}?${encodedParams}#[hysteria]_${server}`;
		} else if (proxyFieldValue && isMatch && typeof proxyFieldValue === 'string') {
			// 判断是naive

			// 从右侧找到 ":" 和 "@" 的索引
			const colonIndex = proxyFieldValue.lastIndexOf(':');
			const atIndex = proxyFieldValue.lastIndexOf('@');
			// 截取 "@" 后到 ":" 之间的内容
			const extractedContent = proxyFieldValue.substring(atIndex + 1, colonIndex);

			return `naive+${proxyFieldValue}#[naive]_${extractedContent}`;
		}
	} else if (outbounds && Array.isArray(outbounds)) {
		/** 处理多个节点 */

		// 存储多个节点链接
		const uniqueSet = new Set();

			let allProxyType = ['hysteria', 'hy2', 'vless', 'vmess', 'trojan', 'ss', 'tuic'];
			// 遍历数组中的节点
		for (var i = 0; i < outbounds.length; i++) {
			let proxyType = findFieldValue(outbounds[i], 'protocol');
			if (!allProxyType.includes(proxyType)) {
				proxyType = findFieldValue(outbounds[i], 'type');
			}
			// 检查到是hysteria类型的节点
			if (proxyType === base64Decode('aHlzdGVyaWE')) {
				let hy1 = parse_hysteria(outbounds[i]);
				if (hy1 && !isBrokenLink(hy1)) {
					uniqueSet.add(hy1);
				}
				// 检查到是hy2类型的节点(clash中该类型名为hysteria2,也要兼容)
			} else if (proxyType === base64Decode('aHky') || proxyType === 'hysteria2') {
				let hy2 = parse_hy2(outbounds[i]);
				if (hy2 && !isBrokenLink(hy2)) {
					uniqueSet.add(hy2);
				}
				// 检查到是shadowsocks类型的节点
			} else if (proxyType === base64Decode('c3M')) {
				let ss = parse_shadowsocks(outbounds[i]);
				if (ss && !isBrokenLink(ss)) {
					uniqueSet.add(ss);
				}
				// 检查到是vless类型的节点
			} else if (proxyType === base64Decode('dmxlc3M')) {
				let vle55 = parse_vle55(outbounds[i]);
				if (vle55 && !isBrokenLink(vle55)) {
					uniqueSet.add(vle55);
				}
				// 检查到是vmess类型的节点
			} else if (proxyType === base64Decode('dm1lc3M')) {
				let vme55 = parse_vme55(outbounds[i]);
				if (vme55 && !isBrokenLink(vme55)) {
					uniqueSet.add(vme55);
				}
				// 检查到是trojan类型的节点
			} else if (proxyType === base64Decode('dHJvamFu')) {
				let tr0jan = parse_tr0jan(outbounds[i]);
				if (tr0jan && !isBrokenLink(tr0jan)) {
					uniqueSet.add(tr0jan);
				}
				// 检查到是tuic类型的节点
			} else if (proxyType === base64Decode('dHVpYw')) {
				let tuic = parse_tuic(outbounds[i]);
				if (tuic && !isBrokenLink(tuic)) {
					uniqueSet.add(tuic);
				}
			}
		}
		// 转换为数组
		const uniqueArray = Array.from(uniqueSet);

		return uniqueArray;
	}
}

// ----------------------------------------- base64编码与base64解码 ------------------------------------------
// base64编码
function base64Encode(str) {
	const encoder = new TextEncoder();
	const uint8Array = encoder.encode(str);
	const chunkSize = 0x8000; // 每个块的大小 (32768)
	let binary = '';

	// 分块处理，避免一次性展开整个数组导致调用栈溢出
	for (let i = 0; i < uint8Array.length; i += chunkSize) {
		const chunk = uint8Array.subarray(i, i + chunkSize);
		// 使用 Function.prototype.apply 将小块转换为字符串
		binary += String.fromCharCode.apply(null, chunk);
	}

	return btoa(binary);
}

// base64解码
function base64Decode(base64Str) {
	let binary = atob(base64Str);
	let bytes = new Uint8Array([...binary].map((char) => char.charCodeAt(0)));
	let decoder = new TextDecoder();
	return decoder.decode(bytes);
}

// 兼容 base64url(- _)与缺失填充(=)的写法,统一转换为标准base64
function normalizeBase64(str) {
	const noPad = str.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
	return noPad + '='.repeat((4 - (noPad.length % 4)) % 4);
}

// 判断是否是有效的Base64编码字符串
function isValidBase64(str) {
	if (typeof str !== 'string') return false;

	str = str.trim();
	if (str === '') return false;

	// 兼容多行base64订阅:去除所有空白字符后再校验
	const cleaned = str.replace(/\s+/g, '');

	// 兼容 base64url(- _)与缺失填充(=)的写法
	const normalized = normalizeBase64(cleaned);

	// Base64正则匹配规则，确保格式正确
	const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
	if (!base64Regex.test(normalized)) return false;

	try {
		// 尝试解码，确保不会报错
		const binaryStr = atob(normalized);
		new Uint8Array([...binaryStr].map((c) => c.charCodeAt(0)));
		return true;
	} catch (e) {
		return false;
	}
}

// ------------------------------- 抓取的网页内容是否为v2ray/nekoray分享链接？ -------------------------------

function v2rayLinksHandle(str) {
	let isBase64Str = isValidBase64(str);

	// let proxyPrefix = ['hysteria://', 'hy2://', 'vless://', 'vmess://', 'trojan://', 'ss://', 'tuic://', 'naive+https://'];
	let proxyPrefix = [
		'aHlzdGVyaWE6Ly8',
		'aHkyOi8v',
		'dmxlc3M6Ly8',
		'dm1lc3M6Ly8',
		'dHJvamFuOi8v',
		'c3M6Ly8',
		'dHVpYzovLw',
		'bmFpdmUraHR0cHM6Ly8',
	];
	// 粗略判断是否为明文分享链接，是则原字符串返回
	if (typeof str === 'string' && !isBase64Str && proxyPrefix.some((prefix) => str.includes(base64Decode(prefix)))) {
		return str;
	} else if (!isBase64Str) {
		return ''; // 不是有效的 Base64，直接返回空字符串
	}

	try {
		// 兼容 base64url 与缺失填充的写法
		return base64Decode(normalizeBase64(str.replace(/\s+/g, '')));
	} catch (e) {
		return ''; // 如果解码失败，也返回空字符串
	}
}

// -------------------------------------------- 要抓取的网页链接 --------------------------------------------

/**
 * 要抓取的网页，目标urls集，顺序随意，json、yaml、v2ray明文/base64加密的订阅数据都可以
 * 订阅地址的链接不能太多，容易出现"Error: Too many subrequests"错误，
 * 免费计划：每个 Worker 最多 50 个子请求（包括 fetch() 请求）
 * 付费计划：最多 1000 个子请求
 *
 * https://github.com/juerson/subscription_helper
 * 使用这个工具可以对订阅链接的内容比较，找出内容互不相同的链接，内容相同就选择其中的一个链接
 */
const targetUrls = [
	// ChromeGo/EdgeGo的订阅链接(重新加入fastly.jsdelivr.net等镜像,与gitlabip.xyz/gitlab.com互为备用)
	'https://chg64.makou.cc.cd',
	'https://chg26.makou.cc.cd',
	'https://raw.githubusercontent.com/ttanzj/chromego_py/main/outputs/sub_base64.txt',
	'https://raw.githubusercontent.com/Pawdroid/Free-servers/main/sub',
	// AutoMergePublicNodes / NoMoreWalls 的多个CDN镜像(内容相同,互为备用)
	'https://cdn.jsdelivr.net/gh/chengaopan/AutoMergePublicNodes@master/list.meta.yml',
	'https://cdn.jsdelivr.net/gh/peasoft/NoMoreWalls@master/list.meta.yml',
	'https://fastly.jsdelivr.net/gh/chengaopan/AutoMergePublicNodes@master/list.meta.yml',
	'https://fastly.jsdelivr.net/gh/peasoft/NoMoreWalls@master/list.meta.yml',
	'https://gcore.jsdelivr.net/gh/peasoft/NoMoreWalls@master/list.meta.yml',
	// ghproxy.cn 已失效(返回HTML拦截页),已移除;ghproxy.net 仍可用
	'https://ghproxy.net/https://raw.githubusercontent.com/peasoft/NoMoreWalls/master/list.meta.yml',
	'https://raw.githubusercontent.com/chengaopan/AutoMergePublicNodes/master/list.meta.yml',
	'https://raw.githubusercontent.com/peasoft/NoMoreWalls/master/list.meta.yml',
	'https://testingcf.jsdelivr.net/gh/peasoft/NoMoreWalls@master/list.meta.yml',
	// gitlabip.xyz / gitlab.com 的 ChromeGo/EdgeGo 订阅链接
	'https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/naiveproxy/2/config.json',
	'https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/hysteria2/2/config.json',
	'https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/hysteria2/3/config.json',
	'https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/naiveproxy/1/config.json',
	'https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/xray/2/config.json',
	'https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/xray/4/config.json',
	'https://gitlab.com/free9999/ipupdate/-/raw/master/backup/img/1/2/ip/singbox/2/config.json',
	'https://gitlab.com/free9999/ipupdate/-/raw/master/backup/img/1/2/ipp/singbox/1/config.json',
	'https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/hysteria/2/config.json',
	'https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/hysteria/3/config.json',
	'https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/hysteria/1/config.json',
	'https://gitlab.com/free9999/ipupdate/-/raw/master/backup/img/1/2/ipp/hysteria/3/config.json',
	'https://gitlab.com/free9999/ipupdate/-/raw/master/backup/img/1/2/ip/singbox/config.json',
	'https://gitlab.com/free9999/ipupdate/-/raw/master/hysteria/2/config.json',
	'https://gitlab.com/free9999/ipupdate/-/raw/master/hysteria2/2/config.json',
	'https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/clash.meta2/5/config.yaml',
	'https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/clash.meta2/4/config.yaml',
	'https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/clash.meta2/1/config.yaml',
	'https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ip/clash.meta2/1/config.yaml',
	'https://www.gitlabip.xyz/Alvin9999/pac2/master/quick/config.yaml',
	'https://www.gitlabip.xyz/Alvin9999/pac2/master/quick/4/config.yaml',
	// 也可以添加其它来源且数据格式为json或yaml的订阅链接
	// 可以添加明文v2ray分享链接的订阅或base64订阅链接
	'https://ghfast.top/https://raw.githubusercontent.com/free18/v2ray/refs/heads/main/v.txt',
];

// --------------------------------------- 操作targetUrls和构建节点的入口 ------------------------------------

async function processUrls(targetUrls) {
	const results = [];
	// 最大并发数(8以内安全,避免触发Too many subrequests错误)
	const maxConcurrency = 8;
	// 辅助函数，限制并发执行的异步任务数量
	const asyncPool = async (poolLimit, array, iteratorFn) => {
		const results = [];
		const executing = [];

		for (const item of array) {
			const promise = Promise.resolve().then(() => iteratorFn(item));
			results.push(promise);
			if (executing.length < poolLimit) {
				const executingPromise = promise.then(() => executing.splice(executing.indexOf(executingPromise), 1));
				executing.push(executingPromise);
			} else {
				await Promise.race(executing);
			}
		}
		return Promise.all(results);
	};

	// 使用asyncPool并发执行异步任务
	await asyncPool(maxConcurrency, targetUrls, async (url) => {
		try {
			const link = await fetchAndProcessUrl(url);
			if (Array.isArray(link)) {
				// 剔除重复的link节点链接
				link.forEach((item) => {
					if (!results.includes(item)) {
						results.push(item);
					}
				});
			} else if (link && !results.includes(link)) {
				// 直接将link节点链接放入results数组中
				results.push(link);
			}
		} catch (error) {
			// 单个链接处理失败(解析崩溃等)不影响其它链接，保证整个worker正常返回
			console.error(`处理${url} 失败: ${error.message}`);
		}
	});

	// 返回结果数组
	return results;
}

// ----------------------------------- 分享链接解析为统一结构的节点对象 -----------------------------------

// 安全解码URL编码内容(失败时返回原文)
function safeDecode(str) {
	try {
		return decodeURIComponent(str);
	} catch (e) {
		return str;
	}
}

// 拆分分享链接为 [host:port部分, 查询参数, 节点名]
function splitShareLink(link) {
	const hashIndex = link.indexOf('#');
	const fragment = hashIndex >= 0 ? safeDecode(link.slice(hashIndex + 1)) : '';
	const beforeHash = hashIndex >= 0 ? link.slice(0, hashIndex) : link;
	const queryIndex = beforeHash.indexOf('?');
	const params = new URLSearchParams(queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '');
	const base = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
	return { base, params, fragment };
}

// 拆分 host:port,兼容 IPv6 地址
function splitHostPort(str, defaultPort) {
	str = str || '';
	if (str.startsWith('[')) {
		const end = str.indexOf(']');
		if (end >= 0) {
			const host = str.slice(1, end);
			const rest = str.slice(end + 1);
			const port = rest.startsWith(':') ? rest.slice(1) : '';
			return { host, port: port ? parseInt(port, 10) : defaultPort };
		}
	}
	const idx = str.lastIndexOf(':');
	if (idx >= 0) {
		return { host: str.slice(0, idx), port: parseInt(str.slice(idx + 1), 10) || defaultPort };
	}
	return { host: str, port: defaultPort };
}

// 将 vmess 的 JSON 对象转换为统一的节点对象
function vmessNodeFromJson(j) {
	const name = j.ps || `${j.add}:${j.port}`;
	return {
		type: 'vmess',
		name: name,
		server: j.add,
		port: parseInt(j.port, 10) || 443,
		uuid: j.id,
		alterId: parseInt(j.aid, 10) || 0,
		cipher: j.scy || 'auto',
		network: j.net || 'tcp',
		headerType: j.type || 'none',
		host: j.host || '',
		path: j.path || '/',
		tls: j.tls === 'tls' || j.tls === true,
		sni: j.sni || '',
		alpn: j.alpn || '',
		fp: j.fp || '',
	};
}

// 解析一条分享链接(vless/vmess/trojan/ss/hysteria/hy2/tuic/naive)为统一结构的节点对象
function parseShareLink(link) {
	link = String(link).trim(); // 去掉可能残留的 \r / 首尾空白
	let type = '';
	if (link.startsWith('vless://')) type = 'vless';
	else if (link.startsWith('vmess://')) type = 'vmess';
	else if (link.startsWith('trojan://')) type = 'trojan';
	else if (link.startsWith('ss://')) type = 'ss';
	else if (link.startsWith('hysteria://')) type = 'hysteria';
	else if (link.startsWith('hy2://')) type = 'hy2';
	else if (link.startsWith('tuic://')) type = 'tuic';
	else if (link.startsWith('naive+https://')) type = 'naive';
	if (!type) return null;

	try {
		const scheme = type === 'naive' ? 'naive+https://' : `${type}://`;
		const { base, params, fragment } = splitShareLink(link);
		const rest = base.slice(scheme.length);
		const atIndex = rest.lastIndexOf('@');
		// 注意: 没有@时(如旧版vmess://base64json)整个rest都是userinfo,不能截掉最后一个字符
		const userinfo = atIndex >= 0 ? rest.slice(0, atIndex) : rest;
		const hostPort = atIndex >= 0 ? rest.slice(atIndex + 1) : rest;

		// vless
		if (type === 'vless') {
			const { host, port } = splitHostPort(hostPort, 443);
			return {
				type,
				name: fragment || `${host}:${port}`,
				server: host,
				port,
				uuid: safeDecode(userinfo),
				flow: params.get('flow') || '',
				security: params.get('security') || '',
				sni: params.get('sni') || '',
				fp: params.get('fp') || '',
				pbk: params.get('pbk') || '',
				sid: params.get('sid') || '',
				network: params.get('type') || 'tcp',
				host: params.get('host') || '',
				path: params.get('path') || '',
				alpn: params.get('alpn') || '',
			};
		}

		// vmess(新格式 vmess://uuid@host:port?params 或 旧格式 vmess://base64json)
		if (type === 'vmess') {
			if (atIndex >= 0) {
				const { host, port } = splitHostPort(hostPort, 443);
				return vmessNodeFromJson({
					ps: fragment || `${host}:${port}`,
					add: host,
					port: port,
					id: safeDecode(userinfo),
					aid: params.get('aid') || 0,
					scy: params.get('scy') || 'auto',
					net: params.get('type') || 'tcp',
					type: params.get('headerType') || 'none',
					host: params.get('host') || '',
					path: params.get('path') || '/',
					tls: params.get('security') === 'tls' ? 'tls' : '',
					sni: params.get('sni') || '',
					alpn: params.get('alpn') || '',
					fp: params.get('fp') || '',
				});
			}
			try {
				return vmessNodeFromJson(JSON.parse(base64Decode(safeDecode(userinfo))));
			} catch (e) {
				return null;
			}
		}

		// trojan
		if (type === 'trojan') {
			const { host, port } = splitHostPort(hostPort, 443);
			return {
				type,
				name: fragment || `${host}:${port}`,
				server: host,
				port,
				password: safeDecode(userinfo),
				security: params.get('security') || '',
				sni: params.get('sni') || '',
				fp: params.get('fp') || '',
				alpn: params.get('alpn') || '',
				network: params.get('type') || 'tcp',
				host: params.get('host') || '',
				path: params.get('path') || '',
				allowInsecure: ['1', 'true', 'yes'].includes(
					(params.get('allowInsecure') || params.get('allow_insecure') || '').toLowerCase()
				),
			};
		}

		// ss
		if (type === 'ss') {
			const { host, port } = splitHostPort(hostPort, 8388);
			let raw = safeDecode(userinfo);
			// 兼容 ss://base64(method:password) 和 ss://method:password 两种写法(base64字符集不含冒号,不会误伤明文写法)
			if (isValidBase64(raw)) {
				raw = base64Decode(raw);
			}
			const colonIndex = raw.indexOf(':');
			const method = colonIndex >= 0 ? raw.slice(0, colonIndex) : raw;
			const password = colonIndex >= 0 ? raw.slice(colonIndex + 1) : '';
			return {
				type,
				name: fragment || `${host}:${port}`,
				server: host,
				port,
				method,
				password,
				plugin: params.get('plugin') || '',
			};
		}

		// hysteria(hy1)
		if (type === 'hysteria') {
			const { host, port } = splitHostPort(hostPort, 443);
			const up = params.get('upmbps') || '';
			const down = params.get('downmbps') || '';
			return {
				type,
				name: fragment || `${host}:${port}`,
				server: host,
				port,
				up: up ? parseInt(String(up).replace(/\D/g, ''), 10) : '',
				down: down ? parseInt(String(down).replace(/\D/g, ''), 10) : '',
				obfs: params.get('obfs') || '',
				obfsParam: params.get('obfsParam') || '',
				auth: params.get('auth') || params.get('auth_str') || '',
				protocol: params.get('protocol') || '',
				insecure: params.get('insecure') === '1',
				peer: params.get('peer') || '',
				alpn: params.get('alpn') || '',
			};
		}

		// hy2
		if (type === 'hy2') {
			const { host, port } = splitHostPort(hostPort, 443);
			const up = params.get('upmbps') || '';
			const down = params.get('downmbps') || '';
			return {
				type,
				name: fragment || `${host}:${port}`,
				server: host,
				port,
				password: safeDecode(userinfo),
				up: up ? parseInt(String(up).replace(/\D/g, ''), 10) : '',
				down: down ? parseInt(String(down).replace(/\D/g, ''), 10) : '',
				obfs: params.get('obfs') || '',
				obfsPassword: params.get('obfs-password') || '',
				sni: params.get('sni') || '',
				insecure: params.get('insecure') === '1',
			};
		}

		// tuic
		if (type === 'tuic') {
			const { host, port } = splitHostPort(hostPort, 443);
			const colonIndex = userinfo.lastIndexOf(':');
			return {
				type,
				name: fragment || `${host}:${port}`,
				server: host,
				port,
				uuid: safeDecode(colonIndex >= 0 ? userinfo.slice(0, colonIndex) : userinfo),
				password: colonIndex >= 0 ? safeDecode(userinfo.slice(colonIndex + 1)) : '',
				congestion: params.get('congestion_control') || '',
				udpRelayMode: params.get('udp_relay_mode') || '',
				alpn: params.get('alpn') || '',
				sni: params.get('sni') || '',
				insecure: params.get('allow_insecure') === '1',
			};
		}

		// naive
		if (type === 'naive') {
			const { host, port } = splitHostPort(hostPort, 443);
			const colonIndex = userinfo.lastIndexOf(':');
			return {
				type,
				name: fragment || `${host}:${port}`,
				server: host,
				port,
				username: safeDecode(colonIndex >= 0 ? userinfo.slice(0, colonIndex) : userinfo),
				password: colonIndex >= 0 ? safeDecode(userinfo.slice(colonIndex + 1)) : '',
			};
		}

		return null;
	} catch (e) {
		console.error(`解析分享链接失败: ${e.message}`);
		return null;
	}
}

// ----------------------------------------- 生成 clash(yaml) 订阅 -----------------------------------------

// 节点名去重(相同名字后面加_2、_3,避免clash/sing-box出现重复name/tag)
function dedupeNodeNames(nodes) {
	const seen = new Map();
	return nodes.map((node) => {
		const baseName = node.name || `${node.server}:${node.port}`;
		const count = seen.get(baseName) || 0;
		seen.set(baseName, count + 1);
		return { ...node, name: count === 0 ? baseName : `${baseName}_${count + 1}` };
	});
}

// mihomo/clash 的 server 字段里 IPv6 地址必须加中括号(Go SplitHostPort 约定)
function clashServer(host) {
	return host && host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

// 拆分 SIP002 插件字符串 "名称;参数" 为两部分
function splitPlugin(plugin) {
	if (!plugin) return { name: '', opts: '' };
	const sep = plugin.indexOf(';');
	if (sep >= 0) return { name: plugin.slice(0, sep), opts: plugin.slice(sep + 1) };
	return { name: plugin, opts: '' };
}

// 构建完整的 clash 配置(proxies + 基本的proxy-groups)
function buildClashConfig(nodes) {
	const proxies = dedupeNodeNames(nodes).map(toClashProxy).filter(Boolean);
	// 没有转换出任何节点时返回空配置,避免生成引用空列表的proxy-groups
	if (proxies.length === 0) return { proxies: [] };
	const names = proxies.map((p) => p.name);
	return {
		proxies: proxies,
		'proxy-groups': [
			{
				name: '♻️ 自动选择',
				type: 'url-test',
				url: 'http://www.gstatic.com/generate_204',
				interval: 300,
				proxies: names,
			},
			{
				name: '🚀 节点选择',
				type: 'select',
				proxies: ['♻️ 自动选择', ...names],
			},
		],
	};
}

// 将统一结构的节点对象转换为 clash proxy 对象
function toClashProxy(node) {
	try {
		switch (node.type) {
			case 'vless':
				return toClashVless(node);
			case 'vmess':
				return toClashVmess(node);
			case 'trojan':
				return toClashTrojan(node);
			case 'ss':
				return toClashSs(node);
			case 'hysteria':
				return toClashHysteria(node);
			case 'hy2':
				return toClashHy2(node);
			case 'tuic':
				return toClashTuic(node);
			case 'naive':
				return toClashNaive(node);
			default:
				return null;
		}
	} catch (e) {
		console.error(`转换clash节点失败(${node.name}): ${e.message}`);
		return null;
	}
}

// clash 的 ws/grpc/http 传输配置
function clashTransportOpts(node, network) {
	if (network === 'ws') {
		const opts = {};
		if (node.path) opts.path = node.path;
		if (node.host) opts.headers = { Host: node.host };
		return Object.keys(opts).length > 0 ? opts : undefined;
	} else if (network === 'grpc') {
		if (node.path) return { 'grpc-service-name': node.path };
		return undefined;
	} else if (network === 'http') {
		const opts = {};
		if (node.path) opts.path = [node.path];
		if (node.host) opts.headers = { Host: [node.host] };
		return Object.keys(opts).length > 0 ? opts : undefined;
	}
	return undefined;
}

function toClashVless(node) {
	const proxy = { name: node.name, type: 'vless', server: clashServer(node.server), port: node.port, uuid: node.uuid, udp: true };
	const network = node.network || 'tcp';
	if (network !== 'tcp') proxy.network = network;
	if (node.flow && network === 'tcp') proxy.flow = node.flow;
	if (node.security === 'reality' || node.pbk) {
		proxy.tls = true;
		if (node.sni) proxy.servername = node.sni;
		if (node.fp) proxy['client-fingerprint'] = node.fp;
		proxy['reality-opts'] = { 'public-key': node.pbk || '', 'short-id': node.sid || '' };
	} else if (node.security === 'tls' || node.sni) {
		proxy.tls = true;
		if (node.sni) proxy.servername = node.sni;
		if (node.fp) proxy['client-fingerprint'] = node.fp;
	}
	const transport = clashTransportOpts(node, network);
	if (transport) {
		proxy[network === 'ws' ? 'ws-opts' : network === 'grpc' ? 'grpc-opts' : 'http-opts'] = transport;
	}
	return proxy;
}

function toClashVmess(node) {
	const proxy = {
		name: node.name,
		type: 'vmess',
		server: clashServer(node.server),
		port: node.port,
		uuid: node.uuid,
		alterId: node.alterId || 0,
		cipher: node.cipher || 'auto',
		udp: true,
	};
	const network = node.network || 'tcp';
	if (network !== 'tcp') proxy.network = network;
	if (node.tls || node.sni) {
		proxy.tls = true;
		if (node.sni) proxy.servername = node.sni;
		if (node.fp) proxy['client-fingerprint'] = node.fp;
	}
	const transport = clashTransportOpts(node, network);
	if (transport) {
		proxy[network === 'ws' ? 'ws-opts' : network === 'grpc' ? 'grpc-opts' : 'http-opts'] = transport;
	}
	return proxy;
}

function toClashTrojan(node) {
	const proxy = {
		name: node.name,
		type: 'trojan',
		server: clashServer(node.server),
		port: node.port,
		password: node.password,
		udp: true,
	};
	const network = node.network || 'tcp';
	if (network !== 'tcp') proxy.network = network;
	if (node.sni || node.security === 'tls') proxy.sni = node.sni || node.server;
	if (node.allowInsecure) proxy['skip-cert-verify'] = true;
	if (node.fp) proxy['client-fingerprint'] = node.fp;
	if (node.alpn) proxy.alpn = node.alpn.split(',').map((s) => s.trim()).filter(Boolean);
	const transport = clashTransportOpts(node, network);
	if (transport) {
		proxy[network === 'ws' ? 'ws-opts' : network === 'grpc' ? 'grpc-opts' : 'http-opts'] = transport;
	}
	return proxy;
}

function toClashSs(node) {
	const proxy = {
		name: node.name,
		type: 'ss',
		server: clashServer(node.server),
		port: node.port,
		cipher: node.method,
		password: node.password,
		udp: true,
	};
	if (node.plugin) {
		// mihomo 推荐拆成 plugin + plugin-opts 两个字段
		const { name: pname, opts: popts } = splitPlugin(node.plugin);
		proxy.plugin = pname;
		if (popts) proxy['plugin-opts'] = popts;
	}
	return proxy;
}

function toClashHysteria(node) {
	const proxy = { name: node.name, type: 'hysteria', server: clashServer(node.server), port: node.port, udp: true };
	proxy.up = node.up ? String(node.up) : '20';
	proxy.down = node.down ? String(node.down) : '100';
	// mihomo(clash) 的 hysteria 用 auth-str 表示明文密码
	if (node.auth) proxy['auth-str'] = node.auth;
	// hysteria v1 的 obfs 字段是混淆密码。优先取 obfsParam(nekoray格式),再回退 obfs
	if (node.obfsParam) proxy.obfs = node.obfsParam;
	else if (node.obfs) proxy.obfs = node.obfs;
	if (node.protocol) proxy.protocol = node.protocol;
	if (node.peer || node.sni) proxy.sni = node.peer || node.sni;
	if (node.insecure) proxy['skip-cert-verify'] = true;
	if (node.alpn) proxy.alpn = node.alpn.split(',').map((s) => s.trim()).filter(Boolean);
	return proxy;
}

function toClashHy2(node) {
	const proxy = {
		name: node.name,
		type: 'hysteria2',
		server: clashServer(node.server),
		port: node.port,
		password: node.password,
		udp: true,
	};
	if (node.up) proxy.up = String(node.up);
	if (node.down) proxy.down = String(node.down);
	if (node.sni) proxy.sni = node.sni;
	if (node.obfs) proxy.obfs = node.obfs;
	if (node.obfsPassword) proxy['obfs-password'] = node.obfsPassword;
	if (node.insecure) proxy['skip-cert-verify'] = true;
	return proxy;
}

function toClashTuic(node) {
	const proxy = {
		name: node.name,
		type: 'tuic',
		server: clashServer(node.server),
		port: node.port,
		uuid: node.uuid,
		password: node.password,
		udp: true,
	};
	if (node.congestion) proxy['congestion-controller'] = node.congestion;
	if (node.udpRelayMode) proxy['udp-relay-mode'] = node.udpRelayMode;
	if (node.alpn) proxy.alpn = node.alpn.split(',').map((s) => s.trim()).filter(Boolean);
	if (node.sni) proxy.sni = node.sni;
	if (node.insecure) proxy['skip-cert-verify'] = true;
	return proxy;
}

function toClashNaive(node) {
	return {
		name: node.name,
		type: 'naive',
		server: clashServer(node.server),
		port: node.port,
		username: node.username,
		password: node.password,
		udp: true,
		tls: true,
	};
}

// ---------------------------------------- 生成 sing-box(json) 订阅 ----------------------------------------

function buildSingboxConfig(nodes) {
	return { version: 1, outbounds: dedupeNodeNames(nodes).map(toSingboxOutbound).filter(Boolean) };
}

// 将统一结构的节点对象转换为 sing-box outbound 对象
function toSingboxOutbound(node) {
	try {
		switch (node.type) {
			case 'vless':
				return singboxVless(node);
			case 'vmess':
				return singboxVmess(node);
			case 'trojan':
				return singboxTrojan(node);
			case 'ss':
				return singboxSs(node);
			case 'hysteria':
				return singboxHysteria(node);
			case 'hy2':
				return singboxHy2(node);
			case 'tuic':
				return singboxTuic(node);
			case 'naive':
				return singboxNaive(node);
			default:
				return null;
		}
	} catch (e) {
		console.error(`转换sing-box节点失败(${node.name}): ${e.message}`);
		return null;
	}
}

// 构建 sing-box 的 tls 对象(forceEnabled为true时强制开启tls,如trojan/hysteria等必须开启tls的协议)
function singboxTls(node, forceEnabled) {
	const enabled =
		forceEnabled || node.security === 'reality' || node.pbk || node.security === 'tls' || node.sni || node.tls;
	if (!enabled) return undefined;
	const tls = { enabled: true };
	if (node.security === 'reality' || node.pbk) {
		tls.reality = { enabled: true, public_key: node.pbk || '', short_id: node.sid || '' };
	}
	if (node.sni) tls.server_name = node.sni;
	if (node.insecure) tls.insecure = true;
	if (node.fp) tls.utls = { enabled: true, fingerprint: node.fp };
	if (node.alpn) tls.alpn = node.alpn.split(',').map((s) => s.trim()).filter(Boolean);
	return tls;
}

// 构建 sing-box 的 transport 对象
function singboxTransport(node) {
	const network = node.network || 'tcp';
	if (network === 'tcp' || network === '') return undefined;
	if (network === 'ws') {
		const t = { type: 'ws' };
		if (node.path) t.path = node.path;
		if (node.host) t.headers = { Host: node.host };
		return t;
	}
	if (network === 'grpc') {
		const t = { type: 'grpc' };
		if (node.path) t.service_name = node.path;
		return t;
	}
	if (network === 'http') {
		const t = { type: 'http' };
		if (node.path) t.path = node.path;
		if (node.host) t.host = node.host;
		return t;
	}
	if (network === 'h2' || network === 'httpupgrade') {
		const t = { type: 'httpupgrade' };
		if (node.path) t.path = node.path;
		if (node.host) t.host = node.host;
		return t;
	}
	return undefined;
}

function singboxVless(node) {
	const ob = { type: 'vless', tag: node.name, server: node.server, server_port: node.port, uuid: node.uuid };
	if (node.flow && (node.network || 'tcp') === 'tcp') ob.flow = node.flow;
	ob.packet_encoding = 'xudp';
	const tls = singboxTls(node, false);
	if (tls) ob.tls = tls;
	const transport = singboxTransport(node);
	if (transport) ob.transport = transport;
	return ob;
}

function singboxVmess(node) {
	const ob = {
		type: 'vmess',
		tag: node.name,
		server: node.server,
		server_port: node.port,
		uuid: node.uuid,
		security: node.cipher || 'auto',
	};
	if (node.alterId) ob.alter_id = node.alterId;
	const tls = singboxTls(node, false);
	if (tls) ob.tls = tls;
	const transport = singboxTransport(node);
	if (transport) ob.transport = transport;
	return ob;
}

function singboxTrojan(node) {
	const ob = {
		type: 'trojan',
		tag: node.name,
		server: node.server,
		server_port: node.port,
		password: node.password,
	};
	const tls = singboxTls(node, true);
	if (tls) ob.tls = tls;
	const transport = singboxTransport(node);
	if (transport) ob.transport = transport;
	return ob;
}

function singboxSs(node) {
	const ob = {
		type: 'shadowsocks',
		tag: node.name,
		server: node.server,
		server_port: node.port,
		method: node.method,
		password: node.password,
	};
	if (node.plugin) {
		const { name, opts } = splitPlugin(node.plugin);
		ob.plugin = name;
		if (opts) ob.plugin_opts = opts;
	}
	return ob;
}

function singboxHysteria(node) {
	const ob = { type: 'hysteria', tag: node.name, server: node.server, server_port: node.port };
	// 与clash侧保持一致,缺失时给默认值,避免sing-box缺少up/down
	ob.up_mbps = node.up || 20;
	ob.down_mbps = node.down || 100;
	if (node.auth) ob.auth_str = node.auth;
	// sing-box 的 hysteria 用 obfs 字符串直接表示混淆密码。优先取 obfsParam,再回退 obfs
	if (node.obfsParam) ob.obfs = node.obfsParam;
	else if (node.obfs) ob.obfs = node.obfs;
	const tls = { enabled: true };
	if (node.peer || node.sni) tls.server_name = node.peer || node.sni;
	if (node.insecure) tls.insecure = true;
	if (node.alpn) tls.alpn = node.alpn.split(',').map((s) => s.trim()).filter(Boolean);
	ob.tls = tls;
	return ob;
}

function singboxHy2(node) {
	const ob = {
		type: 'hysteria2',
		tag: node.name,
		server: node.server,
		server_port: node.port,
		password: node.password,
	};
	if (node.up) ob.up_mbps = node.up;
	if (node.down) ob.down_mbps = node.down;
	if (node.obfs || node.obfsPassword) {
		ob.obfs = { type: node.obfs || 'salamander' };
		if (node.obfsPassword) ob.obfs.password = node.obfsPassword;
	}
	const tls = { enabled: true };
	if (node.sni) tls.server_name = node.sni;
	if (node.insecure) tls.insecure = true;
	if (node.alpn) tls.alpn = node.alpn.split(',').map((s) => s.trim()).filter(Boolean);
	ob.tls = tls;
	return ob;
}

function singboxTuic(node) {
	const ob = {
		type: 'tuic',
		tag: node.name,
		server: node.server,
		server_port: node.port,
		uuid: node.uuid,
		password: node.password,
	};
	if (node.congestion) ob.congestion_control = node.congestion;
	if (node.udpRelayMode) ob.udp_relay_mode = node.udpRelayMode;
	const tls = { enabled: true };
	if (node.sni) tls.server_name = node.sni;
	if (node.insecure) tls.insecure = true;
	if (node.alpn) tls.alpn = node.alpn.split(',').map((s) => s.trim()).filter(Boolean);
	ob.tls = tls;
	return ob;
}

function singboxNaive(node) {
	return {
		type: 'naive',
		tag: node.name,
		server: node.server,
		server_port: node.port,
		username: node.username,
		password: node.password,
	};
}

// 规范化 format 参数: base64(默认) | plain | clash | singbox
function normalizeFormat(format) {
	const f = (format || '').trim().toLowerCase();
	if (['clash', 'clashyaml', 'clash-meta', 'yaml'].includes(f)) return 'clash';
	if (['singbox', 'sing-box', 'sing_box', 'singboxjson', 'json'].includes(f)) return 'singbox';
	if (['plain', 'v2ray', 'text', 'txt'].includes(f)) return 'plain';
	return 'base64';
}

// ----------------------------------------- Cloudflare worker 入口 ----------------------------------------

export default {
	async fetch(request, env, ctx) {
		// ---- 解析请求参数: 支持 ?format=base64|plain|clash|singbox ----
		const url = new URL(request.url);
		const format = normalizeFormat(url.searchParams.get('format'));

		// ---- 使用 Cache API 缓存抓取到的节点数据30分钟,各格式共用同一份数据,避免重复抓取源订阅 ----
		// 缓存键去掉format参数并带版本号(数据结构变更时+1,避免命中旧版本缓存导致解析出错)
		// 本地node环境没有caches对象,做一下判断避免报错
		const cache = globalThis.caches ? caches.default : null;
		url.searchParams.delete('format');
		url.searchParams.set('_cachev', '2');
		const dataCacheKey = new Request(url.toString(), { method: 'GET' });

		let linksText = '';
		if (cache) {
			try {
				const cached = await cache.match(dataCacheKey);
				if (cached) {
					linksText = await cached.text();
				}
			} catch (cacheError) {
				console.error(`缓存读取失败: ${cacheError.message}`);
			}
		}

		if (linksText === '') {
			try {
				// 调用函数并处理结果
				let resultsArray = await processUrls(targetUrls);

				// 使用Set数据结构的特性去重（再次去重）,并剔除空字符串和带占位符的坏链接
				let uniqueStrings = [...new Set(resultsArray)].filter((item) => item !== '' && !isBrokenLink(item));

				// 排序
				let sortedArray = uniqueStrings.sort((a, b) => {
					// 先按字母顺序排序
					const compareByLetters = a.localeCompare(b);
					// 如果字母相同，则按数字大小排序
					if (compareByLetters === 0) {
						const numA = parseInt(a, 10) || 0; // 将非数字的字符串转换为0
						const numB = parseInt(b, 10) || 0;
						const compareByNumbers = numA - numB;

						// 如果数字相同，则按字符串长度排序
						if (compareByNumbers === 0) {
							return a.length - b.length;
						}
						return compareByNumbers;
					}
					return compareByLetters;
				});

				// 将数组拼接成一个字符串
				linksText = sortedArray.join('\n');

				// 把节点数据写入缓存(失败不影响正常返回,用.catch兜底异步异常)
				if (cache) {
					const dataResponse = new Response(linksText, {
						headers: { 'Cache-Control': 'public, max-age=1800, s-maxage=1800' },
					});
					ctx.waitUntil(
						cache.put(dataCacheKey, dataResponse).catch((cacheError) =>
							console.error(`缓存写入失败: ${cacheError.message}`)
						)
					);
				}
			} catch (error) {
				console.error(`Error in fetch function: ${error.message}`);
				// 返回一个带有错误信息的响应
				return new Response(`Error fetching web page: ${error.message}`, {
					status: 500,
				});
			}
		}

		// 一个节点都没有时,返回可读的错误提示而不是空内容,方便排查问题
		if (linksText === '') {
			return new Response('获取订阅失败: 所有订阅源均不可用,请检查 targetUrls 里的链接是否失效,或稍后再试。', {
				status: 200,
				headers: {
					'Content-Type': 'text/plain; charset=UTF-8',
				},
			});
		}

		// ---- 根据 format 参数在本地生成对应格式的订阅内容 ----
		let body = '';
		let contentType = 'text/plain; charset=UTF-8';
		if (format === 'clash' || format === 'singbox') {
			const nodes = linksText.split('\n').map(parseShareLink).filter(Boolean);
			if (nodes.length === 0) {
				return new Response('获取订阅失败: 无法解析任何节点。', {
					status: 200,
					headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
				});
			}
			if (format === 'clash') {
				body = yamlDump(buildClashConfig(nodes));
				contentType = 'text/yaml; charset=UTF-8';
			} else {
				body = JSON.stringify(buildSingboxConfig(nodes), null, 2);
				contentType = 'application/json; charset=UTF-8';
			}
		} else if (format === 'plain') {
			// 明文v2ray分享链接
			body = linksText;
		} else {
			// base64编码的v2ray分享链接(默认)
			body = base64Encode(linksText);
		}

		// 返回一个带有结果的响应(同时让Cloudflare边缘与客户端缓存30分钟)
		return new Response(body, {
			status: 200,
			headers: {
				'Content-Type': contentType,
				'Cache-Control': 'public, max-age=1800, s-maxage=1800',
			},
		});
	},
};
