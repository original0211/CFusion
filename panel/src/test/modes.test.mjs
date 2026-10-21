// CFusion P2 单测：WARP / MASQUE 订阅模式（面板侧节点生成器）。
// 全部使用本地 fixture 配置与凭据，禁止打真实外网；凭据为构造的假值。
// 语义对照 CFNext：_wgNodes 构建、_wEp 解析、_wgLines 分享行、Ee/Le 渲染。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubscriptionEngine } from '../engine.mjs';
import {
  parseModeEndpoint, parseModeCred, buildModeNodes, normalizeSubMode,
  wireguardShareLine, modeShareLines, mergeModeSubscription,
  mergeClashYaml, mergeSingboxJson, mergeLinkSubscription, reservedBytes
} from '../modes.mjs';

const CID = Buffer.from([1, 2, 3]).toString('base64'); // 'AQID'
const WARP_CONF = JSON.stringify({
  k: 'cHJpdmtleWZha2UxMjM0NTY3ODkwYWJjZGVmZ2hpamtsbW5vcA==',
  p: 'cGVlcnB1YmtleWZha2UxMjM0NTY3ODkwYWJjZGVmZ2hpamtsbW5vcA==',
  a4: '172.16.0.2', a6: '2606:4700:110:8a36:df92:102a:9603:3a1f', pt: 2408, cid: CID
});
const MASQUE_CONF = JSON.stringify({
  mk: 1,
  k: 'c2VjMWZha2UxMjM0NTY3ODkwYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=',
  p: 'cGVlcnB1YmtleWZha2VtYXNxdWUxMjM0NTY3ODkwYWJjZGVmZ2hpamtsbW5vcA==',
  a4: '172.16.0.2', a6: '2606:4700:110:8a36:df92:102a:9603:3a1f', pt: 443, cid: ''
});
const ENGINE_CONFIG = { epd: 'no', epi: 'yes', egi: 'no', ena: 'no', ev: 'yes', et: 'yes', ex: 'yes', yx: '104.16.1.1:443#验证节点' };
const UUID = '351c9981-04b6-4103-aa4b-864aa9c91469';
async function engineSubscription(target, overrides = {}) {
  const response = await createSubscriptionEngine({ ...ENGINE_CONFIG, ...overrides }, UUID)
    .subscribe(new Request('https://worker.example/' + UUID + '/sub?target=' + target));
  assert.equal(response.status, 200);
  return response.text();
}

test('parseModeEndpoint 与 CFNext _wEp 同语义', () => {
  assert.deepEqual(parseModeEndpoint('162.159.192.1:2408'), { h: '162.159.192.1', p: 2408 });
  assert.deepEqual(parseModeEndpoint('[2606:4700:103::2]:443'), { h: '2606:4700:103::2', p: 443 });
  assert.deepEqual(parseModeEndpoint('example.com'), { h: 'example.com', p: 0 });
});

test('reservedBytes 只接受恰好 3 字节的 base64', () => {
  assert.deepEqual(reservedBytes(CID), [1, 2, 3]);
  assert.equal(reservedBytes('AAAAAA=='), null);
  assert.equal(reservedBytes(''), null);
});

test('warp 节点：默认内置端点 50 个、命名 WARP·N、凭据字段透传', () => {
  const nodes = buildModeNodes({ subMode: 'warp', warpConf: WARP_CONF });
  assert.equal(nodes.length, 50);
  assert.equal(nodes[0].name, 'WARP·1');
  assert.equal(nodes[49].name, 'WARP·50');
  assert.equal(nodes[0].host, '162.159.192.1');
  assert.equal(nodes[0].port, 2408);
  assert.deepEqual(nodes[0].local, ['172.16.0.2', '2606:4700:110:8a36:df92:102a:9603:3a1f']);
  assert.equal(nodes[0].cid, CID);
  assert.equal(nodes[0].mg, undefined);
});

