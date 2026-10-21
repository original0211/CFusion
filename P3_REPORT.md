# P3 报告（2026-10-22）：安全加固

提交：`dc259ee` P3-1、`6d5555b` P3-2、`3b12344` P3-3、`267ff3e` P3-4（本报告另行提交）。
全量测试 **104/104 通过**（P2 基线 87 → P3-1 后 94 → P3-2 后 97 → P3-3 后 101 → P3-4 后 104），零回归——两处例外见 P3-2「与既有测试的关系」。全部本地 fixture，无真实外网请求。

背景：CFNext 曾发生后端 `config.mode` 被外部反复切换（worker→warp→masque），订阅静默变质（VLESS 消失）而无人察觉。P3 的目标是让这类变更在 CFusion 里不可能静默发生，并补齐面板侧的会话与缓存安全。

## P3-1 面板管理会话 ✅

- 新增 `panel/src/session.mjs`（纯逻辑）：口令校验（sha256 定长后 `timingSafeEqual` 常量时间比较）、session 签发/校验/注销（crypto 随机 32 字节 token、服务端内存 Map、惰性过期）、cookie 序列化/解析、登录失败节流。
- 配置方式：面板 env `PANEL_ADMIN_PASSWORD`（不进 Worker 配置体系）；TTL 由 `PANEL_ADMIN_SESSION_TTL_HOURS` 调，默认 24h。接口：`GET /api/admin/status`、`POST /api/admin/login`、`POST /api/admin/logout`（cookie 名 `cfusion_admin`，HttpOnly + SameSite=Lax，面板 URL 为 https 时加 Secure）。
- 门禁点：`handleWorkerApi` 内一切非 GET 请求（配置保存、优选增删改、模式切换都经此路）无有效会话 → 401。读路径与订阅生成不拦（订阅客户端没有 cookie 场景，不能断）。控制台 bridge.js 增加登录条（仅口令启用时渲染）。
- 登录节流：全局连续失败 10 次锁定 5 分钟（429）。无可靠客户端 IP（多层代理后），只做全局节流——挡在线爆破，代价是锁定窗口内合法登录也被拒。
- 向后兼容：未设口令时门禁整体放行、登录条不渲染，行为与上游一致（回归测试覆盖）；README 已注明此时「UUID 即全权凭据」的风险。
- 借鉴 CFNext-Plus 的关键点：token 服务端随机，**不用**密码的确定性哈希充当（哈希可离线爆破且长期有效）。
- 新增 `src/test/session.test.mjs` 7 例：store 签发/过期/注销、口令校验语义、cookie 往返、节流、无会话写 401 而读与订阅正常、登录→写→注销全流、未设口令放行。

## P3-2 配置变更防漂移 ✅

