// Runtime switches shared by the Node host and the Cloudflare entry.
// The global is set by cf-entry before it dynamically imports server.mjs;
// environment variables remain the Node/self-host spelling.
export function outboundMode() {
  return String(globalThis.__CFUSION_OUTBOUND__ || process.env.CFUSION_OUTBOUND || 'node').toLowerCase() === 'fetch' ? 'fetch' : 'node';
}

export function cloudflareRuntime() {
  return globalThis.__CFUSION_RUNTIME__ === 'cloudflare' || outboundMode() === 'fetch';
}
