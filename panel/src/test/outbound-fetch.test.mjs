import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fetchPreferredListFetch, probePreferredFetch, requestWorkerApiFetch } from '../outbound-fetch.mjs';
import { normalizePreferredList } from '../preferred.mjs';

const uuid = '351c9981-04b6-4103-aa4b-864aa9c91469';
const source = await readFile(process.env.CFNEW_TEST_CORE || new URL('../../test/core-fixture.mjs', import.meta.url), 'utf8');
const module = await import('data:text/javascript;base64,' + Buffer.from(source.replace(/import\s*\{\s*connect as ([^}]+)\}\s*from\s*['"]cloudflare:sockets['"];/, (_, name) => 'const ' + name.trim() + ' = () => { throw new Error("测试中不应建立连接"); };')).toString('base64'));
const core = module.default;

function memoryKV(config = {}) {
  const values = new Map([['c', JSON.stringify(config)]]);
  return {
    get: async (key, type) => type === 'json' ? JSON.parse(values.get(key) || 'null') : values.get(key),
    put: async (key, value) => values.set(key, value),
  };
}

async function startCoreServer() {
  const env = { u: uuid, c: memoryKV({ yx: '104.16.1.1:443#初始' }) };
  const server = createServer(async (incoming, outgoing) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const request = new Request('https://worker.example' + incoming.url, {
      method: incoming.method,
      headers: incoming.headers,
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
    });
    const response = await core.fetch(request, env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, base: 'http://127.0.0.1:' + server.address().port };
}

const localResolver = async () => [{ address: '127.0.0.1', family: 4 }];

test('探针B：fetch 版 Worker API 对隔离 core fixture 完成 /api/config 读写往返', async (t) => {
  const { server, base } = await startCoreServer();
  t.after(() => server.close());
  const options = { allowPrivate: true, resolveHost: localResolver };

  const first = await requestWorkerApiFetch(base, uuid, '/api/config', 'GET', undefined, options);
  assert.equal(first.status, 200);
  assert.equal(JSON.parse(first.body).yx, '104.16.1.1:443#初始');

  const saved = await requestWorkerApiFetch(base, uuid, '/api/config', 'POST', JSON.stringify({ qj: 'only' }), options);
  assert.equal(saved.status, 200);
  assert.equal(JSON.parse(saved.body).success, true);

  const reread = await requestWorkerApiFetch(base, uuid, '/api/config', 'GET', undefined, options);
  assert.equal(JSON.parse(reread.body).qj, 'only');
});

test('探针B：fetch 版在解析到私网地址时于发起请求前 fail-closed', async () => {
  let calls = 0;
  await assert.rejects(
    requestWorkerApiFetch('https://worker.example', uuid, '/api/config', 'GET', undefined, {
      resolveHost: async () => [{ address: '10.0.0.8', family: 4 }],
      fetchImpl: async () => { calls += 1; throw new Error('不应发起请求'); },
    }),
    /公网地址/,
  );
  assert.equal(calls, 0);
});

test('探针B：fetch 版优选列表逐跳校验并复用原规范化逻辑', async () => {
  const csv = 'IP地址,端口,数据中心,TLS\n104.16.1.1,8443,SJC,true\n104.16.1.2,80,SJC,false';
  let calls = 0;
  const text = await fetchPreferredListFetch('https://lists.example/preferred.csv', undefined, {
    normalize: normalizePreferredList,
    resolveHost: async () => [{ address: '104.16.1.1', family: 4 }],
    fetchImpl: async () => { calls += 1; return new Response(csv, { status: 200 }); },
  });
  assert.equal(calls, 1);
  assert.equal(text, '104.16.1.1:8443#SJC');
});

test('探针B：fetch 运行时优选探测明确降级，绝不伪造测速结果', async () => {
  const result = await probePreferredFetch('https://worker.example', '104.16.1.1', 443);
  assert.equal(result.success, false);
  assert.equal(result.latency, -1);
  assert.equal(result.degraded, true);
  assert.match(result.error, /降级为不可用/);
});

test('service binding 通道：跳过 DNS 预检且完成 /api/config 往返', async (t) => {
  const { server, base } = await startCoreServer();
  t.after(() => server.close());
  const serviceFetcher = { fetch: (url, init) => fetch(url, init) };
  const options = {
    serviceFetcher,
    resolveHost: async () => { throw new Error('service binding 不应走 DNS 预检'); },
  };
  const first = await requestWorkerApiFetch(base, uuid, '/api/config', 'GET', undefined, options);
  assert.equal(first.status, 200);
  assert.equal(JSON.parse(first.body).yx, '104.16.1.1:443#初始');
});
