// CFusion P2 单测：Worker 注册表（管理模式）。
// registry.mjs 纯逻辑单测 + handlePanel 层面的双 Worker 隔离与 w 模式越权检查。
// 隔离 Worker 机制与 worker-policy.test.mjs 相同（内存 KV 的真实 core 夹具），不打外网。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  REGISTRY_KEY, REGISTRY_LIMIT, normalizeRegistryEntry, parseRegistry,
  serializeRegistry, upsertRegistryEntry, removeRegistryEntry,
  findRegistryEntry, registryDisplayName, maskAccessId
} from '../registry.mjs';

const UUID = '351c9981-04b6-4103-aa4b-864aa9c91469';
const UUID2 = '22222222-2222-4222-8222-222222222222';

test('registry 条目归一化与旧数据兼容', () => {
  assert.deepEqual(normalizeRegistryEntry({ host: ' a.example ', uuid: UUID }), { name: '', host: 'a.example', uuid: UUID });
  assert.deepEqual(normalizeRegistryEntry({ name: ' 主力 ', host: 'a.example', uuid: UUID }), { name: '主力', host: 'a.example', uuid: UUID });
  assert.equal(normalizeRegistryEntry({ host: '', uuid: UUID }), null);
  assert.equal(normalizeRegistryEntry({ host: 'a.example' }), null);
  assert.equal(normalizeRegistryEntry(null), null);
  // 上游旧格式 {host, uuid}（无 name）可直接解析
  const parsed = parseRegistry(JSON.stringify([{ host: 'old.example', uuid: UUID }]));
  assert.deepEqual(parsed, [{ name: '', host: 'old.example', uuid: UUID }]);
});

test('registry 解析容错、双键去重与上限', () => {
  assert.deepEqual(parseRegistry('not json'), []);
  assert.deepEqual(parseRegistry('{"a":1}'), []);
  const many = Array.from({ length: 30 }, (_, i) => ({ host: 'h' + i + '.example', uuid: UUID }));
  assert.equal(parseRegistry(JSON.stringify(many)).length, REGISTRY_LIMIT);
  const dup = parseRegistry(JSON.stringify([
    { host: 'a.example', uuid: UUID }, { host: 'a.example', uuid: UUID },
    { host: 'a.example', uuid: UUID2 }
  ]));
  assert.equal(dup.length, 2, '同 host 不同 uuid 是两条（多 Worker 可同域不同口径）');
});

test('registry upsert 置顶更新、remove 与查找', () => {
  let entries = [];
  entries = upsertRegistryEntry(entries, { name: '甲', host: 'a.example', uuid: UUID });
  entries = upsertRegistryEntry(entries, { name: '乙', host: 'b.example', uuid: UUID2 });
  assert.equal(entries[0].name, '乙');
  entries = upsertRegistryEntry(entries, { name: '甲改', host: 'a.example', uuid: UUID });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, '甲改', '同 host+uuid 更新并置顶，不新增');
  assert.equal(findRegistryEntry(entries, 'b.example', UUID2), 1);
  assert.equal(findRegistryEntry(entries, 'b.example', UUID), -1);
  entries = removeRegistryEntry(entries, 0);
  assert.deepEqual(entries.map(e => e.name), ['乙']);
  assert.equal(serializeRegistry(entries), JSON.stringify(entries));
});

test('registry 展示名与凭据掩码（UUID 不明文展示）', () => {
  assert.equal(registryDisplayName({ name: '主力', host: 'a.example' }), '主力');
  assert.equal(registryDisplayName({ name: '', host: 'a.example' }), 'a.example');
  assert.equal(maskAccessId(UUID), '351c9981…');
  assert.ok(!maskAccessId(UUID).includes('04b6'));
  assert.equal(maskAccessId('/Admin/Panel'), '••••');
  assert.equal(REGISTRY_KEY, 'cfnew-panel-nodes', '与上游记住节点同一存储键');
});

