'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config.json');

/**
 * 將設定物件中的相對路徑解析為絕對路徑。
 * dataDir 相對於 config.json 所在資料夾；其餘路徑相對於 dataDir。
 */
function resolveConfig(raw, baseDir) {
  const dataDir = path.resolve(baseDir, raw.dataDir || './題庫');
  return {
    port: Number(process.env.PORT || raw.port || 3000),
    dataDir,
    questionDir: path.resolve(dataDir, raw.questionDir || '題目'),
    imageDir: path.resolve(dataDir, raw.imageDir || '圖片'),
    indexFile: path.resolve(dataDir, raw.indexFile || '索引/題目索引.json'),
    defaultCount: Number(raw.defaultCount || 10),
    maxCount: Number(raw.maxCount || 50),
    subjects: raw.subjects || { C: '國文', E: '英文', M: '數學' },
    grades: raw.grades || {},
  };
}

/** 讀取 config.json。可用參數或環境變數 REVIEW_CONFIG 指定其他設定檔。 */
function loadConfig(configPath) {
  const file = path.resolve(configPath || process.env.REVIEW_CONFIG || DEFAULT_CONFIG_PATH);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`無法讀取設定檔 ${file}：${e.message}`);
  }
  return resolveConfig(raw, path.dirname(file));
}

module.exports = { loadConfig, resolveConfig };
