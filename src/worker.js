import yaml from 'js-yaml'; // npm install js-yaml

// ----------------------------------------- 解析和构建 hysteria 节点 ---------------------------------------

function parse_hysteria(outbounds_n) {
	let server = findFieldValue(outbounds_n, 'server') || '';
	if (server.startsWith('127.0.0.1') || server === '') {
		return '';
	}
	let port = findFieldValue(outbounds_n, 'server_port') || findFieldValue(outbounds_n, 'port');

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

	return `hysteria://${server}:${port}?${encodedParams}#[hysteria]_${server}:${port}`;
}

// ------------------------------------------ 解析和构建 hy2 节点 -------------------------------------------

function parse_hy2(outbounds_n) {
	let server = findFieldValue(outbounds_n, 'server') || '';
	if (server.startsWith('127.0.0.1') || server === '') {
		return '';
	}
	let port = findFieldValue(outbounds_n, 'port');

	// 排除"domain:port"、"ipv4:port" 或 "ipv6:port" 这三种情况地址的正则表达式
	let genericAddressRegex = /^(?!.*:\d+$)(?!\[.*\].*:\d+$)/;
	if (genericAddressRegex.test(server)) {
		server = `${server}:${port}`;
	}

	let password = findFieldValue(outbounds_n, 'password') || findFieldValue(outbounds_n, 'auth');
	let obfs = findFieldValue(outbounds_n, 'obfs') || '';
	let obfs_password = findFieldValue(outbounds_n, 'obfs-password') || '';
	let sni = findFieldValue(outbounds_n, 'sni') || '';

	let up = findFieldValue(outbounds_n, 'up') || '80';
	let down = findFieldValue(outbounds_n, 'down') || '100';
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

	return `hy2://${password}@${server}?${encodedParams}#[hy2]_${server}`;
}

// ----------------------------------------- 解析和构建 vless 节点 ------------------------------------------

function parse_vle55(outbounds_n) {
	let address = findFieldValue(outbounds_n, 'address') || findFieldValue(outbounds_n, 'server') || '';
	if (address === '127.0.0.1' || address === '') {
		return '';
	}
	let port = findFieldValue(outbounds_n, 'port');
	let uuid = findFieldValue(outbounds_n, 'id') || findFieldValue(outbounds_n, 'uuid');
	let encryption = findFieldValue(outbounds_n, 'encryption') || 'none'; // 加密方式
	let flow = findFieldValue(outbounds_n, 'flow') || '';
	let network = findFieldValue(outbounds_n, 'network');
	let host = findFieldValue(outbounds_n, 'Host') || findFieldValue(outbounds_n, 'host') || '';
	let path = findFieldValue(outbounds_n, 'path') || '';
	// 目前发现publicKey和shortId是reality独有
	let public_key = findFieldValue(outbounds_n, 'public-key') || findFieldValue(outbounds_n, 'publicKey') || '';
	let short_id = findFieldValue(outbounds_n, 'short-id') || findFieldValue(outbounds_n, 'shortId') || '';
	// sni
	let serverName = findFieldValue(outbounds_n, 'serverName') || findFieldValue(outbounds_n, 'servername') || '';
	if (host === '' && serverName === '') {
		host = address;
	} else if (host === '' && serverName !== '') {
		host = serverName;
	}
	// 传输层安全(TLS)
	let tls_security;
	if (public_key !== '') {
		tls_security = 'reality';
	} else {
		let tls = findFieldValue(outbounds_n.streamSettings, 'security') || findFieldValue(outbounds_n, 'tls') || '';
		if (tls === 'none') {
			tls_security = '';
		} else if (tls === true) {
			tls_security = 'tls';
		} else {
			tls_security = '';
		}
	}
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

	return `${base64Decode('dmxlc3M6Ly8')}${uuid}@${address}:${port}?${encodedParams}#[${base64Decode('dmxlc3M')}]_${address}:${port}`;
}

// ----------------------------------------- 解析和构建 vmess 节点 ------------------------------------------

