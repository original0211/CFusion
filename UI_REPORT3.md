# CFusion 面板控制台 UI 精修报告（第三轮：收掉验收五处瑕疵）

日期：2026-10-22 ｜ 提交：5f3ccf1（engine)、78916ce（bridge)、ddc3e43（theme）｜ 状态：已部署上线并验证

本轮针对第二轮真实浏览器验收发现的五处实景瑕疵逐项修复。每项先定位根因再动手。

## 一、双层页眉 → 桥接条并入顶栏子栏

**根因**：bridge.js 注入的管理员条、配置版本条、注册表条（及内核更新提示）都用 `document.body.prepend` 插到 body 最前面，位于 sticky 顶栏之前；且各自带内联样式（max-width:960px、margin:12px），与顶栏的 1120px 列宽、发丝线语言不一致，首屏读起来像两个页眉。

**改法**（bridge.js + theme.css）：
- bridge.js 新增 `mountSubBar()`：首次调用时在 `.sq-topbar` 正后方创建一个 `#sqSubBar` 容器（找不到顶栏时退回 body 前置兜底），四条桥接条按原监听器顺序 append 进同一容器。注入钩子、登录/注销、版本确认拦截、注册表逻辑一字未动，只换挂载点。
- 三条 bar 的内联 cssText 全部移除，改挂 class：`sq-bridge-bar` + 各自的 `sq-admin-bar` / `sq-meta-bar` / `sq-registry-bar`，样式收回 theme.css：与顶栏同列宽（1120px、左右 32px 内边距与 .container 对齐）、白底、条间以 1px 浅发丝线相隔、容器底部一条发丝线收束——首屏只读出一个页眉系统。
- 管理员行：标签改小号大写字距；口令输入沿用全局下划线式（flex 宽 220px）；登录/退出按钮用 `#adminLogin/#adminLogout { margin-inline-start: auto }` 推到行右端。
- 配置版本行弱化为独立的 `sq-meta-bar`：11px、--sq-muted 灰字、上下内边距收至 6px，是子栏里最安静的一行。

## 二、DKBY 下拉空白 → 根因是 option 值域缺 'no'

**根因（非样式问题）**：`#portControl`（TLS 控制，字段 dkby）的 option 只有 `value=""`（默认）与 `value="yes"`（仅TLS节点）两项；而 dkby 的合法取值域是 `'' / 'no' / 'yes'`——内核字段表 F 的默认值就是 `dkby: "no"`，面板默认配置同样是 'no'。回填时 `写入字段值('portControl', 配置.dkby)` 执行 `select.value = 'no'`，无匹配 option → 浏览器把 selectedIndex 置 -1 → 下拉渲染为空白。线上当时 dkby 正是默认 'no'，故必现；yxby 默认 '' 能命中第一项，所以其他下拉看似正常。

**改法**（engine.mjs）：按同表单 downgradeControl（qj）的既有模式（''/ 'no' / 'only' 三项齐全）给 portControl 补 `<option value="no">`，新增 i18n 键 `tlsControlNo`（zh「关闭（保留所有节点）」、fa「غیرفعال (حفظ همه گره‌ها)」）。option 值域 {'', 'no', 'yes'} 与 dkby 取值域完全对齐，回填任何合法值都能命中。未动主题、未动回填逻辑。

**验证**：本地 fixture 实渲（stub core 回 dkby:'no' + 面板真渲染）抓到的控制台 HTML 中，portControl 三个 option 齐全、页面内嵌 config 的 dkby='no' ∈ option 值域——按 HTML 规范 `select.value='no'` 必然选中该项并显示其文字，证据链闭合；线上 HTML 复查同样三项齐全。本机无可用无头浏览器 DOM，未能做像素级截图，此点以规范级证据替代（见残余）。

## 三、系统状态「[ 检测中... ]」残留 → 标题行从无人更新变为四出口统一收尾

**根因**：`#systemStatus` 的首行 `[ 检测中... ]` 是纯静态标记——没有 id、没有任何 JS 引用它。各状态行（regionStatus 等）由 `检查系统状态()` 分别回填，唯独这行标题从生下来就没人管，检测完成后自然残留。

**改法**（engine.mjs）：
- 标题行加 `id="systemStatusHead"` 与 `data-done="[ 检测完成 ]"`（新增 i18n 键 checkDone，zh/fa 均有）。
- `检查系统状态()` 开头（try 之前定义，避免 catch 作用域不可见）加 `标记检测完成()`：把标题行文本换成 data-done。该函数的全部四个出口——自定义 IP 提前返回、手动地区提前返回、正常走完、异常 catch 兜底——都调用一次。检测进行中显示「检测中...」的行为不变，只修完成后残留。

**验证**：本地实渲 HTML 中 systemStatusHead 与 data-done 在位，页面脚本里 `标记检测完成` 共 5 处（1 定义 + 4 调用点），与四出口一一对应（静态核查；运行时替换动作本身未在无头 DOM 里执行）。

