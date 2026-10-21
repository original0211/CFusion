# P1 优选引擎移植报告（2026-10-22）

## 完成内容

新增 `panel/src/optimizer.mjs`（约 330 行），把 CFNext 的优选引擎逻辑移植到面板侧，并以最小侵入方式接入现有订阅流程。移植对象均从 `~/workspace/cfnext-plus/CFNext-明文版.js` 实读定位，未凭名称臆造：

| CFNext 原逻辑 | 位置（明文版字符偏移） | CFusion 实现 |
| --- | --- | --- |
| 源注册表 `N`（wetest_v4/v6、hostmonit、wetest_cname、bestcf) | ~19173 | `OPTIMIZER_SOURCES`（URL 逐字一致） |
| 候选解析 `Kt` / `ot` | ~30370 / ~61300 | `parseCandidateText` / `parseEntryList` |
| CF 地址段校验 `v`（常量 u/h 地址段） | ~5055 / ~5645 | `isCloudflareIp` + `CF_V4_CIDRS` / `CF_V6_CIDRS` |
| 候选构建 `Jt`（预设源→自定义源→去重→兜底→CIDR 补量，stats) | ~61667 | `buildCandidatePool`（含 10 分钟池缓存，对应原版 Wt/We 缓存） |
| 兜底地区池 `Ve`（常量 U:bestcf random-region) | ~10300 / ~118559 | `FALLBACK_LISTS` |
| CIDR 随机采样 `at` | ~30206 | `randomCloudflareIps`（简化实现） |
| 筛选 `ge`（ue/fe 别名、空结果逐级放宽） | ~76946 | `filterEntries` + `REGION_ALIASES` / `ISP_ALIASES` |
| `BESTIP_AUTO` / candidates 接口对 Jt 的消费方式 | ~330767 / ~333465 | 高层入口 `resolveOptimizerYx`（订阅时构建池） |

未移植：延迟测速 `Xt` 与域名解析 `ie` —— 原版依赖 Worker 的 `cloudflare:sockets` 直连测速，面板侧已有等价的 HTTP 探测（preferred.mjs 的 `probePreferred`），不重复实现。

## 接入点（最小侵入）

1. **engine.mjs 仅注册配置**（3 处定点编辑）:`配置默认值` 增加 11 个 `optimizer*` 键；开关归一化列表增加 `optimizerAuto/optimizerCustomPref/optimizerUseCidr`；环境变量别名表增加对应大写别名。生成逻辑零改动。
2. **server.mjs 一处调用**：`handlePanel` 在订阅请求（`subscription===true`）时，先 `loadWorkerConfig` 拿到有效配置，再 `resolveOptimizerYx(config)`；返回非空文本时以 `{...config, yx: 池文本}` 构造引擎。页面渲染、配置读写、优选服务接口全部走原配置原流程。
3. **池文本即 cfnew 原生 yx 格式**（`地址：端口#备注`，IPv6 加方括号），由引擎自己的 `更新自定义优选来源值()` 解析消费，无格式转换层。

语义映射：`optimizerAuto=yes` + `optimizerCustomPref=no` → 每次订阅构建时自动重建池（对应 CFNext `customPref=false`);`optimizerCustomPref=yes` → 只用已保存手填 `yx`（仍过筛选与上限）。配置优先级与面板一致：KV > env > 默认。

## 与 CFNext 的行为对照

| 维度 | CFNext（原版） | CFusion P1 | 一致性 |
| --- | --- | --- | --- |
| 候选源 | N 注册表 5 源 + sourceURL 自定义（≤50) | 同左（同一注册表与上限） | ✅ |
| 预设模式地址校验 | `a()`:custom 模式外必须过 `v()` CF 段校验 | 同左（域名条目在预设模式同样被滤，见存疑 1) | ✅ |
| 解析 | Kt：结构化条目优先，全文裸 IP 补漏，去重 | 同左 | ✅ |
| 补量顺序 | bestcf 兜底 Ve → CIDR 采样 at | 同左 | ✅ |
| 筛选 | ge：备注名别名匹配 + 空结果逐级放宽（isp→全部、ipType→双栈、地区→all) | 同左；仅一处适配：池阶段先给无名条目补 `优选IP-NNN` 默认名（原版是在已命名节点上筛选），见存疑 3 | ⚠️ 有意适配 |
| 节点上限 | `nodeLimitCount` 在最终节点生成处钳制（min（值，1000)，默认上限 10000) | `optimizerLimit` 在池条目处截断（默认 300，钳制 1–1000) | ⚠️ 位置不同：池截断后引擎还会叠加其内置来源节点，总节点数不严格等于上限 |
| 目标条数 | optimizer.count 默认 20（Jt 补量目标） | `optimizerCount` 默认 20，同义 | ✅ |
| 测速优选 | BESTIP_AUTO 定时测速选最快（Worker sockets) | 未移植（面板已有 probePreferred 按需探测） | ❌ 缺口，P2+ 可议 |
| fail-open | Jt 内部 try/catch 返回部分结果；ge 筛空逐级放宽 | 拉取失败回退上次成功池 → 手填 yx → 返回 null 走原流程；全程不抛错 | ✅（更保守） |

