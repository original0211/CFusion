// CFusion P1 优选引擎单测：fixture 全部本地构造，fetch 全部为假实现，禁止打真实外网。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCloudflareIp, parseEntryList, parseCandidateText, filterEntries,
  buildCandidatePool, resolveOptimizerYx, formatEntry, OPTIMIZER_SOURCES
} from '../optimizer.mjs';

// 假 wetest_v4 页面：混排结构化条目、裸 IP、HTML 噪声；含 CF/非 CF、v4/v6、重复项与带 ISP/地区备注的条目。
// 结构化条目以纯文本行给出（与 Kt/ot 对列表型内容的解析口径一致；HTML 标签内的条目原版同样提取不到备注），
// 另附一行 HTML 噪声验证裸 IP 补漏。
const WETEST_PAGE = [
  '104.16.10.1:443#HK 移动',
  '104.17.20.2#JP 电信',
  '172.67.30.3:8443#US 联通',
  '8.8.8.8:443#US 移动',
  '2606:4700::1111#SG 移动',
  '104.16.10.1:443#HK 移动',
  '<p>裸地址 104.18.40.4 与 2001:4860::8888 也在文本里</p>'
].join('\n');

function fakeFetch(routes) {
  return async url => {
    const key = Object.keys(routes).find(k => String(url).includes(k));
    if (!key) return { ok: false, status: 404, text: async () => '' };
    const value = routes[key];
    if (value instanceof Error) throw value;
    return { ok: true, status: 200, text: async () => value };
  };
}

test('isCloudflareIp 按 CFNext 地址段判定', () => {
  assert.equal(isCloudflareIp('104.16.0.1'), true);
  assert.equal(isCloudflareIp('172.64.5.5'), true);
  assert.equal(isCloudflareIp('8.8.8.8'), false);
  assert.equal(isCloudflareIp('2606:4700::1'), true);
  assert.equal(isCloudflareIp('2001:4860::8888'), false);
  assert.equal(isCloudflareIp('example.com'), false);
});

test('parseCandidateText：结构化解析 + 裸 IP 补漏 + 去重', () => {
  const entries = parseCandidateText(WETEST_PAGE);
  const byIp = new Map(entries.map(e => [e.ip, e]));
  assert.equal(byIp.get('104.16.10.1').name, 'HK 移动');
  assert.equal(byIp.get('104.16.10.1').port, 443);
  assert.equal(byIp.get('172.67.30.3').port, 8443);
  assert.equal(byIp.get('2606:4700::1111').name, 'SG 移动');
  assert.ok(byIp.has('104.18.40.4'), '裸 IPv4 应被补漏提取');
  assert.equal(entries.filter(e => e.ip === '104.16.10.1').length, 1, '重复条目只保留一条');
});

test('filterEntries：isp / region / ipType 筛选与放宽级联', () => {
  const entries = parseCandidateText(WETEST_PAGE);
  const mobile = filterEntries(entries, { isp: ['移动'] });
  assert.deepEqual(mobile.map(e => e.ip).sort(), ['104.16.10.1', '2606:4700::1111', '8.8.8.8']);
  const jp = filterEntries(entries, { region: 'JP' });
  assert.deepEqual(jp.map(e => e.ip), ['104.17.20.2']);
  const v6only = filterEntries(entries, { ipType: ['IPv6'] });
  assert.ok(v6only.length >= 1 && v6only.every(e => e.ip.includes(':')));
  // 地区无命中时逐级放宽，不返回空（ge 的 fail-open 级联）
  const relaxed = filterEntries(entries, { region: 'DE' });
  assert.ok(relaxed.length > 0);
});

test('buildCandidatePool：预设模式只收 CF 段地址，stats 记录预设条数', async () => {
  const pool = await buildCandidatePool(
    { source: 'wetest_v4', port: 443, count: 2, useCidr: false },
    { fetchImpl: fakeFetch({ 'wetest.vip': WETEST_PAGE }), noCache: true }
  );
  assert.ok(pool.stats.preset >= 5);
  assert.ok(pool.candidates.every(e => isCloudflareIp(e.ip)), '预设模式非 CF 地址（8.8.8.8 / 2001:4860::8888）应被滤掉');
  assert.ok(!pool.candidates.some(e => e.ip === '8.8.8.8'));
});