- **版本 meta 承载（取舍）**：给内核字段表 F 新增一个允许键 `cfusionMeta`（字符串，默认 `""`），meta JSON（`{ver, hash, changedKeys, ts}`）随 Worker 配置一同存 KV——沿 P2-3 先例同步改 `core/_worker.js` 与 `panel/test/core-fixture.mjs`（仍字节一致，core 38,160 → **38,175 字节**，+15），engine 默认值同步加 `cfusionMeta: ''`。未采用「面板侧另存」方案：meta 必须与配置本体同生共死，另存会漂移。
- **hash 口径**：对内核回传的保存后有效配置（剔除 `cfusionMeta` 本身、键排序后的规范化 JSON）做 sha256。
- **写入方式（取舍）**：两段保存——先转用户保存，成功且确有变更时面板再追加一次只含 `cfusionMeta` 的小保存。best-effort：meta 写失败不回滚、不改用户保存结果，下一次成功保存自动补上（版本递增以保存前读到的 meta 为基准）。非原子是已知代价，见存疑 3。
- **关键键确认**：关键集 = `subMode, ev, et, ex, s, p, qj, warpConf, masqueConf`（任务书口径；`u` 是 env/内核侧凭据、不经此接口，不在集内）。保存时面板读当前有效配置做 diff（`''/null` 按内核语义视为删除→回落 engine 默认值）；关键键有变更且未确认 → **409** `{needConfirm, changedKeys, criticalChanged, diff}`，**不转发、配置不动**。确认方式：请求体 `confirmCritical: true` 或请求头 `x-cfusion-confirm-critical: true`；这两个面板专用字段与客户端提交的 `cfusionMeta` 一律在转发前剥离（防伪造版本）。diff 中凭据类键（`warpConf/masqueConf/s`）只显示「已设置/未设置」，不回显原文。控制台 bridge.js 拦截 409 弹确认框并自动带标志重提；控制台顶部展示当前版本/上次变更（读 `cfusionMeta`）。
- **guard 的边界（取舍）**：diff 依赖能读到当前配置；Worker 故障读不到时跳过 guard 并恢复原始请求走上游原有错误路径——否则 Worker 返回 HTML 故障页时的状态码/消息语义会被防漂移逻辑改写（有现成用例守护这条语义）。健康 Worker 上 guard 恒生效。
- **与既有测试的关系（两处，如实记录）**：
  1. P2-3 的 `config-persistence.test.mjs` 两处保存 `subMode` 的用例按新语义补了 `confirmCritical: true`（用例验证目标「新键可持久化」不变，已在文件内注明）。这是有意的语义变更，不是绕过：subMode 正是任务书点名的关键键。
  2. 初版关键集曾含 `d/freeCpu/customDNS/customECHDomain`，与上游两处「改入口」用例冲突后收窄到任务书口径——`d` 等是否纳入留作存疑 1 待 Brody 定，未为迁就测试放宽任务书点名键。
- 新增 `src/test/config-guard.test.mjs` 3 例：普通键直通 + meta ver/hash/changedKeys 正确且递增；关键键无确认 409 且配置与 meta 均未动、凭据 diff 脱敏、带确认成功 ver+1 且 `confirmCritical` 不落配置；关键键删除（回落默认）同样要确认、请求头确认亦可。

## P3-3 订阅缓存 LRU ✅

- 调查结论：panel 此前**没有**订阅响应缓存（只有配置快照 `recentConfig` 与 optimizer 的池缓存），故新增强制实现。
- 新增 `panel/src/subcache.mjs`（移植 CFNext-Plus 口径）：键 = Worker host + uuid + target + 方法 + User-Agent 的归一化组合——**其余查询参数全部忽略**（`?x=随机`、时间戳不再击穿）；LRU 32 条（命中刷新热度、溢出淘汰最久未用）；TTL 60s；仅缓存 200 响应（存状态/内容类型/正文）。
- 接入：`handlePanel` 订阅分支生成前查缓存（命中跳过 optimizer 与 engine 生成）；`handleWorkerApi` 任一写操作成功即 `invalidateWorker(host, uuid)` 失效该 Worker 全部条目。与 Plus 口径的差异：Plus 按 UA 类别归键，本实现按 UA 原文——更细（条目更多）但零误共享，对 32 条上限无压力。
- 新增 `src/test/subcache.test.mjs` 4 例：键维度、LRU 淘汰与热度刷新、TTL 与按 Worker 失效、集成（直接改 KV 后加随机参数仍命中旧订阅；经面板保存后失效并出新订阅）。

## P3-4 fail-closed 复查 ✅

逐路径复查结论（位置 → 原行为 → 处置）：

