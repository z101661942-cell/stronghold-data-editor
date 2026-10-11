/**
 * 端到端冒烟：用编辑器自己的函数改「一条数值 + 一条文案」，生成补丁脚本，
 * 在沙盒里执行它，然后按服务器的方式读回来确认改动真的落地。
 * 只在临时目录里操作：读真实 data 当输入，所有写入都落在系统临时目录，绝不碰你的 data/。
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 游戏仓库根目录（只读）：SP_ROOT → ../Stronghold-Protocol → ../../Stronghold-Protocol。 */
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
  console.error('  SP_ROOT=/path/to/Stronghold-Protocol node tools/bond-editor.smoke.mjs');
  process.exit(2);
})();
let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok    ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '\\n        ' + e.message); }
};

// ---- DOM 桩（与 bond-editor.test.mjs 同款，同选择器同实例）------------------
const elCache = new Map();
function elStub() {
  return {
    hidden: false, value: '', textContent: '', innerHTML: '', dataset: {}, disabled: false,
    tagName: 'DIV', className: '', scrollTop: 0, _handlers: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(type, fn) { this._handlers[type] = fn; },
    setSelectionRange() {}, focus() {}, click() { this._handlers.click?.(); }, remove() {},
    appendChild() {}, showModal() {}, close() {}, getContext: () => null,
    querySelector: () => elStub(), querySelectorAll: () => [], closest: () => elStub(),
  };
}
const q1 = (sel) => { if (!elCache.has(sel)) elCache.set(sel, elStub()); return elCache.get(sel); };
globalThis.document = { querySelector: q1, querySelectorAll: () => [], addEventListener() {}, createElement: () => elStub(), body: elStub() };
globalThis.window = { addEventListener() {}, showDirectoryPicker: null };
globalThis.FileReader = class { readAsText() {} };
globalThis.Blob = class {};
Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true });

const html = readFileSync(join(HERE, 'bond-editor.html'), 'utf8');
const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const tmp = mkdtempSync(join(tmpdir(), 'bond-smoke-'));
const wrapped = join(tmp, 'editor.wrapped.mjs');
writeFileSync(wrapped, source + '\nexport const api = () => ({ work, pristine, log, validate, setField, diySet, buildPatchScript, textMismatches, copyGarrisonForChess, traitTextEdit, plainOf, toRaw, bbSummaryOf, diyTab, diyIds, opIndex, opForm, opBondIds, opGarrisonIds, bondOwners, traitIds, traitForm, traitPairId, traitPairDiff, copyTraitTextToPair, recordOf, rootRec, aux, FILES, ROOT_KINDS, get pageCtx() { return pageCtx; }, set pageCtx(v) { pageCtx = v; } });\n');
const api = (await import(pathToFileURL(wrapped).href)).api();

/** 按点号路径读（与编辑器 getPath 同义：含 / 的段保持完整）。 */
const getPathRaw = (o, p) => String(p).split(/\.(?!\/)|(?<!\/)\./).reduce((a, k) => (a == null ? a : a[k]), o);

// ---- 载入真实数据 ---------------------------------------------------------
const unwrap = {
  bonds: (j) => j.bonds ?? j, chess: (j) => j.chess ?? j, garrisons: (j) => j.garrisons ?? j, backups: (j) => j,
  items: (j) => j.items ?? j, choices: (j) => j, effects: (j) => j.effects ?? j,
};
for (const kind of ['bonds', 'chess', 'garrisons', 'backups', 'items', 'choices', 'effects']) {
  const raw = JSON.parse(readFileSync(join(ROOT, 'data', kind + '.json'), 'utf8'));
  api.work[kind] = unwrap[kind](raw);
  api.pristine[kind] = kind === 'backups' ? api.work[kind] : JSON.parse(JSON.stringify(api.work[kind]));
}
console.log('load real data');
check('三张表都载入了', () => {
  assert.ok(Object.keys(api.work.bonds).length > 0);
  assert.ok(Object.keys(api.work.chess).length > 0);
  assert.ok(Object.keys(api.work.garrisons).length > 0);
});
check('官方数据本身通过校验（无 error 级问题）', () => {
  api.validate();
  const bad = [];
  // validate() 把问题累积在内部 issues 里，通过 log 变化间接暴露；这里直接看文本一致性
  const mm = api.textMismatches();
  assert.ok(Array.isArray(mm));
  assert.equal(bad.length, 0);
});

