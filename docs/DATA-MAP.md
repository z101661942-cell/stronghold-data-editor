# 数据权威表（DATA-MAP）

这份文档回答一个问题：**我改的这个字段，到底有没有人读？谁在读？**

所有结论都是逐个字段到上游 [Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) 的服务端 / 客户端源码里核对出来的，标注了出处（`文件:行号`，对应上游 v0.2.3）。
如果上游升级后行为变了，请以你所用版本的源码为准（本仓库的校验规则也按同一口径写，可以在 `tools/bond-editor.html` 里搜对应注释）。

---

## 0. 六个数据文件之间的关系

```
data/items.json      115 条道具（112 装备 + 3 法术），_a = 精一 / _b = 精二（精锐）
        └─ effectId ──► data/effects.json 里那条 EQUIP 记录（数值镜像，运行时**不读**）

data/choices.json    cards.bounty 129 张悬赏卡 ── effectId ──► effects.json 的 ENEMY_GAIN（1:1，运行时读）
                     cards.tactic  43 张战术卡 ── effectId ──► effects.json 的 BUFF_GAIN （1:1，运行时读）
                     events / pools / schedule / *Draft 等开局与商店配置（本编辑器不改）

data/effects.json    361 条效果本体，effectType 决定归属：
        ENEMY_GAIN 129 ← cards.bounty      BUFF_GAIN 43 ← cards.tactic
        BAND_INITIAL 41 ← bands.json       EQUIP 115 ← items.json
        BOND 23 ← bonds.json               ENEMY 6 · CHAR_MAP 4（见 §5）

data/bonds.json      23 条盟约 ── effectId ──► effects.json 的 BOND（1:1）
data/bands.json      40 条策略（乐队）── effectId ──► effects.json 的 BAND_INITIAL
data/garrisons.json  特质（本编辑器按 effectKey / eventType 派发，见 §4）
```

## 1. 道具（`items.json`）

### 1.1 数值有两个权威面（最容易改一半的地方）

| 谁读 | 读什么 | 出处 |
| --- | --- | --- |
| **战斗侧**（模拟对战） | 记录自己的 `buffs[]`：按每条 buff 的 `bbStr.key` 找符文实现，参数取 `{...bb, ...bbStr}` | `server/sim/content/items/battle.js`（`support.buffsOf` 在 `server/sim/content/support/index.js:63`） |
| **备战侧**（引擎内置效果） | 扁平化的 `params`：`rec.params.count` / `layer` / `refresh_cnt` … | `server/match/builtinMeta.js:36-40`（`paramsOf`） |
| **备战侧**（内容覆盖实现） | 又是 `buffs[]`：按 `key` 找那条 buff，再取 `{...bb, ...bbStr}` | `server/sim/content/items/meta.js:41`（`buffP`） |

**结论**：`buffs` 与 `params` 都可能被读，且读的代码路径不同。只改一处 → 同一件装备在备战期和战斗期表现不一致。

`params` 的生成口径（构建管线）：把所有 buff 的 `bb` 与 `bbStr` 依次摊平，**先出现者胜**（`if (!(k in params)) params[k] = v`，见 `tools/build-data.mjs:1811-1818`）。
所以**重名键会丢值**——现成例子：某件道具的两条 buff 各有一个 `attack_speed`（30 / 35），`params.attack_speed` 只留 30，而战斗侧仍按 +35 生效。
编辑器的「params 对照表 + 按 buffs 重建 params」就是照这个口径实现的，遇到重名键会写明「留下哪个、丢掉哪个」。

### 1.2 逐字段

