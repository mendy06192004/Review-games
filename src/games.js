'use strict';
/**
 * 上傳遊戲（管理員新增、老師投稿）。
 *
 * 存放位置：<dataDir>/遊戲/<遊戲編號>/
 *   資訊.json   名稱、分類、狀態等（由平台寫入，遊戲檔無法覆蓋）
 *   檔案/       遊戲本體，入口一定是 index.html
 *   封面.jpg|png|webp|gif（選填）
 *
 * 狀態：待審核 → 已發布（或 已退回）；已發布可再「下架」。
 * 老師投稿一律是「待審核」，只有管理員按「發布」後學生才看得到。
 *
 * 安全：上傳的遊戲一律以 CSP sandbox（不含 allow-same-origin）執行，
 * 在瀏覽器眼中是「另一個來源」，讀不到平台的 Cookie、localStorage，也不能呼叫管理 API。
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const JSZip = require('jszip');
const { previewToken } = require('./auth');

class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

const CATEGORIES = ['複習遊戲', '學科練習', '生活管理', '職業教育', '社會技巧', '邏輯推理'];
const STATUS = ['待審核', '已發布', '已退回', '已下架'];
const ALLOWED_EXT = new Set(['html', 'htm', 'js', 'mjs', 'css', 'json', 'txt', 'md', 'csv',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp',
  'mp3', 'ogg', 'wav', 'm4a', 'aac', 'mp4', 'webm',
  'woff', 'woff2', 'ttf', 'otf', 'glb', 'gltf', 'bin', 'wasm', 'atlas']);
const IGNORE = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)|(^|\/)\./;
const COVER_RE = /^(cover|封面|screenshot|截圖)\.(png|jpe?g|webp|gif)$/i;
const ID_RE = /^u-[0-9a-f]{8}$/;
const MAX_UNZIPPED = 200 * 1024 * 1024;
const MAX_COVER = 3 * 1024 * 1024;

/** 上傳遊戲的 iframe 一律套用的沙盒設定（與 public/games/_shared/iframe-game.js 一致） */
const SANDBOX = 'allow-scripts allow-pointer-lock allow-forms allow-modals allow-popups allow-downloads';

const dirOf = (cfg, id) => path.join(cfg.gamesDir, id);
const filesDir = (cfg, id) => path.join(dirOf(cfg, id), '檔案');
const infoFile = (cfg, id) => path.join(dirOf(cfg, id), '資訊.json');

async function atomicWriteJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await fsp.rename(tmp, file);
}

async function readInfo(cfg, id) {
  if (!ID_RE.test(id)) return null;
  try {
    return JSON.parse(await fsp.readFile(infoFile(cfg, id), 'utf8'));
  } catch {
    return null;
  }
}

async function listGames(cfg) {
  let names = [];
  try { names = await fsp.readdir(cfg.gamesDir); } catch { return []; }
  const out = [];
  for (const n of names) {
    const info = await readInfo(cfg, n);
    if (info) out.push(info);
  }
  return out;
}

