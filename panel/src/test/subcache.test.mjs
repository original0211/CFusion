// CFusion P3-3 单测：订阅缓存（归一化键 + LRU32 + TTL + 保存失效）。
// 背景：CFNext 缓存曾用完整 URL 作键，?x=随机 即可击穿并放大生成 CPU。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

process.env.CFNEW_ALLOW_PRIVATE = 'yes';
const { handlePanel } = await import('../server.mjs');
const { createSubCache, buildSubCacheKey, SUB_CACHE_LIMIT } = await import('../subcache.mjs');
const UUID = '351c9981-04b6-4103-aa4b-864aa9c91469';
const coreSource = await readFile(process.env.CFNEW_TEST_CORE || new URL('./core-fixture.mjs', import.meta.url), 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(coreSource.replace(/import\s*\{\s*connect as ([^}]+)\}\s*from\s*['"]cloudflare:sockets['"];/, (_, name) => 'const ' + name.trim() + ' = () => { throw new Error("隔离测试不建立代理连接"); };')).toString('base64'))).default;

test('键归一化：维度齐全才同键，target/UA/方法/host/uuid 任一不同即异键', () => {
  const base = { host: 'https://w.example', uuid: UUID, target: 'clash', agent: 'Clash', method: 'GET' };
  assert.equal(buildSubCacheKey(base), buildSubCacheKey({ ...base }));
  assert.notEqual(buildSubCacheKey(base), buildSubCacheKey({ ...base, target: 'singbox' }));
  assert.notEqual(buildSubCacheKey(base), buildSubCacheKey({ ...base, agent: 'sing-box' }));
  assert.notEqual(buildSubCacheKey(base), buildSubCacheKey({ ...base, method: 'HEAD' }));
  assert.notEqual(buildSubCacheKey(base), buildSubCacheKey({ ...base, host: 'https://other.example' }));
  assert.notEqual(buildSubCacheKey(base), buildSubCacheKey({ ...base, uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }));
  assert.equal(SUB_CACHE_LIMIT, 32);
});

test('LRU：超上限淘汰最久未用，命中刷新热度', () => {
  const cache = createSubCache({ limit: 3, ttlMs: 100000, now: () => 1000 });
  cache.set('a', 1); cache.set('b', 2); cache.set('c', 3);
  assert.equal(cache.get('a'), 1, '命中 a 后 a 变为最新');
  cache.set('d', 4);
  assert.equal(cache.get('b'), null, '最久未用的 b 应被淘汰');
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('c'), 3);
  assert.equal(cache.get('d'), 4);
  assert.equal(cache.size, 3);
});

test('TTL 过期与按 Worker 失效', () => {
  let now = 0;
  const cache = createSubCache({ ttlMs: 60000, now: () => now });
  const k1 = buildSubCacheKey({ host: 'https://w1.example', uuid: UUID, target: 'clash', agent: '', method: 'GET' });
  const k2 = buildSubCacheKey({ host: 'https://w2.example', uuid: UUID, target: 'clash', agent: '', method: 'GET' });
  cache.set(k1, 'one'); cache.set(k2, 'two');
  cache.invalidateWorker('https://w1.example', UUID);
  assert.equal(cache.get(k1), null, '被失效 Worker 的条目应清除');
  assert.equal(cache.get(k2), 'two', '其它 Worker 不受影响');
  now += 60001;
  assert.equal(cache.get(k2), null, 'TTL 到期应视为未命中');
});

async function fixture(run) {
  const values = new Map([['c', JSON.stringify({ ae: 'yes', yx: '104.16.1.1:443#节点A', ev: 'yes', epi: 'yes', epd: 'no', egi: 'no', ena: 'no' })]]);
  const storage = { get: async key => JSON.parse(values.get(key) || 'null'), put: async (key, value) => values.set(key, value) };
  const server = createServer(async (incoming, outgoing) => {
    const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const response = await worker.fetch(new Request('http://' + incoming.headers.host + incoming.url, { method: incoming.method, ...(body.length ? { body } : {}) }), { u: UUID, C: storage });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const host = 'http://127.0.0.1:' + server.address().port;
  const api = '/worker-api/' + Buffer.from(host).toString('base64url') + '/' + UUID;
  const request = (path, init) => handlePanel(new Request('https://panel.example' + path, init));
  const sub = extra => request('/sub?' + new URLSearchParams({ host, uuid: UUID, target: 'base64', ...(extra || {}) })).then(r => r.text()).then(t => Buffer.from(t, 'base64').toString('utf8'));
  try { await run({ values, api, host, request, sub }); }
  finally { await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); }
}

test('集成：随机查询参数不击穿；面板保存后失效出新订阅', async () => fixture(async ({ values, api, request, sub }) => {
  const first = await sub();
  assert.ok(first.includes('104.16.1.1'), '首份订阅应含节点 A 入口');
  // 直接改 Worker KV（绕过面板）：若无缓存，下一份订阅应立刻变 B。
  values.set('c', JSON.stringify({ ae: 'yes', yx: '104.16.5.5:443#节点B', ev: 'yes', epi: 'yes', epd: 'no', egi: 'no', ena: 'no' }));
  const second = await sub({ x: 'random-' + Math.random(), ts: String(Date.now()) });
  assert.equal(second, first, '随机参数应命中同一缓存，订阅不变');
  // 经面板保存任意普通键 → 该 Worker 缓存失效 → 订阅反映最新 KV。
  const saved = await request(api + '/api/config', { method: 'POST', body: JSON.stringify({ rm: 'cache-bust' }) });
  assert.equal(saved.status, 200);
  await saved.json();
  const third = await sub({ x: 'another-random' });
  assert.ok(third.includes('104.16.5.5'), '保存失效后订阅应含节点 B 入口');
  assert.ok(!third.includes('104.16.1.1'), '旧入口不应再出现');
}));