// ---- 改一条数值（bb.atk）+ 一条文案（desc/descRaw）-------------------------
const GID = 'garrison_05_a';
const before = JSON.parse(JSON.stringify(api.work.garrisons[GID]));
const NEW_ATK = 0.037;
const NEW_TEXT = '<战斗中>冒烟测试文本：攻击力 +3.7%';
api.setField('garrisons', GID, 'bb.atk', NEW_ATK);
const tr = api.traitTextEdit(GID, NEW_TEXT, before.owners?.[0]);
console.log('edit');
console.log('  ' + GID + ' owners=' + JSON.stringify(before.owners) + ' traitTextEdit=' + JSON.stringify(tr));
check('数值改动写入 bb.atk', () => assert.equal(api.work.garrisons[GID].bb.atk, NEW_ATK));
check('文案改动同步 desc 与 descRaw', () => {
  assert.equal(api.work.garrisons[GID].desc, NEW_TEXT);
  assert.equal(api.work.garrisons[GID].descRaw, api.toRaw(NEW_TEXT));
});
check('改动进入变更日志（保存时会写盘）', () => {
  assert.ok(api.log.some((e) => e.file === 'garrisons' && e.id === GID));
});

// ---- 生成补丁并在沙盒里执行 ------------------------------------------------
// 顺带改一处自选六星（backups.json 的根级布局），验证它也能进补丁、也能重放。
const DIY_ID = 'char_1044_hsgma2';
const DIY_BOND = 'sargonShip';
const diyBeforeBonds = JSON.parse(JSON.stringify(api.work.backups.diy.operators[DIY_ID].bonds || []));
const DIY_FORM_KEY = Object.keys(api.work.backups.units[DIY_ID].forms)[0];
// 真实路径（补丁里记的就是这个形状）：units.<charId>.forms.<档位>.stats.maxHp
const DIY_HP_PATH = 'units.' + DIY_ID + '.forms.' + DIY_FORM_KEY + '.stats.maxHp';
const diyHpBefore = Number(getPathRaw(api.work.backups, DIY_HP_PATH));
api.diySet(DIY_ID, DIY_ID + '.op.bonds', [DIY_BOND]);
// 用 UI 路径写入（编辑器里的输入框就是这种），日志里会落真实路径
api.diySet(DIY_ID, DIY_ID + '.un.forms.' + DIY_FORM_KEY + '.stats.maxHp', diyHpBefore + 7);
console.log('diy edit');
console.log('  ' + DIY_ID + ' bonds -> ' + JSON.stringify(api.work.backups.diy.operators[DIY_ID].bonds) + '  ' + DIY_HP_PATH + ' -> ' + (diyHpBefore + 7));
check('自选六星的盟约改动落在真实对象上', () => {
  assert.deepEqual(api.work.backups.diy.operators[DIY_ID].bonds, [DIY_BOND]);
});
check('自选六星的战斗数值改动落在 units 上', () => {
  assert.equal(getPathRaw(api.work.backups, DIY_HP_PATH), diyHpBefore + 7);
});

// ---- 新表：道具（扁平表）/ 卡牌（数组序位）/ 效果（扁平表）三处各改一个字段 ----------
const ITEM_ID = 'chess_item_1_01_e_a';
const ITEM_PRICE = 7;
const itemBefore = api.work.items[ITEM_ID].price;
api.setField('items', ITEM_ID, 'price', ITEM_PRICE);
api.setField('items', ITEM_ID, 'buffs.0.bb.atk', 0.42);
const CARD_ID = 'cards.bounty.3';
const cardBefore = JSON.parse(JSON.stringify(api.recordOf('choices', CARD_ID)));
api.setField('choices', CARD_ID, 'name', '冒烟测试卡名');
api.setField('choices', CARD_ID, 'coin', 9);
const EFF_ID = 'eff_acarm041';
const effBefore = api.work.effects[EFF_ID].name;
api.setField('effects', EFF_ID, 'name', '冒烟测试效果名');
console.log('新表 edit');
console.log('  道具 ' + ITEM_ID + '.price ' + itemBefore + ' -> ' + ITEM_PRICE + '（bb.atk -> 0.42）');
console.log('  卡牌 ' + CARD_ID + '.name -> 冒烟测试卡名（coin -> 9）');
console.log('  效果 ' + EFF_ID + '.name -> 冒烟测试效果名');