test('buildCandidatePool：custom 源接受非 CF 地址；拉取失败不抛错', async () => {
  const custom = await buildCandidatePool(
    { sourceURL: 'https://lists.example/ips.txt', port: 443, count: 1, useCidr: false },
    { fetchImpl: fakeFetch({ 'lists.example': '8.8.8.8:443#US 移动\n' }), noCache: true }
  );
  assert.ok(custom.candidates.some(e => e.ip === '8.8.8.8'));
  const failed = await buildCandidatePool(
    { source: 'wetest_v4', port: 443, count: 3, useCidr: true },
    { fetchImpl: async () => { throw new Error('network down'); }, noCache: true, rng: (() => { let seed = 42; return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648; })() }
  );
  assert.equal(failed.stats.presetErr, '超时/网络错误');
  assert.equal(failed.candidates.length, 3, 'CIDR 补量应补足目标数');
  assert.ok(failed.candidates.every(e => isCloudflareIp(e.ip)));
});

test('resolveOptimizerYx：未开启返回 null；customPref 只用手填并按上限截断', async () => {
  assert.equal(await resolveOptimizerYx({ optimizerAuto: 'no', yx: '104.16.1.1:443#A' }), null);
  const text = await resolveOptimizerYx({
    optimizerAuto: 'yes', optimizerCustomPref: 'yes', optimizerLimit: '2',
    yx: '104.16.1.1:443#HK 移动\n104.17.2.2:443#JP 电信\n2606:4700::5:443#SG 联通'
  });
  const lines = text.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^104\.16\.1\.1:443#HK 移动$/);
});

test('resolveOptimizerYx：自动池输出格式与引擎优选条目一致（IPv6 加方括号）', async () => {
  const text = await resolveOptimizerYx(
    { optimizerAuto: 'yes', optimizerSource: 'wetest_v4', optimizerCount: '2', optimizerUseCidr: 'no', optimizerLimit: '300' },
    { fetchImpl: fakeFetch({ 'wetest.vip': WETEST_PAGE }), noCache: true }
  );
  assert.ok(text);
  for (const line of text.split('\n')) assert.match(line, /^(\[[0-9a-f:]+\]|[\w.-]+):\d+(#.*)?$/i);
  assert.ok(text.split('\n').some(l => l.startsWith('[2606:4700::1111]:443')), 'IPv6 条目应带方括号与端口');
});

test('resolveOptimizerYx：全源失败时 fail-open 回退手填列表', async () => {
  const text = await resolveOptimizerYx(
    { optimizerAuto: 'yes', optimizerSource: 'wetest_v4', optimizerUseCidr: 'no', yx: '104.16.9.9:443#手填节点' },
    { fetchImpl: async () => { throw new Error('down'); }, noCache: true, resetPoolCache: true }
  );
  assert.equal(text, '104.16.9.9:443#手填节点');
});

test('formatEntry 与源注册表完整性', () => {
  assert.equal(formatEntry({ ip: '2606:4700::1', port: 443, name: 'SG' }), '[2606:4700::1]:443#SG');
  assert.equal(formatEntry({ ip: '104.16.1.1', port: 8443, name: '' }), '104.16.1.1:8443');
  assert.equal(OPTIMIZER_SOURCES.wetest_v4.url, 'https://www.wetest.vip/page/cloudflare/address_v4.html');
  assert.equal(OPTIMIZER_SOURCES.wetest_v6.url, 'https://www.wetest.vip/page/cloudflare/address_v6.html');
  assert.equal(OPTIMIZER_SOURCES.hostmonit.url, 'https://stock.hostmonit.com/CloudFlareYes');
});

test('parseEntryList 与引擎手填口径一致：逗号/换行切分、默认名留空', () => {
  const entries = parseEntryList('104.16.1.1:443#甲, 104.17.2.2#乙\n[2606:4700::9]:8443#丙');
  assert.equal(entries.length, 3);
  assert.equal(entries[2].port, 8443);
});
