'use strict';
/**
 * 待審核草稿與題號分配。
 * 草稿檔：待審核/<來源檔名>.json
 * { 來源檔, 來源位置, 處理時間, 抽取方式, 模型, 備註, 題目: [草稿題目] }
 * 草稿題目＝題目格式欄位 + 草稿編號、原題號、needs_review、待確認欄位、審核
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { listJsonFiles } = require('./loader');
const { parseId } = require('./schema');

const GRADE_ALIASES = {
  一年級: '小一', 二年級: '小二', 三年級: '小三', 四年級: '小四', 五年級: '小五', 六年級: '小六',
  七年級: '國一', 八年級: '國二', 九年級: '國三', 十年級: '高一', 十一年級: '高二', 十二年級: '高三',
  國中一年級: '國一', 國中二年級: '國二', 國中三年級: '國三', 高中一年級: '高一', 高中二年級: '高二', 高中三年級: '高三',
};

/** 年級文字 → config 中的年級名稱（例如「八年級」→「國二」），無法對應回傳 null */
function normalizeGrade(cfg, text) {
  if (!text) return null;
  const t = String(text).trim();
  const names = Object.values(cfg.grades);
  if (names.includes(t)) return t;
  if (GRADE_ALIASES[t] && names.includes(GRADE_ALIASES[t])) return GRADE_ALIASES[t];
  return null;
}

function gradeCode(cfg, gradeName) {
  const hit = Object.entries(cfg.grades).find(([, v]) => v === gradeName);
  return hit ? hit[0] : null;
}

function subjectFolder(cfg, code) {
  return cfg.subjects[code] || code;
}

function newDraftKey() {
  return 'd' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

async function atomicWriteJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await fsp.rename(tmp, file);
}

/** 收集題目/ 與 待審核/ 中所有已使用的 ID（用文字掃描，壞掉的 JSON 也能掃到） */
async function collectUsedIds(cfg, { includeDrafts = true } = {}) {
  const used = new Set();
  const dirs = includeDrafts ? [cfg.questionDir, cfg.reviewDir] : [cfg.questionDir];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of await listJsonFiles(dir)) {
      const text = await fsp.readFile(f.abs, 'utf8').catch(() => '');
      for (const m of text.matchAll(/"id"\s*:\s*"([^"]+)"/g)) used.add(m[1]);
    }
  }
  return used;
}

/** 依「科目-年級-流水號」分配下一個未使用的 ID */
function allocateId(used, subject, grade) {
  const prefix = `${subject}-${grade}-`;
  let max = 0;
  for (const id of used) {
    const p = parseId(id);
    if (p && p.subject === subject && p.grade === grade) max = Math.max(max, Number(p.serial));
  }
  const id = prefix + String(max + 1).padStart(4, '0');
  used.add(id);
  return id;
}

/** 避免覆蓋：檔名已存在就加 (2)、(3)… */
function uniquePath(file) {
  if (!fs.existsSync(file)) return file;
  const ext = path.extname(file);
  const base = file.slice(0, -ext.length);
  for (let i = 2; ; i++) {
    const p = `${base}(${i})${ext}`;
    if (!fs.existsSync(p)) return p;
  }
}

async function readDraftFiles(cfg) {
  if (!fs.existsSync(cfg.reviewDir)) return [];
  const out = [];
  for (const f of await listJsonFiles(cfg.reviewDir)) {
    try {
      const data = JSON.parse((await fsp.readFile(f.abs, 'utf8')).replace(/^﻿/, ''));
      out.push({ file: f.rel, abs: f.abs, data });
    } catch (e) {
      out.push({ file: f.rel, abs: f.abs, error: e.message });
    }
  }
  return out;
}

module.exports = {
  normalizeGrade, gradeCode, subjectFolder, newDraftKey, atomicWriteJson,
  collectUsedIds, allocateId, uniquePath, readDraftFiles,
};
