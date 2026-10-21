// CFusion panel — Cloudflare Workers entry (build output form).
//
// This file is written to live at the ROOT of the build output directory:
// src/tools/build-cloudflare.mjs copies it to panel/cloudflare/dist/worker.mjs,
// where ./src/* and ./cf-assets.mjs resolve. Do not point Wrangler at this
// source copy directly; build first, then use panel/cloudflare/wrangler.toml.
import { createCloudflareHandler } from './src/cf-entry.mjs';
import { assets, singboxRulesGzBase64 } from './cf-assets.mjs';

export default { fetch: createCloudflareHandler({ assets, singboxRulesGzBase64 }) };
