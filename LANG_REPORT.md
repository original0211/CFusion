# 语言调整 + 图标替换报告（2026-10-22）

## 一、语言体系清单（动手前盘点）

语言逻辑全部集中在 `panel/src/engine.mjs`，bridge.js / index.html / server.mjs / registry.mjs 无语言分支：

- 翻译表共 8 处：服务端主表 1 处（`处理订阅值` 内，144 键）+ 客户端内嵌小表 7 处（2/19/6/5/1/8/2 键），zh/fa 逐站键数一致。
- 语言来源：服务端读 Cookie `preferredLanguage`，缺失时看 Accept-Language；客户端各小表各自读 localStorage/Cookie 后备浏览器语言——8 处各自独立判定。
- 模板里另有 47 处表外硬编码三元文案 `${是否值236 ? 'fa' : 'zh'}`（占位符、按钮、提示、状态消息）。
- RTL：仅主模板 `<html dir>` 一处 + theme.css 一条 `[dir="rtl"]` 规则。

## 二、改动

- **新增 en**：8 处翻译表逐键补齐英文（扁平化键集与 zh 完全对齐：154+2+29+6+5+1+8+2 条，脚本 diff 验证零缺失、零多余、零空值）；47 处表外三元改 `语言码236 === 'en' ? EN : zh 原文`（zh 操作数原文保留，中文渲染逐字不变）。
- **删除 fa**：8 处 fa 表整表删除；服务端与 7 处客户端的语言判定统一改为语言码（`'zh' | 'en'`）；选择器只剩「中文 / English」两项、无国旗；`<html dir>` 固定 `ltr`，theme.css 的 rtl 规则一并删除；另删一处波斯文数据比较（`detectionMethod === 'تعیین منطقه دستی'`——核心只返回中文 detectionMethod，该比较为死代码）。
- **回退行为**：本地存有旧值 `fa`/`fa-IR`（Cookie 或 localStorage）时一律回退**简体中文**（服务端与客户端一致，实渲验证 status 200、标题与 lang 均为 zh）；浏览器语言为 en 时自动英文，其余默认简体中文。
- **页脚**：原硬编码「订阅中心」改走 `翻译值.title`，en 下显示 Subscription Center。
- 术语口径：Subscription Center / Preferred IPs / Latency Test / Home Broadband Chain / TLS control 等业界惯例译法；新增键（tlsControlNo、checkDone、jkSource 系列）均有英文。

## 三、图标替换（页面表面）

盘点范围：控制台模板、落地页、bridge 注入条（后两者经查无图标）。旧 → 新：

| 旧图标 | 位置 | 新 |
|---|---|---|
| 🇨🇳 / 🇮🇷 | 语言选择器 | 删除，只留「中文 / English」文字 |
| ⚡（黄色 emoji） | 延迟测试标题 | 内联 SVG 闪电线稿（stroke=currentColor、1.5px、15px、`.sq-ico`) |
| ✅ | KV 已启用、状态行、ECH 已启用（共 11 处） | ✓（单色文字记号，颜色仍由所在 span 的文字色决定） |
| ⚠️ | KV 未启用/检测失败、安全提醒、ECH 未启用（共 8 处） | ⚠（去 VS16 的单色记号，与 toast 既有 warn 图标一致） |
| ❌ | 检测失败状态行、ECH 失败（共 6 处） | ✕（与 toast error 图标一致） |
| ⚙️ / 🔧 | 自定义 IP 模式状态行（3 处） | ⚙（单色） |
| 🎯 | 手动指定地区状态行 | ◎ |
| ⬇ | 获取 IP 按钮（2 处） | ↓（文字箭头） |
| 🎲 | 生成 CF IP 按钮 | 删除，只留文字 |
| 📍 | 「当前路径配置」标题 | 删除，只留文字 |

保留项及理由：

- toast 图标集（✓ / ⚠ / ✕）与关闭按钮 ✕、FX 开关的 CSS 圆点：本来就是单色记号/CSS 绘制，符合口径。
- 地区名与机场城市名中的国旗（如 🇭🇰 香港、🇯🇵 东京成田）：是数据字符串里的地理标识（状态展示与地区选择共用），非装饰性页面 chrome，保留。
- **订阅输出内的组名 emoji（🚀 节点选择、🎯 全球直连、🏠 家宽自动、⚡ CF 前置等）保留**：它们是生成给客户端的配置文件里的组*名称*（被同文件 rules 引用、被订阅测试断言），改名属于配置格式变更而非页面图标替换，且会让存量客户端的分组选择失效；如需改名应单独立项。