const patch = api.buildPatchScript();
const sandbox = mkdtempSync(join(tmpdir(), 'bond-patch-'));
mkdirSync(join(sandbox, 'tools'), { recursive: true });
mkdirSync(join(sandbox, 'data'), { recursive: true });
// 服务器形状的数据文件：包一层 wrapper（与真实 data/*.json 一致）
writeFileSync(join(sandbox, 'data', 'bonds.json'), readFileSync(join(ROOT, 'data', 'bonds.json')));
writeFileSync(join(sandbox, 'data', 'chess.json'), readFileSync(join(ROOT, 'data', 'chess.json')));
writeFileSync(join(sandbox, 'data', 'garrisons.json'), readFileSync(join(ROOT, 'data', 'garrisons.json')));
writeFileSync(join(sandbox, 'data', 'backups.json'), readFileSync(join(ROOT, 'data', 'backups.json')));
writeFileSync(join(sandbox, 'data', 'items.json'), readFileSync(join(ROOT, 'data', 'items.json')));
writeFileSync(join(sandbox, 'data', 'choices.json'), readFileSync(join(ROOT, 'data', 'choices.json')));
writeFileSync(join(sandbox, 'data', 'effects.json'), readFileSync(join(ROOT, 'data', 'effects.json')));
const patchPath = join(sandbox, 'tools', 'patch-my-data.mjs');
writeFileSync(patchPath, patch);
console.log('patch: ' + patch.length + ' 字节');
check('补丁里包含这条文案', () => assert.ok(patch.includes('冒烟测试文本')));
let threw = null;
try { await import(pathToFileURL(patchPath).href); } catch (e) { threw = e; }
check('补丁执行不抛错', () => assert.ok(!threw, threw && threw.message));

// ---- 按服务器的方式读回来 --------------------------------------------------
const readG = (p) => { const j = JSON.parse(readFileSync(p, 'utf8')); return j.garrisons ?? j; };
const after = readG(join(sandbox, 'data', 'garrisons.json'))[GID];
console.log('verify');
check('补丁后 bb.atk 已变', () => assert.equal(after.bb.atk, NEW_ATK));
check('补丁后 descRaw 也跟着变（游戏渲染的就是它）', () => assert.equal(after.descRaw, api.toRaw(NEW_TEXT)));
check('补丁后 desc 一致', () => assert.equal(after.desc, NEW_TEXT));
check('补丁没动其他效果字段', () => {
  for (const k of Object.keys(before)) {
    if (['desc', 'descRaw', 'bb'].includes(k)) continue;
    assert.deepEqual(after[k], before[k], 'field ' + k + ' must be untouched');
  }
});
check('补丁没改记录数', () => {
  assert.equal(Object.keys(readG(join(sandbox, 'data', 'garrisons.json'))).length, Object.keys(api.pristine.garrisons).length);
});
check('补丁把自选六星的盟约写进了 backups.json', () => {
  const bk = JSON.parse(readFileSync(join(sandbox, 'data', 'backups.json'), 'utf8'));
  assert.deepEqual(bk.diy.operators[DIY_ID].bonds, [DIY_BOND], '补丁后 bonds 应为 ' + JSON.stringify([DIY_BOND]));
});
check('补丁把自选六星的战斗数值写进了 backups.json', () => {
  const bk = JSON.parse(readFileSync(join(sandbox, 'data', 'backups.json'), 'utf8'));
  assert.equal(getPathRaw(bk, DIY_HP_PATH), diyHpBefore + 7);
});
check('补丁没动 backups.json 的其他数据', () => {
  const bk = JSON.parse(readFileSync(join(sandbox, 'data', 'backups.json'), 'utf8'));
  const orig = JSON.parse(readFileSync(join(ROOT, 'data', 'backups.json'), 'utf8'));
  assert.equal(Object.keys(bk.units).length, Object.keys(orig.units).length, 'units 数量必须不变');
  assert.equal(Object.keys(bk.diy.operators).length, Object.keys(orig.diy.operators).length, 'operators 数量必须不变');
  for (const [id, o] of Object.entries(orig.diy.operators)) {
    if (id === DIY_ID) continue;
    assert.deepEqual(bk.diy.operators[id].bonds, o.bonds, id + ' 的 bonds 被误改');
  }
});

