// 把逐键核对出来的词典注入 tools/bond-editor.html 的生成区。
// 用法：node dicts/gen-dicts.mjs（路径都相对本文件，放在哪个目录都能跑）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = dirname(fileURLToPath(import.meta.url));
const HTML = join(DIR, '..', 'tools', 'bond-editor.html');
const ji = (o) => JSON.stringify(o);

const rows = (obj, fn) => Object.keys(obj).sort().map((k) => '  ' + ji(k) + ': ' + fn(obj[k]) + ',').join('\n');

// 人工复核后的修正（子代理给的字面描述对某些「通用壳」键不够准确）
const OVERRIDE = {
  env_gbuff_new_with_verify: {
    zh: '战斗增益通用壳：真正做什么由同一条 buff 的 bbStr.key 决定（道具/特质/盟约都复用它），数值取 bb',
    phase: '战斗',
    src: 'server/sim/content/items/battle.js:902',
  },
  env_gbuff_new: {
    zh: '战斗增益通用壳（旧键）：按 bbStr.key 分派，数值取 bb；盟约 addon 与策略也在用',
    phase: '战斗',
    src: 'server/sim/content/bonds/addon/battle.js:98',
  },
};

/*
 * 手工补的 bb 数值键（策略 BAND_INITIAL 与悬赏卡的参数，子代理那轮没覆盖到）。
 * 每条的出处都在注释里写了，取自 server/sim/content/bands/meta.js 的注释与实现。
 */
const BB_EXTRA = {
  round: ['第几回合 / 持续几回合后触发', '回合', 'server/sim/content/bands/meta.js:216'],
  coin: ['资金数（给多少金）', '数值', 'server/match/bot.js:245'],
  cnt: ['计数单位（数量或次数，由该效果自己解释）', '次数', 'server/sim/content/bands/meta.js:176'],
  coin_cnt: ['累计花费多少资金触发一次', '数值', 'server/sim/content/bands/meta.js:176'],
  max_count: ['上限次数（每回合 / 每次最多算几次）', '次数', 'server/sim/content/bands/meta.js:335'],
  preround: ['每隔几回合重复一次', '回合', 'server/sim/content/bands/meta.js:216'],
  capital: ['资金结转的本金门槛', '数值', 'server/sim/content/bands/meta.js:24'],
  interest: ['每份本金给的利息', '数值', 'server/sim/content/bands/meta.js:24'],
  minweight: ['随机权重区间下限（0.6 = 从己方前 60% 的敌人里选）', '百分比', 'server/sim/content/bands/meta.js:428'],
  maxweight: ['随机权重区间上限（0.99 = 到后 99% 为止）', '百分比', 'server/sim/content/bands/meta.js:428'],
  factioncount: ['要求同时激活的盟约条数', '个', 'server/sim/content/bands/meta.js:260'],
  count1: ['条件命中时加多少层', '层', 'server/sim/content/bands/meta.js:260'],
  count2: ['条件不满足时加多少层', '层', 'server/sim/content/bands/meta.js:260'],
  atk_per_cnt: ['每个计数单位提供的攻击力', '百分比', 'server/sim/content/bands/battle.js:199'],
  max_hp_per_cnt: ['每个计数单位提供的生命值', '百分比', 'server/sim/content/bands/battle.js:199'],
  refresh_count: ['每几次手动刷新触发一次', '次数', 'server/sim/content/bands/meta.js:347'],
  choice: ['选项编号（多选一时选第几个）', '数值', null],
  atk_1: ['第 1 档的攻击力加成', '百分比', null],
  atk_2: ['第 2 档的攻击力加成', '百分比', null],
  atk_3: ['第 3 档的攻击力加成', '百分比', null],
  max_hp_1: ['第 1 档的生命值加成', '百分比', null],
  max_hp_2: ['第 2 档的生命值加成', '百分比', null],
  max_hp_3: ['第 3 档的生命值加成', '百分比', null],
  value_1: ['第 1 档的数值', '数值', null],
  value_2: ['第 2 档的数值', '数值', null],
  value_3: ['第 3 档的数值', '数值', null],
  'char_605_cmedic#1': ['装置开关别名：干员 char_605_cmedic 的 1 号模块（1=启用、0=关闭）', '开关', null],
  'char_605_cmedic#2_multi_only': ['装置开关别名：char_605_cmedic 的 2 号模块（仅多人局）', '开关', null],
  'char_605_cmedic#3': ['装置开关别名：char_605_cmedic 的 3 号模块', '开关', null],
  'char_605_cmedic#4_multi_only': ['装置开关别名：char_605_cmedic 的 4 号模块（仅多人局）', '开关', null],
  'char_613_acmedc#1': ['装置开关别名：干员 char_613_acmedc 的 1 号模块', '开关', null],
  'char_613_acmedc#2_multi_only': ['装置开关别名：char_613_acmedc 的 2 号模块（仅多人局）', '开关', null],
  'char_613_acmedc#3': ['装置开关别名：char_613_acmedc 的 3 号模块', '开关', null],
  'char_613_acmedc#4_multi_only': ['装置开关别名：char_613_acmedc 的 4 号模块（仅多人局）', '开关', null],
};

