'use strict';
/**
 * 後台總覽與網頁匯入（/api/admin/overview、/api/admin/import/*）。
 * 匯入流程與 npm run import 相同：先列出檔案、老師勾選確認後才處理，結果只寫進 待審核/。
 * Claude API 金鑰只從環境變數讀取；也可在後台貼上，只存在這次執行的記憶體中，不寫入任何檔案。
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const express = require('express');
const D = require('./drafts');
const { ensureIndex } = require('./indexer');
const { scanImportDir, processFile } = require('./import/importer');
const { SUPPORTED_EXT } = require('./import/extract');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const hasKey = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const cleanName = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/^\.+/, '').trim().slice(0, 100);

async function readLog(cfg) {
  try {
    const list = JSON.parse(await fsp.readFile(path.join(cfg.teacherDir, '投稿紀錄.json'), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function createWorkspaceRouter(cfg, { processFileImpl = processFile } = {}) {
  const r = express.Router();
  // 一次只跑一個匯入工作，進度存在記憶體
  let job = null;

  r.get('/overview', async (req, res) => {
    const [idx, files, drafts, log] = await Promise.all([
      ensureIndex(cfg).catch(() => null),
      scanImportDir(cfg),
      D.readDraftFiles(cfg),
      readLog(cfg),
    ]);
    let 草稿 = 0;
    let 需審核 = 0;
    let 已退回 = 0;
    for (const f of drafts) {
      for (const q of (f.data && f.data.題目) || []) {
        草稿++;
        if (q.needs_review) 需審核++;
        if (q.審核?.狀態 === '退回') 已退回++;
      }
    }
    let 待審遊戲 = 0;
    try {
      for (const id of await fsp.readdir(cfg.gamesDir)) {
        try {
          const info = JSON.parse(await fsp.readFile(path.join(cfg.gamesDir, id, '資訊.json'), 'utf8'));
          if (info.狀態 === '待審核') 待審遊戲++;
        } catch { /* 不是遊戲資料夾 */ }
      }
    } catch { /* 還沒有遊戲資料夾 */ }
    const perSubject = {};
    if (idx) for (const pos of Object.values(idx.題目位置)) perSubject[pos.科目] = (perSubject[pos.科目] || 0) + 1;
    res.json({
      題庫: { 總數: idx ? idx.題目總數 : 0, 各科: Object.entries(cfg.subjects).map(([代碼, 名稱]) => ({ 代碼, 名稱, 題數: perSubject[代碼] || 0 })), 錯誤數: idx ? idx.錯誤數 : 0 },
      待匯入: files.length,
      草稿: { 總數: 草稿, 需審核, 已退回 },
      待審遊戲,
      最近匯入: log.slice(-8).reverse(),
      有金鑰: hasKey(),
      匯入中: !!(job && job.狀態 === '執行中'),
      資料夾: cfg.dataDir,
    });
  });

  // ---------- 網頁匯入 ----------
  r.get('/import/files', async (req, res) => {
    const files = await scanImportDir(cfg);
    const out = [];
    for (const f of files) {
      const st = await fsp.stat(f.abs).catch(() => null);
      out.push({ 檔案: f.rel, 名稱: f.name, 大小: st ? st.size : 0, 判斷: f.hints });
    }
    res.json({ 檔案: out, 有金鑰: hasKey(), 科目: cfg.subjects, 年級: cfg.grades, 支援: SUPPORTED_EXT });
  });

  // 上傳考卷到 待匯入/科目/版本/年級/
  r.post('/import/upload', express.raw({ type: () => true, limit: '60mb' }), async (req, res) => {
    const name = cleanName(decodeURIComponent(String(req.headers['x-file-name'] || '')));
    const ext = path.extname(name).toLowerCase();
    if (!name || !SUPPORTED_EXT.includes(ext)) throw new HttpError(400, `只支援 ${SUPPORTED_EXT.join('、')} 檔案`);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, '檔案是空的');
    const dirs = ['x-subject', 'x-version', 'x-grade']
      .map((h) => cleanName(decodeURIComponent(String(req.headers[h] || ''))))
      .filter(Boolean);
    const dir = path.join(cfg.importDir, ...dirs);
    await fsp.mkdir(dir, { recursive: true });
    const target = D.uniquePath(path.join(dir, name));
    await fsp.writeFile(target, req.body);
    res.json({ 檔案: path.relative(cfg.importDir, target).split(path.sep).join('/') });
  });

  // 刪除放錯的待匯入檔案
  r.delete('/import/files', async (req, res) => {
    const rel = String(req.query.檔案 || '');
    const files = await scanImportDir(cfg);
    const f = files.find((x) => x.rel === rel);
    if (!f) throw new HttpError(404, '找不到這個檔案');
    await fsp.unlink(f.abs);
    res.json({ 已刪除: rel });
  });

  // 金鑰：只存在記憶體，關閉平台就消失
  r.post('/import/key', (req, res) => {
    const key = String(req.body?.金鑰 || '').trim();
    if (!/^sk-ant-[\w-]{10,}$/.test(key)) throw new HttpError(400, '金鑰格式不正確（應以 sk-ant- 開頭）');
    process.env.ANTHROPIC_API_KEY = key;
    res.json({ 有金鑰: true });
  });

  // 老師確認清單後才開始處理
  r.post('/import/run', async (req, res) => {
    if (job && job.狀態 === '執行中') throw new HttpError(409, '已經有匯入正在進行，請等它完成');
    const wanted = new Set(Array.isArray(req.body?.檔案) ? req.body.檔案 : []);
    const offline = req.body?.離線 === true;
    if (!wanted.size) throw new HttpError(400, '請至少勾選一個檔案');
    if (!offline && !hasKey()) throw new HttpError(400, '還沒有 Claude API 金鑰。請先貼上金鑰，或勾選「離線模式」（只能處理有文字的 PDF）');
    const files = (await scanImportDir(cfg)).filter((f) => wanted.has(f.rel));
    if (!files.length) throw new HttpError(400, '勾選的檔案已不在待匯入資料夾（可能已處理過）');

    job = { 狀態: '執行中', 開始時間: new Date().toISOString(), 模式: offline ? '離線' : 'Claude', 總數: files.length, 完成: 0, 紀錄: [], 結果: [] };
    const current = job;
    const log = (line) => { current.紀錄.push(line); if (current.紀錄.length > 400) current.紀錄.shift(); };
    (async () => {
      for (const [i, f] of files.entries()) {
        log(`[${i + 1}/${files.length}] ${f.rel}`);
        try {
          const rec = await processFileImpl(cfg, f, { offline, log });
          current.結果.push({ 檔案: f.rel, 題數: rec.產生題數 || 0, 需審核: rec.需審核題數 || 0, 錯誤: rec.錯誤 || null });
        } catch (e) {
          log(`  ❌ ${e.message}`);
          current.結果.push({ 檔案: f.rel, 題數: 0, 需審核: 0, 錯誤: e.message });
        }
        current.完成 = i + 1;
      }
      current.狀態 = '完成';
      current.結束時間 = new Date().toISOString();
    })();
    res.json({ 工作: job });
  });

  r.get('/import/job', (req, res) => res.json({ 工作: job }));

  r.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status === 413 ? '檔案太大（上限 60MB）' : err.message });
  });
  return r;
}

module.exports = { createWorkspaceRouter };
