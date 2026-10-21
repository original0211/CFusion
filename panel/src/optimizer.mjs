// CFusion 优选引擎（P1）——逻辑移植自 PAICNI/CFNext 及其改进 fork CFNext-Plus：
//   候选源注册表 N、候选解析 Kt/ot、Cloudflare 地址段校验 v、兜底池 Ve、候选构建 Jt、
//   订阅筛选 ge（地区/运营商/IP 类型别名 + 空结果逐级放宽）。
// 与 CFNext 的差异见仓库根 P1_REPORT.md 的对照表。原 CFNext 在 Worker 内以
// cloudflare:sockets 做延迟测速（Xt/ie），面板侧已有 preferred.mjs 的 probePreferred
// （HTTP 探测），本模块不重复实现测速，只负责候选池的拉取、筛选与截断。
import { isIP } from 'node:net';
import { fetchPublicText } from './preferred.mjs';
import { fetchPublicTextFetch } from './outbound-fetch.mjs';
import { outboundMode } from './runtime.mjs';

// —— Cloudflare 地址段（CFNext 常量 u / h，v() 的判定依据） ——
export const CF_V4_CIDRS = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'];
export const CF_V6_CIDRS = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];

// —— 候选源注册表（CFNext 常量 N） ——
export const OPTIMIZER_SOURCES = {
  wetest_v4: { label: '微测网 IPv4', url: 'https://www.wetest.vip/page/cloudflare/address_v4.html' },
  wetest_v6: { label: '微测网 IPv6', url: 'https://www.wetest.vip/page/cloudflare/address_v6.html' },
  hostmonit: { label: 'HostMonit 优选', url: 'https://stock.hostmonit.com/CloudFlareYes' },
  wetest_cname: { label: '微测网 优选域名', url: 'https://www.wetest.vip/page/cloudflare/cname.html' },
  bestcf: { label: '优选 IP 列表', url: 'https://cf.090227.xyz/ip.164746.xyz' }
};

// —— bestcf 兜底地区池（CFNext 常量 U，Ve() 的数据源） ——
export const FALLBACK_LISTS = [
  { label: '香港', region: 'HK', url: 'https://bestcf.pages.dev/random-region/HK/100.txt', count: 12 },
  { label: '日本', region: 'JP', url: 'https://bestcf.pages.dev/random-region/JP/100.txt', count: 12 },
  { label: '美国', region: 'US', url: 'https://bestcf.pages.dev/random-region/US/100.txt', count: 12 },
  { label: '新加坡', region: 'SG', url: 'https://bestcf.pages.dev/random-region/SG/100.txt', count: 12 },
  { label: '台湾', region: 'TW', url: 'https://bestcf.pages.dev/random-region/TW/100.txt', count: 12 }
];

// —— 筛选别名（CFNext 常量 ue / fe / he / me） ——
export const REGION_ALIASES = { HK: ['HK', '香港'], TW: ['TW', '台湾'], US: ['US', '美国'], SG: ['SG', '新加坡'], JP: ['JP', '日本'], KR: ['KR', '韩国'], DE: ['DE', '德国'] };
export const ISP_ALIASES = { '移动': ['移动', 'CM', 'CHINAMOBILE'], '联通': ['联通', 'CU', 'UNICOM'], '电信': ['电信', 'CT', 'CHINATELECOM'] };
export const ALL_ISPS = ['移动', '联通', '电信'];
export const ALL_IP_TYPES = ['IPv4', 'IPv6'];

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3];
}

function ipv6Groups(ip) {
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  return groups.map(g => parseInt(g, 16));
}

