# P2 报告（2026-10-22）：模式与多 Worker 管理

提交：`e4b4eb2` P2-1、`1d77302` P2-2、`2fbc774` P2-3。全量测试 **87/87 通过**（P1 基线 65 → P2-1 后 78 → P2-2 后 84 → P2-3 后 87），零回归。全部本地 fixture / 假凭据，无真实外网请求。

## P2-1 WARP/MASQUE 订阅模式 ✅

### CFNext 语义（实读 `CFNext-明文版.js` 定位）
- 中间结构 `{name, host, port, local:[v4,v6], k, p, cid}`（源码注释亦如此标注）。
- `_wgNodes(cred, cfg, name, mode)`：端点来自 `warpEps`/`masqueEps`（按 `\n,;` 切分），为空用内置表 `_WGEP`（100 条 162.159.192/193/195/204 与 188.114.96–99 段、:2408）/ `_MSEP`（28 条 162.159.198/199.2 与 2606:4700:103/104::2、多端口），截断 50；命名 `名称 + (多于1个时 '·'+序号)`，默认名 `WARP`，`warpName`/`masqueName` 可改；端口 `端点端口 || 凭据 pt`；masque 额外 `mg=1`、`sni=masqueSni||www.microsoft.com`、可选 `msnet=masqueNet`。
- 凭据：优先读已存 `warpConf` JSON（需 `k,p,a4`）/ `masqueConf` JSON（需 `mk,k,p`）；缺失时**自动注册**——本地生成 X25519（WARP）/ ECDSA P-256 SEC1（MASQUE）密钥对，向 Cloudflare 客户端注册接口 POST 换取配置（peer 公钥、接口地址、client_id），回写 KV。
- 渲染：clash 里 type 为 `wireguard` / `masque`（masque 带 sni、uri=https://cloudflareaccess.com、congestion-controller=bbr、ip 带 /32、network=msnet；warp 带 cid）；sing-box 只收 warp（wireguard outbound 形态）；链接类只给 warp 生成 `wireguard://私钥@host:port/?publickey=&address=&reserved=&mtu=1280#名`；surge/loon/quanx 不注入。
- **模式隔离**：CFNext 在 mode=warp/masque 时订阅只输出模式节点（普通节点被隔离，且 masque 仅允许 clash 格式）。

### CFusion 实现（有意差异已标注）
- 新增 `panel/src/modes.mjs`：端点表逐字移植（_WGEP 100 / _MSEP 28），`parseModeEndpoint`、`parseModeCred`、`buildModeNodes`、`wireguardShareLine`，以及按格式分发的并入器 `mergeClashYaml` / `mergeSingboxJson` / `mergeLinkSubscription` / `mergeModeSubscription`。
- 配置键：`subMode`（worker|warp|masque，默认 worker）+ `warpConf/warpEps/warpName/masqueConf/masqueEps/masqueName/masqueSni/masqueNet`，注册进 engine 默认值与 env 别名两处（非开关型键，不进开关归一化列表——P1 的「3 处」中开关一处不适用）。
- 接入点：`server.mjs` 订阅分支在 engine 出订阅后按 target 家族并入：clash 家族追加 proxies 条目并把名字并入「🚀 节点选择」「♻️ 自动选择」两组；sing-box 以 **endpoint** 形态并入（sing-box ≥1.12 的 WireGuard 正确形态，CFNext 用的是旧式 outbound 形态，此为有意现代化）并挂入 urltest 与全部 selector 的引用；base64 家族解码追加分享行后重编码；surge/loon/quanx/vg 不并入（与 CFNext 一致）。
- **差异 1（凭据）**：不实现自动注册（依赖向 Cloudflare 客户端接口注册账号这一外部流程，且会产生账户级副作用）。凭据只接受用户提供的 CFNext 同格式 `warpConf`/`masqueConf` JSON；缺失/不完整/格式坏 → fail-closed，零模式节点输出，其余订阅内容不受影响。
- **差异 2（隔离 vs 并入）**：按 P2 任务口径采用「并入」——模式节点与 worker 节点并存于同一订阅，而非 CFNext 的隔离输出。
- worker 模式零影响：`buildModeNodes` 返回空、`mergeModeSubscription` 返回 null、server 直接回原响应；既有 subscriptions.test 的输出哈希用例继续全过。
- 新增 `src/test/modes.test.mjs` 13 个用例：端点解析、reserved 校验、默认 50 节点/命名/字段、自定义端点与名称、凭据 fail-closed、masque 标记与 SNI、分享行格式、base64/clash/singbox 并入与幂等、surge 家族不并入。

## P2-2 多 Worker 管理 ✅

### 存储层选择：浏览器 localStorage（沿用上游键 `cfnew-panel-nodes`）
三层边界实读结论：
- **env**：部署期静态值，面板进程级单例（`w` 已占用为单绑定语义）；注册表是操作者运行时数据，放 env 等于改注册表要重部署，排除。
- **Worker KV（经 /api/config）**：每个 Worker 一份、且是「该 Worker 自己的运行配置」；注册表必须在选中任何 Worker 之前就可用，且不能把 A 的凭据写进 B 的 KV，排除。
- **localStorage**：上游已有「记住节点」机制（同一键、{host, uuid}、上限 20），本就是为多节点切换准备的，选中。
数据模型升级为 `[{name, host, uuid}]`（旧条目无 name 时自动兼容），去重从上游的「同 host」改为「host+uuid 双键」（同域多 UUID 不再互相覆盖，此为有意行为变更）。UUID 只存本机浏览器、不进任何日志，展示走 `maskAccessId`（UUID 露前 8 位、自定义路径整体打码）。

