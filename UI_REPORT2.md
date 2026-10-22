# CFusion 面板控制台 UI 重设计报告（第二轮：Squarespace 编辑式结构）

日期：2026-10-22 ｜ 提交：14c320f（engine 结构）、68f4e23（theme 结构）｜ 状态：已部署上线并验证

本轮授权范围大于第一轮：可动页面结构排版与按钮。第一轮只换 `theme.css` 的做法被推翻——本轮同时改了 `engine.mjs` 的控制台标记结构与 `theme.css` 的布局体系。

## 设计说明（Squarespace 编辑式结构）

- **顶栏**：控制台顶部改为一条 sticky 顶栏（高 57px、白底、底部 1px 发丝线、无阴影）。左起：品牌 `CFUSION`（13px / 700 / 字距 0.32em 大写）、语言选择、FX 开关（改为无边框文字按钮）；右侧：系统状态（HUD）+ 操作簇（刷新、重置为下划线文字按钮，保存为黑底白字实心主按钮）。未保存徽标（● UNSAVED）改为悬挂在顶栏右簇下方。保存反馈条与 toast 栈改到顶栏下方弹出（原为右下角）。
- **分节排版**：三张「卡片」取消盒子形态，改为编辑式分节——每节顶部发丝线分隔，左侧 208px 标签栏（节标题小号大写 + 字距，上方带极淡序号 01/02/03，由 CSS 计数器生成），右侧内容栏（节内容左缩进 264px）；节间大留白（48/56px）。窄屏（≤900px）标签栏自动堆叠为内容上方单栏，序号转行内。
- **按钮体系**：全部矩形（圆角 0）、文字小号大写 + 字距 0.12–0.14em。主按钮黑底白字（顶栏保存、落地页提交）；次按钮白底 1px 黑边，hover 反转为黑底白字；行内小操作（全选/取消全选、顶栏刷新/重置、订阅行复制）为无边框文字按钮（下划线式）；危险操作只用暗红文字（#b3261e），hover 才出现红底。原右下角悬浮 dock 与图标方钮取消。
- **输入体系**：文本/数字/密码输入与下拉改为下划线式——无盒子、仅底边 1px 发丝线，focus 时底边变黑并加 1px 实线叠加；标签维持输入上方小号大写。多行文本（优选 IP 列表）保留极细发丝线边框 + 等宽字体（长文本下划线式不可读）。勾选改黑白方框（黑底白勾），单选改黑白圆点；禁用态灰化。
- **订阅区**：客户端由方格按钮改为整洁行式列表——每行客户端名（小号大写）+ 右侧箭头，整行可点（点击行为与原按钮完全一致：生成链接、尝试唤起客户端、复制到剪贴板）。生成后的链接改为一行展示：左侧客户端名标签、中间等宽截断链接、右侧「复制」文字按钮（新增按钮，复用同一提示文案）。家宽入口本来就是客户端行之一，同理。
- **状态区**：系统状态由发光面板改为发丝线分隔的纯文本行列表；表单内的旧紫色分组面板改为无框区块（顶部发丝线 + 留白）；读数块（当前配置等）改为无边框浅灰底。
- **色板与缓存**：沿用第一轮色板（#fff / #fafafa / #111 / #767676 / #e7e7e7）；控制台 `Cache-Control: private, max-age=300` 口径未动（线上已复核）。

## 改动文件

| 文件 | 改动 |
|---|---|
| `panel/src/engine.mjs` | 控制台标记结构：新增 `<header class="sq-topbar">` 包裹品牌/语言/FX/HUD；`#cpActionBar` 从页底迁入顶栏（按钮顺序改为刷新/重置/保存）；订阅链接区改为 `#clientSubRow` 行（名字 + 链接 + 复制按钮）；内联脚本新增 `显示订阅行()` 辅助函数与复制按钮监听，在原有两处链接展示点各加一行调用 |
| `panel/src/theme.css` | 整表重构：顶栏、分节双栏、按钮体系、下划线输入、方框勾选、订阅行、状态行、toast/反馈条新位置、响应式断点；落地页与 bridge 注入条同步到 1120px 列宽 |

未改：`server.mjs`、`bridge.js`、`index.html`、`core/`、任何测试文件。

## JS 钩子保留 / 变更清单