async function findCover(cfg, id) {
  for (const ext of ['jpg', 'png', 'webp', 'gif']) {
    const f = path.join(dirOf(cfg, id), `封面.${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/** 給學生端的遊戲資料（不含投稿者、聯絡方式等） */
function toPublic(info, hasCover) {
  const link = !!info.連結;
  return {
    id: info.id,
    名稱: info.名稱,
    圖示: info.圖示 || '',
    年級: info.年級 || undefined,
    章節: info.章節 || undefined,
    連結遊戲: link || undefined,
    說明: info.說明 || '',
    分類: info.分類,
    領域: info.領域 || undefined,
    科目: info.科目?.length ? info.科目 : undefined,
    使用題庫: !link && !!info.使用題庫,
    類型: 'standalone',
    外部: true,
    入口: link ? info.連結 : `/ugames/${info.id}/index.html`,
    封面: hasCover ? `/api/games/${info.id}/cover?v=${encodeURIComponent(info.更新時間 || '')}` : undefined,
    題數選項: info.使用題庫 ? info.題數選項 : undefined,
    預設題數: info.使用題庫 ? info.預設題數 : undefined,
  };
}

// ---------- 資料檢查 ----------

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function cleanInfo(cfg, raw = {}, { partial = false, prev = {} } = {}) {
  const pick = (k) => (k in raw ? raw[k] : prev[k]);
  const out = {
    名稱: str(pick('名稱'), 40),
    圖示: str(pick('圖示'), 8),
    說明: str(pick('說明'), 300),
    分類: str(pick('分類'), 20),
    領域: str(pick('領域'), 60),
    科目: Array.isArray(pick('科目')) ? [...new Set(pick('科目').map(String))] : [],
    使用題庫: pick('使用題庫') === true || pick('使用題庫') === 'true',
    年級: Object.values(cfg.grades).includes(str(pick('年級'), 10)) ? str(pick('年級'), 10) : '',
    章節: str(pick('章節'), 40),
    投稿者: str(pick('投稿者'), 40),
    聯絡: str(pick('聯絡'), 80),
    給管理員的話: str(pick('給管理員的話'), 500),
  };
  const errors = [];
  if (!out.名稱) errors.push('請填寫遊戲名稱');
  if (!CATEGORIES.includes(out.分類)) errors.push(`分類必須是：${CATEGORIES.join('、')}`);
  const bad = out.科目.filter((s) => !cfg.subjects[s]);
  if (bad.length) errors.push(`未知的科目代碼：${bad.join('、')}`);
  if (out.使用題庫 && !out.科目.length) errors.push('使用題庫的遊戲請至少勾選一個科目');
  if (out.分類 === '複習遊戲' && !out.使用題庫) errors.push('「複習遊戲」分類是給使用題庫的遊戲；不使用題庫請改選其他分類');

  let counts = pick('題數選項');
  if (typeof counts === 'string') counts = counts.split(/[,，、\s]+/);
  counts = Array.isArray(counts) ? [...new Set(counts.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= cfg.maxCount))].sort((a, b) => a - b) : [];
  out.題數選項 = counts.length ? counts : [10, 20, 30].filter((n) => n <= cfg.maxCount);
  const def = Number(pick('預設題數'));
  out.預設題數 = out.題數選項.includes(def) ? def : out.題數選項[Math.min(1, out.題數選項.length - 1)];
  if (errors.length && !partial) throw new HttpError(400, errors[0], errors);
  return out;
}

function safeRel(name) {
  const p = String(name).replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!p || p.startsWith('/') || /^[a-z]:/i.test(p)) return null;
  const parts = p.split('/').filter(Boolean);
  if (parts.some((s) => s === '..' || s === '.')) return null;
  return parts.join('/');
}

const extOf = (p) => (p.match(/\.([^./]+)$/) || [])[1]?.toLowerCase() || '';

function imageType(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.slice(1, 4).toString() === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (buf.slice(0, 3).toString() === 'GIF') return 'gif';
  return null;
}

/**
 * 解析上傳的遊戲檔（ZIP 或單一 HTML），回傳 { files: Map<相對路徑, Buffer>, cover, skipped }
 */
async function unpackUpload(cfg, buf, filename) {
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  const files = new Map();
  const skipped = [];
  let cover = null;

  if (!isZip) {
    const ext = extOf(filename || '');
    const head = buf.slice(0, 2000).toString('utf8').toLowerCase();
    if (!['html', 'htm'].includes(ext) && !/<html|<!doctype html|<script|<body/.test(head)) {
      throw new HttpError(400, '請上傳 .zip 壓縮檔或單一 .html 檔');
    }
    files.set('index.html', buf);
    return { files, cover, skipped };
  }

  let zip;
  try { zip = await JSZip.loadAsync(buf); } catch (e) { throw new HttpError(400, `壓縮檔無法開啟：${e.message}`); }
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (entries.length > cfg.gameUpload.maxFiles) throw new HttpError(400, `檔案太多（${entries.length} 個），上限 ${cfg.gameUpload.maxFiles} 個`);

  let rels = [];
  for (const f of entries) {
    const rel = safeRel(f.name);
    if (!rel) { skipped.push(`${f.name}（路徑不安全）`); continue; }
    if (IGNORE.test(rel)) continue;
    rels.push({ rel, f });
  }
  // 整包外面多包了一層資料夾時，自動拿掉那一層
  const hasRootIndex = rels.some((x) => x.rel.toLowerCase() === 'index.html');
  if (!hasRootIndex) {
    const tops = new Set(rels.map((x) => x.rel.split('/')[0]));
    if (tops.size === 1 && rels.every((x) => x.rel.includes('/'))) {
      const top = [...tops][0] + '/';
      rels = rels.map((x) => ({ ...x, rel: x.rel.slice(top.length) }));
    }
  }

  let total = 0;
  for (const { rel, f } of rels) {
    const ext = extOf(rel);
    if (!ALLOWED_EXT.has(ext)) { skipped.push(`${rel}（不支援的檔案類型 .${ext || '無副檔名'}）`); continue; }
    const data = await f.async('nodebuffer');
    total += data.length;
    if (total > MAX_UNZIPPED) throw new HttpError(400, `解壓縮後超過 ${MAX_UNZIPPED / 1024 / 1024}MB，請縮小檔案`);
    if (!rel.includes('/') && COVER_RE.test(rel) && imageType(data)) {
      cover = cover || { data, type: imageType(data) };
    }
    files.set(rel, data);
  }

  if (!files.has('index.html')) {
    const keyIndex = [...files.keys()].find((k) => k.toLowerCase() === 'index.html');
    const rootHtml = [...files.keys()].filter((k) => !k.includes('/') && /\.html?$/i.test(k));
    if (keyIndex) files.set('index.html', files.get(keyIndex));
    else if (rootHtml.length === 1) files.set('index.html', files.get(rootHtml[0]));
    else throw new HttpError(400, '壓縮檔最外層需要有 index.html（遊戲的入口網頁）');
  }
  return { files, cover, skipped };
}

function decodeUpload(obj, label, maxBytes) {
  if (!obj) return null;
  if (typeof obj.內容 !== 'string') throw new HttpError(400, `${label}格式錯誤`);
  const buf = Buffer.from(obj.內容.replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length) throw new HttpError(400, `${label}是空的`);
  if (buf.length > maxBytes) throw new HttpError(400, `${label}太大（上限 ${Math.round(maxBytes / 1024 / 1024)}MB）`);
  return { buf, 檔名: str(obj.檔名, 200) };
}

async function writeFiles(cfg, id, files) {
  const tmp = path.join(cfg.gamesDir, `.tmp-${id}-${Date.now()}`);
  for (const [rel, data] of files) {
    const target = path.join(tmp, ...rel.split('/'));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, data);
  }
  const dest = filesDir(cfg, id);
  await fsp.mkdir(dirOf(cfg, id), { recursive: true });
  await fsp.rm(dest, { recursive: true, force: true });
  await fsp.rename(tmp, dest);
}

async function writeCover(cfg, id, cover) {
  for (const ext of ['jpg', 'png', 'webp', 'gif']) await fsp.rm(path.join(dirOf(cfg, id), `封面.${ext}`), { force: true });
  await fsp.writeFile(path.join(dirOf(cfg, id), `封面.${cover.type}`), cover.data);
}

/** 建立一個新遊戲（管理員新增或老師投稿共用） */
/** 連結遊戲：只接受 http(s) 網址（例如 Gemini、Canva、Wordwall 分享連結），平台只負責掛上去 */
function cleanLink(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  let u;
  try { u = new URL(s); } catch { throw new HttpError(400, '連結格式不正確，請貼上完整網址（https:// 開頭）'); }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, '只接受 http 或 https 開頭的網址');
  return u.href;
}

async function createGame(cfg, body, { 來源, 狀態 }) {
  const link = cleanLink(body.連結);
  const info = cleanInfo(cfg, link ? { ...(body.資訊 || {}), 使用題庫: false } : (body.資訊 || {}));
  const upload = link ? null : decodeUpload(body.檔案, '遊戲檔', cfg.gameUpload.maxZipMB * 1024 * 1024);
  if (!link && !upload) throw new HttpError(400, '請選擇遊戲檔（.zip 或 .html），或改用「貼上連結」');
  const { files, cover: zipCover, skipped } = link ? { files: new Map(), cover: null, skipped: [] } : await unpackUpload(cfg, upload.buf, upload.檔名);
  const coverUp = decodeUpload(body.封面, '封面圖片', MAX_COVER);
  let cover = zipCover;
  if (coverUp) {
    const type = imageType(coverUp.buf);
    if (!type) throw new HttpError(400, '封面請使用 PNG、JPG、WebP 或 GIF 圖片');
    cover = { data: coverUp.buf, type };
  }

  const id = `u-${crypto.randomBytes(4).toString('hex')}`;
  if (link) await fsp.mkdir(dirOf(cfg, id), { recursive: true });
  else await writeFiles(cfg, id, files);
  if (cover) await writeCover(cfg, id, cover);
  const now = new Date().toISOString();
  const full = {
    id, ...info, 來源, 狀態,
    原始檔名: upload ? upload.檔名 || null : null,
    連結: link,
    檔案數: files.size,
    大小: [...files.values()].reduce((s, b) => s + b.length, 0),
    建立時間: now, 更新時間: now,
    ...(狀態 === '已發布' ? { 發布時間: now } : {}),
  };
  await atomicWriteJson(infoFile(cfg, id), full);
  return { 遊戲: full, 略過的檔案: skipped };
}

// ---------- 伺服遊戲檔（沙盒） ----------

// 沙盒內 localStorage 會丟出錯誤；插入小程式改用記憶體版本，避免遊戲當掉
const SHIM = '<script src="/games/_shared/sandbox-shim.js"></script>';

function serveGameFiles(cfg, { allow }) {
  return async (req, res, next) => {
    const id = req.params.id;
    const info = await readInfo(cfg, id);
    if (!info || !allow(info)) return res.status(404).type('text/plain; charset=utf-8').send('找不到這個遊戲（可能尚未發布或已下架）');
    const rel = safeRel(req.params[0] || 'index.html');
    if (!rel) return res.status(400).end();
    const root = filesDir(cfg, id);
    const abs = path.join(root, ...rel.split('/'));
    if (!abs.startsWith(root + path.sep)) return res.status(400).end();
    res.set({
      'Content-Security-Policy': `sandbox ${SANDBOX}`,
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    if (/\.html?$/i.test(rel)) {
      let html;
      try { html = await fsp.readFile(abs, 'utf8'); } catch { return next(); }
      html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + SHIM) : SHIM + html;
      return res.type('html').send(html);
    }
    res.sendFile(abs, { dotfiles: 'deny' }, (err) => { if (err) next(); });
  };
}

// ---------- 路由 ----------

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status === 413 ? '檔案太大，超過上傳上限' : err.message, details: err.details });
}

/** 公開：遊戲清單、封面、上傳遊戲檔、老師投稿 */
function createPublicGameRouter(cfg) {
  const r = express.Router();
  const builtinFile = path.join(__dirname, '..', 'public', 'games', 'registry.json');
  const jsonLimit = `${Math.ceil(cfg.gameUpload.maxZipMB * 1.4 + 5)}mb`;

  r.get('/api/games', async (req, res) => {
    const builtin = JSON.parse(await fsp.readFile(builtinFile, 'utf8')).map((g) => ({
      ...g,
      使用題庫: g.使用題庫 ?? g.類型 === 'module',
      封面: g.封面 || (fs.existsSync(path.join(__dirname, '..', 'public', 'games', g.id, 'cover.jpg')) ? `/games/${g.id}/cover.jpg` : undefined),
    }));
    const uploaded = [];
    for (const info of await listGames(cfg)) {
      if (info.狀態 === '已發布') uploaded.push(toPublic(info, !!(await findCover(cfg, info.id))));
    }
    res.json({ 遊戲: [...builtin, ...uploaded], 科目: cfg.subjects, 年級: cfg.grades });
  });

  r.get('/api/games/:id/cover', async (req, res) => {
    const info = await readInfo(cfg, req.params.id);
    const f = info && info.狀態 === '已發布' && (await findCover(cfg, info.id));
    if (!f) return res.status(404).end();
    res.sendFile(f, { maxAge: '1d' });
  });

  r.get(/^\/ugames\/(u-[0-9a-f]{8})(?:\/(.*))?$/, (req, res, next) => {
    req.params.id = req.params[0];
    req.params[0] = req.params[1];
    next();
  }, serveGameFiles(cfg, { allow: (info) => info.狀態 === '已發布' }));

  // 老師投稿
  r.get('/api/submit/info', (req, res) => {
    res.json({ 需要密碼: !!cfg.submitPassword, 分類: CATEGORIES, 科目: cfg.subjects, 年級: cfg.grades, 上限MB: cfg.gameUpload.maxZipMB });
  });
  r.post('/api/submit/games', express.json({ limit: jsonLimit }), async (req, res) => {
    if (cfg.submitPassword && req.body?.密碼 !== cfg.submitPassword) throw new HttpError(401, '投稿密碼不正確，請向管理員詢問');
    const info = req.body?.資訊 || {};
    if (!str(info.投稿者, 40)) throw new HttpError(400, '請填寫投稿老師姓名');
    const out = await createGame(cfg, req.body, { 來源: '老師投稿', 狀態: '待審核' });
    res.json({ 編號: out.遊戲.id, 狀態: out.遊戲.狀態, 略過的檔案: out.略過的檔案 });
  });

  r.use(['/api/games', '/api/submit'], errorHandler);
  return r;
}

/** 管理員：/api/admin/games/*（掛在 adminAuth 之後） */
function createAdminGameRouter(cfg) {
  const r = express.Router();
  const jsonLimit = `${Math.ceil(cfg.gameUpload.maxZipMB * 1.4 + 5)}mb`;
  const load = async (id) => {
    const info = await readInfo(cfg, id);
    if (!info) throw new HttpError(404, '找不到這個遊戲');
    return info;
  };
  const save = async (info, patch) => {
    const out = { ...info, ...patch, 更新時間: new Date().toISOString() };
    await atomicWriteJson(infoFile(cfg, info.id), out);
    return out;
  };
  const ORDER = { 待審核: 0, 已退回: 1, 已發布: 2, 已下架: 3 };

  r.get('/', async (req, res) => {
    const list = await listGames(cfg);
    for (const g of list) {
      g.有封面 = !!(await findCover(cfg, g.id));
      g.預覽網址 = g.連結 || `/gpreview/${previewToken(cfg, g.id)}/${g.id}/index.html`;
    }
    list.sort((a, b) => (ORDER[a.狀態] ?? 9) - (ORDER[b.狀態] ?? 9) || String(b.建立時間).localeCompare(String(a.建立時間)));
    res.json({ 遊戲: list, 分類: CATEGORIES, 科目: cfg.subjects, 年級: cfg.grades, 上限MB: cfg.gameUpload.maxZipMB });
  });

  r.post('/', express.json({ limit: jsonLimit }), async (req, res) => {
    const 狀態 = req.body?.直接發布 ? '已發布' : '待審核';
    res.json(await createGame(cfg, req.body || {}, { 來源: '管理員', 狀態 }));
  });

  // 修改資訊；可同時替換遊戲檔或封面
  r.put('/:id', express.json({ limit: jsonLimit }), async (req, res) => {
    const info = await load(req.params.id);
    const patch = cleanInfo(cfg, req.body?.資訊 || {}, { prev: info });
    if (info.連結 || req.body?.連結) {
      const link = cleanLink(req.body?.連結 ?? info.連結);
      if (link) { patch.連結 = link; patch.使用題庫 = false; }
    }
    let skipped = [];
    const upload = decodeUpload(req.body?.檔案, '遊戲檔', cfg.gameUpload.maxZipMB * 1024 * 1024);
    if (upload) {
      const u = await unpackUpload(cfg, upload.buf, upload.檔名);
      await writeFiles(cfg, info.id, u.files);
      if (u.cover) await writeCover(cfg, info.id, u.cover);
      skipped = u.skipped;
      Object.assign(patch, { 原始檔名: upload.檔名 || null, 檔案數: u.files.size, 大小: [...u.files.values()].reduce((s, b) => s + b.length, 0) });
    }
    const coverUp = decodeUpload(req.body?.封面, '封面圖片', MAX_COVER);
    if (coverUp) {
      const type = imageType(coverUp.buf);
      if (!type) throw new HttpError(400, '封面請使用 PNG、JPG、WebP 或 GIF 圖片');
      await writeCover(cfg, info.id, { data: coverUp.buf, type });
    }
    res.json({ 遊戲: await save(info, patch), 略過的檔案: skipped });
  });

  r.post('/:id/publish', async (req, res) => {
    const info = await load(req.params.id);
    cleanInfo(cfg, info); // 資料不完整就不能發布
    res.json({ 遊戲: await save(info, { 狀態: '已發布', 發布時間: new Date().toISOString(), 退回原因: null }) });
  });
  r.post('/:id/reject', express.json(), async (req, res) => {
    const reason = str(req.body?.原因, 500);
    if (!reason) throw new HttpError(400, '請註明退回原因');
    const info = await load(req.params.id);
    res.json({ 遊戲: await save(info, { 狀態: '已退回', 退回原因: reason }) });
  });
  r.post('/:id/unpublish', async (req, res) => {
    const info = await load(req.params.id);
    res.json({ 遊戲: await save(info, { 狀態: '已下架' }) });
  });
  r.delete('/:id', async (req, res) => {
    const info = await load(req.params.id);
    await fsp.rm(dirOf(cfg, info.id), { recursive: true, force: true });
    res.json({ 已刪除: info.id });
  });
  r.get('/:id/cover', async (req, res) => {
    const f = await findCover(cfg, (await load(req.params.id)).id);
    if (!f) return res.status(404).end();
    res.sendFile(f);
  });

  r.use(errorHandler);
  return r;
}

/**
 * 管理員預覽（任何狀態都能看）：/gpreview/<簽章>/<遊戲編號>/...
 * 沙盒中的遊戲載入自己的圖片、程式時不會帶登入 Cookie，所以改用網址中的簽章驗證；
 * 簽章只有後台遊戲清單才拿得到。
 */
function createPreviewRouter(cfg) {
  const r = express.Router();
  r.get(/^\/gpreview\/([0-9a-f]{16})\/(u-[0-9a-f]{8})(?:\/(.*))?$/, (req, res, next) => {
    if (req.params[0] !== previewToken(cfg, req.params[1])) return res.status(404).end();
    req.params.id = req.params[1];
    req.params[0] = req.params[2];
    next();
  }, serveGameFiles(cfg, { allow: () => true }));
  return r;
}

module.exports = {
  createPublicGameRouter, createAdminGameRouter, createPreviewRouter,
  unpackUpload, cleanInfo, CATEGORIES, STATUS, SANDBOX,
};