let buffLines = 'const BUFF_KEY_ZH = {};';
if (existsSync(join(DIR, 'buff-keys.json'))) {
  const d = JSON.parse(readFileSync(join(DIR, 'buff-keys.json'), 'utf8'));
  for (const [k, v] of Object.entries(OVERRIDE)) if (d[k]) d[k] = { ...d[k], ...v };
  const n = Object.keys(d).length;
  buffLines = '/** buffs[].key（备战期处理器键）→ [中文, 阶段, 出处]。共 ' + n + ' 条。 */\n'
    + 'const BUFF_KEY_ZH = {\n' + rows(d, (v) => '[' + ji(v.zh) + ', ' + ji(v.phase) + ', ' + (v.src ? ji(v.src) : 'null') + ']') + '\n};';
}

let runeLines = 'const RUNE_ZH = {};';
if (existsSync(join(DIR, 'runes.json'))) {
  const d = JSON.parse(readFileSync(join(DIR, 'runes.json'), 'utf8'));
  const r = d.runes || {};
  const n = Object.keys(r).length;
  runeLines = '/** bbStr.key（战斗内符文键）→ [中文, 出处]。共 ' + n + ' 条。 */\n'
    + 'const RUNE_ZH = {\n' + rows(r, (v) => '[' + ji(v.zh) + ', ' + (v.src ? ji(v.src) : 'null') + ']') + '\n};';
}

let s = readFileSync(HTML, 'utf8');
const start = s.indexOf('/* BEGIN GENERATED DICTS */');
const end = s.indexOf('/* END GENERATED DICTS */');
if (start < 0 || end < 0) throw new Error('找不到生成区标记');
const head = s.slice(0, start);
const tail = s.slice(end);
const block = '/* BEGIN GENERATED DICTS */\n' + buffLines + '\n' + runeLines + '\n';
s = head + block + tail;

// bb 数值键的中文并进 BB_GLOSS（保持同一份字典，避免两个页面翻译不一致）
if (existsSync(join(DIR, 'runes.json'))) {
  const d = JSON.parse(readFileSync(join(DIR, 'runes.json'), 'utf8'));
  const bb = { ...(d.bb || {}) };
  for (const [k, [zh, unit]] of Object.entries(BB_EXTRA)) bb[k] = { zh, unit, src: null };
  const gs = s.indexOf('const BB_GLOSS = {');
  const ge = s.indexOf('\n};', gs);
  if (gs < 0 || ge < 0) throw new Error('找不到 BB_GLOSS');
  const body = s.slice(gs, ge);
  let main = '', gen = '';
  const cut = body.indexOf('  /* --BEGIN GENERATED BB-- */');
  if (cut >= 0) { main = body.slice(0, cut); gen = ''; } else { main = body; }
  const have = new Set([...main.matchAll(/^\s*"([^"]+)":\s*\[/gm)].map((m) => m[1]));
  /*
   * 单位映射。subagent 的 unit 是 ratio/sec/count/flat/unknown；unknown 的那批其实是
   * **字符串引用或开关标记**（id、bandId、事件名、装置开关 0/1），不该显示成「数值」。
   * 单位只影响显示（bbValueText 里只有「百分比」会做比例换算），但显示对了才看得出该填什么。
   */
  const SWITCH = /^(trap_\w+|char_\w+)#/;
  const REF = /(_id|_list|_exclude|_type|_band|_event|^bond$|^key$|^event$|^hammer_\d$|^big_hammer$|^equip_chess_id$|^other_equip$)/;
  const unitOf = (k) => {
    const u = bb[k].unit;
    if (u === 'ratio') return '百分比';
    if (u === 'sec') return '秒';
    if (u === 'count') return '次数';
    if (u === 'flat') return '数值';
    if (['数值', '百分比', '次数', '秒', '个', '层', '开关', '回合'].includes(u)) return u;
    if (SWITCH.test(k)) return '开关';
    if (REF.test(k)) return '文本';
    return '数值';
  };
  const add = Object.keys(bb).filter((k) => !have.has(k)).sort()
    .map((k) => '  ' + ji(k) + ': [' + ji(bb[k].zh) + ', ' + ji(unitOf(k)) + '],');
  const block2 = add.length ? '\n  /* --BEGIN GENERATED BB-- */\n' + add.join('\n') + '\n' : '';
  s = s.slice(0, gs) + main.replace(/\s+$/, '') + block2 + s.slice(ge);
  console.log('BB_GLOSS 新增 ' + add.length + ' 条:', add.length ? Object.keys(bb).filter((k) => !have.has(k)).sort().join(', ') : '（无）');
}

writeFileSync(HTML, s);
const cnt = (t) => (s.match(new RegExp(t, 'g')) || []).length;
console.log('注入完成：BUFF_KEY_ZH 条目 ' + cnt('^  "', 'm') + '（含 RUNE_ZH）；文件字节 ' + s.length);