// v() 移植：判断 IP 是否落在 Cloudflare 地址段内（域名返回 false，与原版一致）。
export function isCloudflareIp(ip) {
  const value = String(ip || '').trim().replace(/^\[|\]$/g, '');
  if (isIP(value) === 4) {
    const num = ipv4ToInt(value);
    if (num === null) return false;
    return CF_V4_CIDRS.some(cidr => {
      const [base, bits] = cidr.split('/');
      const b = ipv4ToInt(base);
      const size = 2 ** (32 - Number(bits));
      return Math.floor(num / size) === Math.floor(b / size);
    });
  }
  if (isIP(value) === 6) {
    const groups = ipv6Groups(value.toLowerCase());
    if (!groups) return false;
    return CF_V6_CIDRS.some(cidr => {
      const [base, bits] = cidr.split('/');
      const bg = ipv6Groups(base.toLowerCase());
      if (!bg) return false;
      let remaining = Number(bits);
      for (let i = 0; i < 8 && remaining > 0; i++) {
        const take = Math.min(16, remaining);
        const mask = take === 16 ? 0xffff : (0xffff << (16 - take)) & 0xffff;
        if ((groups[i] & mask) !== (bg[i] & mask)) return false;
        remaining -= take;
      }
      return true;
    });
  }
  return false;
}

// z() 等价：解析 "host[:port]" / "[v6][:port]"，返回 {host, port}。
export function parseHostPort(token, defaultPort = 443) {
  let text = String(token || '').trim();
  if (!text) return { host: '', port: defaultPort };
  let port = defaultPort;
  if (text.startsWith('[')) {
    const end = text.indexOf(']');
    if (end < 0) return { host: '', port: defaultPort };
    const host = text.slice(1, end);
    const rest = text.slice(end + 1);
    if (rest.startsWith(':') && /^\d+$/.test(rest.slice(1))) port = Number(rest.slice(1));
    return { host, port };
  }
  const colon = text.lastIndexOf(':');
  if (colon > 0 && /^\d+$/.test(text.slice(colon + 1)) && !text.slice(0, colon).includes(':')) {
    return { host: text.slice(0, colon), port: Number(text.slice(colon + 1)) };
  }
  return { host: text, port };
}

function isValidHost(host) {
  if (!host) return false;
  if (isIP(host)) return true;
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(host);
}

// ot() 移植：结构化条目 "地址[:端口][#备注]"，按换行/分号切分，同 host 去重。
export function parseEntryList(text, defaultPort = 443) {
  const entries = [];
  const seen = new Set();
  for (const raw of String(text || '').split(/[\n;]+/)) {
    for (const piece of raw.split(',')) {
      let token = piece.trim();
      if (!token) continue;
      let name = '';
      const hash = token.indexOf('#');
      if (hash >= 0) { name = token.slice(hash + 1).trim(); token = token.slice(0, hash).trim(); }
      const { host, port } = parseHostPort(token, defaultPort);
      if (!isValidHost(host) || seen.has(host.toLowerCase())) continue;
      seen.add(host.toLowerCase());
      entries.push({ ip: host, port, name });
    }
  }
  return entries;
}

// Kt() 移植：先结构化解析，再全文扫描裸 IPv4 / IPv6 补漏，同 host 去重。
export function parseCandidateText(text, defaultPort = 443) {
  const byHost = new Map();
  const add = (ip, port, name) => {
    const key = String(ip).toLowerCase();
    if (!byHost.has(key)) byHost.set(key, { ip, port: port || defaultPort, name: name || '' });
  };
  for (const entry of parseEntryList(text, defaultPort)) add(entry.ip, entry.port, entry.name);
  const source = String(text || '');
  for (const match of source.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g)) {
    const { host, port } = parseHostPort(match[0], defaultPort);
    if (isIP(host) === 4) add(host, port, '');
  }
  for (const match of source.matchAll(/[0-9a-fA-F:]+/g)) {
    const token = match[0];
    if (token.includes(':') && token.split(':').length >= 3 && isIP(token) === 6) add(token, defaultPort, '');
  }
  return [...byHost.values()];
}

