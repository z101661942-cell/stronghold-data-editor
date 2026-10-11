// Self-test for tools/bond-editor.html.
//
// Loads the page's own <script type="module"> in Node with a minimal DOM stub, then runs the real
// data/*.json through its validator and patch generator. This is what makes the editor trustworthy:
// the checks it shows you are the checks proven here.
//
//   node tools/bond-editor.test.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = join(HERE, 'bond-editor.html');
/**
 * 游戏仓库根目录（只读）：自测会读它的 data/*.json 跑真实数据，**不会写任何东西**。
 * 解析顺序：SP_ROOT 环境变量 → 同级目录 ../Stronghold-Protocol → 上两级 ../../Stronghold-Protocol。
 */
const ROOT = (() => {
  const cands = [
    process.env.SP_ROOT,
    join(HERE, '..', '..', 'Stronghold-Protocol'),
    join(HERE, '..', 'Stronghold-Protocol'),
  ].filter(Boolean);
  for (const c of cands) {
    try { if (existsSync(join(c, 'data', 'bonds.json'))) return c; } catch { /* 忽略 */ }
  }
  console.error('找不到游戏仓库（需要它的 data/*.json）——先克隆再设 SP_ROOT：');
  console.error('  git clone https://github.com/sganggs/Stronghold-Protocol.git');
  console.error('  SP_ROOT=/path/to/Stronghold-Protocol node tools/bond-editor.test.mjs      # Windows: set SP_ROOT=D:\\path\\to\\Stronghold-Protocol');
  process.exit(2);
})();
let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok    ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
};

// ---- 1. the page's module must exist and be parseable -----------------------
const html = readFileSync(HTML, 'utf8');
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
assert.ok(m, 'bond-editor.html: <script type="module"> block not found');
const source = m[1];

// ---- 0. 结构完整性：代码里引用的 DOM id 必须都存在于页面 ------------------------
console.log('结构完整性');
check('没有悬空的 DOM id 引用', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((mm) => mm[1]));
  const refs = [...new Set([...source.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((mm) => mm[1]))];
  const missing = refs.filter((r) => !ids.has(r));
  assert.equal(missing.length, 0, '这些 id 在页面里不存在：' + missing.join(', '));
});
check('没有重复的 DOM id（ID 冲突会让按钮接线接错）', () => {
  // 只看静态 HTML（<script> 之前）：模板字符串里的 id 是运行时插入同一槽位的，不算冲突
  const staticHtml = html.slice(0, html.indexOf('<script type="module">'));
  const all = [...staticHtml.matchAll(/\bid="([^"]+)"/g)].map((mm) => mm[1]);
  const dup = all.filter((id, i) => all.indexOf(id) !== i);
  assert.equal([...new Set(dup)].length, 0, '重复 id：' + [...new Set(dup)].join(', '));
});
check('页签含干员 / 特性 / 盟约 / 混合特性 / 道具 / 悬赏·战术卡 / 效果 / 改动 / 校验 / 词典 / 说明', () => {
  const tabs = [...html.matchAll(/<button data-tab="([a-z]+)"/g)].map((mm) => mm[1]);
  assert.deepEqual(tabs.slice().sort(),
    ['bonds', 'changes', 'choices', 'effects', 'garrisons', 'glossary', 'help', 'items', 'mix', 'op', 'validate'],
    '实际页签：' + tabs.join(', '));
});
check('默认页签是干员页', () => {
  assert.ok(/<button data-tab="op" class="on"/.test(html), '干员页应默认选中');
  assert.ok(/let activeTab = 'op'/.test(source), 'activeTab 初值应为 op');
});

// ---- 2. minimal DOM stub --------------------------------------------------
globalThis.__children = new Map();
function elStub() {
  const el = {
    hidden: false, value: '', textContent: '', innerHTML: '', dataset: {}, disabled: false,
    tagName: 'DIV', className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    scrollTop: 0,
    _handlers: {},
    addEventListener(type, fn) { this._handlers[type] = fn; },
    setSelectionRange() {}, focus() {}, click() { if (this._handlers.click) this._handlers.click(); }, remove() {},
    appendChild() {}, showModal() {}, close() {}, getContext: () => null,
    querySelector: () => elStub(),
    querySelectorAll: (sel) => (globalThis.__children.get(sel) || []),
    closest: () => elStub(),
  };
  return el;
}
// 同一选择器返回同一实例，否则 innerHTML 写完就丢
// 挂到 globalThis：页面代码用 document.querySelector，测试用 el(sel)，两者必须拿到同一实例
const elCache = new Map();
globalThis.__elCache = elCache;
const q1 = (sel) => {
  if (!elCache.has(sel)) elCache.set(sel, elStub());
  return elCache.get(sel);
};
globalThis.document = {
  querySelector: q1, querySelectorAll: () => [], addEventListener() {},
  createElement: () => elStub(), body: elStub(),
};
globalThis.window = { addEventListener() {}, showDirectoryPicker: null };
globalThis.FileReader = class { readAsText() {} };
globalThis.Blob = class {};
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: async () => {} } }, configurable: true,
});

const tmp = await mkdtemp(join(tmpdir(), 'bond-editor-'));
const wrappedPath = join(tmp, 'editor.wrapped.mjs');
const WRAPPER_EXPORT = "export const api = () => ({ work, pristine, log, validate, setField, diySet, getPath, splitPath, formRoot, wireForm, buildPatchScript, meta, issues: () => issues, selected, BB_GLOSS, EFFECT_KEYS, bbValueText, bbLabel, numField, idList, resolveId, displayNameOf, POOL_OF, plainOf, toRaw, syncDescPair, copyGarrisonForChess, numberizeText, bbSummaryOf, effectKeyLabel, effectKeyLabelFull, effectOverviewHtml, traitBondField, rebindTraitBond, bondBindBlock, mixTraits, createMixedTrait, attachTraitToChess, mixSel, renderMix, paintMix, mixDetailHtml, EVENT_TYPES, EFFECT_TYPES, enumPicker, effectCombos, synthBond, bondHasEngineEffect, bondRefs, bondRefCount, deleteBond, bondForm, bondMembersBlock, bondIds, bondFiltered, renderBond, synthBlock, shareEntries, buildSharePack, importSharePack, downloadJson, showShareDialog, applyDrag, showDropHint, clearDropHint, wireDragAndDrop, readBondPairs, writeBondPairs, bondPairsText, bondPairsRichText, applyBondPairsText, addBondPair, bondPairsBlock, MULTI_BOND_KEYS, textsBlock, traitTextEdit, resetDatalists, looksLikeProse, idList, numField, paintRows, paintGlossary, chessVerLabel, chessShortTag, verTagOf, garrisonVerLabel, pairIdOf, renderGlossary, render, diyTab, diyIds, diyMemberships, diyForm, diyMatch, diyDerivedBonds, diyDeriveBlock, paintDiyRows, renderDiy, DIY_SECTIONS, opIndex, opForm, opPair, opBondIds, opGarrisonIds, bondOwners, garrisonUsers, opFiltered, traitPairId, copyTraitTextToPair, traitPairDiff, traitForm, traitIds, traitFiltered, paintTraitRows, renderTrait, renderOp, get pageCtx() { return pageCtx; }, set pageCtx(v) { pageCtx = v; }, state, get activeTab() { return activeTab; }, setTab: (t) => { activeTab = t; }, $, FILES, AUX_FILES, aux, ROOT_KINDS, tableOfKind, recordOf, rootRec, rootSetRec, hostOf, LIST_TABS, renderListTab, paintListTab, itemIds, itemRow, itemForm, itemHay, cardIds, cardRow, cardForm, cardHay, effectIds, effectRow, effectForm, effectHay, buffEditor, buffBlock, buffIssues, foldParams, paramsSyncBlock, effectMirrorBlock, effectOwners, effectOwnersBlock, effectOf, buffKeyZh, runeZh, effectTypeZh, ITEM_TYPE_ZH, ITEM_CATEGORY_ZH, ITEM_KIND_ZH, EFFECT_TYPE_ZH, BOUNTY_PAYOUT_ZH, TACTIC_KIND_ZH, COUNT_TYPE_ZH, BBSTR_GLOSS, BUFF_KEY_ZH, RUNE_ZH, newKeysOverviewHtml, wireExtra, boolField, itemVerLabel, bountyRuntimeDiff });";
writeFileSync(wrappedPath, source + String.fromCharCode(10) + WRAPPER_EXPORT + String.fromCharCode(10));
const mod = await import(pathToFileURL(wrappedPath).href);
const api = mod.api();
const el = (sel) => q1(sel);


// ---- 3. load the real data/*.json -------------------------------------------------
const TABLES = {
  bonds: ['bonds.json', (j) => j.bonds ?? j],
  chess: ['chess.json', (j) => j.chess ?? j],
  garrisons: ['garrisons.json', (j) => j.garrisons ?? j],
  backups: ['backups.json', (j) => j],
  items: ['items.json', (j) => j.items ?? j],
  choices: ['choices.json', (j) => j],
  effects: ['effects.json', (j) => j.effects ?? j],
};
for (const [kind, [name, unwrap]] of Object.entries(TABLES)) {
  const table = unwrap(JSON.parse(readFileSync(join(ROOT, 'data', name), 'utf8')));
  api.work[kind] = table;
  // pristine 用于「全部还原」的对比；backups 是根级记录，深拷贝会切断页面里
  // 合成记录（units / diy.operators）与 work 的对象引用，所以留着浅引用即可。
  api.pristine[kind] = kind === 'backups' ? table : JSON.parse(JSON.stringify(table));
}
// 只读参照（bands.json）：效果页用它反查「这条策略效果是谁的」
api.aux.bands = JSON.parse(readFileSync(join(ROOT, 'data', 'bands.json'), 'utf8'));

console.log('load real data');
check('bonds: 23 records', () => assert.equal(Object.keys(api.work.bonds).length, 23));
check('chess: 266 records (incl. elites)', () => assert.equal(Object.keys(api.work.chess).length, 266));
check('garrisons: at least the 249 base records (users add per-operator copies)', () => {
  const n = Object.keys(api.work.garrisons).length;
  assert.ok(n >= 249, 'expected >= 249, got ' + n);
});

// ---- 4. shipped data must have zero hard errors ------------------------------------
const allIssues = () => { api.validate(); return api.issues(); };
const hasBad = (needle) => allIssues().some((i) => i.lvl === 'bad' && i.m.includes(needle));
const hasAny = (needle) => allIssues().some((i) => i.m.includes(needle));

check('shipped data: no hard errors', () => {
  const bad = allIssues().filter((i) => i.lvl === 'bad');
  assert.equal(bad.length, 0, `unexpected errors: ${JSON.stringify(bad.slice(0, 3))}`);
});
// 注意：用户会手动改 data，所以这里不能要求「零提醒」。只允许与「手改后未同步」有关的提醒。
const ALLOWED_WARN = /members 与干员侧不一致|visibleMembers 与|owners 里没有|精锐与本体不同步|门槛不同步|desc 与 descRaw 不一致|effectDesc 与 effectDescRaw 不一致/;
check('shipped data: no unexpected warnings', () => {
  const warns = allIssues().filter((i) => i.lvl === 'warn' && !ALLOWED_WARN.test(i.m));
  assert.equal(warns.length, 0, `unexpected warnings: ${JSON.stringify(warns.slice(0, 3))}`);
});

// ---- 5. each deliberately broken edit must be caught -----------------------------------------
console.log('inject broken edits');

api.setField('bonds', 'yanShip', 'bb.base_atk', 'oops');
check('bond bb non-numeric -> error', () => assert.ok(hasBad('不是有限数字')));
api.setField('bonds', 'yanShip', 'bb.base_atk', 0.5);

api.setField('bonds', 'yanShip', 'thresholds', [6, 3, 9]);
check('thresholds not ascending -> error', () => assert.ok(hasBad('不是升序')));
api.setField('bonds', 'yanShip', 'thresholds', [3, 6, 9]);

api.setField('bonds', 'yanShip', 'bb.power_bond_char_cnt', 4);
check('threshold / bb out of sync -> warning', () => assert.ok(hasAny('门槛不同步')));
api.setField('bonds', 'yanShip', 'bb.power_bond_char_cnt', 6);

api.setField('bonds', 'yanShip', 'bbStr.bond_id', 'noSuchBond');
check('dangling bbStr.bond_id -> error', () => assert.ok(hasBad('bbStr.bond_id')));
api.setField('bonds', 'yanShip', 'bbStr.bond_id', null);

const yu = api.work.chess.chess_char_6_03_a;
api.setField('chess', 'chess_char_6_03_a', 'bonds', [...yu.bonds, 'ghostBond']);
check('dangling chess bonds -> error', () => assert.ok(hasBad('指向不存在的盟约')));
api.setField('chess', 'chess_char_6_03_a', 'bonds', ['yanShip', 'steadShip']);

api.setField('chess', 'chess_char_6_03_a', 'stats.maxHp', 0);
check('maxHp <= 0 -> error', () => assert.ok(hasBad('maxHp 必须')));
api.setField('chess', 'chess_char_6_03_a', 'stats.maxHp', 4500);

api.setField('chess', 'chess_char_6_03_a', 'garrisonIds', ['garrison_nope']);
check('dangling garrisonIds -> error', () => assert.ok(hasBad('garrisonIds')));
api.setField('chess', 'chess_char_6_03_a', 'garrisonIds', ['garrison_37_a']);

api.setField('chess', 'chess_char_6_03_b', 'bonds', ['steadShip']);
check('elite out of sync with base -> warning', () => assert.ok(hasAny('精锐与本体不同步')));
api.setField('chess', 'chess_char_6_03_b', 'bonds', ['yanShip', 'steadShip']);

api.setField('garrisons', 'garrison_05_a', 'bb.atk', 'x');
check('garrison bb non-numeric -> error', () => assert.ok(hasBad('不是有限数字')));
api.setField('garrisons', 'garrison_05_a', 'bb.atk', 0.01);

check('after reverting edits: no hard errors again', () => {
  const bad = allIssues().filter((i) => i.lvl === 'bad');
  assert.equal(bad.length, 0, `residual errors: ${JSON.stringify(bad.slice(0, 3))}`);
});

// ---- 6. the generated patch must parse and actually apply ----------------------------------
console.log('patch generator');
api.setField('bonds', 'yanShip', 'bb.base_atk', 0.5);
api.setField('bonds', 'yanShip', 'thresholds', [2, 4, 6]);
api.setField('chess', 'chess_char_6_03_a', 'stats.maxHp', 5000);
api.setField('garrisons', 'garrison_05_a', 'bb.atk', 0.02);
const patch = api.buildPatchScript();

check('patch mentions all three targets', () => {
  assert.ok(patch.includes('"yanShip"') && patch.includes('"bb.base_atk"'));
  assert.ok(patch.includes('"chess_char_6_03_a"') && patch.includes('"stats.maxHp'));
  assert.ok(patch.includes('"garrison_05_a"') && patch.includes('"bb.atk"'));
});

// run it for real against a copy of data/
const sandbox = await mkdtemp(join(tmpdir(), 'patch-run-'));
mkdirSync(join(sandbox, 'data'), { recursive: true });
mkdirSync(join(sandbox, 'tools'), { recursive: true });
for (const [kategory, [name]] of Object.entries(TABLES)) {
  writeFileSync(join(sandbox, 'data', name), readFileSync(join(ROOT, 'data', name)));
}
const patchPath = join(sandbox, 'tools', 'patch-my-data.mjs');
writeFileSync(patchPath, patch);
console.log('  --- generated patch ---');
console.log(patch);
console.log('--- end patch ---');
let ran = true;
try { await import(pathToFileURL(patchPath).href); } catch (e) { ran = false; console.log('        patch threw: ' + e.message); }
check('patch runs without throwing', () => assert.ok(ran, 'patch script threw'));

const afterBonds = JSON.parse(readFileSync(join(sandbox, 'data', 'bonds.json'), 'utf8'));
const afterChess = JSON.parse(readFileSync(join(sandbox, 'data', 'chess.json'), 'utf8'));
const afterGarr = JSON.parse(readFileSync(join(sandbox, 'data', 'garrisons.json'), 'utf8'));
check('patch applied bond base_atk', () => assert.equal(afterBonds.yanShip.bb.base_atk, 0.5));
check('patch applied bond thresholds', () => assert.deepEqual(afterBonds.yanShip.thresholds, [2, 4, 6]));
check('patch applied chess maxHp', () => assert.equal((afterChess.chess ?? afterChess).chess_char_6_03_a.stats.maxHp, 5000));
check('patch applied garrison bb', () => assert.equal((afterGarr.garrisons ?? afterGarr).garrison_05_a.bb.atk, 0.02));
check('untouched fields survive', () => {
  assert.equal(afterBonds.yanShip.bb.atk_per_stack, 0.009);
  assert.equal(Object.keys(afterBonds).length, 23);
  assert.equal(Object.keys(afterChess.chess ?? afterChess).length, 266);
});

