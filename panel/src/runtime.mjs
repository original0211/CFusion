// Runtime switches shared by the Node host and the Cloudflare entry.
// The global is set by cf-entry before it dynamically imports server.mjs;
// environment variables remain the Node/self-host spelling.
export function outboundMode() {
  return String(globalThis.__CFUSION_OUTBOUND__ || process.env.CFUSION_OUTBOUND || 'node').toLowerCase() === 'fetch' ? 'fetch' : 'node';
}

export function cloudflareRuntime() {
  return globalThis.__CFUSION_RUNTIME__ === 'cloudflare' || outboundMode() === 'fetch';
}

// Cloudflare service binding to the core Worker, injected by cf-entry from
// env.CORE. Global fetch cannot reach a same-account workers.dev Worker
// (Cloudflare returns error 1042), so the panel must talk to its bound core
// through this private channel instead.
export function coreServiceFetcher() {
  const fetcher = globalThis.__CFUSION_CORE_FETCHER__;
  return fetcher && typeof fetcher.fetch === 'function' ? fetcher : null;
}
