'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { validateQuestion } = require('../src/schema');
const { loadAndValidate, formatIssue } = require('../src/loader');
const { makeTempBank, writeJson, sample } = require('./helpers');

const cfg = { subjects: { C: '國文', E: '英文', M: '數學' }, grades: { N1: '國一', N2: '國二' } };
const errorsOf = (q) => validateQuestion(q, cfg).filter((i) => i.level === 'error');

test('合法題目沒有錯誤', () => {
  assert.deepStrictEqual(errorsOf(sample()), []);
});

test('答案索引超出選項範圍', () => {
  const [e] = errorsOf(sample({ 答案: 3 }));
  assert.strictEqual(e.field, '答案');
  assert.match(e.message, /索引 3 超出選項範圍.*3 個選項.*0 ~ 2/);
});

test('答案不是整數 / 難度超出範圍', () => {
  assert.strictEqual(errorsOf(sample({ 答案: '1' }))[0].field, '答案');
  assert.strictEqual(errorsOf(sample({ 難度: 4 }))[0].field, '難度');
});

test('ID 格式與代碼檢查', () => {
  assert.match(errorsOf(sample({ id: 'M-0153' }))[0].message, /格式錯誤/);
  assert.match(errorsOf(sample({ id: 'X-N2-0001' }))[0].message, /科目代碼「X」/);
  assert.match(errorsOf(sample({ id: 'M-Z9-0001' }))[0].message, /年級代碼「Z9」/);
});

test('歸屬欄位不完整時指出是第幾個歸屬的哪個欄位', () => {
  const q = sample({ 歸屬: [
    { 版本: '南一', 年級: '國二', 冊: '第三冊', 章: '第1章' },
    { 版本: '翰林', 年級: '國二', 章: '' },
  ] });
  const fields = errorsOf(q).map((e) => e.field).sort();
  assert.deepStrictEqual(fields, ['歸屬[1].冊', '歸屬[1].章']);
  assert.strictEqual(errorsOf(sample({ 歸屬: [] }))[0].field, '歸屬');
  assert.match(errorsOf(sample({ 歸屬: [{ 版本: 'a/b', 年級: '國二', 冊: '1', 章: '1' }] }))[0].message, /不可包含「\/」/);
});

test('節可以省略，但給了就不能是空字串', () => {
  assert.deepStrictEqual(errorsOf(sample()), []);
  const q = sample({ 歸屬: [{ 版本: '南一', 年級: '國二', 冊: '第三冊', 章: '第1章', 節: ' ' }] });
  assert.strictEqual(errorsOf(q)[0].field, '歸屬[0].節');
});

test('檔案層級：JSON 語法錯誤回報行號、ID 重複回報兩處位置', async () => {
  const bank = makeTempBank();
  try {
    const qdir = bank.cfg.questionDir;
    writeJson(path.join(qdir, '數學', '壞掉.json'), '[\n  {\n    "id": "M-N2-0001",\n    "題幹": "x"\n    "選項": []\n  }\n]');
    writeJson(path.join(qdir, '數學', '重複.json'), [sample({ id: 'M-N2-0153' }), sample({ id: 'M-N2-0154', 答案: 9 })]);

    const { valid, issues } = await loadAndValidate(bank.cfg);
    const lines = issues.map(formatIssue);

    const syntax = issues.find((i) => i.file === '數學/壞掉.json');
    assert.strictEqual(syntax.line, 5, lines.join('\n'));
    assert.match(syntax.message, /JSON 語法錯誤/);

    const dup = issues.find((i) => i.file === '數學/重複.json' && i.id === 'M-N2-0153');
    assert.match(dup.message, /重複，第一次出現在 數學\/國二\.json 第 3 行/);

    const bad = issues.find((i) => i.id === 'M-N2-0154');
    assert.strictEqual(bad.item, 2);
    assert.strictEqual(bad.field, '答案');
    assert.ok(bad.line > 1);

    // 只剩原本 3 題可用：重複題與錯誤題都被排除
    assert.deepStrictEqual(valid.map((v) => v.q.id).sort(), ['C-N1-0001', 'E-N1-0001', 'M-N2-0153']);
  } finally {
    bank.cleanup();
  }
});