## 同参数对照测算（fixture 实测，非外网）

同一份假 wetest 页面（6 条结构化 + 2 个裸 IP，含非 CF 地址）喂两边等价逻辑：

- Kt 等价解析：7 条唯一候选（104.16.10.1 / 104.17.20.2 / 172.67.30.3 / 8.8.8.8 / 2606:4700::1111 / 104.18.40.4 / 2001:4860::8888）
- 预设模式 CF 段校验后保留 5 条（8.8.8.8 与 2001:4860::8888 被滤）
- `count=20, useCidr=yes` 时补量 15 条 CIDR → 池 20 条（stats: preset=7, cidr=15, bestcf=0——假 fetch 对兜底 URL 返回了同一页面、无纯 IP 行可收）
- 以 Brody 现行 CFNext 参数等价配置（region=all、isp 全开、ipType 双栈、limit=300）经 `resolveOptimizerYx` 输出 **20 行**池文本，格式逐行通过引擎 yx 条目正则校验。
- 结论：同参数下 CFusion 的优选池条目数 = optimizerCount 目标（20），与 CFNext 中 Jt 的 candidates 目标一致；最终订阅总节点数两边都还会叠加各自的内置/原生条目，不做逐条等同断言。

## 测试结果

- 新增 `panel/src/test/optimizer.test.mjs`：10 个用例，覆盖 isCloudflareIp、解析/补漏/去重、isp/region/ipType 筛选与放宽级联、预设模式 CF 校验、custom 模式、拉取失败 CIDR 补量、customPref 截断、输出格式、fail-open 回退。全部使用本地 fixture 与假 fetch，**无真实外网请求**。
- 全量：**tests 65 / pass 65 / fail 0**（P0 基线 55 + 新增 10），上游 55 个用例在 engine 配置注册改动后无一回归。
- 首轮曾有 4 个新用例失败（fixture 形态、固定 rng 采样碰撞、模块缓存串扰、无名条目筛选语义），均已定位并修正，其中无名条目一项促成了上文「补默认名」的适配（已在代码注释与本报告标注）。

## 存疑清单（读不准/未验证，不编造）

1. **wetest_cname 在 Jt 路径的实际产出**：`a()` 的 CF 段校验会滤掉纯域名条目，Kt 的全文扫描也只提 IP——原版 candidates 接口下 cname 源可能只收录页面中出现的 IP，域名解析疑似在 `ie()` 另一条路径完成。P1 按代码字面移植，未做外网实测验证。
2. **optimizer* 配置的持久化**：内核（core）的配置保存接口按其自身字段表（32 项）过滤，面板 UI 保存配置时可能不保留 `optimizer*` 键。当前可靠设置方式：面板环境变量，或直接写 Worker KV。UI 表单与内核字段扩展留待 P2/P3 一并处理。
3. **筛选的无名条目适配**：原版 `ge()` 在已命名节点上工作（无名直接判掉）；P1 在池阶段筛选，先补 `优选IP-NNN` 默认名再套同一语义。这是为保持 fail-open 的有意适配，不是原版行为复刻。
4. **at() 采样分布**：原版 `at(u, n)` 的采样权重/去重细节未逐字复刻，P1 为均匀随机采样；只影响兜底补量条目的构成，不影响筛选与上限语义。
5. **wetest 页面真实结构**：fixture 按 Kt/ot 可解析的形态构造（结构化行 + 裸 IP）；真实 wetest_v4 页面为 HTML 表格，其条目在原版同样主要靠裸 IP 扫描命中、备注多为空——与 P1 行为一致，但未做线上抓取比对（本期纪律：不打真实外网做测试）。

## Cloudflare-only 部署适配评估（2026-10-22 新增约束：将来只部署 Cloudflare，不用 Vercel；本节只评估不实现）

### 面板现状的运行时假设（实读代码）

