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

## 八、GitHub

- 2026-10-22 上传完成：仓库 https://github.com/original0211/CFusion（public，default_branch=main）。
- 上传前安全修复：panel/src/test/registry.test.mjs 的夹具常量 UUID2 原为一个真实生成过的 UUID（已取消部署所用、从未上线），已替换为明显合成的测试 UUID 并单独提交（435e0c6）；全仓 tracked 文件复查该字符串零命中。
- 测试：修复后 panel 全量 npm test 113/113 全过，零回归。
- 推送方式：空仓先以 Contents API 放 README 种子提交，再走 Git Data API（79 blobs → tree → commit → refs/heads/main）；主提交 53bd2462（tree ba1d2795）。
- 回查验证：远程 HEAD 与 tree 哈希与推送值一致；逐层遍历远程 tree 得 79 个 blob，与本地 git ls-files 的 79 个逐个 sha 对照零差异、无缺失；README 经 Contents API 可读且 sha 与本地一致。
- 本地仓库已 git remote add origin（只加不 push）；本节为上传后在本地追加，未随本次推送上行。


## 八、真机部署（2026-10-22，未完成）

- 连接器与 helper：`custom.cloudflare` 已按 custom-connector-setup 落地，`bin/cf-api` 通过语法检查。`GET /user/tokens/verify` 成功且状态为 active，指定 account 的只读请求成功。
- KV：`cfusion-kv` 与 `cfusion-session-kv` 均已创建成功。ID 和入口信息只记在本地未提交的 `DEPLOYED.md`，本报告不记录任何密钥、UUID 或管理口令。
- 核心 Worker：`cfusion-core` 上传停在第一步。`PUT /workers/scripts/cfusion-core` 返回 HTTP 403，错误摘要为 `No access to the specified resource`。随后只读回查不到该脚本。为排除旧端点问题，又对服务内容端点做了一次同内容校验，仍返回相同 403。新建 Worker 的 beta 资源端点返回 HTTP 403 code 10000 `Authentication error`。结论是当前令牌可验证且可写 KV，但没有可用的 Workers script 写入访问。
- 子域与公开状态：计划域名为 `cfusion-core.brodydung.workers.dev` 与 `cfusion-panel.brodydung.workers.dev`。核心公开根路径返回 404，证明核心未上线。账户 workers 子域只读端点返回 HTTP 403 code 10000，未能通过 API 回读确认。
- 面板 Worker：`cfusion-panel` 未部署，未构建上传 dist，未设置 `SESSION_KV`、`w` 或 `PANEL_ADMIN_PASSWORD` secret。因为核心上传先失败，后续步骤按纪律停止。
- 真机验证：core 配置读取与保存、cfusionMeta、clash 与 sing-box 订阅、SESSION_KV 登录改配置注销、optimizer 真实优选源均未执行。WARP 节点 `cid` 与 MASQUE 节点的真实客户端导入仍未验证。
- 资源边界：本次只新建了两个 `cfusion-*` KV。未修改 `cfnext-backend`、`cfnext-panel`、`cfnext-kv-*` 或其他已有 Worker 与 KV。
- 恢复条件：给保险库中的 Cloudflare 令牌补足 Workers script 写入权限并确认没有排除新 Worker 的资源范围后，从核心 Worker multipart 上传步骤续跑，不要重复创建已有 KV。

## 九、真机部署（续，2026-10-22 完成）

- 权限复验：补权限后 `GET /accounts/{id}/workers/subdomain`（回读 subdomain=brodydung）与 `GET /workers/scripts` 均成功，前一轮的 403 已消除。
- core：multipart 上传 `cfusion-core` 成功（core/_worker.js 38,175 字节、compatibility_date=2026-01-20、bindings c→cfusion-kv + u），subdomain enabled=true，settings 回读与计划一致。公开验证：根路径 200 `hello`，`/<UUID>/api/config` 200 JSON。
- panel：dist 现场构建后 multipart 上传 `cfusion-panel` 成功（nodejs_compat、SESSION_KV、w、PANEL_ADMIN_PASSWORD secret、CORE service binding），settings 回读一致。/health 200，首页 w 模式 200 `hello`，`/<UUID>` 控制台 200（含 window.CFNEW）。
- 真机连环问题与修复（本地 wrangler 冒烟均未暴露，全部已修并提交）：
  1. `node:perf_hooks` 在真机 workerd 不存在，模块加载即 500 → preferred.mjs 改用 globalThis.performance。
  2. workerd fetch 不支持 `redirect:'error'`（undici 专有值）→ outbound-fetch.mjs 的 DoH 查询改 'manual'，靠既有 status!==200 校验保持语义。
  3. 面板 fetch 同账户 core 的 workers.dev 地址返回 error 1042（Worker 不能 fetch 同账户 workers.dev）→ 面板新增 `CORE` service binding，server 在 w 绑定目标时经绑定通道调 core（outbound-fetch 新增 serviceFetcher 分支，跳过 DNS 预检，绑定本身即信任边界）；新增单测 1 例，全量 114/114。
  4. cf-api helper 的 multipart part filename 原写 basename，导致嵌套模块 "No such module src/cf-entry.mjs" → 改为完整模块路径（与其文档描述一致）。
- 会话与防漂移实测（SESSION_KV 实绑）：无会话写配置 401；错口令登录 401；正确口令登录 200；带 session 写普通键成功，core 直读新值且 `cfusionMeta.ver=1`、changedKeys=[dkby]；注销后用旧 cookie 再写 401。防漂移版本链工作正常（验证过程共递增至 ver=4，验证后配置已恢复默认 dkby=no、optimizerAuto=no）。
- 订阅实测：clash（optimizer 关）200、42 处 vless、36,492 字节；sing-box 200、34 outbounds、rule_set 23 组、约 4.7MB。
- optimizer 真机实测：开启 optimizerAuto 后 clash 订阅 200、20 个 vless、260 处「优选」命名、约 6.7s 生成完毕——真实 wetest 源在面板 Worker（fetch 出站）上拉取成功、自动池构建成功，非 fail-open 回退（节点构成与关闭时明显不同）。P1 存疑中的「真实页面未线上比对」就此关闭。
- 部署中一次验证命令被本机服务重启打断，经核对无部分落地，按原步骤重跑完成；个别 urllib 请求出现本机出口代理的流截断，已用 curl 复测覆盖，属本机基础设施噪声非线上问题。
- 未验清单：WARP 节点 `cid` 字段与 MASQUE 节点的真实客户端（Clash/Mihomo、sing-box）导入仍未实测（无真实客户端环境）；dist 约 1.4MB 已成功上传并运行，免费版体积上限未构成问题。
- 资源边界：本次只新建 cfusion-core、cfusion-panel（KV 沿用上一轮已建的两个），未修改任何 CFNext 资源。部署参数（域名、KV id、入口）见仓库外本地文件 DEPLOYED.md，本报告不记录 UUID 与管理口令。
