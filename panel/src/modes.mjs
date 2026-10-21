// CFusion P2：WARP / MASQUE 订阅模式（面板侧节点生成器）。
// 语义实读自 CFNext（~/workspace/cfnext-plus/CFNext-明文版.js）：
//   _wgNodes() 节点构建、_wEp() 端点解析、_wgLines() 分享链接、Ee() 的 clash 渲染、Le() 的 sing-box 渲染。
// 中间结构与 CFNext 一致：{name, host, port, local:[v4,v6], k, p, cid, mg?, sni?, msnet?}。
//
// 与 CFNext 的关键差异（有意为之，见 P2_REPORT）：
//   CFNext 在 warpConf/masqueConf 缺失时会在首次订阅时向 Cloudflare 客户端注册接口
//   自动生成密钥对并注册账号、回写 KV。CFusion 不做自动注册——凭据只能由用户以
//   CFNext 同格式的 warpConf / masqueConf JSON 提供；缺失或不完整时 fail-closed，
//   不输出任何模式节点（worker 模式与其余订阅内容完全不受影响）。
//   另外 CFNext 在 warp/masque 模式下是「隔离输出」（订阅只有模式节点）；
//   CFusion 按设计采用「并入输出」：模式节点追加进现有订阅，与 worker 节点并存。

export const MASQUE_DEFAULT_SNI = 'www.microsoft.com';
export const MASQUE_URI = 'https://cloudflareaccess.com';
export const MODE_NODE_LIMIT = 50;

export const WARP_ENDPOINTS = [
  "162.159.192.1:2408", "162.159.192.2:2408", "162.159.192.3:2408", "162.159.192.4:2408",
  "162.159.192.5:2408", "162.159.192.6:2408", "162.159.192.7:2408", "162.159.192.8:2408",
  "162.159.192.9:2408", "162.159.192.10:2408", "162.159.192.11:2408", "162.159.192.12:2408",
  "162.159.192.13:2408", "162.159.193.1:2408", "162.159.193.2:2408", "162.159.193.3:2408",
  "162.159.193.4:2408", "162.159.193.5:2408", "162.159.193.6:2408", "162.159.193.7:2408",
  "162.159.193.8:2408", "162.159.193.9:2408", "162.159.193.10:2408", "162.159.193.11:2408",
  "162.159.193.12:2408", "162.159.193.13:2408", "162.159.195.1:2408", "162.159.195.2:2408",
  "162.159.195.3:2408", "162.159.195.4:2408", "162.159.195.5:2408", "162.159.195.6:2408",
  "162.159.195.7:2408", "162.159.195.8:2408", "162.159.195.9:2408", "162.159.195.10:2408",
  "162.159.195.11:2408", "162.159.195.12:2408", "162.159.204.1:2408", "162.159.204.2:2408",
  "162.159.204.3:2408", "162.159.204.4:2408", "162.159.204.5:2408", "162.159.204.6:2408",
  "162.159.204.7:2408", "162.159.204.8:2408", "162.159.204.9:2408", "162.159.204.10:2408",
  "162.159.204.11:2408", "162.159.204.12:2408", "188.114.96.1:2408", "188.114.96.2:2408",
  "188.114.96.3:2408", "188.114.96.4:2408", "188.114.96.5:2408", "188.114.96.6:2408",
  "188.114.96.7:2408", "188.114.96.8:2408", "188.114.96.9:2408", "188.114.96.10:2408",
  "188.114.96.11:2408", "188.114.96.12:2408", "188.114.96.13:2408", "188.114.97.1:2408",
  "188.114.97.2:2408", "188.114.97.3:2408", "188.114.97.4:2408", "188.114.97.5:2408",
  "188.114.97.6:2408", "188.114.97.7:2408", "188.114.97.8:2408", "188.114.97.9:2408",
  "188.114.97.10:2408", "188.114.97.11:2408", "188.114.97.12:2408", "188.114.98.1:2408",
  "188.114.98.2:2408", "188.114.98.3:2408", "188.114.98.4:2408", "188.114.98.5:2408",
  "188.114.98.6:2408", "188.114.98.7:2408", "188.114.98.8:2408", "188.114.98.9:2408",
  "188.114.98.10:2408", "188.114.98.11:2408", "188.114.98.12:2408", "188.114.99.1:2408",
  "188.114.99.2:2408", "188.114.99.3:2408", "188.114.99.4:2408", "188.114.99.5:2408",
  "188.114.99.6:2408", "188.114.99.7:2408", "188.114.99.8:2408", "188.114.99.9:2408",
  "188.114.99.10:2408", "188.114.99.11:2408", "188.114.99.12:2408", "188.114.99.13:2408"
];

