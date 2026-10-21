// CFusion P2-3 单测：optimizer* / subMode 等新配置键经 core /api/config 保存后可回读。
// 背景（P1 存疑②，已定位纠正）：过滤不在面板，而在内核 core 的 POST /api/config——
// 它用 Object.hasOwn(F, key) 校验每个键，F 是内核的配置字段表；不在表内的键会让
// 整次保存以 400「配置格式无效」失败。P2-3 已把 P1 的 11 个 optimizer* 键与 P2 的
// 9 个模式键以与 engine 相同的默认值加入 F，并同步 test/core-fixture.mjs（字节一致）。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

process.env.CFNEW_ALLOW_PRIVATE = 'yes';
const { handlePanel } = await import('../server.mjs');
const UUID = '351c9981-04b6-4103-aa4b-864aa9c91469';
const coreSource = await readFile(process.env.CFNEW_TEST_CORE || new URL('./core-fixture.mjs', import.meta.url), 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(coreSource.replace(/import\s*\{\s*connect as ([^}]+)\}\s*from\s*['"]cloudflare:sockets['"];/, (_, name) => 'const ' + name.trim() + ' = () => { throw new Error("隔离测试不建立代理连接"); };')).toString('base64'))).default;
const WARP_CONF = JSON.stringify({
  k: 'cHJpdmtleWZha2UxMjM0NTY3ODkwYWJjZGVmZ2hpamtsbW5vcA==',
  p: 'cGVlcnB1YmtleWZha2UxMjM0NTY3ODkwYWJjZGVmZ2hpamtsbW5vcA==',
  a4: '172.16.0.2', a6: '', pt: 2408, cid: 'AQID'
});

async function fixture(run) {
  const values = new Map([['c', JSON.stringify({ ae: 'yes', yx: '104.16.1.1:443#节点', ev: 'yes', epi: 'yes', epd: 'no', egi: 'no', ena: 'no' })]]);
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
  try { await run({ values, api, host, request }); }
  finally { await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); }
}

test('optimizer* 与模式键经 /api/config 保存后回读仍在', async () => fixture(async ({ api, request }) => {
  // 注：P3-2 起 subMode 属关键键，变更需带 confirmCritical（面板专用字段，不落配置）；本用例验证的仍是「新键可持久化」。
  const saved = await request(api + '/api/config', {
    method: 'POST',
    body: JSON.stringify({ optimizerAuto: 'yes', optimizerLimit: '123', optimizerRegion: 'JP', subMode: 'warp', warpName: '测试W', masqueSni: 'sni.example.com', confirmCritical: true })
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).success, true);
  const config = await (await request(api + '/api/config')).json();
  assert.equal(config.optimizerAuto, 'yes');
  assert.equal(config.optimizerLimit, '123');
  assert.equal(config.optimizerRegion, 'JP');
  assert.equal(config.subMode, 'warp');
  assert.equal(config.warpName, '测试W');
  assert.equal(config.masqueSni, 'sni.example.com');
  // 未保存的新键回读为内核字段表默认值（与 engine 默认一致）
  assert.equal(config.optimizerUseCidr, 'yes');
  assert.equal(config.warpEps, '');
}));

test('字段过滤仍然有效：表外键整次保存被拒', async () => fixture(async ({ api, request }) => {
  const saved = await request(api + '/api/config', { method: 'POST', body: JSON.stringify({ noSuchKey: 'x' }) });
  assert.equal(saved.status, 400);
  assert.equal((await saved.json()).success, false);
}));

test('全链路：保存 subMode=warp + warpConf 后，订阅出现 wireguard 节点', async () => fixture(async ({ api, host, request }) => {
  const saved = await request(api + '/api/config', {
    method: 'POST',
    body: JSON.stringify({ subMode: 'warp', warpConf: WARP_CONF, warpEps: '162.159.192.1:2408', confirmCritical: true })
  });
  assert.equal(saved.status, 200);
  const sub = await (await request('/sub?' + new URLSearchParams({ host, uuid: UUID, target: 'base64' }))).text();
  const decoded = Buffer.from(sub, 'base64').toString('utf8');
  assert.ok(decoded.includes('wireguard://'), '订阅应并入 WARP 分享行');
  assert.ok(decoded.includes('vless://'), '原 worker 节点仍在（并入而非隔离）');
}));