// ---- handlePanel 层面：双 Worker 切换互不串配置 ----
process.env.CFNEW_ALLOW_PRIVATE = 'yes';
const { handlePanel } = await import('../server.mjs');
const coreSource = await readFile(process.env.CFNEW_TEST_CORE || new URL('./core-fixture.mjs', import.meta.url), 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(coreSource.replace(/import\s*\{\s*connect as ([^}]+)\}\s*from\s*['"]cloudflare:sockets['"];/, (_, name) => 'const ' + name.trim() + ' = () => { throw new Error("隔离测试不建立代理连接"); };')).toString('base64'))).default;

async function fixture(run) {
  const previous = process.env.w;
  delete process.env.w;
  const servers = [];
  const targets = [];
  try {
    for (const [uuid, marker] of [[UUID, '甲站'], [UUID2, '乙站']]) {
      const values = new Map([['c', JSON.stringify({ ae: 'yes', yx: '104.16.1.1:443#' + marker, ev: 'yes', epi: 'yes', epd: 'no', egi: 'no', ena: 'no' })]]);
      const storage = { get: async key => JSON.parse(values.get(key) || 'null'), put: async (key, value) => values.set(key, value) };
      const server = createServer(async (incoming, outgoing) => {
        const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const response = await worker.fetch(new Request('http://' + incoming.headers.host + incoming.url, { method: incoming.method, ...(body.length ? { body } : {}) }), { u: uuid, C: storage });
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      });
      servers.push(server);
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const host = 'http://127.0.0.1:' + server.address().port;
      targets.push({ uuid, marker, host, api: '/worker-api/' + Buffer.from(host).toString('base64url') + '/' + uuid });
    }
    const request = (path, init) => handlePanel(new Request('https://panel.example' + path, init));
    await run({ a: targets[0], b: targets[1], request });
  } finally {
    if (previous === undefined) delete process.env.w; else process.env.w = previous;
    await Promise.all(servers.map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
  }
}

test('双 Worker 来回切换：配置与订阅只含各自标记，互不串扰', async () => fixture(async ({ a, b, request }) => {
  for (const round of [0, 1]) {
    for (const target of [a, b]) {
      const other = target === a ? b : a;
      const config = await (await request(target.api + '/api/config')).json();
      assert.ok(JSON.stringify(config).includes(target.marker), '配置含本 Worker 标记');
      assert.ok(!JSON.stringify(config).includes(other.marker), '配置不含另一 Worker 标记');
      const sub = await (await request('/sub?' + new URLSearchParams({ host: target.host, uuid: target.uuid }))).text();
      const decoded = Buffer.from(sub, 'base64').toString('utf8');
      // 分享链接里的节点名经 encodeURIComponent 编码，按编码形态断言。
      assert.ok(decoded.includes(encodeURIComponent(target.marker)), '订阅含本 Worker 节点名');
      assert.ok(!decoded.includes(encodeURIComponent(other.marker)), '订阅不含另一 Worker 节点名');
    }
  }
}));

test('w 单绑定模式：首页是 hello（无注册表），注册表里的其它 Worker 也调不动', async () => fixture(async ({ a, b, request }) => {
  process.env.w = a.host;
  const home = await (await request('/')).text();
  assert.equal(home, 'hello');
  assert.ok(!home.includes('cfnew-panel-nodes'));
  assert.equal((await request(a.api + '/api/config')).status, 200, '绑定 Worker 正常');
  assert.equal((await request(b.api + '/api/config')).status, 403, '注册表中的其它 Worker 在 w 模式下被拒绝');
  const bridge = await readFile(new URL('../bridge.js', import.meta.url), 'utf8');
  assert.ok(bridge.includes('workerRegistry'), 'bridge 含注册表切换器');
  assert.ok(/CFNEW\.panelPath\) return/.test(bridge), 'bridge 在单绑定（panelPath）模式下禁用注册表');
  const landing = await (await request('/')).text();
  assert.equal(landing, 'hello');
  delete process.env.w;
  const publicHome = await (await request('/')).text();
  assert.ok(publicHome.includes('cfnew-panel-nodes'), '公共模式首页含注册表存储键');
  assert.ok(publicHome.includes('nodeName'), '公共模式首页含名称字段');
}));