export const MASQUE_ENDPOINTS = [
  "162.159.198.2:443", "162.159.198.2:8443", "162.159.198.2:4443", "162.159.198.2:8095",
  "162.159.198.2:500", "162.159.198.2:1701", "162.159.198.2:4500", "162.159.199.2:443",
  "162.159.199.2:8443", "162.159.199.2:4443", "162.159.199.2:8095", "162.159.199.2:500",
  "162.159.199.2:1701", "162.159.199.2:4500", "[2606:4700:103::2]:443", "[2606:4700:103::2]:8443",
  "[2606:4700:103::2]:4443", "[2606:4700:103::2]:8095", "[2606:4700:103::2]:500", "[2606:4700:103::2]:1701",
  "[2606:4700:103::2]:4500", "[2606:4700:104::2]:443", "[2606:4700:104::2]:8443", "[2606:4700:104::2]:4443",
  "[2606:4700:104::2]:8095", "[2606:4700:104::2]:500", "[2606:4700:104::2]:1701", "[2606:4700:104::2]:4500"
];

// ---- 端点解析（对应 CFNext _wEp） ----
export function parseModeEndpoint(text) {
  const s = String(text || '').trim();
  if (s.charAt(0) === '[') {
    const i = s.indexOf(']');
    if (i > 0) return { h: s.slice(1, i), p: parseInt(s.slice(i + 2), 10) || 0 };
  }
  const i = s.lastIndexOf(':');
  return i > 0 && s.indexOf(':') === i ? { h: s.slice(0, i), p: parseInt(s.slice(i + 1), 10) || 0 } : { h: s, p: 0 };
}

function parseEndpointList(text) {
  return String(text || '').split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
}

// reserved / client_id 校验（对应 CFNext _rsv）：必须是恰好解码为 3 字节的 base64。
export function reservedBytes(cid) {
  try {
    const t = String(cid || '');
    if (!t) return null;
    const b = Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    return b.length === 3 ? [...b] : null;
  } catch { return null; }
}

// ---- 凭据解析（只接受配置提供的 CFNext 格式 JSON，缺失即 fail-closed） ----
// warpConf:   {k: 私钥, p: 对端公钥, a4, a6, h?, pt?, cid?}        —— CFNext 要求 k、p、a4 齐备
// masqueConf: {mk, k: 私钥(SEC1 base64), p: 对端公钥, a4, a6, ...} —— CFNext 要求 mk、k、p 齐备
export function parseModeCred(config, mode) {
  const raw = mode === 'masque' ? config?.masqueConf : config?.warpConf;
  if (!raw) return null;
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const k = String(parsed.k || ''), p = String(parsed.p || '');
  if (!k || !p) return null;
  if (mode === 'masque' && !parsed.mk) return null;
  if (mode === 'warp' && !parsed.a4) return null;
  return {
    k, p,
    a4: String(parsed.a4 || ''),
    a6: String(parsed.a6 || ''),
    h: String(parsed.h || ''),
    pt: Number(parsed.pt) || 0,
    cid: reservedBytes(parsed.cid ?? parsed.reserved) ? String(parsed.cid ?? parsed.reserved) : ''
  };
}

export function normalizeSubMode(config) {
  const mode = String(config?.subMode || 'worker').trim().toLowerCase();
  return mode === 'warp' || mode === 'masque' ? mode : 'worker';
}

// ---- 节点构建（对应 CFNext _wgNodes） ----
// 返回中间结构数组；subMode=worker 或凭据缺失时返回空数组。
export function buildModeNodes(config) {
  const mode = normalizeSubMode(config);
  if (mode === 'worker') return [];
  const cred = parseModeCred(config, mode);
  if (!cred) return [];
  const ms = mode === 'masque';
  const custom = parseEndpointList(ms ? config.masqueEps : config.warpEps);
  const list = (custom.length ? custom : (ms ? MASQUE_ENDPOINTS : WARP_ENDPOINTS)).slice(0, MODE_NODE_LIMIT);
  const local = [];
  if (cred.a4) local.push(String(cred.a4).split('/')[0]);
  if (cred.a6) local.push(String(cred.a6).split('/')[0]);
  const baseName = String((ms ? config.masqueName : config.warpName) || '') || 'WARP';
  return list.map((item, i) => {
    const hp = parseModeEndpoint(item);
    const node = {
      name: baseName + (list.length > 1 ? '·' + String(i + 1) : ''),
      host: hp.h,
      port: hp.p || cred.pt || (ms ? 443 : 2408),
      local, k: cred.k, p: cred.p, cid: cred.cid
    };
    if (ms) {
      node.mg = 1;
      node.sni = String(config.masqueSni || '').trim() || MASQUE_DEFAULT_SNI;
      const net = String(config.masqueNet || '').trim();
      if (net) node.msnet = net;
    }
    return node;
  });
}

