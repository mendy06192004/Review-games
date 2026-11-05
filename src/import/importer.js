'use strict';
/**
 * 題目匯入流程：待匯入/ → 抽取文字 → 自動拆題與分類 → 待審核/（草稿）→ 原檔移到 來源/版本/年級/ → 記錄 老師/投稿紀錄.json
 * 絕對不會寫入 題目/：草稿必須經過 /admin 人工審核才會移入。
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { extract, cropFigure, SUPPORTED_EXT } = require('./extract');
const { offlineParse } = require('./parse');
const D = require('../drafts');
const { hintsFromName, guessSubject, guessDifficulty } = require('./classify');

const toPosix = (p) => p.split(path.sep).join('/');

/** 由資料夾名稱推測科目、版本、年級，例如 待匯入/南一/國二/xxx.pdf 或 待匯入/數學/翰林/八年級/xxx.pdf */
function hintsFromPath(cfg, relDir) {
  const hints = { 科目: null, 版本: null, 年級: null };
  const subjectByName = Object.fromEntries(Object.entries(cfg.subjects).map(([k, v]) => [v, k]));
  for (const seg of relDir.split(/[\\/]/).filter((x) => x && x !== '.')) {
    if (subjectByName[seg]) hints.科目 = seg;
    else if (D.normalizeGrade(cfg, seg)) hints.年級 = D.normalizeGrade(cfg, seg);
    else if (!hints.版本) hints.版本 = seg;
  }
  return hints;
}

async function scanImportDir(cfg) {
  if (!fs.existsSync(cfg.importDir)) return [];
  const out = [];
  async function walk(dir) {
    for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || ent.name.startsWith('~')) continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(abs);
      else if (SUPPORTED_EXT.includes(path.extname(ent.name).toLowerCase())) {
        const rel = toPosix(path.relative(cfg.importDir, abs));
        out.push({ abs, rel, name: ent.name, hints: hintsFromPath(cfg, path.dirname(rel)) });
      }
    }
  }
  await walk(cfg.importDir);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}