function parse_vme55(outbounds_n) {
	let address = findFieldValue(outbounds_n, 'address') || findFieldValue(outbounds_n, 'server') || '';
	if (address === '127.0.0.1' || address === '') {
		return '';
	}
	let port = findFieldValue(outbounds_n, 'port');
	let uuid = findFieldValue(outbounds_n, 'id') || findFieldValue(outbounds_n, 'uuid');
	let alterId = findFieldValue(outbounds_n, 'alterId') || 0;

	// 加密方式(security)
	let auto_security = findFieldValue(outbounds_n, 'cipher') || findFieldValue(outbounds_n.settings, 'security') || 'auto';

	// 传输协议(network)
	let network = findFieldValue(outbounds_n, 'network');
	// 伪装类型(type)
	let type_encryption = findFieldValue(outbounds_n, 'encryption') || 'none';

	// 传输层安全(TLS)
	let tls = findFieldValue(outbounds_n.streamSettings, 'security') || findFieldValue(outbounds_n, 'tls') || '';
	let tls_security = tls === true ? 'tls' || '' : tls;

	let path =
		findFieldValue(outbounds_n, 'path') ||
		findFieldValue(outbounds_n, 'ws-path') ||
		findFieldValue(outbounds_n, 'grpc-service-name') ||
		'/';
	// 伪装域名(host)
	let host = findFieldValue(outbounds_n, 'Host') || findFieldValue(outbounds_n, 'host') || '';
	let serverName = findFieldValue(outbounds_n, 'sni') || findFieldValue(outbounds_n, 'serverName') || '';
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

	let port = findFieldValue(outbounds_n, 'port');
	let method = findFieldValue(outbounds_n, 'method') || findFieldValue(outbounds_n, 'cipher');
	let password = findFieldValue(outbounds_n, 'password');
	let method_with_password = `${method}:${password}`;
	let base64EncodedString = base64Encode(method_with_password);

	return `${base64Decode('c3M6Ly8')}${base64EncodedString}@${address}:${port}#[ss]_${address}`;
}

// ----------------------------------------- 解析和构建 trojan 节点 -----------------------------------------

function parse_tr0jan(outbounds_n) {
	let server = findFieldValue(outbounds_n, 'server') || '';
	if (server.startsWith('127.0.0.1') || server === '') {
		return '';
	}
	let port = findFieldValue(outbounds_n, 'port');
	let password = findFieldValue(outbounds_n, 'password');
	let network = findFieldValue(outbounds_n, 'network') || 'tcp';
	let path = findFieldValue(outbounds_n, 'path') || '';
	let host = findFieldValue(outbounds_n, 'Host') || findFieldValue(outbounds_n, 'host') || '';
	let sni = findFieldValue(outbounds_n, 'sni') || '';
	let fp = findFieldValue(outbounds_n, 'client-fingerprint') || findFieldValue(outbounds_n, 'fingerprint') || '';
	let alpn = findFieldValue(outbounds_n, 'alpn') || ''; // 没有确定字段是否这个名字
	let tls_security = '';
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

	return `${base64Decode('dHJvamFuOi8v')}${password}@${server}:${port}?${encodedParams}#[${base64Decode('dHJvamFu')}]_${server}`;
}

// ------------------------------------------ 解析和构建 tuic 节点 ------------------------------------------

