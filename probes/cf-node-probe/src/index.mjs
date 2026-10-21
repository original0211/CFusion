// CFusion P4 Probe A: check the Node APIs used by the panel under workerd
// with nodejs_compat enabled. Every check is isolated so one failure does
// not hide the remaining results.
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import { lookup as lookupPromise } from 'node:dns/promises';
import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';
import rulesGz from '../../../panel/src/singbox-rules.json.gz';

function check(name, fn, summarize = value => value) {
  try {
    return { name, ok: true, result: summarize(fn()) };
  } catch (error) {
    return { name, ok: false, error: String(error && error.message || error), errorName: error && error.name };
  }
}

async function checkAsync(name, fn, summarize = value => value) {
  try {
    return { name, ok: true, result: summarize(await fn()) };
  } catch (error) {
    return { name, ok: false, error: String(error && error.message || error), errorName: error && error.name };
  }
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/') return new Response('not found', { status: 404 });
    const checks = [];
    checks.push(check('node:crypto createHash(md5)', () => createHash('md5').update('cfusion').digest('hex'), value => ({ digest: value, expected: '76b37a4d2c4e7bfe2e9a6e9e8e801a95', match: value === '76b37a4d2c4e7bfe2e9a6e9e8e801a95' })));
    checks.push(check('node:crypto createHash(sha256)', () => createHash('sha256').update('cfusion').digest('hex'), value => ({ digestPrefix: value.slice(0, 16), length: value.length })));
    checks.push(check('node:zlib gunzipSync(panel singbox-rules.json.gz)', () => {
      const bytes = rulesGz instanceof ArrayBuffer ? new Uint8Array(rulesGz) : rulesGz;
      const parsed = JSON.parse(gunzipSync(Buffer.from(bytes)).toString('utf8'));
      return { compressedBytes: bytes.byteLength, ruleSets: Object.keys(parsed.rules || {}).length, revision: parsed.revision || null };
    }));
    checks.push(check('node:buffer Buffer', () => ({ fromString: Buffer.from('cfusion').toString('base64'), byteLength: Buffer.byteLength('配置'), isBuffer: Buffer.isBuffer(Buffer.alloc(1)) })));
    checks.push(check('node:process env', () => ({ probeValue: process.env.CFUSION_PROBE_VALUE || null, bindingValue: env.CFUSION_PROBE_VALUE || null, platform: process.platform || null, version: process.version || null, argvType: typeof process.argv })));
    checks.push(check('node:http import surface', () => ({ request: typeof http.request, createServer: typeof http.createServer, get: typeof http.get })));
    checks.push(check('node:https import surface', () => ({ request: typeof https.request, get: typeof https.get })));
    checks.push(await checkAsync('node:http createServer listen attempt', async () => {
      const server = http.createServer((req, res) => res.end('ok'));
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const address = server.address();
      await new Promise(resolve => server.close(resolve));
      return { listened: true, address };
    }));
    checks.push(check('node:dns import surface', () => ({ lookup: typeof dns.lookup, promisesLookup: typeof dns.promises?.lookup, lookupPromiseImport: typeof lookupPromise })));
    checks.push(await checkAsync('node:dns/promises lookup(localhost)', async () => {
      const rows = await lookupPromise('localhost', { all: true });
      return rows.map(row => ({ address: row.address, family: row.family }));
    }));
    checks.push(check('node:net isIP', () => ({ ipv4: isIP('104.16.1.1'), ipv6: isIP('2606:4700::1111'), invalid: isIP('example.com') })));
    checks.push(check('node:perf_hooks performance.now', () => ({ type: typeof performance.now, sampleType: typeof performance.now() })));
    return Response.json({ probe: 'cfusion-p4-a', checks }, { headers: { 'Cache-Control': 'no-store' } });
  },
};
