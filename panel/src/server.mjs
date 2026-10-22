import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createSubscriptionEngine } from './engine.mjs';
import { resolveOptimizerYx } from './optimizer.mjs';
import { buildModeNodes, mergeModeSubscription, normalizeSubMode } from './modes.mjs';
import { isPublicAddress, fetchPreferredList, normalizePreferredList, probePreferred } from './preferred.mjs';
import { PANEL_VERSION, coreRelease } from './release.mjs';
import { ADMIN_COOKIE, adminEnabled, checkAdminPassword, clearedCookieHeader, createKvSessionStore, createLoginThrottle, createSessionStore, parseCookieHeader, sessionCookieHeader, sessionTtlMs } from './session.mjs';
import { createHash } from 'node:crypto';
import { buildSubCacheKey, createSubCache } from './subcache.mjs';
import { fetchPreferredListFetch, probePreferredFetch, requestWorkerApiFetch } from './outbound-fetch.mjs';
import { coreServiceFetcher, outboundMode } from './runtime.mjs';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const privateTesting = process.env.CFNEW_ALLOW_PRIVATE === 'yes';
// CFusion P4: Cloudflare entry pre-registers text assets in a global because
// Workers have no filesystem. When absent, Node/Vercel read the same files
// from disk exactly as upstream did.
const embeddedAssets = globalThis.__CFUSION_ASSETS__ || null;
const theme = '<style>' + (embeddedAssets?.theme ?? await readFile(new URL('./theme.css', import.meta.url), 'utf8')) + '</style>';
const landingSource = embeddedAssets?.landing ?? await readFile(new URL('./index.html', import.meta.url), 'utf8');
const landing = landingSource.replace('__CFNEW_PANEL_VERSION__', PANEL_VERSION).replace('</head>', theme + '</head>');
const bridge = embeddedAssets?.bridge ?? await readFile(new URL('./bridge.js', import.meta.url), 'utf8');
const rulesLicense = embeddedAssets?.rulesLicense ?? (await readFile(new URL('./singbox-rules.NOTICE.md', import.meta.url), 'utf8') + '\n' + await readFile(new URL('./singbox-rules.LICENSE', import.meta.url), 'utf8'));
const safeJson = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const preferredAuth = new Map();

// CFusion 语言补齐：服务端消息与控制台同一语言口径——Cookie preferredLanguage
// 优先，缺失时看 Accept-Language，只认 'zh' | 'en'，其余回退 zh。
function requestLang(request) {
  const saved = parseCookieHeader(request.headers.get('cookie')).preferredLanguage;
  if (saved) return String(saved).toLowerCase().startsWith('en') ? 'en' : 'zh';
  const browser = (request.headers.get('accept-language') || '').split(',')[0].split('-')[0].toLowerCase();
  return browser === 'en' ? 'en' : 'zh';
}
const pickLang = (lang, zh, en) => lang === 'en' ? en : zh;

// CFusion P3-1/P4：管理会话。Node 默认进程内存；Cloudflare entry 若提供
// SESSION_KV binding（经 global 注入），改用 KV store（方法为 async）。
const adminSessions = globalThis.__CFUSION_SESSION_KV__
  ? createKvSessionStore(globalThis.__CFUSION_SESSION_KV__, { ttlMs: sessionTtlMs() })
  : createSessionStore({ ttlMs: sessionTtlMs() });
const loginThrottle = createLoginThrottle();

// CFusion P3-3：订阅响应缓存（归一化键 + LRU32 + 60s TTL）；配置保存成功即失效对应 Worker。
const subCache = createSubCache();

async function adminSessionValid(request) {
  if (!adminEnabled()) return true;
  const cookies = parseCookieHeader(request.headers.get('cookie'));
  return await adminSessions.verify(cookies[ADMIN_COOKIE]);
}

