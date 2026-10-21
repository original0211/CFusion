# CFusion P4 报告（本地部分：Cloudflare 适配 + 探针 + 打包物料）

范围：按 Brody 2026-10-22 的 Cloudflare-only 约束，完成路线②（单个
Worker + nodejs_compat）的本地实现、workerd 冒烟与部署物料。**未做真机
部署、未使用任何 Cloudflare 凭据、未访问真实外网**（npm 依赖未安装，
构建刻意做成零依赖，见下）。基线 104/104 → 探针后 108/108 → 入口后
**113/113 全过，零回归**。

提交：`2064d1b`（探针）、`e2c20c9`（CF 入口）、本报告与物料一并提交。

## 一、探针 A：workerd / nodejs_compat 能力实测

探针 Worker 留档于 `probes/cf-node-probe/`（含 `results.json`），配置
`nodejs_compat` + compatibility_date `2026-01-20`，用 wrangler 4.151.3
`wrangler dev --local` 实测，结果（GET / 返回 200，逐项独立）：

| 能力 | 结果 | 证据 |
| --- | --- | --- |
| `node:crypto` createHash('md5') | ✅ 可用且正确 | digest `76b37a4d…e801a95` 与 Node 本地计算一致（engine 的优选签名摘要可保留） |
| `node:crypto` createHash('sha256') | ✅ | 64 位 hex 正常 |
| `node:zlib` gunzipSync 解 panel 的 `singbox-rules.json.gz` | ✅ | 677,388 字节 gzip → JSON 解析成功，23 组 rule_set，revision `b0c55a38…` |
| `node:buffer` Buffer | ✅ | from/toString('base64')、byteLength 均正常 |
| `process.env` 读取 | ✅ | vars `CFUSION_PROBE_VALUE` 经 `process.env` 与 binding 双路读到；`process.version` 报 v22.14.0、`argv` 为 object |
| `node:http` / `node:https` 导入面 | ⚠️ 函数存在 | request/createServer/get 均为 function；`createServer().listen(127.0.0.1)` 在本地 workerd 竟未报错（返回随机端口），但这不构成可用服务器语义，本项目不依赖它 |
| `node:dns` 导入面 | ⚠️ 函数存在 | lookup/promises.lookup 均为 function |
| `node:dns/promises` lookup('localhost') | ❌ 失败 | 报错原文：`queryA ENOTFOUND localhost`。结论：workerd 里不能指望系统解析器语义；fetch 路径的域名解析改走 DoH 预检（见探针 B 取舍） |
| `node:net` isIP | ✅ | 4/6/0 返回正确 |
| `node:perf_hooks` performance.now | ✅ | function 且返回 number |

环境噪声（如实记录）：wrangler 日志多次出现 workerd 内部
`TLS handshake failed: received corrupt message of type InvalidContentType`
（探针 A 与面板冒烟都出现，伴随本机代理环境变量提示），但所有请求均
成功返回；判断为本地 wrangler/workerd 与代理环境的基础设施噪声，非
探针逻辑失败，真机部署时留意是否复现。

**探针结论对实现的取舍**：md5 与 gunzip 都可用 → engine 摘要不改、
sing-box 规则用「gzip base64 内嵌 + 运行时 gunzipSync」而不是内嵌
2.38MB 解压 JSON（部署体积更小）；DNS 系统解析不可靠 → fetch 出站用
DoH 做解析预检；node:http 即使表面可用也不用它做服务器或钉死客户端。

## 二、探针 B：fetch 版 Worker API 客户端

新增 `panel/src/outbound-fetch.mjs`（公网判定抽到 `net-utils.mjs` 与
Node 版共用，避免两套口径漂移）：

- `requestWorkerApiFetch`：发送前先解析目标域名（注入 resolver 或默认
  Cloudflare DoH），**任一解析地址非公网即拒绝**（fail-closed），响应
  体 2MiB 上限、10s 超时，与 Node 版同口径。
- **明确的防护降级**：fetch 不能指定连接 IP，校验与实际连接之间存在
  DNS rebinding/TOCTOU 窗口，防护弱于 Node 的地址钉死。模块头注释与
  本报告均明示，不宣称等价。
