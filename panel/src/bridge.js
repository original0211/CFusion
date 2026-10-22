// 原界面的订阅和配置入口连接到各自的服务器。
// 登录后用真实 UUID 保持连接，修改自定义入口不会使重载失效。
const panelLocation = new URL(location.href);
const access = (panelLocation.searchParams.get('uuid') || '').trim();
try {
  const nodes = JSON.parse(localStorage.getItem('cfnew-panel-nodes') || '[]');
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      const origin = new URL(/^https?:\/\//i.test(node.host) ? node.host : 'https://' + node.host).origin;
      if (origin === window.CFNEW.host && node.uuid === access) node.uuid = window.CFNEW.uuid;
    }
    localStorage.setItem('cfnew-panel-nodes', JSON.stringify(nodes));
  }
} catch {}
if (window.CFNEW.panelPath) history.replaceState(null, '', window.CFNEW.panelPath);
else {
  panelLocation.searchParams.set('uuid', window.CFNEW.uuid);
  history.replaceState(null, '', panelLocation);
}
// CFusion 语言补齐：bridge 与控制台同一语言口径——localStorage → Cookie →
// 服务端已渲染的 <html lang>，只认 'zh' | 'en'，其余（包括已下线的 fa）回退 zh。
const bridgeLang = (() => {
  let saved = '';
  try { saved = localStorage.getItem('preferredLanguage') || ''; } catch {}
  if (!saved) {
    const match = document.cookie.match(/(?:^|;\s*)preferredLanguage=([^;]*)/);
    if (match) { try { saved = decodeURIComponent(match[1]); } catch { saved = match[1]; } }
  }
  if (!saved) saved = document.documentElement.lang || '';
  return String(saved).toLowerCase().startsWith('en') ? 'en' : 'zh';
})();
const BT = {
  zh: {
    coreUpdateTitle: '内核需要更新',
    panelVersion: '面板版本 ',
    coreVersion: ' · 内核版本 ',
    coreUnversioned: '未标版本（旧内核）',
    coreMismatchHint: '当前内核与面板版本不一致。请上传配套内核，保留原来的 u 和 C/c 绑定，然后刷新此页。',
    whatsChanged: '本次更新了什么',
    downloadPages: '下载 pages.zip',
    downloadWorker: '下载 _worker.js',
    gotIt: '知道了',
    ignoreUpdate: '本次更新不再提醒',
    storageError: '浏览器未能保存，请用“知道了”关闭提示。',
    admin: '管理员',
    adminLoggedIn: '已登录（可修改配置）',
    logout: '退出',
    adminPasswordPh: '管理口令',
    loginToEdit: '登录后可改配置',
    loginFailed: '登录失败',
    loginRequestFailed: '登录请求失败',
    metaVersion: '配置版本 v',
    metaLastChange: ' · 上次变更 ',
    metaChanged: ' · 改动：',
    confirmCritical: '以下关键配置将被修改，确认保存？\n',
    confirmSep: '：',
    registry: 'Worker 注册表',
    registryAria: '已注册的 Worker',
    registryUnregistered: '（当前 Worker 未注册）',
    registrySwitch: '切换',
    registryRemember: '记住当前 Worker',
    registryRemembered: '已记住'
  },
  en: {
    coreUpdateTitle: 'Core update required',
    panelVersion: 'Panel version ',
    coreVersion: ' · Core version ',
    coreUnversioned: 'Unversioned (old core)',
    coreMismatchHint: 'The current core does not match the panel version. Upload the matching core, keep the original u and C/c bindings, then refresh this page.',
    whatsChanged: "What's new",
    downloadPages: 'Download pages.zip',
    downloadWorker: 'Download _worker.js',
    gotIt: 'Got it',
    ignoreUpdate: "Don't remind me about this update",
    storageError: 'Your browser could not save this. Use "Got it" to dismiss the notice.',
    admin: 'Admin',
    adminLoggedIn: 'Logged in (config editable)',
    logout: 'Log out',
    adminPasswordPh: 'Admin password',
    loginToEdit: 'Log in to edit config',
    loginFailed: 'Login failed',
    loginRequestFailed: 'Login request failed',
    metaVersion: 'Config version v',
    metaLastChange: ' · Last change ',
    metaChanged: ' · Changed: ',
    confirmCritical: 'The following critical settings will be changed. Save?\n',
    confirmSep: ': ',
    registry: 'Worker Registry',
    registryAria: 'Registered Workers',
    registryUnregistered: '(Current Worker not registered)',
    registrySwitch: 'Switch',
    registryRemember: 'Remember current Worker',
    registryRemembered: 'Remembered'
  }
}[bridgeLang];
// CFusion UI 第三轮：桥接条（版本提示 / 管理员 / 配置版本 / 注册表）统一挂到
// 顶栏正下方的子栏容器里，与顶栏同宽、同发丝线语言，首屏只读出一个页眉系统。
function mountSubBar(element) {
  let stack = document.getElementById('sqSubBar');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'sqSubBar';
    stack.className = 'sq-subbar';
    const topbar = document.querySelector('.sq-topbar');
    if (topbar && topbar.parentNode) topbar.parentNode.insertBefore(stack, topbar.nextSibling);
    else document.body.prepend(stack);
  }
  stack.append(element);
}

