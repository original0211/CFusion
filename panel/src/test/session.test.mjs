// CFusion P3-1 单测：面板管理会话。
// 未设置 PANEL_ADMIN_PASSWORD 时行为与上游一致；设置后写路径必须登录，读与订阅不受影响。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

process.env.CFNEW_ALLOW_PRIVATE = 'yes';
process.env.PANEL_ADMIN_PASSWORD = 'test-admin-password-123';
const { handlePanel } = await import('../server.mjs');
const { createSessionStore, createLoginThrottle, checkAdminPassword, adminEnabled, sessionCookieHeader, parseCookieHeader, ADMIN_COOKIE } = await import('../session.mjs');
const UUID = '351c9981-04b6-4103-aa4b-864aa9c91469';
const coreSource = await readFile(process.env.CFNEW_TEST_CORE || new URL('./core-fixture.mjs', import.meta.url), 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(coreSource.replace(/import\s*\{\s*connect as ([^}]+)\}\s*from\s*['"]cloudflare:sockets['"];/, (_, name) => 'const ' + name.trim() + ' = () => { throw new Error("隔离测试不建立代理连接"); };')).toString('base64'))).default;

test('session store：签发/校验/过期/注销', () => {
  let now = 1000000;
  const store = createSessionStore({ ttlMs: 1000, now: () => now, random: size => Buffer.alloc(size, 7) });
  const token = store.issue();
  assert.equal(typeof token, 'string');
  assert.ok(token.length >= 32);
  assert.equal(store.verify(token), true);
  assert.equal(store.verify('not-a-token'), false);
  assert.equal(store.verify(''), false);
  now += 1001;
  assert.equal(store.verify(token), false, '过期后应失效');
  const token2 = store.issue();
  store.revoke(token2);
  assert.equal(store.verify(token2), false, '注销后应失效');
});

test('口令校验：常量时间比较与 env 语义', () => {
  const env = { PANEL_ADMIN_PASSWORD: 's3cret-long' };
  assert.equal(adminEnabled(env), true);
  assert.equal(adminEnabled({}), false);
  assert.equal(checkAdminPassword('s3cret-long', env), true);
  assert.equal(checkAdminPassword('wrong', env), false);
  assert.equal(checkAdminPassword('s3cret-long', {}), false, '未设口令时校验恒为 false（门禁由 adminEnabled 放行）');
});

test('cookie 序列化：HttpOnly + SameSite，解析可往返', () => {
  const header = sessionCookieHeader('tok123', { ttlMs: 3600000 });
  assert.ok(header.startsWith(ADMIN_COOKIE + '=tok123'));
  assert.ok(header.includes('HttpOnly'));
  assert.ok(header.includes('SameSite=Lax'));
  assert.ok(header.includes('Path=/'));
  assert.equal(parseCookieHeader('a=1; ' + ADMIN_COOKIE + '=tok123; b=2')[ADMIN_COOKIE], 'tok123');
});

test('登录节流：连续失败锁定、成功清零', () => {
  let now = 0;
  const throttle = createLoginThrottle({ maxFailures: 3, lockMs: 60000, now: () => now });
  throttle.fail(); throttle.fail();
  assert.equal(throttle.locked(), false);
  throttle.fail();
  assert.equal(throttle.locked(), true);
  now += 60001;
  assert.equal(throttle.locked(), false);
  throttle.fail(); throttle.succeed(); throttle.fail(); throttle.fail();
  assert.equal(throttle.locked(), false, '成功应清零失败计数');
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

test('设口令后：无会话写被拒 401，读与订阅正常', async () => fixture(async ({ api, host, request }) => {
  const write = await request(api + '/api/config', { method: 'POST', body: JSON.stringify({ yx: '104.16.9.9:443#改' }) });
  assert.equal(write.status, 401);
  assert.equal((await write.json()).success, false);
  const config = await (await request(api + '/api/config')).json();
  assert.equal(config.yx, '104.16.1.1:443#节点', '被拒的写不应改变配置');
  const sub = await request('/sub?' + new URLSearchParams({ host, uuid: UUID, target: 'base64' }));
  assert.equal(sub.status, 200, '订阅生成不受管理会话影响');
  const status = await (await request('/api/admin/status')).json();
  assert.deepEqual(status, { adminRequired: true, loggedIn: false });
}));

test('登录流：错口令 401、对口令发 cookie、带 cookie 可写、注销后失效', async () => fixture(async ({ api, request }) => {
  const bad = await request('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong-password' }) });
  assert.equal(bad.status, 401);
  const good = await request('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-admin-password-123' }) });
  assert.equal(good.status, 200);
  const setCookie = good.headers.get('set-cookie') || '';
  assert.ok(setCookie.includes('HttpOnly') && setCookie.includes('SameSite=Lax'), 'cookie 应带 HttpOnly 与 SameSite');
  const cookie = setCookie.split(';')[0];
  const write = await request(api + '/api/config', { method: 'POST', headers: { cookie }, body: JSON.stringify({ yx: '104.16.8.8:443#登录后改' }) });
  assert.equal(write.status, 200);
  assert.equal((await write.json()).success, true);
  const status = await (await request('/api/admin/status', { headers: { cookie } })).json();
  assert.equal(status.loggedIn, true);
  const out = await request('/api/admin/logout', { method: 'POST', headers: { cookie } });
  assert.equal(out.status, 200);
  const writeAfter = await request(api + '/api/config', { method: 'POST', headers: { cookie }, body: JSON.stringify({ yx: '104.16.7.7:443#注销后改' }) });
  assert.equal(writeAfter.status, 401, '注销后原 token 应失效');
}));

test('未设口令时写路径放行（向后兼容，须在登录流之后运行）', async () => fixture(async ({ api, request }) => {
  delete process.env.PANEL_ADMIN_PASSWORD;
  try {
    const status = await (await request('/api/admin/status')).json();
    assert.deepEqual(status, { adminRequired: false, loggedIn: false });
    const write = await request(api + '/api/config', { method: 'POST', body: JSON.stringify({ yx: '104.16.6.6:443#无口令改' }) });
    assert.equal(write.status, 200);
    assert.equal((await write.json()).success, true);
  } finally {
    process.env.PANEL_ADMIN_PASSWORD = 'test-admin-password-123';
  }
}));