**全部保留（id / class / onclick 原样）**：`#languageSelector`、`#cpFxToggle`（含 `#cpFxLabel`、`.cp-fx-dot`）、`.cp-hud`（三行状态结构不变）、`#cpActionBar`、`#cpBtnSaveAll`（含 `.cp-fab-icon`、`.cp-fab-dot`）、`#cpBtnRefresh`、`#cpBtnReset`（含 `.cp-btn-label`、`data-tip`）、`#cpToastStack`、`#cpActionStatus`、三张卡片与 `.card-title`、`#configCard`、`#systemStatus` 及全部状态行 id、全部表单字段 id（含 `#jk`、`#jkSource`、`#subMode` 等运行时字段）、`.client-btn`（含 `#jkClientBtn`）、`#clientSubscriptionUrl`（仍为链接文本载体，JS 对其 `textContent` 与 `style.display` 的写入方式不变）、bridge 注入的 `#adminSessionBar` / `#cfusionMetaBar` / `#workerRegistry` / `#coreVersionStatus`。

**变更（仅位置 / 新增，无删除）**：

- `#cpActionBar` DOM 位置：页底 → 顶栏内（所有引用均为 `getElementById`，已逐项核对 engine/bridge 脚本，无位置依赖）
- `.cp-hud`、`.cp-lang-wrapper`、`#cpFxToggle` DOM 位置：body 直接子级 → 顶栏内（同上，id 引用）
- 新增 `#clientSubRow`（行容器，初始 `hidden`）、`#clientSubRowName`（客户端名标签）、`#cpCopySubUrl`（复制文字按钮）；新增脚本函数 `显示订阅行(名称)` 与复制按钮的 `addEventListener`——两者只做展示与剪贴板写入，不改动 `生成客户端链接` 的任何原有分支逻辑

## 关于「!important 压内联旧色」补丁

本轮结构与布局已完全由新结构规则承担（顶栏 flex、分节定位、行式列表、下划线字段均为新类/新结构规则，不靠覆盖）。剩余的内联样式映射表只处理**颜色令牌**（霓虹色 → 新色板）：engine 模板里数百处功能性内联样式（尺寸、显隐、布局值）按硬约束不能动，逐一剥离其颜色属性需重写上游整个模板的 style 属性，风险与收益不成比例，故保留映射表并在 theme.css 注释中写明原因。映射表不参与布局。

## 测试与验证

- **全量测试**：`npm test` 122/122 全过（基线 122，无增减）。无测试断言被改动的标记字符串，未改任何测试。
- **本地实渲**（fixture core + 面板，zh 与 fa/RTL 两变体）：落地页 200、控制台 200；结构核查 23 项全过——顶栏标记与品牌在位、操作簇位于 `</header>` 之前且在 `.container` 之前、`#cpBtnSaveAll` 唯一、订阅行三件套在位、`显示订阅行` 定义 1 处 + 调用 2 处、复制监听在位、新 CSS 令牌（`--sq-bar-h`、sticky、264px 标签栏、计数器、下划线字段）全部注入、旧右下 dock 定位消失，关键钩子（configCard / toast / jk / jkSource / 高级表单 / 语言选择）齐全。RTL 变体 `dir="rtl"`、复制按钮文案随语言切换正常。
- **部署**：仅 panel。`npm run build:cloudflare` 重建 dist 后经 cf-api multipart 上传 `cfusion-panel`；上传前后 settings 回读逐项一致——compatibility_date `2026-01-20`、flags `nodejs_compat`、四项 bindings（CORE service、PANEL_ADMIN_PASSWORD secret_text、SESSION_KV kv、w plain_text）未变。
- **线上确认**：`/health` 返回 `{"ok":true}`；面板根 200；`/<UUID>` 控制台 200（200,445B）且 `Cache-Control: private, max-age=300`；线上 HTML 结构核查 14 项全过（同本地清单）。
- **截图**：按约定未在本机硬耗无头截图（本机 Chromium 无头在本 VM 内无法完成页面加载，第一轮已确认），视觉细节由主代理用真实浏览器验收。

## 残余边角（如实列）

- 顶栏在 ≤1180px 隐藏 HUD 状态文本（品牌/语言/操作簇优先）；≤720px 顶栏换行、刷新/重置退回图标形态（标签文字隐藏，图标字形显示）——均为预设响应式行为，非缺陷。
- 分节序号由 CSS 计数器生成：`#configCard` 隐藏（未登录/无 KV）时不占序号，显示后后续节序号会顺延一位——纯视觉编号，无功能影响。
- RTL（fa）下标签栏借逻辑属性（`inset-inline-start` / `padding-inline-start`）自动镜像到右侧，已核查标记与属性在位；像素级观感未截图核对。
- 订阅行链接为单行截断（ellipsis）；JS 写入的内联 `overflowX: auto` 被主题的 `overflow: hidden !important` 覆盖以实现截断——完整链接可通过行内「复制」按钮取得，功能无损。
- 管理员登录条与注册表切换条沿用 bridge 注入，未在线上带口令实操（逻辑零改动，仅列宽与按钮样式同步）。