document.addEventListener('DOMContentLoaded', () => {
  const release = window.CFNEW.release;
  const ignoredUpdateKey = 'cfnew-panel-ignored-update';
  let ignoredVersion = '';
  try { ignoredVersion = localStorage.getItem(ignoredUpdateKey) || ''; } catch {}
  if (release.needsUpdate && ignoredVersion !== release.panelVersion) {
    const notice = document.createElement('section');
    notice.id = 'coreVersionStatus';
    notice.dataset.updateRequired = String(release.needsUpdate);
    notice.setAttribute('role', 'status');
    const title = document.createElement('strong');
    title.textContent = BT.coreUpdateTitle;
    const versions = document.createElement('div');
    versions.textContent = BT.panelVersion + release.panelVersion + BT.coreVersion + (release.coreVersion || BT.coreUnversioned);
    notice.append(title, versions);
    if (release.needsUpdate) {
      const hint = document.createElement('p');
      hint.textContent = BT.coreMismatchHint;
      notice.append(hint);
    }
    const details = document.createElement('details');
    details.open = release.needsUpdate;
    const summary = document.createElement('summary');
    summary.textContent = BT.whatsChanged;
    const changes = document.createElement('ul');

    for (const text of (bridgeLang === 'en' && Array.isArray(release.changesEn) ? release.changesEn : release.changes)) {
      const item = document.createElement('li'); item.textContent = text; changes.append(item);
    }
    const downloads = document.createElement('div');
    downloads.className = 'release-downloads';
    for (const [label, url] of [[BT.downloadPages, release.zipUrl], [BT.downloadWorker, release.workerUrl]]) {
      const link = document.createElement('a');
      link.textContent = label; link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      downloads.append(link);
    }
    details.append(summary, changes, downloads);
    const actions = document.createElement('div');
    actions.className = 'release-actions';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.id = 'dismissCoreUpdate';
    dismiss.textContent = BT.gotIt;
    dismiss.addEventListener('click', () => notice.remove());
    const ignore = document.createElement('button');
    ignore.type = 'button';
    ignore.id = 'ignoreCoreUpdate';
    ignore.textContent = BT.ignoreUpdate;
    const storageError = document.createElement('p');
    storageError.hidden = true;
    storageError.setAttribute('role', 'status');
    ignore.addEventListener('click', () => {
      try {
        localStorage.setItem(ignoredUpdateKey, release.panelVersion);
        notice.remove();
      } catch {
        storageError.textContent = BT.storageError;
        storageError.hidden = false;
      }
    });
    actions.append(dismiss, ignore);
    notice.append(details, actions, storageError);
    mountSubBar(notice);
  }
  const links = document.querySelectorAll('[onclick]');
  for (const link of links) {
    const action = link.getAttribute('onclick');
    if (action.includes('window.location.href') && action.includes('/sub')) {
      link.removeAttribute('onclick');
      link.addEventListener('click', () => navigator.clipboard.writeText(window.CFNEW.subUrl));
    }
  }
});

