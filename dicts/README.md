# 中文词典原料与生成器

`tools/bond-editor.html` 是**单文件**编辑器，所有中文词典都已经烘进那个 HTML 里，正常使用**不需要**这个目录。
这里放的是词典原料与生成器，方便上游升版、键名变了以后重新生成。

| 文件 | 内容 |
| --- | --- |
| `buff-keys.json` | 70 个 `buffs[].key`（备战期处理器键）的中文、阶段、源码出处 |
| `runes.json` | 76 个 `bbStr.key`（战斗内符文键）的中文与出处；115 个 `bb` 数值键的中文与单位 |
| `fields.json` | items / choices / effects / bands 各字段的含义、风险等级，以及四个关键结论（`desc` 与 `descRaw`、合成规则、`effectId` 是否被运行时读取、`params` 与 `buffs` 的关系） |
| `gen-dicts.mjs` | 把上面三个 JSON 注回 `../tools/bond-editor.html` 的生成区（含人工复核的覆写表与 34 个补充键） |

## 重新生成

```bash
node dicts/gen-dicts.mjs          # 路径都相对本文件，在哪个目录调用都行
node tools/bond-editor.test.mjs   # 自测会检查「数据里用到的键是否都有中文」
```

## 口径

三个 JSON 都是**逐键到上游服务端源码里核对出处**得到的（不是按字段名猜的）：找每个键的处理器 / 符文实现，记下 `文件:行号` 与生效阶段。

因此下面这些是**如实标注**的，不是漏翻：

- 3 个键在上游源码里找不到处理者（写了也不会有任何效果）：
  `acbattle_shop_char_cultivate_effect`、`char_dynamic_ability_new`、`other_bond_add_trigger_cnt`；
- `bb` 的 `at_root` 没有任何读取者；
- 76 个符文键里有 16 个在源码中**从不被字面匹配**（按数据 / 道具 id / 盟约 id 驱动），它们的 `src` 指向实际的实现位置。

词典是「整理时的源码状态」，上游升版后个别说明可能过时——请以你所用版本的源码为准。
