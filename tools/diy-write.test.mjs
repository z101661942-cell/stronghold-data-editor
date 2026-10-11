// 验证自选六星的「写回」：页面控件上的 data-root 必须能把值写进 backups.json 的真实位置。
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
/** 游戏仓库根目录（只读）：SP_ROOT → ../Stronghold-Protocol → ../../Stronghold-Protocol。 */
const R = (() => {
  const cands = [process.env.SP_ROOT, join(HERE, '..', '..', 'Stronghold-Protocol'), join(HERE, '..', 'Stronghold-Protocol')].filter(Boolean);
  for (const c of cands) {
    try { if (existsSync(join(c, 'data', 'bonds.json'))) return c; } catch { /* 忽略 */ }
  }
  console.error('找不到游戏仓库（需要它的 data/*.json）——先克隆再设 SP_ROOT。');
  process.exit(2);
})();
const elCache = new Map();
const elStub = () => ({ hidden: false, value: '', textContent: '', innerHTML: '', dataset: {}, disabled: false, tagName: 'DIV', className: '', scrollTop: 0, _handlers: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener(t, f) { this._handlers[t] = f; }, setSelectionRange() {}, focus() {}, click() { this._handlers.click?.(); }, remove() {}, appendChild() {}, showModal() {}, close() {}, getContext: () => null, querySelector: () => elStub(), querySelectorAll: () => [], closest: () => elStub() });
const q1 = (s) => { if (!elCache.has(s)) elCache.set(s, elStub()); return elCache.get(s); };
globalThis.document = { querySelector: q1, querySelectorAll: () => [], addEventListener() {}, createElement: () => elStub(), body: elStub(), title: '' };
globalThis.window = { addEventListener() {}, showDirectoryPicker: null };
globalThis.FileReader = class { readAsText() {} };
globalThis.Blob = class {};
globalThis.confirm = () => true;
globalThis.requestAnimationFrame = (f) => f();
Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true });
const src = readFileSync(join(HERE, 'bond-editor.html'), 'utf8').match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const tmp = mkdtempSync(join(tmpdir(), 'diyw-'));
const p = join(tmp, 'w.mjs');
writeFileSync(p, src + '\nexport const api = () => ({ work, opIndex, opForm, formRoot, parseRootAttr, diySet, getPath, setCtx(v) { pageCtx = v; }, getCtx() { return pageCtx; } });\n');
const api = (await import(pathToFileURL(p).href + '?v=' + Date.now())).api();
for (const k of ['bonds', 'chess', 'garrisons', 'backups']) {
  const j = JSON.parse(readFileSync(join(R, 'data', k + '.json'), 'utf8'));
  api.work[k] = k === 'bonds' ? (j.bonds ?? j) : k === 'chess' ? (j.chess ?? j) : k === 'garrisons' ? (j.garrisons ?? j) : j;
}
const e = api.opIndex().find((x) => x.id === 'char_003_kalts' && x.kind === 'diy');
// 真实顺序：先渲染（此时无上下文），再像 wireForm 那样登记上下文，最后提交
const html = api.opForm(e);
let failed = 0;
const check = (n, c, x = '') => { if (c) console.log('  ok    ' + n); else { failed++; console.log('  FAIL  ' + n + (x ? '\n        ' + x : '')); } };

/*
 * 控件上的 data-root 是「相对合成记录」的位置（给读值用），不是写入位置；
 * 真实写入位置由 formRoot 在提交时算出（op.* → diy.operators.<id>.*，un.* → units.<id>.*）。
 * 所以这里两条都验证：控件位置可读、formRoot 能把它们翻成可写位置。
 */
const parseRootAttr = (v) => { const parts = String(v).split('|'); return { kind: parts[0], id: JSON.parse(parts[1]), rel: JSON.parse(parts.slice(2).join('|')) }; };
const roots = [...html.matchAll(/data-root="([^"]+)"/g)]
  .map((m) => parseRootAttr(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')));
console.log('控件位置共 ' + roots.length + ' 个');
check('控件来源只有 backups（自选数据）与 bonds（他身上的盟约）两类',
  roots.every((r) => r.kind === 'backups' || r.kind === 'bonds'),
  '出现了意外来源：' + JSON.stringify([...new Set(roots.map((r) => r.kind))]));
check('面板字段用相对路径 op.*（与合成记录一致，读得到值）',
  roots.some((r) => r.rel === 'op.name'), '没有 op.name：' + JSON.stringify(roots.slice(0, 3)));
check('战斗数值用相对路径 un.forms.*',
  roots.some((r) => r.rel === 'un.forms.2/1/4/0.stats.maxHp'), '没有 un.forms.*');

// formRoot 翻译成可写位置
api.setCtx(e);   // 真实顺序：先渲染，再像 wireForm 那样登记上下文
console.log('  [debug] pageCtx = ' + JSON.stringify({ kind: api.getCtx().kind, id: api.getCtx().id }));
const nameWrite = api.formRoot('op.name');
const hpWrite = api.formRoot('un.forms.2/1/4/0.stats.maxHp');
console.log('  formRoot(op.name) = ' + JSON.stringify(nameWrite));
console.log('  formRoot(un.forms…) = ' + JSON.stringify(hpWrite));
check('op.* 翻成 diy.operators.<id>.*', nameWrite.kind === 'backups' && nameWrite.rel === 'diy.operators.char_003_kalts.name');
check('un.* 翻成 units.<id>.*', hpWrite.kind === 'backups' && hpWrite.rel === 'units.char_003_kalts.forms.2/1/4/0.stats.maxHp');

// 真正写回：改面板名字 + 改战斗数值
const oldName = api.work.backups.diy.operators.char_003_kalts.name;
const oldHp = api.work.backups.units.char_003_kalts.forms['2/1/4/0'].stats.maxHp;
api.diySet(nameWrite.id, nameWrite.rel, '测试名字');
api.diySet(hpWrite.id, hpWrite.rel, 9999);
check('改面板名字写进了 diy.operators', api.work.backups.diy.operators.char_003_kalts.name === '测试名字');
check('改战斗数值写进了 units.forms', api.work.backups.units.char_003_kalts.forms['2/1/4/0'].stats.maxHp === 9999);
// 复原
api.diySet(nameWrite.id, nameWrite.rel, oldName);
api.diySet(hpWrite.id, hpWrite.rel, oldHp);
check('复原成功', api.work.backups.diy.operators.char_003_kalts.name === oldName
  && api.work.backups.units.char_003_kalts.forms['2/1/4/0'].stats.maxHp === oldHp);

console.log('');
console.log(failed ? failed + ' failed' : 'diy-write passed');
process.exit(failed ? 1 : 0);
