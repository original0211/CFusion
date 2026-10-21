// CFusion P4 Probe B / Cloudflare runtime outbound clients.
//
// The Node runtime uses DNS pinning: resolve, validate every address, then
// connect to one validated IP while retaining the original Host/SNI. Fetch
// cannot choose the destination IP. These variants therefore retain the
// preflight part of the model (resolve + reject if any returned address is
// non-public) but cannot prevent a later DNS rebinding/TOCTOU change between
// validation and fetch. That is an intentional, documented degradation, not
// an equivalent replacement for pinning.
import { isIP, isPublicAddress, normalizeResolvedAddresses } from './net-utils.mjs';

const DEFAULT_DOH_URL = 'https://cloudflare-dns.com/dns-query';

function cleanHost(host) {
  return String(host || '').replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

export async function resolveHostViaDoh(host, { fetchImpl = globalThis.fetch, dohUrl = DEFAULT_DOH_URL } = {}) {
  const name = cleanHost(host);
  if (isIP(name)) return [name];
  if (typeof fetchImpl !== 'function') throw new Error('运行时没有可用的 fetch，无法解析 Worker 域名');
  const rows = [];
  for (const type of ['A', 'AAAA']) {
    const url = new URL(dohUrl);
    url.searchParams.set('name', name);
    url.searchParams.set('type', type);
    // workerd fetch rejects redirect:'error' (a Node/undici-only value);
    // 'manual' + the status!==200 check below preserves the same semantics.
    const response = await fetchImpl(url, { headers: { Accept: 'application/dns-json' }, redirect: 'manual' });
    if (!response || response.status !== 200) throw new Error('解析 Worker 域名失败');
    const payload = await response.json();
    rows.push(...normalizeResolvedAddresses(payload.Answer || []));
  }
  return [...new Set(rows)];
}

export async function resolveAndValidateUrl(url, { allowPrivate = false, resolveHost, fetchImpl } = {}) {
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('来源须为 HTTP 或 HTTPS 地址');
  const host = cleanHost(url.hostname);
  if (!host) throw new Error('地址格式无效');
  const addresses = isIP(host) ? [host] : await (resolveHost ? resolveHost(host) : resolveHostViaDoh(host, { fetchImpl })).then(normalizeResolvedAddresses);
  if (!addresses.length || addresses.some(address => !isIP(address))) throw new Error('地址解析结果无效');
  if (!allowPrivate && addresses.some(address => !isPublicAddress(address))) throw new Error('只能连接解析到公网地址的目标');
  return addresses;
}

async function readBodyLimited(response, limit) {
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        try { await reader.cancel(); } catch {}
        throw new Error('响应内容过大');
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(merged);
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > limit) throw new Error('响应内容过大');
  return text;
}

function requestSignal(signal, timeoutMs) {
  if (signal) return signal;
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined;
}

export async function requestWorkerApiFetch(workerBase, uuid, suffix, method = 'GET', body = undefined, {
  fetchImpl = globalThis.fetch,
  resolveHost,
  allowPrivate = false,
  timeoutMs = 10000,
  signal,
  serviceFetcher,
} = {}) {
  if (typeof fetchImpl !== 'function' && !serviceFetcher) throw new Error('运行时没有可用的 fetch');
  const url = new URL(String(workerBase).replace(/\/$/, '') + '/' + uuid + suffix);
  if (serviceFetcher) {
    // Service binding: a private, Cloudflare-internal channel to the bound
    // core Worker. DNS preflight does not apply (no public DNS hop exists to
    // validate); the binding itself is the trust boundary.
    const bound = await serviceFetcher.fetch(url, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; CFnewPanel)' },
      body,
      redirect: 'manual',
      signal: requestSignal(signal, timeoutMs),
    });
    return { status: bound.status, body: await readBodyLimited(bound, 2097152) };
  }
  await resolveAndValidateUrl(url, { allowPrivate, resolveHost, fetchImpl });
  const response = await fetchImpl(url, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; CFnewPanel)' },
    body,
    redirect: 'manual',
    signal: requestSignal(signal, timeoutMs),
  });
  return { status: response.status, body: await readBodyLimited(response, 2097152) };
}

export async function fetchPublicTextFetch(value, {
  signal,
  timeout = 8000,
  limit = 1048576,
  fetchImpl = globalThis.fetch,
  resolveHost,
  allowPrivate = false,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('运行时没有可用的 fetch');
  let url = new URL(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    await resolveAndValidateUrl(url, { allowPrivate, resolveHost, fetchImpl });
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CFnewPanel)', Accept: '*/*' },
      redirect: 'manual',
      signal: requestSignal(signal, timeout),
    });
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get('location')) {
      url = new URL(response.headers.get('location'), url);
      continue;
    }
    if (response.status !== 200) {
      const error = new Error('来源返回 HTTP ' + response.status);
      error.status = response.status;
      throw error;
    }
    return readBodyLimited(response, limit);
  }
  throw new Error('来源重定向过多');
}

export async function fetchPreferredListFetch(value, signal, { normalize, ...options } = {}) {
  if (typeof normalize !== 'function') throw new TypeError('fetchPreferredListFetch requires a normalize function');
  const url = new URL(value);
  const body = await fetchPublicTextFetch(value, { ...options, signal });
  return normalize(body, url.searchParams.get('port') || '443');
}

// Fetch cannot connect to a caller-selected IP while retaining an arbitrary
// Worker hostname/SNI, which is the entire measurement model of the Node
// probe. Return an explicit degraded result; never fabricate a latency.
export async function probePreferredFetch() {
  return {
    success: false,
    latency: -1,
    colo: '',
    degraded: true,
    vantage: 'cloudflare-fetch',
    error: 'Cloudflare fetch 运行时无法按被测 IP 直连，优选探测已降级为不可用；未执行测速',
  };
}
