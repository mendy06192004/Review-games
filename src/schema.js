'use strict';
/**
 * 題目格式定義與單題驗證。
 * 伺服器建立索引與 scripts/validate.js 共用同一套規則，確保兩者判斷一致。
 */

const ID_RE = /^([A-Z])-([A-Z]\d{1,2})-(\d{4,})$/;
const REQUIRED_SCOPE_FIELDS = ['版本', '年級', '冊', '章'];
const OPTIONAL_SCOPE_FIELDS = ['節'];
const QUESTION_FIELDS = ['id', '題幹', '選項', '答案', '難度', '圖片', '歸屬', '解析'];

function typeName(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return '陣列';
  return { string: '字串', number: '數字', boolean: '布林值', object: '物件' }[typeof v] || typeof v;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 解析 id，回傳 { subject, grade, serial } 或 null */
function parseId(id) {
  const m = typeof id === 'string' ? ID_RE.exec(id) : null;
  return m ? { subject: m[1], grade: m[2], serial: m[3] } : null;
}

/**
 * 驗證單一題目物件。
 * @param {*} q 題目
 * @param {{subjects:object, grades:object}} cfg
 * @param {{imageExists?: (rel:string)=>boolean}} opts
 * @returns {{level:'error'|'warning', field:string|null, message:string}[]}
 */
function validateQuestion(q, cfg, opts = {}) {
  const issues = [];
  const err = (field, message) => issues.push({ level: 'error', field, message });
  const warn = (field, message) => issues.push({ level: 'warning', field, message });

  if (!isPlainObject(q)) {
    err(null, `題目必須是 JSON 物件 { ... }，實際為${typeName(q)}`);
    return issues;
  }

  for (const k of Object.keys(q)) {
    if (!QUESTION_FIELDS.includes(k)) {
      warn(k, `未知欄位「${k}」，會被忽略（是否打錯字？允許的欄位：${QUESTION_FIELDS.join('、')}）`);
    }
  }

  // --- id ---
  if (!('id' in q)) err('id', '缺少欄位');
  else if (typeof q.id !== 'string') err('id', `必須是字串，實際為${typeName(q.id)}`);
  else {
    const p = parseId(q.id);
    if (!p) {
      err('id', `格式錯誤「${q.id}」，應為「科目代碼-年級代碼-流水號(至少4位數)」，例如 M-N2-0153`);
    } else {
      if (!(p.subject in cfg.subjects)) {
        err('id', `科目代碼「${p.subject}」未在 config.json 的 subjects 中定義（目前允許：${Object.keys(cfg.subjects).join('、')}）`);
      }
      if (Object.keys(cfg.grades).length && !(p.grade in cfg.grades)) {
        err('id', `年級代碼「${p.grade}」未在 config.json 的 grades 中定義（目前允許：${Object.keys(cfg.grades).join('、')}）`);
      }
    }
  }

  // --- 題幹 ---
  if (!('題幹' in q)) err('題幹', '缺少欄位');
  else if (typeof q.題幹 !== 'string') err('題幹', `必須是字串，實際為${typeName(q.題幹)}`);
  else if (!q.題幹.trim()) err('題幹', '不可為空字串');

  // --- 選項 ---
  let optionCount = null;
  if (!('選項' in q)) err('選項', '缺少欄位');
  else if (!Array.isArray(q.選項)) err('選項', `必須是陣列 [ ... ]，實際為${typeName(q.選項)}`);
  else {
    optionCount = q.選項.length;
    if (optionCount < 2) err('選項', `至少需要 2 個選項，目前只有 ${optionCount} 個`);
    const seen = new Map();
    q.選項.forEach((o, i) => {
      if (typeof o !== 'string') err(`選項[${i}]`, `必須是字串，實際為${typeName(o)}`);
      else if (!o.trim()) err(`選項[${i}]`, '不可為空字串');
      else if (seen.has(o.trim())) warn(`選項[${i}]`, `與 選項[${seen.get(o.trim())}] 內容重複：「${o}」`);
      else seen.set(o.trim(), i);
    });
  }

  // --- 答案 ---
  if (!('答案' in q)) err('答案', '缺少欄位');
  else if (!Number.isInteger(q.答案)) {
    err('答案', `必須是整數（選項索引，從 0 開始），實際為 ${JSON.stringify(q.答案)}`);
  } else if (optionCount !== null && (q.答案 < 0 || q.答案 >= optionCount)) {
    err('答案', `索引 ${q.答案} 超出選項範圍：此題有 ${optionCount} 個選項，答案應為 0 ~ ${optionCount - 1}（第一個選項是 0）`);
  }

  // --- 難度 ---
  if (!('難度' in q)) err('難度', '缺少欄位');
  else if (!Number.isInteger(q.難度) || q.難度 < 1 || q.難度 > 3) {
    err('難度', `必須是整數 1、2 或 3，實際為 ${JSON.stringify(q.難度)}`);
  }

  // --- 圖片（可省略、null 或空字串）---
  if (q.圖片 !== undefined && q.圖片 !== null && q.圖片 !== '') {
    const img = q.圖片;
    if (typeof img !== 'string') err('圖片', `必須是字串或 null，實際為${typeName(img)}`);
    else if (!/^https?:\/\//i.test(img)) {
      const segs = img.split(/[\\/]/);
      if (img.startsWith('/') || /^[a-zA-Z]:/.test(img) || segs.includes('..')) {
        err('圖片', `「${img}」必須是相對於 圖片/ 資料夾的路徑（不可用絕對路徑或 ..），例如「數學/M-N2-0153.png」`);
      } else if (opts.imageExists && !opts.imageExists(img)) {
        warn('圖片', `找不到圖片檔「${img}」（應放在 圖片/ 資料夾下；若正在雲端同步中可稍後再檢查）`);
      }
    }
  }

  // --- 解析（可省略）---
  if (q.解析 !== undefined && q.解析 !== null && typeof q.解析 !== 'string') {
    err('解析', `必須是字串或 null，實際為${typeName(q.解析)}`);
  }

  // --- 歸屬 ---
  if (!('歸屬' in q)) err('歸屬', '缺少欄位');
  else if (!Array.isArray(q.歸屬)) err('歸屬', `必須是陣列 [ { 版本, 年級, 冊, 章, 節 }, ... ]，實際為${typeName(q.歸屬)}`);
  else if (q.歸屬.length === 0) err('歸屬', '至少需要一個歸屬');
  else {
    const seen = new Map();
    q.歸屬.forEach((a, i) => {
      const at = `歸屬[${i}]`;
      if (!isPlainObject(a)) { err(at, `必須是物件 { 版本, 年級, 冊, 章 }，實際為${typeName(a)}`); return; }
      for (const k of Object.keys(a)) {
        if (![...REQUIRED_SCOPE_FIELDS, ...OPTIONAL_SCOPE_FIELDS].includes(k)) {
          warn(`${at}.${k}`, `未知欄位「${k}」，會被忽略（允許：版本、年級、冊、章、節）`);
        }
      }
      let ok = true;
      for (const f of REQUIRED_SCOPE_FIELDS) {
        if (!(f in a)) { err(`${at}.${f}`, '缺少欄位'); ok = false; }
        else if (!checkScopeName(a[f], `${at}.${f}`, err)) ok = false;
      }
      if (a.節 !== undefined && a.節 !== null && !checkScopeName(a.節, `${at}.節`, err)) ok = false;
      if (ok) {
        const key = scopeKey(a);
        if (seen.has(key)) warn(at, `與 歸屬[${seen.get(key)}] 完全重複`);
        else seen.set(key, i);
      }
    });
  }

  return issues;
}

function checkScopeName(v, field, err) {
  if (typeof v !== 'string') { err(field, `必須是字串，實際為${typeName(v)}`); return false; }
  if (!v.trim()) { err(field, '不可為空字串'); return false; }
  if (v.includes('/')) { err(field, `「${v}」不可包含「/」（「/」用來分隔範圍路徑），可改用全形「／」`); return false; }
  return true;
}

/** 歸屬轉成範圍路徑的各層名稱 */
function scopeLevels(a) {
  const levels = REQUIRED_SCOPE_FIELDS.map((f) => [f, a[f].trim()]);
  if (typeof a.節 === 'string' && a.節.trim()) levels.push(['節', a.節.trim()]);
  return levels;
}

function scopeKey(a) {
  return scopeLevels(a).map(([, v]) => v).join('/');
}

module.exports = {
  ID_RE,
  QUESTION_FIELDS,
  REQUIRED_SCOPE_FIELDS,
  parseId,
  validateQuestion,
  scopeLevels,
};
