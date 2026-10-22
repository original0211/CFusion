import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { createCloudflareHandler, prepareCloudflareRuntime } from '../cf-entry.mjs';
import { createKvSessionStore } from '../session.mjs';
import { buildSingboxConfig } from '../singbox.mjs';

const execFileAsync = promisify(execFile);

function fakeKv() {
  const values = new Map();
  const puts = [];
  return {
    values,
    puts,
    get: async key => values.get(key) || null,
    put: async (key, value, options) => { values.set(key, value); puts.push({ key, value, options }); },
    delete: async key => values.delete(key),
  };
}

test('P4：KV session store 签发/校验/过期/注销，且 KV 键不含 token 原文', async () => {
  let now = 1000000;
  const kv = fakeKv();
  const store = createKvSessionStore(kv, { ttlMs: 60000, now: () => now, random: size => Buffer.alloc(size, 7) });
  const token = await store.issue();
  assert.ok(token.length >= 40);
  assert.equal(kv.puts.length, 1);
  assert.ok(!kv.puts[0].key.includes(token));
  assert.equal(kv.puts[0].options.expirationTtl, 60);
  assert.equal(await store.verify(token), true);
  now += 60001;
  assert.equal(await store.verify(token), false);
  const token2 = await store.issue();
  assert.equal(await store.verify(token2), true);
  await store.revoke(token2);
  assert.equal(await store.verify(token2), false);
});

test('P4：Cloudflare handler 在加载 panel 前注入 env、SESSION_KV、资源与 fetch 运行时', async () => {
  const kv = fakeKv();
  let observed = null;
  const handler = createCloudflareHandler({
    assets: { theme: 'T', landing: 'L', bridge: 'B', rulesLicense: 'R' },
    singboxRulesGzBase64: 'AAAA',
    loadPanel: async () => ({
      handlePanel: async request => {
        observed = {
          runtime: globalThis.__CFUSION_RUNTIME__,
          outbound: globalThis.__CFUSION_OUTBOUND__,
          w: process.env.w,
          password: process.env.PANEL_ADMIN_PASSWORD,
          kv: globalThis.__CFUSION_SESSION_KV__ === kv,
          assets: globalThis.__CFUSION_ASSETS__,
          rules: globalThis.__CFUSION_SINGBOX_RULES_GZ_BASE64__,
          method: request.method,
        };
        return new Response('panel-body', { status: 200 });
      },
    }),
  });
  const response = await handler(new Request('https://panel.example/health'), { w: 'https://worker.example', PANEL_ADMIN_PASSWORD: 'secret', SESSION_KV: kv });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'panel-body');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(observed, {
    runtime: 'cloudflare', outbound: 'fetch', w: 'https://worker.example', password: 'secret',
    kv: true, assets: { theme: 'T', landing: 'L', bridge: 'B', rulesLicense: 'R' }, rules: 'AAAA', method: 'GET',
  });
  const head = await handler(new Request('https://panel.example/health', { method: 'HEAD' }), { SESSION_KV: kv });
  assert.equal(await head.text(), '');
});

test('P4：prepareCloudflareRuntime 无 SESSION_KV 时清除旧 binding，避免串用', () => {
  globalThis.__CFUSION_SESSION_KV__ = fakeKv();
  prepareCloudflareRuntime({}, {});
  assert.equal(globalThis.__CFUSION_SESSION_KV__, undefined);
  assert.equal(globalThis.__CFUSION_OUTBOUND__, 'fetch');
});

test('P4：sing-box 规则可由内嵌 gzip base64 在运行时 gunzip（探针 A 结论的落地）', async () => {
  const gz = await readFile(new URL('../singbox-rules.json.gz', import.meta.url));
  globalThis.__CFUSION_SINGBOX_RULES_GZ_BASE64__ = gz.toString('base64');
  const config = buildSingboxConfig([{ proto: 'vless', name: 'n1', server: 'worker.example', port: 443, uuid: '351c9981-04b6-4103-aa4b-864aa9c91469', tls: true }]);
  assert.equal(config.route.rule_set.length, 23);
  assert.ok(config.route.rule_set.every(item => item.type === 'inline'));
  delete globalThis.__CFUSION_SINGBOX_RULES_GZ_BASE64__;
});

test('P4：build-cloudflare 组装出 worker/cf-assets/src 三件套且资源真实内嵌', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cfusion-cf-build-'));
  try {
    await execFileAsync(process.execPath, [new URL('../tools/build-cloudflare.mjs', import.meta.url).pathname, dir]);
    const root = (await readdir(dir)).sort();
    assert.deepEqual(root, ['cf-assets.mjs', 'src', 'worker.mjs']);
    const assets = await readFile(join(dir, 'cf-assets.mjs'), 'utf8');
    assert.match(assets, /singboxRulesGzBase64/);
    assert.ok(assets.length > 800000, 'rules gzip base64 应真实内嵌，实际长度 ' + assets.length);
    const worker = await readFile(join(dir, 'worker.mjs'), 'utf8');
    assert.match(worker, /createCloudflareHandler/);
    const src = await readdir(join(dir, 'src'));
    for (const name of ['server.mjs', 'cf-entry.mjs', 'outbound-fetch.mjs', 'session.mjs']) assert.ok(src.includes(name), name);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('缓存策略：控制台 HTML 私有缓存 5 分钟，处理器自设缓存头保留，API 与错误页仍 no-store', async () => {
  const mk = response => createCloudflareHandler({ loadPanel: async () => ({ handlePanel: async () => response }) });
  let r = await mk(new Response('<html>壳</html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))(new Request('https://panel.example/some-uuid'), {});
  assert.equal(r.headers.get('cache-control'), 'private, max-age=300');
  r = await mk(new Response('x', { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=86400' } }))(new Request('https://panel.example/rules-license'), {});
  assert.equal(r.headers.get('cache-control'), 'public, max-age=86400');
  r = await mk(Response.json({ ok: true }))(new Request('https://panel.example/some-uuid/api/config'), {});
  assert.equal(r.headers.get('cache-control'), 'no-store');
  r = await mk(new Response('<html>err</html>', { status: 400, headers: { 'Content-Type': 'text/html' } }))(new Request('https://panel.example/some-uuid'), {});
  assert.equal(r.headers.get('cache-control'), 'no-store');
  r = await mk(new Response('<html>壳</html>', { method: 'POST', headers: { 'Content-Type': 'text/html' } }))(new Request('https://panel.example/some-uuid', { method: 'POST' }), {});
  assert.equal(r.headers.get('cache-control'), 'no-store');
});
