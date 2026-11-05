#!/usr/bin/env node
'use strict';
/**
 * 題目匯入：node scripts/import.js [config.json] [--list]
 *   --list     只列出待匯入的檔案，不處理
 * 不使用 AI、不需要金鑰：依題號與 (A)(B)(C)(D) 自動拆題，並由檔名與內容自動分類。
 * 每次執行都會先列出檔案清單，輸入 y 確認後才會處理。
 */
const readline = require('readline');
const { loadConfig } = require('../src/config');
const { scanImportDir, processFile } = require('../src/import/importer');

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a.trim()); }));
}

(async () => {
  const args = process.argv.slice(2);
  const listOnly = args.includes('--list');
  const cfg = loadConfig(args.find((a) => !a.startsWith('--')));

  const files = await scanImportDir(cfg);
  console.log(`待匯入資料夾：${cfg.importDir}`);
  if (!files.length) {
    console.log('目前沒有需要處理的檔案（支援 .pdf .docx .png .jpg）。');
    return;
  }
  console.log(`\n將要處理以下 ${files.length} 個檔案：`);
  files.forEach((f, i) => {
    const h = Object.entries(f.hints).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('、');
    console.log(`  ${i + 1}. ${f.rel}${h ? `　（由資料夾判斷：${h}）` : '　（資料夾未標示版本/年級，將由內容判斷）'}`);
  });
  console.log('結果會寫到 待審核/，不會直接放進 題目/。');
  if (listOnly) return;

  const ans = await ask('\n確定要處理以上檔案嗎？輸入 y 確認，其他任意鍵取消：');
  if (ans.toLowerCase() !== 'y') {
    console.log('已取消，沒有處理任何檔案。');
    return;
  }
  let ok = 0;
  for (const [i, f] of files.entries()) {
    console.log(`\n[${i + 1}/${files.length}] ${f.rel}`);
    const r = await processFile(cfg, f);
    if (!r.錯誤) ok++;
  }
  console.log(`\n完成：成功 ${ok} 個、失敗 ${files.length - ok} 個。紀錄已寫入 老師/投稿紀錄.json`);
  console.log('請開啟 http://localhost:3000/admin 審核草稿。');
})().catch((e) => { console.error(`❌ ${e.message}`); process.exit(2); });
