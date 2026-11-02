'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createApp } = require('../src/app');
const { makeTempBank, writeJson, sample } = require('./helpers');

let bank, server, base;

test.before(async () => {
  bank = makeTempBank();
  server = createApp(bank.cfg).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); bank.cleanup(); });

const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };
const q = (...scopes) => scopes.map((s) => 'scope=' + encodeURIComponent(s)).join('&');

test('GET /api/tree 回傳樹狀結構與題數，不含題目 ID 與內容', async () => {
  const { status, body } = await get('/api/tree');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.題目總數, 3);
  assert.deepStrictEqual(body.樹.map((n) => n.名稱), ['康軒', '南一', '翰林'].sort((a, b) => a.localeCompare(b, 'zh-Hant-TW')));
  const hanlin = body.樹.find((n) => n.名稱 === '翰林');
  assert.strictEqual(hanlin.題數, 2); // 英文 + 數學
  const text = JSON.stringify(body);
  assert.ok(!text.includes('題目ID') && !text.includes('題幹') && !text.includes('答案'));
  assert.ok(fs.existsSync(bank.cfg.indexFile), '應寫出 索引/題目索引.json');
});

test('GET /api/tree?subject=數學 只計算數學', async () => {
  const { body } = await get('/api/tree?subject=' + encodeURIComponent('數學'));
  assert.deepStrictEqual(body.樹.map((n) => n.名稱).sort(), ['南一', '翰林'].sort());
});

test('GET /api/questions 不包含答案與解析', async () => {
  const { status, body } = await get(`/api/questions?${q('南一/國二/第三冊')}&count=10`);
  assert.strictEqual(status, 200);
  assert.strictEqual(body.題目.length, 1);
  const item = body.題目[0];
  assert.strictEqual(item.id, 'M-N2-0153');
  assert.ok(!('答案' in item) && !('解析' in item) && !('歸屬' in item));
});

test('多個範圍合併且同一題不重複', async () => {
  const { body } = await get(`/api/questions?${q('南一/國二', '翰林/國二/第三冊/第1章 乘法公式與多項式', '康軒')}&count=10`);
  const ids = body.題目.map((x) => x.id).sort();
  assert.deepStrictEqual(ids, ['C-N1-0001', 'E-N1-0001', 'M-N2-0153']);
  assert.strictEqual(body.符合題數, 3);
});

test('subject 與 count 篩選、錯誤參數回 400', async () => {
  const { body } = await get(`/api/questions?${q('康軒', '翰林')}&subject=E`);
  assert.deepStrictEqual(body.題目.map((x) => x.id), ['E-N1-0001']);
  const one = await get(`/api/questions?${q('康軒', '翰林', '南一')}&count=1`);
  assert.strictEqual(one.body.題目.length, 1);
  assert.strictEqual((await get('/api/questions')).status, 400);
  assert.strictEqual((await get(`/api/questions?${q('不存在的版本')}`)).status, 400);
  assert.strictEqual((await get(`/api/questions?${q('康軒')}&subject=Z`)).status, 400);
});

test('POST /api/check 驗證答案', async () => {
  const r = await fetch(base + '/api/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: [{ id: 'M-N2-0153', choice: 1 }, { id: 'E-N1-0001', choice: 2 }, { id: 'NOPE', choice: 0 }] }),
  });
  const body = await r.json();
  assert.strictEqual(body.correct, 1);
  assert.strictEqual(body.results[0].correct, true);
  assert.strictEqual(body.results[1].correct, false);
  assert.strictEqual(body.results[1].答案, 0);
  assert.ok(body.results[2].error);
});

test('老師新增 / 修改 / 刪除題目後，下一次請求立即反映', async () => {
  const file = path.join(bank.cfg.questionDir, '數學', '新增.json');
  writeJson(file, [sample({ id: 'M-N2-0200', 題幹: '新題目' })]);
  let { body } = await get('/api/tree');
  assert.strictEqual(body.題目總數, 4);

  writeJson(file, [sample({ id: 'M-N2-0200', 題幹: '改過的新題目，內容變長了' })]);
  ({ body } = await get(`/api/questions?${q('南一/國二/第三冊/第2章 測試')}`));
  assert.strictEqual(body.題目[0].題幹, '改過的新題目，內容變長了');

  fs.rmSync(file);
  ({ body } = await get('/api/tree'));
  assert.strictEqual(body.題目總數, 3);
});

test('索引檔損毀時自動重建', async () => {
  fs.writeFileSync(bank.cfg.indexFile, '{ broken');
  const { status, body } = await get('/api/tree');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.題目總數, 3);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(bank.cfg.indexFile, 'utf8')));
});