| 字段 | 谁读 / 作用 | 风险 |
| --- | --- | --- |
| `id` | 全表主键；引擎按对象 key 查道具（`server/match/gamedata.js:185`） | 危险 |
| `name` / `desc` / `descRaw` | 界面显示走 `descRaw \|\| desc`（`public/js/ui/detailPanel.js`、`shopBar.js`、`effectsList.js`、`bandDraft.js`）；`desc` 是富文本的纯文本版 | 安全（文案） |
| `price` | 商店标价：`gd.itemPrice(id) = rec.price`（`server/match/player/economy.js:71`），负数会静默回落 2 | 谨慎 |
| `tier` | 抽取分档，**必须是 1..6 的整数**，否则会从所有商店池里消失（`server/sim/simdata.js`） | 危险 |
| `hideInShop` / `shopExcluded` | 商店排除条件（`isShopItem`，`server/sim/simdata.js:72-73`）：为真则从每个商店/补给/机密商店池消失 | 危险 |
| `shopExcludedBy` | 只是提示文案 | 安全 |
| `shopSortId` | `items.json` 里**没有任何读取者**（只有 `chess.json` 的同名字段用于编队排序） | 安全 |
| `mergeable` + `upgradeNum` | 三金合成：服务端与客户端都要求 `mergeable === true` 且 `1 < upgradeNum < 100`（`server/match/player/acquire.js:255-258`、`server/match/invariants.js:155-157`、`public/js/ui/gameLogic/placement.js`） | 危险 |
| `upgradeChessId` / `goldenId` | 合成后的目标记录（回退 `goldenId`） | 危险 |
| `isGolden` | 精锐标记；与 `_b` 后缀一致 | 危险 |
| `itemType` | `EQUIP` / `MAGIC`，决定装备位与「法术拖放」行为 | 危险 |
| `kind` | 结算方式（`passive` 常驻 / `consume_on_equip` 装备即销毁 / `art_instant` 法术立即 / …） | 危险 |
| `category` | 只影响商店分组与检索 | 安全 |
| `family` | 系列（`hammer` = 维多利亚锤系，会参与特殊效果判定） | 谨慎 |
| `duration` | 持续时间语义（`-1` 常驻 / `0` 立即），当前实现多按 `kind` 判定 | 谨慎 |
| `giveBondId` / `requiresBondId` | 关联 / 需要的盟约 id | 谨慎 |
| `canGiveBond` / `givePowerId` | 是否授予盟约资格 / 关联势力（当前数据里 `givePowerId` 全为 null） | 谨慎 |
| `trapId` / `iconId` | 图标与预制体 id | 安全（只影响图标） |
| `identifier` | 官方内部编号，仅溯源 | 安全 |
| `buffs` / `params` | 见 §1.1 | 危险 |
| `effectId` / `effectName` | **运行时无人读**：`items.json` 的 `effectId` 只是构建管线的溯源链接（`tools/build-data.mjs:2054-2057` 用它把 effects.json 的文案/数值抄一份过来）。改坏运行期毫无变化，但下次重建数据会让该道具的 desc/buffs/params 变空 | 安全（但重建会踩） |
| `implFormula` / `flavor` / `note` | 人工整理的公式说明 / 风味文本 / 备注，代码不读 | 安全 |
| `rangeGrid` | 法术的作用范围格 | 谨慎 |

## 2. 悬赏卡与战术卡（`choices.json` 的 `cards`）

| 字段 | 谁读 / 作用 |
| --- | --- |
| `effectId` | **卡与效果记录的连接键**（1:1）。抽卡池构建时按它取效果文案与类型：`server/match/choices.js:196-202`、`server/sim/content/choices.js:93-95` |
| `name` / `desc` | 卡面文字：`desc` 是主体，`descRaw` 回退到效果记录的 `descRaw`（`server/match/choices.js:199`） |
| `tier` | 卡片分档；也参与赏金对象（`bountyOf` 的 `tier` 回退） |
| `coin` / `payout` / `rounds` / `multiRound` | 赏金结算：`coin` 是给多少资金，`payout` 是 `kill`（击杀即给）或 `perfect`（完美作战才给），`rounds`/`multiRound` 决定持续几场（`server/match/choices.js:77-82`、`196-202`） |
| `enemyKey` / `count` | 给下场战斗加几个哪种敌人（`server/match/waves.js` 按它加敌人） |
| `draft` / `draftExcluded` / `draftPool` | 是否进机变抽卡池 / 排除条件 / 抽卡池分组（`server/match/choices.js:188-193`） |
| `series` | 同系列编号（成套出现） |
| `kind`（战术卡） | `ally` / `enemyDebuff` / `terrain`；`stageId` 限定关卡，`team` 是否作用于队友 |
| `adds[]` | ⚠ **运行时没有任何代码读它**（逐处核对过）：它只是数据整理时写下的「更细的加敌人规则」。真正生效的是卡上的扁平字段 + 效果记录里那条 buff 的黑板 |

**悬赏卡的两处真相**：同一个赏金的「给多少金 / 加几个敌人 / 持续几回合」在两个代码路径里各读一份——

- `server/match/choices.js` 的 `bountyCard()` 读**卡上**的扁平字段（用于抽卡池与赏金对象）；
- `server/sim/content/choices.js` 的 `bountyOf()` 从**效果的 buff 黑板**推（`bb.coin` / `bb.round` / `bb.count` / `bbStr.enemy_id`，`payout` 由 buff 的 key 决定）。

两边不一致不会崩，但「抽到的赏金」和「效果直接加的赏金」会不一样。编辑器的悬赏卡页会把这两列摆在一起对照。

## 3. 效果（`effects.json`）