async function handleAdminApi(request, url) {
  const secure = url.protocol === 'https:';
  if (url.pathname === '/api/admin/status' && request.method === 'GET') {
    const required = adminEnabled();
    return Response.json({ adminRequired: required, loggedIn: required ? await adminSessions.verify(parseCookieHeader(request.headers.get('cookie'))[ADMIN_COOKIE]) : false });
  }
  if (url.pathname === '/api/admin/logout' && request.method === 'POST') {
    await adminSessions.revoke(parseCookieHeader(request.headers.get('cookie'))[ADMIN_COOKIE]);
    return Response.json({ success: true }, { headers: { 'Set-Cookie': clearedCookieHeader({ secure }) } });
  }
  if (url.pathname === '/api/admin/login' && request.method === 'POST') {
    const lang = requestLang(request);
    if (!adminEnabled()) return Response.json({ success: false, message: pickLang(lang, '未设置管理口令（PANEL_ADMIN_PASSWORD），无需登录', 'No admin password set (PANEL_ADMIN_PASSWORD); login is not required') }, { status: 400 });
    if (loginThrottle.locked()) return Response.json({ success: false, message: pickLang(lang, '登录失败次数过多，请稍后再试', 'Too many failed login attempts. Please try again later.') }, { status: 429 });
    let password = '';
    try { password = String((await request.json())?.password || ''); } catch { password = ''; }
    if (!checkAdminPassword(password)) {
      loginThrottle.fail();
      return Response.json({ success: false, message: pickLang(lang, '口令错误', 'Incorrect password') }, { status: 401 });
    }
    loginThrottle.succeed();
    const token = await adminSessions.issue();
    return Response.json({ success: true }, { headers: { 'Set-Cookie': sessionCookieHeader(token, { ttlMs: sessionTtlMs(), secure }) } });
  }
  return null;
}

async function authorizePreferred(workerBase, uuid) {
  workerBase = selectWorker(workerBase);
  const key = workerBase + '/' + uuid;
  let entry = preferredAuth.get(key);
  if (!entry || entry.expires < Date.now()) {
    entry = { expires: Date.now() + 30000, pending: loadWorkerConfig(workerBase, uuid) };
    if (preferredAuth.size >= 128) preferredAuth.delete(preferredAuth.keys().next().value);
    preferredAuth.set(key, entry);
  }
  try { await entry.pending; }
  catch (error) { if (preferredAuth.get(key) === entry) preferredAuth.delete(key); throw error; }
}

export function normalizeWorker(value) {
  const url = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('请输入 Worker 域名');
  if (!privateTesting && (url.protocol !== 'https:' || (url.port && url.port !== '443'))) throw new Error('Worker 须使用 HTTPS');
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('域名中不要带路径');
  return url.origin;
}

function allowedWorker() {
  const value = String(process.env.w || '').trim();
  if (!value) return '';
  try { return normalizeWorker(value); }
  catch { throw Object.assign(new Error('面板 w 配置无效，请填写 Worker 的 HTTPS 根地址'), { status: 503 }); }
}

function selectWorker(value) {
  const allowed = allowedWorker();
  const workerBase = normalizeWorker(String(value || allowed).trim());
  if (allowed && workerBase !== allowed) throw Object.assign(new Error('此面板仅允许接入指定的 Worker'), { status: 403 });
  return workerBase;
}

