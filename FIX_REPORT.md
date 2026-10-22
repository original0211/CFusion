# CFusion 用户反馈三项修复报告（2026-10-22）

针对三条反馈：① 面板控制台卡顿；② 删除面板下方相关链接；③ 家宽节点少、国家少、多数连不通。
提交：c68c390（perf）、22972a1（ui）、ed70ccb（jk）。测试 114 → 122/122 全过。core 与 panel 均已重新部署并回读 settings 验证（bindings 与部署前一致）。

## 一、控制台卡顿

### 基线（本机经出口代理 curl，冷/热；本机到 CF 边缘本身有 ~0.35s 网络底噪）

| 路径 | 大小 | 基线 total |
|---|---|---|
| /health | 11B | 0.84s 冷 / 0.32–0.37s 热 |
| /（w 模式 hello） | 5B | 0.60 / 0.32–0.41s |
| /<UUID> 控制台 | 195,495B | 0.37–0.71s，响应头 `Cache-Control: no-store` |
| /api/admin/status | 39B | 0.43–0.52s |
| /<UUID>/api/config | 1,090B | 0.33–0.53s |
| sub?target=clash | 142,729B | 1.08–1.67s |
| sub?target=singbox | 4,884,710B | 3.39–3.44s |

### 定位（实测排除法）

- sing-box 规则 gzip 解压：singbox.mjs 已有模块级 snapshot 备忘，只解一次，不是每请求重活。
- 控制台初始化调用：几个状态检查是并行触发（未 await 串行），不是瀑布。
- 服务端单请求耗时没有异常大头（11B 的 /health 与 195KB 控制台 TTFB 同量级，主要是网络与边缘开销）。
- **根因**：cf-entry 对所有响应统一强制 `Cache-Control: no-store`，控制台 195KB 静态壳（gzip 后 41KB）每次打开都全量重下 + 浏览器重新解析约 190KB 内联脚本；且该覆盖还误伤了处理器自设的缓存头（如 /rules-license 本应 public max-age=86400，线上实际被改成 no-store，本次实测证实）。

### 修复（cf-entry.mjs，Node 侧 server.mjs 同步同规则）

- 处理器自设 Cache-Control 的响应原样保留。
- GET 且 200 且 text/html（控制台壳、落地页）→ `private, max-age=300`：浏览器 5 分钟内重复打开直接用本地壳，零下载零重解析；壳内数据仍走 API 实时拉取，不会用到过期配置。
- 其余（配置/管理 API、订阅、非 200、非 GET）维持 no-store 不变。

### 复测（同组 URL，同测量点）

| 路径 | 修复后 total | 变化 |
|---|---|---|
| /health | 0.39–0.42s | 同量级（网络底噪主导） |
| /<UUID> 控制台 | 0.57–0.81s，`Cache-Control: private, max-age=300` ✅ | 首次仍需下载；5 分钟内重复打开浏览器不再发请求（curl 不带缓存，只能验协议头） |
| /<UUID>/api/config | 0.39–0.53s | 不变（仍 no-store，数据实时） |
| sub clash / singbox | 1.64s / 3.40s | 与基线一致，无回归 |
| /rules-license | `Cache-Control: public, max-age=86400` ✅ | 被误伤的自设头已恢复 |

残余：首开仍要下 195KB 壳（41KB gzip）。进一步优化需把内联脚本拆成独立可缓存资源，属结构改造，本次未做。

## 二、删除相关链接

- 位置：panel/src/engine.mjs 控制台模板底部的「相关链接」卡片（上游 GitHub 仓库、yx-tools 发布页、YouTube @joeyblog 三个外链）。
- 已整段删除卡片 UI，并删除中/波斯两套 i18n 里的 relatedLinks、githubProject、优选工具 条目；全仓 grep 零残留，渲染产物实测不含「相关链接 / joeyblog / yx-tools」。
- 保留说明：页面里另有 byJoey 字样的功能性 URL（客户端远程配置 INI、Surge 图标），不是链接区块，删了会破坏客户端配置生成，未动；仓库 LICENSE/NOTICE 的署名义务不受影响。
- 线上验证：抓取控制台 HTML 确认链接消失、其余功能（jkSource 新字段等）正常。

## 三、家宽（jk）节点

### 基线（2026-10-22 两次实拉 VPN Gate 清单，本机走 http 回退）

- 原始清单 95 行 → 内置住宅过滤（剔官方机房段）82 → proto=tcp 69–70 个候选
- 国家 13 个：JP 35–37、KR 19–20、RU 10、US 3–4、TH 4、VN 2、FR/GB/MA/MX/SE/HR/LV 各 1
- 旧行为：以上候选不做任何连通性检查直接进订阅，死节点靠客户端 fallback 慢慢试——即用户说的「多数 ping 不通」。

### 修复

1. **边缘侧连通性过滤**（新模块 panel/src/jk-probe.mjs）：订阅生成时在面板 Worker 内用 cloudflare:sockets 对每个候选做 TCP connect 探测（超时 3s、并发上限 10），连不通剔除；结果随现有 30 分钟家宽缓存一起缓存。非 Worker 运行时无 sockets、探测整体异常、或全部探不通（疑探测通道坏）时一律 fail-open 保留全部，本地与测试环境不受影响。
2. **自定义源 jkSource**：新增配置项（core 字段表 F + 别名表已加键，core 与 panel/test/core-fixture.mjs 保持字节一致，38,232B；面板默认值/别名/UI 已注册，配置页家宽区有中文标签与说明）。填写的清单（同 VPN Gate 格式）与默认源合并、按地址:端口去重，一起过连通性过滤；某个源拉取失败不影响其他源。改 jkSource 后缓存按源组合分键，立即生效。
3. 数量与国家如实记录，不凑数。

### 线上实测（开启 jk 生成 target=vg，验证后已恢复 jk=no、jkSource=空）

- 生成耗时 7.6s（冷路径：拉清单 + 探测全部候选 + 渲染；之后 30 分钟走缓存）
- **交付 36 个节点、7 个国家**：JP 17、KR 12、CA 3、VN 1、MY 1、HR 1、BR 1
- 对照同时段候选池约 69 个 TCP 候选，约 48% 被边缘探测判定不可达并剔除——留下的是从 CF 边缘真能连通的（链式模式下 OpenVPN 正是由边缘拨出，此口径即实际口径）
- 节点结构抽查正确：type openvpn、proto tcp、dialer-proxy 指向 CF 前置组、共享证书锚点引用正常
- 注意：VPN Gate 清单每几分钟都在变，边缘拉取（带 cf 1800s 缓存）与本机拉到的快照不完全一致（线上出现了 CA/MY/BR，本机快照里没有），国家数不是同快照严格对照；节点总数 69→36 的过滤效果是可靠口径
- jkSource 全链路实测：面板登录后保存 jkSource 成功（此前字段表外会整单 400 拒绝）、面板与 core 双向回读一致；故意填的无效自定义源地址失败时 fail-soft，默认源照常出订阅

### 残余问题

- 默认源只有 VPN Gate 一家志愿者清单，国家多样性上限就是清单本身（原始 13 国）；想要更多国家，用 jkSource 加自己的同格式清单源。
- 冷生成约 7.6s（探测成本），30 分钟缓存期内无此开销；订阅本身另有 60s 订阅缓存。
- 部署刚完成时出现过一次 jkSource 保存后立即回读为空、数秒后恢复正确的现象，判断是脚本更新/KV 传播延迟，无需处理。
