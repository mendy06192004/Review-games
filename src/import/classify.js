'use strict';
/**
 * 不用 AI 的自動分類：從檔名、資料夾與題目文字推斷科目、年級、冊、版本、難度，
 * 讓老師審核時只需要確認，不必每題手動填。
 */

const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const cnNum = (n) => CN[n] || String(n);

const SUBJECT_WORDS = {
  國文: /國文|國語/,
  英文: /英文|英語|English/i,
  數學: /數學/,
  自然: /自然|理化|生物|地科|地球科學|物理|化學/,
  社會: /社會|歷史|地理|公民/,
};
const VERSIONS = /南一|翰林|康軒|部編|龍騰|三民|全華|奇鼎|育達/;

/** 從檔名推斷：科目、版本、年級、冊（例如「00數學2上隨堂卷_南一.pdf」→ 數學、南一、國二、第三冊） */
function hintsFromName(cfg, name) {
  const out = { 科目: null, 版本: null, 年級: null, 冊: null };
  for (const [subj, re] of Object.entries(SUBJECT_WORDS)) {
    if (re.test(name) && Object.values(cfg.subjects).includes(subj)) { out.科目 = subj; break; }
  }
  const v = name.match(VERSIONS);
  if (v) out.版本 = v[0];
  const gradeName = (prefix, n) => {
    const code = `${prefix}${n}`;
    return cfg.grades[code] || null;
  };
  let g = null;
  let half = null;
  let m;
  if ((m = name.match(/國\s*([一二三])\s*([上下])?/))) { g = gradeName('N', '一二三'.indexOf(m[1]) + 1); half = m[2] || null; }
  else if ((m = name.match(/([七八九])\s*年級\s*([上下])?/))) { g = gradeName('N', '七八九'.indexOf(m[1]) + 1); half = m[2] || null; }
  else if ((m = name.match(/高\s*([一二三])\s*([上下])?/))) { g = gradeName('H', '一二三'.indexOf(m[1]) + 1); half = m[2] || null; }
  else if ((m = name.match(/小\s*([一二三四五六])\s*([上下])?/))) { g = gradeName('P', '一二三四五六'.indexOf(m[1]) + 1); half = m[2] || null; }
  else if ((m = name.match(/(?:^|[^\d])([1-3])\s*([上下])/))) { g = gradeName('N', Number(m[1])); half = m[2]; } // 國中最常見：2上、3下
  if (g) out.年級 = g;
  const vol = name.match(/第\s*([一二三四五六]|\d)\s*冊/);
  if (vol) out.冊 = `第${/\d/.test(vol[1]) ? cnNum(Number(vol[1])) : vol[1]}冊`;
  else if (g && half) {
    const code = Object.keys(cfg.grades).find((k) => cfg.grades[k] === g) || '';
    const n = Number(code.slice(1)) || 1;
    out.冊 = `第${cnNum((n - 1) * 2 + (half === '上' ? 1 : 2))}冊`;
  }
  return out;
}

const KEYWORDS = {
  M: /方程式|因式|多項式|函數|三角形|四邊形|面積|周長|機率|平方根|根號|座標|比例|等差|等比|圓心|弧長|最大公因數|最小公倍數|質數|不等式|\$[^$]*[=+\-^\\][^$]*\$/g,
  B: /細胞|植物|動物|光合作用|生物|器官|遺傳|演化|生態|溶液|電流|電壓|密度|化學|元素|原子|分子|酸鹼|氧化|速度|加速度|力矩|透鏡|光線|聲音|地球|岩石|天氣|星球|能量/g,
  S: /朝代|皇帝|政府|憲法|法律|經濟|地理|氣候|人口|文化|宗教|戰爭|條約|民主|選舉|貿易|河流|地形|緯度|歷史|社會|權利|義務/g,
  C: /成語|詩|詞|修辭|文言|白話|字音|字形|部首|作者|課文|句子|形容|比喻|語氣|「[^」]{1,8}」的意思/g,
};
const CODE = { 國文: 'C', 英文: 'E', 數學: 'M', 自然: 'B', 社會: 'S' };

/** 從題目文字推斷科目代碼（找不到回傳 null） */
function guessSubject(cfg, text) {
  if (!text) return null;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  const cjk = (text.match(/[一-鿿]/g) || []).length;
  if (letters > 40 && letters > cjk * 1.5 && cfg.subjects.E) return 'E';
  let best = null;
  let bestN = 0;
  for (const [code, re] of Object.entries(KEYWORDS)) {
    if (!cfg.subjects[code]) continue;
    const n = (text.match(re) || []).length;
    if (n > bestN) { best = code; bestN = n; }
  }
  return bestN >= 2 ? best : null;
}

/** 難度估計：1 基礎、2 中等、3 進階 */
function guessDifficulty(q) {
  const stem = String(q.題幹 || '');
  const optLen = (q.選項 || []).join('').length;
  const len = stem.replace(/\$[^$]*\$/g, 'x').length;
  let score = 0;
  if (len > 70) score++;
  if (len > 130) score++;
  if (optLen > 80) score++;
  if (/如[右左上下]?圖|附圖|下圖|下表|右表|甲、乙|何者正確|何者錯誤|何者不/.test(stem)) score++;
  if (/\$[^$]*(\\frac|\\sqrt|\^)[^$]*\$/.test(stem)) score++;
  return score >= 3 ? 3 : score >= 1 ? 2 : 1;
}

module.exports = { hintsFromName, guessSubject, guessDifficulty, CODE, cnNum };
