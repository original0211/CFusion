# CFusion 面板控制台 UI 重设计报告（Squarespace 极简风）

日期：2026-10-22 ｜ 提交：ab50bfa（ui: redesign console theme …）｜ 状态：已部署上线并验证

## 设计要点

- **底色与文字**：白底 `#fff`、分区浅灰 `#fafafa`、正文 `#111`、标题 `#000`、辅助文字 `#767676`；分隔一律 1px 发丝线 `#e7e7e7` / `#eaeaea`
- **字体**：无衬线栈 `-apple-system / BlinkMacSystemFont / "Segoe UI" / "Helvetica Neue" / Helvetica / Arial`；仅订阅 URL、状态读数等代码型内容保留等宽字体（ui-monospace 系）
- **布局**：内容列收窄至 880px 居中、大边距留白（容器内边距 104px/32px）；卡片去阴影、去渐变、去裁角（clip-path 全清），只留细边框 + 2px 极小圆角
- **标题体系**：主标题 30px/600、字距 -0.01em；区块标题（.card-title、状态面板首行、label 加粗态）改为小号大写 + letter-spacing 0.1–0.14em 的标签式排版
- **按钮**：扁平方角（≤2px）；主按钮黑底白字（落地页提交、悬浮保存 FAB、表单提交类）；次按钮白底黑边；危险操作只留低饱和红字（#b3261e），无大色块
- **输入框**：细边框 `#d6d6d6`、无内阴影，focus 为黑色描边（border + 1px 黑色外圈）；focus-visible 统一 2px 黑色 outline
- **状态色克制化**：成功 `#357a38`、警告 `#946f00`、错误 `#b3261e`，仅用于文字与 toast 左侧 3px 细条；toast 改白卡 + 极轻投影
- **装饰全清**：网格背景、扫描线、矩阵雨、霓虹光晕、标题闪烁、FAB 呼吸/脉冲动画、按钮扫光全部移除；`body.fx-off`（特效开关）的 JS 机制保留，语义变为「关动画」

## 改动范围

只改一个文件：`panel/src/theme.css`（490 行增 / 580 行删，整表重写）。

结构事实（动手前已摸清）：

- 控制台 HTML 由 `panel/src/engine.mjs` 的 `engine.render()` 生成，`server.mjs` 在 `<head>` 后注入 `theme.css`（+bridge 脚本）；落地页 `index.html` 同样注入同一份 theme.css——**全站只有一个视觉层文件**，不存在第二份控制台模板拷贝需要同步（P2 的三处同步点是注册表 JS 逻辑，与样式无关）
- engine 生成的标记带有大量上游内联样式（霓虹色、深色半透明底、光晕阴影、Courier 字体）。新主题沿用上游既定的覆盖架构：全局元素规则 + **属性选择器映射**（`[style*="color: #00f0ff"]` 等）把每种旧色值映射到新色板，`!important` 压过非 important 内联样式；JS 动态改色的状态读数由 id 规则兜底
- bridge.js 注入的三条栏（管理员会话 `#adminSessionBar`、配置版本 `#cfusionMetaBar`、Worker 注册表 `#workerRegistry`）此前只有内联布局、无主题规则，本次补了同体系的极简样式（880px 列宽、底发丝线）；内核更新提示 `#coreVersionStatus` 同步换新
- 防漂移确认走原生 `window.confirm`，无样式面；引擎通过 `setProperty('--cp-toast-dur', …)` 传 toast 时长，该自定义属性名是 JS 契约，新主题保留引用

硬约束执行情况：所有元素 id、JS 逻辑、文案、i18n 零变化（git diff 仅 theme.css 一个文件）；上一轮缓存口径未动（线上控制台仍 `Cache-Control: private, max-age=300`）。

## 验证

- **测试**：`npm test` 122/122 全过（基线 122，无增减）。无测试断言旧主题字符串，未改任何测试
- **本地渲染**：用 test/core-fixture 起本地 core + 面板实测：落地页 200、控制台 200（190KB）；渲染 HTML 结构核查通过——注入的 `<style>` 即新主题（`--sq-*` 变量在位、旧 `--cp-*` 色板消失），关键区块钩子齐全：`#configCard`、`#advancedConfigForm`、`#cpActionBar`、`#cpBtnSaveAll`、`#cpToastStack`、`#systemStatus`、`#clientSubscriptionUrl`、`.client-grid`、`#jk`、`#jkSource`、`#languageSelector`
- **截图未完成（如实说明）**：本机 `/opt/meta-chromium/chrome` 无头模式在本 VM 内无法完成页面加载（new/old headless、--single-process 均超时，zygote/组件更新报错），多次尝试后放弃，改用上述 HTML 结构核查代替；`ui-redesign-after.png` 未生成
- **部署**：只动 panel。`npm run build:cloudflare` 重新构建 dist，cf-api multipart 上传 `cfusion-panel`；上传前后 settings 回读对比：compatibility_date `2026-01-20`、flags `nodejs_compat`、四项 bindings（CORE service、PANEL_ADMIN_PASSWORD secret_text、SESSION_KV、w plain_text）**逐项一致**
- **线上确认**：`/health` 返回 `{"ok":true}`；面板根 200；`/<UUID>` 控制台 200 且响应头 `Cache-Control: private, max-age=300`，HTML 内新主题在位、关键钩子齐全

## 未覆盖的边角（如实列）

- WARP/MASQUE 等模式字段（subMode/warpConf 等）在控制台由运行时按字段注册表生成，本次结构核查的服务端 HTML 里只有配置 JSON、未见其静态标记；其样式由全局 input/select/label 规则覆盖，未单独截图核对
- 管理员登录条与注册表切换条只做了 CSS 规则补充与结构核查，未在线上带口令实操走一遍登录/切换流程（逻辑零改动，风险低）
- 控制台首屏的 HUD（右上角系统信息）与语言选择器保留 fixed 定位（与旧版一致），仅换样式未改布局机制
- 无头浏览器截图缺失（见上），视觉细节以结构核查 + 色板映射表为准，建议用户在真实浏览器打开控制台扫一眼确认观感
