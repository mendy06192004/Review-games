#!/usr/bin/env node
'use strict';
/**
 * 題庫驗證：node scripts/validate.js [config.json 路徑] [--strict]
 *   --strict  有警告也視為失敗（exit code 1）
 */
const { loadConfig } = require('../src/config');
const { loadAndValidate, formatIssue } = require('../src/loader');

(async () => {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const cfg = loadConfig(args.find((a) => !a.startsWith('--')));

  console.log(`檢查題目資料夾：${cfg.questionDir}\n`);
  const { valid, issues, fileCount } = await loadAndValidate(cfg);

  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  // 依檔案分組輸出
  const byFile = new Map();
  for (const i of [...errors, ...warnings]) {
    if (!byFile.has(i.file)) byFile.set(i.file, []);
    byFile.get(i.file).push(i);
  }
  for (const [file, list] of byFile) {
    console.log(`▌題目/${file}`);
    list.sort((a, b) => (a.line || 0) - (b.line || 0)).forEach((i) => console.log('  ' + formatIssue(i)));
    console.log('');
  }

  console.log(`共 ${fileCount} 個檔案，${valid.length} 題通過驗證；錯誤 ${errors.length} 則、警告 ${warnings.length} 則。`);
  if (errors.length || (strict && warnings.length)) {
    console.log('❌ 驗證失敗：有錯誤的題目不會出現在練習中，請依上方位置修正。');
    process.exit(1);
  }
  console.log('✅ 驗證通過');
})().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(2);
});
