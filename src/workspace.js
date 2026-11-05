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
const { verifyKey } = require('./import/claude');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const hasKey = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
// 只顯示金鑰最後 4 碼，方便老師確認用的是哪一把
const keyHint = () => (process.env.ANTHROPIC_API_KEY ? `…${process.env.ANTHROPIC_API_KEY.slice(-4)}` : null);
const cleanName = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/^\.+/, '').trim().slice(0, 100);

async function readLog(cfg) {
  try {
    const list = JSON.parse(await fsp.readFile(path.join(cfg.teacherDir, '投稿紀錄.json'), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function createWorkspaceRouter(cfg, opts = {}) {
  const processFileImpl = opts.processFileImpl || processFile;
  const r = express.Router();
  // 一次只跑一個匯入工作，進度存在記憶體
  let job = null;
  let keySource = hasKey() ? 'Windows 設定（設定金鑰-Windows.bat）' : null;

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
    res.json({ 檔案: out, 有金鑰: hasKey(), 金鑰末碼: keyHint(), 金鑰來源: keySource, 科目: cfg.subjects, 年級: cfg.grades, 支援: SUPPORTED_EXT });
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

  // 貼上題目文字：存成 待匯入/科目/版本/年級/貼上的題目-時間.txt，之後跟其他檔案一樣勾選匯入
  r.post('/import/text', async (req, res) => {
    const text = String(req.body?.文字 || '').trim();
    if (!text) throw new HttpError(400, '請先貼上題目文字');
    if (text.length > 200000) throw new HttpError(400, '文字太長，請分成幾次貼上');
    const dirs = [req.body?.科目, req.body?.版本, req.body?.年級].map(cleanName).filter(Boolean);
    const dir = path.join(cfg.importDir, ...dirs);
    await fsp.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const target = D.uniquePath(path.join(dir, `貼上的題目-${stamp}.txt`));
    await fsp.writeFile(target, text, 'utf8');
    res.json({ 檔案: path.relative(cfg.importDir, target).split(path.sep).join('/') });
  });

  // 手動新增一題空白草稿（不需要考卷檔案）
  r.post('/drafts-new', async (req, res) => {
    const subject = cfg.subjects[req.body?.科目代碼] ? req.body.科目代碼 : null;
    const file = path.join(cfg.reviewDir, '手動新增.json');
    let data = { 來源檔: '後台手動新增', 來源位置: null, 處理時間: new Date().toISOString(), 抽取方式: '手動', 題目: [] };
    try { data = JSON.parse(await fsp.readFile(file, 'utf8')); } catch { /* 第一次建立 */ }
    const q = {
      草稿編號: D.newDraftKey(), 原題號: null, 科目代碼: subject, id: null,
      題幹: '', 選項: ['', '', '', ''], 答案: null, 答案依據: '老師手動輸入', 難度: null, 圖片: null, 解析: null,
      歸屬: [{ 版本: null, 年級: null, 冊: null, 章: null, 節: null }],
      needs_review: true, 待確認欄位: ['題幹', '選項', '答案'], 審核: { 狀態: '待審核', 原因: null, 時間: null },
    };
    data.題目 = [q, ...(data.題目 || [])];
    data.處理時間 = new Date().toISOString();
    await D.atomicWriteJson(file, data);
    res.json({ 題目: q });
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
  r.post('/import/key', async (req, res) => {
    const key = String(req.body?.金鑰 || '').replace(/\s+/g, '');
    if (!/^sk-ant-[\w-]{10,}$/.test(key)) throw new HttpError(400, '金鑰格式不正確：應以 sk-ant- 開頭，是一長串英數字（請從 console.anthropic.com 的 API Keys 頁面複製）');
    // 先向 Claude 確認金鑰有效，再採用（不會產生費用）
    try {
      await (opts.verifyKeyImpl || verifyKey)(key);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    process.env.ANTHROPIC_API_KEY = key;
    keySource = '本次貼上（關閉平台後清除）';
    res.json({ 有金鑰: true, 金鑰末碼: keyHint(), 金鑰來源: keySource });
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
          if (rec.錯誤代碼 === '金鑰') {
            // 金鑰有問題，後面的檔案也一定失敗：停下來，檔案都留在待匯入
            for (const rest of files.slice(i + 1)) current.結果.push({ 檔案: rest.rel, 題數: 0, 需審核: 0, 錯誤: '尚未處理（金鑰有問題，已暫停）' });
            current.金鑰錯誤 = true;
            current.完成 = files.length;
            break;
          }
        } catch (e) {
          log(`  ❌ ${e.message}`);
          current.結果.push({ 檔案: f.rel, 題數: 0, 需審核: 0, 錯誤: e.message });
        }
        if (!current.金鑰錯誤) current.完成 = i + 1;
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
