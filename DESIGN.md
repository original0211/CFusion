# CFusion 设计文档（暂定名）

> 目标：把 CFnew 与 CFNext 合成一个新项目——CFnew 的代理内核与面板架构 × CFNext 的优选订阅引擎与多后端管理。
> 状态：设计稿，待 Brody 点头开工。素材全部本地就绪：cfnew 内核 `~/workspace/cfnew-deploy/_worker.js`、cfnew-panel 源码（已克隆到 /tmp 对照）、CFNext-Plus `~/workspace/cfnext-plus/`、审查清单 `~/workspace/cfnext-review/IMPROVEMENTS.md`。

## 一、两边家底（2026-10-22 实地核对）

### CFnew（byJoey）——强在数据面与工程
- **精简内核 37,806 字节**（CFNext 后端 180KB、完整版约 360KB）：只做代理转发 + KV 配置接口。VLESS WS、Trojan WS、VLESS XHTTP（stream-one)、ProxyIP 回退、SOCKS5/HTTP(S）出站、出站策略 qj、ECH、VLESS UDP DNS 转发。
- **Free CPU 保护**（2026.10.17.2）：按连接预算（上下载合计 384KiB 或 96 个数据块）提前断开，专治免费版 CPU 超限——CFNext 完全没有这层。
- **面板与内核分离**：面板（Node 22、零运行时依赖）可部署 Vercel / Docker / 自有服务器；订阅生成在面板侧（engine.mjs 约 4,800 行），Worker 不吃订阅生成的 CPU。面板带完整测试套件（subscriptions / free-cpu / access / worker-policy 等）。
- 配置体系干净：32 项配置，优先级 KV > 环境变量 > 默认值；面板 `w` 变量绑定单个 Worker；公共/私有双模式。
- 短板：优选很轻（preferred.mjs 仅 101 行：手填列表 + 在线列表 + 面板侧测速勾选），**没有 wetest 这类优选源、没有按地区/运营商自动建池**；**没有 WARP / MASQUE 模式**；一个面板只能管一个 Worker；无管理密码，UUID 即凭据；Vercel 侧 IPv6 在线检测受平台出站限制。

### CFNext / CFNext-Plus（PAICNI + 自有 fork）——强在优选引擎与管理
- **优选引擎**：wetest_v4 优选源、每次生成自动重建优选池、按地区（all）/IP 类型（IPv4+IPv6）/运营商（移动/联通/电信）筛选、preferredIPs、节点上限（nodeLimitCount=300）。
- **多模式订阅**：mode=worker / warp / masque / home，WARP 与 MASQUE 节点是订阅层生成的配置，不依赖内核新协议。
- **多后端管理**：一个面板管多个后端（名称：域名，API 密钥），Plus 版已加固：鉴权 fail-closed、随机 session token（KV 存储 24h)、订阅缓存键归一化 + LRU32。
- 短板：单体巨石、无测试、订阅生成在 Worker 内跑（10ms CPU 硬顶 + `?x=随机` 缓存击穿放大风险，Plus 只堵了一半）、无 XHTTP、无 Free CPU 保护；配置漂移出过真实事故（mode 被外部切到 warp，订阅静默变成 50 个 WARP 节点、VLESS 消失）。

## 二、新项目架构（取长补短）

```
客户端 ──订阅──> 面板（订阅引擎 + 优选引擎 + 管理）
                  │  生成节点：SNI/Host 指向 Worker
客户端 ──流量──> Worker 内核（CFnew core，只转发）──> 直连 / ProxyIP / SOCKS5 出站
                  ▲
                  └── KV 配置（面板经 /api/config 写入，UUID 鉴权）
```

1. **数据面 = CFnew 精简内核原样为基**：37.8KB、XHTTP、ECH、Free CPU 保护全部保留；不往内核里塞订阅生成（这是 CFNext CPU 事故的根源）。
2. **优选引擎 = CFNext 的脑子搬进面板**：把 wetest 源接入、地区/运营商/IP 类型筛选、自动重建池、节点上限移植为面板侧模块（替换 cfnew-panel 的 preferred.mjs），生成订阅时在面板算好——面板没有 10ms CPU 限制，还能加缓存（移植 Plus 的缓存键归一化 + LRU）。
3. **模式层 = CFNext 的 warp/masque/home 作为面板侧节点生成器**：它们本质是订阅层配置模板，不动内核即可实现；与 worker 模式（走 CFnew 内核）并列，面板一键切换。
4. **管理层 = CFNext 多后端 × CFnew 面板**：面板维护 Worker 注册表（多个 Worker 各自域名+UUID)，`w` 单绑定模式保留为「私有单机模式」；多后端是「管理模式」。
5. **安全层 = Plus 的教训全量吸收**：面板管理口令 + 随机 session（不再只靠 UUID)、一切接口 fail-closed、**配置版本与变更确认**（mode 等关键项变更要显式确认并留版本记录，杜绝 10-20 那种静默漂移）、订阅缓存防击穿。

## 三、分期

- **P0 基线**：fork cfnew core-only 内核 + cfnew-panel 到新仓库（保留 byJoey 署名与 LICENSE/NOTICE——其自定义许可要求衍生版本保留来源），跑通面板自带测试，本地 Docker 起面板 + 测试 Worker 联调。
- **P1 优选引擎移植**：wetest 源 + 筛选 + 自动池 + 节点上限进面板 preferred 模块，补单测；与 CFNext 同参数下出订阅逐项对照（节点数/命名/筛选结果）。
- **P2 模式与多后端**：warp/masque/home 节点生成器 + Worker 注册表 + 管理模式 UI。
- **P3 安全加固**：管理口令/session、fail-closed 复查、配置版本与漂移告警、缓存 LRU。
- **P4 发布**：Cloudflare-only 部署（面板 Cloudflare 原生目标 + Worker:API 一键脚本——吸取这次 token 教训，脚本支持 wrangler OAuth 与 API token 两条路）、真机部署验证（需要 Brody 提供一次 Cloudflare 凭据）。

## 四、许可与署名

- CFnew 面板/内核为 byJoey 自定义许可：允许修改与二次开发，衍生版本**必须保留来源与署名**，不得冒充完全原创——新仓库保留 LICENSE 与 NOTICE 并注明基底来源。
- CFNext 为 PAICNI 上游 + 自有 CFNext-Plus fork（自有改进部分可自由取用；上游部分在仓库注明出处）。

## 五、部署约束（Brody 2026-10-22 拍板）

- **只在 Cloudflare 上部署，不用 Vercel。** 面板需要 Cloudflare 原生目标：候选 Pages + Functions / Worker + nodejs_compat / Pages + panel Worker，P1 报告先做适配评估、P4 落地。好处：单一平台、单一账号与凭据；cfnew-panel 在 Vercel 上的两个坑（Deployment Protection 拦订阅客户端、IPv6 在线检测受平台出站限制）随之消失；在线检测改为 Cloudflare 视角。
- P4 的「双目标部署文档」相应改为：面板 Cloudflare 部署 + Worker API 一键脚本（wrangler OAuth / API token 两条路）。

## 六、待 Brody 定

1. 项目名（暂定 CFusion，可改）。
