#!/usr/bin/env node
// CFusion Cloudflare API deploy script (skeleton, P4).
//
// Safety contract:
// - The API token is read ONLY from env CLOUDFLARE_API_TOKEN. It is never
//   accepted as a CLI argument, never written to a file, and never printed.
// - Default mode is --dry-run: print the API calls that would be made and
//   exit without any network traffic. Real deployment requires --apply.
// - Nothing here touches any existing CFNext/CFnew resources: every name is
//   a cfusion-* name and existing KV namespaces with those titles are only
//   reused, never modified in content.
//
// Usage:
//   CLOUDFLARE_ACCOUNT_ID=<id> node scripts/deploy-cf.mjs            # dry-run
//   CLOUDFLARE_ACCOUNT_ID=<id> CLOUDFLARE_API_TOKEN=<token> \
//     node scripts/deploy-cf.mjs --apply
//
// Optional env: CFUSION_UUID (else one is generated on --apply and printed
// once for the operator to record), CFUSION_CORE_NAME (cfusion-core),
// CFUSION_PANEL_NAME (cfusion-panel), CFUSION_KV_TITLE (cfusion-kv),
// CFUSION_SESSION_KV_TITLE (cfusion-session-kv),
// CFUSION_PANEL_W (panel w binding; defaults to the core workers.dev URL).
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const apply = process.argv.includes('--apply');
const dryRun = !apply || process.argv.includes('--dry-run');
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '<CLOUDFLARE_ACCOUNT_ID>';
const token = process.env.CLOUDFLARE_API_TOKEN || '';
const coreName = process.env.CFUSION_CORE_NAME || 'cfusion-core';
const panelName = process.env.CFUSION_PANEL_NAME || 'cfusion-panel';
const kvTitle = process.env.CFUSION_KV_TITLE || 'cfusion-kv';
const sessionKvTitle = process.env.CFUSION_SESSION_KV_TITLE || 'cfusion-session-kv';
const uuid = process.env.CFUSION_UUID || (apply ? randomUUID() : '<generated-on-apply>');
const api = 'https://api.cloudflare.com/client/v4/accounts/' + accountId;

const steps = [];
function plan(method, url, summary) {
  steps.push({ method, url, summary });
  console.log((dryRun ? '[dry-run] ' : '[apply] ') + method + ' ' + url + (summary ? '  -- ' + summary : ''));
}

async function call(method, url, init = {}) {
  const response = await fetch(url, {
    method,
    ...init,
    headers: { Authorization: 'Bearer ' + token, ...(init.headers || {}) },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(method + ' ' + url + ' failed: HTTP ' + response.status + ' ' + JSON.stringify(payload?.errors || payload).slice(0, 300));
  }
  return payload.result;
}

async function ensureKv(title) {
  const listed = await call('GET', api + '/storage/kv/namespaces?per_page=100');
  const found = (listed || []).find(item => item.title === title);
  if (found) return found.id;
  const created = await call('POST', api + '/storage/kv/namespaces', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  return created.id;
}

async function putWorkerScript(name, metadata, files) {
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  for (const [partName, content, type] of files) form.append(partName, new Blob([content], { type }), partName);
  return call('PUT', api + '/workers/scripts/' + name, { body: form });
}

async function collectPanelFiles() {
  const dist = join(repoRoot, 'panel', 'cloudflare', 'dist');
  const files = [];
  const walk = async (dir, prefix) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(dir, entry.name), prefix + entry.name + '/');
      else if (entry.isFile()) files.push([prefix + entry.name, await readFile(join(dir, entry.name)), 'application/javascript+module']);
    }
  };
  await walk(dist, '');
  return files;
}

console.log('CFusion deploy (' + (dryRun ? 'DRY-RUN, no network calls' : 'APPLY') + ')');
console.log('account: ' + accountId + ', core: ' + coreName + ', panel: ' + panelName + ', uuid: ' + uuid);

