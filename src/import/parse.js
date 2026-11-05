'use strict';
/**
 * 離線模式（不需要金鑰、免費）：用規則解析「有文字」的考卷（PDF 文字層、Word、貼上的文字）。
 * 支援常見寫法：
 *   題號：1.　1、　1)　（ ）1.　( B )1.（教用版題號前的括號答案）
 *   選項：(A)…(B)…　（Ａ）…　Ａ．…　①②③④
 *   答案：題號前括號、「答：B」「答案：(B)」、卷末「答案 1.B 2.(C) …」或「1~5 BCADB」
 *   解析：「解析：…」「【解析】…」
 * 數學符號（√、x²）會轉成 KaTeX 用的 $...$。
 */
const FW = { '（': '(', '）': ')', '．': '.', '：': ':', 'Ａ': 'A', 'Ｂ': 'B', 'Ｃ': 'C', 'Ｄ': 'D', 'Ｅ': 'E', 'ａ': 'A', 'ｂ': 'B', 'ｃ': 'C', 'ｄ': 'D' };
const CIRCLED = { '①': 'A', '②': 'B', '③': 'C', '④': 'D', '⑤': 'E' };

function normalizeText(t) {
  return t
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0))
    .replace(/[（）．：ＡＢＣＤＥａｂｃｄ]/g, (c) => FW[c] || c)
    .replace(/\r/g, '')
    .replace(/　/g, ' ');
}

/** 把常見的數學符號轉成 KaTeX：√12 → $\sqrt{12}$、x² → $x^{2}$ */
const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', 'ⁿ': 'n', '⁻': '-' };
function toLatexLite(t) {
  if (!t || t.includes('$')) return t; // 已經有 $ 的不動
  return t
    .replace(/√\s*\(([^()]{1,20})\)/g, (m, x) => '$\\sqrt{' + x.trim() + '}$')
    .replace(/(\d*)√\s*([0-9A-Za-z]+)/g, (m, k, x) => '$' + k + '\\sqrt{' + x + '}$')
    .replace(/([0-9A-Za-z)])([⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ⁻]+)/g, (m, b, sup) => '$' + b + '^{' + [...sup].map((c) => SUP[c]).join('') + '}$')
    .replace(/\$\s*\$/g, ' ');
}

const LETTER_RE = /\(\s*([A-E])\s*\)|[①②③④⑤]|(?:^|\s)([A-E])\s*[.、]\s/g;

/** 在一段文字中找出選項（必須從 A 開始依序出現） */
function splitOptions(rest) {
  const marks = [];
  for (const m of rest.matchAll(LETTER_RE)) {
    const L = m[1] || m[2] || CIRCLED[m[0]];
    marks.push({ L, at: m.index, end: m.index + m[0].length });
  }
  for (let i = 0; i < marks.length; i++) {
    if (marks[i].L !== 'A') continue;
    const seq = [marks[i]];
    for (let j = i + 1; j < marks.length && seq.length < 5; j++) {
      if (marks[j].L === 'ABCDE'[seq.length]) seq.push(marks[j]);
    }
    if (seq.length >= 2) {
      const opts = seq.map((mk, k) => rest.slice(mk.end, k + 1 < seq.length ? seq[k + 1].at : undefined).replace(/\s+/g, ' ').trim());
      return { stem: rest.slice(0, seq[0].at), opts };
    }
  }
  return null;
}

function parseAnswerKey(text) {
  const map = {};
  for (const m of text.matchAll(/(\d{1,3})\s*[~～\-－]\s*(\d{1,3})\s*[:.、]?\s*((?:[A-E]\s*){2,})/g)) {
    const from = Number(m[1]);
    [...m[3].replace(/\s/g, '')].forEach((L, k) => { map[from + k] = 'ABCDE'.indexOf(L); });
  }
  for (const m of text.matchAll(/(\d{1,3})\s*[.、:)]?\s*\(?\s*([A-E])\s*\)?(?![A-Za-z])/g)) {
    if (!(m[1] in map)) map[m[1]] = 'ABCDE'.indexOf(m[2]);
  }
  return map;
}

