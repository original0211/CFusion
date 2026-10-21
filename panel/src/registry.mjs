// CFusion P2：Worker 注册表（管理模式）的数据模型与纯逻辑。
// 存储层选择：浏览器 localStorage，键沿用上游「记住节点」的 cfnew-panel-nodes。
// 理由见 P2_REPORT：面板本身无状态、无自有持久层；Worker KV 是「每个 Worker 自己的
// 配置」，注册表要在选中任何 Worker 之前就存在，天然属于操作者一侧；env 是部署期
// 静态配置且 w 已占用为单绑定语义。localStorage 也是上游既有机制，模型只是给它
// 补上 name 字段与 host+uuid 双键去重，旧数据 {host, uuid} 直接兼容。
// 注意：注册表条目含 UUID（访问凭据），只许存本机浏览器；展示/日志一律用 maskAccessId。

export const REGISTRY_KEY = 'cfnew-panel-nodes';
export const REGISTRY_LIMIT = 20;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeRegistryEntry(input) {
  if (!input || typeof input !== 'object') return null;
  const host = String(input.host || '').trim();
  const uuid = String(input.uuid || '').trim();
  if (!host || !uuid) return null;
  return { name: String(input.name || '').trim(), host, uuid };
}

function entryKey(entry) {
  return entry.host + '\n' + entry.uuid;
}

// 容忍解析：坏 JSON、非数组、字段缺失都降级为「尽可能多的合法条目」，永不抛错。
export function parseRegistry(text) {
  let raw;
  try { raw = JSON.parse(text || '[]'); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const entries = [];
  for (const item of raw) {
    const entry = normalizeRegistryEntry(item);
    if (!entry || seen.has(entryKey(entry))) continue;
    seen.add(entryKey(entry));
    entries.push(entry);
    if (entries.length >= REGISTRY_LIMIT) break;
  }
  return entries;
}

export function serializeRegistry(entries) {
  return JSON.stringify(parseRegistry(JSON.stringify(entries || [])));
}

// 新增/更新：同 host+uuid 视为同一条，置顶并更新名称；上限 REGISTRY_LIMIT。
export function upsertRegistryEntry(entries, input) {
  const entry = normalizeRegistryEntry(input);
  const list = parseRegistry(JSON.stringify(entries || []));
  if (!entry) return list;
  const rest = list.filter(item => entryKey(item) !== entryKey(entry));
  return [entry, ...rest].slice(0, REGISTRY_LIMIT);
}

export function removeRegistryEntry(entries, index) {
  const list = parseRegistry(JSON.stringify(entries || []));
  return list.filter((_, i) => i !== index);
}

export function findRegistryEntry(entries, host, uuid) {
  const probe = normalizeRegistryEntry({ host, uuid });
  if (!probe) return -1;
  return parseRegistry(JSON.stringify(entries || [])).findIndex(item => entryKey(item) === entryKey(probe));
}

export function registryDisplayName(entry) {
  return entry?.name || entry?.host || '';
}

// 展示用掩码：UUID 只露前 8 位，自定义路径整体打码（同为访问凭据）。
export function maskAccessId(value) {
  const text = String(value || '');
  if (uuidPattern.test(text)) return text.slice(0, 8) + '…';
  return text ? '••••' : '';
}
