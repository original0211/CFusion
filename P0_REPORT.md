# P0 基线报告（2026-10-22）

## 仓库结构

```
cfusion/
├── DESIGN.md          设计文档（原有）
├── README.md          项目说明、来源与署名
├── NOTICE.md          二次开发署名说明（基底：byJoey/cfnew-panel、byJoey/cfnew）
├── core/
│   └── _worker.js     CFnew 精简内核 core-only，37,806 字节
└── panel/             byJoey/cfnew-panel 完整 fork（LICENSE、NOTICE.md、原 README 均保留未改）
    ├── src/           engine.mjs(4809 行) / preferred.mjs / server.mjs / singbox.mjs / bridge.js / api
    ├── src/test/      上游自带 8 个测试文件
    └── test/core-fixture.mjs  上游测试夹具（内核副本）
```

## 内核校验

- 从 github.com/byJoey/cfnew `core-only` 分支重新拉取 `core/_worker.js`，sha256 = `d05cb33eb57cfa271e521944bcaee6a836c30bad1b80160d25c61c5f6f12936a`，与本地素材 `~/workspace/cfnew-deploy/_worker.js` 一致。
- `panel/test/core-fixture.mjs` 与 `core/_worker.js` **字节完全相同**（sha256 同上）：上游测试机制就是用这份夹具作隔离内核（CFNEW_TEST_CORE=./test/core-fixture.mjs），因此无需额外拷贝或改指，`core/` 是部署用正本、夹具是测试用副本，两者同源同版（2026.10.17.2）。

## 基线测试结果

- 环境：Node v24.20.0 / npm 10.9.4（package.json engines 写 22.x；直接运行 `npm test` 未因 engines 报错，未改任何上游代码，也未装依赖即可运行）。
- 命令：`cd panel && npm test`（即 `CFNEW_TEST_CORE=./test/core-fixture.mjs node --test src/test/*.test.mjs`）
- **结果：tests 55 / pass 55 / fail 0**，duration ≈ 4.0s。覆盖 subscriptions、free-cpu、access、worker-policy、separation、large-list、vercel、version 八个文件。

## 备注

- fork 时已移除 panel/.git（子仓库），统一由 cfusion 根仓库管理。
- P0 未改动 panel 与 core 的任何上游代码文件；新增文件仅根目录 README.md / NOTICE.md / 本报告。
