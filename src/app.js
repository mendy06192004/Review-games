'use strict';
const path = require('path');
const express = require('express');
const compression = require('compression');
const { ensureIndex, nodeMap } = require('./indexer');
const { readQuestionFile } = require('./loader');
const { shuffle } = require('./util');
const { createAdminRouter, adminAuth } = require('./admin');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const toList = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v])
  .flatMap((x) => String(x).split(','))
  .map((s) => s.trim())
  .filter(Boolean);

/** subject 參數可用代碼（M）或名稱（數學），可多選；回傳代碼 Set 或 null（不篩選） */
function parseSubjects(raw, cfg) {
  const list = toList(raw);
  if (!list.length) return null;
  const byName = Object.fromEntries(Object.entries(cfg.subjects).map(([k, v]) => [v, k]));
  const out = new Set();
  for (const s of list) {
    const code = cfg.subjects[s.toUpperCase()] ? s.toUpperCase() : byName[s];
    if (!code) throw new HttpError(400, `未知的科目「${s}」，可用：${Object.entries(cfg.subjects).map(([k, v]) => `${k}(${v})`).join('、')}`);
    out.add(code);
  }
  return out;
}

function parseDifficulty(raw) {
  const list = toList(raw);
  if (!list.length) return null;
  const out = new Set();
  for (const s of list) {
    const n = Number(s);
    if (![1, 2, 3].includes(n)) throw new HttpError(400, `difficulty 必須是 1、2、3，收到「${s}」`);
    out.add(n);
  }
  return out;
}

/** 依索引位置讀回題目原始內容（每次都從磁碟讀取） */
async function loadQuestions(cfg, idx, ids) {
  const byFile = new Map();
  for (const id of ids) {
    const pos = idx.題目位置[id];
    if (!pos) continue;
    if (!byFile.has(pos.檔案)) byFile.set(pos.檔案, []);
    byFile.get(pos.檔案).push(id);
  }
  const result = new Map();
  for (const [rel, wanted] of byFile) {
    const { items } = await readQuestionFile({ abs: path.join(cfg.questionDir, rel), rel });
    const found = new Map(items.filter((it) => it.q && typeof it.q.id === 'string').map((it) => [it.q.id, it.q]));
    for (const id of wanted) if (found.has(id)) result.set(id, found.get(id));
  }
  return result;
}

