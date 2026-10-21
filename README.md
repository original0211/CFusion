# CFusion

把 CFnew 与 CFNext 取长补短的新项目：**CFnew 的精简代理内核与独立面板架构 × CFNext 的优选订阅引擎**。

- 设计文档：[DESIGN.md](./DESIGN.md)
- 进度报告：[P0_REPORT.md](./P0_REPORT.md)、[P1_REPORT.md](./P1_REPORT.md)、[P2_REPORT.md](./P2_REPORT.md)、[P3_REPORT.md](./P3_REPORT.md)、[P4_REPORT.md](./P4_REPORT.md)
- Cloudflare 部署：[DEPLOY-CF.md](./DEPLOY-CF.md)（只部署 Cloudflare；API 脚本 `scripts/deploy-cf.mjs`，默认 dry-run）

## 结构

```
core/    CFnew 精简内核（core-only 的 _worker.js，2026.10.17.2），只做代理转发 + KV 配置
panel/   独立面板（fork 自 byJoey/cfnew-panel），订阅生成、优选与配置管理都在面板侧
```

## 来源与署名

本项目是二次开发，不是完全原创：

- `core/_worker.js` 与 `panel/` 基底来自 **byJoey** 的 [cfnew](https://github.com/byJoey/cfnew)（core-only 分支）与 [cfnew-panel](https://github.com/byJoey/cfnew-panel)，其自定义许可（源码使用与署名许可）要求衍生版本保留来源与署名——原件许可见 `panel/LICENSE`、署名见 `panel/NOTICE.md` 与根目录 `NOTICE.md`。
- P1 的优选引擎逻辑（wetest 源、筛选、自动池）移植自 **PAICNI/CFNext** 及自有改进 fork CFNext-Plus（`~/workspace/cfnext-plus`，本地素材，未包含在本仓库）。

## 本地运行面板

```bash
cd panel
npm start   # Node 22+，默认监听 127.0.0.1:3100
npm test    # 自带测试套件
```