对齐：SVG 图标 15px、vertical-align -2px，不撑行高；其余均为同字体文字记号，基线天然一致。图标所在可点击元素只换图形，id/onclick/钩子未动。

## 四、验证

- `npm test`：122/122 全过，无测试改动。
- 键对齐脚本：8 站 zh/en 扁平键集逐一 diff，全等且 en 无空值。
- 残留扫描：engine.mjs 中阿拉伯字符 0、`'fa'` 0、`fa-IR` 0、rtl 0。
- 本地实渲（fixture core + 内存 KV，面板真渲染）32 项断言全过：zh（标题/节标题/保存按钮/页脚/选择器选中态/DKBY 选项）、en（同上英文 + lang="en" + data-done="[ Check complete ]" + 闪电 SVG 在位）、Accept-Language en 自动英文、Cookie=fa / fa-IR 回退 zh 且 200。
- 线上（部署后实测）：/health 正常；控制台 zh/en 均 200；选择器内恰 2 个 option（中文 selected / English）；en 页 lang="en"、标题 Subscription Center、SAVE ALL、[ Select Client ]、页脚英文、en option selected 均在位；zh/en 两页旧 emoji（✅ ⚠️ ❌ 🎲 ⬇ 📍 🇮🇷）零残留，闪电 SVG 在位；settings 回读 compat 2026-01-20 + nodejs_compat、四项 bindings 与部署前一致。
- 部署插曲（如实记录）：首次上传 metadata 中 secret_text 必须带 text，我从 DEPLOYED.md 提取口令时被文中第二处「管理口令」字样污染，写入了错误 secret，管理员登录一度 401；随即用 secrets 接口把 DEPLOYED.md 首行记录的原口令（28 字符）单独写回，复测登录 200、status loggedIn:true、注销 200——口令与部署前完全一致，窗口期无人能登录、未发生任何配置写入。含口令的临时文件已删除。

## 覆盖补齐（2026-10-22，真实浏览器验收残留清单逐项清零）

提交：40dd969（bridge/release）、270eb1b（server/cf-entry）、5a4bfec（engine）。测试基线 122/122 不变；zh 文案逐字未动，只加 en 分支/键。

### 每块残留：来源定位 → 修法 → en 译文抽样

1. **bridge 注入条整行**（`panel/src/bridge.js`，上一轮盘点误判其无语言文案）：文件内 28 处用户可见中文写死（版本行、管理员行、注册表行、更新行、409 确认框）。修法：新增 `bridgeLang`（localStorage `preferredLanguage` → Cookie → 服务端渲染的 `<html lang>`，与主站同一语言源；存量 `fa` 回退 zh）+ BT 双语词典 28 键，全部写死文案改走词典；更新日志条目改读 `release.changesEn`（`release.mjs` 新增）。抽样：'Config version v11 · Last change … · Changed: jk'、'Admin' / 'Admin password' / 'Log in to edit config' / 'Log out'、'Worker Registry' / '(Current Worker not registered)'。
2. **ECH 状态行**（`engine.mjs` 模板 + 客户端检查函数）：标签来自主表外写死、状态值由客户端拼装。修法：主表加 `echLabel`，模板与客户端四种状态（检测中/已启用+配置长度/未启用/检测失败）全部按服务端烘焙语言三元。抽样：'ECH status: ✓ Enabled (config length: 123)'、'⚠ Not enabled'。
3. **Free CPU 段**（`engine.mjs` 模板写死段落）：主表加 `freeCpuLabel`/`freeCpuHint`/`freeCpuUnsupported` 三键。抽样：'Free CPU Protection'、'At most 384 KiB of combined upload and download per connection (about 3 seconds at 1 Mbps). …'
4. **LATENCY TEST 副文案**（`engine.mjs` 模板写死）：主表加 `latencyTestHint`。抽样：'Checks availability; latency is measured from the panel server location.'
5. **优选IP筛选设置整块**（`engine.mjs` P1 新增段，整段不在翻译表内）：主表加 7 键（`optFilterTitle`/`optIpVersion`/`optIsp`/`optIspMobile`/`optIspUnicom`/`optIspTelecom`/`optFilterHint`）。抽样：'Preferred IP Filter Settings'、'IP Version'、'Carrier'、'Mobile'/'Unicom'/'Telecom'。
6. **页底汇总块**（`engine.mjs` 客户端拼装写死）：当前配置标签、KV 未配置、加载失败、配置路径/订阅地址、(未设置)/(尚无配置)、保存/重置全流程文案（过大/响应异常/失败/确认/已重置）全部按烘焙语言三元（与既有客户端文案同模式）。抽样：'Current config:'、'Config path: '、'Subscription URL: '、'(Not set)'、'Reset all config? This cannot be undone.'
7. **兜底排查**：
   - 服务端消息（`server.mjs`/`cf-entry.mjs`）：新增 `requestLang`（Cookie → Accept-Language，与 engine 同口径）+ `pickLang`；管理员登录/限流/未设口令、409 消息与 diff 的秘密值展示（'Set (content hidden)'/'Not set'，`diffConfig`/`describeConfigValue` 加 lang 参数贯通）、配置加载校验、worker-api 与 panel 端点错误、订阅失败前缀、整页错误页（'Connection incomplete'）全部双语化。
   - 「指定地区」下拉地名：已由上一轮 `regionNames` 双语表覆盖（本轮复核 55 码 zh/en 齐全），无需再做。
   - IATA 机房名表（272 条，延迟结果与城市筛选露出）：判定成本可控——新增同键 en 镜像表 `机房映射En`（键集与 zh 表逐一相等，脚本校验），`获取机房名称` 在 en 时优先 en 表、缺失回退 zh。抽样：'🇺🇸 San Jose'、'🇯🇵 Tokyo Narita'、'🇬🇧 London Heathrow'。

