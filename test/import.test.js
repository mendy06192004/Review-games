'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeTempBank } = require('./helpers');
const { scanImportDir, processFile, hintsFromPath } = require('../src/import/importer');

const FIX = path.join(__dirname, 'fixtures');

test('由資料夾名稱判斷科目、版本、年級', () => {
  const { cfg, cleanup } = makeTempBank();
  try {
    assert.deepStrictEqual(hintsFromPath(cfg, '南一/國二'), { 科目: null, 版本: '南一', 年級: '國二' });
    assert.deepStrictEqual(hintsFromPath(cfg, '數學/翰林/八年級'), { 科目: '數學', 版本: '翰林', 年級: '國二' });
    assert.deepStrictEqual(hintsFromPath(cfg, '.'), { 科目: null, 版本: null, 年級: null });
  } finally { cleanup(); }
});

test('自動整理（不需金鑰）：從考卷標題判斷科目版本年級冊、答案、難度、如圖題自動截圖、數學式轉 KaTeX，不寫入 題目/', async () => {
  const { cfg, cleanup } = makeTempBank();
  try {
    fs.mkdirSync(cfg.importDir, { recursive: true });
    fs.copyFileSync(path.join(FIX, 'sample-exam.pdf'), path.join(cfg.importDir, '段考.pdf'));
    const [item] = await scanImportDir(cfg);
    const before = fs.readdirSync(cfg.questionDir, { recursive: true }).length;
    const rec = await processFile(cfg, item, { log: () => {} });
    assert.strictEqual(rec.錯誤, undefined, rec.錯誤);
    assert.strictEqual(rec.產生題數, 4);
    const draft = JSON.parse(fs.readFileSync(path.join(cfg.dataDir, rec.草稿檔), 'utf8'));
    const [q1, q2, q3, q4] = draft.題目;
    assert.strictEqual(q1.科目代碼, 'M');
    assert.strictEqual(q1.id, 'M-N2-0154', '範例題庫已有 M-N2-0153，應接續編號');
    assert.deepStrictEqual([q1.歸屬[0].版本, q1.歸屬[0].年級, q1.歸屬[0].冊], ['南一', '國二', '第三冊']);
    assert.deepStrictEqual([q1.答案, q2.答案, q3.答案, q4.答案], [1, 0, 0, null]);
    assert.ok([1, 2, 3].includes(q1.難度), '難度自動估計');
    assert.match(q1.題幹, /\$\(x − 4\)\^\{2\}\$|\$[^$]*\^\{2\}\$/);
    assert.ok(q4.選項.includes('$\\sqrt{12}$'));
    assert.ok(q3.圖片 && fs.statSync(path.join(cfg.imageDir, q3.圖片)).size > 1000, '如圖的題目應自動截圖');
    assert.ok(!q3.圖片.includes('段考'), '圖片檔名不應洩漏來源檔名');
    const png = fs.readFileSync(path.join(cfg.imageDir, q3.圖片));
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    assert.ok(h < w * 1.2 && h > w * 0.3, `截圖應只留圖（${w}×${h}）`);
    assert.ok(q4.待確認欄位.includes('答案'));
    assert.ok(!q1.待確認欄位.includes('難度') && !q1.待確認欄位.includes('科目'));
    assert.strictEqual(fs.readdirSync(cfg.questionDir, { recursive: true }).length, before, '題目/ 不可被自動寫入');
    assert.ok(!fs.existsSync(item.abs), '原檔應移走');
  } finally { cleanup(); }
});

test('由檔名判斷：「00數學2上隨堂卷_翰林.pdf」→ 數學、翰林、國二、第三冊', () => {
  const { hintsFromName, guessSubject } = require('../src/import/classify');
  const { cfg, cleanup } = makeTempBank();
  try {
    assert.deepStrictEqual(hintsFromName(cfg, '00數學2上隨堂10分鐘卷PDF_全冊_教用_翰林.pdf'), { 科目: '數學', 版本: '翰林', 年級: '國二', 冊: '第三冊' });
    assert.deepStrictEqual(hintsFromName(cfg, '康軒九年級下 社會.docx'), { 科目: '社會', 版本: '康軒', 年級: '國三', 冊: '第六冊' });
    assert.strictEqual(guessSubject(cfg, 'Which word is correct? She ___ to school every day. He has been studying English for years.'), 'E');
    assert.strictEqual(guessSubject(cfg, '植物進行光合作用時需要什麼？細胞的哪個構造負責？'), 'B');
  } finally { cleanup(); }
});
test('離線模式無法處理掃描檔：記錄錯誤、原檔留在 待匯入/', async () => {
  const { cfg, cleanup } = makeTempBank();
  try {
    fs.mkdirSync(cfg.importDir, { recursive: true });
    fs.copyFileSync(path.join(FIX, 'sample-scanned.pdf'), path.join(cfg.importDir, 'scan.pdf'));
    const [item] = await scanImportDir(cfg);
    const rec = await processFile(cfg, item, { log: () => {} });
    assert.match(rec.錯誤, /讀不到文字/);
    assert.ok(fs.existsSync(item.abs));
  } finally { cleanup(); }
});

test('Word（.docx）與 PDF 都能抽取（Windows 路徑格式的 PDF 字型設定也正確）', async () => {
  const { extract } = require('../src/import/extract');
  const pdf = await extract(path.join(__dirname, 'fixtures', 'sample-exam.pdf'));
  assert.strictEqual(pdf.方式, '文字層');
  const docx = await extract(path.join(__dirname, 'fixtures', 'sample-exam.docx'));
  assert.match(docx.文字, /2 \+ 3/);
  const fake = path.join(require('os').tmpdir(), `old-${Date.now()}.docx`);
  require('fs').writeFileSync(fake, '\xd0\xcf\x11\xe0 not a zip');
  await assert.rejects(extract(fake), /不是 \.docx 格式/);
  require('fs').unlinkSync(fake);
});
