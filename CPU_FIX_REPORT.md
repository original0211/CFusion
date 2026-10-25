# CFusion 核心 Worker CPU 优化报告（2026-10-23）

对象：`cfusion-core`（`core/_worker.js`，上游 byJoey cfnew core-only 衍生）。
纪律：最小改动、不砍功能（协议、ProxyIP 兜底、ECH、出站策略全部保留）、
core 与 `panel/test/core-fixture.mjs` 字节一致。本报告不含 UUID/口令/token。

## 1. 基线（2026-10-23 17:52 GraphQL 实测，近 24h）

| status | 调用数 | CPU p50 | 备注 |
| --- | ---: | ---: | --- |
| clientDisconnected | 13,679 | 6.78ms | 占 63% |
| scriptThrewException | 4,101 | 4.86ms | 占 19% |
| success | 3,912 | 3.48ms | |
| loadShed | 65 | — | |
| exceededResources | 46 | 51ms（p99 2,166ms） | |

合计 21,803 次调用、子请求 47,951（约 2.2×调用数）。免费版上限 10ms CPU/请求。
`exceededResources + loadShed = 111`，与站方邮件「100+ 次超限」吻合。

## 2. 热路径清单（通读 core/_worker.js 后）

**每请求（入口）**
- `Wn.fetch` 执行 `return await $n(R)(A,R,C)`：**`$n` 工厂（约 36KB 闭包、
  约 50 个函数、60 键默认配置表、14 条预置 ProxyIP 表、约 30 个 atob 错误串
  常量、256 项别名/加权表）在每个请求上全量重执行**，纯常量被反复重建、
  约 15 次 base64 解码被反复重跑。
- 配置读 `Bn` 本来就是对的：模块级 WeakMap 按 KV 绑定缓存 + 30s TTL，
  isolate 级生效——这一项查证后**未动**。
- `ie()`/`Dn()` 每请求归一化配置：其中 `Nt()` 的别名映射对象每请求重建；
  `Dn()` 每请求调 `pt()` 新建一个预算跟踪器，而 `pt()` 在构造时就
  `new Error(...)`（含堆栈捕获），大多数请求根本用不到这个错误对象。

**每连接**
- 直连竞速：`Le(..., Ze)` 以 `Ze = 2` 并行开两条连接（Promise.any，输家
  立即 close）——这解释了子请求 ≈ 2.2× 调用数。
- 失败候选链（`Hn`）：直连 → ProxyIP 池（`Oe` 打乱取样后**逐个串行**试）→
  （`wk` 开启时）经 wk 地址再试一轮 ProxyIP 池。`exceededResources` 那批
  p99 2 秒级的形态与「慢失败 × 串行重试」一致，但 GraphQL 的 CPU 分位数
  混有墙钟等待，不能把 2 秒全算作 CPU；本次**未改重试结构**（改动会改变
  连通性语义与时延权衡，且无证据表明等待期 CPU 占比高）。

**每帧/每块**
- WS 下行 `et()`：BYOB 读 64KB → `cn()` 32KB 批量发送；flush 时对缓冲做
  `subarray(...).slice()` **整份拷贝**后再 send。
- WS 上行 `dn()` → `sn()` 队列 → writer，无多余解析/日志。
- XHTTP 上行 `vn()`：每读一块都 `pe()` **新分配一块 128KiB ArrayBuffer**。
- XHTTP 头解析 `Tn()` 的 `pe()` 用法**不能**同样复用：其 `r.value` 会在被
  下一次 readAtLeast 覆写前先被 `lt()` 拼接，复用会污染尚未拷贝的数据。

**查证后排除的嫌疑**
- core 内没有 DoH/fetch 解析路径（全文只有入口 handler 一处 fetch 引用），
  主机名解析在运行时 `connect()` 内部完成，不存在每请求自建 DNS 解析。
- 热路径没有每请求正则编译；base64 重复解码集中在工厂常量（已随改动 1 处理）。

**scriptThrewException（19%）归因**
- 未定位到确定单一来源。`Wn.fetch` 的 catch 会把 handler 路径异常转成
  502 响应（计入 success 口径），故这批异常更可能发生在**响应之后的**
  流/定时器回调里（如 `cn` 的 flush 定时器与连接关闭竞态下的 send、
  下载流的错误回调）。本次不做推测性修改，列入残余问题（§7）。

**明确否决的方案：把 `$n` 工厂整体 memoize 到 isolate 级**
- 工厂闭包含可变状态：预算跟踪器 `v` 被 `Dn()` 每请求重赋值，共享后
  长连接会串用跟踪器（现网 freeCpu 为关，但该开关是用户面配置，开启时
  语义会被改变）；XHTTP 并发计数 `de` 现在是每请求计数（实际惰性），
  共享后会变成真实的全局 32 连接上限；配置对象 `M` 在 POST /api/config
  时被原地修改，共享会与在途请求产生竞态。收益不抵语义风险，否决。

## 3. 改动逐项（4 个提交，core 与 fixture 同步）

### 改动 1：纯常量表改为每 isolate 构建一次（commit b3a5d1f）
- 改前：`Ve`（预置 ProxyIP 表，含 14 次 C() base64 解码）、`F`（60 键默认
  配置）、`Nt` 的别名映射、`bn`（256 项加权长度表）随 `$n` 工厂每请求重建。
- 改后：四者经模块级缓存槽 `zzv/zzf/zzn/zzb` 惰性构建一次，isolate 内复用。
- 语义不变：`Ce()` 对 `Ve` 只读并 `.map()` 复制；`F` 只被展开（`Ht`）、
  读键与 `Object.hasOwn` 检查；`Nt` 映射与 `bn` 只被读取——四者均无任何
  写入点（已逐一 grep 核对）。