export function normalizeAccess(value, lang = 'zh') {
  const access = String(value || '').trim().replace(/^\/+|\/+$/g, '');
  if (!access || access.length > 2048 || /[?#\\\u0000-\u0020\u007f]/.test(access)) throw new Error(pickLang(lang, '请填写 UUID 或自定义路径', 'Enter a UUID or custom path'));
  let decoded;
  try { decoded = decodeURIComponent(access); } catch { throw new Error(pickLang(lang, '自定义路径格式无效', 'Invalid custom path format')); }
  if (/[?#\\\u0000-\u0020\u007f]/.test(decoded) || decoded.split('/').some(part => part === '.' || part === '..')) throw new Error(pickLang(lang, '自定义路径格式无效', 'Invalid custom path format'));
  return uuidPattern.test(access) ? access.toLowerCase() : new URL('/' + access, 'https://path.invalid').pathname.slice(1);
}

const workerAddresses = new Map();
const recentConfig = new Map();

async function requestWorkerApi(workerBase, uuid, suffix, method = 'GET', body = undefined) {
  workerBase = selectWorker(workerBase);
  // CFusion P4: Cloudflare runtime has no reliable node:http/DNS pinning.
  // The fetch variant resolves and rejects non-public address sets before
  // sending, but cannot pin the validated IP (see outbound-fetch.mjs).
  if (outboundMode() === 'fetch') {
    // A service binding (env.CORE) is the only reliable way for this panel
    // Worker to reach its bound core Worker: global fetch to a same-account
    // workers.dev host fails with Cloudflare error 1042.
    const fetcher = coreServiceFetcher();
    if (fetcher && allowedWorker() && workerBase === allowedWorker()) {
      return requestWorkerApiFetch(workerBase, uuid, suffix, method, body, { allowPrivate: privateTesting, serviceFetcher: fetcher });
    }
    return requestWorkerApiFetch(workerBase, uuid, suffix, method, body, { allowPrivate: privateTesting });
  }
  return requestWorkerApiNode(workerBase, uuid, suffix, method, body);
}

async function requestWorkerApiNode(workerBase, uuid, suffix, method = 'GET', body = undefined) {
  workerBase = selectWorker(workerBase);
  const url = new URL(workerBase + '/' + uuid + suffix);
  let address = workerAddresses.get(workerBase);
  if (!address || address.expires < Date.now()) {
    const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
    if (!addresses.length || (!privateTesting && addresses.some(item => !isPublicAddress(item.address)))) throw new Error('Worker 域名必须解析到公网地址');
    address = { ...addresses[0], expires: Date.now() + 60000 };
    if (workerAddresses.size >= 128) workerAddresses.delete(workerAddresses.keys().next().value);
    workerAddresses.set(workerBase, address);
  }
  return new Promise((resolve, reject) => {
    const outgoing = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; CFnewPanel)', ...(body !== undefined ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}) },
      lookup: (_host, options, callback) => options.all ? callback(null, [address]) : callback(null, address.address, address.family),
    }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 2097152) { outgoing.destroy(new Error('配置响应过大')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', reject);
    });
    const timer = setTimeout(() => outgoing.destroy(new Error('连接 Worker 超时')), 10000);
    outgoing.on('close', () => clearTimeout(timer)); outgoing.on('error', reject);
    outgoing.end(body);
  });
}

export async function loadWorkerConfig(workerBase, access, lang = 'zh') {
  workerBase = selectWorker(workerBase);
  const uuid = normalizeAccess(access, lang);
  const key = workerBase + '/' + uuid;
  const recent = recentConfig.get(key);
  if (recent && recent.expires > Date.now()) return recent.config;
  recentConfig.delete(key);
  const response = await requestWorkerApi(workerBase, uuid, '/api/config');
  if (response.status !== 200) throw Object.assign(new Error(pickLang(lang, '读取配置失败，请确认 Worker 域名、UUID 或自定义路径和核心版本', 'Failed to load config. Check the Worker domain, UUID or custom path, and the core version.')), { upstreamStatus: response.status });
  let config;
  try { config = JSON.parse(response.body); }
  catch { throw new Error(pickLang(lang, '该地址没有兼容的配置接口', 'This address does not expose a compatible config API')); } // P3-4：不回显解析器原文
  if (!config || Array.isArray(config) || typeof config !== 'object' || typeof config.kvEnabled !== 'boolean') throw new Error(pickLang(lang, '该地址没有兼容的配置接口', 'This address does not expose a compatible config API'));
  const resolvedUuid = typeof config.uuid === 'string' ? config.uuid.toLowerCase() : uuidPattern.test(uuid) ? uuid : '';
  if (!uuidPattern.test(resolvedUuid)) throw new Error(pickLang(lang, '请更新精简内核后再使用自定义路径登录', 'Update the slim core before signing in with a custom path'));
  return { ...config, uuid: resolvedUuid };
}

function targetForAgent(agent = '') {
  const ua = (agent || '').toLowerCase();
  if (ua.includes('sing-box') || ua.includes('singbox')) return 'singbox';
  if (ua.includes('clash') || ua.includes('mihomo') || ua.includes('stash')) return 'clash';
  if (ua.includes('surge')) return 'surge';
  if (ua.includes('loon')) return 'loon';
  if (ua.includes('quantumult')) return 'quanx';
  return 'base64';
}

// CFusion P3-2：配置变更防漂移。
// 背景事故：CFNext 的 config.mode 曾被外部反复切换，订阅静默变质而无人察觉。
// 这里两道防线：① 关键键变更必须显式确认（否则 409，配置不动）；
// ② 每次成功保存写入版本 meta（ver/hash/changedKeys/ts，经内核 cfusionMeta 键随配置一同持久化）。
// 关键集按 P3 任务书口径：模式/协议开关/出站/凭据。d（自定义入口）、freeCpu、customDNS
// 曾考虑纳入，但与上游控制台既定流程（改入口是一级功能）冲突，本期不拦，列入报告存疑待定。
const CRITICAL_CONFIG_KEYS = new Set(['subMode', 'ev', 'et', 'ex', 's', 'p', 'qj', 'warpConf', 'masqueConf']);
const SECRET_CONFIG_KEYS = new Set(['warpConf', 'masqueConf', 's']);
const META_CONFIG_KEY = 'cfusionMeta';

function configHash(config) {
  const entries = Object.entries(config || {}).filter(([key, value]) => key !== META_CONFIG_KEY && value !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return createHash('sha256').update(JSON.stringify(Object.fromEntries(entries)), 'utf8').digest('hex');
}

function parseConfigMeta(raw) {
  try { const meta = JSON.parse(raw || ''); return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : null; }
  catch { return null; }
}

function describeConfigValue(key, value, lang = 'zh') {
  if (SECRET_CONFIG_KEYS.has(key)) return value === '' || value === null || value === undefined ? pickLang(lang, '未设置', 'Not set') : pickLang(lang, '已设置（内容不回显）', 'Set (content hidden)');
  const text = String(value ?? '');
  return text.length > 80 ? text.slice(0, 80) + '…' : text;
}

//  proposed 语义与内核一致：''/null 表示删除该键（回落默认值）。
function diffConfig(current, proposed, defaults, lang = 'zh') {
  const changed = [], critical = [], diff = [];
  for (const [key, raw] of Object.entries(proposed)) {
    if (key === META_CONFIG_KEY) continue;
    const next = raw === '' || raw === null ? (defaults[key] ?? '') : raw;
    const prev = current[key] ?? defaults[key] ?? '';
    if (String(next) === String(prev)) continue;
    changed.push(key);
    if (CRITICAL_CONFIG_KEYS.has(key)) { critical.push(key); diff.push({ key, from: describeConfigValue(key, prev, lang), to: describeConfigValue(key, next, lang) }); }
  }
  return { changed, critical, diff };
}

async function handleWorkerApi(request, workerBase, access, suffix) {
  const lang = requestLang(request);
  try {
    workerBase = selectWorker(workerBase);
    access = normalizeAccess(access, lang);
    if (!['/api/config', '/api/preferred-ips', '/region', '/test-api'].includes(suffix) || !['GET', 'POST', 'DELETE'].includes(request.method)) throw new Error(pickLang(lang, '接口不支持', 'Unsupported endpoint'));
    // CFusion P3-1：设置了管理口令后，一切写路径（配置保存、优选增删改等）必须持有效管理会话；
    // 读路径与订阅生成不拦（订阅客户端没有 cookie 场景，不能断）。
    if (request.method !== 'GET' && !(await adminSessionValid(request))) return Response.json({ success: false, message: pickLang(lang, '需要管理员登录后才能修改配置', 'Admin login is required to modify config') }, { status: 401 });
    if (suffix === '/api/config' && request.method === 'GET') return Response.json(await loadWorkerConfig(workerBase, access));
    let forwardBody = request.method === 'GET' ? undefined : await request.text();
    let configGuard = null;
    if (suffix === '/api/config' && request.method === 'POST') {
      let proposed = null;
      try { proposed = JSON.parse(forwardBody); } catch { proposed = null; }
      if (proposed && typeof proposed === 'object' && !Array.isArray(proposed)) {
        const rawBody = forwardBody;
        try {
          const confirmCritical = proposed.confirmCritical === true || request.headers.get('x-cfusion-confirm-critical') === 'true';
          // confirmCritical 与 cfusionMeta 都是面板专用字段，绝不转发给内核。
          delete proposed.confirmCritical;
          delete proposed[META_CONFIG_KEY];
          forwardBody = JSON.stringify(proposed);
          const current = await loadWorkerConfig(workerBase, access);
          const defaults = createSubscriptionEngine(current, current.uuid).defaults;
          const { changed, critical, diff } = diffConfig(current, proposed, defaults, lang);
          if (critical.length && !confirmCritical) {
            return Response.json({ success: false, needConfirm: true, message: pickLang(lang, '关键配置变更需要确认，配置未保存', 'Critical config changes require confirmation. Nothing was saved.'), changedKeys: changed, criticalChanged: critical, diff }, { status: 409 });
          }
          configGuard = { current, changed };
        } catch {
          // 读不到当前配置（如 Worker 故障）时跳过 guard，恢复原始请求走上游原有错误路径，
          // 不让防漂移逻辑改写 Worker 异常时的状态码与消息语义。
          configGuard = null;
          forwardBody = rawBody;
        }
      }
    }
    const uuid = uuidPattern.test(access) ? access : (await loadWorkerConfig(workerBase, access)).uuid;
    const result = await requestWorkerApi(workerBase, uuid, suffix, request.method, forwardBody);
    let value;
    try { value = JSON.parse(result.body); } catch {}
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      return Response.json({ success: false, message: result.status === 413 ? pickLang(lang, '配置过大，请减少优选条目或改用列表 URL', 'Config too large. Reduce preferred entries or use a list URL') : pickLang(lang, 'Worker 返回无效响应（HTTP ' + result.status + '），请稍后重试', 'Worker returned an invalid response (HTTP ' + result.status + '). Please retry later.') }, { status: result.status >= 400 ? result.status : 502 });
    }
    if (result.status === 200 && request.method !== 'GET') {
      const key = workerBase + '/' + uuid;
      if (value.success && value.config) {
        if (recentConfig.size >= 128) recentConfig.delete(recentConfig.keys().next().value);
        // 以 Worker 已成功持久化后的有效快照消除 KV 跨边缘的短暂旧值。
        recentConfig.set(key, { expires: Date.now() + 70000, config: { ...value.config, uuid, kvEnabled: true } });
      } else if (value.success) recentConfig.delete(key);
      // CFusion P3-3：任一写操作成功后，失效该 Worker 的订阅缓存（配置/优选已变，旧订阅不得再出）。
      if (value.success) subCache.invalidateWorker(workerBase, uuid);
      // CFusion P3-2：配置保存成功且确有变更时，追加写入版本 meta（独立的小保存，
      // 经内核 cfusionMeta 键落 KV）。best-effort：meta 写失败不回滚、不改变本次保存结果。
      if (suffix === '/api/config' && value.success && value.config && configGuard && configGuard.changed.length) {
        try {
          const prevMeta = parseConfigMeta(configGuard.current[META_CONFIG_KEY]);
          const meta = { ver: (Number(prevMeta?.ver) || 0) + 1, hash: configHash(value.config), changedKeys: configGuard.changed, ts: new Date().toISOString() };
          const metaResult = await requestWorkerApi(workerBase, uuid, '/api/config', 'POST', JSON.stringify({ [META_CONFIG_KEY]: JSON.stringify(meta) }));
          if (metaResult.status === 200) {
            const metaValue = JSON.parse(metaResult.body);
            if (metaValue.success && metaValue.config) recentConfig.set(key, { expires: Date.now() + 70000, config: { ...metaValue.config, uuid, kvEnabled: true } });
          }
        } catch { /* meta 写入失败仅使版本记录滞后，下一次成功保存会补上 */ }
      }
    }
    return new Response(result.body, { status: result.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error) { return Response.json({ success: false, message: error.message }, { status: error.status || 400 }); }
}

export async function handlePanel(request) {
  const url = new URL(request.url);
  const lang = requestLang(request);
  if (url.pathname.startsWith('/api/admin/')) {
    const adminResponse = await handleAdminApi(request, url);
    if (adminResponse) return adminResponse;
    return Response.json({ success: false, message: pickLang(lang, '接口不支持', 'Unsupported endpoint') }, { status: 404 });
  }
  if (url.pathname.startsWith('/worker-api/')) {
    const match = url.pathname.match(/^\/worker-api\/([^/]+)\/([0-9a-f-]+)(\/.*)$/i);
    if (!match || !uuidPattern.test(match[2])) return Response.json({ success: false, message: pickLang(lang, '接口地址无效', 'Invalid endpoint address') }, { status: 400 });
    return handleWorkerApi(request, Buffer.from(match[1], 'base64url').toString('utf8'), match[2], match[3]);
  }
  let boundWorker;
  try { boundWorker = allowedWorker(); }
  catch (error) { return new Response(error.message, { status: error.status || 503 }); }
  if (boundWorker) {
    const match = url.pathname.match(/^\/(.+)(\/api\/config|\/api\/preferred-ips|\/region|\/test-api)\/?$/);
    if (match) return handleWorkerApi(request, boundWorker, match[1], match[2]);
  }
  if (['/api/preferred/probe', '/api/preferred/list'].includes(url.pathname)) {
    if (request.method !== 'POST') return Response.json({ message: pickLang(lang, '只支持 POST', 'POST only') }, { status: 405 });
    try {
      const data = await request.json();
      const workerBase = selectWorker(data.host);
      const uuid = normalizeAccess(data.uuid, lang);
      await authorizePreferred(workerBase, uuid);
      if (url.pathname.endsWith('/list')) {
        const list = outboundMode() === 'fetch'
          ? await fetchPreferredListFetch(data.url, request.signal, { normalize: normalizePreferredList, allowPrivate: privateTesting })
          : await fetchPreferredList(data.url, request.signal);
        return new Response(list, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
      // CFusion P4: fetch cannot dial a selected IP, so the probe is an
      // explicit degraded result on Cloudflare rather than a fake latency.
      return Response.json(outboundMode() === 'fetch'
        ? await probePreferredFetch(workerBase, data.address, data.port, request.signal)
        : await probePreferred(workerBase, data.address, data.port, request.signal));
    } catch (error) {
      return Response.json({ success: false, message: error.message, latency: -1 }, { status: error.status || 400 });
    }
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(pickLang(lang, '只支持 GET', 'GET only'), { status: 405 });
  if (url.pathname === '/health') return Response.json({ ok: true });
  if (url.pathname === '/rules-license') return new Response(rulesLicense, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });
  if (url.pathname === '/') {
    if (boundWorker) return new Response('hello', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    try { return new Response(landing, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }); }
    catch (error) { return new Response(error.message, { status: error.status || 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
  }
  const legacy = ['/panel', '/sub'].includes(url.pathname) && (!boundWorker || url.searchParams.has('uuid') || url.searchParams.has('host'));
  const protectedPath = /^\/(?:api|data|public|tools)(?:\/|$)/.test(url.pathname) || url.pathname.startsWith('/.') || /^\/(?:server\.mjs|engine\.mjs|preferred\.mjs|release\.mjs|package(?:-lock)?\.json|index\.html|bridge\.js|theme\.css|favicon\.ico|robots\.txt)$/.test(url.pathname);
  if (!legacy && (!boundWorker || protectedPath)) return new Response('Not Found', { status: 404 });
  const pathname = url.pathname.replace(/\/+$/, '');
  const subscription = legacy ? url.pathname === '/sub' : pathname.endsWith('/sub') && pathname.length > 4;
  try {
    const workerBase = selectWorker(url.searchParams.get('host'));
    const access = normalizeAccess(legacy ? url.searchParams.get('uuid') : pathname.slice(1, subscription ? -4 : undefined), lang);
    const config = await loadWorkerConfig(workerBase, access, lang);
    const uuid = config.uuid;
    const target = url.searchParams.get('target') || targetForAgent(request.headers.get('User-Agent'));
    // CFusion P3-3：订阅缓存按归一化键命中时直接返回（随机查询参数不击穿）。
    let subCacheKey = null;
    if (subscription) {
      subCacheKey = buildSubCacheKey({ host: workerBase, uuid, target, agent: request.headers.get('User-Agent') || '', method: request.method });
      const hit = subCache.get(subCacheKey);
      if (hit) return new Response(hit.body, { status: hit.status, headers: hit.headers });
    }
    // CFusion P1：optimizerAuto 开启时，订阅生成改用优选引擎的池（替换 yx 输入）；
    // resolveOptimizerYx 全程 fail-open，返回 null 时保持原配置与原流程。页面渲染仍用原配置。
    let effectiveConfig = config;
    if (subscription) {
      const optimizerYx = await resolveOptimizerYx(config).catch(() => null);
      if (optimizerYx) effectiveConfig = { ...config, yx: optimizerYx };
    }
    const engine = createSubscriptionEngine(effectiveConfig, uuid);
    // 节点生成用 Worker 主机，不能误用面板主机作为 SNI/Host。
    const workerUrl = new URL(workerBase + '/' + uuid + '/sub');
    workerUrl.searchParams.set('target', target);
    if (subscription) {
      let response = await engine.subscribe(new Request(workerUrl, { headers: request.headers }));
      // CFusion P2：subMode=warp/masque 且凭据齐备时，把模式节点并入订阅（按 target 家族分发）。
      // worker 模式或凭据缺失（fail-closed）时响应逐字节不变。
      if (response.ok && normalizeSubMode(effectiveConfig) !== 'worker') {
        const modeNodes = buildModeNodes(effectiveConfig);
        if (modeNodes.length) {
          const merged = mergeModeSubscription(await response.clone().text(), target, modeNodes);
          if (merged !== null) response = new Response(merged, { status: response.status, headers: response.headers });
        }
      }
      if (response.ok && subCacheKey) {
        const headers = {};
        for (const name of ['content-type', 'content-disposition']) {
          const headerValue = response.headers.get(name);
          if (headerValue) headers[name] = headerValue;
        }
        subCache.set(subCacheKey, { status: response.status, headers, body: await response.clone().text() });
      }
      return response;
    }
    const rendered = await engine.render(new Request(workerBase + '/' + uuid, { headers: request.headers }));
    const subParams = new URLSearchParams({ host: workerBase, uuid });
    const context = { host: workerBase, uuid, apiBase: boundWorker ? '/' + uuid : '/worker-api/' + Buffer.from(workerBase).toString('base64url') + '/' + uuid, subPath: boundWorker ? '/' + uuid + '/sub' : '/sub?' + subParams, ...(boundWorker ? { panelPath: '/' + uuid } : {}), config, release: coreRelease(config) };
    const boot = '<script>window.CFNEW=' + safeJson(context) + ';window.CFNEW.subUrl=location.origin+window.CFNEW.subPath;' + bridge + '</script>';
    let html = await rendered.text();
    html = html.replace('<head>', '<head>' + boot + theme);
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (error) {
    if (subscription) return new Response(pickLang(lang, '订阅更新失败：', 'Subscription update failed: ') + error.message, { status: error.status || 503 });
    if (!legacy && [403, 404].includes(error.upstreamStatus)) return new Response('Not Found', { status: 404 });
    const message = String(error.message).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
    const pageTitle = pickLang(lang, '连接未完成', 'Connection incomplete');
    return new Response('<!doctype html><html lang="' + pickLang(lang, 'zh-CN', 'en') + '"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + pageTitle + '</title>' + theme + '<body class="landing"><main><div class="brand">CFNEW</div><h1>' + pageTitle + '</h1><p>' + message + '</p><a href="/">' + pickLang(lang, '返回重新填写', 'Go back and try again') + '</a></main></body></html>', { status: error.status || 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

export function createPanelServer() {
  return createHttpServer(async (incoming, outgoing) => {
    const nodeLang = (() => {
      const saved = parseCookieHeader(incoming.headers.cookie).preferredLanguage;
      if (saved) return String(saved).toLowerCase().startsWith('en') ? 'en' : 'zh';
      const browser = String(incoming.headers['accept-language'] || '').split(',')[0].split('-')[0].toLowerCase();
      return browser === 'en' ? 'en' : 'zh';
    })();
    try {
      const chunks = []; let size = 0;
      if (!['GET', 'HEAD'].includes(incoming.method)) {
        for await (const chunk of incoming) {
          size += chunk.length;
          if (size > 1048576) {
            outgoing.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            outgoing.end(JSON.stringify({ success: false, message: pickLang(nodeLang, '配置过大，请减少优选条目或改用列表 URL（请求上限 1 MiB）', 'Config too large. Reduce preferred entries or use a list URL (request limit 1 MiB)') }));
            return;
          }
          chunks.push(chunk);
        }
      }
      const request = new Request('http://' + (incoming.headers.host || 'localhost') + incoming.url, { method: incoming.method, headers: incoming.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      const response = await handlePanel(request);
      const headers = Object.fromEntries(response.headers);
      // 与 cf-entry 一致：处理器自设的 Cache-Control 保留；控制台 HTML 壳允许
      // 私有缓存 5 分钟；其余维持 no-store。
      if (!('cache-control' in headers)) {
        const type = headers['content-type'] || '';
        headers['Cache-Control'] = incoming.method === 'GET' && response.status === 200 && type.includes('text/html')
          ? 'private, max-age=300'
          : 'no-store';
      }
      Object.assign(headers, { 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
      outgoing.writeHead(response.status, headers);
      if (incoming.method === 'HEAD') { outgoing.end(); return; }
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      outgoing.end(JSON.stringify({ success: false, message: pickLang(nodeLang, '服务暂时不可用，请稍后重试', 'Service temporarily unavailable. Please retry later.') }));
    }
  });
}

if (!process.env.VERCEL && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3100);
  const host = process.env.HOST || '127.0.0.1';
  createPanelServer().listen(port, host, () => console.log('CFnew 独立面板已启动，端口 ' + port));
}
