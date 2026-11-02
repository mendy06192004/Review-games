'use strict';
/**
 * 掃描題目資料夾、讀取 JSON 檔、驗證所有題目（含跨檔案 ID 重複檢查）。
 * 每次呼叫都直接讀取磁碟，不做快取。
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { validateQuestion } = require('./schema');

/** 遞迴列出資料夾下所有 .json 檔（略過 . 與 ~ 開頭的暫存檔），依路徑排序。 */
async function listJsonFiles(rootDir) {
  try {
    const st = await fsp.stat(rootDir);
    if (!st.isDirectory()) throw new Error('不是資料夾');
  } catch (e) {
    throw new Error(`找不到題目資料夾 ${rootDir}（請檢查 config.json 的 dataDir / questionDir）：${e.message}`);
  }
  const out = [];
  async function walk(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith('.') || ent.name.startsWith('~')) continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(abs);
      else if (ent.isFile() && ent.name.toLowerCase().endsWith('.json')) {
        try {
          const st = await fsp.stat(abs);
          out.push({ abs, rel: toPosix(path.relative(rootDir, abs)), mtimeMs: st.mtimeMs, size: st.size });
        } catch {
          // 檔案在掃描期間被刪除（例如雲端同步中），略過
        }
      }
    }
  }
  await walk(rootDir);
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return out;
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function lineColAt(text, pos) {
  let line = 1;
  let last = -1;
  for (let i = 0; i < pos && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) { line++; last = i; }
  }
  return { line, column: pos - last };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 讀取並解析單一題目檔。檔案內容可以是一個題目物件，或題目物件的陣列。
 * @returns {{items: {q:any, index:number|null, line:number|null}[], issues: object[]}}
 */
async function readQuestionFile(file) {
  const issues = [];
  let text;
  try {
    text = await fsp.readFile(file.abs, 'utf8');
  } catch (e) {
    issues.push({ level: 'error', file: file.rel, line: null, message: `無法讀取檔案：${e.message}` });
    return { items: [], issues };
  }
  text = text.replace(/^﻿/, '');
  if (!text.trim()) {
    issues.push({ level: 'error', file: file.rel, line: null, message: '檔案是空的（若正在雲端同步，請稍後再試）' });
    return { items: [], issues };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    let line = null;
    let column = null;
    const lc = /line (\d+) column (\d+)/.exec(e.message);
    const pos = /position (\d+)/.exec(e.message);
    if (lc) { line = Number(lc[1]); column = Number(lc[2]); }
    else if (pos) ({ line, column } = lineColAt(text, Number(pos[1])));
    const snippet = line ? `\n      → ${text.split('\n')[line - 1].trim().slice(0, 80)}` : '';
    issues.push({
      level: 'error', file: file.rel, line, column,
      message: `JSON 語法錯誤：${e.message}（常見原因：少了逗號、多了結尾逗號、用了中文引號「」或單引號）${snippet}`,
    });
    return { items: [], issues };
  }

  let list;
  if (Array.isArray(data)) list = data.map((q, i) => ({ q, index: i }));
  else if (data && typeof data === 'object') list = [{ q: data, index: null }];
  else {
    issues.push({ level: 'error', file: file.rel, line: 1, message: `檔案最外層必須是題目物件 { } 或題目陣列 [ ]，實際為 ${JSON.stringify(data)}` });
    return { items: [], issues };
  }

  // 依 id 字串找出每題在檔案中的行號，方便老師定位
  let cursor = 0;
  for (const item of list) {
    item.line = null;
    if (item.q && typeof item.q.id === 'string') {
      const re = new RegExp(`"id"\\s*:\\s*"${escapeRe(item.q.id)}"`, 'g');
      re.lastIndex = cursor;
      const m = re.exec(text);
      if (m) { item.line = lineColAt(text, m.index).line; cursor = m.index + m[0].length; }
    }
  }
  return { items: list, issues };
}

/**
 * 讀取並驗證所有題目檔。
 * @returns {Promise<{valid: {q, file, index, line}[], issues: object[], fileCount: number}>}
 *   valid：通過驗證、可以出題的題目（ID 重複時保留第一個出現者）
 */
async function loadAndValidate(cfg, { files, checkImages = true } = {}) {
  files = files || (await listJsonFiles(cfg.questionDir));
  const imageExists = checkImages
    ? (rel) => fs.existsSync(path.resolve(cfg.imageDir, rel))
    : undefined;
  const issues = [];
  const valid = [];
  const firstSeen = new Map(); // id -> 位置

  for (const file of files) {
    const res = await readQuestionFile(file);
    issues.push(...res.issues);
    for (const { q, index, line } of res.items) {
      const where = { file: file.rel, line, item: index === null ? null : index + 1, id: q && typeof q.id === 'string' ? q.id : null };
      const qi = validateQuestion(q, cfg, { imageExists });
      for (const i of qi) issues.push({ ...where, ...i });
      const hasError = qi.some((i) => i.level === 'error');

      if (where.id) {
        const prev = firstSeen.get(where.id);
        if (prev) {
          issues.push({
            ...where, level: 'error', field: 'id',
            message: `ID「${where.id}」重複，第一次出現在 ${describe(prev)}；此題將不會被使用`,
          });
          continue;
        }
        firstSeen.set(where.id, where);
      }
      if (!hasError) valid.push({ q, file: file.rel, index, line });
    }
  }
  return { valid, issues, fileCount: files.length };
}

function describe(w) {
  let s = w.file;
  if (w.line) s += ` 第 ${w.line} 行`;
  if (w.item) s += `（第 ${w.item} 題）`;
  return s;
}

/** 將問題轉成人類可讀的一行文字 */
function formatIssue(i) {
  const tag = i.level === 'error' ? '錯誤' : '警告';
  let loc = `題目/${i.file}`;
  if (i.line) loc += `:${i.line}${i.column ? `:${i.column}` : ''}`;
  const parts = [];
  if (i.item) parts.push(`第 ${i.item} 題`);
  if (i.id) parts.push(`id=${i.id}`);
  const who = parts.length ? ` [${parts.join(', ')}]` : '';
  const field = i.field ? ` 欄位「${i.field}」` : '';
  return `[${tag}] ${loc}${who}${field}：${i.message}`;
}

module.exports = { listJsonFiles, readQuestionFile, loadAndValidate, formatIssue };