// CFusion P3-1：管理会话状态条。仅当面板设置了 PANEL_ADMIN_PASSWORD 时出现；
// 未设置口令时 /api/admin/status 返回 adminRequired=false，此处直接不渲染（行为与上游一致）。
document.addEventListener('DOMContentLoaded', async () => {
  let status;
  try { status = await (await fetch('/api/admin/status')).json(); } catch { return; }
  if (!status || !status.adminRequired) return;
  const bar = document.createElement('section');
  bar.id = 'adminSessionBar';
  bar.setAttribute('role', 'navigation');
  bar.className = 'sq-bridge-bar sq-admin-bar';
  const label = document.createElement('strong');
  label.textContent = BT.admin;
  bar.append(label);
  if (status.loggedIn) {
    const state = document.createElement('span');
    state.textContent = BT.adminLoggedIn;
    const logout = document.createElement('button');
    logout.type = 'button';
    logout.id = 'adminLogout';
    logout.textContent = BT.logout;
    logout.addEventListener('click', async () => {
      try { await fetch('/api/admin/logout', { method: 'POST' }); } catch {}
      location.reload();
    });
    bar.append(state, logout);
  } else {
    const input = document.createElement('input');
    input.type = 'password';
    input.id = 'adminPassword';
    input.placeholder = BT.adminPasswordPh;
    input.autocomplete = 'current-password';
    const login = document.createElement('button');
    login.type = 'button';
    login.id = 'adminLogin';
    login.textContent = BT.loginToEdit;
    const hint = document.createElement('span');
    login.addEventListener('click', async () => {
      hint.textContent = '';
      try {
        const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: input.value }) });
        if (response.ok) { location.reload(); return; }
        const data = await response.json().catch(() => null);
        hint.textContent = (data && data.message) || BT.loginFailed;
      } catch { hint.textContent = BT.loginRequestFailed; }
    });
    bar.append(input, login, hint);
  }
  mountSubBar(bar);
});

// CFusion P3-2：配置版本展示 + 关键变更确认拦截。
// 版本 meta 由面板在每次成功保存后写入 Worker 配置（cfusionMeta），控制台可直接读到。
document.addEventListener('DOMContentLoaded', () => {
  try {
    const meta = JSON.parse((window.CFNEW.config || {}).cfusionMeta || '');
    if (meta && meta.ver) {
      const bar = document.createElement('section');
      bar.id = 'cfusionMetaBar';
      bar.setAttribute('role', 'status');
      bar.className = 'sq-bridge-bar sq-meta-bar';
      const text = document.createElement('span');
      text.textContent = BT.metaVersion + meta.ver + BT.metaLastChange + (meta.ts || '') + (Array.isArray(meta.changedKeys) && meta.changedKeys.length ? BT.metaChanged + meta.changedKeys.join(', ') : '');
      bar.append(text);
      mountSubBar(bar);
    }
  } catch {}
});
// 关键键变更时服务端返回 409（needConfirm）：弹确认框，确认后带 confirmCritical 重提一次。
if (typeof window !== 'undefined' && window.fetch) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = (init && init.method) || (input && input.method) || 'GET';
      if (response.status !== 409 || !/\/api\/config$/.test(String(url).split('?')[0]) || String(method).toUpperCase() !== 'POST') return response;
      const data = await response.clone().json().catch(() => null);
      if (!data || !data.needConfirm) return response;
      const summary = (data.diff || []).map(item => item.key + BT.confirmSep + item.from + ' → ' + item.to).join('\n');
      if (!window.confirm(BT.confirmCritical + summary)) return response;
      const bodyText = init && typeof init.body === 'string' ? init.body : (input && typeof input.clone === 'function' ? await input.clone().text() : '');
      const proposed = JSON.parse(bodyText || '{}');
      proposed.confirmCritical = true;
      return originalFetch(input, { ...(init || {}), method: 'POST', headers: { 'Content-Type': 'application/json', ...((init && init.headers) || {}) }, body: JSON.stringify(proposed) });
    } catch { return response; }
  };
}