### 改动 2：`pt()` 预算 Error 惰性构造（commit 256e93c）
- 改前：每次 `pt()` 调用（工厂体一次 + 每请求 `Dn()` 一次）都构造带堆栈
  捕获的 Error 并设置 code。
- 改后：首次真正要 throw 时才构造；抛出时的 message 与
  `code = "FREE_CPU_BUDGET"` 与改前逐字一致。
- 语义不变：预算计数、阈值（384KiB / 96 块）、exhausted 闩锁与回调顺序
  均未动。

### 改动 3：`cn()` flush 去掉冗余 `.slice()`（commit 5ca926a）
- 改前：`e.send(o.subarray(0, a).slice())`，每次 flush 整份拷贝批量缓冲。
- 改后：直接 `e.send(o.subarray(0, a))`。
- 语义不变：flush 后 `o` 立即被新的 `Uint8Array` 替换、旧缓冲永不再写，
  且 `WebSocket.send()` 在调用时即捕获数据——发送的字节与改前逐字相同。

### 改动 4：`vn()` 上传环复用单块 128KiB 读缓冲（commit b001da1）
- 改前：循环每块 `t.reader.read(pe())`，每块新分配 128KiB。
- 改后：循环外分配一次 `zzq = pe()`，循环内 `read(zzq)` 复用。
- 语义不变：每块数据在 `r()` 中被 `await n.write(...)` 完全写出后才进入
  下一次 read（写失败即抛错退出循环），不存在「上一块还没落盘就被下一
  块覆写」的窗口。`Tn()` 的三处 `pe()` 按 §2 所述理由**不动**。

### 本地基准（node，同 V8 家族，仅作方向性参考，VM 噪声较大）
- 交错 A/B（同进程交替、多轮取中位数）：`/api/config` 路径 −30%、
  `/region` 路径 −28%（µs/请求量级）；hello 路径不走配置归一化，变化在
  噪声内。
- 工厂-only 探针（执行 `$n` 后直接返回）：两次运行约 523µs → 261µs。

## 4. 测试

- 全量 `npm test`（panel）：**122/122 通过**（基线 122，fixture 已同步）。
- XHTTP 数据面回归测试：曾尝试在 node 下用假 socket 驱动 `Tn`+`vn` 做
  逐字节校验，但 node 的 BYOB reader 缺 workerd 的 `readAtLeast`，且在
  polyfill 之后仍有其他 workerd 专有行为差异——**未改动的旧版 core 在
  同一 harness 下同样返回 502/0 字节**，证明是测试环境限制而非改动回归，
  故该测试未纳入套件。补充对照：freeCpu 开启 + 大块直灌场景下，新旧
  core 行为一致（同为预算在头解析阶段触发、502/0 字节）。

## 5. 部署与冒烟（2026-10-23 18:15 CST，仅 cfusion-core）

- 部署前留存字节副本（仓库 git HEAD `d809670` 即部署前版本，可随时回滚）。
- 上传后 settings 回读与部署前**逐项一致**：compatibility_date
  `2026-01-20`、bindings `c` → cfusion-kv、`u`（plain_text，比对哈希一致）。
- 冒烟：core 根路径返回 `hello`；`/<UUID>/api/config` 返回现网配置 JSON；
  面板 `/health` 正常；经面板拉取 Clash 订阅成功，含 **213 个 vless 节点**。

## 6. 复测（部署后观测窗，同一 GraphQL 口径）

部署时刻 2026-10-23 18:15:48 CST。用同一 GraphQL 口径
（workersInvocationsAdaptive、按 status 分组）拉取：

| 窗口 | 调用数 | 明细 |
| --- | ---: | --- |
| 部署前 30 分钟（17:45–18:15 CST） | 1 | success ×1（CPU p50 1.11ms、子请求 0） |
| 部署后 30 分钟（18:16–18:46 CST） | 0 | 首次查询为空（分析摄入延迟） |
| 部署后 45 分钟（18:16–19:01 CST，19:01 复查） | 1 | success ×1（CPU p50/p99 2.44ms、子请求 0），其余 status 全为 0 |

滑动 24h 窗口（截至 18:46 CST）与基线几乎重合：success 3,917（基线
3,912）、clientDisconnected 13,679（同）、scriptThrewException 4,101
（同）、exceededResources 46（同）、loadShed 65（同）。

**结论：初步。** 晚间该 Worker 的真实流量近乎为零（部署前后窗口各只有
1 次调用），生产数据不足以确认或证伪 CPU 改善幅度——不凑结论。能确认的
是：部署后窗口内**零错误、零超限**，无任何需要回滚的异常；冒烟链路
（§5）全通；本地交错 A/B 在配置类路径上测得约 −28%~−30%。建议次日用
同口径拉完整 24h 数据再对账（届时窗口内才有足量真实代理流量）。

## 7. 残余问题与建议

1. **scriptThrewException 19% 未归因**：需要 workerd 侧日志/tail 采样才能
   定位到具体回调；本次未做推测性修改。若后续能采样，建议优先看 WS
   关闭竞态与下载流错误回调两处。
2. **工厂闭包创建本身仍是固定成本的大头**：本次只消除了常量重建部分；
   彻底消除需重构上游单文件结构（把纯函数提至模块级），改动面与回归
   风险都大，不在本次范围。
3. **ProxyIP 串行重试链未动**：exceededResources 的长尾（p99 2 秒级）若
   后续仍持续，可考虑给候选链加总时限/总尝试上限——但这会改变连通性
   语义，须单独评估并经确认。
4. 观测窗若流量不足，本报告的复测结论只作「初步」；建议次日用同口径
   24h 数据再对一次账。