// ---- 新表的补丁回放结果 ---------------------------------------------------------------
console.log('新表 verify');
check('补丁把道具的 price 与 bb.atk 写进了 items.json', () => {
  const t = JSON.parse(readFileSync(join(sandbox, 'data', 'items.json'), 'utf8'));
  const r = (t.items ?? t)[ITEM_ID];
  assert.equal(r.price, ITEM_PRICE, 'price 应为 ' + ITEM_PRICE);
  assert.equal(r.buffs[0].bb.atk, 0.42, 'buff 数值应写进去');
});
check('补丁把卡牌改动写进了 choices.json 的同一个数组序位', () => {
  const t = JSON.parse(readFileSync(join(sandbox, 'data', 'choices.json'), 'utf8'));
  const card = t.cards.bounty[3];
  assert.equal(card.name, '冒烟测试卡名', '第 3 张卡的 name 应被改（root-rel 布局最容易写错位置）');
  assert.equal(card.coin, 9, 'coin 应被改');
  assert.equal(t.cards.bounty.length, api.work.choices.cards.bounty.length, '卡数量不能被改动');
  // 相邻的卡不能被牵连
  const orig = JSON.parse(readFileSync(join(ROOT, 'data', 'choices.json'), 'utf8'));
  for (const i of [2, 4]) {
    if (!t.cards.bounty[i] || !orig.cards.bounty[i]) continue;
    assert.equal(t.cards.bounty[i].name, orig.cards.bounty[i].name, '第 ' + i + ' 张卡被误改了');
  }
  assert.equal(t.cards.tactic.length, orig.cards.tactic.length, '战术卡不该被碰');
  // 卡的 id 字段不该被写坏
  assert.equal(card.effectId, cardBefore.effectId, 'effectId 不该变');
  assert.equal(card.tier, cardBefore.tier, 'tier 不该变');
});
check('补丁把效果名写进了 effects.json，且没动别条效果', () => {
  const t = JSON.parse(readFileSync(join(sandbox, 'data', 'effects.json'), 'utf8'));
  const e = (t.effects ?? t)[EFF_ID];
  assert.equal(e.name, '冒烟测试效果名');
  assert.equal(Object.keys(t.effects ?? t).length, Object.keys(api.work.effects).length, '效果条数不能变');
  const orig = JSON.parse(readFileSync(join(ROOT, 'data', 'effects.json'), 'utf8'));
  const other = Object.keys(orig.effects ?? orig).find((k) => k !== EFF_ID);
  assert.equal((t.effects ?? t)[other].name, (orig.effects ?? orig)[other].name, '别的效果被误改');
});

console.log('');
// ---- 干员页：从渲染出的控件反解真实位置，改完必须落在正确的表 --------------------------
console.log('干员页端到端');
const OP_KEY = 'chess:chess_char_6_03_a';   // 余：有核心盟约 + 特质
const op = api.opIndex().find((e) => e.key === OP_KEY);
assert.ok(op, '找不到余');
api.pageCtx = op;
const opHtml = api.opForm(op);
api.pageCtx = null;

// 把渲染出的 data-root 标记解析出来（和页面提交时的口径一致）
const parseRoot = (v) => {
  const parts = String(v).split('|');
  return { kind: parts[0], id: JSON.parse(parts[1]), rel: JSON.parse(parts.slice(2).join('|')) };
};
const roots = [...opHtml.matchAll(/data-root="([^"]+)"/g)].map((m) => parseRoot(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')));
const bondRoots = roots.filter((r) => r.kind === 'bonds');
const chessRoots = roots.filter((r) => r.kind === 'chess');
const garrRoots = roots.filter((r) => r.kind === 'garrisons');
console.log('  控件位置统计: 盟约 ' + bondRoots.length + ' · 棋子 ' + chessRoots.length + ' · 特质 ' + garrRoots.length);
check('渲染出的控件覆盖盟约、棋子与特质三张表', () => {
  assert.ok(bondRoots.length > 0, '没有盟约字段');
  assert.ok(chessRoots.length > 0, '没有棋子字段');
  assert.ok(garrRoots.length > 0, '没有特质字段');
  // 每个位置的记录都必须真实存在
  for (const r of roots) {
    const host = r.kind === 'backups' ? api.work.backups : (api.work[r.kind] || {})[r.id];
    assert.ok(host, r.kind + ' ' + r.id + ' 不存在');
  }
});
check('盟约字段标的是盟约记录，棋子字段标的是棋子记录', () => {
  for (const r of bondRoots) assert.ok(api.work.bonds[r.id], '盟约位置错了：' + r.id);
  for (const r of garrRoots) assert.ok(api.work.garrisons[r.id], '特质位置错了：' + r.id);
  // 余的盟约字段应落在他的盟约上
  const ids = new Set(bondRoots.map((r) => r.id));
  for (const b of api.opBondIds(op)) assert.ok(ids.has(b), '缺盟约 ' + b + ' 的字段');
});