### 功能
- `panel/src/registry.mjs`：纯逻辑（归一化/容错解析/序列化/upsert 置顶/remove/查找/展示名/掩码），供单测直接覆盖；浏览器侧 index.html 与 bridge.js 内联实现同一语义（静态文件无法 import 模块，两边以同一键与模型对齐，测试对两侧都做了断言）。
- 首页（landing）：新增可选「名称」输入；下拉以名称（或域名）展示注册表，选中回填表单，删除逻辑沿用并同步名称字段。
- 控制台（bridge.js）：新增注册表切换条——下拉切换直接跳 `/panel?host&uuid`；当前 Worker 未注册时提供「记住当前 Worker」；**w 单绑定模式（CFNEW.panelPath 存在）下整体不渲染**，且服务端本来就对非绑定 Worker 返回 403，双保险。
- 各 Worker 的配置读写/订阅本来就按 workerBase+uuid 全程参数化（recentConfig 等缓存也按此键），注册表只负责「目标切换」，不改数据路径。
- 新增 `src/test/registry.test.mjs` 6 个用例：模型单测 4 个 + handlePanel 层面双 Worker（两个不同 UUID/标记的隔离 Worker）来回切换的配置/订阅互不串扰 + w 模式下首页为 hello 且注册表内其它 Worker 被 403。

## P2-3 optimizer 配置持久化 ✅（含对 P1 存疑②的定位纠正）

- **定位**：过滤在内核不在面板。core `_worker.js` 的 POST /api/config 对每个键做 `Object.hasOwn(F, key)` 校验，F 是内核的配置字段表（原 32 项）；表外键直接抛错，整次保存以 400「配置格式无效」失败。面板只是转发，所以 P1 存疑②里「可能不被保留」应纠正为「**必然整单被拒**」——此前经 UI 保存配置时只要配置对象里带 optimizer* 键就会失败（面板 UI 保存发的是完整配置对象）。
- **改动**：给 F 追加 20 个键，默认值与 engine 逐字一致：P1 的 11 个 `optimizer*` + P2 的 `subMode/warpConf/warpEps/warpName/masqueConf/masqueEps/masqueName/masqueSni/masqueNet`。core 文件 37,188 → 37,542 字节；`panel/test/core-fixture.mjs` 已按上游机制同步为字节一致。
- **验证**：新增 `src/test/config-persistence.test.mjs` 3 个用例——经面板 /worker-api 保存 optimizer*/模式键后回读齐全且未保存键有默认值；表外键仍整单 400（过滤未被放松）；全链路（保存 subMode=warp+warpConf → 拉 base64 订阅）出现 wireguard 节点且原 vless 节点仍在。

## 与 CFNext 的对照结论

| 维度 | CFNext | CFusion P2 |
| --- | --- | --- |
| WARP/MASQUE 节点构建 | _wgNodes，端点/命名/端口语义 | 逐项同语义移植（含内置端点表） |
| 凭据来源 | 自动注册（外部接口）+ 已存 conf | 仅已存 conf（同格式），缺失 fail-closed |
| 输出关系 | 模式隔离（只出模式节点） | 并入（与 worker 节点并存） |
| clash 渲染 | Ee 对象渲染 | 同字段同取值（文本级并入） |
| sing-box 渲染 | 旧式 wireguard outbound | ≥1.12 endpoint 形态（有意现代化） |
| 多后端 | 面板存后端列表（名称:域名,密钥） | localStorage 注册表（名称/域名/UUID），切换复用单 Worker 全套逻辑 |
| 配置持久化 | KV config 单对象 | 同左，且字段表已扩展容纳新键 |

## 新的存疑清单

1. **masque 的 clash `type: masque` 与 `cid` 字段**：均按 CFNext Ee 的实际输出照搬（masque 为 Mihomo 的较新类型；warp 的 `cid` 不是 Mihomo 标准 wireguard 字段名——标准是 `reserved` 数组）。未做真实客户端导入验证，P4 真机阶段需用 Mihomo 实测这两处是否生效/是否应改 `reserved`。
2. **自动注册未移植**：用户若没有现成 WARP 凭据，需要先在别处（如官方客户端或 CFNext）生成 warpConf 再粘贴；是否补一个「用户显式触发、单独确认」的注册动作，留待 Brody 定（涉及向外部接口注册账号）。
3. **注册表双实现一致性**：registry.mjs 与 index.html/bridge.js 内联脚本是两份同语义实现，靠测试断言与同一键/模型约束；日后改模型需同步三处（已在 registry.mjs 头注释标注键名）。
4. **clash 并入的分组范围**：只并入「🚀 节点选择」「♻️ 自动选择」两组，地区/媒体等分流分组不含模式节点（客户端可在主组选用）；是否需要进更多分组待实际使用反馈。
5. **sing-box endpoint 的规则引用**：模式节点挂入了 urltest 与全部 selector 的 outbounds 引用，但 route 规则没有为其单独加规则，与普通节点同等待遇；sing-box ≥1.12 对 endpoint 的 detour/路由细节未做真机验证。
