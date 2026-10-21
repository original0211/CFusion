import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createSubscriptionEngine } from '../engine.mjs';

const uuid = '351c9981-04b6-4103-aa4b-864aa9c91469';
const source = await readFile(process.env.CFNEW_TEST_CORE || new URL('../../test/core-fixture.mjs', import.meta.url), 'utf8');
const stripped = source.replace(/import\s*\{\s*connect as ([^}]+)\}\s*from\s*['"]cloudflare:sockets['"];/, (_, name) => 'const ' + name.trim() + ' = () => { throw new Error("此测试不建立代理连接"); };');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(stripped).toString('base64'))).default;
const request = init => new Request('https://worker.example/' + uuid + '/api/config', init);
function storage(initial = {}) {
  const values = new Map([['c', JSON.stringify(initial)]]);
  return { values, get: async key => JSON.parse(values.get(key) || 'null'), put: async (key, value) => values.set(key, value) };
}

test('Free保护默认关闭，环境变量可开启，KV可覆盖且保存后立即读回', async () => {
  assert.equal((await (await worker.fetch(request(), { u: uuid })).json()).freeCpu, 'no');
  assert.equal((await (await worker.fetch(request(), { u: uuid, FREE_CPU: 'yes' })).json()).freeCpu, 'yes');
  const C = storage(); const env = { u: uuid, C, freeCpu: 'yes' };
  for (const value of ['no', 'yes', false, true]) {
    const saved = await worker.fetch(request({ method: 'POST', body: JSON.stringify({ freeCpu: value }) }), env);
    assert.equal(saved.status, 200);
    const config = await (await worker.fetch(request(), env)).json();
    assert.equal(config.freeCpu, value === 'yes' || value === true ? 'yes' : 'no');
  }
  await worker.fetch(request({ method: 'POST', body: '{"freeCpu":""}' }), env);
  assert.equal((await (await worker.fetch(request(), env)).json()).freeCpu, 'yes');
  assert.equal(Object.hasOwn(JSON.parse(C.values.get('c')), 'freeCpu'), false);
});

test('不同Worker的保护设置不会串用，开关不改变客户端订阅', async () => {
  const [on, off] = await Promise.all(['yes', 'no'].map(freeCpu => worker.fetch(request(), { u: uuid, C: storage({ freeCpu }) }).then(r => r.json())));
  assert.equal(on.freeCpu, 'yes'); assert.equal(off.freeCpu, 'no');
  const config = { ev: 'yes', et: 'yes', ex: 'yes', yx: '104.16.1.1:443', epi: 'yes', epd: 'no', egi: 'no' };
  const subscribe = async freeCpu => (await createSubscriptionEngine({ ...config, freeCpu }, uuid).subscribe(new Request('https://worker.example/sub?target=base64'))).text();
  assert.equal(await subscribe('yes'), await subscribe('no'));
});

test('新内核可操作开关，旧内核禁用并提示更新，页面脚本有效', async () => {
  for (const config of [{ freeCpu: 'yes' }, {}]) {
    const html = await (await createSubscriptionEngine(config, uuid).render(new Request('https://worker.example/' + uuid))).text();
    const input = html.match(/<input[^>]*id="freeCpu"[^>]*>/)[0];
    assert.equal(input.includes('disabled'), !Object.hasOwn(config, 'freeCpu'));
    assert.ok(html.includes('aria-describedby="freeCpuHint"'));
    if (!Object.hasOwn(config, 'freeCpu')) assert.ok(html.includes('当前内核不支持'));
    for (const [, script] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new Function(script);
  }
});