- **入口形态友好**:`handlePanel(request) → Response` 本就是 Fetch 形态；`src/api/index.mjs` 的 Vercel 适配层（限流读 body 后转交 handlePanel）证明核心与宿主解耦良好。
- **Node 专属依赖集中在 3 个接缝**：
  1. 静态资源加载：server.mjs 顶层 `readFile` 读 theme.css / index.html / bridge.js / singbox 规则说明；singbox.mjs 用 `readFileSync + gunzipSync` 读 `singbox-rules.json.gz`。Workers 无文件系统。
  2. 出站 HTTP 客户端：server.mjs 的 `requestWorkerApi` 与 preferred.mjs 的 `readPublic/probePreferred` 用 node:http/https + `dns.lookup` **IP 钉死**（校验公网地址后按 IP 直连、保留 Host/SNI 语义）防 DNS rebinding/SSRF。Workers 的 fetch 不提供 lookup 覆盖与 IP 钉死；nodejs_compat 的 http 客户端支持也不完整（createServer 不可用，request 的 lookup/agent 选项基本被忽略）。
  3. 宿主外壳：`createHttpServer` 监听（server.mjs 末尾 `process.env.VERCEL` 分支）与 `process.env`（w 绑定、PORT 等）。Workers 入口是 `export default { fetch }`，配置走 env bindings。
- **其余基本可移植**:engine.mjs 仅依赖 `node:crypto` 的 createHash('md5')（摘要用途，nodejs_compat 可用；WebCrypto 不支持 MD5，需保留 node:crypto 或改摘要算法——该摘要用于请求 uouin 优选接口的签名，改算法会改变协议，不能随意替换）与 `node:net` isIP（nodejs_compat 支持）；内存 Map 缓存（recentConfig/preferredAuth/optimizer 池缓存）在 Workers 是单 isolate 易失状态，语义降级为「尽力缓存」，可接受，必要时下沉 KV；无定时器依赖（池刷新由请求触发 + 10 分钟内存缓存，与 CFNext BESTIP_AUTO 的定时模式不同，Workers 若要定时需另加 Cron Trigger，不在本评估范围）。

### 候选路线

| 路线 | 改造点 | 主要风险 |
| --- | --- | --- |
| ① Cloudflare Pages + Functions | 把 handlePanel 挂到 Pages Functions（`_worker.js` 或 functions/ 路由）；静态资源走 Pages 静态托管（landing 页天然契合）；wrangler.toml 配置 nodejs_compat | 与②共用同一运行时，改造量不比②少；Pages 的路由/域名与现有「面板域名/UUID」路径模型需逐条映射验证；控制台页是 engine 动态 render 的整页 HTML，静态托管帮不上忙，收益仅 landing 与规则文件 |
| ② 单个 Worker + nodejs_compat | 新增 fetch 入口复用 handlePanel（照 api/index.mjs 适配模式）；资源文件改构建期文本内嵌（现有 build-vercel 的 esbuild 流程已有「改写资源 URL」的先例可借鉴，改打 Workers 包）；3 个 Node 接缝逐个换：readFile→内嵌文本、node:http 钉死请求→fetch 重写、createServer 外壳→删除 | **IP 钉死丢失是最大风险**：requestWorkerApi/preferred 的 SSRF 防护建立在「先校验解析地址再按 IP 连接」上，改 fetch 后只能靠 URL 层校验 + Workers 平台自身的解析，防护模型变化需重新论证（尤其公共模式下用户可填任意 Worker 域名）；probePreferred 的「按被测 IP 直连 Worker 域名测延迟」模型在 fetch 下无法等价实现（fetch 不能指定目标 IP），优选探测功能要么降级为域名级探测，要么保留一个 Node 宿主专供探测 |
| ③ Pages 静态托管 + 独立 panel Worker | landing/静态文件放 Pages，动态部分还是②的 Worker | 本质是①+②拼接，多一层域名与路由协调（订阅路径、apiBase 的同源假设要重验），收益（静态分发）对这个低流量自用面板可忽略，复杂度最高 |

### 推荐

**路线②（单个 Worker + nodejs_compat）**：动态部分本来就绕不开 Workers 运行时，②的改造面最集中——一个 fetch 入口 + 资源内嵌 + 两个出站客户端重写，且与 P1 的 optimizer（纯计算 + fetch，已按可注入 fetchImpl 写）天然兼容。①可作为②完成后的可选打包形态（同一份代码、Pages Functions 入口），不必现在二选一锁死。排期建议放在 P4（与发布一起做），动手前先做两个探针验证：(a) nodejs_compat 下 createHash('md5') 与 gunzipSync 的可用性；(b) fetch 版 requestWorkerApi 对目标 Worker /api/config 的连通与错误形态。probePreferred 的 IP 直连探测如确认无法等价，宁可明确降级并在 UI 标注，不做假实现。