### 本地实渲逐项结果（夹具 core + handlePanel 真渲染 + bridge 在 DOM 桩中真执行，58/58 断言全过）

- bridge 版本行 en 'Config version v11 · Last change … · Changed: jk' ✓ / zh 原文 ✓；管理员行 en 'Admin'+'Log in to edit config' ✓ / zh ✓；注册表行 en 'Worker Registry'+'Switch'+'(Current Worker not registered)' ✓ / zh ✓。
- ECH 行 en 'ECH status: Checking...' 及烘焙状态串 ✓ / zh 'ECH状态: 检测中...' 及原状态串 ✓。
- Free CPU en 标签+整段说明 ✓ / zh 原文 ✓。
- 延迟副文案 en ✓ / zh ✓。
- 优选筛选块 en 标题/IP Version/Carrier/Mobile/Unicom/Telecom/说明 ✓ 且 en 页无该块中文 ✓ / zh 全原文 ✓。
- 汇总块 en 'Current config:'/'(Not set)'/'Config path: '/'Subscription URL: ' 等 ✓ 且 en 页无对应中文 ✓ / zh 全原文 ✓；保存/重置烘焙串 en ✓。
- 服务端：错口令 en 'Incorrect password' / zh '口令错误' ✓；409 en 消息 + diff 'Set (content hidden)' ✓。
- en 实渲兜底扫描：剩余中文仅为客户端双语表的 zh 半（运行时按语言取 en 半，不显示）、语言选择器的「中文」选项标签、订阅内容数据（见下）。

### 线上核查（部署后，panel 单独上传，settings 回读与部署前一致：compat 2026-01-20 + nodejs_compat + CORE/PANEL_ADMIN_PASSWORD/SESSION_KV/w 四绑定）

- zh/en 控制台均 200；逐项断言 24/24（ECH、Free CPU、延迟副文案、筛选块、汇总块、bridge 词典与语言函数、机房 en 表与查询、`<html lang>`、选择器恰 2 选项、无 fa）。
- 线上登录链路：错口令 en 返回 'Incorrect password'、zh 返回 '口令错误'；正确口令 200 + 会话 Cookie，注销 200（secret 写入正确，本轮口令只取 DEPLOYED.md 首处记录）。

### 仍保留的中文（数据类）清单及理由

- **订阅生成内容里的节点备注名与分组名**（如「优选-香港」「Home」分组、「🌐 全球智能」等）：属于订阅产物数据而非界面文案，改名会改变用户客户端里的既有显示与分组匹配，保留。
- **yx 输入框 placeholder 示例节点名**（「东京节点」「日本节点」「美国节点」）：示例数据文本，保留。
- **落地页 `index.html`**：纯品牌落地页，无语言机制（语言在控制台内选择），本轮未动；若要双语需单独决策。
- **连接层深层错误串**（`server.mjs` 的 worker 地址校验/超时/响应过大、preferred/optimizer 的内部错误）：主要经中文落地页流程或日志露出，不在控制台 en 界面路径上，本轮未动，单列在此供后续决定。
- **core Worker 自身的响应文案**：不在 panel 范围内，未动。
