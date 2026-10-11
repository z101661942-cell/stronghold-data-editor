# 免责声明 / Disclaimer

## 中文

### 1. 非官方、无关联

本项目（**卫戍协议 · 数据编辑器 / Stronghold Protocol Data Editor**）是一个**非官方**的第三方工具，与**上海鹰角网络科技有限公司（Hypergryph）**、**Yostar** 及其关联方**没有任何关联**，也未获得其授权、赞助或认可。

《明日方舟》、卫戍协议及相关名称、术语、角色、美术与音频素材的一切权利归其各自权利人所有。本仓库**不包含**任何游戏数据、立绘、图标、音频、字体或其他游戏素材，也不包含上游同人项目的任何代码。它只在**你自己的机器上**读取你**自己**的 `data/*.json`，并把你手动输入的改动写回这些文件。

### 2. 与上游项目的关系

本工具设计为配合开源同人项目 [Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)（GPL-3.0-or-later）使用。两者是**独立的**项目：本仓库不包含上游代码，只按公开的数据格式（`data/*.json` 的字段约定）与其互操作。如果上游项目的数据格式或引擎行为发生变化，本工具中的字段说明、校验规则与中文词典可能**过时**——请以你所用版本的源码为准。

### 3. 自担风险

本工具会**直接修改你磁盘上的数据文件**。使用即表示你理解并接受：

- **请先备份**。编辑器在写盘前会自动生成 `*.bak-<时间戳>.json`，但你自己再备份一份 `data/` 是更稳妥的做法。
- 改动数据**会直接影响你的游戏**：可能导致存档/对局异常、数值失衡、某些效果完全不触发，甚至让服务端启动失败。
- 修改数值后建议**重启游戏服务器**，否则客户端与服务端读到的数据可能不一致。
- 作者不对任何直接或间接损失负责，包括但不限于：存档损坏、对局异常、数据丢失、因违反任何规则或条款而产生的后果。
- **不要**在官方服务器、官方客户端或任何联机环境中使用本工具修改的数据；本工具只面向你自己搭建的本地/自托管同人项目。

### 4. 无担保

本软件按「现状」提供，**不附带任何形式的明示或默示担保**，包括但不限于对适销性、特定用途适用性和非侵权性的担保。作者不保证它能满足你的要求，也不保证运行不中断、无错误，或其中包含的中文词典、校验规则、字段出处标注完全准确。

### 5. 责任限制

在任何情况下，作者或贡献者均不对因使用或无法使用本软件而产生的任何索赔、损害或其他责任负责，无论是在合同诉讼、侵权诉讼或其他诉讼中——除非适用法律要求如此。

### 6. 提交流与内容

如果你为本项目提交贡献（PR / issue / 词典修订），即表示你确认你有权提交该内容，并同意其以本项目的许可证（GPL-3.0-or-later）发布。**请不要提交游戏数据、解包内容、美术/音频素材或任何受第三方版权保护的文本。**

---

## English

This project is an **unofficial** third-party tool. It is **not affiliated with, authorized, sponsored or endorsed by** Hypergryph, Yostar, or any of their affiliates. Arknights, Stronghold Protocol and all related names, terms, characters, art and audio belong to their respective owners.

This repository ships **no game data and no game assets** — no `data/*.json` from any game or fan project, no art, icons, audio or fonts. The editor only reads the JSON files on **your own machine** and writes back the edits you make by hand. It is designed to interoperate with the open-source fan project [Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) (GPL-3.0-or-later) but contains none of its code.

**Use at your own risk.** The tool writes to files on your disk: it can break saves, matches, or the game server itself. Back up your `data/` first. Do not use edited data on official servers or clients — this tool targets self-hosted/local fan projects only.

The software is provided **"as is", without warranty of any kind**, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose and noninfringement. In no event shall the authors or contributors be liable for any claim, damages or other liability arising from, out of or in connection with the software or the use of the software.

By contributing, you confirm you have the right to submit the content and agree that it is released under GPL-3.0-or-later. Please do not submit game data, unpacked content, or any third-party copyrighted assets or text.