- `fetchPublicTextFetch` / `fetchPreferredListFetch`：同样的逐跳预检 +
  手动重定向（≤3），供优选列表与 optimizer 在 fetch 运行时使用。
- `probePreferredFetch`：**明确降级**——返回
  `{success:false, latency:-1, degraded:true, vantage:'cloudflare-fetch', error:'…优选探测已降级为不可用；未执行测速'}`，绝不伪造延迟。

验证（`src/test/outbound-fetch.test.mjs`，4 例全过）：用 node:http 把
隔离 core fixture 挂成本地服务，fetch 版完成 `/api/config`
读→写（qj=only）→回读往返；解析到 10.0.0.8 时在发起请求前被拒
（fetch 调用次数 0）；优选列表 fetch 版复用原规范化；探测降级形状
正确。

## 三、面板 Cloudflare 入口实现（路线②）

原则达成：Node/Vercel 既有路径未改行为（全量回归守护），Cloudflare
差异全部收敛到「入口注入 + 运行时开关」。

- **入口**：`panel/src/cf-entry.mjs` 提供
  `createCloudflareHandler()`：先 `prepareCloudflareRuntime(env)`——把
  字符串 binding 抄进 `process.env`、注入 `SESSION_KV`、资源与
  `__CFUSION_OUTBOUND__='fetch'`，**再动态 import server.mjs**（因其在
  模块作用域捕获 env/资源/会话存储）。响应统一加 no-store 等安全头，
  HEAD 去正文（与 Vercel 适配层同口径）。
  部署入口 `panel/cloudflare/worker.mjs`（构建时拷至 dist 根）。
- **构建**：`panel/src/tools/build-cloudflare.mjs`（`npm run
  build:cloudflare`），**只用 Node 内置能力**组装
  `panel/cloudflare/dist/`：运行时 `.mjs` 拷贝 + 生成 `cf-assets.mjs`
  （theme/landing/bridge/rulesLicense 文本内嵌、规则 gzip 的 base64，
  约 1.4MB 总量）。原因：干净检出没有 esbuild 依赖、且本期不打外网
  装包；最终模块打包交给 wrangler 自带 bundler（冒烟已验证其能处理
  本图与 `node:*` 导入）。与 build-vercel 的 esbuild 路线不同，是有意
  取舍：产物是未压缩的模块目录，wrangler 部署时再打包压缩。
- **env 衔接**：`w`、`PANEL_ADMIN_PASSWORD`、
  `PANEL_ADMIN_SESSION_TTL_HOURS`、`CFNEW_ALLOW_PRIVATE` 等在两种运行
  时同名同义；`PANEL_ADMIN_PASSWORD` 真机请用 `wrangler secret put`。
- **session 存储**：`session.mjs` 新增 `createKvSessionStore`
  （issue/verify/revoke 全 async；KV 键为 token 的 sha256，不存原文；
  过期用 KV `expirationTtl` + 值内 deadline 双保险）。server 在注入了
  `SESSION_KV` 时用 KV 版，否则内存版（Node 默认不变）；登录/状态/
  注销/写门禁的调用点已全部改 await。subCache 保持内存（60s TTL 兜
  底，DEPLOY-CF 已注明多 isolate 打折）。
- **出站分支**：server 的 `requestWorkerApi` 按 `runtime.mjs` 的
  `outboundMode()` 分发（global `__CFUSION_OUTBOUND__` 或 env
  `CFUSION_OUTBOUND=fetch`）；优选 list/probe 与 optimizer 的默认拉取
  同步分发到 fetch 变体，探测在 fetch 运行时走降级实现。
- **wrangler 配置**：`panel/cloudflare/wrangler.toml`
  （name=cfusion-panel、main=dist/worker.mjs、nodejs_compat、
  2026-01-20、SESSION_KV 绑定模板与 vars 说明）。
- 新增测试 `src/test/cloudflare-entry.test.mjs` 5 例：KV store
  签发/过期/注销与键不含原文、handler 注入顺序与 HEAD/安全头、无
  KV 时清除旧 binding、内嵌 gzip 运行时解压出 23 组规则、构建脚本
  在临时目录组装出三件套且资源真实内嵌。

