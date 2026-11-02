#!/usr/bin/env node
'use strict';
/** 手動重建索引：node scripts/build-index.js [config.json 路徑]（伺服器平常會自動重建，不必手動執行） */
const { loadConfig } = require('../src/config');
const { buildIndex } = require('../src/indexer');

buildIndex(loadConfig(process.argv[2]))
  .then((idx) => {
    console.log(`已寫入索引：${idx.檔案數} 個檔案、${idx.題目總數} 題（錯誤 ${idx.錯誤數}、警告 ${idx.警告數}）`);
    idx.問題.forEach((m) => console.log('  ' + m));
  })
  .catch((e) => { console.error(`❌ ${e.message}`); process.exit(2); });
