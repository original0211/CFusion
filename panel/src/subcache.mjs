// CFusion P3-3：订阅响应缓存（移植 CFNext-Plus 的缓存键归一化 + LRU32 口径）。
//
// 背景：CFNext 的订阅缓存曾用完整 URL 作键，任何人在订阅链接后加 ?x=随机
// 即可击穿缓存、每次触发完整生成（最吃 CPU 的路径）。这里键只保留有意义维度：
// Worker host + uuid + target + 方法 + User-Agent——其余查询参数（含随机串、
// 时间戳）一律忽略。LRU 上限 32（命中刷新热度），TTL 60s 防陈旧；任一 Worker
// 的配置保存成功后，面板立即失效该 Worker 的全部条目（见 server.mjs 接入）。
export const SUB_CACHE_LIMIT = 32;
export const SUB_CACHE_TTL_MS = 60000;

export function buildSubCacheKey({ host, uuid, target, agent, method }) {
  return [host || '', uuid || '', target || '', method || 'GET', agent || ''].join('\n');
}

export function createSubCache({ limit = SUB_CACHE_LIMIT, ttlMs = SUB_CACHE_TTL_MS, now = () => Date.now() } = {}) {
  const entries = new Map(); // key -> { value, expires }，Map 顺序即 LRU 顺序
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.expires <= now()) { entries.delete(key); return null; }
      entries.delete(key);
      entries.set(key, entry); // 命中刷新热度
      return entry.value;
    },
    set(key, value) {
      if (entries.has(key)) entries.delete(key);
      entries.set(key, { value, expires: now() + ttlMs });
      while (entries.size > limit) entries.delete(entries.keys().next().value); // 淘汰最久未用
    },
    invalidateWorker(host, uuid) {
      const prefix = (host || '') + '\n' + (uuid || '') + '\n';
      for (const key of [...entries.keys()]) if (key.startsWith(prefix)) entries.delete(key);
    },
    clear() { entries.clear(); },
    get size() { return entries.size; }
  };
}
