// src/worker.js
function stripYamlComment(line) {
  let inS = false;
  let inD = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inS) {
      if (c === "'")
        inS = false;
      continue;
    }
    if (inD) {
      if (c === '"')
        inD = false;
      continue;
    }
    if (c === "'")
      inS = true;
    else if (c === '"')
      inD = true;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1])))
      return line.slice(0, i);
  }
  return line;
}
function preprocessYamlLines(text) {
  const lines = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const stripped = stripYamlComment(raw).replace(/[ \t]+$/, "");
    if (stripped.trim() !== "") {
      lines.push(stripped);
    }
  }
  return lines;
}
function yamlSplitKeyValue(str) {
  let inS = false;
  let inD = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inS) {
      if (c === "'")
        inS = false;
      continue;
    }
    if (inD) {
      if (c === '"')
        inD = false;
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
    if (c === ":" && (i + 1 >= str.length || str[i + 1] === " " || str[i + 1] === "	")) {
      const key = str.slice(0, i).trim();
      const rest = str.slice(i + 1).trim();
      if (key !== "")
        return { key, value: rest, hasValue: rest !== "" };
    }
  }
  return null;
}
function yamlSplitAnchor(raw) {
  if (!raw.startsWith("&"))
    return null;
  const sp = raw.indexOf(" ");
  if (sp < 0)
    return { name: raw.slice(1), rest: "" };
  return { name: raw.slice(1, sp), rest: raw.slice(sp + 1) };
}
function yamlParseScalar(raw, ctx) {
  if (raw === "")
    return null;
  if (raw[0] === "'") {
    if (raw.endsWith("'") && raw.length >= 2)
      return raw.slice(1, -1).replace(/''/g, "'");
    return raw.slice(1);
  }
  if (raw[0] === '"') {
    if (raw.endsWith('"') && raw.length >= 2) {
      return raw.slice(1, -1).replace(/\\n/g, "\n").replace(/\\t/g, "	").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    return raw.slice(1);
  }
  if (raw.startsWith("&")) {
    const anchor = yamlSplitAnchor(raw);
    if (anchor && anchor.rest !== "") {
      const val = yamlParseScalar(anchor.rest, ctx);
      if (anchor.name && ctx)
        ctx.anchors[anchor.name] = val;
      return val;
    }
    return null;
  }
  if (raw.startsWith("*")) {
    if (ctx && ctx.anchors && ctx.anchors[raw.slice(1)] !== void 0) {
      return ctx.anchors[raw.slice(1)];
    }
    return raw;
  }
  const lower = raw.toLowerCase();
  if (lower === "true" || lower === "yes" || lower === "on")
    return true;
  if (lower === "false" || lower === "no" || lower === "off")
    return false;
  if (lower === "null" || lower === "~")
    return null;
  if (/^-?\d+$/.test(raw))
    return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw))
    return parseFloat(raw);
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (inner === "")
      return [];
    return inner.split(",").map((s) => yamlParseScalar(s.trim(), ctx));
  }
  if (raw.startsWith("{") && raw.endsWith("}")) {
    const inner = raw.slice(1, -1).trim();
    const obj = {};
    if (inner !== "") {
      for (const part of inner.split(",")) {
        const kv = yamlSplitKeyValue(part.trim());
        if (kv)
          obj[kv.key] = kv.hasValue ? yamlParseScalar(kv.value, ctx) : null;
      }
    }
    return obj;
  }
  return raw;
}
function yamlResolveValue(lines, idx, ctx, keyIndent, inlineValue) {
  if (inlineValue !== null && inlineValue !== void 0 && inlineValue !== "") {
    const v = inlineValue.trim();
    const anchor = v.startsWith("&") ? yamlSplitAnchor(v) : null;
    if (anchor && anchor.rest !== "") {
      const val = yamlParseScalar(anchor.rest, ctx);
      if (anchor.name && ctx)
        ctx.anchors[anchor.name] = val;
      return { value: val, nextIndex: idx };
    }
    if (anchor) {
      const next2 = lines[idx];
      if (next2 === void 0) {
        if (anchor.name && ctx)
          ctx.anchors[anchor.name] = null;
        return { value: null, nextIndex: idx };
      }
      const nind2 = next2.length - next2.trimStart().length;
      if (nind2 > keyIndent) {
        const [child, ni] = yamlParseBlock(lines, idx, ctx, nind2);
        if (anchor.name && ctx)
          ctx.anchors[anchor.name] = child;
        return { value: child, nextIndex: ni };
      }
      if (nind2 === keyIndent && next2.slice(keyIndent).trim().startsWith("-")) {
        const [child, ni] = yamlParseSeq(lines, idx, ctx, keyIndent);
        if (anchor.name && ctx)
          ctx.anchors[anchor.name] = child;
        return { value: child, nextIndex: ni };
      }
      if (anchor.name && ctx)
        ctx.anchors[anchor.name] = null;
      return { value: null, nextIndex: idx };
    }
    return { value: yamlParseScalar(v, ctx), nextIndex: idx };
  }
  const next = lines[idx];
  if (next === void 0)
    return { value: null, nextIndex: idx };
  const nind = next.length - next.trimStart().length;
  if (nind > keyIndent) {
    const [child, ni] = yamlParseBlock(lines, idx, ctx, nind);
    return { value: child, nextIndex: ni };
  }
  if (nind === keyIndent && next.slice(keyIndent).trim().startsWith("-")) {
    const [child, ni] = yamlParseSeq(lines, idx, ctx, keyIndent);
    return { value: child, nextIndex: ni };
  }
  return { value: null, nextIndex: idx };
}
function yamlParseMapTail(lines, start, ctx, minIndent, obj) {
  let j = start;
  while (j < lines.length) {
    const l = lines[j];
    const ind = l.length - l.trimStart().length;
    if (ind <= minIndent)
      break;
    const t = l.slice(ind).trim();
    if (t === "" || t.startsWith("-")) {
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
function yamlParseBlock(lines, idx, ctx, indent) {
  const trimmed = lines[idx].slice(indent).trim();
  if (trimmed.startsWith("-")) {
    return yamlParseSeq(lines, idx, ctx, indent);
  }
  const kv = yamlSplitKeyValue(trimmed);
  if (kv === null) {
    return [yamlParseScalar(trimmed, ctx), idx + 1];
  }
  const obj = {};
  let i = idx;
  while (i < lines.length) {
    const l = lines[i];
    const ind = l.length - l.trimStart().length;
    if (ind < indent || ind > indent)
      break;
    const t = l.slice(ind).trim();
    if (t === "") {
      i++;
      continue;
    }
    if (t.startsWith("-"))
      break;
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
function yamlParseSeq(lines, idx, ctx, indent) {
  const arr = [];
  let i = idx;
  while (i < lines.length) {
    const l = lines[i];
    const ind = l.length - l.trimStart().length;
    if (ind !== indent)
      break;
    const t = l.slice(ind).trim();
    if (!t.startsWith("-"))
      break;
    const itemText = t.slice(1).trim();
    if (itemText === "") {
      const next = lines[i + 1];
      if (next === void 0) {
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
      const obj = {};
      const r = yamlResolveValue(lines, i + 1, ctx, indent + 2, kv.hasValue ? kv.value : null);
      obj[kv.key] = r.value;
      const j = yamlParseMapTail(lines, r.nextIndex, ctx, indent, obj);
      arr.push(obj);
      i = j;
      continue;
    }
    arr.push(yamlParseScalar(itemText, ctx));
    i++;
  }
  return [arr, i];
}
function yamlParseSingle(text) {
  const lines = preprocessYamlLines(text);
  if (lines.length === 0)
    return null;
  const indent = lines[0].length - lines[0].trimStart().length;
  const [node] = yamlParseBlock(lines, 0, { anchors: {} }, indent);
  return node;
}
function yamlParseAll(text) {
  const docs = [];
  const raw = String(text);
  const docParts = raw.split(/^---\s*$|^\.\.\.\s*$/m);
  for (const part of docParts) {
    if (!part.trim())
      continue;
    for (const chunk of splitClashDuplicated(part)) {
      try {
        const node = yamlParseSingle(chunk);
        if (node !== null && node !== void 0)
          docs.push(node);
      } catch (e) {
      }
    }
  }
  return docs;
}
function yamlQuoteScalar(s) {
  s = String(s);
  if (s === "")
    return "''";
  const lower = s.toLowerCase();
  const looksNumber = /^-?\d+(\.\d+)?$/.test(s);
  const reserved = ["true", "false", "yes", "no", "on", "off", "null", "~"];
  const needsQuote = looksNumber || reserved.includes(lower) || /^[\s\-?:,\[\]{}#&*!|>'"%@`\\]/.test(s) || // 起始字符特殊
  /[\s"'#,:\[\]{}&*!|>%@`\\]/.test(s);
  if (!needsQuote)
    return s;
  return `'${s.replace(/'/g, "''")}'`;
}
function yamlQuoteKey(k) {
  k = String(k);
  if (/^[A-Za-z0-9_-]+$/.test(k))
    return k;
  return `'${k.replace(/'/g, "''")}'`;
}
function yamlDumpValue(v) {
  if (v === null || v === void 0)
    return "null";
  if (typeof v === "number")
    return String(v);
  if (typeof v === "boolean")
    return v ? "true" : "false";
  if (Array.isArray(v))
    return "[" + v.map(yamlDumpValue).join(", ") + "]";
  return yamlQuoteScalar(v);
}
function yamlDumpEntry(lines, indent, key, value) {
  const pad = " ".repeat(indent);
  if (value === null || value === void 0) {
    lines.push(`${pad}${yamlQuoteKey(key)}:`);
  } else if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${pad}${yamlQuoteKey(key)}: []`);
    } else {
      lines.push(`${pad}${yamlQuoteKey(key)}:`);
      for (const item of value) {
        if (item && typeof item === "object") {
          const entries = Object.entries(item);
          if (entries.length === 0) {
            lines.push(`${pad}  - {}`);
            continue;
          }
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
  } else if (value && typeof value === "object") {
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
  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}
function parse_hysteria(outbounds_n) {
  let server = findFieldValue(outbounds_n, "server") || "";
  if (server.startsWith("127.0.0.1") || server === "") {
    return "";
  }
  let port = findFieldValue(outbounds_n, "server_port") || findFieldValue(outbounds_n, "port") || 443;
  if (!hostAlreadyHasPort(server)) {
    if (server.includes(":") && !server.startsWith("[")) {
      server = `[${server}]`;
    }
    server = `${server}:${port}`;
  }
  let upmbps_str = findFieldValue(outbounds_n, "up_mbps") || findFieldValue(outbounds_n, "up");
  let downmbps_str = findFieldValue(outbounds_n, "down_mbps") || findFieldValue(outbounds_n, "down");
  let upmbps = parseInt(String(upmbps_str).replace(/\D/g, ""), 10) || 0;
  let downmbps = parseInt(String(downmbps_str).replace(/\D/g, ""), 10) || 0;
  let obfsParam = findFieldValue(outbounds_n, "obfs") || "";
  let auth = findFieldValue(outbounds_n, "auth_str") || findFieldValue(outbounds_n, "auth-str");
  let peer = findFieldValue(outbounds_n, "server_name") || findFieldValue(outbounds_n, "sni") || "";
  let protocolValue = findFieldValue(outbounds_n, "protocol");
  let protocol = protocolValue !== "hysteria" ? protocolValue : "";
  let insecureFieldValue = findFieldValue(outbounds_n, "insecure");
  let insecure = [null, true].includes(insecureFieldValue) ? 1 : "";
  let alpnValue = findFieldValue(outbounds_n, "alpn");
  let alpn;
  if (typeof alpnValue === "string") {
    alpn = alpnValue;
  } else if (Array.isArray(alpnValue) && alpnValue.length > 0) {
    alpn = alpnValue.length === 1 ? alpnValue[0].toString() : alpnValue.join(",");
  } else {
    alpn = "";
  }
  let hysteriaDict = {
    upmbps,
    downmbps,
    obfsParam,
    auth,
    protocol,
    insecure,
    peer,
    alpn
  };
  const filteredParams = Object.fromEntries(
    Object.entries(hysteriaDict).filter(([key, value]) => value !== "" && value !== null && value !== void 0)
  );
  const encodedParams = new URLSearchParams(filteredParams).toString();
  return `hysteria://${server}?${encodedParams}#[hysteria]_${server}`;
}
function hostAlreadyHasPort(server) {
  if (/^\[.*\]:\d+$/.test(server))
    return true;
  const idx = server.lastIndexOf(":");
  return idx >= 0 && server.indexOf(":") === idx && /^\d+$/.test(server.slice(idx + 1));
}
function parse_hy2(outbounds_n) {
  let server = findFieldValue(outbounds_n, "server") || "";
  if (server.startsWith("127.0.0.1") || server === "") {
    return "";
  }
  let port = findFieldValue(outbounds_n, "server_port") || findFieldValue(outbounds_n, "port") || 443;
  if (!hostAlreadyHasPort(server)) {
    if (server.includes(":") && !server.startsWith("[")) {
      server = `[${server}]`;
    }
    server = `${server}:${port}`;
  }
  let password = findFieldValue(outbounds_n, "password") || findFieldValue(outbounds_n, "auth");
  let obfs = findFieldValue(outbounds_n, "obfs") || "";
  let obfs_password = findFieldValue(outbounds_n, "obfs-password") || "";
  if (obfs && typeof obfs === "object") {
    obfs_password = obfs.password || "";
    obfs = obfs.type || "";
  }
  let sni = findFieldValue(outbounds_n, "sni") || findFieldValue(outbounds_n, "server_name") || "";
  let up = findFieldValue(outbounds_n, "up") || findFieldValue(outbounds_n, "up_mbps") || "80";
  let down = findFieldValue(outbounds_n, "down") || findFieldValue(outbounds_n, "down_mbps") || "100";
  let upmbps = parseInt(String(up).replace(/\D/g, ""), 10) || 0;
  let downmbps = parseInt(String(down).replace(/\D/g, ""), 10) || 0;
  let insecureFieldValue = findFieldValue(outbounds_n, "insecure");
  let insecure = [null, true].includes(insecureFieldValue) ? 1 : "";
  let hy2Dict = {
    upmbps,
    downmbps,
    obfs,
    "obfs-password": obfs_password,
    sni,
    insecure
  };
  const filteredParams = Object.fromEntries(
    Object.entries(hy2Dict).filter(([key, value]) => value !== "" && value !== null && value !== void 0)
  );
  const encodedParams = new URLSearchParams(filteredParams).toString();
  return `hy2://${encodeURIComponent(password || "")}@${server}?${encodedParams}#[hy2]_${server}`;
}
function resolveTlsSecurity(outbounds_n, publicKey) {
  if (publicKey)
    return "reality";
  const raw = findFieldValue(outbounds_n.streamSettings, "security") || findFieldValue(outbounds_n, "tls") || "";
  if (raw && typeof raw === "object") {
    if (raw.reality && raw.reality.enabled)
      return "reality";
    return raw.enabled ? "tls" : "";
  }
  if (raw === "none" || raw === "" || raw === false)
    return "";
  if (raw === true || raw === "tls")
    return "tls";
  return "";
}
function parse_vle55(outbounds_n) {
  let address = findFieldValue(outbounds_n, "address") || findFieldValue(outbounds_n, "server") || "";
  if (address === "127.0.0.1" || address === "") {
    return "";
  }
  let port = findFieldValue(outbounds_n, "port") || findFieldValue(outbounds_n, "server_port");
  let uuid = findFieldValue(outbounds_n, "id") || findFieldValue(outbounds_n, "uuid");
  let encryption = findFieldValue(outbounds_n, "encryption") || "none";
  let flow = findFieldValue(outbounds_n, "flow") || "";
  let network = findFieldValue(outbounds_n.transport, "type") || findFieldValue(outbounds_n, "network");
  if (typeof network !== "string")
    network = "";
  let host = findFieldValue(outbounds_n, "Host") || findFieldValue(outbounds_n, "host") || "";
  let path = findFieldValue(outbounds_n, "path") || findFieldValue(outbounds_n, "serviceName") || findFieldValue(outbounds_n, "service_name") || "";
  let public_key = findFieldValue(outbounds_n, "public-key") || findFieldValue(outbounds_n, "publicKey") || findFieldValue(outbounds_n, "public_key") || "";
  let short_id = findFieldValue(outbounds_n, "short-id") || findFieldValue(outbounds_n, "shortId") || findFieldValue(outbounds_n, "short_id") || "";
  let serverName = findFieldValue(outbounds_n, "serverName") || findFieldValue(outbounds_n, "servername") || findFieldValue(outbounds_n, "server_name") || "";
  if (host === "" && serverName === "") {
    host = address;
  } else if (host === "" && serverName !== "") {
    host = serverName;
  }
  let tls_security = resolveTlsSecurity(outbounds_n, public_key);
  if (tls_security === "" && network === "ws" && serverName !== "") {
    tls_security = "tls";
  }
  let fp = findFieldValue(outbounds_n, "fingerprint") || findFieldValue(outbounds_n, "client-fingerprint") || "";
  let vle55Dict = {
    encryption,
    // 加密方式
    flow,
    security: tls_security,
    // 传输层安全(TLS)
    sni: serverName,
    fp,
    pbk: public_key,
    sid: short_id,
    type: network,
    // 传输协议(network)
    host,
    // 伪装域名(host)
    path,
    headerType: ""
    // 伪装类型(type)
  };
  const filteredParams = Object.fromEntries(
    Object.entries(vle55Dict).filter(([key, value]) => value !== "" && value !== null && value !== void 0)
  );
  const encodedParams = new URLSearchParams(filteredParams).toString();
  return `${base64Decode("dmxlc3M6Ly8")}${encodeURIComponent(uuid || "")}@${address}:${port}?${encodedParams}#[${base64Decode("dmxlc3M")}]_${address}:${port}`;
}
function parse_vme55(outbounds_n) {
  let address = findFieldValue(outbounds_n, "address") || findFieldValue(outbounds_n, "server") || "";
  if (address === "127.0.0.1" || address === "") {
    return "";
  }
  let port = findFieldValue(outbounds_n, "port") || findFieldValue(outbounds_n, "server_port");
  let uuid = findFieldValue(outbounds_n, "id") || findFieldValue(outbounds_n, "uuid");
  let alterId = findFieldValue(outbounds_n, "alterId") || findFieldValue(outbounds_n, "alter_id") || 0;
  let auto_security = findFieldValue(outbounds_n, "cipher") || findFieldValue(outbounds_n.settings, "security") || "auto";
  let network = findFieldValue(outbounds_n.transport, "type") || findFieldValue(outbounds_n, "network");
  if (typeof network !== "string")
    network = "";
  let type_encryption = findFieldValue(outbounds_n, "encryption") || "none";
  let tls_security = resolveTlsSecurity(outbounds_n, "");
  let path = findFieldValue(outbounds_n, "path") || findFieldValue(outbounds_n, "ws-path") || findFieldValue(outbounds_n, "grpc-service-name") || findFieldValue(outbounds_n, "serviceName") || findFieldValue(outbounds_n, "service_name") || "/";
  let host = findFieldValue(outbounds_n, "Host") || findFieldValue(outbounds_n, "host") || "";
  let serverName = findFieldValue(outbounds_n, "sni") || findFieldValue(outbounds_n, "serverName") || findFieldValue(outbounds_n, "server_name") || "";
  if (serverName === "" && host === "") {
    host = address;
  }
  let fp = findFieldValue(outbounds_n, "client-fingerprint") || findFieldValue(outbounds_n, "fingerprint") || "";
  let vme55Dict = {
    v: "2",
    ps: `[${base64Decode("dm1lc3M")}]_${address}:${port}`,
    add: address,
    port,
    id: uuid,
    aid: alterId,
    // 额外ID(alterId)
    scy: auto_security,
    // 加密方式(security)
    net: network,
    // 传输协议(network)
    type: type_encryption,
    // 伪装类型(type)
    host,
    // 伪装域名(host)
    path,
    // 路径
    tls: tls_security,
    // 传输层安全(TLS)
    sni: serverName,
    alpn: "",
    fp
  };
  const jsonString = JSON.stringify(vme55Dict);
  const base64EncodedString = base64Encode(jsonString);
  return `${base64Decode("dm1lc3M6Ly8")}${base64EncodedString}`;
}
function parse_shadowsocks(outbounds_n) {
  let address = findFieldValue(outbounds_n, "address") || findFieldValue(outbounds_n, "server") || "";
  if (address === "127.0.0.1" || address === "") {
    return "";
  }
  let port = findFieldValue(outbounds_n, "port") || findFieldValue(outbounds_n, "server_port");
  let method = findFieldValue(outbounds_n, "method") || findFieldValue(outbounds_n, "cipher");
  let password = findFieldValue(outbounds_n, "password");
  let plugin = findFieldValue(outbounds_n, "plugin") || "";
  let plugin_opts = findFieldValue(outbounds_n, "plugin-opts") || findFieldValue(outbounds_n, "plugin_opts") || findFieldValue(outbounds_n, "pluginOpts") || "";
  let pluginParam = "";
  if (plugin) {
    pluginParam = plugin_opts ? `${plugin};${plugin_opts}` : plugin;
  }
  let method_with_password = `${method}:${password}`;
  let base64EncodedString = base64Encode(method_with_password);
  const query = pluginParam ? `?plugin=${encodeURIComponent(pluginParam)}` : "";
  return `${base64Decode("c3M6Ly8")}${base64EncodedString}@${address}:${port}${query}#[ss]_${address}`;
}
function parse_tr0jan(outbounds_n) {
  let server = findFieldValue(outbounds_n, "server") || "";
  if (server.startsWith("127.0.0.1") || server === "") {
    return "";
  }
  let port = findFieldValue(outbounds_n, "port") || findFieldValue(outbounds_n, "server_port");
  let password = findFieldValue(outbounds_n, "password");
  let network = findFieldValue(outbounds_n.transport, "type") || findFieldValue(outbounds_n, "network") || "tcp";
  if (typeof network !== "string")
    network = "tcp";
  let path = findFieldValue(outbounds_n, "path") || findFieldValue(outbounds_n, "serviceName") || findFieldValue(outbounds_n, "service_name") || "";
  let host = findFieldValue(outbounds_n, "Host") || findFieldValue(outbounds_n, "host") || "";
  let sni = findFieldValue(outbounds_n, "sni") || findFieldValue(outbounds_n, "server_name") || "";
  let fp = findFieldValue(outbounds_n, "client-fingerprint") || findFieldValue(outbounds_n, "fingerprint") || "";
  let alpn = findFieldValue(outbounds_n, "alpn") || "";
  let tls_security = resolveTlsSecurity(outbounds_n, "");
  if (sni) {
    tls_security = "tls";
  }
  let tr0janDict = {
    security: tls_security,
    allowInsecure: 1,
    sni,
    fp,
    type: network,
    host,
    alpn,
    path
  };
  const filteredParams = Object.fromEntries(
    Object.entries(tr0janDict).filter(([key, value]) => value !== "" && value !== null && value !== void 0)
  );
  const encodedParams = new URLSearchParams(filteredParams).toString();
  return `${base64Decode("dHJvamFuOi8v")}${encodeURIComponent(password || "")}@${server}:${port}?${encodedParams}#[${base64Decode("dHJvamFu")}]_${server}`;
}
function parse_tuic(outbounds_n) {
  let uuid = findFieldValue(outbounds_n, "uuid") || "";
  let password = findFieldValue(outbounds_n, "password") || "";
  let server = findFieldValue(outbounds_n, "server") || "";
  if (server === "127.0.0.1" || server === "" || uuid === "" || password === "") {
    return "";
  }
  let port = findFieldValue(outbounds_n, "port") || findFieldValue(outbounds_n, "server_port");
  let congestion_controller = findFieldValue(outbounds_n, "congestion-controller") || findFieldValue(outbounds_n, "congestion_control");
  let udp_relay_mode = findFieldValue(outbounds_n, "udp-relay-mode") || findFieldValue(outbounds_n, "udp_relay_mode");
  let sni = findFieldValue(outbounds_n, "sni") || findFieldValue(outbounds_n, "server_name") || "";
  let alpnValue = findFieldValue(outbounds_n, "alpn");
  var alpn;
  if (Array.isArray(alpnValue) && alpnValue.length === 1) {
    alpn = alpnValue[0].toString();
  } else if (Array.isArray(alpnValue) && alpnValue.length > 1) {
    alpn = alpnValue.join(",");
  } else {
    alpn = "";
  }
  let tuicDict = {
    congestion_control: congestion_controller,
    udp_relay_mode,
    alpn,
    sni,
    allow_insecure: 1
  };
  const filteredParams = Object.fromEntries(
    Object.entries(tuicDict).filter(([key, value]) => value !== "" && value !== null && value !== void 0)
  );
  const encodedParams = new URLSearchParams(filteredParams).toString();
  return `tuic://${encodeURIComponent(uuid)}:${encodeURIComponent(password)}@${server}:${port}?${encodedParams}#[tuic]_${server}`;
}
function isJuicity(jsonObject) {
  let juicity_listen = findFieldValue(jsonObject, "listen");
  let juicity_server = findFieldValue(jsonObject, "server");
  let juicity_uuid = findFieldValue(jsonObject, "uuid");
  let juicity_password = findFieldValue(jsonObject, "password");
  let juicity_sni = findFieldValue(jsonObject, "sni");
  let juicity_allow_insecure = findFieldValue(jsonObject, "allow_insecure");
  let juicity_congestion_control = findFieldValue(jsonObject, "congestion_control");
  if (juicity_listen && juicity_server && juicity_uuid && juicity_password && juicity_sni && juicity_allow_insecure && juicity_congestion_control) {
    return true;
  } else {
    return false;
  }
}
function isMieru(jsonObject) {
  let mieru_exist_profiles = Array.isArray(findFieldValue(jsonObject, "profiles"));
  let mieru_exist_portBindings = Array.isArray(findFieldValue(jsonObject, "portBindings"));
  let mieru_ipAddress = findFieldValue(jsonObject, "ipAddress");
  let mieru_rpcPort = findFieldValue(jsonObject, "rpcPort");
  let mieru_activeProfile = findFieldValue(jsonObject, "activeProfile");
  if (mieru_exist_profiles && mieru_exist_portBindings && mieru_ipAddress && mieru_rpcPort && mieru_activeProfile) {
    return true;
  } else {
    return false;
  }
}
function findFieldValue(obj, targetField) {
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      if (key === targetField) {
        return obj[key];
      } else if (typeof obj[key] === "object") {
        const result = findFieldValue(obj[key], targetField);
        if (result != void 0) {
          return result;
        }
      }
    }
  }
  return null;
}
async function fetchWebPageContent(url) {
  try {
    let response = await fetch(url, { signal: AbortSignal.timeout(8e3), redirect: "follow" });
    if (!response.ok) {
      throw new Error(`\u83B7\u53D6\u5931\u8D25: ${response.status}`);
    }
    let content = (await response.text()).replace(/!<str>/g, "");
    if (/<[a-z][^>]*>/i.test(content)) {
      content = stripHtmlTags(content);
    }
    return content;
  } catch (error) {
    console.error(`\u83B7\u53D6${url} \u7F51\u9875\u5185\u5BB9\u5931\u8D25: ${error.message}`);
    return "";
  }
}
function stripHtmlTags(str) {
  const entities = {
    "&lt;": "<",
    "&gt;": ">"
    // .....
  };
  const regex = new RegExp(
    "&(" + Object.keys(entities).map((e) => e.slice(1, -1)).join("|") + ");",
    "g"
  );
  let replaced = str.replace(regex, (match) => entities[match]);
  return replaced.replace(/<[^>]*>/g, "");
}
function splitClashDuplicated(content) {
  const lines = content.split(/\r?\n/);
  const chunks = [];
  let current = [];
  const seen = /* @__PURE__ */ new Set();
  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*/);
    if (match && seen.has(match[1])) {
      chunks.push(current.join("\n"));
      current = [];
      seen.clear();
    }
    if (match) {
      seen.add(match[1]);
    }
    current.push(line);
  }
  if (current.length > 0) {
    chunks.push(current.join("\n"));
  }
  return chunks;
}
function isBrokenLink(link) {
  return link.includes("=undefined") || link.includes(":null") || link.includes("null@") || link.includes("[object");
}
async function fetchAndProcessUrl(url) {
  const content = await fetchWebPageContent(url);
  let jsonObject;
  let outbounds;
  try {
    jsonObject = JSON.parse(content);
    outbounds = findFieldValue(jsonObject, "outbounds");
  } catch (e) {
    let links = v2rayLinksHandle(content);
    if (links.length > 0) {
      const uniqueSet = /* @__PURE__ */ new Set();
      let proxyPrefix = [
        "aHlzdGVyaWE6Ly8",
        "aHkyOi8v",
        "dmxlc3M6Ly8",
        "dm1lc3M6Ly8",
        "dHJvamFuOi8v",
        "c3M6Ly8",
        "dHVpYzovLw",
        "bmFpdmUraHR0cHM6Ly8"
      ];
      links.split("\n").forEach((link) => {
        if (isBrokenLink(link))
          return;
        if (proxyPrefix.some((prefix) => link.startsWith(base64Decode(prefix))))
          uniqueSet.add(link);
      });
      const uniqueArray = Array.from(uniqueSet);
      return uniqueArray;
    } else {
      const yamlObjects = yamlParseAll(content);
      let mergedProxies = [];
      for (const obj of yamlObjects) {
        if (obj && typeof obj === "object") {
          const ps = findFieldValue(obj, "proxies");
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
    let is_mieru = isMieru(jsonObject);
    if (is_mieru)
      return "";
    let is_juicity = isJuicity(jsonObject);
    if (is_juicity)
      return "";
    let server = findFieldValue(jsonObject, "server")?.replace(/,.*$/, "") || "";
    let pwd_auth = findFieldValue(jsonObject, "auth");
    let sni = findFieldValue(jsonObject, "sni");
    let insecureFieldValue = findFieldValue(jsonObject, "insecure");
    let insecure = [null, true].includes(insecureFieldValue) ? 1 : "";
    let upmbps = findFieldValue(jsonObject, "up_mbps");
    let downmbps = findFieldValue(jsonObject, "down_mbps");
    let obfsParam = findFieldValue(jsonObject, "obfs") || "";
    let auth = findFieldValue(jsonObject, "auth_str") || "";
    let protocol = findFieldValue(jsonObject, "protocol") || "";
    let peer = findFieldValue(jsonObject, "server_name") || "";
    let alpn = findFieldValue(jsonObject, "alpn");
    let recv_window = findFieldValue(jsonObject, "recv_window") || "";
    let recv_window_conn = findFieldValue(jsonObject, "recv_window_conn") || "";
    let proxyFieldValue = findFieldValue(jsonObject, "proxy");
    const pattern = /^https:\/\/.*@.*$/;
    const isMatch = pattern.test(proxyFieldValue);
    if (server && pwd_auth) {
      if (!hostAlreadyHasPort(server)) {
        if (server.includes(":") && !server.startsWith("[")) {
          server = `[${server}]`;
        }
        server = `${server}:443`;
      }
      const hy2Params = new URLSearchParams();
      if (insecure === 1)
        hy2Params.set("insecure", "1");
      if (sni)
        hy2Params.set("sni", sni);
      const hy2Query = hy2Params.toString();
      return `hy2://${encodeURIComponent(pwd_auth)}@${server}${hy2Query ? "?" + hy2Query : ""}#[hy2]_${server}`;
    } else if (server && auth && alpn && upmbps !== null && downmbps !== null) {
      if (!hostAlreadyHasPort(server)) {
        if (server.includes(":") && !server.startsWith("[")) {
          server = `[${server}]`;
        }
        server = `${server}:443`;
      }
      let hysteriaDict = {
        upmbps,
        downmbps,
        obfs: "xplus",
        obfsParam,
        auth,
        protocol,
        insecure,
        peer,
        alpn,
        recv_window,
        recv_window_conn
      };
      if (hysteriaDict["obfsParam"] === "") {
        delete hysteriaDict["obfs"];
      }
      const filteredParams = Object.fromEntries(
        Object.entries(hysteriaDict).filter(([key, value]) => value !== "" && value !== null && value !== void 0)
      );
      const encodedParams = new URLSearchParams(filteredParams).toString();
      return `${base64Decode("aHlzdGVyaWE6Ly8")}${server}?${encodedParams}#[hysteria]_${server}`;
    } else if (proxyFieldValue && isMatch && typeof proxyFieldValue === "string") {
      const colonIndex = proxyFieldValue.lastIndexOf(":");
      const atIndex = proxyFieldValue.lastIndexOf("@");
      const extractedContent = proxyFieldValue.substring(atIndex + 1, colonIndex);
      return `naive+${proxyFieldValue}#[naive]_${extractedContent}`;
    }
  } else if (outbounds && Array.isArray(outbounds)) {
    const uniqueSet = /* @__PURE__ */ new Set();
    let allProxyType = ["hysteria", "hy2", "vless", "vmess", "trojan", "ss", "tuic"];
    for (var i = 0; i < outbounds.length; i++) {
      let proxyType = findFieldValue(outbounds[i], "protocol");
      if (!allProxyType.includes(proxyType)) {
        proxyType = findFieldValue(outbounds[i], "type");
      }
      if (proxyType === base64Decode("aHlzdGVyaWE")) {
        let hy1 = parse_hysteria(outbounds[i]);
        if (hy1 && !isBrokenLink(hy1)) {
          uniqueSet.add(hy1);
        }
      } else if (proxyType === base64Decode("aHky") || proxyType === "hysteria2") {
        let hy2 = parse_hy2(outbounds[i]);
        if (hy2 && !isBrokenLink(hy2)) {
          uniqueSet.add(hy2);
        }
      } else if (proxyType === base64Decode("c3M")) {
        let ss = parse_shadowsocks(outbounds[i]);
        if (ss && !isBrokenLink(ss)) {
          uniqueSet.add(ss);
        }
      } else if (proxyType === base64Decode("dmxlc3M")) {
        let vle55 = parse_vle55(outbounds[i]);
        if (vle55 && !isBrokenLink(vle55)) {
          uniqueSet.add(vle55);
        }
      } else if (proxyType === base64Decode("dm1lc3M")) {
        let vme55 = parse_vme55(outbounds[i]);
        if (vme55 && !isBrokenLink(vme55)) {
          uniqueSet.add(vme55);
        }
      } else if (proxyType === base64Decode("dHJvamFu")) {
        let tr0jan = parse_tr0jan(outbounds[i]);
        if (tr0jan && !isBrokenLink(tr0jan)) {
          uniqueSet.add(tr0jan);
        }
      } else if (proxyType === base64Decode("dHVpYw")) {
        let tuic = parse_tuic(outbounds[i]);
        if (tuic && !isBrokenLink(tuic)) {
          uniqueSet.add(tuic);
        }
      }
    }
    const uniqueArray = Array.from(uniqueSet);
    return uniqueArray;
  }
}
function base64Encode(str) {
  const encoder = new TextEncoder();
  const uint8Array = encoder.encode(str);
  const chunkSize = 32768;
  let binary = "";
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}
function base64Decode(base64Str) {
  let binary = atob(base64Str);
  let bytes = new Uint8Array([...binary].map((char) => char.charCodeAt(0)));
  let decoder = new TextDecoder();
  return decoder.decode(bytes);
}
function normalizeBase64(str) {
  const noPad = str.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  return noPad + "=".repeat((4 - noPad.length % 4) % 4);
}
function isValidBase64(str) {
  if (typeof str !== "string")
    return false;
  str = str.trim();
  if (str === "")
    return false;
  const cleaned = str.replace(/\s+/g, "");
  const normalized = normalizeBase64(cleaned);
  const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  if (!base64Regex.test(normalized))
    return false;
  try {
    const binaryStr = atob(normalized);
    new Uint8Array([...binaryStr].map((c) => c.charCodeAt(0)));
    return true;
  } catch (e) {
    return false;
  }
}
function v2rayLinksHandle(str) {
  let isBase64Str = isValidBase64(str);
  let proxyPrefix = [
    "aHlzdGVyaWE6Ly8",
    "aHkyOi8v",
    "dmxlc3M6Ly8",
    "dm1lc3M6Ly8",
    "dHJvamFuOi8v",
    "c3M6Ly8",
    "dHVpYzovLw",
    "bmFpdmUraHR0cHM6Ly8"
  ];
  if (typeof str === "string" && !isBase64Str && proxyPrefix.some((prefix) => str.includes(base64Decode(prefix)))) {
    return str;
  } else if (!isBase64Str) {
    return "";
  }
  try {
    return base64Decode(normalizeBase64(str.replace(/\s+/g, "")));
  } catch (e) {
    return "";
  }
}
var targetUrls = [
  // ChromeGo/EdgeGo的订阅链接(重新加入fastly.jsdelivr.net等镜像,与gitlabip.xyz/gitlab.com互为备用)
  "https://chg64.makou.cc.cd",
  "https://chg26.makou.cc.cd",
  "https://raw.githubusercontent.com/ttanzj/chromego_py/main/outputs/sub_base64.txt",
  "https://raw.githubusercontent.com/Pawdroid/Free-servers/main/sub",
  // AutoMergePublicNodes / NoMoreWalls 的多个CDN镜像(内容相同,互为备用)
  "https://cdn.jsdelivr.net/gh/chengaopan/AutoMergePublicNodes@master/list.meta.yml",
  "https://cdn.jsdelivr.net/gh/peasoft/NoMoreWalls@master/list.meta.yml",
  "https://fastly.jsdelivr.net/gh/chengaopan/AutoMergePublicNodes@master/list.meta.yml",
  "https://fastly.jsdelivr.net/gh/peasoft/NoMoreWalls@master/list.meta.yml",
  "https://gcore.jsdelivr.net/gh/peasoft/NoMoreWalls@master/list.meta.yml",
  // ghproxy.cn 已失效(返回HTML拦截页),已移除;ghproxy.net 仍可用
  "https://ghproxy.net/https://raw.githubusercontent.com/peasoft/NoMoreWalls/master/list.meta.yml",
  "https://raw.githubusercontent.com/chengaopan/AutoMergePublicNodes/master/list.meta.yml",
  "https://raw.githubusercontent.com/peasoft/NoMoreWalls/master/list.meta.yml",
  "https://testingcf.jsdelivr.net/gh/peasoft/NoMoreWalls@master/list.meta.yml",
  // gitlabip.xyz / gitlab.com 的 ChromeGo/EdgeGo 订阅链接
  "https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/naiveproxy/2/config.json",
  "https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/hysteria2/2/config.json",
  "https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/hysteria2/3/config.json",
  "https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/naiveproxy/1/config.json",
  "https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/xray/2/config.json",
  "https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/xray/4/config.json",
  "https://gitlab.com/free9999/ipupdate/-/raw/master/backup/img/1/2/ip/singbox/2/config.json",
  "https://gitlab.com/free9999/ipupdate/-/raw/master/backup/img/1/2/ipp/singbox/1/config.json",
  "https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/hysteria/2/config.json",
  "https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/hysteria/3/config.json",
  "https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/hysteria/1/config.json",
  "https://gitlab.com/free9999/ipupdate/-/raw/master/backup/img/1/2/ipp/hysteria/3/config.json",
  "https://gitlab.com/free9999/ipupdate/-/raw/master/backup/img/1/2/ip/singbox/config.json",
  "https://gitlab.com/free9999/ipupdate/-/raw/master/hysteria/2/config.json",
  "https://gitlab.com/free9999/ipupdate/-/raw/master/hysteria2/2/config.json",
  "https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/clash.meta2/5/config.yaml",
  "https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/clash.meta2/4/config.yaml",
  "https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ipp/clash.meta2/1/config.yaml",
  "https://www.gitlabip.xyz/Alvin9999/PAC/master/backup/img/1/2/ip/clash.meta2/1/config.yaml",
  "https://www.gitlabip.xyz/Alvin9999/pac2/master/quick/config.yaml",
  "https://www.gitlabip.xyz/Alvin9999/pac2/master/quick/4/config.yaml",
  // 也可以添加其它来源且数据格式为json或yaml的订阅链接
  // 可以添加明文v2ray分享链接的订阅或base64订阅链接
  "https://ghfast.top/https://raw.githubusercontent.com/free18/v2ray/refs/heads/main/v.txt"
];
async function processUrls(targetUrls2) {
  const results = [];
  const maxConcurrency = 8;
  const asyncPool = async (poolLimit, array, iteratorFn) => {
    const results2 = [];
    const executing = [];
    for (const item of array) {
      const promise = Promise.resolve().then(() => iteratorFn(item));
      results2.push(promise);
      if (executing.length < poolLimit) {
        const executingPromise = promise.then(() => executing.splice(executing.indexOf(executingPromise), 1));
        executing.push(executingPromise);
      } else {
        await Promise.race(executing);
      }
    }
    return Promise.all(results2);
  };
  await asyncPool(maxConcurrency, targetUrls2, async (url) => {
    try {
      const link = await fetchAndProcessUrl(url);
      if (Array.isArray(link)) {
        link.forEach((item) => {
          if (!results.includes(item)) {
            results.push(item);
          }
        });
      } else if (link && !results.includes(link)) {
        results.push(link);
      }
    } catch (error) {
      console.error(`\u5904\u7406${url} \u5931\u8D25: ${error.message}`);
    }
  });
  return results;
}
function safeDecode(str) {
  try {
    return decodeURIComponent(str);
  } catch (e) {
    return str;
  }
}
function splitShareLink(link) {
  const hashIndex = link.indexOf("#");
  const fragment = hashIndex >= 0 ? safeDecode(link.slice(hashIndex + 1)) : "";
  const beforeHash = hashIndex >= 0 ? link.slice(0, hashIndex) : link;
  const queryIndex = beforeHash.indexOf("?");
  const params = new URLSearchParams(queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : "");
  const base = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  return { base, params, fragment };
}
function splitHostPort(str, defaultPort) {
  str = str || "";
  if (str.startsWith("[")) {
    const end = str.indexOf("]");
    if (end >= 0) {
      const host = str.slice(1, end);
      const rest = str.slice(end + 1);
      const port = rest.startsWith(":") ? rest.slice(1) : "";
      return { host, port: port ? parseInt(port, 10) : defaultPort };
    }
  }
  const idx = str.lastIndexOf(":");
  if (idx >= 0) {
    return { host: str.slice(0, idx), port: parseInt(str.slice(idx + 1), 10) || defaultPort };
  }
  return { host: str, port: defaultPort };
}
function vmessNodeFromJson(j) {
  const name = j.ps || `${j.add}:${j.port}`;
  return {
    type: "vmess",
    name,
    server: j.add,
    port: parseInt(j.port, 10) || 443,
    uuid: j.id,
    alterId: parseInt(j.aid, 10) || 0,
    cipher: j.scy || "auto",
    network: j.net || "tcp",
    headerType: j.type || "none",
    host: j.host || "",
    path: j.path || "/",
    tls: j.tls === "tls" || j.tls === true,
    sni: j.sni || "",
    alpn: j.alpn || "",
    fp: j.fp || ""
  };
}
function parseShareLink(link) {
  link = String(link).trim();
  let type = "";
  if (link.startsWith("vless://"))
    type = "vless";
  else if (link.startsWith("vmess://"))
    type = "vmess";
  else if (link.startsWith("trojan://"))
    type = "trojan";
  else if (link.startsWith("ss://"))
    type = "ss";
  else if (link.startsWith("hysteria://"))
    type = "hysteria";
  else if (link.startsWith("hy2://"))
    type = "hy2";
  else if (link.startsWith("tuic://"))
    type = "tuic";
  else if (link.startsWith("naive+https://"))
    type = "naive";
  if (!type)
    return null;
  try {
    const scheme = type === "naive" ? "naive+https://" : `${type}://`;
    const { base, params, fragment } = splitShareLink(link);
    const rest = base.slice(scheme.length);
    const atIndex = rest.lastIndexOf("@");
    const userinfo = atIndex >= 0 ? rest.slice(0, atIndex) : rest;
    const hostPort = atIndex >= 0 ? rest.slice(atIndex + 1) : rest;
    if (type === "vless") {
      const { host, port } = splitHostPort(hostPort, 443);
      return {
        type,
        name: fragment || `${host}:${port}`,
        server: host,
        port,
        uuid: safeDecode(userinfo),
        flow: params.get("flow") || "",
        security: params.get("security") || "",
        sni: params.get("sni") || "",
        fp: params.get("fp") || "",
        pbk: params.get("pbk") || "",
        sid: params.get("sid") || "",
        network: params.get("type") || "tcp",
        host: params.get("host") || "",
        path: params.get("path") || "",
        alpn: params.get("alpn") || ""
      };
    }
    if (type === "vmess") {
      if (atIndex >= 0) {
        const { host, port } = splitHostPort(hostPort, 443);
        return vmessNodeFromJson({
          ps: fragment || `${host}:${port}`,
          add: host,
          port,
          id: safeDecode(userinfo),
          aid: params.get("aid") || 0,
          scy: params.get("scy") || "auto",
          net: params.get("type") || "tcp",
          type: params.get("headerType") || "none",
          host: params.get("host") || "",
          path: params.get("path") || "/",
          tls: params.get("security") === "tls" ? "tls" : "",
          sni: params.get("sni") || "",
          alpn: params.get("alpn") || "",
          fp: params.get("fp") || ""
        });
      }
      try {
        return vmessNodeFromJson(JSON.parse(base64Decode(safeDecode(userinfo))));
      } catch (e) {
        return null;
      }
    }
    if (type === "trojan") {
      const { host, port } = splitHostPort(hostPort, 443);
      return {
        type,
        name: fragment || `${host}:${port}`,
        server: host,
        port,
        password: safeDecode(userinfo),
        security: params.get("security") || "",
        sni: params.get("sni") || "",
        fp: params.get("fp") || "",
        alpn: params.get("alpn") || "",
        network: params.get("type") || "tcp",
        host: params.get("host") || "",
        path: params.get("path") || "",
        allowInsecure: ["1", "true", "yes"].includes(
          (params.get("allowInsecure") || params.get("allow_insecure") || "").toLowerCase()
        )
      };
    }
    if (type === "ss") {
      const { host, port } = splitHostPort(hostPort, 8388);
      let raw = safeDecode(userinfo);
      if (isValidBase64(raw)) {
        raw = base64Decode(raw);
      }
      const colonIndex = raw.indexOf(":");
      const method = colonIndex >= 0 ? raw.slice(0, colonIndex) : raw;
      const password = colonIndex >= 0 ? raw.slice(colonIndex + 1) : "";
      return {
        type,
        name: fragment || `${host}:${port}`,
        server: host,
        port,
        method,
        password,
        plugin: params.get("plugin") || ""
      };
    }
    if (type === "hysteria") {
      const { host, port } = splitHostPort(hostPort, 443);
      const up = params.get("upmbps") || "";
      const down = params.get("downmbps") || "";
      return {
        type,
        name: fragment || `${host}:${port}`,
        server: host,
        port,
        up: up ? parseInt(String(up).replace(/\D/g, ""), 10) : "",
        down: down ? parseInt(String(down).replace(/\D/g, ""), 10) : "",
        obfs: params.get("obfs") || "",
        obfsParam: params.get("obfsParam") || "",
        auth: params.get("auth") || params.get("auth_str") || "",
        protocol: params.get("protocol") || "",
        insecure: params.get("insecure") === "1",
        peer: params.get("peer") || "",
        alpn: params.get("alpn") || ""
      };
    }
    if (type === "hy2") {
      const { host, port } = splitHostPort(hostPort, 443);
      const up = params.get("upmbps") || "";
      const down = params.get("downmbps") || "";
      return {
        type,
        name: fragment || `${host}:${port}`,
        server: host,
        port,
        password: safeDecode(userinfo),
        up: up ? parseInt(String(up).replace(/\D/g, ""), 10) : "",
        down: down ? parseInt(String(down).replace(/\D/g, ""), 10) : "",
        obfs: params.get("obfs") || "",
        obfsPassword: params.get("obfs-password") || "",
        sni: params.get("sni") || "",
        insecure: params.get("insecure") === "1"
      };
    }
    if (type === "tuic") {
      const { host, port } = splitHostPort(hostPort, 443);
      const colonIndex = userinfo.lastIndexOf(":");
      return {
        type,
        name: fragment || `${host}:${port}`,
        server: host,
        port,
        uuid: safeDecode(colonIndex >= 0 ? userinfo.slice(0, colonIndex) : userinfo),
        password: colonIndex >= 0 ? safeDecode(userinfo.slice(colonIndex + 1)) : "",
        congestion: params.get("congestion_control") || "",
        udpRelayMode: params.get("udp_relay_mode") || "",
        alpn: params.get("alpn") || "",
        sni: params.get("sni") || "",
        insecure: params.get("allow_insecure") === "1"
      };
    }
    if (type === "naive") {
      const { host, port } = splitHostPort(hostPort, 443);
      const colonIndex = userinfo.lastIndexOf(":");
      return {
        type,
        name: fragment || `${host}:${port}`,
        server: host,
        port,
        username: safeDecode(colonIndex >= 0 ? userinfo.slice(0, colonIndex) : userinfo),
        password: colonIndex >= 0 ? safeDecode(userinfo.slice(colonIndex + 1)) : ""
      };
    }
    return null;
  } catch (e) {
    console.error(`\u89E3\u6790\u5206\u4EAB\u94FE\u63A5\u5931\u8D25: ${e.message}`);
    return null;
  }
}
function dedupeNodeNames(nodes) {
  const seen = /* @__PURE__ */ new Map();
  return nodes.map((node) => {
    const baseName = node.name || `${node.server}:${node.port}`;
    const count = seen.get(baseName) || 0;
    seen.set(baseName, count + 1);
    return { ...node, name: count === 0 ? baseName : `${baseName}_${count + 1}` };
  });
}
function clashServer(host) {
  return host && host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}
function splitPlugin(plugin) {
  if (!plugin)
    return { name: "", opts: "" };
  const sep = plugin.indexOf(";");
  if (sep >= 0)
    return { name: plugin.slice(0, sep), opts: plugin.slice(sep + 1) };
  return { name: plugin, opts: "" };
}
function buildClashConfig(nodes) {
  const proxies = dedupeNodeNames(nodes).map(toClashProxy).filter(Boolean);
  if (proxies.length === 0)
    return { proxies: [] };
  const names = proxies.map((p) => p.name);
  return {
    proxies,
    "proxy-groups": [
      {
        name: "\u267B\uFE0F \u81EA\u52A8\u9009\u62E9",
        type: "url-test",
        url: "http://www.gstatic.com/generate_204",
        interval: 300,
        proxies: names
      },
      {
        name: "\u{1F680} \u8282\u70B9\u9009\u62E9",
        type: "select",
        proxies: ["\u267B\uFE0F \u81EA\u52A8\u9009\u62E9", ...names]
      }
    ]
  };
}
function toClashProxy(node) {
  try {
    switch (node.type) {
      case "vless":
        return toClashVless(node);
      case "vmess":
        return toClashVmess(node);
      case "trojan":
        return toClashTrojan(node);
      case "ss":
        return toClashSs(node);
      case "hysteria":
        return toClashHysteria(node);
      case "hy2":
        return toClashHy2(node);
      case "tuic":
        return toClashTuic(node);
      case "naive":
        return toClashNaive(node);
      default:
        return null;
    }
  } catch (e) {
    console.error(`\u8F6C\u6362clash\u8282\u70B9\u5931\u8D25(${node.name}): ${e.message}`);
    return null;
  }
}
function clashTransportOpts(node, network) {
  if (network === "ws") {
    const opts = {};
    if (node.path)
      opts.path = node.path;
    if (node.host)
      opts.headers = { Host: node.host };
    return Object.keys(opts).length > 0 ? opts : void 0;
  } else if (network === "grpc") {
    if (node.path)
      return { "grpc-service-name": node.path };
    return void 0;
  } else if (network === "http") {
    const opts = {};
    if (node.path)
      opts.path = [node.path];
    if (node.host)
      opts.headers = { Host: [node.host] };
    return Object.keys(opts).length > 0 ? opts : void 0;
  }
  return void 0;
}
function toClashVless(node) {
  const proxy = { name: node.name, type: "vless", server: clashServer(node.server), port: node.port, uuid: node.uuid, udp: true };
  const network = node.network || "tcp";
  if (network !== "tcp")
    proxy.network = network;
  if (node.flow && network === "tcp")
    proxy.flow = node.flow;
  if (node.security === "reality" || node.pbk) {
    proxy.tls = true;
    if (node.sni)
      proxy.servername = node.sni;
    if (node.fp)
      proxy["client-fingerprint"] = node.fp;
    proxy["reality-opts"] = { "public-key": node.pbk || "", "short-id": node.sid || "" };
  } else if (node.security === "tls" || node.sni) {
    proxy.tls = true;
    if (node.sni)
      proxy.servername = node.sni;
    if (node.fp)
      proxy["client-fingerprint"] = node.fp;
  }
  const transport = clashTransportOpts(node, network);
  if (transport) {
    proxy[network === "ws" ? "ws-opts" : network === "grpc" ? "grpc-opts" : "http-opts"] = transport;
  }
  return proxy;
}
function toClashVmess(node) {
  const proxy = {
    name: node.name,
    type: "vmess",
    server: clashServer(node.server),
    port: node.port,
    uuid: node.uuid,
    alterId: node.alterId || 0,
    cipher: node.cipher || "auto",
    udp: true
  };
  const network = node.network || "tcp";
  if (network !== "tcp")
    proxy.network = network;
  if (node.tls || node.sni) {
    proxy.tls = true;
    if (node.sni)
      proxy.servername = node.sni;
    if (node.fp)
      proxy["client-fingerprint"] = node.fp;
  }
  const transport = clashTransportOpts(node, network);
  if (transport) {
    proxy[network === "ws" ? "ws-opts" : network === "grpc" ? "grpc-opts" : "http-opts"] = transport;
  }
  return proxy;
}
function toClashTrojan(node) {
  const proxy = {
    name: node.name,
    type: "trojan",
    server: clashServer(node.server),
    port: node.port,
    password: node.password,
    udp: true
  };
  const network = node.network || "tcp";
  if (network !== "tcp")
    proxy.network = network;
  if (node.sni || node.security === "tls")
    proxy.sni = node.sni || node.server;
  if (node.allowInsecure)
    proxy["skip-cert-verify"] = true;
  if (node.fp)
    proxy["client-fingerprint"] = node.fp;
  if (node.alpn)
    proxy.alpn = node.alpn.split(",").map((s) => s.trim()).filter(Boolean);
  const transport = clashTransportOpts(node, network);
  if (transport) {
    proxy[network === "ws" ? "ws-opts" : network === "grpc" ? "grpc-opts" : "http-opts"] = transport;
  }
  return proxy;
}
function toClashSs(node) {
  const proxy = {
    name: node.name,
    type: "ss",
    server: clashServer(node.server),
    port: node.port,
    cipher: node.method,
    password: node.password,
    udp: true
  };
  if (node.plugin) {
    const { name: pname, opts: popts } = splitPlugin(node.plugin);
    proxy.plugin = pname;
    if (popts)
      proxy["plugin-opts"] = popts;
  }
  return proxy;
}
function toClashHysteria(node) {
  const proxy = { name: node.name, type: "hysteria", server: clashServer(node.server), port: node.port, udp: true };
  proxy.up = node.up ? String(node.up) : "20";
  proxy.down = node.down ? String(node.down) : "100";
  if (node.auth)
    proxy["auth-str"] = node.auth;
  if (node.obfsParam)
    proxy.obfs = node.obfsParam;
  else if (node.obfs)
    proxy.obfs = node.obfs;
  if (node.protocol)
    proxy.protocol = node.protocol;
  if (node.peer || node.sni)
    proxy.sni = node.peer || node.sni;
  if (node.insecure)
    proxy["skip-cert-verify"] = true;
  if (node.alpn)
    proxy.alpn = node.alpn.split(",").map((s) => s.trim()).filter(Boolean);
  return proxy;
}
function toClashHy2(node) {
  const proxy = {
    name: node.name,
    type: "hysteria2",
    server: clashServer(node.server),
    port: node.port,
    password: node.password,
    udp: true
  };
  if (node.up)
    proxy.up = String(node.up);
  if (node.down)
    proxy.down = String(node.down);
  if (node.sni)
    proxy.sni = node.sni;
  if (node.obfs)
    proxy.obfs = node.obfs;
  if (node.obfsPassword)
    proxy["obfs-password"] = node.obfsPassword;
  if (node.insecure)
    proxy["skip-cert-verify"] = true;
  return proxy;
}
function toClashTuic(node) {
  const proxy = {
    name: node.name,
    type: "tuic",
    server: clashServer(node.server),
    port: node.port,
    uuid: node.uuid,
    password: node.password,
    udp: true
  };
  if (node.congestion)
    proxy["congestion-controller"] = node.congestion;
  if (node.udpRelayMode)
    proxy["udp-relay-mode"] = node.udpRelayMode;
  if (node.alpn)
    proxy.alpn = node.alpn.split(",").map((s) => s.trim()).filter(Boolean);
  if (node.sni)
    proxy.sni = node.sni;
  if (node.insecure)
    proxy["skip-cert-verify"] = true;
  return proxy;
}
function toClashNaive(node) {
  return {
    name: node.name,
    type: "naive",
    server: clashServer(node.server),
    port: node.port,
    username: node.username,
    password: node.password,
    udp: true,
    tls: true
  };
}
function buildSingboxConfig(nodes) {
  return { version: 1, outbounds: dedupeNodeNames(nodes).map(toSingboxOutbound).filter(Boolean) };
}
function toSingboxOutbound(node) {
  try {
    switch (node.type) {
      case "vless":
        return singboxVless(node);
      case "vmess":
        return singboxVmess(node);
      case "trojan":
        return singboxTrojan(node);
      case "ss":
        return singboxSs(node);
      case "hysteria":
        return singboxHysteria(node);
      case "hy2":
        return singboxHy2(node);
      case "tuic":
        return singboxTuic(node);
      case "naive":
        return singboxNaive(node);
      default:
        return null;
    }
  } catch (e) {
    console.error(`\u8F6C\u6362sing-box\u8282\u70B9\u5931\u8D25(${node.name}): ${e.message}`);
    return null;
  }
}
function singboxTls(node, forceEnabled) {
  const enabled = forceEnabled || node.security === "reality" || node.pbk || node.security === "tls" || node.sni || node.tls;
  if (!enabled)
    return void 0;
  const tls = { enabled: true };
  if (node.security === "reality" || node.pbk) {
    tls.reality = { enabled: true, public_key: node.pbk || "", short_id: node.sid || "" };
  }
  if (node.sni)
    tls.server_name = node.sni;
  if (node.insecure)
    tls.insecure = true;
  if (node.fp)
    tls.utls = { enabled: true, fingerprint: node.fp };
  if (node.alpn)
    tls.alpn = node.alpn.split(",").map((s) => s.trim()).filter(Boolean);
  return tls;
}
function singboxTransport(node) {
  const network = node.network || "tcp";
  if (network === "tcp" || network === "")
    return void 0;
  if (network === "ws") {
    const t = { type: "ws" };
    if (node.path)
      t.path = node.path;
    if (node.host)
      t.headers = { Host: node.host };
    return t;
  }
  if (network === "grpc") {
    const t = { type: "grpc" };
    if (node.path)
      t.service_name = node.path;
    return t;
  }
  if (network === "http") {
    const t = { type: "http" };
    if (node.path)
      t.path = node.path;
    if (node.host)
      t.host = node.host;
    return t;
  }
  if (network === "h2" || network === "httpupgrade") {
    const t = { type: "httpupgrade" };
    if (node.path)
      t.path = node.path;
    if (node.host)
      t.host = node.host;
    return t;
  }
  return void 0;
}
function singboxVless(node) {
  const ob = { type: "vless", tag: node.name, server: node.server, server_port: node.port, uuid: node.uuid };
  if (node.flow && (node.network || "tcp") === "tcp")
    ob.flow = node.flow;
  ob.packet_encoding = "xudp";
  const tls = singboxTls(node, false);
  if (tls)
    ob.tls = tls;
  const transport = singboxTransport(node);
  if (transport)
    ob.transport = transport;
  return ob;
}
function singboxVmess(node) {
  const ob = {
    type: "vmess",
    tag: node.name,
    server: node.server,
    server_port: node.port,
    uuid: node.uuid,
    security: node.cipher || "auto"
  };
  if (node.alterId)
    ob.alter_id = node.alterId;
  const tls = singboxTls(node, false);
  if (tls)
    ob.tls = tls;
  const transport = singboxTransport(node);
  if (transport)
    ob.transport = transport;
  return ob;
}
function singboxTrojan(node) {
  const ob = {
    type: "trojan",
    tag: node.name,
    server: node.server,
    server_port: node.port,
    password: node.password
  };
  const tls = singboxTls(node, true);
  if (tls)
    ob.tls = tls;
  const transport = singboxTransport(node);
  if (transport)
    ob.transport = transport;
  return ob;
}
function singboxSs(node) {
  const ob = {
    type: "shadowsocks",
    tag: node.name,
    server: node.server,
    server_port: node.port,
    method: node.method,
    password: node.password
  };
  if (node.plugin) {
    const { name, opts } = splitPlugin(node.plugin);
    ob.plugin = name;
    if (opts)
      ob.plugin_opts = opts;
  }
  return ob;
}
function singboxHysteria(node) {
  const ob = { type: "hysteria", tag: node.name, server: node.server, server_port: node.port };
  ob.up_mbps = node.up || 20;
  ob.down_mbps = node.down || 100;
  if (node.auth)
    ob.auth_str = node.auth;
  if (node.obfsParam)
    ob.obfs = node.obfsParam;
  else if (node.obfs)
    ob.obfs = node.obfs;
  const tls = { enabled: true };
  if (node.peer || node.sni)
    tls.server_name = node.peer || node.sni;
  if (node.insecure)
    tls.insecure = true;
  if (node.alpn)
    tls.alpn = node.alpn.split(",").map((s) => s.trim()).filter(Boolean);
  ob.tls = tls;
  return ob;
}
function singboxHy2(node) {
  const ob = {
    type: "hysteria2",
    tag: node.name,
    server: node.server,
    server_port: node.port,
    password: node.password
  };
  if (node.up)
    ob.up_mbps = node.up;
  if (node.down)
    ob.down_mbps = node.down;
  if (node.obfs || node.obfsPassword) {
    ob.obfs = { type: node.obfs || "salamander" };
    if (node.obfsPassword)
      ob.obfs.password = node.obfsPassword;
  }
  const tls = { enabled: true };
  if (node.sni)
    tls.server_name = node.sni;
  if (node.insecure)
    tls.insecure = true;
  if (node.alpn)
    tls.alpn = node.alpn.split(",").map((s) => s.trim()).filter(Boolean);
  ob.tls = tls;
  return ob;
}
function singboxTuic(node) {
  const ob = {
    type: "tuic",
    tag: node.name,
    server: node.server,
    server_port: node.port,
    uuid: node.uuid,
    password: node.password
  };
  if (node.congestion)
    ob.congestion_control = node.congestion;
  if (node.udpRelayMode)
    ob.udp_relay_mode = node.udpRelayMode;
  const tls = { enabled: true };
  if (node.sni)
    tls.server_name = node.sni;
  if (node.insecure)
    tls.insecure = true;
  if (node.alpn)
    tls.alpn = node.alpn.split(",").map((s) => s.trim()).filter(Boolean);
  ob.tls = tls;
  return ob;
}
function singboxNaive(node) {
  return {
    type: "naive",
    tag: node.name,
    server: node.server,
    server_port: node.port,
    username: node.username,
    password: node.password
  };
}
function normalizeFormat(format) {
  const f = (format || "").trim().toLowerCase();
  if (["clash", "clashyaml", "clash-meta", "yaml"].includes(f))
    return "clash";
  if (["singbox", "sing-box", "sing_box", "singboxjson", "json"].includes(f))
    return "singbox";
  if (["plain", "v2ray", "text", "txt"].includes(f))
    return "plain";
  return "base64";
}
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const format = normalizeFormat(url.searchParams.get("format"));
    const cache = globalThis.caches ? caches.default : null;
    url.searchParams.delete("format");
    url.searchParams.set("_cachev", "2");
    const dataCacheKey = new Request(url.toString(), { method: "GET" });
    let linksText = "";
    if (cache) {
      try {
        const cached = await cache.match(dataCacheKey);
        if (cached) {
          linksText = await cached.text();
        }
      } catch (cacheError) {
        console.error(`\u7F13\u5B58\u8BFB\u53D6\u5931\u8D25: ${cacheError.message}`);
      }
    }
    if (linksText === "") {
      try {
        let resultsArray = await processUrls(targetUrls);
        let uniqueStrings = [...new Set(resultsArray)].filter((item) => item !== "" && !isBrokenLink(item));
        let sortedArray = uniqueStrings.sort((a, b) => {
          const compareByLetters = a.localeCompare(b);
          if (compareByLetters === 0) {
            const numA = parseInt(a, 10) || 0;
            const numB = parseInt(b, 10) || 0;
            const compareByNumbers = numA - numB;
            if (compareByNumbers === 0) {
              return a.length - b.length;
            }
            return compareByNumbers;
          }
          return compareByLetters;
        });
        linksText = sortedArray.join("\n");
        if (cache) {
          const dataResponse = new Response(linksText, {
            headers: { "Cache-Control": "public, max-age=1800, s-maxage=1800" }
          });
          ctx.waitUntil(
            cache.put(dataCacheKey, dataResponse).catch(
              (cacheError) => console.error(`\u7F13\u5B58\u5199\u5165\u5931\u8D25: ${cacheError.message}`)
            )
          );
        }
      } catch (error) {
        console.error(`Error in fetch function: ${error.message}`);
        return new Response(`Error fetching web page: ${error.message}`, {
          status: 500
        });
      }
    }
    if (linksText === "") {
      return new Response("\u83B7\u53D6\u8BA2\u9605\u5931\u8D25: \u6240\u6709\u8BA2\u9605\u6E90\u5747\u4E0D\u53EF\u7528,\u8BF7\u68C0\u67E5 targetUrls \u91CC\u7684\u94FE\u63A5\u662F\u5426\u5931\u6548,\u6216\u7A0D\u540E\u518D\u8BD5\u3002", {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=UTF-8"
        }
      });
    }
    let body = "";
    let contentType = "text/plain; charset=UTF-8";
    if (format === "clash" || format === "singbox") {
      const nodes = linksText.split("\n").map(parseShareLink).filter(Boolean);
      if (nodes.length === 0) {
        return new Response("\u83B7\u53D6\u8BA2\u9605\u5931\u8D25: \u65E0\u6CD5\u89E3\u6790\u4EFB\u4F55\u8282\u70B9\u3002", {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=UTF-8" }
        });
      }
      if (format === "clash") {
        body = yamlDump(buildClashConfig(nodes));
        contentType = "text/yaml; charset=UTF-8";
      } else {
        body = JSON.stringify(buildSingboxConfig(nodes), null, 2);
        contentType = "application/json; charset=UTF-8";
      }
    } else if (format === "plain") {
      body = linksText;
    } else {
      body = base64Encode(linksText);
    }
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=1800, s-maxage=1800"
      }
    });
  }
};
export {
  worker_default as default
};