function parse_tuic(outbounds_n) {
	let uuid = findFieldValue(outbounds_n, 'uuid') || '';
	let password = findFieldValue(outbounds_n, 'password') || '';
	let server = findFieldValue(outbounds_n, 'server') || '';
	if (server === '127.0.0.1' || server === '' || uuid === '' || password === '') {
		return '';
	}
	let port = findFieldValue(outbounds_n, 'port');
	let congestion_controller = findFieldValue(outbounds_n, 'congestion-controller');
	let udp_relay_mode = findFieldValue(outbounds_n, 'udp-relay-mode');
	let sni = findFieldValue(outbounds_n, 'sni') || '';
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

	return `tuic://${uuid}:${password}@${server}:${port}?${encodedParams}#[tuic]_${server}`;
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
				if (proxyPrefix.some((prefix) => link.startsWith(base64Decode(prefix)))) uniqueSet.add(link);
			});
			// 转换为数组
			const uniqueArray = Array.from(uniqueSet);
			return uniqueArray;
		} else {
			try {
				// 聚合配置常见两种形态:1)用---分隔的多文档;2)直接拼接(顶层key重复,js-yaml会报错)。
				// 先用loadAll处理多文档,失败再按顶层key重复边界拆分逐个解析,最后合并proxies节点
				let yamlObjects = [];
				try {
					yamlObjects = yaml.loadAll(content);
				} catch (loadAllError) {
					for (const chunk of splitClashDuplicated(content)) {
						try {
							const obj = yaml.load(chunk);
							if (obj && typeof obj === 'object') {
								yamlObjects.push(obj);
							}
						} catch (chunkError) {
							// 单个块解析失败忽略,不影响其它块
						}
					}
				}
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
			} catch (yamlError) {
				// 解析yaml失败(例如源数据是损坏的json/yaml)，跳过该链接，不影响其它链接
				console.error(`解析${url} 的yaml内容失败: ${yamlError.message}`);
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

			return `hy2://${pwd_auth}@${server}?insecure=${insecure}&sni=${sni}#[hy2]_${server}`;
		} else if (server && auth && alpn && upmbps !== null && downmbps !== null) {
			// 判断是hy1

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

		// let allProxyType = ['hysteria', 'hy2', 'vless', 'vmess', 'trojan', 'ss', 'tuic'];
		let allProxyType = ['aHlzdGVyaWE', 'aHky', 'dmxlc3M', 'dm1lc3M', 'dHJvamFu', 'c3M', 'dHVpYw'];
		// 遍历数组中的节点
		for (var i = 0; i < outbounds.length; i++) {
			let proxyType = findFieldValue(outbounds[i], 'protocol');
			if (!allProxyType.includes(proxyType)) {
				proxyType = findFieldValue(outbounds[i], 'type');
			}
			// 检查到是hysteria类型的节点
			if (proxyType === base64Decode('aHlzdGVyaWE')) {
				let hy1 = parse_hysteria(outbounds[i]);
				if (hy1) {
					uniqueSet.add(hy1);
				}
				// 检查到是hy2类型的节点(clash中该类型名为hysteria2,也要兼容)
			} else if (proxyType === base64Decode('aHky') || proxyType === 'hysteria2') {
				let hy2 = parse_hy2(outbounds[i]);
				if (hy2) {
					uniqueSet.add(hy2);
				}
				// 检查到是shadowsocks类型的节点
			} else if (proxyType === base64Decode('c3M')) {
				let ss = parse_shadowsocks(outbounds[i]);
				if (ss) {
					uniqueSet.add(ss);
				}
				// 检查到是vless类型的节点
			} else if (proxyType === base64Decode('dmxlc3M')) {
				let vle55 = parse_vle55(outbounds[i]);
				if (vle55) {
					uniqueSet.add(vle55);
				}
				// 检查到是vmess类型的节点
			} else if (proxyType === base64Decode('dm1lc3M')) {
				let vme55 = parse_vme55(outbounds[i]);
				if (vme55) {
					uniqueSet.add(vme55);
				}
				// 检查到是trojan类型的节点
			} else if (proxyType === base64Decode('dHJvamFu')) {
				let tr0jan = parse_tr0jan(outbounds[i]);
				if (tr0jan) {
					uniqueSet.add(tr0jan);
				}
				// 检查到是tuic类型的节点
			} else if (proxyType === base64Decode('dHVpYw')) {
				let tuic = parse_tuic(outbounds[i]);
				if (tuic) {
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

// 判断是否是有效的Base64编码字符串
function isValidBase64(str) {
	if (typeof str !== 'string') return false;

	str = str.trim();
	if (str === '') return false;

	// 兼容多行base64订阅:去除所有空白字符后再校验
	const cleaned = str.replace(/\s+/g, '');

	// Base64正则匹配规则，确保格式正确
	const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
	if (!base64Regex.test(cleaned)) return false;

	// 长度必须是4的倍数
	if (cleaned.length % 4 !== 0) return false;

	try {
		// 尝试解码，确保不会报错
		const binaryStr = atob(cleaned);
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
		return base64Decode(str.replace(/\s+/g, ''));
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
	'https://ghproxy.cn/https://raw.githubusercontent.com/chengaopan/AutoMergePublicNodes/master/list.meta.yml',
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
	// 'https://fastly.jsdelivr.net/gh/jsvpn/jsproxy@dev/yule/20200325/1299699.md',
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

// 构建完整的 clash 配置(proxies + 基本的proxy-groups)
function buildClashConfig(nodes) {
	const proxies = dedupeNodeNames(nodes).map(toClashProxy).filter(Boolean);
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
	const proxy = { name: node.name, type: 'vless', server: node.server, port: node.port, uuid: node.uuid, udp: true };
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
		server: node.server,
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
		server: node.server,
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
		server: node.server,
		port: node.port,
		cipher: node.method,
		password: node.password,
		udp: true,
	};
	if (node.plugin) proxy.plugin = node.plugin;
	return proxy;
}

function toClashHysteria(node) {
	const proxy = { name: node.name, type: 'hysteria', server: node.server, port: node.port, udp: true };
	proxy.up = node.up ? String(node.up) : '20';
	proxy.down = node.down ? String(node.down) : '100';
	if (node.auth) proxy.auth = node.auth;
	if (node.obfs) proxy.obfs = node.obfs;
	if (node.obfsParam) proxy['obfs-param'] = node.obfsParam;
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
		server: node.server,
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
		server: node.server,
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
		server: node.server,
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
	return {
		type: 'shadowsocks',
		tag: node.name,
		server: node.server,
		server_port: node.port,
		method: node.method,
		password: node.password,
	};
}

function singboxHysteria(node) {
	const ob = { type: 'hysteria', tag: node.name, server: node.server, server_port: node.port };
	// 与clash侧保持一致,缺失时给默认值,避免sing-box缺少up/down
	ob.up_mbps = node.up || 20;
	ob.down_mbps = node.down || 100;
	if (node.auth) ob.auth_str = node.auth;
	if (node.obfs) ob.obfs = node.obfs;
	if (node.obfsParam) ob.obfs_param = node.obfsParam;
	if (node.protocol) ob.protocol = node.protocol;
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

				// 使用Set数据结构的特性去重（再次去重）,并剔除空字符串
				let uniqueStrings = [...new Set(resultsArray)].filter((item) => item !== '');

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
				body = yaml.dump(buildClashConfig(nodes));
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