test('warp 节点：自定义端点与名称、端口回退凭据 pt', () => {
  const nodes = buildModeNodes({
    subMode: 'warp', warpConf: WARP_CONF, warpName: '我的WARP',
    warpEps: '203.0.113.9:2443\nexample.com'
  });
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].name, '我的WARP·1');
  assert.equal(nodes[0].port, 2443);
  assert.equal(nodes[1].host, 'example.com');
  assert.equal(nodes[1].port, 2408, '端点无端口时用凭据 pt');
  const single = buildModeNodes({ subMode: 'warp', warpConf: WARP_CONF, warpEps: '203.0.113.9:2443' });
  assert.equal(single[0].name, 'WARP', '只有一个端点时不带序号后缀（CFNext 同语义）');
});

test('凭据缺失/不完整一律 fail-closed 不输出', () => {
  assert.deepEqual(buildModeNodes({ subMode: 'warp' }), []);
  assert.deepEqual(buildModeNodes({ subMode: 'warp', warpConf: '{"k":"x"}' }), [], '缺 p/a4');
  assert.deepEqual(buildModeNodes({ subMode: 'warp', warpConf: 'not-json' }), []);
  assert.deepEqual(buildModeNodes({ subMode: 'masque', masqueConf: '{"k":"x","p":"y"}' }), [], 'masque 缺 mk');
  assert.equal(parseModeCred({ warpConf: WARP_CONF }, 'warp').a4, '172.16.0.2');
});

test('masque 节点：mg 标记、默认 SNI、内置端点与名称', () => {
  const nodes = buildModeNodes({ subMode: 'masque', masqueConf: MASQUE_CONF, masqueName: 'MQ' });
  assert.equal(nodes.length, 28);
  assert.equal(nodes[0].mg, 1);
  assert.equal(nodes[0].name, 'MQ·1');
  assert.equal(nodes[0].host, '162.159.198.2');
  assert.equal(nodes[0].port, 443);
  assert.equal(nodes[0].sni, 'www.microsoft.com');
  const custom = buildModeNodes({ subMode: 'masque', masqueConf: MASQUE_CONF, masqueSni: 'sni.example.com', masqueNet: 'h2', masqueEps: '[2606:4700:103::2]:8443' });
  assert.equal(custom[0].sni, 'sni.example.com');
  assert.equal(custom[0].msnet, 'h2');
  assert.equal(custom[0].host, '2606:4700:103::2');
  assert.equal(custom[0].port, 8443);
});

test('worker 模式恒无模式节点（零影响前提）', () => {
  assert.equal(normalizeSubMode({}), 'worker');
  assert.equal(normalizeSubMode({ subMode: 'WARP' }), 'warp');
  assert.deepEqual(buildModeNodes({ subMode: 'worker', warpConf: WARP_CONF, masqueConf: MASQUE_CONF }), []);
  assert.equal(mergeModeSubscription('anything', 'clash', []), null);
});

test('wireguard 分享行与 CFNext _wgLines 同格式；masque 无分享行', () => {
  const [node] = buildModeNodes({ subMode: 'warp', warpConf: WARP_CONF, warpEps: '162.159.192.1:2408' });
  const line = wireguardShareLine(node);
  assert.ok(line.startsWith('wireguard://'));
  assert.ok(line.includes('@162.159.192.1:2408/?publickey='));
  assert.ok(line.includes('&address=' + encodeURIComponent('172.16.0.2/32,2606:4700:110:8a36:df92:102a:9603:3a1f/128')));
  assert.ok(line.includes('&reserved=1,2,3'));
  assert.ok(line.includes('&mtu=1280#' + encodeURIComponent('WARP')));
  const masque = buildModeNodes({ subMode: 'masque', masqueConf: MASQUE_CONF });
  assert.deepEqual(modeShareLines(masque), [], 'masque 节点不生成 wireguard 分享行（CFNext 同语义）');
});

test('链接类订阅并入：base64 正文追加分享行且可往返解码', async () => {
  const body = await engineSubscription('base64');
  const nodes = buildModeNodes({ subMode: 'warp', warpConf: WARP_CONF, warpEps: '162.159.192.1:2408' });
  const merged = mergeModeSubscription(body, 'base64', nodes);
  const decoded = Buffer.from(merged, 'base64').toString('utf8');
  assert.ok(decoded.includes('wireguard://'));
  assert.ok(decoded.split('\n').length > Buffer.from(body, 'base64').toString('utf8').split('\n').length);
  assert.equal(mergeLinkSubscription(body, []), body, '无节点原样');
  assert.equal(mergeLinkSubscription('!!!not-base64-links!!!', nodes), '!!!not-base64-links!!!', '非链接正文不改动');
});

