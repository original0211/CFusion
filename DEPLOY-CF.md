# CFusion 部署手册（Cloudflare-only）

CFusion 只部署在 Cloudflare 上，不使用 Vercel。两个 Worker、两个 KV，
全部使用 `cfusion-*` 命名，**与现有 CFNext（cfnext-backend / cfnext-panel /
cfnext-kv-*）完全独立、互不影响**，也不要动 byJoey 的任何线上资源。

| 组件 | 名称 | 作用 |
| --- | --- | --- |
| 核心 Worker | `cfusion-core` | 代理转发 + 配置接口（`core/_worker.js`） |
| 核心 KV | `cfusion-kv` | 存核心配置，绑定名 `c` |
| 面板 Worker | `cfusion-panel` | 控制台、订阅生成、优选引擎（`panel/cloudflare/dist`） |
| 会话 KV | `cfusion-session-kv` | 面板管理会话，绑定名 `SESSION_KV`（可选但推荐） |

UUID 是控制台入口与订阅凭据，生成后妥善保存，不要提交进仓库。

## 方式一：API 脚本（推荐）

```sh
export CLOUDFLARE_ACCOUNT_ID=<你的 account id>
export CLOUDFLARE_API_TOKEN=<Edit Cloudflare Workers 模板的 token>   # 只从 env 读，脚本不落盘不打印
export CFUSION_UUID=$(node -e "console.log(crypto.randomUUID())")     # 或自己生成并记录
node scripts/deploy-cf.mjs            # 先 dry-run 看将执行的 12 个调用
node scripts/deploy-cf.mjs --apply    # 确认无误后真跑
```

脚本依次：读子域 → 按标题找/建两个 KV → multipart 上传核心（兼容日期
`2026-01-20`、绑定 `c`、变量 `u`=UUID）→ 开核心子域 → 本地构建面板 →
multipart 上传面板（`nodejs_compat`、绑定 `SESSION_KV`、变量 `w`=核心根
地址）→ 开面板子域 → 打印验证地址。`PANEL_ADMIN_PASSWORD` 请部署后用
`wrangler secret put PANEL_ADMIN_PASSWORD` 或控制台给面板 Worker 单独
设置，不要写进脚本或仓库。

## 方式二：手动（控制台 / wrangler）

### 1. 核心 Worker

1. 新建 KV 命名空间 `cfusion-kv`。
2. 新建 Worker `cfusion-core`，用 `core/_worker.js` 全量替换代码并部署
   （ES Module 格式；或 `wrangler deploy` 一个只含该文件的项目）。
3. 设置 → 变量与绑定：
   - 文本变量 `u` = 你的 UUID（大写 `U` 亦可）；
   - KV 绑定：变量名 `c` → `cfusion-kv`；
   - 兼容日期 `2026-01-20`。改完重新部署。
4. 验证：`https://cfusion-core.<子域>.workers.dev/` 返回 `hello`；
   `https://cfusion-core.<子域>.workers.dev/<UUID>/api/config` 返回 JSON。

### 2. 面板 Worker

1. 本地构建（零依赖，只用 Node 内置能力）：

   ```sh
   cd panel && npm run build:cloudflare   # 生成 panel/cloudflare/dist（目录须为空）
   ```

2. 新建 KV 命名空间 `cfusion-session-kv`（用于管理会话；不建也能跑，
   但会话只存在单个 isolate 内存、重启即失效）。
3. 部署：编辑 `panel/cloudflare/wrangler.toml`——取消 `SESSION_KV` 绑定
   的注释并填入上一步的 namespace id、按需设置 `w`，然后在
   `panel/cloudflare/` 下执行 `npx wrangler deploy`。
   - **service binding（w 模式必备）**：Worker 无法用 fetch 访问同账户
     另一个 Worker 的 workers.dev 地址（Cloudflare 返回 error 1042），
     面板必须经名为 `CORE` 的 service binding 与绑定的核心 Worker 通信
     （wrangler.toml 里有注释模板）。用 API 上传时在面板 metadata 的
     bindings 里加 `{"type":"service","name":"CORE","service":"cfusion-core"}`。
   - `w`（vars）：`https://cfusion-core.<子域>.workers.dev`，只填根
     地址，不带 UUID/路径。设置后为私有单机模式：首页返回 `hello`，
     入口为面板域名 + `/<UUID>`。留空则为公共模式（首页填任意
     Worker 域名+UUID 接入）。
   - 管理口令：`npx wrangler secret put PANEL_ADMIN_PASSWORD`（推荐用
     secret，不要明文写 vars）。设置后控制台写操作需先登录
     （随机 session、默认 24h，存 `SESSION_KV`）。
4. 验证（见下节）。

## 验证清单

```sh
CORE=https://cfusion-core.<子域>.workers.dev
PANEL=https://cfusion-panel.<子域>.workers.dev
UUID=<你的 UUID>
curl -s $CORE/                         # hello
curl -s $PANEL/health                  # {"ok":true}
curl -s $PANEL/                        # w 模式: hello；公共模式: 连接表单 HTML
curl -s $PANEL/$UUID/api/config        # 经面板读到核心配置 JSON
curl -s $PANEL/$UUID                   # 控制台 HTML（含 window.CFNEW）
curl -s "$PANEL/$UUID/sub?target=clash"   # Clash 订阅（含 vless 节点）
curl -s "$PANEL/$UUID/sub?target=singbox" # sing-box 订阅（JSON，rule_set 23 组）
```

在控制台改一个普通配置项保存，再 `curl $CORE/$UUID/api/config` 应能读
到新值与 `cfusionMeta`（版本号递增）；改 `subMode` 等关键键时面板应先
返回 409 要求确认（P3 防漂移）。

## 已知降级与注意事项

- **优选探测**：面板在 Workers/fetch 运行时无法按被测 IP 直连，
  `/api/preferred/probe` 明确返回降级不可用（`degraded:true`），不会
  给出假延迟。优选列表拉取与 optimizer 自动池不受影响。
- **SSRF 防护模型变化**：Node 版是 DNS 钉死；fetch 版改为「解析预检
  （任一地址非公网即拒绝）+ fetch」，存在校验与连接之间的 TOCTOU
  窗口，防护弱于钉死版，详见 P4_REPORT。
- **订阅缓存**为 isolate 内存（LRU 32 + 60s TTL），多 isolate 下命中率
  与失效传播打折，陈旧窗口 ≤60s。
- sing-box 规则（约 662KB gzip）在构建期以 base64 内嵌、运行时
  gunzip（探针 A 已实测 workerd 可用）。
- 真机首部署后建议实测：Clash/Mihomo 导入 WARP 节点的 `cid` 字段
  （非标准字段，P2 遗留）、MASQUE 节点导入、XHTTP 真连接与测速。
