// CFusion P3-4 单测：fail-closed 复查中修复的两处。
// 注意：本文件「不得」设置 CFNEW_ALLOW_PRIVATE——公网校验被关掉时这些断言无意义。
// （node --test 每文件独立进程，与其它文件的 env 设置互不影响。）
import assert from 'node:assert/strict';
import test from 'node:test';

const { fetchPublicText } = await import('../preferred.mjs');
const { buildCandidatePool } = await import('../optimizer.mjs');

test('fetchPublicText 拒绝非公网目标（SSRF 防护）', async () => {
  await assert.rejects(fetchPublicText('http://127.0.0.1:3100/list'), /公网/);
  await assert.rejects(fetchPublicText('http://[::1]/list'), /公网/);
  await assert.rejects(fetchPublicText('http://169.254.169.254/latest/meta-data'), /公网/);
  await assert.rejects(fetchPublicText('http://localhost:3100/list'), /公网/);
  await assert.rejects(fetchPublicText('file:///etc/passwd'), /HTTP/);
});

test('optimizer 默认拉取同样受防护：内网 sourceURL 被拒并记录错误（fail-open 到 CIDR 兜底）', async () => {
  const { candidates, stats } = await buildCandidatePool(
    { source: 'custom', sourceURL: 'http://127.0.0.1:3100/list', count: 5 },
    { noCache: true, rng: () => 0.42 }
  );
  assert.notEqual(stats.customErr, '', '内网源应报错而非被拉取');
  assert.ok(candidates.length > 0, '应 fail-open 到兜底采样');
  assert.ok(candidates.every(item => item.ip !== '127.0.0.1'), '池中不得出现内网地址');
});