// ge() 移植（作用对象从订阅字符串改为条目对象，语义不变）：
// 地区/运营商靠备注名别名匹配（原生地址与「优选IP/域名-NNN」豁免地区过滤），
// ipType 单选时按地址族过滤；任一维度筛空则逐级放宽（运营商→全部、ipType→双栈、地区→all）。
export function filterEntries(entries, filter = {}) {
  if (!filter || (!filter.region && !filter.ipType && !filter.isp)) return entries;
  const regions = normalizeRegions(filter.region);
  const ipTypes = Array.isArray(filter.ipType) && filter.ipType.length ? filter.ipType : ALL_IP_TYPES;
  const isps = Array.isArray(filter.isp) && filter.isp.length ? filter.isp : ALL_ISPS;
  const anyNameHasIsp = entries.some(e => e.name && Object.values(ISP_ALIASES).flat().some(alias => e.name.toUpperCase().includes(alias.toUpperCase())));
  const apply = (regionList, typeList, ispList) => {
    const regionAliases = regionList && regionList.length && !regionList.includes('all')
      ? regionList.flatMap(r => REGION_ALIASES[String(r).toUpperCase()] || [String(r)]) : null;
    const ispRestricted = ispList.length > 0 && ispList.length < ALL_ISPS.length;
    return entries.filter(entry => {
      if (!entry.name) return false;
      const up = entry.name.toUpperCase();
      if (regionAliases && !regionAliases.some(a => up.includes(a.toUpperCase())) && !/^(优选IP|域名)-\d+/.test(entry.name) && entry.name !== '原生地址') return false;
      const isV6 = String(entry.ip).includes(':');
      if (typeList.length === 1) {
        if (typeList[0] === 'IPv4' && isV6) return false;
        if (typeList[0] === 'IPv6' && !isV6) return false;
      }
      if (ispRestricted && anyNameHasIsp && !ispList.some(isp => (ISP_ALIASES[isp] || [isp]).some(a => up.includes(a.toUpperCase())))) return false;
      return true;
    });
  };
  let result = apply(regions, ipTypes, isps);
  if (!result.length) result = apply(regions, ipTypes, ALL_ISPS);
  if (!result.length) result = apply(regions, ALL_IP_TYPES, ALL_ISPS);
  if (!result.length) result = apply(null, ALL_IP_TYPES, ALL_ISPS);
  return result;
}

function normalizeRegions(region) {
  if (!region) return null;
  const list = (Array.isArray(region) ? region : String(region).split(',')).map(v => String(v).trim()).filter(Boolean);
  return list.length ? list : null;
}

// at() 简化移植：从 Cloudflare IPv4 段随机采样地址（仅兜底补量用）。
export function randomCloudflareIps(count, rng = Math.random) {
  const out = [];
  const seen = new Set();
  let guard = count * 30 + 30;
  while (out.length < count && guard-- > 0) {
    const cidr = CF_V4_CIDRS[Math.floor(rng() * CF_V4_CIDRS.length)];
    const [base, bits] = cidr.split('/');
    const baseNum = ipv4ToInt(base);
    const size = 2 ** (32 - Number(bits));
    const num = baseNum + Math.floor(rng() * size);
    const ip = [24, 16, 8, 0].map(shift => Math.floor(num / 2 ** shift) % 256).join('.');
    if (!seen.has(ip)) { seen.add(ip); out.push(ip); }
  }
  return out;
}

async function fetchText(fetchImpl, url, timeoutMs) {
  // P3-4：未注入 fetchImpl（生产路径）时走 preferred.mjs 的受防护拉取（公网校验 + 地址钉死），
  // 不再用全局 fetch 直拉任意 URL，避免 optimizerSourceURL 指向内网/云元数据构成 SSRF。
  // 代价：自建于内网的优选列表源同样被拒，与优选列表路径（fetchPreferredList）的既有口径一致。
  if (!fetchImpl) {
    // CFusion P4: Cloudflare/fetch runtime uses the preflight-validated
    // fetch variant; Node keeps the DNS-pinned protected implementation.
    if (outboundMode() === 'fetch') return fetchPublicTextFetch(url, { signal: AbortSignal.timeout(timeoutMs), timeout: timeoutMs });
    return fetchPublicText(url, { signal: AbortSignal.timeout(timeoutMs), timeout: timeoutMs });
  }
  const response = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response || !response.ok) {
    const error = new Error('HTTP ' + (response ? response.status : '无响应'));
    error.status = response ? response.status : 0;
    throw error;
  }
  return response.text();
}

let poolCache = { key: '', at: 0, value: null };
let lastGoodPool = null;

