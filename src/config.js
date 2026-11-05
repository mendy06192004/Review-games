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
    importDir: path.resolve(dataDir, raw.importDir || '待匯入'),
    reviewDir: path.resolve(dataDir, raw.reviewDir || '待審核'),
    sourceDir: path.resolve(dataDir, raw.sourceDir || '來源'),
    teacherDir: path.resolve(dataDir, raw.teacherDir || '老師'),
    gamesDir: path.resolve(dataDir, raw.gamesDir || '遊戲'),
    claude: { model: 'claude-opus-5-5', effort: 'high', pagesPerRequest: 6, fallbacks: true, ...(raw.claude || {}) },
    // 預留：之後要加審核頁登入驗證時使用（空字串＝不驗證）
    adminPassword: process.env.ADMIN_PASSWORD || raw.admin_password || '',
    // 老師投稿遊戲頁的密碼（空字串＝知道網址的人都能投稿；投稿一律要等管理員審核後才會發布）
    submitPassword: raw.submit_password || '',
    gameUpload: { maxZipMB: 30, maxFiles: 800, ...(raw.gameUpload || {}) },
    defaultCount: Number(raw.defaultCount || 10),
    maxCount: Number(raw.maxCount || 50),
    subjects: raw.subjects || { C: '國文', E: '英文', M: '數學', B: '自然', S: '社會' },
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
  // 本機設定.json（不上傳 GitHub）可覆蓋密碼等私人設定，例如 { "admin_password": "1234" }
  const local = path.join(path.dirname(file), '本機設定.json');
  if (fs.existsSync(local)) {
    try {
      Object.assign(raw, JSON.parse(fs.readFileSync(local, 'utf8').replace(/^\uFEFF/, '')));
    } catch (e) {
      throw new Error(`無法讀取 ${local}：${e.message}`);
    }
  }
  return resolveConfig(raw, path.dirname(file));
}

module.exports = { loadConfig, resolveConfig };