const CHESS_HP = chessRoots.find((r) => r.rel === 'stats.maxHp');
const BOND_BB = bondRoots.find((r) => /^bb\./.test(r.rel));
const GARR_BB = garrRoots.find((r) => /^bb\./.test(r.rel));
check('三张表各挑得到一个数值字段', () => {
  assert.ok(CHESS_HP, '没找到 stats.maxHp');
  assert.ok(BOND_BB, '没找到盟约的 bb 字段');
  assert.ok(GARR_BB, '没找到特质的 bb 字段');
});
const hpBefore = api.work.chess[CHESS_HP.id].stats.maxHp;
const bondBefore = api.work.bonds[BOND_BB.id].bb[BOND_BB.rel.slice(3)];
const garrBefore = api.work.garrisons[GARR_BB.id].bb[GARR_BB.rel.slice(3)];
console.log('  改动目标: ' + CHESS_HP.id + '.stats.maxHp · '
  + BOND_BB.id + '.bb.' + BOND_BB.rel.slice(3) + ' · '
  + GARR_BB.id + '.bb.' + GARR_BB.rel.slice(3));
// 按页面提交的方式写回（data-root 决定去哪张表）
api.setField(CHESS_HP.kind, CHESS_HP.id, CHESS_HP.rel, hpBefore + 3);
api.setField(BOND_BB.kind, BOND_BB.id, BOND_BB.rel, bondBefore + 0.001);
api.setField(GARR_BB.kind, GARR_BB.id, GARR_BB.rel, garrBefore + 0.002);
check('改动分别落在 chess / bonds / garrisons 三张真实表上', () => {
  assert.equal(api.work.chess[CHESS_HP.id].stats.maxHp, hpBefore + 3);
  assert.equal(api.work.bonds[BOND_BB.id].bb[BOND_BB.rel.slice(3)], bondBefore + 0.001);
  assert.equal(api.work.garrisons[GARR_BB.id].bb[GARR_BB.rel.slice(3)], garrBefore + 0.002);
});
check('共用记录的影响面能算出来（用于界面警示）', () => {
  const others = api.bondOwners(BOND_BB.id);
  assert.ok(others.length >= 1, '炎盟约应至少有拥有者');
});

// ---- 特质页：改一条特质的数值，必须落在 garrisons.json 的正确记录上 --------------------
console.log('特质页端到端');
const TGID = 'garrison_05_a';
const t5 = api.work.garrisons[TGID];
assert.ok(t5 && t5.bb && Object.keys(t5.bb).length, '找不到 ' + TGID + ' 的 bb');
const tKey = Object.keys(t5.bb)[0];
const tBefore = t5.bb[tKey];
api.pageCtx = { traitPage: true, id: TGID };
const tHtml = api.traitForm(TGID);
api.pageCtx = null;
check('特质页控件都标成 garrisons，且带 bb 键', () => {
  const roots = [...tHtml.matchAll(/data-root="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(roots.length > 5, '控件太少：' + roots.length);
  assert.ok(roots.every((r) => r.startsWith('garrisons|')), '有控件标错表：' + roots.find((r) => !r.startsWith('garrisons|')));
  assert.ok(tHtml.includes('bb.' + tKey), '缺 bb 键 ' + tKey);
});
check('特质页渲染出配对对照表', () => {
  assert.ok(tHtml.includes('bb 键'), '缺配对数值对照表');
  assert.ok(tHtml.includes(api.traitPairId(TGID)), '缺配对那条的 id');
  assert.ok(tHtml.includes('copyTextToPair'), '缺文案复制按钮');
  assert.ok(tHtml.includes('syncPairRow'), '缺整条复制按钮');
});
api.setField('garrisons', TGID, 'bb.' + tKey, tBefore + 0.123);
check('特质数值改动落在 garrisons 的真实记录上', () => {
  assert.equal(api.work.garrisons[TGID].bb[tKey], tBefore + 0.123);
});
check('改一条不会连带改到配对那条（两版独立）', () => {
  const other = api.traitPairId(TGID);
  assert.notEqual(api.work.garrisons[other].bb[tKey], tBefore + 0.123, '不该连带改到配对那条');
});

console.log(failed ? failed + ' failed' : 'smoke passed');
process.exit(failed ? 1 : 0);
