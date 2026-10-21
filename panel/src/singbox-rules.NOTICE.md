# 内置分流规则

这份规则快照来自 [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat/tree/b0c55a3870624b237c85c8e9ea6656493f8d44b6)，使用 GPL-3.0。完整许可证见同目录 singbox-rules.LICENSE。

快照日期：2026-10-14。保留原有 23 类分流数据，订阅内以可读的 inline 规则提供。规则数据与面板程序分开维护；节点凭据不进入快照。

更新时先在测试机运行 tools/update-singbox-rules.py，传入新的完整提交号与 sing-box 执行路径；验证客户端启动和分流后，再部署快照并重启面板。不要直接依赖可变分支或启动时下载的第三方地址。
