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
  if (assets) globalThis.__CFUSION_ASSETS__ = assets;
  if (singboxRulesGzBase64) globalThis.__CFUSION_SINGBOX_RULES_GZ_BASE64__ = singboxRulesGzBase64;
  globalThis.__CFUSION_RUNTIME__ = 'cloudflare';
  globalThis.__CFUSION_OUTBOUND__ = 'fetch';
  return proc;
}

function finalize(response, method) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(method === 'HEAD' ? null : response.body, { status: response.status, headers });
}

export function createCloudflareHandler({ loadPanel, assets, singboxRulesGzBase64 } = {}) {
  let panelPromise = null;
  const load = loadPanel || (() => import('./server.mjs'));
  return async function cloudflareFetch(request, env = {}, _ctx) {
    try {
      prepareCloudflareRuntime(env, { assets, singboxRulesGzBase64 });
      panelPromise = panelPromise || load();
      const { handlePanel } = await panelPromise;
      return finalize(await handlePanel(request), request.method);
    } catch {
      return finalize(Response.json({ success: false, message: '服务暂时不可用，请稍后重试' }, { status: 500 }), request.method);
    }
  };
}

export default { fetch: createCloudflareHandler() };
