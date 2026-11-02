'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createApp } = require('../src/app');
const D = require('../src/drafts');
const { makeTempBank } = require('./helpers');

function draftQ(over = {}) {
  return {
    草稿編號: D.newDraftKey(), 原題號: '1', 科目代碼: 'M', id: null,
    題幹: '2 + 3 = ?', 選項: ['4', '5', '6'], 答案: null, 答案依據: null, 難度: null, 圖片: null, 解析: null,
    歸屬: [{ 版本: '南一', 年級: '國二', 冊: '第三冊', 章: null, 節: null }],
    needs_review: true, 待確認欄位: ['答案', '難度', '歸屬.章'], 審核: { 狀態: '待審核', 原因: null, 時間: null },
    ...over,
  };
}

async function start(cfg) {
  const server = createApp(cfg).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (p, opts = {}) => {
    const r = await fetch(base + p, { headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, ...opts });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { server, call };
}

test('審核流程：列出（needs_review 在前）→ 編輯 → 退回 → 通過後寫入題目/並更新索引', async () => {
  const { cfg, cleanup } = makeTempBank();
  const ok = draftQ({ 原題號: '2', 答案: 1, 難度: 1, 歸屬: [{ 版本: '南一', 年級: '國二', 冊: '第三冊', 章: '第9章 測試', 節: null }], needs_review: false, 待確認欄位: [] });
  const needs = draftQ();
  await D.atomicWriteJson(path.join(cfg.reviewDir, '考卷.json'), { 來源檔: '考卷.pdf', 來源位置: '來源/南一/國二/考卷.pdf', 處理時間: new Date().toISOString(), 抽取方式: '文字層', 題目: [ok, needs] });
  const { server, call } = await start(cfg);
  try {
    let r = await call('/api/admin/drafts');
    assert.deepStrictEqual(r.body.草稿.map((d) => d.題目.草稿編號), [needs.草稿編號, ok.草稿編號]);

    // 缺答案不能通過
    r = await call(`/api/admin/drafts/${needs.草稿編號}/approve`, { method: 'POST', body: '{}' });
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.details.some((d) => d.includes('答案')));

    // 退回要有原因，且保留在待審核
    r = await call(`/api/admin/drafts/${needs.草稿編號}/reject`, { method: 'POST', body: JSON.stringify({ 原因: '' }) });
    assert.strictEqual(r.status, 400);
    r = await call(`/api/admin/drafts/${needs.草稿編號}/reject`, { method: 'POST', body: JSON.stringify({ 原因: '題目不完整' }) });
    assert.strictEqual(r.body.題目.審核.狀態, '退回');

    // 編輯（含新增第二個歸屬）後通過，未填 id 時自動編號
    const edits = {
      答案: 1, 難度: 2,
      歸屬: [{ 版本: '南一', 年級: '國二', 冊: '第三冊', 章: '第9章 測試' }, { 版本: '翰林', 年級: '國二', 冊: '第三冊', 章: '第1章 乘法公式與多項式', 節: '' }],
    };
    r = await call(`/api/admin/drafts/${needs.草稿編號}`, { method: 'PUT', body: JSON.stringify(edits) });
    assert.strictEqual(r.body.題目.needs_review, false);
    r = await call(`/api/admin/drafts/${needs.草稿編號}/approve`, { method: 'POST', body: '{}' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.id, 'M-N2-0154');
    const saved = JSON.parse(fs.readFileSync(path.join(cfg.questionDir, '數學', 'M-N2-0154.json'), 'utf8'));
    assert.deepStrictEqual(Object.keys(saved), ['id', '題幹', '選項', '答案', '難度', '圖片', '歸屬']);
    assert.strictEqual(saved.歸屬.length, 2);
    assert.ok(!('節' in saved.歸屬[1]), '空的節不寫入');

    // 學生端立即看得到
    r = await call('/api/questions?scope=' + encodeURIComponent('翰林/國二/第三冊/第1章 乘法公式與多項式') + '&count=10');
    assert.ok(r.body.題目.some((q) => q.id === 'M-N2-0154'));

    // 第二題通過後草稿檔刪除
    r = await call(`/api/admin/drafts/${ok.草稿編號}/approve`, { method: 'POST', body: '{}' });
    assert.strictEqual(r.body.id, 'M-N2-0155');
    assert.ok(!fs.existsSync(path.join(cfg.reviewDir, '考卷.json')));
  } finally { server.close(); cleanup(); }
});

test('通過時 id 已存在於題庫 → 409', async () => {
  const { cfg, cleanup } = makeTempBank();
  const q = draftQ({ id: 'M-N2-0153', 答案: 1, 難度: 1, 歸屬: [{ 版本: '南一', 年級: '國二', 冊: '第三冊', 章: '第1章', 節: null }] });
  await D.atomicWriteJson(path.join(cfg.reviewDir, 'x.json'), { 來源檔: 'x.pdf', 處理時間: '', 題目: [q] });
  const { server, call } = await start(cfg);
  try {
    const r = await call(`/api/admin/drafts/${q.草稿編號}/approve`, { method: 'POST', body: '{}' });
    assert.strictEqual(r.status, 409);
  } finally { server.close(); cleanup(); }
});

test('admin_password 有設定時需要驗證', async () => {
  const { cfg, cleanup } = makeTempBank();
  cfg.adminPassword = 'secret';
  const { server, call } = await start(cfg);
  try {
    assert.strictEqual((await call('/api/admin/drafts')).status, 401);
    const auth = { Authorization: 'Basic ' + Buffer.from('teacher:secret').toString('base64') };
    assert.strictEqual((await call('/api/admin/drafts', { headers: auth })).status, 200);
    assert.strictEqual((await call('/api/tree')).status, 200, '學生端不受影響');
  } finally { server.close(); cleanup(); }
});

test('上傳圖片存到 圖片/匯入/', async () => {
  const { cfg, cleanup } = makeTempBank();
  const { server, call } = await start(cfg);
  try {
    const png = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-exam.pdf')).subarray(0, 0); // 空內容應被拒絕
    let r = await call('/api/admin/images', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
    assert.strictEqual(r.status, 400);
    const img = Buffer.from('89504e470d0a1a0a', 'hex');
    r = await call('/api/admin/images', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: img });
    assert.match(r.body.圖片, /^匯入\/.+\.png$/);
    assert.ok(fs.existsSync(path.join(cfg.imageDir, r.body.圖片)));
  } finally { server.close(); cleanup(); }
});
