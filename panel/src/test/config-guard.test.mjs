// CFusion P3-2 单测：配置变更防漂移（关键键确认 + 版本 meta）。
// 背景：CFNext 曾发生 config.mode 被外部反复切换、订阅静默变质而无人察觉。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

process.env.CFNEW_ALLOW_PRIVATE = 'yes';
const { handlePanel } = await import('../server.mjs');
const UUID = '351c9981-04b6-4103-aa4b-864aa9c91469';
const coreSource = await readFile(process.env.CFNEW_TEST_CORE || new URL('./core-fixture.mjs', import.meta.url), 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(coreSource.replace(/import\s*\{\s*connect as ([^}]+)\}\s*from\s*['"]cloudflare:sockets['"];/, (_, name) => 'const ' + name.trim() + ' = () => { throw new Error("隔离测试不建立代理连接"); };')).toString('base64'))).default;

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
  const post = (body, headers) => request(api + '/api/config', { method: 'POST', headers, body: JSON.stringify(body) });
  const getConfig = async () => (await request(api + '/api/config')).json();
  try { await run({ values, api, host, request, post, getConfig }); }
  finally { await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); }
}

test('普通键直通保存，并写入 ver=1 的 meta（hash/changedKeys/ts 齐全）', async () => fixture(async ({ post, getConfig, values }) => {
  const saved = await post({ yx: '104.16.2.2:443#新优选' });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).success, true);
  const config = await getConfig();
  assert.equal(config.yx, '104.16.2.2:443#新优选');
  const meta = JSON.parse(config.cfusionMeta);
  assert.equal(meta.ver, 1);
  assert.deepEqual(meta.changedKeys, ['yx']);
  assert.match(meta.hash, /^[0-9a-f]{64}$/);
  assert.ok(meta.ts);
  assert.ok(String(values.get('c')).includes('cfusionMeta'), 'meta 应随配置一同落 KV');
  const saved2 = await post({ yx: '104.16.3.3:443#再改' });
  assert.equal(saved2.status, 200);
  await saved2.json();
  const meta2 = JSON.parse((await getConfig()).cfusionMeta);
  assert.equal(meta2.ver, 2, '再次变更版本递增');
  assert.notEqual(meta2.hash, meta.hash, '配置变化 hash 应变化');
}));

test('关键键无确认被拒（配置未变、无 meta）；带确认后成功且 ver 递增；diff 对凭据脱敏', async () => fixture(async ({ post, getConfig }) => {
  const rejected = await post({ subMode: 'warp' });
  assert.equal(rejected.status, 409);
  const rejectedBody = await rejected.json();
  assert.equal(rejectedBody.needConfirm, true);
  assert.deepEqual(rejectedBody.criticalChanged, ['subMode']);
  let config = await getConfig();
  assert.equal(config.subMode, 'worker', '被拒后配置不应变化');
  assert.equal(config.cfusionMeta, '', '被拒不应写入 meta');

  const secret = 'FAKEPRIVKEY-do-not-leak';
  const rejectedSecret = await post({ warpConf: secret });
  assert.equal(rejectedSecret.status, 409);
  const rejectedSecretText = await rejectedSecret.text();
  assert.ok(!rejectedSecretText.includes(secret), '409 diff 不得回显凭据原文');
  assert.ok(JSON.parse(rejectedSecretText).diff[0].to.includes('已设置'));

  const confirmed = await post({ subMode: 'warp', warpConf: secret, confirmCritical: true });
  assert.equal(confirmed.status, 200, '带确认应保存成功（confirmCritical 不得转发给内核）');
  assert.equal((await confirmed.json()).success, true);
  config = await getConfig();
  assert.equal(config.subMode, 'warp');
  const meta = JSON.parse(config.cfusionMeta);
  assert.equal(meta.ver, 1);
  assert.ok(meta.changedKeys.includes('subMode') && meta.changedKeys.includes('warpConf'));
  assert.ok(!('confirmCritical' in config), '面板专用字段不得落入配置');
}));

test('P3-4：Worker 配置接口返回非 JSON 时给出通用错误，不回显解析器原文', async () => {
  const stub = createServer((incoming, outgoing) => { outgoing.writeHead(200, { 'Content-Type': 'text/html' }); outgoing.end('<html>not json</html>'); });
  await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
  try {
    const host = 'http://127.0.0.1:' + stub.address().port;
    const api = '/worker-api/' + Buffer.from(host).toString('base64url') + '/' + UUID;
    const response = await handlePanel(new Request('https://panel.example' + api + '/api/config'));
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.message, '该地址没有兼容的配置接口');
    assert.ok(!String(body.message).includes('Unexpected'));
  } finally { await new Promise(resolve => { stub.closeAllConnections(); stub.close(resolve); }); }
});

test('关键键删除（回落默认）同样需要确认；请求头确认亦可', async () => fixture(async ({ post, getConfig }) => {
  const setup = await post({ subMode: 'masque', confirmCritical: true });
  assert.equal(setup.status, 200);
  await setup.json();
  const rejected = await post({ subMode: '' });
  assert.equal(rejected.status, 409, '把 subMode 删回默认也是关键变更');
  await rejected.json();
  const confirmed = await post({ subMode: '' }, { 'x-cfusion-confirm-critical': 'true' });
  assert.equal(confirmed.status, 200);
  await confirmed.json();
  const config = await getConfig();
  assert.equal(config.subMode, 'worker', '删除后回落默认值');
  assert.equal(JSON.parse(config.cfusionMeta).ver, 2);
}));