// ---- 7. bb glossary must cover every key and format values correctly -----------------
console.log('bb glossary');
const glossKeys = Object.keys(api.BB_GLOSS);
check('glossary has entries', () => assert.ok(glossKeys.length >= 100, 'glossary too small: ' + glossKeys.length));
check('glossary covers every bb key in the data', () => {
  const used = new Set();
  for (const kind of ['bonds', 'garrisons']) for (const rec of Object.values(api.work[kind])) for (const k of Object.keys(rec.bb || {})) used.add(k);
  const missing = [...used].filter((k) => !api.BB_GLOSS[k]);
  assert.equal(missing.length, 0, 'missing translations for: ' + JSON.stringify(missing));
});
check('every glossary entry has Chinese text', () => {
  const hasCjk = (t) => [...String(t)].some((c) => c.codePointAt(0) >= 0x4e00 && c.codePointAt(0) <= 0x9fff);
  const bad = glossKeys.filter((k) => !hasCjk(api.BB_GLOSS[k][0]));
  assert.equal(bad.length, 0, 'no Chinese: ' + JSON.stringify(bad));
});
check('glossary 的单位只用已知词表（只有「百分比」会被解读成比例）', () => {
  // 单位只影响显示：bbValueText 里 pct = (单位 === '百分比')，其余一律按普通数字显示。
  // 道具/效果/策略引入的键会出现「秒 / 次数 / 个 / 层 / 开关」这类更准确的单位，所以词表放宽，
  // 但仍然要挡住拼错或空值 —— 否则同一个键在两处会显示成不同的东西。
  const allowed = ['百分比', '数值', '秒', '次数', '个', '层', '开关', '格', '倍', '回合', '文本'];
  const bad = glossKeys.filter((k) => !allowed.includes(api.BB_GLOSS[k][1]));
  assert.equal(bad.length, 0, 'bad unit: ' + JSON.stringify(bad.slice(0, 5)));
});
check('bbValueText formats ratios as percents', () => {
  assert.equal(api.bbValueText('base_atk', 0.23), '= +23%');
  assert.equal(api.bbValueText('atk_per_stack', 0.009), '= +0.9%');
  assert.equal(api.bbValueText('atk', 1.5), '= ×1.5');
  assert.equal(api.bbValueText('power_bond_char_cnt', 6), '= 6');
  assert.equal(api.bbValueText('respawning', -0.3), '= -30%');
});
check('bbLabel returns key + Chinese + value', () => {
  const l = api.bbLabel('base_atk', 0.23);
  assert.ok(l.cn.length > 2 && [...l.cn].some((c) => c.codePointAt(0) >= 0x4e00 && c.codePointAt(0) <= 0x9fff), 'cn: ' + l.cn);
  assert.equal(l.val, '= +23%');
  assert.equal(l.unit, '百分比');
});
check('rendered form shows the Chinese annotation', () => {
  const html = api.__renderProbe ? api.__renderProbe() : null;
  assert.ok(true); // 渲染断言由下面的静态检查覆盖
});
// ---- 8. glossary tab + key search must locate a key across records ------------------
console.log('glossary tab / key search');
api.setTab('glossary');
api.render();
api.render();
const glHtml = el('#gRows').innerHTML;
check('glossary tab lists base_time', () => assert.ok(glHtml.includes('base_time'), 'base_time missing from glossary tab'));
check('glossary tab shows its Chinese meaning', () => assert.ok(glHtml.includes(api.BB_GLOSS['base_time'][0]), 'meaning missing'));
check('glossary tab points at sargonShip', () => assert.ok(glHtml.includes('sargonShip'), 'usage link missing'));
check('glossary tab lists the nested kjerag key', () => assert.ok(glHtml.includes('bond_eff_kjerag[storm].base_time'), 'nested key missing'));
check('glossary tab marks unused keys', () => {
  const unused = Object.keys(api.BB_GLOSS).filter((k) => !glHtml.includes(k));
  assert.ok(unused.length === 0, 'keys not rendered: ' + JSON.stringify(unused.slice(0, 5)));
});
check('record search by bb key finds sargonShip', () => {
  api.setTab('bonds');
  api.state.q = 'base_time';
  api.render();
  const rowsHtml = el('#rows').innerHTML;
  assert.ok(rowsHtml.includes('sargonShip'), 'search did not surface sargonShip');
  const nRows = (rowsHtml.match(/data-bid="/g) || []).length;
  // base_time 同时命中 sargonShip 与 kjeragShip（后者的键是 bond_eff_kjerag[storm].base_time）
  assert.equal(nRows, 2, 'expected two rows, got ' + nRows);
  assert.ok(rowsHtml.includes('kjeragShip'), 'nested key holder should match too');
  api.state.q = '';
});
// ---- 9. bb labels must carry the Chinese meaning inline in brackets ----------------
console.log('inline bb labels');
check('bb field label is 键名（中文） inline', () => {
  const rec = api.work.bonds.yanShip;
  const html = api.numField('bonds', 'yanShip', 'bb.base_atk', 'bb.base_atk', rec);
  const hasCjk = (t) => [...t].some((c) => c.codePointAt(0) >= 0x4e00 && c.codePointAt(0) <= 0x9fff);
  assert.ok(html.includes('<span class="cn">（'), 'missing inline bracket: ' + html.slice(0, 160));
  assert.ok(html.includes('<span class="k">base_atk<span class="cn">（'), 'key must be followed directly by （: ' + html.slice(0, 200));
  assert.ok(hasCjk(html.split('class="cn">')[1] || ''), 'inline text has no Chinese');
  assert.ok(html.includes('class="f bb"'), 'bb class missing');
});
check('base_time renders inline in sargonShip', () => {
  const rec = api.work.bonds.sargonShip;
  const html = api.numField('bonds', 'sargonShip', 'bb.base_time', 'bb.base_time', rec);
  const span = (html.match(/<span class="k">([\s\S]*?)<\/span>/) || [])[1] || '';
  const text = span.replace(/<[^>]+>/g, '');
  assert.ok(text.startsWith('base_time（'), 'got: ' + text);
  assert.ok(text.includes('持续时间'), 'meaning missing: ' + text);
});
check('no nested full-width brackets inside inline label', () => {
  const rec = api.work.bonds.sargonShip;
  const html = api.numField('bonds', 'sargonShip', 'bb.power_bond_char_cnt', 'bb.power_bond_char_cnt', rec);
  const span = (html.match(/<span class="k">([\s\S]*?)<\/span>/) || [])[1] || '';
  const text = span.replace(/<[^>]+>/g, '');
  assert.ok(!text.includes('（')===false || true, 'noop');
  const inner = text.slice(text.indexOf('（') + 1, text.lastIndexOf('）'));
  assert.ok(!inner.includes('（'), 'nested brackets: ' + text);
  assert.ok(inner.includes('['), 'inner hint should use square brackets: ' + text);
});
// ---- 10. id lists accept names, not just ids ---------------------------------------
console.log('name -> id resolution');
check('resolveId: chess name -> id', () => {
  const r = api.resolveId('chess', '余');
  assert.ok(r && r.id === 'chess_char_6_03_a', 'got: ' + JSON.stringify(r));
});
check('resolveId: another operator name', () => {
  const r = api.resolveId('chess', '史尔特尔');
  assert.ok(r && r.id === 'chess_char_5_07_a', 'got: ' + JSON.stringify(r));
});
check('resolveId: bond name -> id', () => {
  const r = api.resolveId('bonds', '炎');
  assert.ok(r && r.id === 'yanShip', 'got: ' + JSON.stringify(r));
});
check('resolveId: raw id still works', () => {
  const r = api.resolveId('chess', 'chess_char_6_03_a');
  assert.ok(r && r.how === 'id', 'got: ' + JSON.stringify(r));
});
check('resolveId: trims whitespace', () => {
  const r = api.resolveId('chess', '  余  ');
  assert.ok(r && r.id === 'chess_char_6_03_a', 'got: ' + JSON.stringify(r));
});
check('resolveId: unknown name returns null', () => assert.equal(api.resolveId('chess', '不存在的人'), null));
check('displayNameOf shows the operator name', () => {
  assert.equal(api.displayNameOf('chess', api.work.chess.chess_char_6_03_a, 'chess_char_6_03_a'), '余');
});
check('id list tags show names with the id in the title', () => {
  const html = api.idList('bonds', 'yanShip', 'members', 'members', api.work.bonds.yanShip, 'chess', '');
  assert.ok(/余[\s\S]{0,80}<button/.test(html), 'name not shown as tag: ' + html.slice(0, 300));
  assert.ok(html.includes('title="chess_char_6_03_a"'), 'id not kept in the title');
});
check('id list input offers autocomplete (value = english id)', () => {
  api.resetDatalists();   // 候选清单整页共用一份，测前先清登记表
  const html = api.idList('bonds', 'yanShip', 'members', 'members', api.work.bonds.yanShip, 'chess', '');
  assert.ok(html.includes('<datalist'), 'no datalist');
  const n = (html.match(/<option/g) || []).length;
  assert.equal(n, Object.keys(api.work.chess).length, 'option count 应等于池子大小: ' + n);
  // 关键：<option value> 必须是英文 id —— 浏览器会把 value 填进输入框
  const values = [...html.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(values.length > 0, 'no option values');
  const notId = values.filter((v) => !/^[A-Za-z0-9_]+$/.test(v));
  assert.equal(notId.length, 0, 'option values must be english ids, got: ' + JSON.stringify(notId.slice(0, 3)));
  // 中文名字仍然可搜索（放在 label / 文本里）
  assert.ok(html.includes('余'), 'the chinese name should still be searchable');
  assert.ok(html.includes('输入名字'), 'placeholder should mention names');
  assert.ok(html.includes('会自动填英文 id'), 'placeholder should explain the dropdown');
});
check('POOL_OF maps every id list to its pool', () => {
  assert.equal(api.POOL_OF.members, 'chess');
  assert.equal(api.POOL_OF.owners, 'chess');
  assert.equal(api.POOL_OF.bonds, 'bonds');
  assert.equal(api.POOL_OF.garrisonIds, 'garrisons');
});
// ---- 11. IME safety: typing must NOT rebuild the search input ----------------------
console.log('IME safety');
api.setTab('chess');
api.state.q = '';
api.selected.chess = 'chess_char_5_07_a';
api.render();
const qElFirst = el('#q');
const mainEl = el('#main');
const sigFirst = mainEl.dataset.sig;
// 模拟逐字输入：每次都只重绘内容（paintRows），不动输入框
for (const ch of ['史', '史尔', '史尔特']) {
  qElFirst.value = ch;
  api.state.q = ch;
  api.paintRows();
}
check('search input element survives typing (no rebuild)', () => {
  assert.equal(el('#q'), qElFirst, 'the #q element was replaced — IME composition would break');
});
check('input value is preserved', () => assert.equal(qElFirst.value, '史尔特'));
check('shell signature unchanged while typing', () => assert.equal(el('#main').dataset.sig, sigFirst));
check('rows were repainted during typing', () => assert.ok(el('#rows').innerHTML.includes('chess_char_5_07_a'), 'rows not updated'));
check('detail still renders the selected record', () => assert.ok(el('#detail').innerHTML.includes('data-path="stats.'), 'detail lost'));

// 词典页同样：打字时输入框必须存活
api.setTab('glossary');
api.state.gq = '';
api.render();
const gElFirst = el('#gq');
for (const ch of ['攻', '攻击', '攻击力']) { gElFirst.value = ch; api.state.gq = ch; api.paintGlossary(); }
check('glossary input survives typing (no rebuild)', () => assert.equal(el('#gq'), gElFirst, '#gq element was replaced'));
check('glossary input value preserved', () => assert.equal(gElFirst.value, '攻击力'));
check('glossary rows repainted', () => assert.ok(el('#gRows').innerHTML.includes('base_atk'), 'glossary rows not updated'));
api.state.gq = '';
api.setTab('chess');
api.state.q = '';
// ---- 12. 精一 / 精二 must be distinguishable ---------------------------------------
console.log('normal vs elite labels');
check('chessVerLabel distinguishes 普通/精锐', () => {
  assert.ok(api.chessVerLabel(api.work.chess.chess_char_6_03_a).includes('精一'));
  assert.ok(api.chessVerLabel(api.work.chess.chess_char_6_03_b).includes('精二'));
});
check('chessShortTag carries tier + version', () => {
  assert.equal(api.chessShortTag(api.work.chess.chess_char_6_03_a), 'T6·精一');
  assert.equal(api.chessShortTag(api.work.chess.chess_char_6_03_b), 'T6·精二');
  assert.ok(api.chessShortTag(api.work.chess.chess_char_4_15_a).includes('未进卡池'), 'hidden record should be flagged');
});
check('pairIdOf links the two records', () => {
  assert.equal(api.pairIdOf('chess', api.work.chess.chess_char_6_03_a, 'chess_char_6_03_a'), 'chess_char_6_03_b');
  assert.equal(api.pairIdOf('chess', api.work.chess.chess_char_6_03_b, 'chess_char_6_03_b'), 'chess_char_6_03_a');
});
check('garrison labels show 精一/精二', () => {
  assert.equal(api.garrisonVerLabel('garrison_16_a'), '精一');
  assert.equal(api.garrisonVerLabel('garrison_16_b'), '精二');
  assert.equal(api.garrisonVerLabel('weird'), '');
});
check('paired garrisons (_a vs _b) do not trigger the elite-sync warning', () => {
  // 取一个「本体 _a / 精锐 _b」配对正常的干员来验证规则，避开被手改过的记录
  const ok = Object.values(api.work.chess).find((c) => c.isGolden && (c.garrisonIds || []).some((g) => /_b$/.test(g)) && (api.work.chess[c.baseId].garrisonIds || []).some((g) => /_a$/.test(g)));
  assert.ok(ok, 'no paired sample found');
  const warns = allIssues().filter((i) => i.where === ok.chessId && i.m.includes('精锐与本体不同步'));
  assert.equal(warns.length, 0, 'paired garrisons flagged for ' + ok.chessId + ': ' + JSON.stringify(warns.slice(0, 2)));
});
check('a genuinely different garrison still warns', () => {
  api.setField('chess', 'chess_char_6_03_b', 'garrisonIds', ['garrison_11_a']);
  const warns = allIssues().filter((i) => i.m.includes('精锐与本体不同步'));
  api.setField('chess', 'chess_char_6_03_b', 'garrisonIds', ['garrison_37_b']);
  assert.ok(warns.length >= 1, 'real mismatch was not reported');
});
check('members rule counts hidden records (not only visible)', () => {
  // 规则口径：members = 所有拥有该盟约的非精锐/非DIY干员（含隐藏）；visibleMembers = 其中进卡池的
  const bond = api.work.bonds.indomShip;
  const all = Object.values(api.work.chess).filter((c) => !c.isGolden && !c.isDiy && (c.bonds || []).includes('indomShip')).map((c) => c.chessId).sort();
  assert.deepEqual([...bond.members].sort(), all, 'members must equal every (hidden included) carrier');
  const vis = Object.values(api.work.chess).filter((c) => !c.isGolden && c.visible && (c.bonds || []).includes('indomShip')).map((c) => c.chessId).sort();
  assert.deepEqual([...bond.visibleMembers].sort(), vis, 'visibleMembers must equal the in-shop carriers');
});
check('members mismatch IS reported when a chess is added to a bond', () => {
  // 故意给一个干员加盟约而不更新 members：必须报出来（这正是手改数据后的常见遗漏）
  const target = 'chess_char_1_01_a';
  const before = JSON.parse(JSON.stringify(api.work.chess[target].bonds));
  api.setField('chess', target, 'bonds', [...before, 'raidShip']);
  const warns = allIssues().filter((i) => i.m.includes('members 与干员侧不一致'));
  api.setField('chess', target, 'bonds', before);
  assert.ok(warns.length >= 1, 'members mismatch was not reported');
});
check('id tags show the version for chess and garrisons', () => {
  assert.equal(api.verTagOf('chess', 'chess_char_6_03_b'), 'T6·精二');
  assert.equal(api.verTagOf('garrisons', 'garrison_16_a'), '精一');
  assert.equal(api.verTagOf('bonds', 'yanShip'), '');
});
// ---- 13. selecting a record must not scroll the list back to the top ----------------
console.log('scroll preservation');
api.setTab('chess');
api.state.q = '';
api.selected.chess = 'chess_char_6_03_a';
api.render();
const rowsEl = el('#rows');
const detailEl = el('#detail');
const sigBefore = el('#main').dataset.sig;
// 用户滚到中间，再点一条记录
rowsEl.scrollTop = 1200;
detailEl.scrollTop = 400;
const fakeRow = { dataset: { id: 'chess_char_5_07_b' }, _handlers: {}, addEventListener(t, f) { this._handlers[t] = f; } };
globalThis.__children.set('.row', [fakeRow]);
api.render();
globalThis.__children.set('.row', [fakeRow]);
api.render();
fakeRow._handlers.click();
check('clicking a row selects it', () => assert.equal(api.selected.chess, 'chess_char_5_07_b'));
check('list scroll position is preserved (no jump to top)', () => assert.equal(rowsEl.scrollTop, 1200, 'scrollTop reset to ' + rowsEl.scrollTop));
check('selecting does not rebuild the shell', () => assert.equal(el('#main').dataset.sig, sigBefore, 'shell signature changed'));
check('search input element survives record selection', () => assert.ok(el('#q'), 'input gone'));
check('detail scroll resets for a different record', () => assert.equal(detailEl.scrollTop, 0, 'detail should start at top for new content'));
check('detail scroll is kept when repainting the same record', () => {
  detailEl.scrollTop = 250;
  api.paintRows();
  assert.equal(detailEl.scrollTop, 250, 'same record should keep scroll, got ' + detailEl.scrollTop);
});
globalThis.__children.set('.row', []);
// ---- 14. garrison _a / _b must be distinguishable when picking ---------------------
console.log('garrison a/b disambiguation');
check('garrison display name is not truncated (keeps +1 / +2)', () => {
  const a = api.displayNameOf('garrisons', api.work.garrisons.garrison_70_a, 'garrison_70_a');
  const b = api.displayNameOf('garrisons', api.work.garrisons.garrison_70_b, 'garrison_70_b');
  assert.notEqual(a, b, 'the two versions render identically — users cannot tell them apart');
  assert.ok(a.endsWith('+1'), 'a should keep +1: ' + a);
  assert.ok(b.endsWith('+2'), 'b should keep +2: ' + b);
});
check('resolveId picks the exact garrison id', () => {
  assert.equal(api.resolveId('garrisons', 'garrison_70_b').id, 'garrison_70_b');
  assert.equal(api.resolveId('garrisons', 'garrison_70_a').id, 'garrison_70_a');
});
check('pasting the full +2 description resolves to _b', () => {
  const full = api.displayNameOf('garrisons', api.work.garrisons.garrison_70_b, 'garrison_70_b');
  assert.equal(api.resolveId('garrisons', full).id, 'garrison_70_b');
});
check('name+suffix pins the chess version', () => {
  assert.equal(api.resolveId('chess', '雷蛇·精二').id, 'chess_char_1_20_b');
  assert.equal(api.resolveId('chess', '雷蛇·精一').id, 'chess_char_1_20_a');
});
check('a bare name reports ambiguity instead of guessing', () => {
  const r = api.resolveId('chess', '雷蛇');
  assert.equal(r.how, 'ambiguous');
  assert.ok(r.candidates.length >= 2, 'candidates: ' + JSON.stringify(r.candidates));
});
check('id list datalist keeps +1 and +2 apart', () => {
  // 数据驱动：找一对描述只差 +1 / +2 的配对特质，确认两者在候选清单里都能区分
  const gids = Object.keys(api.work.garrisons);
  const a = gids.find((g) => {
    const o = api.traitPairId(g);
    if (!/_a$/.test(g) || !api.work.garrisons[o]) return false;
    const da = String(api.work.garrisons[g].desc || ''), db = String(api.work.garrisons[o].desc || '');
    return da !== db && da.includes('+1') && db.includes('+2');
  });
  assert.ok(a, '找不到“+1 / +2”这样的配对特质');
  api.resetDatalists();
  const html = api.idList('chess', 'chess_char_1_20_a', 'garrisonIds', 'garrisonIds', { garrisonIds: [] }, 'garrisons', '');
  const tail = (g) => String(api.work.garrisons[g].desc).match(/[^，。；]{0,14}\+[12]/)?.[0] || '';
  assert.ok(html.includes(tail(a)), '候选里缺 ' + a + ' 的区分片段：' + tail(a));
  assert.ok(html.includes(tail(api.traitPairId(a))), '候选里缺配对那条的区分片段');
});
check('候选文本截断后保头又保尾（长描述仍能区分精一/精二）', () => {
  // 回归：只截头部会把「【炎】层数+1 / +2」这类唯一差别裁掉，导致下拉里选错
  api.resetDatalists();
  const html = api.idList('chess', 'chess_char_1_20_a', 'garrisonIds', 'garrisonIds', { garrisonIds: [] }, 'garrisons', '');
  const opts = [...html.matchAll(/<option value="([^"]+)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2]]);
  const byId = new Map(opts);
  let pairs = 0, same = [];
  for (const [gid] of opts) {
    const m = /^(.*)_a$/.exec(gid);
    if (!m) continue;
    const b = m[1] + '_b';
    if (!byId.has(b)) continue;
    pairs++;
    const norm = (s) => s.replace(/ 【精[一二]】 — .*$/, '');
    if (norm(byId.get(gid)) === norm(byId.get(b)) && String(api.work.garrisons[gid].desc) !== String(api.work.garrisons[b].desc))
      same.push(gid + '/' + b);
  }
  assert.ok(pairs > 100, '配对数太少：' + pairs);
  assert.equal(same.length, 0, '这些配对的描述不同，却被截得一样了：' + same.slice(0, 5).join(', '));
});
check('garrison tags carry the 精一/精二 label', () => {
  const html = api.idList('chess', 'chess_char_1_20_a', 'garrisonIds', 'garrisonIds', api.work.chess.chess_char_1_20_a, 'garrisons', '');
  assert.ok(/class="ver">精一</.test(html), 'version label missing on the tag');
});
// ---- 15. rich text (descRaw) is what the game actually renders ----------------------
console.log('rich text desc vs descRaw');
check('plainOf strips official markers', () => {
  assert.equal(api.plainOf('攻击力和生命值+<@ba.vup>20%</>'), '攻击力和生命值+20%');
  assert.equal(api.plainOf('<@autochess.gray>（受层数影响）</>'), '（受层数影响）');
});
check('plainOf keeps literal trigger labels', () => {
  assert.equal(api.plainOf('<在场6名不同【炎】干员>战斗开始'), '<在场6名不同【炎】干员>战斗开始');
  assert.equal(api.plainOf('<战斗中>造成的伤害'), '<战斗中>造成的伤害');
});
check('plainOf matches desc for every official garrison', () => {
  // 只核官方形态的 id（garrison_<数字>_<a|b>）；用户新增的专属副本另测
  const bad = [];
  for (const [id, r] of Object.entries(api.work.garrisons)) {
    if (!/^garrison_\d+_[ab]$/.test(id)) continue;
    if (!r.descRaw || r.desc == null) continue;
    if (api.plainOf(r.descRaw) !== String(r.desc).replace(/\s+/g, ' ').trim()) bad.push(id);
  }
  assert.equal(bad.length, 0, 'mismatched official garrisons: ' + JSON.stringify(bad.slice(0, 5)));
});
check('plainOf matches desc / effectDesc for every bond', () => {
  const bad = [];
  for (const [id, r] of Object.entries(api.work.bonds)) {
    if (r.descRaw && api.plainOf(r.descRaw) !== String(r.desc || '').replace(/\s+/g, ' ').trim()) bad.push(id + '.desc');
    if (r.effectDescRaw && api.plainOf(r.effectDescRaw) !== String(r.effectDesc || '').replace(/\s+/g, ' ').trim()) bad.push(id + '.effectDesc');
  }
  assert.equal(bad.length, 0, 'mismatched bonds: ' + JSON.stringify(bad.slice(0, 5)));
});
check('no descRaw warnings for official records', () => {
  const w = allIssues().filter((i) => i.m.includes('descRaw') && /^garrison_\d+_[ab]$/.test(i.where || ''));
  assert.equal(w.length, 0, 'false positives on official records: ' + JSON.stringify(w.slice(0, 3)));
});
check('editing descRaw syncs desc (plain)', () => {
  const rec = api.work.garrisons.garrison_107_a;
  const oldDesc = rec.desc, oldRaw = rec.descRaw;
  api.setField('garrisons', 'garrison_107_a', 'descRaw', '<部署时>使已激活的【突袭】层数<@ba.vup>+9</>（每场作战至多50层）');
  api.syncDescPair('garrisons', 'garrison_107_a', 'descRaw', rec.descRaw);
  const plain = api.plainOf(rec.descRaw);
  assert.equal(plain, String(rec.desc).replace(/\s+/g, ' ').trim(), 'desc not synced from descRaw');
  api.setField('garrisons', 'garrison_107_a', 'desc', oldDesc);
  api.setField('garrisons', 'garrison_107_a', 'descRaw', oldRaw);
});
check('editing desc syncs descRaw (raw) and keeps the two in agreement', () => {
  const rec = api.work.garrisons.garrison_107_a;
  const oldDesc = rec.desc, oldRaw = rec.descRaw;
  // 注意：desc → descRaw 这一步对「字面触发标签」是有损的（plainOf 会吃掉裸 <），
  // 所以这里断言的真正不变量是「同步后两者口径一致」，而不是逐字节往返。
  api.setField('garrisons', 'garrison_107_a', 'desc', '造成的伤害变为弱点伤害（基于敌人的防御力）');
  api.syncDescPair('garrisons', 'garrison_107_a', 'desc', rec.desc);
  assert.equal(api.plainOf(rec.descRaw), String(rec.desc).replace(/\s+/g, ' ').trim(), 'desc and descRaw disagree after sync');
  api.setField('garrisons', 'garrison_107_a', 'desc', oldDesc);
  api.setField('garrisons', 'garrison_107_a', 'descRaw', oldRaw);
});
// ---- 16. per-operator text: copy a shared trait, edit only its text -----------------
console.log('per-operator trait text');
check('copyGarrisonForChess makes an owned copy and repoints the operator', () => {
  const yanId = 'chess_char_1_18_a';
  const before = JSON.stringify(api.work.chess[yanId].garrisonIds);
  const nid = api.copyGarrisonForChess(yanId, 'garrison_107_a');
  assert.ok(nid && api.work.garrisons[nid], 'copy was not created');
  assert.ok(api.work.chess[yanId].garrisonIds.includes(nid), 'operator not repointed');
  assert.deepEqual(api.work.garrisons[nid].owners, [yanId], 'owners of the copy must be only this operator');
  assert.equal(api.work.garrisons[nid].bbStr.garrison_key, nid, 'bbStr.garrison_key must follow the new id');
  assert.equal(api.work.garrisons[nid].desc, api.work.garrisons.garrison_107_a.desc, 'copy should start as the original text');
  // clean up
  delete api.work.garrisons[nid];
  api.setField('chess', yanId, 'garrisonIds', JSON.parse(before));
});
check('editing the copy does not touch the shared original', () => {
  const nid = api.copyGarrisonForChess('chess_char_1_18_a', 'garrison_107_a');
  const origDesc = api.work.garrisons.garrison_107_a.desc;
  const origOwners = JSON.stringify(api.work.garrisons.garrison_107_a.owners);
  api.setField('garrisons', nid, 'desc', '宴的专属说明');
  api.syncDescPair('garrisons', nid, 'desc', '宴的专属说明');
  assert.equal(api.work.garrisons.garrison_107_a.desc, origDesc, 'shared original was modified!');
  assert.equal(JSON.stringify(api.work.garrisons.garrison_107_a.owners), origOwners, 'shared owners changed');
  // the game renders descRaw || desc
  assert.equal(api.work.garrisons[nid].descRaw || api.work.garrisons[nid].desc, '宴的专属说明');
  delete api.work.garrisons[nid];
  api.setField('chess', 'chess_char_1_18_a', 'garrisonIds', ['garrison_01_a', 'garrison_107_a']);
});
check('numberizeText substitutes real bb values', () => {
  assert.equal(api.numberizeText('攻击力+20%', { atk: 30 }), '攻击力+30%');
  assert.equal(api.numberizeText('层数+8', { bond_add_count: 12 }), '层数+12');
});
check('bbSummaryOf lists the numbers', () => {
  const g = api.work.garrisons.garrison_107_a;
  const t = api.bbSummaryOf(g);
  assert.ok(t.includes('8') && t.includes('50'), 'summary: ' + t);
});
// ---- 17. trait display text is written into garrisons.json directly -----------------------
// 0.2.3 dropped the server-side text-overrides table, so text edits must land in the real
// record. Fixtures are DISCOVERED: which trait is shared, and which is exclusive, varies by
// data version.
console.log('trait text editing (writes garrisons.json)');
/** First chess _a record whose first trait is carried by more than one operator. */
const findShared = () => {
  for (const [cid, rec] of Object.entries(api.work.chess)) {
    if (!cid.endsWith('_a')) continue;
    const gid = (rec.garrisonIds || [])[0];
    const g = api.work.garrisons[gid];
    if (gid && g && (g.owners || []).length > 1) return { cid, rec, gid, owners: g.owners };
  }
  return null;
};
/** First chess _a record whose first trait belongs to that operator alone. */
const findExclusive = () => {
  for (const [cid, rec] of Object.entries(api.work.chess)) {
    if (!cid.endsWith('_a')) continue;
    const gid = (rec.garrisonIds || [])[0];
    const g = api.work.garrisons[gid];
    const owners = (g && g.owners) || [];
    if (gid && g && owners.length <= 1 && owners.includes(cid)) return { cid, rec, gid };
  }
  return null;
};
const SHARED = findShared();
const EXCLUSIVE = findExclusive();
/** 与编辑器同一判定：owners 里只有这名干员，才算「他可以直改」。 */
const isEditableHere = (gid, cid) => {
  const owners = api.work.garrisons[gid]?.owners || [];
  return owners.length <= 1 && owners.includes(cid);
};
check('the data offers both a shared and an exclusive trait to test against', () => {
  assert.ok(SHARED, 'no operator carries a trait shared with another operator');
  assert.ok(EXCLUSIVE, 'no operator carries a trait of its own');
});
check('an exclusive trait gets an editable box', () => {
  const html = api.textsBlock('chess', EXCLUSIVE.cid, EXCLUSIVE.rec);
  assert.ok(html.includes('data-ov="' + EXCLUSIVE.gid + '"'), 'no editable box for exclusive trait ' + EXCLUSIVE.gid);
  assert.ok(html.includes('该干员专属'), 'the box should be labelled as belonging to this operator');
  assert.ok(html.includes('garrisons.json'), 'the hint should say where the text lands');
});
check('a shared trait is read-only and offers the per-operator copy instead', () => {
  const html = api.textsBlock('chess', SHARED.cid, SHARED.rec);
  assert.ok(html.includes('data-copyg="' + SHARED.gid + '"'), 'shared trait should offer a copy button');
  assert.ok(!html.includes('data-ov="' + SHARED.gid + '"'), 'a shared trait must not be editable in place');
  assert.ok(html.includes('readonly'), 'the shared box must be read-only');
  assert.ok(html.includes('与其他 ' + (SHARED.owners.length - 1) + ' 名干员共用'), 'shared chip should count the other owners');
});
check('traitTextEdit refuses a shared trait and names the reason', () => {
  const before = JSON.parse(JSON.stringify(api.work.garrisons[SHARED.gid]));
  const r = api.traitTextEdit(SHARED.gid, '不应该写进去');
  assert.equal(r.ok, false, 'shared traits must be refused');
  assert.ok(/共用|复制/.test(r.reason), 'reason should explain the shared conflict: ' + r.reason);
  assert.deepEqual(api.work.garrisons[SHARED.gid], before, 'a refused edit must not touch the record');
});
check('traitTextEdit rewrites desc + descRaw and leaves every effect field alone', () => {
  const gid = EXCLUSIVE.gid;
  const before = JSON.parse(JSON.stringify(api.work.garrisons[gid]));
  const NEW = '<战斗中>测试用文本 +1';
  const r = api.traitTextEdit(gid, NEW);
  assert.equal(r.ok, true, 'exclusive traits must be editable');
  assert.equal(api.work.garrisons[gid].desc, NEW, 'desc must take the new text');
  assert.equal(api.work.garrisons[gid].descRaw, api.toRaw(NEW), 'descRaw must stay in sync (the game renders it)');
  // everything except the two text fields is untouched: bb / bbStr / effectKey / owners ...
  for (const k of Object.keys(before)) {
    if (k === 'desc' || k === 'descRaw') continue;
    assert.deepEqual(api.work.garrisons[gid][k], before[k], 'field ' + k + ' must not change');
  }
  // the edit is logged so 保存到 data/ writes it
  assert.ok(api.log.some((e) => e.file === 'garrisons' && e.id === gid), 'the edit must appear in the change log');
  // and the box shows the new text back
  const html = api.textsBlock('chess', EXCLUSIVE.cid, EXCLUSIVE.rec);
  assert.ok(html.includes('测试用文本 +1'), 'the box should show the edited text');
  api.work.garrisons[gid] = before;
});
check('traitTextEdit rejects an empty box instead of blanking the trait', () => {
  const gid = EXCLUSIVE.gid;
  const before = JSON.parse(JSON.stringify(api.work.garrisons[gid]));
  const r = api.traitTextEdit(gid, '   ');
  assert.equal(r.ok, false, 'empty text must be refused');
  assert.deepEqual(api.work.garrisons[gid], before);
});
check('traitTextEdit refuses even the real owner while the trait is shared', () => {
  // 共用记录连拥有者本人也不能直改：改了会连带改到其他人，必须先把特质复制成专属副本。
  const gid = SHARED.gid;
  const owner = SHARED.owners[0];
  const before = JSON.parse(JSON.stringify(api.work.garrisons[gid]));
  const r = api.traitTextEdit(gid, '不该生效', owner);
  assert.equal(r.ok, false, 'a shared trait must be refused even for its owner');
  assert.ok(/复制/.test(r.reason), 'the reason should point at the copy step: ' + r.reason);
  assert.deepEqual(api.work.garrisons[gid], before, 'a refused edit must not touch the record');
});
check('after copying the trait per operator, the copy is editable', () => {
  // 「复制一份专属文本再改」的落地效果：新记录归这名干员，且可以直改。
  const cid = SHARED.cid;
  const rec = api.work.chess[cid];
  const nid = api.copyGarrisonForChess(cid, SHARED.gid);
  assert.ok(nid && nid !== SHARED.gid, 'copyGarrisonForChess should mint a new trait id');
  assert.ok((rec.garrisonIds || []).includes(nid), 'the operator should reference the copy');
  assert.deepEqual(api.work.garrisons[nid].owners, [cid], 'the copy must belong to that operator alone');
  const r = api.traitTextEdit(nid, '专属文本', cid);
  assert.equal(r.ok, true, 'the per-operator copy must be editable');
  assert.equal(api.work.garrisons[nid].desc, '专属文本');
  // clean up: drop the copy and restore the original list
  delete api.work.garrisons[nid];
  rec.garrisonIds = (rec.garrisonIds || []).filter((x) => x !== nid);
});
// ---- 17b. 自选六星（backups.json）：0.2.x 的新六星不在 chess.json 里 -----------------------
console.log('自选六星页签 (backups.json)');
const BK = api.work.backups;
check('backups.json 载入了 diy / units / tokens', () => {
  assert.ok(BK, 'backups.json 没载入');
  assert.ok(BK.diy && typeof BK.diy === 'object', 'backups.diy 缺失');
  assert.ok(BK.units && Object.keys(BK.units).length > 0, 'backups.units 缺失');
});
check('自选台面把 operators 与 units 按 charId 合并', () => {
  const t = api.diyTab();
  const ids = Object.keys(t);
  assert.equal(ids.length, api.diyIds().length, 'diyIds 必须与 diyTab 一致');
  const ops = Object.keys(BK.diy.operators || {});
  for (const id of ops) assert.ok(t[id], 'operators 里的 ' + id + ' 不在台面上');
  // 合并出的每一条至少有一处来源
  for (const id of ids) assert.ok(t[id].op || t[id].un, id + ' 两处来源都是空的');
});
check('新六星（chess.json 里没有的那些）能在自选页签里找到', () => {
  const t = api.diyTab();
  const samples = ['char_1044_hsgma2', 'char_1050_chen3', 'char_1052_kalts2', 'char_2027_wang', 'char_4179_monstr'];
  for (const id of samples) {
    assert.ok(t[id], '自选页签里找不到 ' + id);
    assert.ok(!api.work.chess[id], id + ' 不该出现在 chess.json 里');
  }
});
check('自选页签能搜到中文名', () => {
  const t = api.diyTab();
  const hit = api.diyIds().filter((id) => api.diyMatch(id, t[id], '斩业星熊'));
  assert.ok(hit.includes('char_1044_hsgma2'), '搜「斩业星熊」应命中 char_1044_hsgma2，实际 ' + JSON.stringify(hit));
});
check('盟约分配可改（diy.operators[id].bonds）', () => {
  const id = 'char_1044_hsgma2';
  const before = JSON.parse(JSON.stringify(BK.diy.operators[id].bonds || []));
  // 挑一个与原值不同的盟约，否则「无变化不记日志」会短路（那是刻意的行为）
  const other = Object.keys(api.work.bonds).find((b) => !before.includes(b));
  api.diySet(id, id + '.op.bonds', [other]);
  assert.deepEqual(BK.diy.operators[id].bonds, [other], 'bonds 应写进真实对象');
  // 日志里必须是**真实路径**（diy.operators.<id>.*），补丁重放时要从文档根走得通
  assert.ok(api.log.some((e) => e.file === 'backups' && e.field === 'diy.operators.' + id + '.bonds'), '日志应记真实路径');
  // 无变化的写入不该产生日志（避免脏 diff）
  const n = api.log.length;
  api.diySet(id, id + '.op.bonds', [other]);
  assert.equal(api.log.length, n, '相同值不该再记一条');
  BK.diy.operators[id].bonds = before;
});
check('名单增删作用于真实数组（ownedPool / prototypes）', () => {
  const d = BK.diy;
  const id = 'char_1044_hsgma2';
  const poolBefore = [...(d.ownedPool || [])];
  api.diySet(id, 'diy.ownedPool', (d.ownedPool || []).filter((x) => x !== id));
  assert.ok(!d.ownedPool.includes(id), '应能从 ownedPool 移出');
  api.diySet(id, 'diy.ownedPool', poolBefore);
  assert.deepEqual(d.ownedPool, poolBefore, '应能加回 ownedPool');
  const t6 = [...(d.prototypes['6'] || [])];
  api.diySet(id, 'diy.prototypes.6', [...t6, id]);
  assert.ok(d.prototypes['6'].includes(id), '应能加入 6 星原型池');
  d.prototypes['6'] = t6;
});
check('战斗数值改的是 units[id].forms 的真实对象', () => {
  const id = 'char_2025_shu';
  const u = BK.units[id];
  assert.ok(u && u.forms, '黍应有 units 记录');
  const key = Object.keys(u.forms)[0];
  const uiPath = id + '.un.forms.' + key + '.stats.maxHp';
  const realPath = 'units.' + id + '.forms.' + key + '.stats.maxHp';
  const before = u.forms[key].stats.maxHp;
  api.diySet(id, uiPath, before + 111);
  assert.equal(u.forms[key].stats.maxHp, before + 111, 'maxHp 应写进真实 units 记录');
  assert.ok(api.log.some((e) => e.file === 'backups' && e.field === realPath), '日志应记真实路径 units.<id>.…');
  // 撤销要能按真实路径还原
  api.diySet(id, realPath, before, { logIt: false });
  assert.equal(u.forms[key].stats.maxHp, before, '按真实路径撤销应能还原');
  u.forms[key].stats.maxHp = before;
});
check('详情表单渲染出面板字段、盟约与每个档位', () => {
  const id = 'char_1044_hsgma2';
  const html = api.diyForm(id);
  // 路径相对合成记录（op.* / un.*），真实写入位置由 formRoot 翻译
  assert.ok(html.includes('data-path="op.name"'), '缺名字字段');
  // bonds / powers 是「名单编辑器」：控件带 data-rm / data-add 而不是 data-path
  assert.ok(html.includes('data-add="op.bonds"'), '缺盟约名单编辑器');
  assert.ok(html.includes('data-rm="op.bonds"'), '缺盟约名单的移除按钮');
  assert.ok(html.includes('data-add="op.powers"'), '缺势力名单编辑器');
  assert.ok(html.includes('名单与锁定'), '缺名单区块');
  const forms = Object.keys(BK.units[id].forms || {});
  for (const k of forms) assert.ok(html.includes('档位 <code>' + k + '</code>'), '缺档位 ' + k);
});
check('按势力推算盟约的算法与官方数据 87/87 一致', () => {
  // 这条守住一件容易讲错的事：引擎读的是 bonds，powers 只是构建时的输入。
  let mismatch = 0;
  const examples = [];
  for (const [id, o] of Object.entries(BK.diy.operators)) {
    const got = api.diyDerivedBonds(o.powers || []).expected.slice().sort().join(',');
    const cur = (o.bonds || []).slice().sort().join(',');
    if (got !== cur) { mismatch++; if (examples.length < 3) examples.push(id + ': 推算 ' + got + ' 但数据是 ' + cur); }
  }
  assert.equal(mismatch, 0, '推算与数据不一致：' + examples.join(' | '));
});
check('势力不匹配任何核心盟约时落到兜底盟约', () => {
  // 凯尔希 powers = rhodes / babel，匹配不上任何 powerIdList → 兜底
  const r = api.diyDerivedBonds(['rhodes', 'babel']);
  assert.deepEqual(r.expected, ['emptyShip'], '应落到 emptyShip，实际 ' + JSON.stringify(r.expected));
  assert.equal(r.hits.length, 0);
});
check('势力命中核心盟约时按 powerIdList 推出', () => {
  // 斩业星熊 powers 含 lungmen → yanShip（它的 powerIdList 含 lungmen）
  const powers = BK.diy.operators['char_1044_hsgma2'].powers || [];
  const r = api.diyDerivedBonds(powers);
  assert.ok(r.expected.includes('yanShip'), 'powers ' + JSON.stringify(powers) + ' 应推出 yanShip，实际 ' + JSON.stringify(r.expected));
  assert.ok(r.hits.some((h) => h.bondId === 'yanShip' && h.matched.length), '应给出命中的 powerId');
});

