// CFusion P3-1：面板管理会话（纯逻辑，可单测）。
//
// 背景：上游 cfnew-panel 的控制台凭 Worker 的 UUID/自定义路径进入，而 UUID 同时
// 是订阅凭据——拿到订阅链接的人就能改配置。P3-1 增加「可选」管理口令：
// 面板侧 env PANEL_ADMIN_PASSWORD 设置后，一切配置写操作必须先登录。
// 未设置口令时全部行为与上游一致（向后兼容），但那等于「UUID 即全权凭据」。
//
// 设计借鉴 CFNext-Plus 的教训：session token 必须服务端随机生成（crypto），
// 不能用密码的确定性哈希充当（哈希可离线爆破、且改密前长期有效）。
// 存储边界：token 只存面板进程内存 Map（惰性过期）。面板重启即全员登出；
// 无状态/多实例部署（如 P4 Cloudflare 化、Vercel 函数）下各实例不共享会话，
// 届时需换 KV 等共享存储——见 P3_REPORT 的取舍说明。
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE = 'cfusion_admin';
export const ADMIN_PASSWORD_ENV = 'PANEL_ADMIN_PASSWORD';
export const ADMIN_TTL_ENV = 'PANEL_ADMIN_SESSION_TTL_HOURS';
export const DEFAULT_SESSION_TTL_MS = 24 * 3600 * 1000;

export function adminPassword(env = process.env) {
  return String((env || process.env)[ADMIN_PASSWORD_ENV] || '');
}

export function adminEnabled(env = process.env) {
  return adminPassword(env).length > 0;
}

export function sessionTtlMs(env = process.env) {
  const hours = Number((env || process.env)[ADMIN_TTL_ENV]);
  return Number.isFinite(hours) && hours > 0 ? Math.round(hours * 3600 * 1000) : DEFAULT_SESSION_TTL_MS;
}

function digest(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest();
}

// 常量时间比较（先各自 sha256 到定长，避免长度泄漏与 timingSafeEqual 长度异常）。
export function checkAdminPassword(candidate, env = process.env) {
  const expected = adminPassword(env);
  if (!expected) return false;
  return timingSafeEqual(digest(candidate), digest(expected));
}

export function createSessionStore({ ttlMs = DEFAULT_SESSION_TTL_MS, now = () => Date.now(), random = size => randomBytes(size) } = {}) {
  const sessions = new Map(); // token -> expires(ms)
  const prune = () => {
    const t = now();
    for (const [token, expires] of sessions) if (expires <= t) sessions.delete(token);
  };
  return {
    issue() {
      prune();
      const token = random(32).toString('base64url');
      sessions.set(token, now() + ttlMs);
      return token;
    },
    verify(token) {
      if (!token || typeof token !== 'string') return false;
      const expires = sessions.get(token);
      if (expires === undefined) return false;
      if (expires <= now()) { sessions.delete(token); return false; }
      return true;
    },
    revoke(token) {
      if (token) sessions.delete(token);
    },
    get size() { prune(); return sessions.size; }
  };
}

// CFusion P4: Cloudflare KV-backed session store. It implements the same
// issue/verify/revoke surface as the in-memory store, but all methods are
// async. The KV binding owns expiry through expirationTtl; verify also checks
// the stored deadline so a fake/older KV implementation in tests behaves the
// same. Keys contain only a SHA-256 digest of the bearer token, never the
// token itself, so a KV listing does not disclose live sessions.
export function createKvSessionStore(kv, { ttlMs = DEFAULT_SESSION_TTL_MS, now = () => Date.now(), random = size => randomBytes(size), prefix = 'cfusion-admin-session:' } = {}) {
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') throw new TypeError('SESSION_KV binding must provide get/put');
  const keyFor = token => prefix + createHash('sha256').update(String(token), 'utf8').digest('hex');
  return {
    async issue() {
      const token = random(32).toString('base64url');
      const expires = now() + ttlMs;
      await kv.put(keyFor(token), JSON.stringify({ expires }), { expirationTtl: Math.max(60, Math.ceil(ttlMs / 1000)) });
      return token;
    },
    async verify(token) {
      if (!token || typeof token !== 'string') return false;
      const raw = await kv.get(keyFor(token));
      if (!raw) return false;
      let expires = 0;
      try { expires = Number(JSON.parse(raw)?.expires) || 0; } catch { expires = 0; }
      if (expires <= now()) {
        if (typeof kv.delete === 'function') await kv.delete(keyFor(token));
        return false;
      }
      return true;
    },
    async revoke(token) {
      if (token && typeof kv.delete === 'function') await kv.delete(keyFor(token));
    },
    async size() { return -1; } // KV has no cheap/safe enumeration contract here.
  };
}

export function parseCookieHeader(header) {
  const result = {};
  if (!header || typeof header !== 'string') return result;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    try { result[name] = decodeURIComponent(part.slice(index + 1).trim()); }
    catch { result[name] = part.slice(index + 1).trim(); }
  }
  return result;
}

export function sessionCookieHeader(token, { ttlMs = DEFAULT_SESSION_TTL_MS, secure = false } = {}) {
  const base = ADMIN_COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.max(1, Math.floor(ttlMs / 1000));
  return secure ? base + '; Secure' : base;
}

export function clearedCookieHeader({ secure = false } = {}) {
  const base = ADMIN_COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  return secure ? base + '; Secure' : base;
}

// 登录失败节流（进程内、全局计数）：连续失败达到上限后锁定一段时间。
// 无可靠客户端 IP（面板可能在多层代理后），故只做全局节流——挡批量在线爆破，
// 代价是锁定窗口内合法登录也被拒（短时间、可接受）；口令本身应足够长。
export function createLoginThrottle({ maxFailures = 10, lockMs = 5 * 60 * 1000, now = () => Date.now() } = {}) {
  let failures = 0;
  let lockedUntil = 0;
  return {
    locked() { return lockedUntil > now(); },
    fail() {
      failures += 1;
      if (failures >= maxFailures) { lockedUntil = now() + lockMs; failures = 0; }
    },
    succeed() { failures = 0; lockedUntil = 0; }
  };
}