// CFusion P2：Worker 注册表切换器（管理模式）。
// 注册表存浏览器 localStorage（键 cfnew-panel-nodes，与首页「记住节点」同一份数据）。
// w 单绑定模式（CFNEW.panelPath 存在）下整体禁用：该模式只允许管绑定的那一个 Worker。
document.addEventListener('DOMContentLoaded', () => {
  if (window.CFNEW.panelPath) return;
  let entries = [];
  try {
    const saved = JSON.parse(localStorage.getItem('cfnew-panel-nodes') || '[]');
    if (Array.isArray(saved)) entries = saved.filter(n => n && typeof n.host === 'string' && typeof n.uuid === 'string');
  } catch {}
  const currentIndex = entries.findIndex(node => {
    try {
      const origin = new URL(/^https?:\/\//i.test(node.host) ? node.host : 'https://' + node.host).origin;
      return origin === window.CFNEW.host && node.uuid === window.CFNEW.uuid;
    } catch { return false; }
  });
  if (!entries.length && currentIndex < 0) {
    // 注册表为空也提供「记住当前」入口，方便第一次把当前 Worker 收进注册表。
  } else if (!entries.length) return;
  const bar = document.createElement('section');
  bar.id = 'workerRegistry';
  bar.setAttribute('role', 'navigation');
  bar.className = 'sq-bridge-bar sq-registry-bar';
  const label = document.createElement('strong');
  label.textContent = BT.registry;
  bar.append(label);
  const select = document.createElement('select');
  select.id = 'workerRegistrySelect';
  select.setAttribute('aria-label', BT.registryAria);
  entries.forEach((node, index) => {
    const option = new Option(node.name || node.host, String(index));
    if (index === currentIndex) option.selected = true;
    select.append(option);
  });
  if (currentIndex < 0) {
    const option = new Option(BT.registryUnregistered, '');
    option.selected = true;
    select.prepend(option);
  }
  bar.append(select);
  const go = document.createElement('button');
  go.type = 'button';
  go.id = 'workerRegistryGo';
  go.textContent = BT.registrySwitch;
  go.disabled = currentIndex >= 0 && entries.length <= 1;
  go.addEventListener('click', () => {
    if (select.value === '') return;
    const node = entries[Number(select.value)];
    if (!node || Number(select.value) === currentIndex) return;
    location.href = '/panel?' + new URLSearchParams({ host: node.host, uuid: node.uuid });
  });
  bar.append(go);
  select.addEventListener('change', () => { go.disabled = select.value === '' || Number(select.value) === currentIndex; });
  if (currentIndex < 0) {
    const remember = document.createElement('button');
    remember.type = 'button';
    remember.id = 'workerRegistryAdd';
    remember.textContent = BT.registryRemember;
    remember.addEventListener('click', () => {
      const node = { name: '', host: window.CFNEW.host, uuid: window.CFNEW.uuid };
      const rest = entries.filter(item => !(item.host === node.host && item.uuid === node.uuid));
      try {
        localStorage.setItem('cfnew-panel-nodes', JSON.stringify([node, ...rest].slice(0, 20)));
        remember.textContent = BT.registryRemembered;
        remember.disabled = true;
      } catch {}
    });
    bar.append(remember);
  }
  mountSubBar(bar);
});
