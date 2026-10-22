// CFusion P4: Cloudflare Workers entry adapter.
//
// This module is deliberately free of asset imports so it can be unit
// tested in Node. The deployable worker (panel/cloudflare/worker.mjs, copied
// into the build output by build-cloudflare.mjs) supplies embedded assets;
// tests can inject a fake panel loader.
//
// Runtime preparation must happen before server.mjs is imported because
// server.mjs captures process.env, embedded assets, the session KV binding
// and the outbound mode at module scope. Hence the dynamic import below.

export function prepareCloudflareRuntime(env = {}, { assets, singboxRulesGzBase64 } = {}) {
  const proc = globalThis.process || (globalThis.process = { env: {} });
  proc.env = proc.env || {};
  if (!Array.isArray(proc.argv)) proc.argv = [];
  for (const [key, value] of Object.entries(env || {})) {
    if (typeof value === 'string') proc.env[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') proc.env[key] = String(value);
  }
  if (env && env.SESSION_KV) globalThis.__CFUSION_SESSION_KV__ = env.SESSION_KV;
  else delete globalThis.__CFUSION_SESSION_KV__;
  if (env && env.CORE && typeof env.CORE.fetch === 'function') globalThis.__CFUSION_CORE_FETCHER__ = env.CORE;
  else delete globalThis.__CFUSION_CORE_FETCHER__;
  if (assets) globalThis.__CFUSION_ASSETS__ = assets;
  if (singboxRulesGzBase64) globalThis.__CFUSION_SINGBOX_RULES_GZ_BASE64__ = singboxRulesGzBase64;
  globalThis.__CFUSION_RUNTIME__ = 'cloudflare';
  globalThis.__CFUSION_OUTBOUND__ = 'fetch';
  return proc;
}

function finalize(response, request) {
  const headers = new Headers(response.headers);
  if (!headers.has('Cache-Control')) {
    // 控制台 HTML 是静态壳：数据走 API 单独拉取，壳本身允许浏览器私有缓存
    // 5 分钟，避免每次打开都全量重下 195KB 并重解析内联脚本（实测卡顿主因）。
    // 处理器自己设了 Cache-Control 的响应（订阅、/rules-license 等）原样保留；
    // 其余（配置/管理 API、非 200、非 HTML）一律维持 no-store。
    const type = headers.get('Content-Type') || '';
    if (request.method === 'GET' && response.status === 200 && type.includes('text/html')) {
      headers.set('Cache-Control', 'private, max-age=300');
    } else {
      headers.set('Cache-Control', 'no-store');
    }
  }
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
}

export function createCloudflareHandler({ loadPanel, assets, singboxRulesGzBase64 } = {}) {
  let panelPromise = null;
  const load = loadPanel || (() => import('./server.mjs'));
  return async function cloudflareFetch(request, env = {}, _ctx) {
    try {
      prepareCloudflareRuntime(env, { assets, singboxRulesGzBase64 });
      panelPromise = panelPromise || load();
      const { handlePanel } = await panelPromise;
      return finalize(await handlePanel(request), request);
    } catch {
      const cookieLang = (request.headers.get('cookie') || '').match(/(?:^|;\s*)preferredLanguage=([^;]*)/)?.[1] || '';
      const message = cookieLang.toLowerCase().startsWith('en') ? 'Service temporarily unavailable. Please retry later.' : '服务暂时不可用，请稍后重试';
      return finalize(Response.json({ success: false, message }, { status: 500 }), request);
    }
  };
}

export default { fetch: createCloudflareHandler() };