function imageUrl(img) {
  if (!img) return null;
  if (/^https?:\/\//i.test(img)) return img;
  return '/media/' + img.split(/[\\/]/).map(encodeURIComponent).join('/');
}

/** 給學生的題目：以白名單挑欄位，確保「答案」「解析」不會外洩 */
function toPublic(q, cfg) {
  const code = q.id.split('-')[0];
  return {
    id: q.id,
    科目: cfg.subjects[code] || code,
    題幹: q.題幹,
    選項: q.選項,
    難度: q.難度,
    圖片: imageUrl(q.圖片),
  };
}

function publicTree(nodes, keep) {
  return nodes
    .map((n) => {
      const count = keep ? n.題目ID.filter(keep).length : n.題目ID.length;
      return { 名稱: n.名稱, 層級: n.層級, 路徑: n.路徑, 題數: count, 子層: publicTree(n.子層, keep) };
    })
    .filter((n) => n.題數 > 0);
}

function createApp(cfg) {
  const app = express();
  app.disable('x-powered-by');
  // gzip 壓縮：遊戲檔多為大型 HTML/JS，壓縮後傳輸量約只剩 1/3～1/4
  app.use(compression());
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api/admin', createAdminRouter(cfg));
  app.use('/admin', adminAuth(cfg));

  // 版本與範圍樹（只有題數，不含題目內容與 ID）
  app.get('/api/tree', async (req, res) => {
    const idx = await ensureIndex(cfg);
    const subjects = parseSubjects(req.query.subject, cfg);
    const keep = subjects ? (id) => subjects.has(idx.題目位置[id]?.科目) : null;

    const subjectCounts = {};
    for (const pos of Object.values(idx.題目位置)) subjectCounts[pos.科目] = (subjectCounts[pos.科目] || 0) + 1;

    res.json({
      題目總數: idx.題目總數,
      更新時間: idx.產生時間,
      科目: Object.entries(cfg.subjects).map(([代碼, 名稱]) => ({ 代碼, 名稱, 題數: subjectCounts[代碼] || 0 })),
      樹: publicTree(idx.樹, keep),
    });
  });

  // 隨機出題：scope 可重複多次，例如 ?scope=南一/國二/第三冊&scope=翰林/國二/第三冊/第1章
  app.get('/api/questions', async (req, res) => {
    const scopes = toList(req.query.scope);
    if (!scopes.length) throw new HttpError(400, '請至少提供一個 scope（範圍路徑，例如 scope=南一/國二/第三冊/第1章 乘法公式與多項式）');

    let count = cfg.defaultCount;
    if (req.query.count !== undefined) {
      count = Number(req.query.count);
      if (!Number.isInteger(count) || count < 1) throw new HttpError(400, `count 必須是正整數，收到「${req.query.count}」`);
    }
    count = Math.min(count, cfg.maxCount);

    const subjects = parseSubjects(req.query.subject, cfg);
    const difficulty = parseDifficulty(req.query.difficulty);

    const idx = await ensureIndex(cfg);
    const nodes = nodeMap(idx.樹);
    const pool = new Set();
    for (const s of scopes) {
      const key = s.split('/').map((x) => x.trim()).filter(Boolean).join('/');
      const node = nodes.get(key);
      if (!node) throw new HttpError(400, `找不到範圍「${s}」（可呼叫 /api/tree 查看可用的範圍路徑）`);
      node.題目ID.forEach((id) => pool.add(id)); // Set 自動去重：同一題在多個範圍只算一次
    }

    const candidates = [...pool].filter((id) => {
      const pos = idx.題目位置[id];
      return pos && (!subjects || subjects.has(pos.科目)) && (!difficulty || difficulty.has(pos.難度));
    });
    const picked = shuffle(candidates).slice(0, count);
    const loaded = await loadQuestions(cfg, idx, picked);

    res.json({
      符合題數: candidates.length,
      題目: picked.filter((id) => loaded.has(id)).map((id) => toPublic(loaded.get(id), cfg)),
    });
  });

  // 作答驗證：body = { "answers": [ { "id": "M-N2-0153", "choice": 1 } ] }
  app.post('/api/check', async (req, res) => {
    const answers = req.body && req.body.answers;
    if (!Array.isArray(answers) || !answers.length) throw new HttpError(400, 'body 格式應為 { "answers": [ { "id": "...", "choice": 0 } ] }');
    if (answers.length > Math.max(100, cfg.maxCount)) throw new HttpError(400, '一次最多驗證 100 題');

    const idx = await ensureIndex(cfg);
    const loaded = await loadQuestions(cfg, idx, answers.map((a) => a && a.id).filter((id) => typeof id === 'string'));

    const results = answers.map((a) => {
      const q = a && loaded.get(a.id);
      if (!q) return { id: a && a.id, error: '找不到此題（可能已被老師刪除或修改）' };
      return { id: q.id, choice: a.choice, correct: a.choice === q.答案, 答案: q.答案, 解析: q.解析 || null };
    });
    res.json({ results, correct: results.filter((r) => r.correct).length, total: results.length });
  });

  // 題庫狀態（題數與問題數量，詳細內容請執行 npm run validate）
  app.get('/api/status', async (req, res) => {
    const idx = await ensureIndex(cfg);
    res.json({ 題目總數: idx.題目總數, 檔案數: idx.檔案數, 錯誤數: idx.錯誤數, 警告數: idx.警告數, 更新時間: idx.產生時間 });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: `沒有這個 API：${req.method} ${req.originalUrl}` }));
  app.use('/media', express.static(cfg.imageDir, { dotfiles: 'ignore', maxAge: 0 }));
  // 遊戲檔很少變動：讓瀏覽器快取 1 天（仍會用 ETag 檢查是否有更新）
  app.use('/games', express.static(path.join(__dirname, '..', 'public', 'games'), { maxAge: '1d' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? `伺服器錯誤：${err.message}` : err.message });
  });

  return app;
}

module.exports = { createApp };
