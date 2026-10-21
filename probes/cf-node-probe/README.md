# P4 Probe A

Temporary-but-archived probe Worker for CFusion panel compatibility under
workerd with `nodejs_compat` and compatibility date `2026-01-20`.

Run from this directory:

```sh
npx wrangler dev --local --port 8791
curl -s http://127.0.0.1:8791/
```

It reports each Node capability independently as JSON. See `P4_REPORT.md`
at the repository root for the recorded result.