test('clash 并入：wireguard 条目进 proxies 且进主分组，重复并入不叠加', async () => {
  const yaml = await engineSubscription('clash');
  const nodes = buildModeNodes({ subMode: 'warp', warpConf: WARP_CONF, warpEps: '162.159.192.1:2408\n162.159.192.2:2408' });
  const merged = mergeClashYaml(yaml, nodes);
  const proxiesSection = merged.slice(0, merged.indexOf('\nproxy-groups:'));
  assert.match(proxiesSection, /- name: "WARP·1"\n {4}type: wireguard/);
  assert.match(proxiesSection, /private-key: /);
  assert.match(proxiesSection, /cid: "AQID"/);
  const mainGroup = merged.match(/- name: "🚀 节点选择"([\s\S]*?)(?=\n  - name:)/)?.[1] || '';
  assert.ok(mainGroup.includes('"WARP·1"') && mainGroup.includes('"WARP·2"'), '主分组包含模式节点');
  const autoGroup = merged.match(/- name: "♻️ 自动选择"([\s\S]*?)(?=\n  - name:)/)?.[1] || '';
  assert.ok(autoGroup.includes('"WARP·1"'), '自动选择分组包含模式节点');
  assert.equal(mergeClashYaml(merged, nodes), merged, '幂等：再次并入不产生重复条目');
});

test('clash 并入 masque：type masque + sni/uri/congestion-controller 字段', () => {
  const nodes = buildModeNodes({ subMode: 'masque', masqueConf: MASQUE_CONF, masqueEps: '162.159.198.2:443' });
  const yaml = 'proxies:\n  - name: "X"\n    type: vless\n\nproxy-groups:\n  - name: "🚀 节点选择"\n    type: select\n    proxies:\n      - "X"\n';
  const merged = mergeClashYaml(yaml, nodes);
  assert.match(merged, /type: masque/);
  assert.match(merged, /sni: "www\.microsoft\.com"/);
  assert.match(merged, /uri: "https:\/\/cloudflareaccess\.com"/);
  assert.match(merged, /congestion-controller: "bbr"/);
  assert.match(merged, /ip: "172\.16\.0\.2\/32"/, 'masque 的 ip 带 /32（CFNext Ee 同语义）');
});

test('sing-box 并入：wireguard 进 endpoints 并挂入 urltest/selector；masque 不并入', async () => {
  const text = await engineSubscription('singbox');
  const nodes = buildModeNodes({ subMode: 'warp', warpConf: WARP_CONF, warpEps: '162.159.192.1:2408\n162.159.192.2:2408' });
  const merged = mergeSingboxJson(text, nodes);
  const data = JSON.parse(merged);
  assert.equal(data.endpoints.length, 2);
  assert.equal(data.endpoints[0].type, 'wireguard');
  assert.deepEqual(data.endpoints[0].address, ['172.16.0.2/32', '2606:4700:110:8a36:df92:102a:9603:3a1f/128']);
  assert.equal(data.endpoints[0].peers[0].public_key, JSON.parse(WARP_CONF).p);
  const urltest = data.outbounds.find(o => o.type === 'urltest');
  assert.ok(urltest.outbounds.includes('WARP·1'));
  const select = data.outbounds.find(o => o.type === 'selector');
  assert.ok(select.outbounds.includes('WARP·2'));
  const masque = buildModeNodes({ subMode: 'masque', masqueConf: MASQUE_CONF });
  assert.equal(mergeSingboxJson(text, masque), text, 'masque 不进 sing-box（CFNext Le 同语义）');
});

test('surge/loon/quanx 家族不并入（CFNext 同样不向这些格式注入 WG 节点）', async () => {
  const nodes = buildModeNodes({ subMode: 'warp', warpConf: WARP_CONF });
  for (const target of ['surge', 'loon', 'quanx']) {
    const body = await engineSubscription(target);
    assert.equal(mergeModeSubscription(body, target, nodes), null, target);
  }
});
