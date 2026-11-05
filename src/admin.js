'use strict';
/**
 * 審核 API（/api/admin/*）。草稿在 待審核/，通過後才寫入 題目/<科目>/<id>.json。
 * config.json 的 admin_password 不為空時，會要求 HTTP Basic 驗證（帳號任意、密碼為 admin_password）。
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const express = require('express');
const D = require('./drafts');
const { validateQuestion, parseId } = require('./schema');
const { ensureIndex } = require('./indexer');

class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

function adminAuth(cfg) {
  return (req, res, next) => {
    if (!cfg.adminPassword) return next();
    const [type, token] = (req.headers.authorization || '').split(' ');
    const pass = type === 'Basic' && token ? Buffer.from(token, 'base64').toString().split(':').slice(1).join(':') : null;
    if (pass === cfg.adminPassword) return next();
    res.set('WWW-Authenticate', 'Basic realm="review-admin", charset="UTF-8"');
    res.status(401).send('需要老師密碼');
  };
}

/**
 * 防止跨站偽造請求：上傳的遊戲在沙盒（來源為 "null"）中，可能偷偷對管理 API 發出 POST。
 * 會改變資料的請求必須來自本站，且使用 JSON 或圖片等「需要預檢」的內容類型。
 */
function sameOriginGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  const host = req.headers.host;
  const okOrigin = !origin || origin === `http://${host}` || origin === `https://${host}`;
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const simple = !type || ['text/plain', 'multipart/form-data', 'application/x-www-form-urlencoded'].includes(type);
  if (okOrigin && !simple) return next();
  res.status(403).json({ error: '拒絕：請從後台頁面操作' });
}

// 同一個草稿檔的讀寫依序執行
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(key, run.catch(() => {}));
  return run;
}

async function findDraft(cfg, key) {
  for (const f of await D.readDraftFiles(cfg)) {
    if (f.error || !Array.isArray(f.data.題目)) continue;
    const idx = f.data.題目.findIndex((q) => q.草稿編號 === key);
    if (idx >= 0) return { ...f, idx };
  }
  throw new HttpError(404, '找不到這題草稿（可能已被其他人審核）');
}

const EDITABLE = ['id', '科目代碼', '題幹', '選項', '答案', '難度', '圖片', '解析', '歸屬'];

function applyEdits(q, body) {
  for (const k of EDITABLE) if (k in body) q[k] = body[k];
  if (typeof q.id === 'string') q.id = q.id.trim() || null;
  if (q.答案 === '' || q.答案 === undefined) q.答案 = null;
  if (typeof q.答案 === 'string') q.答案 = Number(q.答案);
  if (typeof q.難度 === 'string') q.難度 = q.難度 ? Number(q.難度) : null;
  if (q.圖片 === '') q.圖片 = null;
  if (q.解析 === '') q.解析 = null;
  if (Array.isArray(q.歸屬)) {
    q.歸屬 = q.歸屬.map((a) => {
      const o = {};
      for (const f of ['版本', '年級', '冊', '章', '節']) o[f] = typeof a[f] === 'string' && a[f].trim() ? a[f].trim() : null;
      return o;
    });
  }
}

/** 轉成正式題目格式（去掉草稿專用欄位與空的「節」） */
function toFinal(q) {
  const out = { id: q.id, 題幹: q.題幹, 選項: q.選項, 答案: q.答案, 難度: q.難度, 圖片: q.圖片 || null };
  if (q.解析) out.解析 = q.解析;
  out.歸屬 = (q.歸屬 || []).map((a) => {
    const o = { 版本: a.版本, 年級: a.年級, 冊: a.冊, 章: a.章 };
    if (a.節) o.節 = a.節;
    return o;
  });
  return out;
}

