# CFnew 独立面板

[![部署到 Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FbyJoey%2Fcfnew-panel&project-name=cfnew-panel&repository-name=cfnew-panel)
[![Node.js 22](https://img.shields.io/badge/Node.js-22-43853d)](https://nodejs.org/)
[![源码许可](https://img.shields.io/badge/源码许可-署名与禁止冒充原创-blue)](./LICENSE)

把 CFnew 控制台、优选操作和订阅生成放在 Vercel，Cloudflare Worker 只负责代理转发和 KV 配置。节点流量直接连接你自己的 Worker，不经过面板。

图文教程：[CFnew 独立面板：Vercel 一键部署](https://joeyblog.net/cfnew-panel-vercel-deploy.html)。

## 一键部署

1. 先部署 [CFnew 精简内核](https://github.com/byJoey/cfnew/tree/core-only)，设置 Worker 变量 `u` 为自己的 UUID。需要在线保存配置时，绑定 KV，名称填 `C` 或 `c`。已有用户保留原 UUID 和 KV 绑定，兼容日期用 `2026-01-20`。
2. 点击上面的 Deploy 按钮，登录 Vercel，按页面提示连接 GitHub 并创建自己的仓库副本。
3. Application Preset（旧界面叫 Framework）选择 **Other**；如果自动识别成 Node，请改为 Other。根目录保持仓库根目录，无需手填构建命令。点击 Deploy，等待完成。
4. 打开分配的面板域名，填写自己的 Worker 域名与 UUID 或自定义路径，即可连接。
5. 在面板中配置并复制订阅到客户端。订阅使用面板域名；节点的 SNI / Host 与代理入口仍是 Worker。

部署按钮会引导平台登录、Git 授权和创建项目，这些步骤仍需用户在自己的账号完成。项目无需付费数据库或面板 KV。

如果仓库列表为空，先到 Vercel 账号的 Authentication → Sign-in Methods 连接 GitHub，再返回部署页面。

GitHub 中已经有自己的 `cfnew-panel` 仓库时，在 Vercel 的 New Project → Import Git Repository 选择该仓库即可。通过 Git 连接部署后，推送到 `main` 会自动更新正式站；其它分支用于预览。已有源码无需删掉重建。

## 可选变量：w

`w` 设置在 **Vercel 面板项目**的 Settings → Environment Variables，变量名为小写。选择 Production；需要预览也生效时同时选择 Preview。保存后重新部署。

| w 的值 | 入口与行为 |
| --- | --- |
| 不设置或留空 | 公共面板。首页显示 Worker 域名和 UUID / 自定义路径连接表单，可接入任意兼容 Worker。 |
| `https://your-worker.example.com` | 只管理这个 Worker。首页返回 `hello`，不显示连接表单；通过 `https://面板域名/UUID` 或自定义路径进入原控制台。 |

只填 Worker 的 HTTPS 根地址，不带 UUID、路径或查询参数。HTTPS 前缀可省略。无效值会拒绝连接；填写后不能通过换查询参数接入其它 Worker。

`w` 不需要写到 Worker 内核里，也不代替 UUID 验证。面板不能凭这个变量替你隐藏 Worker 的全部网络路径。

固定 Worker 后：

```text
控制台：https://面板域名/你的UUID
订阅：  https://面板域名/你的UUID/sub
Clash： https://面板域名/你的UUID/sub?target=clash
```

如果 Worker 的 `d` 是 `/Admin/Panel`，也可用 `https://面板域名/Admin/Panel` 进入。大小写必须一致。登录后地址自动使用稳定的 UUID，后续修改 `d` 不影响当前面板重载和已复制订阅。`d` 是配置入口，`tp` 是代理传输设置。

## 让订阅客户端能访问

先用未登录 Vercel 的浏览器打开面板。若被 Vercel 登录页拦住，在 Settings → Deployment Protection 调整 Vercel Authentication，使使用中的部署域名可公开访问。

浏览器登录 Vercel 后能打开面板，不代表客户端能更新订阅。用实际对外域名验证，不能给订阅链接附上 Vercel 账号令牌。

## 公共模式

首页填写域名和 UUID 即可。也可使用：

```text
控制台：/panel?host=your-worker.example.com&uuid=你的UUID
订阅：  /sub?host=your-worker.example.com&uuid=你的UUID
Clash： /sub?host=your-worker.example.com&uuid=你的UUID&target=clash
```

支持 `base64`、`v2ray`、`clash`、`stash`、`singbox`、`surge`、`loon`、`quanx`；开启家宽链式后可使用 `target=vg`。不指定时按客户端请求头识别。

未绑定 Worker KV 仍可读取环境配置并生成订阅，但页面不能保存。原来直接指向 Worker 的 `/sub` 需替换成独立面板生成的新订阅。

## Free CPU 保护

更新配套内核到 `2026.10.17.2`，在“配置管理”开启 **Free CPU 保护**，保存后对新连接生效。默认关闭，旧内核会提示更新。

开启后保留 WS 和 XHTTP：每条连接上下载合计最多 **384 KiB 或 96 个数据块**，超过就主动断开。新连接重新计算预算；关闭后恢复原来的传输方式。没有 KV 时可设置 Worker 变量 `freeCpu=yes` 或 `FREE_CPU=yes`，KV 中的设置优先。

这是按流量和处理次数估算的保护，Worker 无法读取实时 CPU 余量，不能保证所有免费账号零超限。客户端需自行重连，正在进行的下载、视频和长连接可能中断，不会自动续传。

## 自有服务器与 Docker

Node.js 22：

```bash
git clone https://github.com/byJoey/cfnew-panel.git
cd cfnew-panel
npm start
# 可选：固定自己的 Worker
w=https://your-worker.example.com npm start
```

运行不需要 npm 依赖，默认监听 `127.0.0.1:3100`。用 Nginx / Caddy 反代并启用 HTTPS。不要对外开放未加 HTTPS 的管理入口。

Docker：

```bash
docker compose up -d --build
# 固定 Worker 可在 .env 中填写 w，或通过环境变量传给 compose。
```

面板不把 UUID 或配置写入数据库。勾选“记住节点”只保存在当前浏览器；UUID 和订阅地址相当于访问凭据，勿公开分享，反代访问日志建议不记录这些入口。

## 更新与限制

- 一键部署得到自己的仓库副本。更新面板源码需同步上游并重新部署；修改环境变量也要重新部署。
- 原 WebSocket、XHTTP、出站代理、ECH、IPv6 与客户端订阅生成保留；代理数据面仍由配套核心处理。
- 在线 IP 检测在面板服务器执行，延迟是服务器视角。Vercel 实测 IPv4 检测可用，IPv6 在线检测出现平台出站错误；IPv6 节点生成和 Worker 实际连接已验证，不能用在线检测结果代替客户端测速。
- sing-box 使用 1.12 起的 DNS / 路由格式，内置分流规则，不要求启动时下载规则文件。规则许可见 [NOTICE](./NOTICE.md) 和 `/rules-license`。
- 请求正文上限 1 MiB，大量地址可改用在线列表 URL。健康检查为 `/health`。
- GitHub Pages 只能托管静态页面，不能运行本项目的服务端配置转发、订阅转换和在线检测；本项目使用 Vercel Functions。

## 开发与验证

```bash
npm ci
npm test
```

测试使用内存 KV 与本地隔离 Worker，不访问你的真实 Worker。`CFNEW_ALLOW_PRIVATE=yes` 仅供隔离测试，线上不要设置。

可生成单独的压缩运行包：

```bash
npm run build:vercel -- /一个空目录
```

规则更新：`python3 src/tools/update-singbox-rules.py --revision <完整提交号> --sing-box <可执行文件>`。更新后需验证真实客户端的 DNS、代理联网和分流，再发布。

## 来源与交流

允许任何合法用途的修改、二次开发和 AI 辅助维护。**禁止将基于本项目源码的 AI 改写冒充为与本项目无关的完全原创代码**；改写相同逻辑、换语言、改名或重排结构后，仍须保留来源和版权说明。可以注明自己实际新增的独立贡献。

本版本采用自定义的 [CFnew 源码使用与署名许可](./LICENSE)，不再标为标准 MIT。此前已按 MIT 发布的版本仍按其原许可使用。来源与第三方许可见 [NOTICE.md](./NOTICE.md)，内置规则数据继续遵循其原始许可。

[博客](https://joeyblog.net) · [YouTube](https://youtube.com/@joeyblog) · [Telegram](https://t.me/+ft-zI76oovgwNmRh)

本项目供学习与网络技术研究，请遵守当地法律及所用平台的服务条款。

## CFusion 新增：优选引擎（P1）

> 本节为 CFusion 二次开发内容，基底说明见仓库根 README/NOTICE。

`src/optimizer.mjs` 把 CFNext 的优选引擎移植到面板侧：订阅请求时（`src/server.mjs` 在生成订阅前调用 `resolveOptimizerYx`），用自动构建的优选池替换手填 `yx` 作为引擎输入；页面渲染与其它流程不受影响。默认关闭，全程 fail-open（拉取失败回退上次池/手填列表，绝不阻断订阅生成）。

| 配置键 | 环境变量 | 默认 | 说明 |
| --- | --- | --- | --- |
| `optimizerAuto` | `OPTIMIZER_AUTO` | `no` | 总开关，`yes` 才接管优选池 |
| `optimizerSource` | `OPTIMIZER_SOURCE` | `wetest_v4` | 预设源：`wetest_v4` / `wetest_v6` / `hostmonit` / `wetest_cname` / `bestcf` / `custom` |
| `optimizerSourceURL` | `OPTIMIZER_SOURCE_URL` | 空 | 自定义列表 URL（多个以换行/分号分隔）；给了 URL 即进入 custom 模式（接受非 CF 段地址） |
| `optimizerRegion` | `OPTIMIZER_REGION` | `all` | 地区筛选（HK/TW/US/SG/JP/KR/DE 或中文名，靠节点备注匹配） |
| `optimizerIsp` | `OPTIMIZER_ISP` | 空=全部 | 运营商筛选：移动,联通,电信（逗号分隔） |
| `optimizerIpType` | `OPTIMIZER_IP_TYPE` | 空=跟随 ipv4/ipv6 开关 | `IPv4` / `IPv6` / `IPv4,IPv6` |
| `optimizerLimit` | `OPTIMIZER_LIMIT` | `300` | 池上限（对应 CFNext nodeLimitCount，钳制 1–1000） |
| `optimizerCustomPref` | `OPTIMIZER_CUSTOM_PREF` | `no` | `yes` 时只用已保存的手填 `yx`，不自动重建池（CFNext customPref=true 语义） |
| `optimizerPort` | `OPTIMIZER_PORT` | `443` | 候选默认端口 |
| `optimizerCount` | `OPTIMIZER_COUNT` | `20` | 自动池目标条数（补量目标，对应 CFNext optimizer.count） |
| `optimizerUseCidr` | `OPTIMIZER_USE_CIDR` | `yes` | 候选不足时从 Cloudflare 地址段随机采样补量 |

配置优先级与面板其它配置一致：Worker KV 已保存值 > 面板环境变量 > 默认值。注意：内核的配置保存接口按其自身字段表过滤，`optimizer*` 键目前需通过 KV 直写或面板环境变量设置，面板 UI 表单暂未提供这组字段（见根目录 P1_REPORT.md 存疑清单）。

## CFusion 新增：安全加固（P3）

> 本节为 CFusion 二次开发内容，详见仓库根 P3_REPORT.md。

- **管理口令（P3-1，可选）**：面板 env 设置 `PANEL_ADMIN_PASSWORD` 后，控制台的一切配置写操作（保存配置、优选增删改、模式切换）必须先登录；登录发随机 session cookie（httpOnly + SameSite，默认 24h，`PANEL_ADMIN_SESSION_TTL_HOURS` 可调）。读操作与订阅生成不受影响。**未设置口令时行为与上游完全一致，但等于「拿到 UUID/订阅链接的人就能改配置」，公网部署强烈建议设置。** session 只存面板进程内存，面板重启需重新登录；请把面板放在 HTTPS 之后再启用（http 下 cookie 不带 Secure 标记）。
- **配置防漂移（P3-2）**：保存配置时若改动关键键（`subMode`、`ev/et/ex`、`s`、`p`、`qj`、`warpConf`、`masqueConf`），必须显式确认——API 请求体带 `confirmCritical: true`（或请求头 `x-cfusion-confirm-critical: true`），否则返回 409 与变更 diff（凭据类值不回显）；控制台页面会弹确认框自动重提。每次成功保存会写入版本 meta（存在 Worker 配置的 `cfusionMeta` 键：`ver`/`hash`/`changedKeys`/`ts`），控制台顶部可见当前版本与上次变更摘要。
- **订阅缓存（P3-3）**：订阅响应按「Worker + UUID + target + 方法 + UA」归一化键缓存（LRU 32 条、TTL 60 秒），链接后加随机参数不再击穿缓存；任一配置保存成功即失效该 Worker 的缓存。
