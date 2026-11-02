'use strict';
const { loadConfig } = require('./src/config');
const { createApp } = require('./src/app');
const { ensureIndex } = require('./src/indexer');

const cfg = loadConfig(process.argv[2]);
cfg.onRebuild = (idx) => {
  console.log(`[索引] 已重建：${idx.檔案數} 個檔案、${idx.題目總數} 題可用（錯誤 ${idx.錯誤數}、警告 ${idx.警告數}）`);
  idx.問題.slice(0, 10).forEach((m) => console.log('  ' + m));
  if (idx.問題.length > 10) console.log(`  ……還有 ${idx.問題.length - 10} 則，請執行 npm run validate 查看全部`);
};

ensureIndex(cfg)
  .catch((e) => console.error(`[索引] ${e.message}`))
  .finally(() => {
    createApp(cfg).listen(cfg.port, () => {
      console.log(`題庫資料夾：${cfg.dataDir}`);
      console.log(`國英數複習平台已啟動：http://localhost:${cfg.port}`);
    });
  });