function createAdminRouter(cfg) {
  const r = express.Router();
  r.use(adminAuth(cfg));
  r.use(express.json({ limit: '1mb', type: 'application/json' }));

  r.get('/meta', async (req, res) => {
    const idx = await ensureIndex(cfg).catch(() => null);
    const names = { 版本: new Set(), 年級: new Set(Object.values(cfg.grades)), 冊: new Set(), 章: new Set() };
    const walk = (nodes) => nodes.forEach((n) => { names[n.層級]?.add(n.名稱); walk(n.子層); });
    if (idx) walk(idx.樹);
    res.json({
      科目: cfg.subjects,
      年級: cfg.grades,
      建議: Object.fromEntries(Object.entries(names).map(([k, v]) => [k, [...v]])),
      需要密碼: !!cfg.adminPassword,
    });
  });

  r.get('/drafts', async (req, res) => {
    const files = await D.readDraftFiles(cfg);
    const items = [];
    const broken = [];
    for (const f of files) {
      if (f.error) { broken.push({ 檔案: f.file, 錯誤: f.error }); continue; }
      for (const q of f.data.題目 || []) {
        items.push({ 草稿檔: f.file, 來源檔: f.data.來源檔, 來源位置: f.data.來源位置, 處理時間: f.data.處理時間, 抽取方式: f.data.抽取方式, 備註: f.data.備註, 題目: q });
      }
    }
    // needs_review 排最前，其次依處理時間（新到舊）與原題號
    items.sort((a, b) => (b.題目.needs_review ? 1 : 0) - (a.題目.needs_review ? 1 : 0)
      || String(b.處理時間).localeCompare(String(a.處理時間))
      || (Number(a.題目.原題號) || 0) - (Number(b.題目.原題號) || 0));
    res.json({ 草稿: items, 無法讀取: broken });
  });

  r.get('/next-id', async (req, res) => {
    const subject = String(req.query.subject || '');
    const grade = D.gradeCode(cfg, D.normalizeGrade(cfg, req.query.grade) || req.query.grade);
    if (!cfg.subjects[subject]) throw new HttpError(400, '請先選擇科目');
    if (!grade) throw new HttpError(400, '請先在第一個歸屬填入年級（例如 國二）');
    res.json({ id: D.allocateId(await D.collectUsedIds(cfg), subject, grade) });
  });

  // 上傳 / 替換題目圖片（存到 圖片/匯入/，回傳相對路徑）
  r.post('/images', express.raw({ type: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'], limit: '8mb' }), async (req, res) => {
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[req.headers['content-type']];
    if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, '請上傳 PNG、JPG、GIF 或 WebP 圖片');
    const rel = `匯入/${D.newDraftKey()}.${ext}`;
    await fsp.mkdir(path.join(cfg.imageDir, '匯入'), { recursive: true });
    await fsp.writeFile(path.join(cfg.imageDir, rel), req.body);
    res.json({ 圖片: rel });
  });

  // 儲存編輯（仍留在待審核）
  r.put('/drafts/:key', async (req, res) => {
    const f0 = await findDraft(cfg, req.params.key);
    const q = await withLock(f0.abs, async () => {
      const f = await findDraft(cfg, req.params.key);
      const item = f.data.題目[f.idx];
      applyEdits(item, req.body || {});
      const problems = validateQuestion(toFinal(item), cfg).filter((i) => i.level === 'error');
      item.needs_review = problems.length > 0;
      item.待確認欄位 = [...new Set(problems.map((p) => p.field || '題目'))];
      await D.atomicWriteJson(f.abs, f.data);
      return item;
    });
    res.json({ 題目: q });
  });

  // 退回：註明原因，保留在待審核
  r.post('/drafts/:key/reject', async (req, res) => {
    const reason = String(req.body?.原因 || '').trim();
    if (!reason) throw new HttpError(400, '請註明退回原因');
    const f0 = await findDraft(cfg, req.params.key);
    const q = await withLock(f0.abs, async () => {
      const f = await findDraft(cfg, req.params.key);
      const item = f.data.題目[f.idx];
      if (req.body.題目) applyEdits(item, req.body.題目);
      item.審核 = { 狀態: '退回', 原因: reason, 時間: new Date().toISOString() };
      await D.atomicWriteJson(f.abs, f.data);
      return item;
    });
    res.json({ 題目: q });
  });

  // 通過：驗證 → 寫入 題目/<科目>/<id>.json → 從草稿移除 → 更新索引
  r.post('/drafts/:key/approve', async (req, res) => {
    const f0 = await findDraft(cfg, req.params.key);
    const result = await withLock(f0.abs, async () => {
      const f = await findDraft(cfg, req.params.key);
      const item = f.data.題目[f.idx];
      if (req.body?.題目) applyEdits(item, req.body.題目);

      const used = await D.collectUsedIds(cfg);
      used.delete(item.id); // 草稿自己的暫定編號不算衝突
      if (!item.id) {
        const grade = D.gradeCode(cfg, item.歸屬?.[0]?.年級);
        if (item.科目代碼 && grade) item.id = D.allocateId(used, item.科目代碼, grade);
      }
      const final = toFinal(item);
      const imageExists = (rel) => fs.existsSync(path.resolve(cfg.imageDir, rel));
      const errors = validateQuestion(final, cfg, { imageExists }).filter((i) => i.level === 'error');
      if (errors.length) {
        await D.atomicWriteJson(f.abs, f.data); // 編輯內容仍保存
        throw new HttpError(400, '還有欄位需要修正，無法通過', errors.map((e) => `${e.field ? `「${e.field}」` : ''}${e.message}`));
      }
      const p = parseId(final.id);
      const subjectDir = path.join(cfg.questionDir, D.subjectFolder(cfg, p.subject));
      const target = path.join(subjectDir, `${final.id}.json`);
      const inBank = await D.collectUsedIds(cfg, { includeDrafts: false });
      if (inBank.has(final.id) || fs.existsSync(target)) {
        throw new HttpError(409, `題號 ${final.id} 已存在於題目/，請按「自動編號」換一個`);
      }
      await D.atomicWriteJson(target, final);
      f.data.題目.splice(f.idx, 1);
      if (f.data.題目.length) await D.atomicWriteJson(f.abs, f.data);
      else await fsp.unlink(f.abs);
      return { id: final.id, 檔案: path.relative(cfg.dataDir, target).split(path.sep).join('/') };
    });
    const idx = await ensureIndex(cfg);
    res.json({ ...result, 題目總數: idx.題目總數 });
  });

  r.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message, details: err.details });
  });
  return r;
}

module.exports = { createAdminRouter, adminAuth, sameOriginGuard };