## 四、页脚收尾（engine.mjs + theme.css）

控制台 `.container` 末尾（最后一张卡片之后）新增 `<footer class="sq-footer">CFUSION · 订阅中心 · ${年份}</footer>`：上方 1px 发丝线，11px 小号大写字距、灰字，**无任何链接**。年份在服务端渲染时取当前年。落地页（index.html）为居中单卡结构、与控制台不同构，未同步加页脚。

## 五、标签栏跟随（theme.css）

**改法**：分节标题 `.card-title` 由 `position:absolute` 改为 `position:sticky; top: calc(var(--sq-bar-h) + 22px)`（与 57px 顶栏错开 22px）。为不移动内容列，标题保持在流内但 `height:0; overflow:visible; margin-inline-start:-264px`——零高不占版面、负边距把它拉回左侧 264px 标签区，视觉位置与原来一致；滚动长节（配置管理）时标题停留在视口内、随节尾自然推出。≤900px 断点同步补 `height:auto; margin-inline-start:0`，堆叠单栏行为不变。

## 改动文件

| 文件 | 改动 |
|---|---|
| `panel/src/engine.mjs` | portControl 补 'no' option；新增 i18n 键 tlsControlNo / checkDone（zh+fa）；systemStatusHead 加 id 与 data-done；检查系统状态四出口调用标记检测完成；container 末尾加 sq-footer |
| `panel/src/bridge.js` | 新增 mountSubBar 并改四处 prepend 为子栏挂载；三条 bar 去内联 cssText 改 class |
| `panel/src/theme.css` | .sq-subbar / .sq-bridge-bar 子栏体系；.card-title 改 sticky 标签栏；.sq-footer 样式；响应式断点同步 |

未改：server.mjs、index.html、core/、全部测试文件。JS 钩子零删改：adminSessionBar / adminLogin / adminLogout / cfusionMetaBar / workerRegistry / coreVersionStatus 等 id 与全部事件逻辑原样；新增钩子仅 #sqSubBar、#systemStatusHead 与三个 sq-*-bar class。

## 测试与验证

- **全量测试**：`npm test` 122/122 全过（基线 122，无增减、无测试改动）。
- **本地实渲**：stub core（/api/config 回 dkby:'no'、cfusionMeta）+ 面板 Node 服务真渲染控制台（202,300B)，Cache-Control 仍为 private, max-age=300；结构核查全过（标题行/data-done、portControl 三 option、页脚文本、子栏 CSS、sticky 规则、mountSubBar 均在位）。
- **部署**：仅 panel。`build:cloudflare` 重建 dist（17 个模块）后经 cf-api multipart 上传 cfusion-panel；metadata 原样带回四项 bindings。上传前后 settings 回读逐项一致（compatibility_date 2026-01-20、flags nodejs_compat、CORE service / PANEL_ADMIN_PASSWORD secret_text / SESSION_KV kv / w plain_text）。
- **线上确认**：/health 返回 {"ok":true}；控制台 200（203,289B)，Cache-Control: private, max-age=300 未变；线上 HTML 12 项结构核查全过（顶栏、子栏 CSS、mountSubBar、bar class 化、旧 960px 内联样式消失、systemStatusHead+data-done、标记检测完成 5 处、DKBY 'no' option、页脚、card-title sticky 及其偏移、页脚 CSS）。

## 残余边角（如实列）

- 本机无头 Chromium 在本 VM 内无法完成页面加载（前两轮已确认），本轮 DKBY 选中态与占位字替换均为「渲染 HTML + 规范/静态证据」级验证，未做像素级截图；sticky 标签栏的实际滚动手感同样未做真机像素核对（CSS 规则与偏移量已核查在位），待主代理真实浏览器验收。
- 子栏容器在无顶栏页面（落地页）退回 body 前置，样式仍走 .sq-subbar 全宽白底，未单独实渲落地页核对（该页 bridge 条仅在满足条件时出现，逻辑未变）。

---

# 回归修复（第三轮引入的两处新缺陷，真实浏览器复验实证）

提交：82876c5（分节 grid 双栏 + configCard 显隐）、c86f2dc（页眉列宽对齐）｜ 状态：已部署上线并验证

第三轮的第五项（标签栏跟随）与第一项（页眉合并）经主代理真实浏览器复验后各暴露一处缺陷，本节逐项修复。以下结论均为结构/CSS 证据级核查，像素级复验由主代理用真实浏览器完成，本节不声称已目视确认。

## 一、sticky 节标题叠字 → 废弃零高 hack，节改为真双栏 grid

**根因**：第三轮 `.card-title` 用 `position:sticky` + `height:0; overflow:visible; margin-inline-start:-264px` 的零高 hack——标题盒高为零、无背景色，靠负边距拉回左栏；真实浏览器里标题没有落回标签栏，而是以透明底压在正文列左缘，滚动时与正文持续叠字（配置管理节与 KV 提示行、字段标签、YX 文本域等多处相撞，另两节首行亦然）。