## 四、本地冒烟（wrangler dev / workerd 实测）

配置放 /tmp（不入仓）：core 用仓库 `core/_worker.js` + 本地 KV 模拟
（绑定 `c`、变量 `u`=测试 UUID) 跑在 8788；panel 用 dist 产物 +
`w=http://127.0.0.1:8788`、`CFNEW_ALLOW_PRIVATE=yes` 跑在 8797。

| 步骤 | 结果 |
| --- | --- |
| core `GET /` | 200 `hello` |
| core 直读 `/<UUID>/api/config` | 200 JSON（含 P1/P2 的 optimizer*/subMode 等键） |
| panel `GET /health` | 200 `{"ok":true}` |
| panel `GET /`（w 模式） | 200 `hello` |
| panel `GET /<UUID>/api/config` | 200，经 **fetch 版客户端**从 core 读到同一配置 |
| panel `GET /<UUID>` 控制台 | 200，195,334 字节，含 `window.CFNEW` 与正确 apiBase |
| panel `POST /<UUID>/api/config` `{dkby:"yes"}` | 200 success；回 core 直读：`dkby=yes` 且 `cfusionMeta.ver=1`（P3 版本 meta 在 workerd 全链路生效） |
| panel `GET /<UUID>/sub?target=clash` | 200，Clash YAML（42 处 vless) |
| panel `GET /<UUID>/sub?target=singbox` | 200，56 outbounds、**rule_set 23**（内嵌 gzip 在 workerd 真解压） |
| panel `GET /<UUID>/sub`（base64) | 200，解码为 vless:// 链接 |
| panel `POST /api/preferred/probe` | 返回 `degraded:true` 的明确不可用结果（设计内降级，非失败） |

冒烟无一步失败。日志中的 TLS ffi 噪声见探针 A 说明。

## 五、打包物料

- [DEPLOY-CF.md](./DEPLOY-CF.md)：Cloudflare-only 手册（API 脚本与
  手动两条路、KV/变量/绑定/兼容日期、验证清单、降级说明），并明示
  与现有 CFNext 完全独立。
- `scripts/deploy-cf.mjs`：默认 dry-run 打印 12 个计划调用（已实测：
  无 env 与带 account 两种输出均正确、token 不出现）；`--apply` 缺
  token/account 时以 exit 2 拒绝（已实测）；token 只从 env
  `CLOUDFLARE_API_TOKEN` 读，不落盘不打印。apply 路径本期未真跑。

## 六、未完成 / 降级清单（真机前须知）

1. **真机部署未做**：还差 Brody 提供 ① account id（已知）+ 有效的
   Cloudflare API token（Edit Cloudflare Workers 模板，经 env 注入，
   不要贴聊天）② 一个新 UUID ③ 可选的管理口令（secret)。步骤照
   DEPLOY-CF 方式一即可，脚本已备。
2. **SESSION_KV 未在冒烟中实绑**：panel 冒烟跑的是内存 session 回退
   路径；KV store 由单测（fake KV）覆盖，真机绑定后建议补一轮
   登录→改配置→注销实测。
3. **DoH 默认解析器未实测**：冒烟里目标是 IP 字面量，未走 DoH；
   单测用注入 resolver 覆盖校验逻辑。真机首跑请重点看公共模式下
   域名 Worker 的连接错误形态。
4. **optimizer 的 fetch 拉取未对真实优选源实测**（本期不打外网纪
   律）；wetest 等源的线上格式比对仍挂在 P1 存疑里。
5. **部署体积**：dist 约 1.4MB（未压缩模块 + 规则 base64）；wrangler
   打包后的压缩体积与免费版上限的关系未在真机验证。
6. 沿袭遗留：WARP `cid` 字段与 MASQUE 的真实客户端导入（P2 存疑）
   仍需真机 + 真实客户端实测；`createServer` 在 workerd 的表面可用
   不代表 Node 宿主语义，本项目不依赖。

## 七、结论

路线②在本地 workerd 已完整跑通：面板与核心同为 Worker、session 可
KV 化、出站 fetch 化且 SSRF 降级明示、优选探测诚实降级。P4 本地部
分完成；真机部署只剩凭据与执行（DEPLOY-CF 方式一）。