const nonEmpty = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** 處理單一檔案，回傳摘要。失敗時原檔留在 待匯入/ 並記錄錯誤。 */
async function processFile(cfg, item, opts = {}) {
  const log = opts.log || console.log;
  const startedAt = new Date();
  const record = { 處理時間: startedAt.toISOString(), 來源檔: item.rel, 產生題數: 0, 需審核題數: 0 };
  try {
    log(`  抽取內容中…`);
    const ex = await extract(item.abs);
    log(`  抽取方式：${ex.方式}${ex.頁面.length ? `，${ex.頁面.length} 頁` : ''}${ex.內嵌圖片.length ? `，內嵌圖片 ${ex.內嵌圖片.length} 張` : ''}`);

    const hints = { ...item.hints };
    log('  依題號與選項自動拆題、分類…');
    const parsed = { 題目: [], 備註: [], 模型: 'offline-rules' };
    const r = offlineParse({ 文字: ex.文字 });
    parsed.題目.push(...r.題目);
    if (r.備註) parsed.備註.push(r.備註);

    const used = await D.collectUsedIds(cfg);
    const subjectByName = Object.fromEntries(Object.entries(cfg.subjects).map(([k, v]) => [v, k]));
    // 自動分類：資料夾 > 檔名 > 題目內容
    const fromFile = hintsFromName(cfg, item.name);
    const fromHead = hintsFromName(cfg, (ex.文字 || '').replace(/=== 第 \d+ 頁 ===/g, '').slice(0, 200)); // 考卷開頭的標題
    const fromName = Object.fromEntries(Object.keys(fromFile).map((k) => [k, fromFile[k] || fromHead[k]]));
    const allText = parsed.題目.map((q) => `${q.題幹} ${(q.選項 || []).join(' ')}`).join('\n');
    const fileSubject = (hints.科目 && subjectByName[hints.科目]) || (fromName.科目 && subjectByName[fromName.科目]) || guessSubject(cfg, allText);
    const drafts = [];
    const qs = parsed.題目;
    for (const [qi, q] of qs.entries()) {
      const key = D.newDraftKey();
      const review = new Set((q.不確定 || []).filter(Boolean));

      const subject = (q.科目代碼 && cfg.subjects[q.科目代碼] ? q.科目代碼 : null) || fileSubject || guessSubject(cfg, `${q.題幹} ${(q.選項 || []).join(' ')}`);
      const version = nonEmpty(hints.版本) || nonEmpty(fromName.版本) || nonEmpty(q.版本);
      const rawGrade = nonEmpty(hints.年級) || nonEmpty(fromName.年級) || nonEmpty(q.年級);
      const grade = D.normalizeGrade(cfg, rawGrade) || rawGrade;
      const gcode = D.gradeCode(cfg, grade);
      const id = subject && gcode ? D.allocateId(used, subject, gcode) : null;
      if (!subject) review.add('科目');
      if (!id) review.add('id');

      const options = (q.選項 || []).map((x) => String(x).trim()).filter(Boolean);
      if (options.length < 2) review.add('選項');
      const answer = Number.isInteger(q.答案) && q.答案 >= 0 && q.答案 < options.length ? q.答案 : null;
      if (answer === null) review.add('答案');

      const scope = { 版本: version, 年級: grade, 冊: nonEmpty(q.冊) || nonEmpty(fromName.冊), 章: nonEmpty(q.章), 節: nonEmpty(q.節) };
      for (const f of ['版本', '年級', '冊', '章']) if (!scope[f]) review.add(`歸屬.${f}`);
      if (grade && !gcode) review.add('歸屬.年級');
      const difficulty = [1, 2, 3].includes(q.難度) ? q.難度 : guessDifficulty({ 題幹: q.題幹, 選項: options });

      // 圖表：AI 給座標時照座標切；離線模式下「如圖」的題目，自動截取整題所在的區域
      let image = null;
      const figs = q.圖表 || [];
      try {
        let buf = null;
        if (figs.length) {
          const f = figs[0];
          if (f.來源 === '內嵌') {
            const emb = ex.內嵌圖片.find((x) => x.代號 === f.代號);
            buf = emb && (emb.png || emb.buffer);
          } else {
            const page = ex.頁面.find((p) => p.編號 === f.頁) || (ex.頁面.length === 1 ? ex.頁面[0] : null);
            if (page && [f.左, f.上, f.右, f.下].every((v) => typeof v === 'number')) buf = await cropFigure(page.png, [f.左, f.上, f.右, f.下]);
          }
          if (figs.length > 1) parsed.備註.push(`第 ${q.原題號 || '?'} 題有 ${figs.length} 張圖，只自動切出第 1 張。`);
        } else if (q.有圖) {
          const box = questionBox(ex, q, qs[qi + 1]);
          const page = box && ex.頁面.find((p) => p.編號 === box.頁);
          if (page) buf = await cropFigure(page.png, [box.左, box.上, box.右, box.下], 0.004);
          else if (ex.內嵌圖片.length) {
            // Word：依題目順序對應「[圖N]」
            const tag = String(q.題幹).match(/\[(圖\d+)\]/);
            const emb = tag && ex.內嵌圖片.find((x) => x.代號 === tag[1]);
            buf = emb && (emb.png || emb.buffer);
          }
          if (!buf) review.add('圖片');
        }
        if (buf) {
          const rel = `匯入/${key}.png`;
          await fsp.mkdir(path.join(cfg.imageDir, '匯入'), { recursive: true });
          await fsp.writeFile(path.join(cfg.imageDir, rel), buf);
          image = rel;
        }
      } catch (e) {
        review.add('圖片');
        log(`  ⚠ 第 ${q.原題號 || '?'} 題截圖失敗：${e.message}`);
      }

      drafts.push({
        草稿編號: key,
        原題號: q.原題號 || null,
        科目代碼: subject,
        id,
        題幹: String(q.題幹 || '').trim(),
        選項: options,
        答案: answer,
        答案依據: q.答案依據 || null,
        難度: difficulty,
        圖片: image,
        解析: nonEmpty(q.解析),
        歸屬: [scope],
        needs_review: review.size > 0,
        待確認欄位: [...review],
        審核: { 狀態: '待審核', 原因: null, 時間: null },
      });
    }

    // 原檔移到 來源/版本/年級/
    const pickCommon = (field) => {
      const vals = [...new Set(drafts.map((d) => d.歸屬[0][field]).filter(Boolean))];
      return vals.length === 1 ? vals[0] : null;
    };
    const destVersion = hints.版本 || pickCommon('版本') || '未分類';
    const destGrade = hints.年級 || pickCommon('年級') || '未分類';
    const destAbs = D.uniquePath(path.join(cfg.sourceDir, destVersion, destGrade, item.name));
    const destRel = toPosix(path.relative(cfg.dataDir, destAbs));

    const stem = path.basename(item.name, path.extname(item.name));
    const draftAbs = D.uniquePath(path.join(cfg.reviewDir, `${stem}.json`));
    await D.atomicWriteJson(draftAbs, {
      來源檔: item.name,
      來源位置: destRel,
      處理時間: startedAt.toISOString(),
      抽取方式: ex.方式,
      模型: parsed.模型,
      備註: parsed.備註.join('\n') || null,
      題目: drafts,
    });

    await fsp.mkdir(path.dirname(destAbs), { recursive: true });
    await fsp.rename(item.abs, destAbs).catch(async () => { // 跨磁碟時改用複製再刪除
      await fsp.copyFile(item.abs, destAbs);
      await fsp.unlink(item.abs);
    });

    Object.assign(record, {
      來源位置: destRel,
      草稿檔: toPosix(path.relative(cfg.dataDir, draftAbs)),
      抽取方式: ex.方式,
      產生題數: drafts.length,
      需審核題數: drafts.filter((d) => d.needs_review).length,
    });
    log(`  ✅ 產生 ${record.產生題數} 題草稿（需審核 ${record.需審核題數} 題）→ ${record.草稿檔}`);
    log(`     原檔已移到 ${destRel}`);
  } catch (e) {
    record.錯誤 = e.message;
    log(`  ❌ 處理失敗：${e.message}（原檔保留在 待匯入/）`);
  }
  await appendLog(cfg, record);
  return record;
}