// Jt() 移植：预设源 + 自定义 URL 源 → 去重 → bestcf 兜底补量 → CIDR 随机补量。
// custom 模式（source==='custom' 或给了 sourceURL）接受任意合法地址；
// 预设模式只接受 Cloudflare 地址段内的 IP（与原版 a()/v() 语义一致，域名条目会被滤掉，见报告存疑点）。
export async function buildCandidatePool(optimizer = {}, deps = {}) {
  const fetchImpl = deps.fetchImpl || null; // null 表示走 fetchText 内的受防护默认拉取
  const now = deps.now || Date.now();
  const port = Number(optimizer.port) || 443;
  const target = Math.max(1, Number(optimizer.count) || 20);
  const cacheKey = JSON.stringify([optimizer.source || '', optimizer.sourceURL || '', port, target, optimizer.useCidr !== false]);
  if (!deps.noCache && poolCache.value && poolCache.key === cacheKey && now - poolCache.at < 600000) return poolCache.value;

  const stats = { preset: 0, presetErr: '', custom: 0, customErr: '', bestcf: 0, cidr: 0 };
  const customMode = optimizer.source === 'custom' || !!optimizer.sourceURL;
  const collected = [];
  const accept = entry => {
    if (!entry || !entry.ip) return;
    if (!customMode && isIP(String(entry.ip).replace(/^\[|\]$/g, '')) && !isCloudflareIp(entry.ip)) return;
    collected.push({ ip: entry.ip, port: entry.port || port, name: entry.name || '' });
  };

  if (optimizer.source && OPTIMIZER_SOURCES[optimizer.source]) {
    try {
      const text = await fetchText(fetchImpl, OPTIMIZER_SOURCES[optimizer.source].url, 6000);
      const parsed = parseCandidateText(text, port);
      parsed.forEach(accept);
      stats.preset = parsed.length;
    } catch (error) {
      stats.presetErr = error.status ? 'HTTP ' + error.status : '超时/网络错误';
    }
  }
  if (optimizer.sourceURL) {
    const urls = parseSourceUrls(optimizer.sourceURL).slice(0, 50);
    if (urls.length) {
      const results = await Promise.all(urls.map(async url => {
        try { return { url, arr: parseCandidateText(await fetchText(fetchImpl, url, 6000), port), err: '' }; }
        catch (error) { return { url, arr: [], err: error.status ? 'HTTP ' + error.status : '超时/网络错误' }; }
      }));
      const failures = [];
      let okCount = 0;
      for (const result of results) {
        if (result.err) failures.push(result.url.replace(/^https?:\/\//, '').slice(0, 40) + ' → ' + result.err);
        else { result.arr.forEach(accept); stats.custom += result.arr.length; okCount++; }
      }
      if (failures.length) stats.customErr = (okCount ? '部分源失败: ' : '') + failures.join('；');
    } else stats.customErr = '未提供有效 URL（多个用换行或分号隔开）';
  }

  const seen = new Set();
  const candidates = [];
  for (const entry of collected) {
    const key = String(entry.ip).toLowerCase();
    if (!seen.has(key)) { seen.add(key); candidates.push(entry); }
  }

  // Ve() 移植：候选不足目标数时从 bestcf 地区池补量（每区最多 count 条）。
  if (candidates.length < target) {
    for (const list of FALLBACK_LISTS) {
      if (candidates.length >= target) break;
      try {
        const text = await fetchText(fetchImpl, list.url, 8000);
        let added = 0;
        for (const line of text.split(/[\r\n]+/)) {
          const match = line.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d+))?$/);
          if (!match || added >= list.count || candidates.length >= target) continue;
          if (seen.has(match[1])) continue;
          seen.add(match[1]);
          candidates.push({ ip: match[1], port: match[2] ? Number(match[2]) : 443, name: list.label + '-' + String(added + 1).padStart(2, '0') });
          added++;
        }
        stats.bestcf += added;
      } catch { /* 兜底源失败静默，与原版一致 */ }
    }
  }
  // at() 补量：仍不足且允许 useCidr 时，从 CF 地址段随机采样。
  if (optimizer.useCidr !== false && candidates.length < target) {
    const need = target - candidates.length;
    for (const ip of randomCloudflareIps(need * 3, deps.rng)) {
      if (candidates.length >= target) break;
      if (seen.has(ip)) continue;
      seen.add(ip);
      candidates.push({ ip, port, name: '' });
      stats.cidr++;
    }
  }

  const value = { candidates, stats };
  poolCache = { key: cacheKey, at: now, value };
  if (candidates.length) lastGoodPool = value;
  return value;
}