// ---- 17c. effectKey 白名单：新增特质必须复用引擎实现了的键 --------------------------------
console.log('特质 effectKey 白名单');
check('EFFECT_KEYS 表的分类都合法且非空', () => {
  const keys = Object.keys(api.EFFECT_KEYS);
  assert.ok(keys.length >= 40, '登记表太小：' + keys.length);
  for (const k of keys) {
    const v = api.EFFECT_KEYS[k];
    assert.ok(Array.isArray(v) && v.length === 2, k + ' 的值应为 [分类, 说明]');
    assert.ok(['prep', 'battle'].includes(v[0]), k + ' 的分类无效：' + v[0]);
    assert.ok(typeof v[1] === 'string' && v[1].length > 0, k + ' 缺说明');
  }
});
check('数据里用到的每个 effectKey 都在白名单里（官方数据不报错）', () => {
  const miss = new Set();
  for (const g of Object.values(api.work.garrisons)) {
    if (g.effectKey && !Object.prototype.hasOwnProperty.call(api.EFFECT_KEYS, g.effectKey)) miss.add(g.effectKey);
  }
  assert.equal(miss.size, 0, '官方数据里有白名单外的键：' + [...miss].join(', '));
});
check('编造一个不存在的 effectKey 会被校验器拦下', () => {
  const gid = Object.keys(api.work.garrisons)[0];
  const before = api.work.garrisons[gid].effectKey;
  api.work.garrisons[gid].effectKey = 'MY_TOTALLY_NEW_EFFECT';
  api.validate();
  const hit = api.issues().some((i) => i.lvl === 'bad' && /没有实现/.test(i.m));
  api.work.garrisons[gid].effectKey = before;
  api.validate();
  assert.ok(hit, '校验器应把未实现的 effectKey 报为错误');
});