**新实现**（theme.css，零高 hack 与负边距整体删除）：
- 每节 `.card` 改为真双栏 grid：`display:grid; grid-template-columns: 208px minmax(0, 1fr); column-gap: 56px`（208+56 与原 264px 缩进几何等价），去掉 `padding-inline-start:264px`。
- 内容子元素统一进右列：`.card > * { grid-column: 2; min-width: 0 }`（配 `minmax(0,1fr)` 防长链接/文本域撑爆列宽）。
- 标题即左列单元格本身：`.card > .card-title { grid-column: 1; grid-row: 1 / span 999; align-self: start; position: sticky; top: calc(var(--sq-bar-h) + 22px); z-index: 6; background: var(--sq-bg) }`——sticky 挂在单元格（标题元素）上、与顶栏错开，实底色 + 独立层级；标题物理上位于左列内，与正文列不共面，滚动时停在左栏、节尾自然推出，不可能再叠字。
- 钩子核实：标题元素无 id、全仓脚本无任何按 class/id 对它的引用（仅 engine 模板三处标记），本次未动其 DOM 位置与标记本身，JS 钩子零影响。
- 连带修复（engine.mjs）：configCard 由 JS 以 `style.display='block'` 显示，内联值会压掉样式表的 grid 使该节退回块布局——6 处赋值改为清空内联值 `style.display=''`，显示时由样式表 grid 接管，初始隐藏仍由标记内联 `display:none` 承担，显隐逻辑与时机不变。
- ≤900px 断点：`.card { display:block }`、标题 `position:static` 回到节首静态显示、不 sticky，与原堆叠行为一致。

## 二、页眉三行宽度不统一 → 顶栏加内层列，页眉系统共用一列宽

**根因**：顶栏是通栏 flex（内容贴视口左右、24px 内边距、分隔线整幅宽），其下桥接条与正文是 1120px 居中列（32px 内边距），两套宽度并存。

**改法**（engine.mjs + theme.css）：
- engine.mjs 顶栏子元素外包一层 `<div class="sq-topbar-in">`（新增标记，无 id/钩子变化；bridge 仍按 `.sq-topbar` 定位挂子栏，不受影响）。
- `.sq-topbar` 只保留 sticky/定位/底色；布局移入 `.sq-topbar-in`：`max-width:1120px; margin:0 auto; padding:8px 32px`，发丝线（border-bottom）随内层走，与正文列同宽。
- `.sq-subbar` 同步约束 `max-width:1120px; margin:0 auto`，其底边发丝线与顶栏同跨度；`.sq-bridge-bar` 去掉自带 max-width/居中（宽度由子栏容器承担），内边距仍 32px——版本行/管理员行/注册表行与顶栏、正文的内容边缘全部对齐成一条线。
- ≤720px 断点的顶栏规则改挂 `.sq-topbar-in`（gap/内边距 16px/换行），其余响应式行为不变。

## 验证

- **全量测试**：`npm test` 122/122 全过（基线 122，无测试改动），最终提交态复跑仍 122/122。
- **本地实渲**：fixture core（内存 KV）+ 面板真渲染控制台（200)，断言全过——顶栏 wrapper 在标记中且正确闭合；三个节标题均为 .card 的直接子元素（左列单元格位置）；CSS 证据：负边距/零高 hack 零残留、`.card` 双列 grid 在位、内容子元素钉右列、sticky+实底色+z-index 挂在标题单元格上、顶栏/子栏同为 1120 列宽、≤900 标题静态规则在位。
- **部署**：仅 panel。`build:cloudflare` 重建 dist（17 个模块，产物内 hack 字符串零残留）后经 cf-api multipart 上传 cfusion-panel，metadata 原样带回四项 bindings（含 secret 以本地部署记录原值回填）。上传前后 settings 回读逐项一致（compatibility_date 2026-01-20、flags nodejs_compat、CORE service / PANEL_ADMIN_PASSWORD secret_text / SESSION_KV kv / w plain_text）。
- **线上确认**：/health 返回 {"ok":true}；控制台 200（204,474B)，Cache-Control: private, max-age=300 未变；线上 HTML 结构核查 10 项全过（sq-topbar-in wrapper、双列 grid 规则、sticky 挂左列单元格、标题实底色、-264px/零高 hack 消失、顶栏+子栏 1120 列宽、三节标题、页脚、DKBY 'no' option 均在位）。注意首次抓取曾命中一份与第三轮字节数相同的缓存旧副本（Cache-Control private 本不应被共享缓存缓存，疑为取数链路上的代理缓存），加缓存击穿参数重拉即为新版，此后核查均以新版为准。
- height:0 的 sticky 标题在极老浏览器上若不支持 sticky，会退化为静止在节首（与第二轮观感一致），无功能影响。
