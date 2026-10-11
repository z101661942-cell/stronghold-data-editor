# 版权与许可说明（NOTICE）

## 1. 许可证：GPL-3.0-or-later

Copyright (C) 2026 sganggs 与贡献者

本仓库自己编写的源代码与文档（`tools/`、`dicts/`、`scripts/`、`docs/`、`examples/`、以及根目录下的 Markdown 文档）以 **GNU 通用公共许可证第 3 版或（由你选择）任何更新版本**（GPL-3.0-or-later）发布，全文见 [LICENSE](LICENSE)。

选择与上游同人项目 [Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) 相同的许可证，理由是：

- 本工具中的**中文词典**（`dicts/*.json`）是逐个键到上游源码里核对含义与出处整理出来的，与上游代码关系密切，同许可最不易产生歧义；
- 便于他人把本编辑器与上游项目组合使用（例如嵌进上游的控制台或工作流），不会有许可冲突。

## 2. 本仓库不包含什么

- **不含**任何游戏数据（`data/*.json`）、存档或构建产物；
- **不含**上游项目 Stronghold-Protocol 的代码；
- **不含**任何游戏素材（立绘、图标、音频、字体、UI 资源）或从游戏客户端解包出来的内容；
- `examples/sample-data/` 里的 JSON 是**本仓库自己编的假数据**（记录结构照数据格式写，文案全部是「示例…」），只用于在没有游戏数据时试用界面。

## 3. 中文词典的来源与口径

`dicts/buff-keys.json`、`dicts/runes.json`、`dicts/fields.json` 记录了每个键的中文含义、生效阶段与**源码出处**（`文件:行号`），做法是逐键在服务端源码中定位其处理器/符文实现（`server/match/builtinMeta.js`、`server/match/effectsMeta.js`、`server/sim/content/**`）。

因此：

- 词典中的键名、枚举值属于数据格式本身的事实性信息；
- 每条中文说明是本仓库自己撰写的一行描述；
- 若你使用/再分发这些词典，按本仓库的 GPL-3.0-or-later 处理即可。

**准确性不保证**：上游版本变化后，个别键的说明可能过时；找不到处理者的键会明确标注「源码里没有处理者：写了也不会生效」，但这反映的是整理时的源码状态。

## 4. 商标与第三方权利

《明日方舟》、Arknights、卫戍协议及相关名称、术语归上海鹰角网络科技有限公司及其关联方所有。本仓库对这些名称的引用仅用于**说明兼容对象**，不构成任何主张、授权或关联。详见 [DISCLAIMER.md](DISCLAIMER.md)。

## 5. 第三方组件

本项目**没有**运行时依赖：

- 编辑器是一个单独的 HTML 文件，自带样式与脚本，不加载任何 CDN 资源，不联网；
- 本地静态服务 `tools/editor-server.cjs` 只用 Node.js 内置模块（`node:http` / `node:fs` / `node:path` / `node:child_process`）；
- 自测脚本只用 Node.js 内置模块与 `node:test` 风格的手写断言，无测试框架依赖；
- Windows 一键启动脚本只用 PowerShell 与 .NET 的 WinForms 消息框（系统自带）。

因此本仓库无需 `THIRD-PARTY-NOTICES`。
