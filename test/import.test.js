'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeTempBank } = require('./helpers');
const { scanImportDir, processFile, hintsFromPath } = require('../src/import/importer');
const { buildUserContent, OUTPUT_SCHEMA } = require('../src/import/claude');

const FIX = path.join(__dirname, 'fixtures');

test('由資料夾名稱判斷科目、版本、年級', () => {
  const { cfg, cleanup } = makeTempBank();
  try {
    assert.deepStrictEqual(hintsFromPath(cfg, '南一/國二'), { 科目: null, 版本: '南一', 年級: '國二' });
    assert.deepStrictEqual(hintsFromPath(cfg, '數學/翰林/八年級'), { 科目: '數學', 版本: '翰林', 年級: '國二' });
    assert.deepStrictEqual(hintsFromPath(cfg, '.'), { 科目: null, 版本: null, 年級: null });
  } finally { cleanup(); }
});

test('結構化輸出 schema：所有物件都 additionalProperties:false 且欄位全必填', () => {
  const walk = (s) => {
    if (s.type === 'object') {
      assert.strictEqual(s.additionalProperties, false);
      assert.deepStrictEqual([...s.required].sort(), Object.keys(s.properties).sort());
      Object.values(s.properties).forEach(walk);
    }
    if (s.items) walk(s.items);
    (s.anyOf || []).forEach(walk);
  };
  walk(OUTPUT_SCHEMA);
});

test('Claude 匯入流程（以假的 Claude 回應測試）：切圖、編號、移檔、紀錄，且不寫入 題目/', async () => {
  const { cfg, cleanup } = makeTempBank();
  try {
    const dir = path.join(cfg.importDir, '數學', '南一', '國二');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(FIX, 'sample-exam.pdf'), path.join(dir, '段考.pdf'));
    const before = fs.readdirSync(path.join(cfg.questionDir, '數學'));

    const [item] = await scanImportDir(cfg);
    let seen = null;
    const fakeClaude = async (chunk, hints) => {
      seen = { content: buildUserContent(chunk, hints), hints };
      return {
        模型: 'fake',
        備註: null,
        題目: [
          { 原題號: '1', 科目代碼: 'M', 題幹: '計算 (x − 4)² 的展開式為何？', 選項: ['x² − 16', 'x² − 8x + 16', 'x² + 8x + 16', 'x² − 4x + 16'],
            答案: 1, 答案依據: '參考答案 1.(B)', 難度: null, 解析: null, 版本: null, 年級: null, 冊: '第三冊', 章: '第1章 乘法公式與多項式', 節: null, 圖表: [], 不確定: [] },
          { 原題號: '3', 科目代碼: 'M', 題幹: '直角三角形斜邊？', 選項: ['10', '12', '14', '100'],
            答案: 9, 答案依據: null, 難度: 2, 解析: null, 版本: null, 年級: null, 冊: '第三冊', 章: null, 節: null,
            圖表: [{ 來源: '頁面', 頁: 1, 左: 0.09, 上: 0.36, 右: 0.38, 下: 0.51, 代號: null }], 不確定: ['章'] },
        ],
      };
    };
    const rec = await processFile(cfg, item, { callClaude: fakeClaude, log: () => {} });

    // 送給 Claude 的內容：頁面圖 + 抽取文字 + 資料夾提示
    assert.ok(seen.content.some((b) => b.type === 'image' && b.source.media_type === 'image/png'));
    assert.match(seen.content.at(-1).text, /版本：南一/);
    assert.match(seen.content.at(-1).text, /102 × 98/);

    assert.strictEqual(rec.產生題數, 2);
    assert.strictEqual(rec.需審核題數, 2);
    const draft = JSON.parse(fs.readFileSync(path.join(cfg.dataDir, rec.草稿檔), 'utf8'));
    const [q1, q3] = draft.題目;
    assert.strictEqual(q1.id, 'M-N2-0154', '範例題庫已有 M-N2-0153，應接續編號');
    assert.strictEqual(q3.id, 'M-N2-0155');
    assert.deepStrictEqual(q1.歸屬[0], { 版本: '南一', 年級: '國二', 冊: '第三冊', 章: '第1章 乘法公式與多項式', 節: null });
    assert.strictEqual(q3.答案, null, '超出範圍的答案不採用');
    assert.ok(q3.待確認欄位.includes('答案') && q3.待確認欄位.includes('章') && q3.待確認欄位.includes('圖片'));
    assert.ok(q3.圖片 && fs.statSync(path.join(cfg.imageDir, q3.圖片)).size > 500, '應切出圖片');
    assert.ok(!q3.圖片.includes('段考'), '圖片檔名不應洩漏來源檔名');

    assert.ok(fs.existsSync(path.join(cfg.sourceDir, '南一', '國二', '段考.pdf')));
    assert.ok(!fs.existsSync(item.abs));
    const logList = JSON.parse(fs.readFileSync(path.join(cfg.teacherDir, '投稿紀錄.json'), 'utf8'));
    assert.strictEqual(logList.at(-1).來源檔, '數學/南一/國二/段考.pdf');
    assert.deepStrictEqual(fs.readdirSync(path.join(cfg.questionDir, '數學')), before, '不可寫入 題目/');
  } finally { cleanup(); }
});

test('離線模式無法處理掃描檔：記錄錯誤、原檔留在 待匯入/', async () => {
  const { cfg, cleanup } = makeTempBank();
  try {
    fs.mkdirSync(cfg.importDir, { recursive: true });
    fs.copyFileSync(path.join(FIX, 'sample-scanned.pdf'), path.join(cfg.importDir, 'scan.pdf'));
    const [item] = await scanImportDir(cfg);
    const rec = await processFile(cfg, item, { offline: true, log: () => {} });
    assert.match(rec.錯誤, /OCR/);
    assert.ok(fs.existsSync(item.abs));
  } finally { cleanup(); }
});

test('沒有 API 金鑰時給出清楚的錯誤', async () => {
  const { cfg, cleanup } = makeTempBank();
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    fs.mkdirSync(cfg.importDir, { recursive: true });
    fs.copyFileSync(path.join(FIX, 'sample-exam.pdf'), path.join(cfg.importDir, 'a.pdf'));
    const [item] = await scanImportDir(cfg);
    const rec = await processFile(cfg, item, { log: () => {} });
    if (!process.env.ANTHROPIC_AUTH_TOKEN) assert.match(rec.錯誤, /ANTHROPIC_API_KEY/);
  } finally {
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
    cleanup();
  }
});
