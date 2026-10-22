import assert from 'node:assert/strict';
import test from 'node:test';
import { 边缘过滤家宽节点, 过滤可达家宽节点 } from '../jk-probe.mjs';

const 节点 = (地址, 端口 = 1194) => ({ 国家: 'JP', 地址, 端口, 加密: 'AES-128-CBC', 摘要: 'SHA1' });

test('家宽探测：只保留 opened 成功的节点，拒绝/超时/抛错都剔除', async () => {
  const 列表 = [节点('203.0.113.1'), 节点('203.0.113.2'), 节点('203.0.113.3'), 节点('203.0.113.4')];
  const connect = ({ hostname }) => {
    if (hostname === '203.0.113.1') return { opened: Promise.resolve(), close() {} };
    if (hostname === '203.0.113.2') return { opened: Promise.reject(new Error('refused')), close() {} };
    if (hostname === '203.0.113.3') return { opened: new Promise(() => {}), close() {} };
    throw new Error('boom');
  };
  const 结果 = await 过滤可达家宽节点(列表, { connect, 超时毫秒: 30 });
  assert.deepEqual(结果.map(n => n.地址), ['203.0.113.1']);
});

test('家宽探测：没有 connect 能力时 fail-open 返回原列表', async () => {
  const 列表 = [节点('203.0.113.1'), 节点('203.0.113.2')];
  assert.deepEqual(await 过滤可达家宽节点(列表, {}), 列表);
  assert.deepEqual(await 过滤可达家宽节点(列表, { connect: null }), 列表);
});

test('家宽探测：全部探不通时 fail-open 返回原列表（怀疑探测通道异常）', async () => {
  const 列表 = [节点('203.0.113.1'), 节点('203.0.113.2')];
  const connect = () => ({ opened: Promise.reject(new Error('refused')), close() {} });
  assert.deepEqual(await 过滤可达家宽节点(列表, { connect, 超时毫秒: 20 }), 列表);
});

test('家宽探测：并发不超过上限', async () => {
  const 列表 = Array.from({ length: 12 }, (_, i) => 节点('203.0.113.' + (i + 1)));
  let 在途 = 0, 峰值 = 0;
  const connect = () => {
    在途++; 峰值 = Math.max(峰值, 在途);
    return { opened: new Promise(解 => setTimeout(() => { 在途--; 解(); }, 10)), close() {} };
  };
  const 结果 = await 过滤可达家宽节点(列表, { connect, 超时毫秒: 1000, 并发上限: 3 });
  assert.equal(结果.length, 12);
  assert.ok(峰值 <= 3, '峰值并发 ' + 峰值);
});

test('家宽探测：Node 运行时无 cloudflare:sockets，边缘入口 fail-open', async () => {
  const 列表 = [节点('203.0.113.1')];
  assert.deepEqual(await 边缘过滤家宽节点(列表), 列表);
});