| 字段 | 谁读 / 作用 |
| --- | --- |
| `effectId` | 主键；被卡片 / 道具 / 盟约 / 策略的 `effectId` 引用 |
| `effectType` | 归属类型，见 §0 的映射。运行时**唯一被比较取值**的是 `ENEMY_GAIN` 与 `BUFF_GAIN`（`server/sim/content/choices.js:167-168`） |
| `name` / `desc` / `descRaw` | 显示文本（卡片页、效果栏、悬赏对象） |
| `buffs` / `params` | 与道具同构：战斗侧读 `buffs`（按 `bbStr.key`），备战侧内置效果读 `params` |
| `counterType` | 官方数据全是 `NONE`，当前实现不读 | 
| `continuedRound` | 官方数据全是 `-1`，当前实现不读 |
| `decoIconId` | 效果栏图标 id |
| `enemyPrice` | 敌人价格；`bountyOf` 在 `bb.coin` 缺失时用它兜底（`server/sim/content/choices.js:111`） |

## 4. 特质 / 盟约 / 策略

- **特质**是按 `effectKey` 派发的：`registry.get('garrison:' + effectKey)`；`eventType` 经 `GARRISON_HOOK`（`server/match/effectsMeta.js`）映射到钩子，`IN_BATTLE` 走战斗内的另一条路径。键名不在白名单里 = **默默不触发**。
- **盟约**的战斗效果在上游源码里**按 id 写死**：`server/sim/content/bonds/core.js` 的 `BUFF_KEYS` 只映射 8 条核心盟约，`addon/` 里按 id 分支。所以**凭空新建一个盟约 id 不会带来战斗效果**，正确做法是复制一条已有的改数值（这也解释了为什么编辑器在盟约页给了「以现有盟约为模板合成」而不是「新建空盟约」）。
- **策略（乐队）**：`bands.json` 的记录同样带 `buffs` / `params`（结构等同道具），它的 `effectId` 指向 effects.json 的 `BAND_INITIAL`。本编辑器目前把 `bands.json` 作为**只读参照**加载，用来看「这条策略效果是谁的」。

## 5. 几个「看着有用、其实没人读」的地方

| 位置 | 事实 |
| --- | --- |
| `items.json` 的 `effectId` | 运行时无人读（§1.2） |
| `choices.cards.bounty[].adds[]` | 运行时无人读（§2） |
| `effects.json` 的 `ENEMY` 那 6 条 | 运行期无人读：同一套倍数在构建时被算成算式写进 `config.json` 的 `modes[].enemyScale`，比赛读的是 config（`server/match/gamedata.js:401-419`） |
| `CHAR_MAP` 那 4 条 | 客户端算练度倍率时读（`shared/potential.js:36`、`public/js/screens/cultivation.js:26-32`） |
| 3 个 buff 键 | 在上游源码里**找不到处理者**：`acbattle_shop_char_cultivate_effect`、`char_dynamic_ability_new`、`other_bond_add_trigger_cnt`（写了也不会有任何效果；词典里标红） |
| `bb` 键 `at_root` | 恒为 1 的标记字段，`server/` 全库无读取 |

## 6. 合成与商店的硬规则（改之前先看）

- 合成：**同名普通件凑够 `upgradeNum` 件 → 换成 `upgradeChessId`（回退 `goldenId`）**，获得时、装备/退回后都会扫一遍（`server/match/player/acquire.js:253-345`）。手牌、临时区、已装备件都算持有。
- 两处必须同时满足：`mergeable === true` **且** `1 < upgradeNum < 100`；`0` 与 `100` 都表示「永不合成」。
- 官方 50 对里，精锐版**没有一条**是 `mergeable: true`（精锐是合成结果，不是材料）。
- `tier` 非 1..6 的整数、`price` 为负，都会让道具从商店里**静默消失或改价**。
- 商店五兄弟的差别：`hideInShop` / `shopExcluded` 是「是否出现在商店」的排除条件，`shopExcludedBy` 只是说明文字，`shopSortId` 只影响展示顺序（且 `items.json` 里没人读），`tier` 决定分档。

## 7. 编辑器如何保证「按同一口径校验」

`tools/bond-editor.html` 里的校验规则就是按上面这些出处写的，例如：

- `buffs[].key` 不在中文词典（= 源码里没有处理者）→ **错误**；
- `bbStr.key` 不是已知战斗符文键 → **提醒**；
- `params` 与按 `buffs` 摊平的结果不一致 → **提醒**（并给出重建按钮）；
- `mergeable=true` 但 `upgradeNum` 不在范围内 → **错误**；
- `tier` 非 1..6 整数、`price` 为负 → **错误**；
- 卡的 `effectId` 悬空 / 类型与卡表不匹配 / 与另一张卡重复 → **提醒或错误**。

这些规则配套的自测在 `tools/bond-editor.test.mjs`（真实数据必须 0 错误），所以「编辑器说没问题」这句话是有测试兜底的。