plan('GET', api + '/workers/subdomain', 'read account workers.dev subdomain');
plan('GET', api + '/storage/kv/namespaces?per_page=100', 'find KV titled ' + kvTitle + ' / ' + sessionKvTitle);
plan('POST', api + '/storage/kv/namespaces', 'create KV if missing: {"title":"' + kvTitle + '"} (core config, binding c)');
plan('POST', api + '/storage/kv/namespaces', 'create KV if missing: {"title":"' + sessionKvTitle + '"} (panel admin sessions, binding SESSION_KV)');
plan('PUT', api + '/workers/scripts/' + coreName, 'multipart core/_worker.js; metadata {main_module:"_worker.js", compatibility_date:"2026-01-20", bindings:[{kv_namespace c},{plain_text u=' + uuid + '}]}');
plan('POST', api + '/workers/scripts/' + coreName + '/subdomain', '{"enabled":true}');
plan('LOCAL', 'node panel/src/tools/build-cloudflare.mjs', 'assemble panel/cloudflare/dist (embedded assets)');
plan('PUT', api + '/workers/scripts/' + panelName, 'multipart panel dist modules; metadata {main_module:"worker.mjs", compatibility_date:"2026-01-20", compatibility_flags:["nodejs_compat"], bindings:[{kv_namespace SESSION_KV},{plain_text w}]}');
plan('POST', api + '/workers/scripts/' + panelName + '/subdomain', '{"enabled":true}');
plan('GET', 'https://' + coreName + '.<subdomain>.workers.dev/', 'expect body "hello"');
plan('GET', 'https://' + panelName + '.<subdomain>.workers.dev/health', 'expect {"ok":true}');
plan('GET', 'https://' + panelName + '.<subdomain>.workers.dev/' + uuid + '/sub?target=clash', 'expect a Clash subscription');

if (dryRun) {
  console.log('Dry-run complete: ' + steps.length + ' planned calls, nothing was sent.');
  process.exit(0);
}

if (!token || accountId.startsWith('<')) {
  console.error('--apply requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in env.');
  process.exit(2);
}

const subdomain = (await call('GET', api + '/workers/subdomain')).subdomain;
const coreKvId = await ensureKv(kvTitle);
const sessionKvId = await ensureKv(sessionKvTitle);
const coreCode = await readFile(join(repoRoot, 'core', '_worker.js'));
await putWorkerScript(coreName, {
  main_module: '_worker.js',
  compatibility_date: '2026-01-20',
  bindings: [
    { type: 'kv_namespace', name: 'c', namespace_id: coreKvId },
    { type: 'plain_text', name: 'u', text: uuid },
  ],
}, [['_worker.js', coreCode, 'application/javascript+module']]);
await call('POST', api + '/workers/scripts/' + coreName + '/subdomain', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) });

const { execFile } = await import('node:child_process');
await new Promise((resolvePromise, reject) => execFile(process.execPath, [join(repoRoot, 'panel', 'src', 'tools', 'build-cloudflare.mjs')], error => error ? reject(error) : resolvePromise()));
const panelFiles = await collectPanelFiles();
const panelW = process.env.CFUSION_PANEL_W || 'https://' + coreName + '.' + subdomain + '.workers.dev';
await putWorkerScript(panelName, {
  main_module: 'worker.mjs',
  compatibility_date: '2026-01-20',
  compatibility_flags: ['nodejs_compat'],
  bindings: [
    { type: 'kv_namespace', name: 'SESSION_KV', namespace_id: sessionKvId },
    { type: 'plain_text', name: 'w', text: panelW },
  ],
}, panelFiles);
await call('POST', api + '/workers/scripts/' + panelName + '/subdomain', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) });

console.log('Deployed. Core: https://' + coreName + '.' + subdomain + '.workers.dev');
console.log('Panel: https://' + panelName + '.' + subdomain + '.workers.dev/' + uuid);
console.log('Record the UUID now; it is the console/subscription credential.');