// ---- 分享链接（对应 CFNext _wgLines；masque 节点没有此形态，跳过） ----
export function wireguardShareLine(node) {
  if (node.mg) return null;
  const reserved = reservedBytes(node.cid);
  const address = node.local.map(a => a + (a.includes(':') ? '/128' : '/32')).join(',');
  return 'wireguard://' + encodeURIComponent(node.k) + '@' + node.host + ':' + node.port +
    '/?publickey=' + encodeURIComponent(node.p) +
    '&address=' + encodeURIComponent(address) +
    (reserved ? '&reserved=' + reserved.join(',') : '') +
    '&mtu=1280#' + encodeURIComponent(node.name);
}

export function modeShareLines(nodes) {
  return nodes.map(wireguardShareLine).filter(Boolean);
}

// ---- Clash 渲染（对应 CFNext Ee 的 WG 分支，字段与取值逐项对齐） ----
function yamlQuote(value) {
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

export function clashProxyBlock(node) {
  const lines = [];
  lines.push('  - name: ' + yamlQuote(node.name));
  lines.push('    type: ' + (node.mg ? 'masque' : 'wireguard'));
  lines.push('    server: ' + yamlQuote(node.host));
  lines.push('    port: ' + node.port);
  if (node.local[0]) lines.push('    ip: ' + yamlQuote(node.mg ? String(node.local[0]).split('/')[0] + '/32' : String(node.local[0])));
  if (node.local[1]) lines.push('    ipv6: ' + yamlQuote(node.mg ? String(node.local[1]).split('/')[0] + '/128' : String(node.local[1])));
  lines.push('    private-key: ' + yamlQuote(node.k));
  lines.push('    peer-public-key: ' + yamlQuote(node.p));
  lines.push('    udp: true');
  lines.push('    mtu: 1280');
  lines.push('    remote-dns-resolve: true');
  lines.push('    dns:');
  lines.push('      - "1.1.1.1"');
  if (node.mg) {
    lines.push('    sni: ' + yamlQuote(node.sni || MASQUE_DEFAULT_SNI));
    lines.push('    uri: ' + yamlQuote(MASQUE_URI));
    lines.push('    congestion-controller: "bbr"');
    if (node.msnet) lines.push('    network: ' + yamlQuote(node.msnet));
  } else if (node.cid) {
    lines.push('    cid: ' + yamlQuote(node.cid));
  }
  return lines.join('\n');
}

// 把模式节点并入 engine 的 clash YAML：proxies 段末尾追加条目，
// 并把节点名加入「🚀 节点选择」与「♻️ 自动选择」两个分组（存在时）。
export function mergeClashYaml(yaml, nodes) {
  if (!nodes.length || typeof yaml !== 'string' || !/^proxies:/m.test(yaml)) return yaml;
  const groupsAt = yaml.indexOf('\nproxy-groups:');
  if (groupsAt < 0) return yaml;
  const proxiesSection = yaml.slice(0, groupsAt);
  const present = new Set([...proxiesSection.matchAll(/^\s+- name: "([^"]+)"/gm)].map(m => m[1]));
  const fresh = nodes.filter(n => !present.has(n.name));
  if (!fresh.length) return yaml;
  let out = yaml.slice(0, groupsAt) + '\n' + fresh.map(clashProxyBlock).join('\n') + yaml.slice(groupsAt);
  // 分组并入：逐组扫描，在目标组的 proxies 列表末尾追加名字。
  const targetGroups = new Set(['🚀 节点选择', '♻️ 自动选择']);
  const additions = fresh.map(n => '      - ' + yamlQuote(n.name));
  const lines = out.split('\n');
  const groupsStart = lines.findIndex(l => l === 'proxy-groups:');
  if (groupsStart < 0) return out;
  const starts = [];
  for (let i = groupsStart + 1; i < lines.length; i++) {
    const m = lines[i].match(/^  - name: "([^"]+)"/);
    if (m) starts.push({ at: i, name: m[1] });
    if (/^\S/.test(lines[i]) && lines[i] !== '') break;
  }
  // 从后往前插入，避免索引漂移。
  for (let g = starts.length - 1; g >= 0; g--) {
    if (!targetGroups.has(starts[g].name)) continue;
    const end = g + 1 < starts.length ? starts[g + 1].at : lines.length;
    let keyAt = -1;
    for (let i = starts[g].at; i < end; i++) if (/^    proxies:/.test(lines[i])) { keyAt = i; break; }
    if (keyAt < 0) continue;
    let insertAt = keyAt + 1;
    const existing = new Set();
    while (insertAt < end && /^      - /.test(lines[insertAt])) {
      const m = lines[insertAt].match(/"([^"]+)"/);
      if (m) existing.add(m[1]);
      insertAt++;
    }
    const add = additions.filter(l => !existing.has(l.match(/"([^"]+)"/)[1]));
    if (add.length) lines.splice(insertAt, 0, ...add);
  }
  return lines.join('\n');
}

// ---- sing-box 渲染（对应 CFNext Le 的 WG 分支；masque 节点不进 sing-box，与 CFNext 一致） ----
// sing-box ≥1.12 中 WireGuard 是 endpoint 而非 outbound，标签需同时挂进 urltest 与主 selector 才可达。
export function singboxEndpoint(node) {
  return {
    type: 'wireguard',
    tag: node.name,
    address: node.local.map(a => a + (a.includes(':') ? '/128' : '/32')),
    private_key: node.k,
    mtu: 1280,
    peers: [{
      address: node.host,
      port: node.port,
      public_key: node.p,
      allowed_ips: ['0.0.0.0/0', '::/0'],
      persistent_keepalive_interval: 25
    }]
  };
}

export function mergeSingboxJson(text, nodes) {
  const wg = nodes.filter(n => !n.mg);
  if (!wg.length) return text;
  let data;
  try { data = JSON.parse(text); } catch { return text; }
  if (!data || !Array.isArray(data.outbounds)) return text;
  const existingTags = new Set([
    ...data.outbounds.map(o => o.tag),
    ...(Array.isArray(data.endpoints) ? data.endpoints.map(o => o.tag) : [])
  ]);
  const fresh = wg.filter(n => !existingTags.has(n.name));
  if (!fresh.length) return text;
  data.endpoints = [...(Array.isArray(data.endpoints) ? data.endpoints : []), ...fresh.map(singboxEndpoint)];
  const tags = fresh.map(n => n.tag || n.name);
  for (const outbound of data.outbounds) {
    if ((outbound.type === 'urltest' || outbound.type === 'selector') && Array.isArray(outbound.outbounds)) {
      for (const tag of tags) if (!outbound.outbounds.includes(tag)) outbound.outbounds.push(tag);
    }
  }
  return JSON.stringify(data, null, 2);
}

// ---- 链接类订阅（base64 家族）并入：正文是 base64(链接行)，追加 wireguard 分享行后重编码 ----
export function mergeLinkSubscription(text, nodes) {
  const shareLines = modeShareLines(nodes);
  if (!shareLines.length) return text;
  let decoded;
  try { decoded = Buffer.from(String(text).trim(), 'base64').toString('utf8'); } catch { return text; }
  if (!/^\S+:\/\//.test(decoded.trim())) return text; // 不是链接列表，原样返回
  const existing = new Set(decoded.split('\n').map(l => l.trim()).filter(Boolean));
  const fresh = shareLines.filter(l => !existing.has(l));
  if (!fresh.length) return text;
  const merged = decoded.replace(/\s+$/, '') + '\n' + fresh.join('\n');
  return Buffer.from(merged, 'utf8').toString('base64');
}

// 按 engine 的 target 家族分发并入；返回 null 表示该格式不并入（保持原响应）。
export function mergeModeSubscription(body, target, nodes) {
  if (!nodes.length) return null;
  const t = String(target || 'base64').toLowerCase();
  if (['clash', 'clashr', 'stash', 'meta', 'clashmeta'].includes(t)) return mergeClashYaml(body, nodes);
  if (['singbox', 'sing-box'].includes(t)) return mergeSingboxJson(body, nodes);
  if (['surge', 'surge2', 'surge3', 'surge4', 'loon', 'quanx', 'quantumult', 'quantumultx', 'vg', 'jk', 'jiakuan'].includes(t)) return null;
  return mergeLinkSubscription(body, nodes);
}