/**
 * 找出某題「圖」在 PDF 頁面上的範圍：只留圖（含圖上的標註字），不含題幹和選項。
 * 做法：在「這題題號那一行」到「下一題」之間，找出畫出來的線條、色塊、圖片，合併後稍微留白。
 * 找不到圖形時，退回「題幹與選項之間的空白處」，再不行才截整題。
 */
function questionBox(ex, q, next) {
  if (!q.頁 || !ex.頁行) return null;
  const lines = ex.頁行[q.頁 - 1] || [];
  const norm = (t) => String(t || '').replace(/\$[^$]*\$/g, '').replace(/[\s　]/g, '').slice(0, 8);
  const key = norm(q.題幹);
  const findLine = (k, no) => lines.find((l) => {
    const t = l.文字.replace(/[\s　]/g, '');
    return (k && t.includes(k)) || (no && new RegExp(`^(\\(\\s*[A-E]?\\s*\\)|（\\s*[A-EＡ-Ｅ]?\\s*）)?${no}[.、．)]`).test(t));
  });
  const start = findLine(key, q.原題號);
  if (!start) return null;
  let end = null;
  if (next && next.頁 === q.頁) {
    const n = findLine(norm(next.題幹), next.原題號);
    if (n && n.上 > start.上) end = n.上;
  }
  const bandTop = start.上;
  const bandBottom = end != null ? end : Math.min(start.上 + 0.45, 0.97);
  const inBand = (b) => (b.上 + b.下) / 2 > bandTop && (b.上 + b.下) / 2 < bandBottom;
  const pad = 0.012;
  const clamp = (b) => ({ 頁: q.頁, 左: Math.max(0, b.左 - pad), 右: Math.min(1, b.右 + pad), 上: Math.max(0, b.上 - pad), 下: Math.min(1, b.下 + pad) });

  // 1. 用畫出來的圖形定位
  const gs = ((ex.頁圖形 || [])[q.頁 - 1] || []).filter(inBand);
  if (gs.length) {
    const u = gs.reduce((a, g) => ({ 左: Math.min(a.左, g.左), 右: Math.max(a.右, g.右), 上: Math.min(a.上, g.上), 下: Math.max(a.下, g.下) }));
    // 把貼在圖旁邊的短標註（A、B、6 cm…）也包進來
    const near = 0.025;
    // 題幹（從左邊界開始的行）不算標註
    const isStem = (l) => l === start || (l.左 != null && start.左 != null && Math.abs(l.左 - start.左) < 0.006 && l.上 < u.上);
    for (const l of lines) {
      if (l.左 == null || !inBand(l) || isStem(l) || l.文字.replace(/\s/g, '').length > 12) continue;
      if (l.右 < u.左 - near || l.左 > u.右 + near || l.下 < u.上 - near || l.上 > u.下 + near) continue;
      u.左 = Math.min(u.左, l.左); u.右 = Math.max(u.右, l.右); u.上 = Math.min(u.上, l.上); u.下 = Math.max(u.下, l.下);
    }
    // 上緣不可蓋到圖上方的題幹
    const stemBottom = Math.max(0, ...lines.filter((l) => inBand(l) && isStem(l) && l.下 != null && l.下 <= u.上 + 0.005).map((l) => l.下));
    if (u.右 - u.左 > 0.03 && u.下 - u.上 > 0.02) {
      const c = clamp(u);
      c.上 = Math.max(c.上, stemBottom + 0.002);
      return c;
    }
  }

  // 2. 沒有可辨識的圖形（例如掃描檔）：取題幹最後一行與選項第一行之間的空白
  const body = lines.filter((l) => l.上 >= bandTop && l.上 < bandBottom).sort((x, y) => x.上 - y.上);
  const opt = body.find((l) => /^[（(]\s*[A-DＡ-Ｄ]\s*[)）]|^[A-D][.．、]|^[①②③④]/.test(l.文字.trim()));
  const stem = body.filter((l) => !opt || l.上 < opt.上);
  let gapTop = bandTop;
  let gapBottom = opt ? opt.上 : bandBottom;
  for (let i = 0; i < stem.length; i++) {
    const below = i + 1 < stem.length ? stem[i + 1].上 : gapBottom;
    const bottom = stem[i].下 != null ? stem[i].下 : stem[i].上 + 0.02;
    if (below - bottom > 0.05) { gapTop = bottom; gapBottom = below; break; }
  }
  if (gapBottom - gapTop > 0.05 && gapTop > bandTop) return { 頁: q.頁, 左: 0.03, 右: 0.97, 上: gapTop, 下: Math.min(1, gapBottom) };

  // 3. 最後才截整題
  const top = Math.max(0, bandTop - 0.006);
  const bottom = Math.min(1, end != null ? end - 0.01 : bandBottom);
  return bottom - top > 0.02 ? { 頁: q.頁, 左: 0.03, 右: 0.97, 上: top, 下: bottom } : null;
}

async function appendLog(cfg, record) {
  const file = path.join(cfg.teacherDir, '投稿紀錄.json');
  let list = [];
  try { list = JSON.parse(await fsp.readFile(file, 'utf8')); } catch { /* 第一次建立 */ }
  if (!Array.isArray(list)) list = [];
  list.push(record);
  await D.atomicWriteJson(file, list);
}

module.exports = { scanImportDir, processFile, hintsFromPath };