function offlineParse(chunk) {
  const out = { 題目: [], 備註: '離線模式（不需金鑰）：依考卷文字格式自動拆題，請在審核頁仔細確認。', 模型: 'offline-rules' };
  if (!chunk.文字 || !chunk.文字.trim()) {
    throw new Error('這個檔案讀不到文字（可能是掃描檔或照片）。不用金鑰的話，請改用 Word 檔、有文字的 PDF，或在「匯入考卷」頁用「貼上題目文字」');
  }
  // 頁碼標記換成等長空白，位置不變，之後才知道每題在第幾頁
  let text = normalizeText(chunk.文字);
  const pageMarks = [...text.matchAll(/=== 第 (\d+) 頁 ===/g)].map((m) => ({ at: m.index, page: Number(m[1]) }));
  text = text.replace(/=== 第 \d+ 頁 ===/g, (m) => '\n' + ' '.repeat(m.length - 1));
  const pageAt = (i) => { let p = null; for (const pm of pageMarks) if (pm.at <= i) p = pm.page; return p; };

  // 卷末答案區
  let key = {};
  const keyAt = text.search(/\n\s*【?(?:參考)?(?:答案|解答)】?\s*:?\s*(?:\n|(?=\d))/);
  if (keyAt > 0) {
    key = parseAnswerKey(text.slice(keyAt));
    text = text.slice(0, keyAt);
  }

  // 章節標題：「第二章 一元二次方程式」「第3課」「1-2 乘法公式」
  const heads = [];
  for (const h of text.matchAll(/(?:^|\n)[ \t]*(第\s*[一二三四五六七八九十\d]+\s*[章單元課])[ \t]*([^\n]{0,24})/g)) {
    heads.push({ at: h.index, 章: `${h[1].replace(/\s/g, '')} ${h[2].replace(/[(（]\s*[)）]|\s+$/g, '').trim()}`.trim(), 節: null });
  }
  for (const h of text.matchAll(/(?:^|\n)[ \t]*(\d{1,2})\s*[-–－]\s*(\d{1,2})[ \t]+([^\n\d(]{1,24})/g)) {
    heads.push({ at: h.index, 章: `第${h[1]}章`, 節: `${h[1]}-${h[2]} ${h[3].trim()}` });
  }
  heads.sort((a, b) => a.at - b.at);
  const headAt = (i) => { let r = null; for (const h of heads) if (h.at <= i) r = h; return r; };

  // 依題號切題：行首（可有「( B )」答案括號）＋ 數字 ＋ . 、 )
  const START = /(?:^|\n)[ \t]*(?:\(\s*([A-E]?)\s*\)\s*)?(\d{1,3})\s*[.、)](?!\d)\s*/g;
  const starts = [...text.matchAll(START)];
  let skipped = 0;
  starts.forEach((m, i) => {
    const no = m[2];
    let rest = text.slice(m.index + m[0].length, i + 1 < starts.length ? starts[i + 1].index : undefined);
    let inlineAns = m[1] ? 'ABCDE'.indexOf(m[1]) : null;
    let explain = null;
    const ex = rest.match(/(?:【解析】|解析\s*:)([\s\S]*)$/);
    if (ex) { explain = ex[1].replace(/\s+/g, ' ').trim() || null; rest = rest.slice(0, ex.index); }
    const an = rest.match(/(?:【答案】|答案?\s*:)\s*(?:\(\s*([A-E])\s*\)|([A-E])|([①②③④⑤]))/);
    if (an) {
      inlineAns = 'ABCDE'.indexOf(an[1] || an[2] || CIRCLED[an[3]]);
      rest = rest.slice(0, an.index) + rest.slice(an.index + an[0].length);
    }
    const sp = splitOptions(rest);
    if (!sp) { skipped++; return; }
    const stem = sp.stem.split('\n').filter((l) => !/^[A-Za-z0-9 ]{1,6}$/.test(l.trim())).join(' ').replace(/\s+/g, ' ').trim();
    if (!stem) { skipped++; return; }
    const ans = inlineAns != null && inlineAns >= 0 ? inlineAns : (no in key ? key[no] : null);
    const hasFig = /如[右左上下]?圖|如圖|附圖|下圖|右表|下表/.test(stem);
    const head = headAt(m.index);
    out.題目.push({
      原題號: no, 科目代碼: null, 頁: pageAt(m.index), 下一題頁: i + 1 < starts.length ? pageAt(starts[i + 1].index) : null,
      題幹: toLatexLite(stem),
      選項: sp.opts.map(toLatexLite),
      答案: ans != null && ans < sp.opts.length ? ans : null,
      答案依據: ans != null ? (inlineAns != null ? '考卷上標示的答案' : '卷末參考答案') : null,
      難度: null, 解析: explain ? toLatexLite(explain) : null,
      版本: null, 年級: null, 冊: null, 章: head ? head.章 : null, 節: head ? head.節 : null,
      圖表: [], 有圖: hasFig, 不確定: [],
    });
  });
  if (skipped) out.備註 += ` 有 ${skipped} 段沒有找到 (A)(B)(C)(D) 選項，可能是填充或問答題，已略過。`;
  if (!out.題目.length) out.備註 += ' 沒有拆出任何選擇題：請確認題目格式是「1. 題目 (A)… (B)… (C)… (D)…」。';
  return out;
}

module.exports = { offlineParse, toLatexLite };