// se() 移植的简化版：按换行/分号/逗号拆出 URL 列表。
export function parseSourceUrls(text) {
  return String(text || '').split(/[\n;,]+/).map(v => v.trim()).filter(v => /^https?:\/\//i.test(v));
}

// 与 cfnew 优选条目一致的文本格式：地址:端口#备注（IPv6 加方括号）。
export function formatEntry(entry) {
  const host = String(entry.ip).includes(':') && !String(entry.ip).startsWith('[') ? '[' + entry.ip + ']' : entry.ip;
  return host + ':' + (entry.port || 443) + (entry.name ? '#' + entry.name : '');
}

const TRUTHY = value => ['yes', 'true', '1', 'on'].includes(String(value ?? '').trim().toLowerCase());

// 高层入口（server.mjs 在订阅请求时调用）：
// 返回可直接替换 config.yx 的优选池文本；返回 null 表示不接管（引擎走原 yx/yxURL 流程）。
// 全程 fail-open：拉取/解析任何异常都回退到上次成功池或手填列表，绝不抛错阻断订阅生成。
export async function resolveOptimizerYx(config = {}, deps = {}) {
  try {
    if (deps.resetPoolCache) { poolCache = { key: '', at: 0, value: null }; lastGoodPool = null; }
    if (!TRUTHY(config.optimizerAuto)) return null;
    const manual = parseEntryList(config.yx || '', Number(config.optimizerPort) || 443);
    let pool;
    if (TRUTHY(config.optimizerCustomPref)) {
      // customPref=true 语义（CFNext）：只用已保存的手填优选，不自动重建池。
      pool = manual;
    } else {
      const optimizer = {
        source: config.optimizerSource || 'wetest_v4',
        sourceURL: config.optimizerSourceURL || '',
        port: Number(config.optimizerPort) || 443,
        count: Number(config.optimizerCount) || 20,
        useCidr: config.optimizerUseCidr !== 'no'
      };
      let built = null;
      try { built = await buildCandidatePool(optimizer, deps); }
      catch (error) { console.warn('[cfusion] optimizer 拉取失败，回退手填列表:', error.message); }
      pool = built && built.candidates.length ? built.candidates
        : (lastGoodPool && lastGoodPool.candidates.length ? lastGoodPool.candidates : manual);
    }
    const ipType = config.optimizerIpType
      ? String(config.optimizerIpType).split(',').map(v => v.trim()).filter(Boolean)
      : [...(config.ipv4 !== 'no' ? ['IPv4'] : []), ...(config.ipv6 !== 'no' ? ['IPv6'] : [])];
    const isp = config.optimizerIsp ? String(config.optimizerIsp).split(',').map(v => v.trim()).filter(Boolean) : undefined;
    // CFNext 的 ge() 在节点已命名后才筛选（无名条目会被判掉）；本模块在池阶段筛选，
    // 先给无名条目补「优选IP-NNN」默认名（正好命中 ge 的地区豁免正则），再走原筛选语义。
    const named = pool.map((entry, index) => entry.name ? entry : { ...entry, name: '优选IP-' + String(index + 1).padStart(3, '0') });
    const filtered = filterEntries(named, { region: config.optimizerRegion || 'all', ipType, isp });
    const limitRaw = parseInt(config.optimizerLimit, 10);
    const limit = limitRaw > 0 ? Math.min(limitRaw, 1000) : 300;
    const lines = filtered.slice(0, limit).map(formatEntry);
    return lines.length ? lines.join('\n') : null;
  } catch (error) {
    console.warn('[cfusion] optimizer 异常，回退原优选流程:', error.message);
    return null;
  }
}
