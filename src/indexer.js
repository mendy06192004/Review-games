'use strict';
/**
 * 題目索引：版本 → 年級 → 冊 → 章（→ 節）樹狀結構，每個節點記錄其下所有題目 ID。
 *
 * 每次 API 請求前呼叫 ensureIndex()：
 *   1. 掃描題目資料夾，以「檔名 + 大小 + 修改時間」計算指紋
 *   2. 讀取磁碟上的 索引/題目索引.json，若指紋相同就直接使用
 *   3. 指紋不同（新增 / 修改 / 刪除檔案）或索引不存在 / 損毀 → 重建並寫回
 */
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { listJsonFiles, loadAndValidate, formatIssue } = require('./loader');
const { parseId, scopeLevels } = require('./schema');
const { naturalCompare } = require('./util');

const INDEX_FORMAT = 1;

async function computeFingerprint(cfg) {
  const files = await listJsonFiles(cfg.questionDir);
  const h = crypto.createHash('sha1');
  // 科目 / 年級代碼設定會影響驗證結果，也納入指紋
  h.update(JSON.stringify({ f: INDEX_FORMAT, s: cfg.subjects, g: cfg.grades }));
  for (const f of files) h.update(`\n${f.rel}\t${f.size}\t${f.mtimeMs}`);
  return { hash: h.digest('hex'), files };
}

function buildTree(valid) {
  const root = new Map();
  for (const { q } of valid) {
    for (const a of q.歸屬) {
      let children = root;
      const pathParts = [];
      for (const [level, name] of scopeLevels(a)) {
        pathParts.push(name);
        let node = children.get(name);
        if (!node) {
          node = { 名稱: name, 層級: level, 路徑: pathParts.join('/'), 題目ID: new Set(), 子層: new Map() };
          children.set(name, node);
        }
        node.題目ID.add(q.id);
        children = node.子層;
      }
    }
  }
  const finalize = (map) =>
    [...map.values()]
      .sort((x, y) => naturalCompare(x.名稱, y.名稱))
      .map((n) => ({
        名稱: n.名稱,
        層級: n.層級,
        路徑: n.路徑,
        題目ID: [...n.題目ID].sort(),
        子層: finalize(n.子層),
      }));
  return finalize(root);
}

async function buildIndex(cfg, fp) {
  fp = fp || (await computeFingerprint(cfg));
  const { valid, issues } = await loadAndValidate(cfg, { files: fp.files });

  const positions = {};
  for (const { q, file, index } of valid) {
    positions[q.id] = { 檔案: file, 序號: index, 科目: parseId(q.id).subject, 難度: q.難度 };
  }

  const index = {
    格式版本: INDEX_FORMAT,
    產生時間: new Date().toISOString(),
    指紋: fp.hash,
    檔案數: fp.files.length,
    題目總數: valid.length,
    錯誤數: issues.filter((i) => i.level === 'error').length,
    警告數: issues.filter((i) => i.level === 'warning').length,
    樹: buildTree(valid),
    題目位置: positions,
    問題: issues.map(formatIssue),
  };

  // 原子寫入：先寫暫存檔再改名，避免其他請求讀到寫一半的索引
  try {
    await fsp.mkdir(path.dirname(cfg.indexFile), { recursive: true });
    const tmp = `${cfg.indexFile}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(index, null, 2), 'utf8');
    await fsp.rename(tmp, cfg.indexFile);
  } catch (e) {
    console.warn(`[索引] 無法寫入 ${cfg.indexFile}（仍可正常出題）：${e.message}`);
  }

  if (cfg.onRebuild) cfg.onRebuild(index);
  return index;
}

async function readIndexFile(cfg) {
  try {
    const idx = JSON.parse(await fsp.readFile(cfg.indexFile, 'utf8'));
    return idx && idx.格式版本 === INDEX_FORMAT ? idx : null;
  } catch {
    return null; // 不存在或損毀 → 重建
  }
}

// 同一份索引、同一個指紋只重建一次（多個請求同時進來時共用結果）
const inflight = new Map();

async function ensureIndex(cfg) {
  const fp = await computeFingerprint(cfg);
  const onDisk = await readIndexFile(cfg);
  if (onDisk && onDisk.指紋 === fp.hash) return onDisk;

  const key = `${cfg.indexFile}|${fp.hash}`;
  if (!inflight.has(key)) {
    inflight.set(key, buildIndex(cfg, fp).finally(() => inflight.delete(key)));
  }
  return inflight.get(key);
}

/** 建立「範圍路徑 → 節點」查詢表 */
function nodeMap(tree) {
  const map = new Map();
  const walk = (nodes) => nodes.forEach((n) => { map.set(n.路徑, n); walk(n.子層); });
  walk(tree);
  return map;
}

module.exports = { computeFingerprint, buildIndex, ensureIndex, nodeMap, INDEX_FORMAT };
