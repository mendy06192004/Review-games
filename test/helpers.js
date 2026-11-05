'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveConfig } = require('../src/config');

/** 複製範例題庫到暫存資料夾，回傳設定（測試不會動到真正的題庫） */
function makeTempBank() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-bank-'));
  fs.cpSync(path.join(__dirname, '..', '題庫'), dir, { recursive: true });
  for (const sub of ['待匯入', '待審核', '來源', '老師', '遊戲']) fs.rmSync(path.join(dir, sub), { recursive: true, force: true });
  // 測試只用國英數三題範例（自然、社會的範例題不列入，讓題數固定）
  for (const sub of ['自然', '社會']) fs.rmSync(path.join(dir, '題目', sub), { recursive: true, force: true });
  for (const f of fs.readdirSync(path.join(dir, '索引'))) {
    if (f.endsWith('.json')) fs.rmSync(path.join(dir, '索引', f));
  }
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
  const cfg = resolveConfig({ ...raw, dataDir: dir }, '/');
  return { dir, cfg, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

const sample = (over = {}) => ({
  id: 'M-N2-0999',
  題幹: '1 + 1 = ?',
  選項: ['1', '2', '3'],
  答案: 1,
  難度: 1,
  圖片: null,
  歸屬: [{ 版本: '南一', 年級: '國二', 冊: '第三冊', 章: '第2章 測試' }],
  ...over,
});

module.exports = { makeTempBank, writeJson, sample };
