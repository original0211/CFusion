import assert from 'node:assert/strict';
import test from 'node:test';
import { createSubscriptionEngine } from '../engine.mjs';

const uuid = '351c9981-04b6-4103-aa4b-864aa9c91469';

function 节点配置64(地址, 端口) {
  const 文本 = [
    'client', 'dev tun', 'proto tcp',
    'remote ' + 地址 + ' ' + 端口,
    'cipher AES-128-CBC', 'auth SHA1',
    '<ca>', '-----BEGIN CERTIFICATE-----', 'CA', '-----END CERTIFICATE-----', '</ca>',
    '<cert>', '-----BEGIN CERTIFICATE-----', 'CERT', '-----END CERTIFICATE-----', '</cert>',
    '<key>', '-----BEGIN PRIVATE KEY-----', 'KEY', '-----END PRIVATE KEY-----', '</key>',
    '',
  ].join('\n');
  return Buffer.from(文本, 'utf8').toString('base64');
}

function 清单行(主机名, 地址, 国家, 端口) {
  const 字段 = [主机名, 地址, '100', '10', '5000000', 国家, 国家, '1', '100', '1', '1000', '2w', 'op', '', 节点配置64(地址, 端口)];
  return 字段.join(',');
}

function 清单(行列表) {
  return ['*vpn_servers', '#HostName,IP,Score,Ping,Speed,CountryLong,CountryShort,NumVpnSessions,Uptime,TotalUsers,TotalTraffic,LogType,Operator,Message,OpenVPN_ConfigData_Base64', ...行列表, '*'].join('\n');
}

const 默认清单 = 清单([
  清单行('vpn-default-1', '203.0.113.10', 'JP', 1194),
  清单行('vpn-default-2', '203.0.113.11', 'KR', 1194),
]);
const 自定义清单 = 清单([
  清单行('vpn-custom-dup', '203.0.113.10', 'JP', 1194), // 与默认源同地址同端口，应去重
  清单行('vpn-custom-1', '198.51.100.20', 'US', 1195),
]);

test('jkSource：自定义源与默认源合并去重，家宽订阅包含两边节点', async () => {
  const 原fetch = globalThis.fetch;
  const 请求过的网址 = [];
  globalThis.fetch = async 网址 => {
    请求过的网址.push(String(网址));
    if (String(网址).includes('example.com')) return new Response(自定义清单, { status: 200 });
    return new Response(默认清单, { status: 200 });
  };
  try {
    const engine = createSubscriptionEngine(
      { yx: '104.16.1.1:443#测试', epi: 'yes', epd: 'no', egi: 'no', ena: 'no', ev: 'yes', jk: 'yes', jkSource: 'https://example.com/list.txt' },
      uuid,
    );
    const response = await engine.subscribe(new Request('https://worker.example/sub?target=vg'));
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(请求过的网址.some(u => u.includes('vpngate.net')), '应拉默认源');
    assert.ok(请求过的网址.some(u => u.includes('example.com')), '应拉自定义源');
    assert.ok(body.includes('203.0.113.10'), '默认源节点在');
    assert.ok(body.includes('203.0.113.11'), '默认源第二个节点在');
    assert.ok(body.includes('198.51.100.20'), '自定义源节点在');
    const 家宽节点数 = (body.match(/type: openvpn/g) || []).length;
    assert.equal(家宽节点数, 3, '合并去重后应为 3 个家宽节点，实际 ' + 家宽节点数);
  } finally {
    globalThis.fetch = 原fetch;
  }
});

test('jkSource：未设置时只用默认源，行为与原来一致', async () => {
  const 原fetch = globalThis.fetch;
  const 请求过的网址 = [];
  globalThis.fetch = async 网址 => {
    请求过的网址.push(String(网址));
    return new Response(默认清单, { status: 200 });
  };
  try {
    const engine = createSubscriptionEngine(
      { yx: '104.16.1.1:443#测试', epi: 'yes', epd: 'no', egi: 'no', ena: 'no', ev: 'yes', jk: 'yes' },
      uuid,
    );
    const response = await engine.subscribe(new Request('https://worker.example/sub?target=vg'));
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(请求过的网址.every(u => u.includes('vpngate.net')), '只应拉默认源');
    assert.equal((body.match(/type: openvpn/g) || []).length, 2);
  } finally {
    globalThis.fetch = 原fetch;
  }
});
