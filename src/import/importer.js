'use strict';
/**
 * 題目匯入流程：待匯入/ → 抽取 → Claude 整理 → 待審核/（草稿）→ 原檔移到 來源/版本/年級/ → 記錄 老師/投稿紀錄.json
 * 絕對不會寫入 題目/：草稿必須經過 /admin 人工審核才會移入。
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { extract, cropFigure, SUPPORTED_EXT } = require('./extract');
const { callClaude, offlineParse } = require('./claude');
const D = require('../drafts');

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

function chunksOf(ex, item, size) {
  const base = { 檔名: item.name, 方式: ex.方式 };
  if (!ex.頁面.length || ex.頁面.length <= size) return [{ ...base, 文字: ex.文字, 頁面: ex.頁面, 內嵌圖片: ex.內嵌圖片 }];
  const chunks = [];
  for (let i = 0; i < ex.頁面.length; i += size) {
    const pages = ex.頁面.slice(i, i + size);
    const text = (ex.頁文字 || []).slice(i, i + size).map((t, k) => (t ? `=== 第 ${i + k + 1} 頁 ===\n${t}` : '')).filter(Boolean).join('\n\n');
    chunks.push({ ...base, 文字: text, 頁面: pages, 內嵌圖片: [] });
  }
  return chunks;
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
    const claudeHints = { 科目: hints.科目, 版本: hints.版本, 年級: hints.年級 };
    const parsed = { 題目: [], 備註: [], 模型: null };
    const chunks = chunksOf(ex, item, cfg.claude.pagesPerRequest || 6);
    for (const [i, chunk] of chunks.entries()) {
      log(`  ${opts.offline ? '離線規則解析' : '交給 Claude 整理'}${chunks.length > 1 ? `（第 ${i + 1}/${chunks.length} 段）` : ''}…`);
      const r = opts.offline
        ? offlineParse(chunk, claudeHints)
        : await (opts.callClaude || callClaude)(chunk, claudeHints, cfg.claude);
      parsed.題目.push(...(r.題目 || []));
      if (r.備註) parsed.備註.push(r.備註);
      parsed.模型 = r.模型 || parsed.模型;
    }

    const used = await D.collectUsedIds(cfg);
    const subjectByName = Object.fromEntries(Object.entries(cfg.subjects).map(([k, v]) => [v, k]));
    const drafts = [];
    for (const q of parsed.題目) {
      const key = D.newDraftKey();
      const review = new Set((q.不確定 || []).filter(Boolean));

      const subject = q.科目代碼 && cfg.subjects[q.科目代碼] ? q.科目代碼 : (hints.科目 ? subjectByName[hints.科目] : null);
      const version = nonEmpty(hints.版本) || nonEmpty(q.版本);
      const rawGrade = nonEmpty(hints.年級) || nonEmpty(q.年級);
      const grade = D.normalizeGrade(cfg, rawGrade) || rawGrade;
      const gcode = D.gradeCode(cfg, grade);
      const id = subject && gcode ? D.allocateId(used, subject, gcode) : null;
      if (!subject) review.add('科目');
      if (!id) review.add('id');

      const options = (q.選項 || []).map((s) => String(s).trim()).filter(Boolean);
      if (options.length < 2) review.add('選項');
      let answer = Number.isInteger(q.答案) && q.答案 >= 0 && q.答案 < options.length ? q.答案 : null;
      if (answer === null) review.add('答案');

      const scope = { 版本: version, 年級: grade, 冊: nonEmpty(q.冊), 章: nonEmpty(q.章), 節: nonEmpty(q.節) };
      for (const f of ['版本', '年級', '冊', '章']) if (!scope[f]) review.add(`歸屬.${f}`);
      if (grade && !gcode) review.add('歸屬.年級');
      const difficulty = [1, 2, 3].includes(q.難度) ? q.難度 : null;
      if (difficulty === null) review.add('難度');

      // 圖表：切圖存入 圖片/匯入/
      let image = null;
      const figs = q.圖表 || [];
      if (figs.length) {
        review.add('圖片');
        const f = figs[0];
        try {
          let buf = null;
          if (f.來源 === '內嵌') {
            const emb = ex.內嵌圖片.find((x) => x.代號 === f.代號);
            buf = emb && (emb.png || emb.buffer);
          } else {
            const page = ex.頁面.find((p) => p.編號 === f.頁) || (ex.頁面.length === 1 ? ex.頁面[0] : null);
            if (page && [f.左, f.上, f.右, f.下].every((v) => typeof v === 'number')) {
              buf = await cropFigure(page.png, [f.左, f.上, f.右, f.下]);
            }
          }
          if (buf) {
            const rel = `匯入/${key}.png`;
            await fsp.mkdir(path.join(cfg.imageDir, '匯入'), { recursive: true });
            await fsp.writeFile(path.join(cfg.imageDir, rel), buf);
            image = rel;
          }
        } catch (e) {
          log(`  ⚠ 第 ${q.原題號 || '?'} 題切圖失敗：${e.message}`);
        }
        if (figs.length > 1) parsed.備註.push(`第 ${q.原題號 || '?'} 題有 ${figs.length} 張圖，只自動切出第 1 張。`);
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
    if (e.code === '金鑰') record.錯誤代碼 = '金鑰';
    log(`  ❌ 處理失敗：${e.message}（原檔保留在 待匯入/）`);
  }
  await appendLog(cfg, record);
  return record;
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
