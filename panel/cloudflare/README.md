# CFusion panel on Cloudflare Workers

Route ② from the P1/P4 evaluation: the whole panel runs as one Worker with
`nodejs_compat`; the proxy data plane stays in the separate core Worker.

## Build

```sh
cd panel
node src/tools/build-cloudflare.mjs
```

This assembles `cloudflare/dist/` (runtime modules + embedded text assets +
the sing-box rules gzip as base64). The directory must be empty beforehand.

## Local smoke

```sh
cd panel/cloudflare
npx wrangler dev --local --port 8797
curl -s http://127.0.0.1:8797/health
```

## Runtime notes

- Environment arrives as Worker bindings. String bindings are copied into
  `process.env` by the entry before `server.mjs` loads, so `w`,
  `PANEL_ADMIN_PASSWORD`, `PANEL_ADMIN_SESSION_TTL_HOURS` and
  `CFUSION_OUTBOUND` behave as on Node. `CFUSION_OUTBOUND` is forced to
  `fetch` by this entry.
- Admin sessions use the `SESSION_KV` KV binding when present (see
  `wrangler.toml`); otherwise they fall back to per-isolate memory.
- The subscription cache stays in memory; its 60 s TTL bounds staleness
  across isolates.
- Preferred probing is degraded under fetch: the runtime cannot dial a
  selected IP, so `/api/preferred/probe` returns an explicit unavailable
  result instead of a fabricated latency.