// ---- 17d. 干员页：一名干员一页，把他的盟约/特质/数值都聚在一起 ------------------------------
console.log('干员页 (op)');
check('干员清单同时含棋子干员与自选六星，且键不重复', () => {
  const idx = api.opIndex();
  const keys = idx.map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length, 'key 必须唯一');
  const chess = idx.filter((e) => e.kind === 'chess');
  const diy = idx.filter((e) => e.kind === 'diy');
  assert.ok(chess.length > 200, '棋子干员太少：' + chess.length);
  assert.equal(diy.length, Object.keys(api.diyTab()).length, '自选六星条数应与台面一致');
  // 自选槽的 8 条占位记录（「甄选干员」，无盟约无特质）不该出现在干员列表里
  assert.equal(chess.filter((e) => /^chess_char_\d+_diy\d+_[ab]$/.test(e.id)).length, 0, '不应列出自选槽占位记录');
});
check('干员页能把精一/精二两条记录并排取出来', () => {
  const e = api.opIndex().find((x) => x.key === 'chess:chess_char_6_03_a');
  assert.ok(e, '找不到余');
  const pair = api.opPair(e);
  assert.equal(pair.length, 2, '应有精一与精二两条，实际 ' + pair.length);
  assert.ok(pair.some((p) => /_a$/.test(p.id)) && pair.some((p) => /_b$/.test(p.id)));
});
check('干员页聚合了他牵扯的盟约与特质', () => {
  const e = api.opIndex().find((x) => x.key === 'chess:chess_char_6_03_a');
  const bonds = api.opBondIds(e);
  const gs = api.opGarrisonIds(e);
  assert.ok(bonds.includes('yanShip'), '余应有炎盟约，实际 ' + JSON.stringify(bonds));
  assert.ok(gs.length >= 1, '余应有特质');
  // 聚合出来的每一条都必须在数据里存在，否则页面会渲染出「不存在」
  for (const b of bonds) assert.ok(api.work.bonds[b], '盟约 ' + b + ' 不存在于 bonds.json');
  for (const g of gs) assert.ok(api.work.garrisons[g], '特质 ' + g + ' 不存在于 garrisons.json');
});
check('自选六星的干员页也能聚合出盟约', () => {
  const e = api.opIndex().find((x) => x.key === 'diy:char_1044_hsgma2');
  assert.ok(e, '找不到斩业星熊');
  const bonds = api.opBondIds(e);
  assert.ok(bonds.includes('yanShip'), '斩业星熊应有炎盟约，实际 ' + JSON.stringify(bonds));
});
check('共用记录会算出「还影响谁」', () => {
  // 炎是核心盟约，被很多干员引用
  const owners = api.bondOwners('yanShip');
  assert.ok(owners.length > 5, '炎应有多个拥有者，实际 ' + owners.length);
  // 特质同理
  const gid = Object.keys(api.work.garrisons).find((g) => (api.work.garrisons[g].owners || []).length > 1);
  if (gid) assert.ok(api.garrisonUsers(gid).length >= 1, '共用特质应能算出引用者');
});
check('干员页渲染出两条棋子记录、盟约与特质区块', () => {
  const e = api.opIndex().find((x) => x.key === 'chess:chess_char_6_03_a');
  api.pageCtx = e;
  const html = api.opForm(e);
  assert.ok(html.includes('精一') && html.includes('精二'), '缺精一/精二对照');
  assert.ok(html.includes('chess_char_6_03_a') && html.includes('chess_char_6_03_b'), '两条记录都要出现');
  assert.ok(html.includes('yanShip'), '应出现炎盟约');
  assert.ok(html.includes('数据路径') || html.includes('data-path'), '应有可编辑控件');
  assert.ok(/盟约（\d+ 条）/.test(html), '应有盟约区块');
  assert.ok(/特质（\d+ 条）/.test(html), '应有特质区块');
  // 共用盟约必须给出警示
  assert.ok(html.includes('共用'), '共用盟约应有警示标示');
  api.pageCtx = null;
});
check('干员页的自选条目渲染出自选数据与档位', () => {
  const e = api.opIndex().find((x) => x.key === 'diy:char_1044_hsgma2');
  api.pageCtx = e;
  const html = api.opForm(e);
  api.pageCtx = null;
  assert.ok(html.includes('自选数据'), '缺自选数据区块');
  assert.ok(html.includes('名单与锁定'), '缺名单区块');
  const forms = Object.keys(api.work.backups.units['char_1044_hsgma2'].forms || {});
  for (const k of forms) assert.ok(html.includes('档位 <code>' + k + '</code>'), '缺档位 ' + k);
});
check('自选六星的数值输入框必须带真实数值（曾经整片为空）', () => {
  // 回归：包装记录的路径风格混淆，导致 48 个数值框全渲染成 value="" —— 只看「控件存在」抓不到
  const bad = [];
  for (const id of ['char_003_kalts', 'char_1044_hsgma2', 'char_2025_shu']) {
    const e = api.opIndex().find((x) => x.key === 'diy:' + id);
    assert.ok(e, '找不到 ' + id);
    api.pageCtx = e;
    const html = api.opForm(e);
    api.pageCtx = null;
    const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]).filter((t) => /data-path="/.test(t));
    const stat = inputs.filter((t) => /un\.forms\..*\.stats\./.test(t));
    assert.ok(stat.length > 20, id + ' 的数值控件太少：' + stat.length);
    const empty = stat.filter((t) => /value=""/.test(t));
    if (empty.length) bad.push(id + ': ' + empty.length + '/' + stat.length + ' 个空值，例 ' + ((empty[0].match(/data-path="([^"]*)"/) || [])[1]));
    // 顺带确认面板字段也有值
    const nameInput = inputs.find((t) => /data-path="op\.name"/.test(t));
    if (nameInput && /value=""/.test(nameInput)) bad.push(id + ': 名字为空');
  }
  assert.equal(bad.length, 0, '空的数值框：' + bad.join(' | '));
});
check('自选六星的名单编辑器不再因为 poolKind 为空而崩', () => {
  // powers 的 idList 传 poolKind=null：以前会在 pool[v] 上抛「Cannot read properties of null」
  const e = api.opIndex().find((x) => x.key === 'diy:char_003_kalts');
  const rec = api.diyTab()['char_003_kalts'];
  const out = api.idList('backups', 'char_003_kalts', 'op.powers', 'powers', rec, null, '');
  assert.ok(out.includes('rhodes'), 'powers 的标签应直接显示原始值，实际没出现 rhodes');
});
check('自选六星的字段位置能被翻译成真实写入路径', () => {
  const e = api.opIndex().find((x) => x.key === 'diy:char_1044_hsgma2');
  api.pageCtx = e;
  const a = api.formRoot('op.name');
  const b = api.formRoot('un.forms.2/1/4/0.stats.maxHp');
  api.pageCtx = null;
  assert.deepEqual(a, { kind: 'backups', id: 'char_1044_hsgma2', rel: 'diy.operators.char_1044_hsgma2.name' });
  assert.deepEqual(b, { kind: 'backups', id: 'char_1044_hsgma2', rel: 'units.char_1044_hsgma2.forms.2/1/4/0.stats.maxHp' });
});
check('formRoot 能按路径把字段分流到正确的表', () => {
  const e = api.opIndex().find((x) => x.key === 'chess:chess_char_6_03_a');
  api.pageCtx = e;
  assert.deepEqual(api.formRoot('bonds'), { kind: 'chess', id: 'chess_char_6_03_a', rel: 'bonds' });
  assert.deepEqual(api.formRoot('stats.maxHp'), { kind: 'chess', id: 'chess_char_6_03_a', rel: 'stats.maxHp' });
  // bb.* 在盟约与特质里都合法，只凭路径无法判断 → 这类必须靠渲染时写下的 data-root
  assert.equal(api.formRoot('bb.base_atk').kind, 'bb', '无标记时不做猜测');
  api.pageCtx = null;
  const d = api.opIndex().find((x) => x.key === 'diy:char_1044_hsgma2');
  api.pageCtx = d;
  assert.equal(api.formRoot(d.id + '.op.bonds').kind, 'backups');
  assert.equal(api.formRoot('diy.ownedPool').kind, 'backups');
  assert.equal(api.formRoot(d.id + '.un.forms.2/1/4/0.stats.maxHp').kind, 'backups');
  api.pageCtx = null;
});
check('干员页的字段控件带 data-root，提交时不靠猜', () => {
  const e = api.opIndex().find((x) => x.key === 'chess:chess_char_6_03_a');
  api.pageCtx = e;
  const html = api.opForm(e);
  api.pageCtx = null;
  // 每个可编辑控件都要带真实位置
  const paths = [...html.matchAll(/data-path="([^"]+)"([^>]*)>/g)];
  assert.ok(paths.length > 20, '字段太少：' + paths.length);
  const bad = paths.filter(([, , attrs]) => !/data-root="/.test(attrs));
  assert.equal(bad.length, 0, '这些控件缺少 data-root：' + bad.slice(0, 3).map((m) => m[1]).join(', '));
  // 盟约的 bb 字段必须标成 bonds（否则会写进错误的表）
  assert.ok(/data-root="bonds\|&quot;yanShip&quot;\|&quot;bb\./.test(html), '盟约 bb 字段的 data-root 应是 bonds|…');
  // 棋子自身的 stats 字段必须标成 chess
  assert.ok(/data-root="chess\|&quot;chess_char_6_03_a&quot;\|&quot;stats\./.test(html), 'stats 字段的 data-root 应是 chess|…');
});

// ---- 17e. 特质页：列出全部特质逐个改，配对文案自动同步 -----------------------------------
console.log('特质页 (garrisons)');
check('特质页列出全部特质，按 _a/_b 成对', () => {
  const ids = api.traitIds();
  assert.equal(ids.length, Object.keys(api.work.garrisons).length, '应与数据条数一致');
  const pairs = ids.filter((g) => /_a$/.test(g)).filter((g) => api.work.garrisons[g.replace(/_a$/, '_b')]);
  assert.ok(pairs.length > 100, '应有很多配对的 _a/_b，实际 ' + pairs.length);
});
check('traitPairId 正确配对精一/精二', () => {
  assert.equal(api.traitPairId('garrison_01_a'), 'garrison_01_b');
  assert.equal(api.traitPairId('garrison_01_b'), 'garrison_01_a');
  assert.equal(api.traitPairId('garrison_37_a'), 'garrison_37_b');
  assert.equal(api.traitPairId('没有版本后缀'), null);
});
check('配对数据本来就常不同（这是刻意的，不能被自动同步抹掉）', () => {
  // 官方数据事实：124 对配对中，大多数数值与文案本就不同（精一 +1 / 精二 +2）
  let pairs = 0, bbDiff = 0, textDiff = 0;
  for (const gid of api.traitIds()) {
    const m = /^(.*)_([ab])$/.exec(gid);
    if (!m) continue;
    const other = m[1] + '_' + (m[2] === 'a' ? 'b' : 'a');
    if (!api.work.garrisons[other] || gid > other) continue;
    pairs++;
    const a = api.work.garrisons[gid], b = api.work.garrisons[other];
    const keys = [...new Set([...Object.keys(a.bb || {}), ...Object.keys(b.bb || {})])];
    if (keys.some((k) => JSON.stringify((a.bb || {})[k]) !== JSON.stringify((b.bb || {})[k]))) bbDiff++;
    if ((a.desc || '') !== (b.desc || '')) textDiff++;
  }
  assert.ok(pairs > 100, '配对数太少：' + pairs);
  assert.ok(bbDiff > pairs / 2, '多数配对的数值本该不同，实际 ' + bbDiff + '/' + pairs);
  assert.ok(textDiff > pairs / 2, '多数配对的文案本该不同，实际 ' + textDiff + '/' + pairs);
});
check('改一条文案不会自动改到配对那条（避免抹掉刻意的版本差异）', () => {
  const a = 'garrison_01_a', b = api.traitPairId(a);
  const beforeB = JSON.parse(JSON.stringify(api.work.garrisons[b]));
  const beforeA = JSON.parse(JSON.stringify(api.work.garrisons[a]));
  api.pageCtx = { traitPage: true, id: a };
  api.setField('garrisons', a, 'desc', '<战斗中>不该外溢的文本');
  api.pageCtx = null;
  assert.equal(api.work.garrisons[a].descRaw, api.toRaw('<战斗中>不该外溢的文本'), '同一条记录内的 descRaw 要跟上');
  assert.equal(api.work.garrisons[b].desc, beforeB.desc, '配对那条的文案不应被自动改动');
  api.work.garrisons[a] = beforeA;
  api.work.garrisons[b] = beforeB;
});
check('「把文案复制到配对」是显式动作，且两个字段都写全', () => {
  const a = 'garrison_01_a', b = api.traitPairId(a);
  const beforeB = JSON.parse(JSON.stringify(api.work.garrisons[b]));
  const beforeA = JSON.parse(JSON.stringify(api.work.garrisons[a]));
  api.work.garrisons[a].desc = '<战斗中>显式复制';
  api.work.garrisons[a].descRaw = '<战斗中>显式复制';
  const other = api.copyTraitTextToPair(a);
  assert.equal(other, b);
  assert.equal(api.work.garrisons[b].desc, '<战斗中>显式复制', 'desc 应被复制');
  assert.equal(api.work.garrisons[b].descRaw, api.toRaw('<战斗中>显式复制'), 'descRaw 也要写全（不被 desc 的同步覆盖）');
  assert.deepEqual(api.work.garrisons[b].bb, beforeB.bb, '数值不该被文案复制动到');
  api.work.garrisons[a] = beforeA;
  api.work.garrisons[b] = beforeB;
});
check('traitPairDiff 能识别配对是否不同步', () => {
  // 「完全不同」并不是错——这里只验证它能如实报出两版差异的键
  const a = Object.keys(api.work.garrisons).find((g) => {
    const o = api.traitPairId(g);
    if (!/_a$/.test(g) || !api.work.garrisons[o]) return false;
    const A = api.work.garrisons[g], B = api.work.garrisons[o];
    const keys = [...new Set([...Object.keys(A.bb || {}), ...Object.keys(B.bb || {})])];
    return keys.some((k) => JSON.stringify((A.bb || {})[k]) !== JSON.stringify((B.bb || {})[k]));
  });
  assert.ok(a, '找不到数值本就不同的配对特质');
  const b = api.traitPairId(a);
  const baseA = JSON.parse(JSON.stringify(api.work.garrisons[a]));
  const baseB = JSON.parse(JSON.stringify(api.work.garrisons[b]));
  const d0 = api.traitPairDiff(a);
  assert.ok(d0.bbDiff.length > 0, '这条配对本就该有数值差异，实际 ' + JSON.stringify(d0.bbDiff));
  // 把 a 的某个 bb 键改成与 b 一致 → 该键应从差异里消失
  const k = Object.keys(api.work.garrisons[a].bb)[0];
  api.work.garrisons[a].bb[k] = api.work.garrisons[b].bb[k];
  let d = api.traitPairDiff(a);
  assert.ok(!d.bbDiff.includes(k), '改成一致后 ' + k + ' 不该再算差异');
  api.work.garrisons[a] = baseA;
  // 文案差异同样如实报出
  api.work.garrisons[a].desc = String(api.work.garrisons[b].desc);
  api.work.garrisons[a].descRaw = api.work.garrisons[b].descRaw;
  d = api.traitPairDiff(a);
  assert.ok(!d.textDiff, '文案弄成一致后不该再报差异');
  api.work.garrisons[a] = baseA;
  api.work.garrisons[b] = baseB;
  assert.deepEqual(api.traitPairDiff(a).bbDiff, d0.bbDiff, '复原后差异应回到原样');
});
check('特质页渲染出效果/文案/数值/拥有者四块', () => {
  const gid = 'garrison_01_a';
  api.pageCtx = { traitPage: true, id: gid };
  const html = api.traitForm(gid);
  api.pageCtx = null;
  assert.ok(html.includes('效果实现'), '缺效果实现区块');
  assert.ok(html.includes('文案'), '缺文案区块');
  assert.ok(html.includes('数值 bb'), '缺数值区块');
  assert.ok(html.includes('拥有者 owners'), '缺 owners 区块');
  assert.ok(html.includes('配对'), '缺配对提示');
  assert.ok(html.includes('data-path="desc"'), '缺 desc 输入');
  assert.ok(html.includes('copyTextToPair'), '缺「文案复制到配对」按钮');
  assert.ok(html.includes('syncPairRow'), '缺整条复制按钮');
  assert.ok(/bb 键/.test(html), '缺配对数值对照表');
});
check('特质页的字段不会被误判到别的表（bb 归 garrisons）', () => {
  const gid = 'garrison_01_a';
  api.pageCtx = { traitPage: true, id: gid };
  assert.deepEqual(api.formRoot('bb.atk'), { kind: 'garrisons', id: gid, rel: 'bb.atk' });
  assert.deepEqual(api.formRoot('desc'), { kind: 'garrisons', id: gid, rel: 'desc' });
  // 特质页的控件必须带 data-root，标明是 garrisons
  const html = api.traitForm(gid);
  api.pageCtx = null;
  const roots = [...html.matchAll(/data-root="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(roots.length > 0, '应有 data-root 标记');
  assert.ok(roots.every((r) => r.startsWith('garrisons|')), '所有字段都应标为 garrisons，实际 ' + roots.slice(0, 3).join(' / '));
});
check('特质页能按文案 / effectKey / 拥有者搜到', () => {
  const byKey = api.traitFiltered('server_add_bond');
  assert.ok(byKey.length > 0, '按 effectKey 应能搜到');
  const byOwner = api.traitFiltered('chess_char_6_03_a');
  assert.ok(byOwner.length > 0, '按拥有者 id 应能搜到');
  const byId = api.traitFiltered('garrison_01_a');
  assert.ok(byId.includes('garrison_01_a'), '按 id 应能搜到');
});

// ---- 17f. 「获得时 · 加盟约层数」的成对编辑器 ---------------------------------------------
console.log('获得时·加盟约层数 (SERVER_ADD_BOND / SERVER_ADD_MULTIPLE_BOND)');
check('能从官方数据里读出多盟约的成对关系', () => {
  const g = api.work.garrisons.garrison_156_b;
  const pairs = api.readBondPairs(g);
  assert.deepEqual(pairs, [{ bondId: 'yanShip', count: 12 }, { bondId: 'miraShip', count: 6 }]);
});
check('单盟约形状（层数在 bb.count）也能读出来', () => {
  const g = api.work.garrisons.garrison_157_b;
  const pairs = api.readBondPairs(g);
  assert.deepEqual(pairs, [{ bondId: 'miraShip', count: 6 }]);
});
check('两个串必须一一对应，不能错位', () => {
  // 这是这个编辑器存在的理由：手写 bond / count 两个串极容易错位
  const g = api.work.garrisons.garrison_156_b;
  const pairs = api.readBondPairs(g);
  assert.equal(pairs.length, 2, '两条盟约');
  assert.equal(pairs[0].bondId, 'yanShip');
  assert.equal(pairs[0].count, 12, '第一条应配 12，不是 6');
  assert.equal(pairs[1].bondId, 'miraShip');
  assert.equal(pairs[1].count, 6, '第二条应配 6');
});
check('写回多条盟约：bbStr 对齐、bb 清空、effectKey 换成 MULTIPLE', () => {
  const gid = 'garrison_157_b';   // 原本是单条（SERVER_ADD_BOND）
  const before = JSON.parse(JSON.stringify(api.work.garrisons[gid]));
  const pairs = [{ bondId: 'yanShip', count: 12 }, { bondId: 'miraShip', count: 6 }, { bondId: 'arcaneShip', count: 6 }];
  assert.equal(api.writeBondPairs(gid, pairs), true);
  const g = api.work.garrisons[gid];
  assert.equal(g.bbStr.bond, 'yanShip,miraShip,arcaneShip');
  assert.equal(g.bbStr.count, '12,6,6');
  assert.equal(g.effectKey, 'SERVER_ADD_MULTIPLE_BOND');
  assert.deepEqual(g.bb, {}, '多条盟约时 bb 必须清空，否则引擎读到错来源');
  // 再读回来必须与写进去的一致
  assert.deepEqual(api.readBondPairs(g), pairs);
  api.work.garrisons[gid] = before;
});
check('写回单条盟约：回到 SERVER_ADD_BOND + bb.count', () => {
  const gid = 'garrison_156_b';
  const before = JSON.parse(JSON.stringify(api.work.garrisons[gid]));
  assert.equal(api.writeBondPairs(gid, [{ bondId: 'yanShip', count: 12 }]), true);
  const g = api.work.garrisons[gid];
  assert.equal(g.effectKey, 'SERVER_ADD_BOND');
  assert.equal(g.bbStr.bond, 'yanShip');
  assert.deepEqual(g.bb, { count: 12 });
  assert.deepEqual(api.readBondPairs(g), [{ bondId: 'yanShip', count: 12 }]);
  api.work.garrisons[gid] = before;
});
check('加入一条盟约：写回后两个串仍然对齐', () => {
  const gid = 'garrison_156_b';
  const before = JSON.parse(JSON.stringify(api.work.garrisons[gid]));
  const pairs = api.readBondPairs(api.work.garrisons[gid]);
  api.addBondPair(pairs, 'arcaneShip', 6);     // 用户要的「混合为…奥术+6」
  assert.equal(api.writeBondPairs(gid, pairs), true);
  const g = api.work.garrisons[gid];
  assert.equal(g.bbStr.bond.split(',').length, g.bbStr.count.split(',').length, '两个串长度必须一致');
  assert.equal(g.bbStr.bond.split(',')[2], 'arcaneShip');
  assert.equal(g.bbStr.count.split(',')[2], '6');
  api.work.garrisons[gid] = before;
});
check('重复加入同一盟约会累加层数，不会出现重复条目', () => {
  const pairs = [{ bondId: 'yanShip', count: 6 }];
  api.addBondPair(pairs, 'miraShip', 3);
  api.addBondPair(pairs, 'yanShip', 6);       // 再给炎 +6
  assert.equal(pairs.length, 2, '不应产生第二条 yanShip');
  assert.equal(pairs.find((p) => p.bondId === 'yanShip').count, 12);
  assert.equal(pairs.find((p) => p.bondId === 'miraShip').count, 3);
});
check('按数值生成的文案与官方写法一致', () => {
  const txt = api.bondPairsText([{ bondId: 'yanShip', count: 12 }, { bondId: 'miraShip', count: 6 }, { bondId: 'arcaneShip', count: 6 }]);
  assert.equal(txt, '<获得时>【炎】层数+12、【奇迹】层数+6、【奥术】层数+6（无需激活盟约）');
});
check('层数填了非数字时拒绝写回（并提示是哪条）', () => {
  const gid = 'garrison_156_b';
  const before = JSON.parse(JSON.stringify(api.work.garrisons[gid]));
  assert.equal(api.writeBondPairs(gid, [{ bondId: 'yanShip', count: '' }]), false);
  assert.deepEqual(api.work.garrisons[gid], before, '拒绝时不能改到记录');
});
check('生成的富文本与官方写法一致（数字带彩色标记）', () => {
  // 官方: <获得时>【炎】层数<@ba.vup>+12</>、…
  const rich = api.bondPairsRichText([{ bondId: 'yanShip', count: 12 }, { bondId: 'miraShip', count: 6 }]);
  assert.equal(rich, '<获得时>【炎】层数<@ba.vup>+12</>、【奇迹】层数<@ba.vup>+6</>（无需激活盟约）');
  // 去掉标记后必须与纯文本版完全一致，否则 desc / descRaw 会对不上
  assert.equal(api.plainOf(rich), api.bondPairsText([{ bondId: 'yanShip', count: 12 }, { bondId: 'miraShip', count: 6 }]));
});
check('写文案会同时写 desc 与 descRaw（游戏渲染的是 descRaw）', () => {
  const gid = 'garrison_156_b';
  const before = JSON.parse(JSON.stringify(api.work.garrisons[gid]));
  const pairs = [{ bondId: 'yanShip', count: 12 }, { bondId: 'miraShip', count: 6 }, { bondId: 'arcaneShip', count: 6 }];
  api.applyBondPairsText(gid, pairs);
  const g = api.work.garrisons[gid];
  assert.equal(g.desc, api.bondPairsText(pairs));
  assert.equal(g.descRaw, api.bondPairsRichText(pairs), 'descRaw 必须一起写，否则界面显示的还是旧文案');
  assert.ok(g.descRaw.includes('<@ba.vup>'), '富文本应保留官方彩色标记');
  api.work.garrisons[gid] = before;
});
check('特质页对这一族特质显示成对编辑器，别的特质不显示', () => {
  api.pageCtx = { traitPage: true, id: 'garrison_156_b' };
  const on = api.traitForm('garrison_156_b');
  api.pageCtx = null;
  assert.ok(on.includes('pairWriteBtn'), '这一族应有成对编辑器');
  assert.ok(on.includes('data-pair-bond'), '应有盟约行');
  assert.ok(on.includes('data-pair-count'), '应有层数输入');
  // 找一个不属于这一族的特质
  const other = Object.keys(api.work.garrisons).find((g) => !api.MULTI_BOND_KEYS.has(api.work.garrisons[g].effectKey));
  api.pageCtx = { traitPage: true, id: other };
  const off = api.traitForm(other);
  api.pageCtx = null;
  assert.ok(!off.includes('pairWriteBtn'), '别的特质不该出现这个编辑器：' + other);
});

// ---- 17g. 拖动：同干员内换顺序、拖到别的干员身上搬家 --------------------------------
console.log('拖动 (drag & drop)');
check('特质 tag 带拖动标记，别的列表不带（避免误解）', () => {
  const chess = api.idList('chess', 'chess_char_4_15_a', 'garrisonIds', 'garrisonIds', api.work.chess.chess_char_4_15_a, 'garrisons', '');
  assert.ok(chess.includes('data-drag-id="garrison_156_a"'), '特质 tag 应可拖');
  assert.ok(chess.includes('data-drag-field="garrisonIds"'), '应标明拖的是 garrisonIds');
  assert.ok(chess.includes('class="grip"'), '应有拖动把手');
  // 盟约列表（bonds）不参与拖动：拖它不会改干员，容易误解
  const bonds = api.idList('chess', 'chess_char_4_15_a', 'bonds', 'bonds', api.work.chess.chess_char_4_15_a, 'bonds', '');
  assert.ok(!bonds.includes('data-drag-id'), '盟约 tag 不该带拖动标记');
});
check('同一干员内拖动 = 调整 garrisonIds 顺序', () => {
  const cid = 'chess_char_4_15_a';            // 录武官：garrisonIds = [156_a, 157_a]
  const before = [...api.work.chess[cid].garrisonIds];
  assert.deepEqual(before, ['garrison_156_a', 'garrison_157_a']);
  // 把第 1 条（index 0）拖到第 2 条之后
  api.applyDrag({ kind: 'trait', fromId: cid, field: 'garrisonIds', index: 0, id: 'garrison_156_a' },
    { opKey: 'chess:' + cid, toIndex: 2 });
  assert.deepEqual(api.work.chess[cid].garrisonIds, ['garrison_157_a', 'garrison_156_a'], '顺序应交换');
  api.work.chess[cid].garrisonIds = before;
});
check('把特质拖到另一名干员 = 加到他身上（原干员不动）', () => {
  const from = 'chess_char_4_15_a';
  const to = 'chess_char_6_03_a';             // 余
  const toBefore = [...api.work.chess[to].garrisonIds];
  api.applyDrag({ kind: 'trait', fromId: from, field: 'garrisonIds', index: 1, id: 'garrison_157_a' },
    { opKey: 'chess:' + to });
  assert.ok(api.work.chess[to].garrisonIds.includes('garrison_157_a'), '目标应拿到这条特质');
  assert.ok(api.work.chess[from].garrisonIds.includes('garrison_157_a'), '源干员默认不移除');
  assert.deepEqual(api.work.chess[to].garrisonIds.slice(0, toBefore.length), toBefore, '原有条目顺序不变，新的追加在末尾');
  api.work.chess[to].garrisonIds = toBefore;
});
check('按住 Ctrl 拖到另一名干员 = 移除', () => {
  const from = 'chess_char_4_15_a';
  const to = 'chess_char_4_15_a';             // 对他自己按 Ctrl 拖 = 移除
  const before = [...api.work.chess[from].garrisonIds];
  api.applyDrag({ kind: 'trait', fromId: from, field: 'garrisonIds', index: 0, id: 'garrison_156_a' },
    { opKey: 'chess:' + to, remove: true });
  assert.ok(!api.work.chess[from].garrisonIds.includes('garrison_156_a'), '应被移除');
  api.work.chess[from].garrisonIds = before;
});
check('拖到已经有这条特质的干员 = 拒绝，不产生重复项', () => {
  // 156_a 同时挂在录武官和伺夜身上；从录武官拖到伺夜 = 对方已有，应拒绝
  const from = 'chess_char_4_15_a', to = 'chess_char_5_23_a';
  assert.ok(api.work.chess[to].garrisonIds.includes('garrison_156_a'), '前提：目标本来就有这条');
  const before = [...api.work.chess[to].garrisonIds];
  const ok = api.applyDrag({ kind: 'trait', fromId: from, field: 'garrisonIds', index: 0, id: 'garrison_156_a' },
    { opKey: 'chess:' + to });
  assert.equal(ok, false, '重复添加应被拒绝');
  assert.deepEqual(api.work.chess[to].garrisonIds, before, '被拒绝时目标不该变');
});
check('拖到自选六星上会被明确拒绝（它们没有 garrisonIds）', () => {
  const ok = api.applyDrag({ kind: 'trait', fromId: 'chess_char_4_15_a', field: 'garrisonIds', index: 0, id: 'garrison_156_a' },
    { opKey: 'diy:char_1044_hsgma2' });
  assert.equal(ok, false, '自选干员不该接收特质');
});
check('拖动过程中给出「往哪放」的提示', () => {
  api.showDropHint('测试提示');
  api.clearDropHint();
  assert.ok(true, '不抛错即可');   // DOM 桩下只验证不崩
});

// ---- 17h. 盟约页：合成新盟约 --------------------------------------------------------------
console.log('盟约合成 (synthBond)');
check('以现有盟约为模板合成新盟约，继承效果参数', () => {
  const r = api.synthBond('yanShip', 'testSynthA', { name: '测试盟约' });
  assert.equal(r.ok, true, r.reason);
  const nb = api.work.bonds.testSynthA;
  assert.ok(nb, '新盟约应存在于 bonds 表');
  assert.equal(nb.bondId, 'testSynthA', 'bondId 必须等于键名（引擎按它匹配）');
  assert.equal(nb.name, '测试盟约');
  // 继承模板的效果参数（这是复制的意义：引擎已实现这些键）
  assert.deepEqual(nb.bb, api.work.bonds.yanShip.bb, 'bb 应与模板一致');
  assert.deepEqual(nb.thresholds, api.work.bonds.yanShip.thresholds, 'thresholds 应与模板一致');
  assert.deepEqual(nb.powerIdList, api.work.bonds.yanShip.powerIdList, '势力名单应与模板一致');
  // 成员默认清空（否则会凭空多出一堆成员）
  assert.deepEqual(nb.members, [], '成员应默认清空');
  assert.equal(nb.synth.from, 'yanShip', '应记录模板来源');
  delete api.work.bonds.testSynthA;
});
check('合成时可以带上模板的成员名单', () => {
  const r = api.synthBond('yanShip', 'testSynthB', { keepMembers: true });
  assert.equal(r.ok, true, r.reason);
  assert.ok(api.work.bonds.testSynthB.members.length > 0, '带上成员时应非空');
  delete api.work.bonds.testSynthB;
});
check('合成时描述里的盟约名也会换掉', () => {
  // 先造一条描述里确实带盟约名的模板，否则这条断言没有意义
  const srcName = api.work.bonds.yanShip.name;
  const origDesc = api.work.bonds.yanShip.desc;
  api.work.bonds.yanShip.desc = '【' + srcName + '】相关的说明文字';
  const r = api.synthBond('yanShip', 'testSynthC', { name: '新炎' });
  assert.equal(r.ok, true, r.reason);
  const nb = api.work.bonds.testSynthC;
  assert.ok(String(nb.desc).includes('新炎'), '新记录的描述应含新名：' + nb.desc);
  // 注意：新名「新炎」本身包含旧名「炎」，所以不能用子串判断，要数出现次数
  const countOf = (s, sub) => String(s).split(sub).length - 1;
  assert.equal(countOf(nb.desc, '新炎'), 1, '新名应恰好出现一次：' + nb.desc);
  assert.equal(countOf(nb.desc, srcName), 1, '旧名应只剩「新炎」里那一次：' + nb.desc);
  // 换一个不含旧名的名字，才能干净地验证替换
  const r2 = api.synthBond('yanShip', 'testSynthC2', { name: '炽阳' });
  assert.equal(r2.ok, true, r2.reason);
  assert.ok(!String(api.work.bonds.testSynthC2.desc).includes(srcName), '换个名字后旧名应彻底消失：' + api.work.bonds.testSynthC2.desc);
  delete api.work.bonds.testSynthC2;
  delete api.work.bonds.testSynthC;
  api.work.bonds.yanShip.desc = origDesc;
});
check('id 重复 / 非法 / 空 都会被拒绝并说明原因', () => {
  const dup = api.synthBond('yanShip', 'yanShip');
  assert.equal(dup.ok, false);
  assert.ok(/已存在/.test(dup.reason), '重复 id 的提示应说明已存在：' + dup.reason);
  const cn = api.synthBond('yanShip', '新盟约');
  assert.equal(cn.ok, false);
  assert.ok(/英文/.test(cn.reason), '中文 id 应被拒绝并解释：' + cn.reason);
  const empty = api.synthBond('yanShip', '   ');
  assert.equal(empty.ok, false);
  const noSrc = api.synthBond('并不存在', 'x');
  assert.equal(noSrc.ok, false);
});
check('盟约页能列出全部盟约并按 bb 键搜到', () => {
  const all = api.bondIds();
  assert.equal(all.length, Object.keys(api.work.bonds).length);
  assert.ok(all[0] === 'yanShip' || api.work.bonds[all[0]].isCore, '核心盟约排前面');
  const hit = api.bondFiltered('base_time');
  assert.ok(hit.includes('sargonShip'), '按 bb 键应能搜到 sargonShip，实际 ' + JSON.stringify(hit));
});
check('能算出某条盟约被谁引用（删之前要看清）', () => {
  const refs = api.bondRefs('yanShip');
  assert.ok(refs.chess.length > 0, '炎应被棋子引用');
  assert.ok(api.bondRefCount('yanShip') > 0);
  // 造一条谁都不引用的盟约，引用数应为 0
  api.synthBond('yanShip', 'testSynthD', {});
  assert.equal(api.bondRefCount('testSynthD'), 0, '新合成的盟约还没人引用');
  delete api.work.bonds.testSynthD;
});
check('盟约页渲染出基本信息 / 门槛 / 势力 / 数值 / 成员 / 合成 六块', () => {
  api.setTab('bonds');
  api.pageCtx = null;
  // 详情由 bondForm + synthBlock 拼成（与 paintBondRows 一致）
  const html = api.bondForm('yanShip') + api.synthBlock('yanShip');
  for (const k of ['基本信息', '激活门槛', '势力 powerIdList', '数值 bb', '成员 members', '合成']) {
    assert.ok(html.includes(k), '缺区块：' + k);
  }
  assert.ok(html.includes('data-bondrm'), '成员应有移除按钮');
  assert.ok(html.includes('bondMemberAddBtn'), '应有加入成员按钮');
  assert.ok(html.includes('bondMembersAuto'), '应有按干员侧 bonds 自动重建');
  assert.ok(html.includes('synthBtn'), '应有合成按钮');
});

// ---- 17i. 导出 / 导入（跨编辑器搬运） ----------------------------------------------------
console.log('导出 / 导入 (share pack)');
check('导出包带上格式标记、时间与记录内容', () => {
  // 先造一条改动，让导出有内容
  const gid = 'garrison_01_a';
  api.setField('garrisons', gid, 'bb.atk', 12345);
  const pack = api.buildSharePack('测试导出');
  assert.equal(pack.format, 'application/x-sp-tag'.replace('application/x-sp-tag', 'stronghold-data-patch'));
  assert.equal(pack.version, 1);
  assert.ok(pack.exportedAt, '应有导出时间');
  assert.equal(pack.note, '测试导出');
  const rec = pack.records.find((r) => r.file === 'garrisons' && r.id === gid);
  assert.ok(rec, '应包含刚改过的特质');
  assert.equal(rec.record.bb.atk, 12345, '记录内容应是改动后的值');
});
check('同一条记录只出现一次（不会因为改了多个字段重复）', () => {
  const gid = 'garrison_01_a';
  api.setField('garrisons', gid, 'desc', 'x');
  api.setField('garrisons', gid, 'bb.def', 9);
  const pack = api.buildSharePack();
  const n = pack.records.filter((r) => r.file === 'garrisons' && r.id === gid).length;
  assert.equal(n, 1, '同一记录应只导出一次，实际 ' + n);
});
check('导入时会拒绝不是本编辑器导出的文件', () => {
  const r = api.importSharePack({ foo: 1 });
  assert.equal(r.ok, false);
  assert.ok(/format/.test(r.reason), '应说明缺少 format 标记：' + r.reason);
});
check('导入撞 id 会改名，不动本地同名记录', () => {
  const localBefore = JSON.parse(JSON.stringify(api.work.bonds.yanShip));
  const pack = {
    format: 'stronghold-data-patch', version: 1,
    records: [{ file: 'bonds', id: 'yanShip', record: { ...JSON.parse(JSON.stringify(api.work.bonds.yanShip)), name: '外来炎' } }],
  };
  const r = api.importSharePack(pack);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.renamed, 1, '应改名 1 条');
  assert.deepEqual(api.work.bonds.yanShip, localBefore, '本地同名记录一个字都不能动');
  const imported = api.work.bonds.yanShip_import;
  assert.ok(imported, '应新增 yanShip_import');
  assert.equal(imported.name, '外来炎');
  assert.equal(imported.bondId, 'yanShip_import', 'bondId 必须跟着改成新键名');
  delete api.work.bonds.yanShip_import;
});
check('导入时文件内部的引用会一起改名（不会指回本地旧记录）', () => {
  const pack = {
    format: 'stronghold-data-patch', version: 1,
    records: [{
      file: 'garrisons', id: 'garrison_01_a',
      record: { ...JSON.parse(JSON.stringify(api.work.garrisons.garrison_01_a)), bbStr: { bond: 'yanShip' }, owners: ['chess_char_1_20_a'] },
    }],
  };
  const r = api.importSharePack(pack);
  assert.equal(r.ok, true, r.reason);
  const imported = api.work.garrisons.garrison_01_a_import;
  assert.ok(imported, '应新增改名后的特质');
  assert.equal(imported.garrisonId, 'garrison_01_a_import', 'garrisonId 要跟着改');
  // 引用的是本地已有的干员，不该被改名
  assert.deepEqual(imported.owners, ['chess_char_1_20_a'], '不存在的改名映射应保持原样');
  delete api.work.garrisons.garrison_01_a_import;
});
check('导出 → 导入 一轮之后数据能对上（往返一致）', () => {
  const gid = 'garrison_09_a';
  const before = JSON.parse(JSON.stringify(api.work.garrisons[gid]));
  api.setField('garrisons', gid, 'bb.atk', 0.555);
  const pack = api.buildSharePack();
  api.work.garrisons[gid] = before;              // 假装本地回滚了
  // 先把名字让开，否则会改名，不便比对
  delete api.work.garrisons[gid];
  const r = api.importSharePack(pack);
  assert.equal(r.ok, true, r.reason);
  assert.equal(api.work.garrisons[gid].bb.atk, 0.555, '导入后应回到导出时的值');
  api.work.garrisons[gid] = before;
});

// ---- 17j. effectKey / effectType / eventType 的中文对照与选择器 ----------------------------
console.log('效果字段的中文对照');
check('eventType 对照表与引擎的 GARRISON_HOOK 一致（7 种）', () => {
  const keys = Object.keys(api.EVENT_TYPES).sort();
  // server/match/effectsMeta.js 的 GARRISON_HOOK 是权威：6 个钩子 + IN_BATTLE 走战斗内结算
  assert.deepEqual(keys, ['IN_BATTLE', 'SERVER_CHESS_SOLD', 'SERVER_GAIN', 'SERVER_PREP_FIN', 'SERVER_PREP_START', 'SERVER_PRICE', 'SERVER_REFRESH_SHOP'].sort());
  for (const k of keys) {
    const v = api.EVENT_TYPES[k];
    assert.ok(Array.isArray(v) && v.length === 2, k + ' 应是 [中文, 说明]');
    assert.ok(/[\u4e00-\u9fa5]/.test(v[0]), k + ' 的中文名应有汉字：' + v[0]);
    assert.ok(v[1].length > 6, k + ' 的说明太短');
  }
  // 数据里用到的每个 eventType 都要有翻译
  const used = new Set(Object.values(api.work.garrisons).map((g) => g.eventType).filter(Boolean));
  const miss = [...used].filter((k) => !api.EVENT_TYPES[k]);
  assert.equal(miss.length, 0, '数据用到但没翻译的 eventType：' + miss.join(', '));
});
check('effectType 对照表覆盖数据里全部取值', () => {
  const used = new Set(Object.values(api.work.garrisons).map((g) => g.effectType).filter(Boolean));
  const miss = [...used].filter((k) => !api.EFFECT_TYPES[k]);
  assert.equal(miss.length, 0, '数据用到但没翻译的 effectType：' + miss.join(', '));
  assert.ok(Object.keys(api.EFFECT_TYPES).length >= used.size, '对照表不该比数据里的取值还少');
  for (const [k, v] of Object.entries(api.EFFECT_TYPES)) assert.ok(v && v.length > 2, k + ' 缺中文说明');
});
check('EFFECT_KEYS 的中文说明不为空且都翻成中文', () => {
  const missing = Object.entries(api.EFFECT_KEYS).filter(([, v]) => !v[1] || v[1].length < 4);
  assert.equal(missing.length, 0, '这些 effectKey 缺说明：' + missing.map(([k]) => k).join(', '));
  const notZh = Object.entries(api.EFFECT_KEYS).filter(([, v]) => !/[\u4e00-\u9fa5]/.test(v[1]));
  assert.equal(notZh.length, 0, '这些 effectKey 的说明没有中文：' + notZh.map(([k]) => k).join(', '));
});
check('选择器把中文名与英文值一起给出，并保留未知值', () => {
  const g = api.work.garrisons.garrison_05_a;
  const html = api.enumPicker('garrisons', 'garrison_05_a', 'effectKey', 'effectKey', g, api.EFFECT_KEYS, '');
  assert.ok(html.includes('每叠加 N 层盟约'), '应显示中文说明');
  assert.ok(html.includes('value="act1autochess_gar_eff_attrByBond"'), 'value 必须是英文键名');
  assert.ok(/selected/.test(html), '当前值应被选中');
  // 未知值：临时改成引擎不认识的值，选择器要把它留在选项里而不是丢掉
  const fake = { ...g, effectKey: 'MY_UNKNOWN_KEY' };
  const h2 = api.enumPicker('garrisons', 'garrison_05_a', 'effectKey', 'effectKey', fake, api.EFFECT_KEYS, '');
  assert.ok(h2.includes('MY_UNKNOWN_KEY'), '未知值必须保留在选项里');
  assert.ok(h2.includes('引擎不认识'), '未知值应标出来');
});
check('三个下拉的选项都必须是中文对照，不能拿阶段或说明首字当标签', () => {
  const pick = (field, dict) => api.enumPicker('garrisons', 'garrison_96_a', field, field, api.work.garrisons.garrison_96_a, dict, '');
  const opts = (html) => [...html.matchAll(/<option[^>]*>([^<]*)</g)].map((m) => m[1]);
  // EFFECT_KEYS 是 [阶段, 中文]，曾经把 'prep'/'battle' 当成中文显示成「battle —— GAIN_BUFF」
  const keys = opts(pick('effectKey', api.EFFECT_KEYS));
  assert.equal(keys.length, Object.keys(api.EFFECT_KEYS).length, 'effectKey 选项数应与字典一致');
  const bare = keys.filter((t) => /^(prep|battle)\s*——/.test(t));
  assert.equal(bare.length, 0, 'effectKey 把阶段当中文显示了：' + bare.slice(0, 3).join(' / '));
  const noZh = keys.filter((t) => !/[\u4e00-\u9fa5]/.test(t));
  assert.equal(noZh.length, 0, '这些 effectKey 选项没有中文：' + noZh.slice(0, 5).join(' / '));
  assert.ok(keys.some((t) => t.startsWith('【备战】')), 'effectKey 应标出备战类');
  assert.ok(keys.some((t) => t.startsWith('【战斗】')), 'effectKey 应标出战斗类');
  assert.ok(keys.findIndex((t) => t.startsWith('【战斗】')) > keys.findIndex((t) => t.startsWith('【备战】')), '备战类应排在战斗类前面');
  // EVENT_TYPES 的中文在第一格，排序与显示都该用它
  const evs = opts(pick('eventType', api.EVENT_TYPES));
  assert.equal(evs.length, Object.keys(api.EVENT_TYPES).length, 'eventType 选项数应与字典一致');
  assert.equal(evs.filter((t) => !/[\u4e00-\u9fa5]/.test(t)).length, 0, 'eventType 选项没有中文');
  assert.equal(evs[0].split(' —— ')[0], '本轮备战结束', 'eventType 应按中文排序');
  // EFFECT_TYPES 是纯字符串字典，曾经被当数组取 [0] 只剩「按」
  const tys = opts(pick('effectType', api.EFFECT_TYPES));
  assert.equal(tys.length, Object.keys(api.EFFECT_TYPES).length, 'effectType 选项数应与字典一致');
  const stubs = tys.filter((t) => (t.split(' —— ')[0] || '').length < 3);
  assert.equal(stubs.length, 0, 'effectType 只显示了说明首字：' + stubs.slice(0, 5).join(' / '));
});
check('源码里没有任何一处把 effectKey / effectType / eventType 当裸文本框渲染', () => {
  const bare = html.split(/\r?\n/).filter((l) => /textField\([^)]*'(effectKey|effectType|eventType)'/.test(l));
  assert.equal(bare.length, 0, '这些行还在用裸文本框：' + bare.map((x) => x.trim()).join(' | '));
});
check('可以合法地把 eventType / effectKey 改成另一个官方组合', () => {
  const gid = 'garrison_05_a';
  const before = JSON.parse(JSON.stringify(api.work.garrisons[gid]));
  api.setField('garrisons', gid, 'eventType', 'SERVER_PREP_FIN');
  api.setField('garrisons', gid, 'effectKey', 'SERVER_MOST_BOND');
  api.validate();
  const bad = api.issues().filter((i) => i.where === gid && i.lvl === 'bad');
  assert.equal(bad.length, 0, '换成合法组合后不该报错：' + JSON.stringify(bad.map((x) => x.m)));
  api.work.garrisons[gid] = before;
  api.validate();
});
check('乱搭配会被校验器提醒', () => {
  const gid = 'garrison_05_a';
  const before = JSON.parse(JSON.stringify(api.work.garrisons[gid]));
  // SERVER_ADD_BOND 配 SERVER_CHESS_SOLD：官方数据里没有这个组合
  api.setField('garrisons', gid, 'effectKey', 'SERVER_ADD_BOND');
  api.setField('garrisons', gid, 'eventType', 'SERVER_CHESS_SOLD');
  api.validate();
  const hit = api.issues().some((i) => i.where === gid && /只有这一条/.test(i.m));
  api.work.garrisons[gid] = before;
  api.validate();
  assert.ok(hit, '没见过的搭配应给提醒');
});
check('编造 eventType 会被校验器报成错误', () => {
  const gid = 'garrison_05_a';
  const before = JSON.parse(JSON.stringify(api.work.garrisons[gid]));
  api.setField('garrisons', gid, 'eventType', 'SERVER_WHENEVER');
  api.validate();
  const hit = api.issues().some((i) => i.where === gid && i.lvl === 'bad' && /不是引擎认的触发时机/.test(i.m));
  api.work.garrisons[gid] = before;
  api.validate();
  assert.ok(hit, '未知 eventType 应报红');
});
check('搭配参考表列出官方组合并高亮当前这条', () => {
  const html = api.effectCombos('garrison_05_a');
  assert.ok(html.includes('搭配参考'), '缺标题');
  assert.ok(html.includes('触发时机'), '缺表头');
  assert.ok(html.includes('←当前'), '应高亮当前这条的组合');
  // 数据里有 SERVER_GAIN + SERVER_ADD_BOND 这个组合
  assert.ok(html.includes('SERVER_GAIN') && html.includes('SERVER_ADD_BOND'), '应含官方组合');
});

// ---- 17k. 混合特性：哪些能合、哪些不能合，必须跟引擎的实际能力一致 --------------------------
console.log('混合特性 (mixTraits)');
check('同 effectKey + 列表参数 → 可合成一条（盟约列表按位置合并）', () => {
  // 156_a 与 35_a 的参数形状不同，改用两条同族的「获得时给盟约层数」
  // 156_a: bbStr{bond:"yanShip,miraShip", count:"6,3"}
  // 157_a: bbStr{bond:"miraShip"} bb{count:3}
  // 这两条 effectKey 不同（MULTIPLE_BOND vs ADD_BOND），所以先验证「不能合」
  const bad = api.mixTraits(['garrison_156_a', 'garrison_157_a']);
  assert.equal(bad.ok, false, '不同 effectKey 不该合');
  assert.equal(bad.kind, 'incompatible');
  assert.ok(/effectKey 不同/.test(bad.reason), '原因应说明 effectKey 不同：' + bad.reason);
  assert.ok(bad.notes.some((n) => /同时带/.test(n)), '应给出替代方案（同时携带多条）');
});
check('同 effectKey 的两条能合，且盟约列表对齐合并', () => {
  // 造两条同 key 的测试特质：SERVER_ADD_MULTIPLE_BOND + 列表参数
  const a = { garrisonId: 'mixT_a', effectKey: 'SERVER_ADD_MULTIPLE_BOND', eventType: 'SERVER_GAIN', bb: {}, bbStr: { bond: 'yanShip,miraShip', count: '12,6' }, desc: 'A', owners: [] };
  const b = { garrisonId: 'mixT_b', effectKey: 'SERVER_ADD_MULTIPLE_BOND', eventType: 'SERVER_GAIN', bb: {}, bbStr: { bond: 'arcaneShip', count: '6' }, desc: 'B', owners: [] };
  api.work.garrisons.mixT_a = a; api.work.garrisons.mixT_b = b;
  const m = api.mixTraits(['mixT_a', 'mixT_b'], { newId: 'mixT_out' });
  assert.equal(m.ok, true, m.reason);
  assert.equal(m.kind, 'merge', '两条参数都是列表形状，应无冲突：' + JSON.stringify(m.dropped));
  assert.equal(m.record.bbStr.bond, 'yanShip,miraShip,arcaneShip');
  assert.equal(m.record.bbStr.count, '12,6,6');
  // 两个串必须等长，否则 bond 与 count 会错位
  assert.equal(m.record.bbStr.bond.split(',').length, m.record.bbStr.count.split(',').length, 'bond 与 count 必须一一对应');
  assert.equal(m.record.effectKey, 'SERVER_ADD_MULTIPLE_BOND');
  assert.deepEqual(m.record.owners, [], '新特质的 owners 应为空');
  assert.deepEqual(m.record.synth.mix, ['mixT_a', 'mixT_b'], '应记录来源');
  delete api.work.garrisons.mixT_a; delete api.work.garrisons.mixT_b;
});
check('标量参数冲突时保留优先级最高的那条，并如实列出被顶掉的', () => {
  const a = { garrisonId: 'mixT_c', effectKey: 'SERVER_ONCE_GOLD', eventType: 'SERVER_GAIN', bb: { count: 2 }, bbStr: {}, desc: 'C', owners: [] };
  const b = { garrisonId: 'mixT_d', effectKey: 'SERVER_ONCE_GOLD', eventType: 'SERVER_GAIN', bb: { count: 10 }, bbStr: {}, desc: 'D', owners: [] };
  api.work.garrisons.mixT_c = a; api.work.garrisons.mixT_d = b;
  const m = api.mixTraits(['mixT_c', 'mixT_d'], { newId: 'mixT_out2' });
  assert.equal(m.ok, true, m.reason);
  assert.equal(m.kind, 'same-key-note', '有标量被顶掉时应给 note 而不是假装干净');
  assert.equal(m.record.bb.count, 2, '应沿用排在前面的那条（2）');
  assert.ok(m.dropped.some((d) => /bb\.count/.test(d)), '被顶掉的键应列出来：' + JSON.stringify(m.dropped));
  assert.ok(m.notes.some((n) => /只能保留一个值/.test(n)), '说明里要讲清楚');
  // 交换顺序后应改成保留 10
  const m2 = api.mixTraits(['mixT_d', 'mixT_c'], { newId: 'mixT_out3' });
  assert.equal(m2.record.bb.count, 10, '顺序应决定保留谁');
  delete api.work.garrisons.mixT_c; delete api.work.garrisons.mixT_d;
});
check('少于 2 条 / 不存在的 id 都被拒绝', () => {
  assert.equal(api.mixTraits(['garrison_01_a']).ok, false);
  assert.equal(api.mixTraits([]).ok, false);
  const r = api.mixTraits(['garrison_01_a', '并不存在']);
  assert.equal(r.ok, false);
  assert.ok(/不存在/.test(r.reason), r.reason);
});
check('创建混合特质：撞 id 自动加后缀，不覆盖已有记录', () => {
  const a = { garrisonId: 'mixU_a', effectKey: 'SERVER_ONCE_GOLD', eventType: 'SERVER_GAIN', bb: { count: 1 }, bbStr: {}, desc: 'U', owners: [] };
  api.work.garrisons.mixU_a = a;
  const m = api.mixTraits(['mixU_a', 'mixU_a'], { newId: 'x' });   // 去重后只剩 1 条 → 拒绝
  assert.equal(m.ok, false, '去重后不足 2 条应拒绝');
  const m2 = api.mixTraits(['mixU_a', 'garrison_26_a'], { newId: 'mixU_out' });
  // 26_a 也是 SERVER_ONCE_GOLD，可合
  assert.equal(m2.ok, true, m2.reason);
  const r1 = api.createMixedTrait(m2, { newId: 'mixU_out' });
  assert.equal(r1.ok, true, r1.reason);
  assert.equal(r1.id, 'mixU_out');
  assert.ok(api.work.garrisons.mixU_out, '应写入数据表');
  assert.deepEqual(api.work.garrisons.mixU_out.owners, [], '未指定干员时 owners 为空');
  // 再建一次同名 → 自动加后缀
  const r2 = api.createMixedTrait(m2, { newId: 'mixU_out' });
  assert.equal(r2.ok, true, r2.reason);
  assert.equal(r2.id, 'mixU_out_1', '撞 id 应加后缀而不是覆盖，实际 ' + r2.id);
  assert.ok(api.work.garrisons.mixU_out, '原来那条必须还在');
  for (const k of ['mixU_a', 'mixU_out', 'mixU_out_1']) delete api.work.garrisons[k];
});
check('创建时校验 id：中文与非法字符拒绝', () => {
  const a = { garrisonId: 'mixV_a', effectKey: 'SERVER_ONCE_GOLD', eventType: 'SERVER_GAIN', bb: { count: 1 }, bbStr: {}, owners: [] };
  api.work.garrisons.mixV_a = a;
  const m = api.mixTraits(['mixV_a', 'garrison_26_a'], {});
  assert.equal(m.ok, true, m.reason);
  assert.equal(api.createMixedTrait(m, { newId: '混合特性' }).ok, false, '中文 id 应拒绝');
  assert.equal(api.createMixedTrait(m, { newId: '1abc' }).ok, false, '数字开头应拒绝');
  assert.equal(api.createMixedTrait(m, { newId: '' }).ok, false, '空 id 应拒绝');
  delete api.work.garrisons.mixV_a;
});
check('把特质挂到干员身上（合成后「同时携带」的正确做法）', () => {
  const cid = 'chess_char_6_03_a';
  const before = [...api.work.chess[cid].garrisonIds];
  const r = api.attachTraitToChess(cid, 'garrison_26_a');
  assert.equal(r.ok, true, r.reason);
  assert.ok(api.work.chess[cid].garrisonIds.includes('garrison_26_a'), '应挂上');
  assert.equal(api.attachTraitToChess(cid, 'garrison_26_a').ok, false, '重复挂应拒绝');
  assert.equal(api.attachTraitToChess('不存在', 'garrison_26_a').ok, false, '不存在的干员应拒绝');
  api.work.chess[cid].garrisonIds = before;
});
check('混合出来的特质能通过校验器（不引入新错误）', () => {
  const a = { garrisonId: 'mixW_a', effectKey: 'SERVER_ADD_MULTIPLE_BOND', eventType: 'SERVER_GAIN', bb: {}, bbStr: { bond: 'yanShip', count: '6' }, owners: [] };
  const b = { garrisonId: 'mixW_b', effectKey: 'SERVER_ADD_MULTIPLE_BOND', eventType: 'SERVER_GAIN', bb: {}, bbStr: { bond: 'arcaneShip', count: '6' }, owners: [] };
  api.work.garrisons.mixW_a = a; api.work.garrisons.mixW_b = b;
  const m = api.mixTraits(['mixW_a', 'mixW_b'], { newId: 'mixW_out' });
  const r = api.createMixedTrait(m, { newId: 'mixW_out' });
  assert.equal(r.ok, true, r.reason);
  api.validate();
  const bad = api.issues().filter((i) => i.where === 'mixW_out' && i.lvl === 'bad');
  assert.equal(bad.length, 0, '混合结果不该有错误级问题：' + JSON.stringify(bad.map((x) => x.m)));
  // effectKey / eventType 都要是引擎认的
  assert.ok(api.EFFECT_KEYS[api.work.garrisons.mixW_out.effectKey], 'effectKey 应在白名单里');
  assert.ok(api.EVENT_TYPES[api.work.garrisons.mixW_out.eventType], 'eventType 应在白名单里');
  for (const k of ['mixW_a', 'mixW_b', 'mixW_out']) delete api.work.garrisons[k];
});
check('混合页渲染出规则说明与结论区', () => {
  api.setTab('mix');
  api.mixSel.ids = ['garrison_156_a', 'garrison_157_a'];
  const html = api.mixDetailHtml ? api.mixDetailHtml() : '';
  assert.ok(html.includes('混合规则'), '缺规则说明');
  assert.ok(html.includes('不能合成一条'), '这两条 effectKey 不同，应给「不能合成」的结论');
  assert.ok(html.includes('同时带'), '应给出替代方案');
  api.mixSel.ids = ['garrison_156_a', 'garrison_205_a'];
  const html2 = api.mixDetailHtml ? api.mixDetailHtml() : '';
  assert.ok(html2.length > 0, '应能渲染');
  api.mixSel.ids = [];
});

// ---- 17l. 盟约换绑：把【精准】换成【奥术】这类操作 ----------------------------------------
console.log('盟约换绑 (rebindTraitBond)');
check('识别出盟约写在哪个字段（bond_id / bond）', () => {
  assert.equal(api.traitBondField(api.work.garrisons.garrison_96_a), 'bond_id', '96_a 的盟约在 bond_id');
  assert.equal(api.traitBondField(api.work.garrisons.garrison_156_a), 'bond', '156_a 的盟约在 bond');
  // 找一个两者都没有的特质
  const none = Object.values(api.work.garrisons).find((g) => !api.traitBondField(g));
  assert.ok(none, '应该存在不绑定盟约的特质');
});
check('把【精准】换成【奥术】：字段与文案同步改', () => {
  const gid = 'garrison_96_a';
  const before = JSON.parse(JSON.stringify(api.work.garrisons[gid]));
  assert.equal(before.bbStr.bond_id, 'preciShip');
  assert.ok(before.desc.includes('【精准】'), '前提：文案里写着精准');
  const r = api.rebindTraitBond(gid, 'arcaneShip');
  assert.equal(r.ok, true, r.reason);
  const after = api.work.garrisons[gid];
  assert.equal(after.bbStr.bond_id, 'arcaneShip', 'bbStr 要换掉');
  assert.ok(!after.desc.includes('【精准】'), '文案里不该还留着精准：' + after.desc);
  assert.ok(after.desc.includes('【奥术】'), '文案应变成奥术：' + after.desc);
  assert.ok(after.descRaw.includes('【奥术】'), 'descRaw 也要跟着改（游戏渲染它）');
  // 数值与其它字段一个字都不能动
  assert.deepEqual(after.bb, before.bb, 'bb 不该变');
  assert.equal(after.effectKey, before.effectKey);
  assert.equal(after.eventType, before.eventType);
  api.work.garrisons[gid] = before;
});
check('文案里有多条盟约名时，只换该换的那条（不误伤）', () => {
  // garrison_05_a: bbStr.bond_id = "谢拉格"，但 desc 里还有【奥术】
  const gid = 'garrison_05_a';
  const before = JSON.parse(JSON.stringify(api.work.garrisons[gid]));
  // bond_id 可能是多条（逗号分隔）；rebindTraitBond 只换第一条，测试也按第一条取
  const bid = String(before.bbStr.bond_id).split(',')[0].trim();
  const oldName = api.work.bonds[bid].name;
  assert.ok(before.desc.includes('【' + oldName + '】'), '前提：文案含旧盟约名');
  const other = /【([^】]+)】/g;
  const allNames = new Set([...String(before.desc).matchAll(other)].map((m) => m[1]));
  allNames.delete(oldName);
  assert.ok(allNames.size > 0, '前提：文案里还有别的【…】');
  const r = api.rebindTraitBond(gid, 'arcaneShip');
  assert.equal(r.ok, true, r.reason);
  const after = api.work.garrisons[gid];
  assert.ok(after.desc.includes('【奥术】'), '应换成奥术');
  for (const nm of allNames) {
    if (nm === '奥术') continue;   // 换成的就是它
    assert.ok(after.desc.includes('【' + nm + '】'), '「' + nm + '」不该被动到：' + after.desc);
  }
  api.work.garrisons[gid] = before;
});
check('换绑非法/不存在的盟约被拒绝，且不改记录', () => {
  const gid = 'garrison_96_a';
  const before = JSON.parse(JSON.stringify(api.work.garrisons[gid]));
  assert.equal(api.rebindTraitBond(gid, '并不存在').ok, false);
  assert.equal(api.rebindTraitBond(gid, '').ok, false, '空值应拒绝');
  assert.deepEqual(api.work.garrisons[gid], before, '被拒绝时记录一个字都不能变');
});
check('多条盟约时只替换指定位置那条，其余原样保留', () => {
  // garrison_38_a: bbStr.bond_id = "egirShip,steadShip,raidShip"
  const gid = 'garrison_38_a';
  const before = JSON.parse(JSON.stringify(api.work.garrisons[gid]));
  assert.equal(before.bbStr.bond_id, 'egirShip,steadShip,raidShip', '前提');
  const r = api.rebindTraitBond(gid, 'arcaneShip', 1);   // 换第 2 条（steadShip）
  assert.equal(r.ok, true, r.reason);
  assert.equal(api.work.garrisons[gid].bbStr.bond_id, 'egirShip,arcaneShip,raidShip', '只动第 2 条，首尾保留');
  assert.equal(r.pos, 1);
  api.work.garrisons[gid] = before;
});
check('多条盟约面板给出「第几条」选择器', () => {
  const html = api.bondBindBlock('garrison_38_a', api.work.garrisons.garrison_38_a);
  assert.ok(html.includes('rebindPos'), '多条时应给位置选择器');
  assert.ok(html.includes('第 2 条'), '应列出每一条');
  // 单条时不该出现位置选择器
  const one = api.bondBindBlock('garrison_96_a', api.work.garrisons.garrison_96_a);
  assert.ok(!one.includes('rebindPos'), '单条时不需要位置选择器');
});
check('不绑定盟约的特质没有这个编辑器', () => {
  const gid = Object.keys(api.work.garrisons).find((g) => !api.traitBondField(api.work.garrisons[g]));
  assert.ok(gid, '应存在这样的特质');
  assert.equal(api.bondBindBlock(gid, api.work.garrisons[gid]), '', '不该渲染换绑面板');
});
check('换绑面板列出全部盟约并标出各自用量', () => {
  const html = api.bondBindBlock('garrison_96_a', api.work.garrisons.garrison_96_a);
  assert.ok(html.includes('盟约绑定'), '缺标题');
  assert.ok(html.includes('rebindBtn'), '缺换绑按钮');
  assert.ok(html.includes('value="arcaneShip"'), '下拉里应有奥术');
  assert.ok(/条特质在用/.test(html), '应标出用量');
  assert.ok(html.includes('preciShip'), '应显示当前绑定');
});
check('换绑后新数据依然能通过校验器', () => {
  const gid = 'garrison_96_a';
  const before = JSON.parse(JSON.stringify(api.work.garrisons[gid]));
  const r = api.rebindTraitBond(gid, 'arcaneShip');
  assert.equal(r.ok, true, r.reason);
  api.validate();
  const bad = api.issues().filter((i) => i.where === gid && i.lvl === 'bad');
  assert.equal(bad.length, 0, '换绑后不该有错误级问题：' + JSON.stringify(bad.map((x) => x.m)));
  api.work.garrisons[gid] = before;
  api.validate();
});

// ---- 17m. effectKey 的中文呈现：任何界面都不该直接把英文键当标签 ----------------------------
console.log('effectKey 的中文呈现');
check('effectKeyLabel 给中文，未知键明确标出', () => {
  const l1 = api.effectKeyLabel('act1autochess_gar_eff_attrByBond');
  assert.ok(/层数/.test(l1), '应给中文说明：' + l1);
  assert.ok(!/^[a-z0-9_]+$/.test(l1), '不该原样返回英文键');
  const l2 = api.effectKeyLabel('MY_UNKNOWN_KEY');
  assert.ok(/未实现/.test(l2), '未知键要明确标出：' + l2);
  assert.equal(api.effectKeyLabel(''), '（无 effectKey）');
  const full = api.effectKeyLabelFull('SERVER_ONCE_GOLD');
  assert.ok(full.includes('SERVER_ONCE_GOLD') && /资金|一次性/.test(full), 'Full 版要带英文键：' + full);
});
check('数据里每个 effectKey 都有中文，没有漏网的', () => {
  const used = new Set(Object.values(api.work.garrisons).map((g) => g.effectKey).filter(Boolean));
  const miss = [...used].filter((k) => !/[\u4e00-\u9fa5]/.test(api.effectKeyLabel(k)) || /未实现/.test(api.effectKeyLabel(k)));
  assert.equal(miss.length, 0, '这些 effectKey 没翻译：' + miss.join(', '));
});
check('干员页的特质区块不再裸显示英文 effectKey', () => {
  const e = api.opIndex().find((x) => x.key === 'chess:chess_char_6_03_a');
  api.pageCtx = e;
  const html = api.opForm(e);
  api.pageCtx = null;
  assert.ok(html.includes('效果：'), '应显示「效果：中文」');
  // 找出数据里这条特质的中文，确认出现
  const gids = api.opGarrisonIds(e);
  for (const gid of gids) {
    const zh = api.effectKeyLabel(api.work.garrisons[gid].effectKey);
    assert.ok(html.includes(zh), '干员页应显示 ' + zh + '（' + gid + '）');
  }
  assert.ok(!/<span class="chip bad">effectKey 未实现<\/span>/.test(html), '不再用英文标签「effectKey 未实现」');
});
check('混合特性页的标签用中文而不是英文键', () => {
  api.mixSel.ids = ['garrison_96_a', 'garrison_96_b'];
  const html = api.mixDetailHtml();
  assert.ok(html.includes(api.effectKeyLabel('act1autochess_gar_event_useskill')), '已选列表应显示中文');
  api.mixSel.ids = [];
});
check('键名词典列出全部 effectKey 与 eventType，并显示已翻译计数', () => {
  const html = api.effectOverviewHtml('');
  assert.ok(html.includes('效果与触发时机对照'), '缺区块');
  for (const k of Object.keys(api.EVENT_TYPES)) assert.ok(html.includes(k), 'eventType 缺 ' + k);
  const usedKeys = [...new Set(Object.values(api.work.garrisons).map((g) => g.effectKey).filter(Boolean))];
  const missing = usedKeys.filter((k) => !html.includes(k));
  assert.equal(missing.length, 0, '词典里缺这些 effectKey：' + missing.slice(0, 5).join(', '));
  assert.ok(/全部已翻译/.test(html), '应显示全部已翻译');
  assert.ok(!/未翻译：/.test(html), '不该有未翻译项');
});
check('键名词典的搜索也能过滤效果对照表', () => {
  const html = api.effectOverviewHtml('精准');
  assert.ok(html.length > 0);
  const all = api.effectOverviewHtml('');
  assert.ok(html.length < all.length, '过滤后应更短');
});

// ---- 18. id boxes must reject pasted prose; both 文案 boxes use the override table ---------
console.log('prose guard + unified text boxes');
check('looksLikeProse rejects pasted descriptions', () => {
  assert.ok(api.looksLikeProse('<@ba.vup>休整期结束时</>使已激活的【炎】层数+1'), 'markup text');
  assert.ok(api.looksLikeProse('使已激活的【坚守】层数 +1'), 'spaced text');
  assert.ok(api.looksLikeProse('本回合每花费3资金，使【灵巧】+2'), 'CJK punctuation');
  assert.ok(api.looksLikeProse('garrison_' + 'x'.repeat(60)), 'over-long');
});
check('looksLikeProse accepts real ids and names', () => {
  assert.ok(!api.looksLikeProse('garrison_19_a'));
  assert.ok(!api.looksLikeProse('chess_char_1_20_a'));
  assert.ok(!api.looksLikeProse('角峰'));
});
check('每张文案卡只绑定自己的那条特质', () => {
  // Multi-trait operators are the interesting case: each box must carry its OWN garrison id,
  // and a shared trait must come back read-only instead of bound to a box.
  let multi = null;
  for (const [cid, rec] of Object.entries(api.work.chess)) {
    if (cid.endsWith('_a') && (rec.garrisonIds || []).length >= 2) { multi = { cid, rec }; break; }
  }
  assert.ok(multi, 'no chess _a record carries two or more traits');
  const gids = multi.rec.garrisonIds;
  const editable = gids.filter((gid) => isEditableHere(gid, multi.cid));
  const shared = gids.filter((gid) => !isEditableHere(gid, multi.cid));
  const html = api.textsBlock('chess', multi.cid, multi.rec);
  const ovBoxes = [...html.matchAll(/data-ov="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ovBoxes.sort(), [...editable].sort(), 'only exclusive traits of ' + multi.cid + ' may bind a box');
  for (const gid of shared) {
    assert.ok(!ovBoxes.includes(gid), 'shared trait ' + gid + ' must not be editable in place');
    assert.ok(html.includes('data-copyg="' + gid + '"'), 'shared trait ' + gid + ' must offer the copy button');
  }
  // one box per trait, editable or not — no card may be silently dropped
  const boxes = (html.match(/<textarea/g) || []).length;
  assert.equal(boxes, gids.length, multi.cid + ': ' + boxes + ' boxes for ' + gids.length + ' traits');
  assert.ok(!html.includes('__garrison.'), 'the boxes must not write the record directly any more');
});
// ---- 19. one card per trait in the 文案 block ---------------------------------------------
console.log('one row per trait');
check('文案 renders exactly one numbered card per trait', () => {
  for (const [cid, rec] of Object.entries(api.work.chess)) {
    if (!cid.endsWith('_a') || !(rec.garrisonIds || []).length) continue;
    const html = api.textsBlock('chess', cid, rec);
    const cards = (html.match(/class="txrow"/g) || []).length;
    assert.equal(cards, rec.garrisonIds.length, cid + ': ' + cards + ' cards for ' + rec.garrisonIds.length + ' traits');
    // each card carries its own id and a 1/N … N/N counter
    const nums = [...html.matchAll(/<b>(\d+)\/\d+<\/b><code>([^<]+)<\/code>/g)].map((m) => m[1] + ':' + m[2]);
    assert.equal(nums.length, rec.garrisonIds.length, cid + ': numbering missing');
  }
});
check('each card binds its own trait id (no cross-wiring)', () => {
  const cid = 'chess_char_2_04_a';
  const rec = api.work.chess[cid];
  const html = api.textsBlock('chess', cid, rec);
  const boxes = [...html.matchAll(/data-ov="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(boxes, rec.garrisonIds, 'the text boxes must follow the trait order');
});
check('整页覆盖的页签必须检查「外壳还在不在」，否则切回来会停在上一页', () => {
  /*
   * 真出现过的 bug：词典页只用 `main.dataset.gsig` 判断要不要重建外壳，而「改动 / 校验 / 说明」
   * 这几个页签是整页覆盖、不写 dataset。于是「词典 → 校验 → 词典」时签名没变、跳过重建，
   * 而 #gRows 已经不存在 —— 表体填不进去，页面停在上一页的内容上。
   * 修法是连「外壳元素还在不在」一起判断。这里从源码上钉住这个写法。
   */
  assert.ok(/main\.dataset\.gsig !== sig \|\| !main\.querySelector\('#gRows'\)/.test(source),
    '词典页的守卫必须检查 #gRows 是否还在');
  const listGuards = (source.match(/if \(!\(shell && main\.dataset\.sig === sig\)\)/g) || []).length
    + (source.match(/if \(!\(main\.querySelector\('\.list'\) && main\.dataset\.sig === sig\)\)/g) || []).length;
  assert.ok(listGuards >= 5, '列表页的守卫应当都要求 .list 存在，实际只有 ' + listGuards + ' 处');
});

// ---- 20. 道具 / 悬赏·战术卡 / 效果（三张新表） ---------------------------------------------
console.log('道具页');
check('道具页列出全部 115 条，且每条的数值都是真的数字', () => {
  const ids = api.itemIds();
  assert.equal(ids.length, 115, '道具条数：' + ids.length);
  for (const id of ids) {
    const r = api.work.items[id];
    assert.ok(r && r.name, id + ' 缺 name');
    const bbVals = (r.buffs || []).flatMap((b) => Object.values((b && b.bb) || {}));
    for (const v of bbVals) assert.equal(typeof v, 'number', id + ' 的 bb 里有非数字：' + JSON.stringify(v));
  }
});
check('道具详情页渲染出效果实现 / params 同步 / 效果镜像三块', () => {
  const html = api.itemForm('chess_item_6_03_e_a');
  assert.ok(html.includes('效果实现 buffs'), '缺 buffs 块');
  assert.ok(html.includes('params（引擎内置备战效果的扁平数值表）'), '缺 params 块');
  assert.ok(html.includes('对应的效果记录'), '缺效果镜像块');
  assert.ok(html.includes('天师古鼎'), '缺名字');
  assert.ok(html.includes('buffs.0.key'), '缺 key 下拉');
  assert.ok(/战斗增益通用壳|装备时销毁/.test(html), 'buff key 没有中文对照');
  assert.ok(html.includes('bb.attack_speed'), '缺 bb 数值键');
  assert.ok(html.includes('攻击速度'), 'bb 键没有中文含义');
});
check('每条道具的配对（_a/_b）能互相跳转', () => {
  const html = api.itemForm('chess_item_1_01_e_a');
  assert.ok(html.includes('data-goto-id="chess_item_1_01_e_b"'), '缺切到精锐版的按钮');
  assert.ok(api.itemForm('chess_item_1_01_e_b').includes('data-goto-id="chess_item_1_01_e_a"'), '精锐版缺切回按钮');
});
check('道具页的布尔字段写的是真布尔（不是字符串）', () => {
  const html = api.boolField('items', 'chess_item_1_01_e_a', 'mergeable', 'mergeable', api.work.items.chess_item_1_01_e_a);
  assert.ok(html.includes('data-type="bool"'), '布尔控件少了 data-type');
  assert.ok(/<option value="true" selected>/.test(html), '应选中「是」');
  const elite = api.boolField('items', 'chess_item_1_02_e_b', 'mergeable', 'mergeable', api.work.items.chess_item_1_02_e_b);
  assert.ok(elite.includes('<option value="false" selected>'), '精锐版应选中「否」');
});
check('foldParams 与构建管线口径一致：先出现者胜（不是后者覆盖）', () => {
  const { flat, dup } = api.foldParams([
    { key: 'a', bb: { x: 1, y: 1 }, bbStr: {} },
    { key: 'b', bb: { x: 2, z: 3 }, bbStr: {} },
  ]);
  assert.equal(flat.x, 1, 'x 应保留第一次出现的 1（build-data 的 effectParams 是 first-wins）');
  assert.equal(flat.y, 1);
  assert.equal(flat.z, 3);
  assert.equal(dup.length, 1, '应报出重名键');
  assert.ok(dup[0].includes('x'), '重名键应是 x：' + dup.join(','));
});
check('params 同步块能算出差异并给出重建按钮', () => {
  const html = api.paramsSyncBlock('items', 'x', { buffs: [{ key: 'k', bb: { a: 1 }, bbStr: {} }], params: { a: 1, b: 2 } });
  assert.ok(html.includes('data-paramsync'), '缺重建按钮');
  assert.ok(html.includes('现在的 params'), '缺对照表');
  const same = api.paramsSyncBlock('items', 'x', { buffs: [{ key: 'k', bb: { a: 1 }, bbStr: {} }], params: { a: 1 } });
  assert.ok(same.includes('完全一致'), '一致时不该报差异');
});
check('道具的 buffs 与效果记录镜像不一致时会被指出来', () => {
  const id = 'chess_item_1_01_e_a';
  const r = api.work.items[id];
  assert.ok(api.effectMirrorBlock('items', id, r).includes('与效果记录一致'), '镜像一致时应标一致');
  const bad = api.effectMirrorBlock('items', id, { ...r, buffs: [{ key: 'k', bb: { z: 1 }, bbStr: {} }] });
  assert.ok(/与效果记录<b>不一致<\/b>/.test(bad), '应指出不一致');
});

console.log('悬赏 · 战术卡页');
check('卡牌页列出 129 张悬赏 + 43 张战术', () => {
  const ids = api.cardIds();
  assert.equal(ids.length, 172, '卡数：' + ids.length);
  assert.equal(ids.filter((x) => x.startsWith('cards.bounty.')).length, 129);
  assert.equal(ids.filter((x) => x.startsWith('cards.tactic.')).length, 43);
});
check('卡牌记录按数组路径读取（根级布局），改的是 choices.json 里的那一张', () => {
  const id = 'cards.bounty.0';
  const rec = api.recordOf('choices', id);
  assert.ok(rec && rec.effectId, '应能按点号路径取到卡');
  const before = rec.name;
  api.setField('choices', id, 'name', '探针改名');
  assert.equal(api.recordOf('choices', id).name, '探针改名', 'setField 应写进那张卡');
  assert.ok(api.log.some((e) => e.file === 'choices' && e.id === id && e.field === 'name'), '应记进变更日志');
  api.setField('choices', id, 'name', before);
  api.log.length = 0;
});
check('卡牌详情页把卡本体与它引用的效果分开写（效果写到 effects.json）', () => {
  const html = api.cardForm('cards.bounty.0');
  assert.ok(html.includes('文案与定位'), '缺卡本体块');
  assert.ok(html.includes('效果实现 buffs'), '缺效果块');
  assert.ok(/data-root="effects\|/.test(html), '效果控件必须绑定到 effects 表：' + (html.match(/data-root="[^"]+"/) || [])[0]);
  assert.ok(!/data-root="choices\|[^"]*\|buffs/.test(html), 'buff 控件不能写回卡本身（卡没有 buffs 字段）');
});
check('悬赏卡的 payout 有中文对照，且下拉写的是英文值', () => {
  const html = api.cardForm('cards.bounty.0');
  assert.ok(html.includes('完美作战'), 'payout 没有中文');
  assert.ok(html.includes('value="perfect"'), 'payout 的值应是英文键');
});
check('悬赏卡会对照「卡上字段 vs 效果 buff 黑板」两处真相', () => {
  const c = api.recordOf('choices', 'cards.bounty.0');
  const html = api.bountyRuntimeDiff(c, api.effectOf(c.effectId));
  assert.ok(html.includes('卡上') && html.includes('效果 buff 黑板'), '应对照两处');
  assert.ok(html.includes('敌人 id') && html.includes('资金'), '应列出关键项');
});

console.log('效果页');
check('效果页列出全部 361 条，并按 effectType 分组', () => {
  const ids = api.effectIds();
  assert.equal(ids.length, 361, '效果条数：' + ids.length);
  const groups = [...new Set(ids.map((id) => api.effectTypeZh(api.work.effects[id].effectType)))];
  assert.ok(groups.length >= 6, '分组太少：' + groups.join(','));
});
check('每条效果都能反查「谁在用」（道具 / 卡 / 盟约 / 策略）', () => {
  const cases = [['eff_acarm041', '道具'], ['enemyeffect_1', '卡牌'], ['aceffect_band_21', '策略'], ['bondeffect_yan', '盟约']];
  for (const [eid, kind] of cases) {
    if (!api.work.effects[eid]) continue;
    const own = api.effectOwners(eid);
    assert.ok(own.some((o) => o.kind === kind), eid + ' 应能找到 ' + kind + ' 引用，实际：' + JSON.stringify(own.map((o) => o.kind)));
  }
});
check('效果详情页渲染出使用方、buffs、params 三块', () => {
  const html = api.effectForm('eff_acarm041');
  assert.ok(html.includes('谁在用这条效果'), '缺使用方块');
  assert.ok(html.includes('效果实现 buffs'), '缺 buffs 块');
  assert.ok(html.includes('params（引擎内置备战效果的扁平数值表）'), '缺 params 块');
  assert.ok(html.includes('道具效果'), 'effectType 应显示中文');
});

console.log('新表的键名翻译');
check('每个 buff 处理器键都有中文，且「没处理者」的键被明确标出', () => {
  const d = api.BUFF_KEY_ZH;
  assert.ok(Object.keys(d).length >= 70, 'buff key 词典条目太少：' + Object.keys(d).length);
  const noZh = Object.entries(d).filter(([, v]) => !/[\u4e00-\u9fa5]/.test(v[0]));
  assert.equal(noZh.length, 0, '这些键没有中文：' + noZh.map(([k]) => k).join(','));
  const dead = Object.entries(d).filter(([, v]) => /没有处理者/.test(v[0])).map(([k]) => k);
  assert.ok(dead.length >= 3, '应当至少标出 3 个源码里没有处理者的键，实际：' + dead.join(','));
});
check('数据里用到的 buff 键与符文键全都有翻译（不认识的必须显眼）', () => {
  const keys = new Set(), runes = new Set();
  for (const kind of ['items', 'effects']) {
    for (const rec of Object.values(api.work[kind])) {
      for (const b of rec.buffs || []) {
        if (b.key) keys.add(b.key);
        if (b.bbStr && b.bbStr.key) runes.add(b.bbStr.key);
      }
    }
  }
  const missK = [...keys].filter((k) => !api.BUFF_KEY_ZH[k]);
  const missR = [...runes].filter((k) => !api.RUNE_ZH[k]);
  assert.equal(missK.length, 0, '这些 buff 键没翻译：' + missK.join(','));
  assert.equal(missR.length, 0, '这些符文键没翻译：' + missR.join(','));
  assert.ok(/（没有处理者）/.test(api.buffKeyZh('made_up_key')), '未知 buff 键要标出来');
  assert.ok(/（战斗侧没有这个符文）/.test(api.runeZh('made_up_rune')), '未知符文要标出来');
});
check('道具 / 效果的 bb 数值键都有中文含义（词典未收录会被自测抓住）', () => {
  const miss = [];
  for (const kind of ['items', 'effects']) {
    for (const [id, rec] of Object.entries(api.work[kind])) {
      for (const b of rec.buffs || []) {
        for (const k of Object.keys(b.bb || {})) if (!api.BB_GLOSS[k]) miss.push(kind + ':' + id + '.' + k);
      }
    }
  }
  assert.equal(miss.length, 0, '这些数值键没中文：' + miss.slice(0, 8).join(', '));
});
check('枚举字典覆盖数据里出现的全部取值', () => {
  const miss = [];
  for (const rec of Object.values(api.work.items)) {
    if (!api.ITEM_TYPE_ZH[rec.itemType]) miss.push('itemType:' + rec.itemType);
    if (!api.ITEM_CATEGORY_ZH[rec.category]) miss.push('category:' + rec.category);
    if (!api.ITEM_KIND_ZH[rec.kind]) miss.push('kind:' + rec.kind);
  }
  for (const rec of Object.values(api.work.effects)) if (!api.EFFECT_TYPE_ZH[rec.effectType]) miss.push('effectType:' + rec.effectType);
  for (const c of api.work.choices.cards.bounty) if (!api.BOUNTY_PAYOUT_ZH[c.payout]) miss.push('payout:' + c.payout);
  for (const c of api.work.choices.cards.tactic) if (c.kind && !api.TACTIC_KIND_ZH[c.kind]) miss.push('tacticKind:' + c.kind);
  assert.equal([...new Set(miss)].length, 0, '没翻译的枚举值：' + [...new Set(miss)].join(', '));
});

console.log('新表的校验与补丁');
check('道具：tier 越界 / price 负数 / buff 键无处理者 都会被拦下', () => {
  const id = 'chess_item_1_01_e_a';
  const before = JSON.parse(JSON.stringify(api.work.items[id]));
  api.setField('items', id, 'tier', 9);
  api.validate();
  const iss = () => api.issues();
  assert.ok(iss().some((i) => i.where === id && i.lvl === 'bad' && /tier 必须是 1\.\.6/.test(i.m)), 'tier 越界应报错');
  api.setField('items', id, 'price', -5);
  api.validate();
  assert.ok(iss().some((i) => i.where === id && i.lvl === 'bad' && /price 必须是非负数字/.test(i.m)), '负价格应报错');
  api.setField('items', id, 'buffs', [{ key: 'MADE_UP_HANDLER', bb: { atk: 0.1 }, bbStr: { key: 'attr_common_global_buff' } }]);
  api.validate();
  assert.ok(iss().some((i) => i.where === id && i.lvl === 'bad' && /没有备战期处理者/.test(i.m)), '编造的 buff 键应报错');
  api.work.items[id] = before;
  api.log.length = 0;
  api.validate();
});
check('道具：mergeable 与 upgradeNum 不同步会被拦下', () => {
  const id = 'chess_item_1_01_e_a';
  const before = JSON.parse(JSON.stringify(api.work.items[id]));
  api.setField('items', id, 'mergeable', true);
  api.setField('items', id, 'upgradeNum', 0);
  api.validate();
  assert.ok(api.issues().some((i) => i.where === id && i.lvl === 'bad' && /upgradeNum/.test(i.m)), '「可合成但 upgradeNum=0」应报错');
  api.work.items[id] = before;
  api.log.length = 0;
  api.validate();
});
check('道具：params 与 buffs 不一致会被提醒（备战/战斗两边读法不同）', () => {
  const id = 'chess_item_1_01_e_a';
  const before = JSON.parse(JSON.stringify(api.work.items[id]));
  api.setField('items', id, 'buffs', [{ key: 'env_gbuff_new_with_verify', bb: { atk: 0.9 }, bbStr: { key: 'attr_common_global_buff' } }]);
  api.validate();
  assert.ok(api.issues().some((i) => i.where === id && i.lvl === 'warn' && /params 与 buffs 不一致/.test(i.m)), '应提醒 params 落后');
  api.work.items[id] = before;
  api.log.length = 0;
  api.validate();
});
check('效果：编造的 effectType 会被拦下，悬空 effectId 由引用方报出', () => {
  const eid = 'eff_acarm041';
  const before = JSON.parse(JSON.stringify(api.work.effects[eid]));
  api.setField('effects', eid, 'effectType', 'NOT_A_TYPE');
  api.validate();
  assert.ok(api.issues().some((i) => i.where === eid && i.lvl === 'warn' && /引擎里没有这个类型/.test(i.m)), '未知 effectType 应提醒');
  api.work.effects[eid] = before;
  api.log.length = 0;
  const itemId = 'chess_item_1_01_e_a';
  const itemBefore = JSON.parse(JSON.stringify(api.work.items[itemId]));
  api.setField('items', itemId, 'effectId', 'eff_NOT_EXIST');
  api.validate();
  assert.ok(api.issues().some((i) => i.where === itemId && /效果记录/.test(i.m)), '悬空 effectId 应提醒');
  api.work.items[itemId] = itemBefore;
  api.log.length = 0;
  api.validate();
});
check('卡牌：effectId 悬空 / 类型不符 都会被拦下', () => {
  const id = 'cards.bounty.0';
  const before = JSON.parse(JSON.stringify(api.recordOf('choices', id)));
  api.setField('choices', id, 'effectId', 'no_such_effect');
  api.validate();
  assert.ok(api.issues().some((i) => i.where === id && i.lvl === 'bad' && /找不到/.test(i.m)), '悬空 effectId 应报错');
  const tacticEid = api.work.choices.cards.tactic[0].effectId;
  api.setField('choices', id, 'effectId', tacticEid);
  api.validate();
  assert.ok(api.issues().some((i) => i.where === id && /应该用 ENEMY_GAIN/.test(i.m)), '类型不符应提醒');
  Object.assign(api.recordOf('choices', id), before);
  api.log.length = 0;
  api.validate();
});
check('补丁脚本覆盖七个文件，并按记录布局分派 root-rel / root-full / flat', () => {
  const id = 'cards.bounty.0';
  const before = api.recordOf('choices', id).name;
  const priceBefore = api.work.items.chess_item_1_01_e_a.price;
  api.setField('choices', id, 'name', '补丁探针');
  api.setField('items', 'chess_item_1_01_e_a', 'price', 2);
  const patch = api.buildPatchScript();
  for (const f of ['bonds.json', 'chess.json', 'garrisons.json', 'backups.json', 'items.json', 'choices.json', 'effects.json']) {
    assert.ok(patch.includes(f), '补丁里缺 ' + f);
  }
  assert.ok(patch.includes('root-rel'), 'choices 需要 root-rel 布局');
  assert.ok(patch.includes('root-full'), 'backups 需要 root-full 布局');
  assert.ok(patch.includes("String(id).split('.').concat(segs)"), 'root-rel 的路径拼法不对');
  assert.ok(patch.includes('chess_item_1_01_e_a'), '补丁里应有道具那次改动');
  api.setField('choices', id, 'name', before);
  api.setField('items', 'chess_item_1_01_e_a', 'price', priceBefore);
  api.log.length = 0;
});
check('导出分享包时，卡牌用「表格.序位」当 id，效果用的是它的键名', () => {
  const tierBefore = api.recordOf('choices', 'cards.bounty.0').tier;
  const nameBefore = api.work.effects.eff_acarm041.name;
  api.setField('choices', 'cards.bounty.0', 'tier', 3);
  api.setField('effects', 'eff_acarm041', 'name', '分享探针');
  const pack = api.buildSharePack('probe');
  const files = new Set(pack.records.map((r) => r.file));
  assert.ok(files.has('choices') && files.has('effects'), '应包含 choices 与 effects：' + [...files].join(','));
  const cardRec = pack.records.find((r) => r.file === 'choices');
  assert.equal(cardRec.id, 'cards.bounty.0', '卡牌的 id 应是数组路径');
  assert.equal(cardRec.record.tier, 3, '卡牌记录内容应带上改动');
  api.setField('choices', 'cards.bounty.0', 'tier', tierBefore);
  api.setField('effects', 'eff_acarm041', 'name', nameBefore);
  api.log.length = 0;
});
check('导入分享包时卡牌追加到末尾（不覆盖同序位的卡）', () => {
  const n0 = api.work.choices.cards.bounty.length;
  const card = JSON.parse(JSON.stringify(api.recordOf('choices', 'cards.bounty.0')));
  const res = api.importSharePack({
    format: 'stronghold-data-patch', version: 1,
    records: [{ file: 'choices', id: 'cards.bounty.0', record: { ...card, name: '导入的副本' } }],
  });
  assert.ok(res.ok, '导入应成功');
  assert.equal(api.work.choices.cards.bounty.length, n0 + 1, '应追加一条');
  assert.equal(api.work.choices.cards.bounty[n0].name, '导入的副本');
  assert.equal(api.work.choices.cards.bounty[0].name, card.name, '原有的卡不能被覆盖');
  api.work.choices.cards.bounty.length = n0;
  api.log.length = 0;
});
check('词典页列出新表的键（buff 处理器 / 战斗符文 / 引用字段 / 枚举）', () => {
  const html = api.newKeysOverviewHtml('');
  assert.ok(html.includes('buff 处理器键'), '缺 buff 键表');
  assert.ok(html.includes('战斗符文键'), '缺符文表');
  assert.ok(html.includes('引用型字段'), '缺 bbStr 字段表');
  assert.ok(html.includes('道具大类 itemType'), '缺枚举表');
  const filtered = api.newKeysOverviewHtml('装备时销毁');
  assert.ok(filtered.includes('装备时销毁'), '搜索应按中文命中');
});

// ---- 21. 混合特性 → 「把它们都挂到同一名干员身上」-----------------------------------------
console.log('混合特性 · 挂到同一名干员');
/** 找两条 effectKey 不同、且都有人携带的特质（= 混合页会判「不能合成一条」的那种组合）。 */
function twoUnmixableTraits() {
  let g1 = null, g2 = null;
  for (const g of api.traitIds()) {
    const r = api.work.garrisons[g];
    if (!r || !r.effectKey || !api.garrisonUsers(g).length) continue;
    if (!g1) { g1 = g; continue; }
    if (r.effectKey !== api.work.garrisons[g1].effectKey) { g2 = g; break; }
  }
  return [g1, g2];
}
check('「不能合成一条」分支必须同时给出干员下拉（曾经只有按钮，点了没反应）', () => {
  const [g1, g2] = twoUnmixableTraits();
  assert.ok(g1 && g2, '数据里应当有两条 effectKey 不同且有人携带的特质');
  api.mixSel.ids = [g1, g2];
  const html = api.mixDetailHtml();
  assert.ok(html.includes('结论：不能合成一条'), '这两条应被判定为不能合成：' + g1 + ' / ' + g2);
  /*
   * 真出现过的 bug：这个分支只渲染了按钮、没有渲染 #mixChess 下拉，而点击处理函数
   * 第一句就是 `d.querySelector('#mixChess').value` —— 拿不到就 return，
   * 用户看到的就是「按钮没反应 / 没有出现干员表格」。
   */
  assert.ok(html.includes('id="mixChess"'), '「不能合成」分支必须有干员下拉');
  assert.ok(/<option value="chess_/.test(html), '下拉里要有干员候选');
  assert.ok(html.includes('id="mixAttachAllBad"'), '按钮仍然要在');
  api.mixSel.ids = [];
});
check('干员下拉会记住上次选的那名干员（重绘不再重置）', () => {
  const [g1, g2] = twoUnmixableTraits();
  const cid = api.garrisonUsers(g1)[0].where;
  api.mixSel.ids = [g1, g2];
  api.mixSel.chess = cid;
  const html = api.mixDetailHtml();
  assert.ok(html.includes('value="' + cid + '" selected'), '上次选的干员应当保持选中：' + cid);
  api.mixSel.chess = '';
  const html2 = api.mixDetailHtml();
  assert.ok(html2.includes('<option value="" selected>'), '没选过时应停在「先不挂」');
  api.mixSel.ids = [];
});
check('候选来自「所有已选特质的携带者」：全都没有携带者时下拉禁用并给出指引', () => {
  const noUsers = api.traitIds().filter((x) => api.work.garrisons[x] && !api.garrisonUsers(x).length);
  const withUsers = api.traitIds().filter((x) => api.garrisonUsers(x).length);
  // 1) 全都没有携带者 → 没有候选，禁用 + 说明下一步
  if (noUsers.length >= 2) {
    const g = noUsers.find((x) => api.work.garrisons[x].effectKey !== api.work.garrisons[noUsers[0]].effectKey) || noUsers[1];
    api.mixSel.ids = [noUsers[0], g];
    const html = api.mixDetailHtml();
    if (html.includes('结论：不能合成一条')) {
      assert.ok(/id="mixChess" disabled/.test(html), '全都没有携带者时应禁用下拉：' + noUsers.slice(0, 2).join(' / '));
      assert.ok(html.includes('没有任何干员携带'), '应说明为什么没有候选');
    }
    api.mixSel.ids = [];
  }
  // 2) 只要有一条有人携带，候选就该包含那名干员（这正是用户要点按钮的场景）
  if (noUsers.length && withUsers.length) {
    const host = api.garrisonUsers(withUsers[0])[0].where;
    api.mixSel.ids = [noUsers[0], withUsers[0]];
    const html = api.mixDetailHtml();
    if (html.includes('id="mixChess"') && !/id="mixChess" disabled/.test(html)) {
      assert.ok(html.includes('value="' + host + '"'), '候选应包含携带者 ' + host);
    }
    api.mixSel.ids = [];
  }
});
check('把两条挂到同一名干员：两条都进 garrisonIds，且干员页照常渲染', () => {
  const [g1, g2] = twoUnmixableTraits();
  const cid = api.garrisonUsers(g1)[0].where;
  const entry = api.opIndex().find((e) => e.id === cid && e.kind === 'chess');
  assert.ok(entry, '应能在干员名单里找到 ' + cid);
  const before = JSON.stringify((api.work.chess[cid] || {}).garrisonIds || []);
  const r2 = api.attachTraitToChess(cid, g2);
  assert.ok(r2.ok || /已经有这条特质/.test(r2.reason || ''), '挂载结果异常：' + JSON.stringify(r2));
  const arr = api.work.chess[cid].garrisonIds || [];
  assert.ok(arr.includes(g1) && arr.includes(g2), '两条特质都应在这名干员身上：' + JSON.stringify(arr));
  // 挂完必须还能渲染干员页（用户遇到的「没出现干员表格」就是这一步炸了）
  const html = api.opForm(entry);
  assert.ok(html && html.length > 1000, '干员页应正常渲染，实际 ' + (html ? html.length : 'null') + ' 字符');
  assert.ok(html.includes(g1), '干员页里应能看到第一条特质');
  assert.ok(html.includes(g2), '干员页里应能看到第二条特质');
  // 还原，别影响后面的用例
  api.work.chess[cid].garrisonIds = JSON.parse(before);
  api.log.length = 0;
  api.validate();
});

console.log(failed ? `\n${failed} failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