| # | 路径 | 结论 |
| --- | --- | --- |
| 1 | optimizer 拉取（`optimizer.mjs` fetchText） | **已修**：原走全局 fetch，无公网校验/地址钉死，`optimizerSourceURL` 可指向内网/云元数据（SSRF），与 preferred 路径的防护不一致。现默认拉取改走 preferred.mjs 新增的 `fetchPublicText`（解析钉死 + 每跳重校验 + 重定向上限）；注入 fetchImpl 的测试路径不变。代价：内网自建优选列表源同样被拒，与优选列表路径既有口径一致。新增 `fail-closed.test.mjs` 2 例（环回/链路本地/localhost/file 协议拒绝；optimizer 内网源被拒且 fail-open 到兜底） |
| 2 | `loadWorkerConfig` JSON 解析失败 | **已修（小）**：原样抛 SyntaxError 原文进错误消息；现收敛为「该地址没有兼容的配置接口」（与紧随其后的形状校验同口径）。config-guard.test 增 1 例 |
| 3 | `allowedWorker`/`selectWorker`（w 绑定） | 上游已对：w 无效 503、非绑定 Worker 403 且不访问上游（access/worker-policy 用例守护），未动 |
| 4 | `handleWorkerApi` 转发 | 上游已对：Worker 返回非 JSON → `{success:false}` 并保留状态/502；错误状态不被吞，未动 |
| 5 | `requestWorkerApi` | 上游已对：DNS 钉死、全部解析地址须公网、响应 2MiB 上限、10s 超时，未动 |
| 6 | `authorizePreferred` | 上游已对：加载失败删缓存并抛错，未动 |
| 7 | `fetchPreferredList`/`probePreferred` | 上游已对：每跳重新解析校验、地址钉死、端口白名单、须回 `hello`，未动 |
| 8 | `resolveOptimizerYx` fail-open | **按设计保留**：拉取失败回退「上次好池 → 操作者手填列表 → 原配置」，兜底内容均为操作者自有配置而非第三方数据，属可用性取舍（P1 已定），未动 |
| 9 | modes 凭据缺失 | P2 已 fail-closed（不输出模式节点），未动 |
| 10 | `/api/preferred/list`、`/probe` | **记录不改**：仅凭 UUID 知识即可调用（authorizePreferred 只校验能读到该 Worker 配置），设了管理口令后亦然。二者不改任何状态，属上游既定语义；是否加会话门禁列存疑 2 待定 |
| 11 | 订阅/页面错误出口 | 上游已对：订阅失败 503 不出残品、页面错误消息转义，未动 |
| 12 | 引擎生成页内的上游远程配置 URL | 范围外记录：engine 渲染的控制台页含上游 `远程配置网址`（客户端侧引用，属内核页模板的上游设计），非面板服务端路径，本期未动 |

## 设计取舍汇总

- **meta 承载**：内核字段表新增 `cfusionMeta` 单键（+15 字节）而非面板侧另存——版本必须与配置同生命周期。
- **session 存储边界**：进程内存 Map（惰性过期、无外部依赖）。**对 P4 的影响**：Cloudflare Workers（P1 评估路线②）的 isolate 内存不跨请求保证，会话会频繁失效——P4 落地时需把 session store 换成 KV 存储（TTL 可直接用 KV expiration）或改签名 token；`session.mjs` 已按 store 接口隔离，替换面仅一处。`subCache` 同为进程内存，多实例下命中率下降、失效不跨实例传播，陈旧窗口由 60s TTL 兜底，P4 一并评估。
- **两次保存写 meta**：换取「hash 基于内核回传的真实有效配置」，代价是非原子（见存疑 3）。

## 存疑清单

1. **关键集是否扩到 `d/freeCpu/customDNS/customECHDomain`**：`d`（改入口）改错会锁死旧入口、性质接近关键键，但它是上游控制台的一级功能且有现成互通用例。本期按任务书最小集执行，扩集与否请 Brody 定。
2. **`/api/preferred/*` 是否要管理会话门禁**：现仅凭 UUID 可用（非写操作）。若 Brody 认为优选探测/拉取也属敏感操作，可在 P4 一并加门禁。
3. **meta 非原子**：用户保存成功与 meta 写入之间若面板崩溃，版本会少记一轮（hash/changedKeys 滞后），下一次保存自愈。若要强一致需内核提供单请求内写 meta 的支持，改动面大，暂不做。
4. **P4 会话/缓存的分布式形态**：见「设计取舍汇总」——P4 动手前先定 session store 的 KV 化方案。
5. **凭据 diff 只报已设/未设**：无法从 409 响应核对 warpConf 具体改了什么（安全取舍）；操作者需自查提交内容。
6. **登录节流为全局**：锁定 5 分钟内合法登录同样被拒；若日后有可靠的客户端 IP 来源（如固定在 Cloudflare 后），可改按 IP 节流。
