'use strict';
/**
 * 把抽取出的內容交給 Claude，整理成題目草稿（結構化 JSON）。
 * API 金鑰從環境變數 ANTHROPIC_API_KEY 讀取（SDK 預設行為），程式中不存放金鑰。
 */

const nul = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const STR = { type: 'string' };

/** Claude 回傳格式（JSON Schema；所有物件 additionalProperties:false、欄位全部必填，不確定的用 null） */
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['題目', '備註'],
  properties: {
    題目: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['原題號', '科目代碼', '題幹', '選項', '答案', '答案依據', '難度', '解析', '版本', '年級', '冊', '章', '節', '圖表', '不確定'],
        properties: {
          原題號: nul(STR),
          科目代碼: nul({ type: 'string', enum: ['C', 'E', 'M', 'B', 'S'] }),
          題幹: STR,
          選項: { type: 'array', items: STR },
          答案: nul({ type: 'integer' }),
          答案依據: nul(STR),
          難度: nul({ type: 'integer', enum: [1, 2, 3] }),
          解析: nul(STR),
          版本: nul(STR),
          年級: nul(STR),
          冊: nul(STR),
          章: nul(STR),
          節: nul(STR),
          圖表: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['來源', '頁', '左', '上', '右', '下', '代號'],
              properties: {
                來源: { type: 'string', enum: ['頁面', '內嵌'] },
                頁: nul({ type: 'integer' }),
                左: nul({ type: 'number' }),
                上: nul({ type: 'number' }),
                右: nul({ type: 'number' }),
                下: nul({ type: 'number' }),
                代號: nul(STR),
              },
            },
          },
          不確定: { type: 'array', items: STR },
        },
      },
    },
    備註: nul(STR),
  },
};

const SYSTEM_PROMPT = `你是台灣國中小「國文、英文、數學、自然、社會」題庫的整理助手。老師上傳了考卷或講義，請把其中的「選擇題」逐題整理成結構化資料，交給老師人工審核。

原則（非常重要）：
1. 只整理文件中真的存在的題目，題幹與選項照原文謄寫，不要改寫、不要自己出題。非選擇題（填充、計算、問答）略過，並在「備註」說明略過了哪些。
2. 不確定就填 null，不要猜：
   - 答案：只有在文件明確提供（答案欄、解答頁、標示正解）時才填，填「選項索引」（第一個選項是 0），並在「答案依據」寫出根據（例如「考卷末參考答案：3.(A)」）。文件沒給答案就填 null，即使你會算也不要填。
   - 版本、年級、冊、章、節：只有文件標題、頁首或老師提供的資訊明確寫出時才填，否則 null。
   - 難度：文件沒有標示就填 null。
   - 解析：文件有附解析才填，否則 null。
3. 選項不要包含 (A)(B)、①② 等編號，只保留內容。數學式、化學式、分數、根號、次方等請用 LaTeX 並以 $ 包住（例如 $\\frac{1}{2}$、$x^{2}+3x$、$\\sqrt{12}$、$\\mathrm{H_2O}$），平台會用 KaTeX 顯示；一般文字不要用 $。
4. 題目若有圖、表、幾何圖形：在「圖表」列出位置。
   - 來自頁面圖片：來源="頁面"，頁=頁碼，左/上/右/下=該圖在頁面中的比例座標（0~1，左上角為 0,0），範圍只包住圖本身、不要包含題幹文字。
   - 來自 Word 內嵌圖片：來源="內嵌"，代號填文中標示的 [圖N]。
5. 任何你沒把握的欄位，把欄位名稱放進「不確定」（例如 ["答案","章"]）。掃描品質差、字跡難辨的地方也要列出。
6. 科目代碼：國文 C、英文 E、數學 M、自然 B、社會 S；無法判斷填 null。`;

function buildUserContent(chunk, hints) {
  const content = [];
  for (const p of chunk.頁面) {
    content.push({ type: 'text', text: `【第 ${p.編號} 頁頁面圖】` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: p.png.toString('base64') } });
  }
  for (const img of chunk.內嵌圖片) {
    if (!img.png) continue;
    content.push({ type: 'text', text: `【內嵌圖片 ${img.代號}】` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: img.png.toString('base64') } });
  }
  const hintLines = Object.entries(hints).filter(([, v]) => v).map(([k, v]) => `- ${k}：${v}`);
  let text = `來源檔名：${chunk.檔名}\n抽取方式：${chunk.方式}`;
  if (hintLines.length) text += `\n老師放置檔案的資料夾指出（可視為確定資訊）：\n${hintLines.join('\n')}`;
  if (chunk.文字) {
    text += `\n\n以下是程式從檔案抽出的文字（文字層或 Word 內文；排版可能亂掉，請對照頁面圖）：\n<抽取文字>\n${chunk.文字}\n</抽取文字>`;
  } else if (chunk.頁面.length) {
    text += '\n\n此檔沒有文字層（掃描檔或照片），請直接從頁面圖辨識文字（OCR）。';
  }
  text += '\n\n請依規則整理所有選擇題。';
  content.push({ type: 'text', text });
  return content;
}

/**
 * 把 Claude API 的錯誤翻成老師看得懂的中文。金鑰相關錯誤會標記 code='金鑰'，
 * 讓批次匯入停下來（後面的檔案也一定會失敗，不必浪費時間）。
 */
function explainApiError(e) {
  const status = e && e.status;
  const raw = String((e && e.message) || e);
  const fail = (msg, code) => Object.assign(new Error(msg), { code, status });
  if (status === 401) return fail('Claude API 金鑰無效（可能貼錯、少複製幾個字，或金鑰已被刪除）。請到「匯入考卷」頁按「更換金鑰」，貼上正確的金鑰。', '金鑰');
  if (status === 403) return fail('這把金鑰沒有使用權限（帳戶可能被停用）。請到 console.anthropic.com 確認帳戶狀態。', '金鑰');
  if (/credit balance|billing|purchase credits/i.test(raw)) return fail('Claude 帳戶額度不足。請到 console.anthropic.com 的 Billing 頁面儲值後再試。', '金鑰');
  if (status === 429) return fail('Claude 使用量達到上限，請過幾分鐘再重試。');
  if (status === 529 || status === 503) return fail('Claude 目前太忙碌，請過幾分鐘再重試。');
  if (status === 413) return fail('檔案內容太大，請把考卷拆成較少頁數的檔案再匯入。');
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|Connection error/i.test(raw)) return fail('連不上 Claude 伺服器，請確認電腦有連上網路（學校網路可能擋住 api.anthropic.com）。');
  return e;
}

/** 檢查金鑰是否可用（列出模型清單，不會產生費用） */
async function verifyKey(apiKey) {
  const AnthropicSDK = require('@anthropic-ai/sdk');
  const Anthropic = AnthropicSDK.default || AnthropicSDK;
  try {
    await new Anthropic({ apiKey, timeout: 15000, maxRetries: 1 }).models.list({ limit: 1 });
  } catch (e) {
    throw explainApiError(e);
  }
}

/** 呼叫 Claude（串流，避免長輸出逾時），回傳解析後的 JSON */
async function callClaude(chunk, hints, opts = {}) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error('找不到 Claude API 金鑰：請先設定環境變數 ANTHROPIC_API_KEY（或改用 --offline 離線模式測試）');
  }
  const AnthropicSDK = require('@anthropic-ai/sdk');
  const Anthropic = AnthropicSDK.default || AnthropicSDK;
  const client = new Anthropic(); // 金鑰由 SDK 從環境變數讀取

  const request = {
    model: opts.model || 'claude-opus-5-5',
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    output_config: { effort: opts.effort || 'high', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserContent(chunk, hints) }],
  };
  // 若主模型因安全分類器拒答，伺服器端自動改用備援模型（可在 config.json 關閉）
  if (opts.fallbacks !== false) {
    request.betas = ['server-side-fallback-2026-07-01'];
    request.fallbacks = 'default';
  }

  const stream = request.betas ? client.beta.messages.stream(request) : client.messages.stream(request);
  let msg;
  try {
    msg = await stream.finalMessage();
  } catch (e) {
    throw explainApiError(e);
  }
  if (msg.stop_reason === 'refusal') {
    throw new Error(`Claude 拒絕處理此檔（${msg.stop_details?.category || '未說明'}）`);
  }
  if (msg.stop_reason === 'max_tokens') throw new Error('輸出超過長度上限，請把檔案拆小一點再匯入');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return { ...JSON.parse(text), 模型: msg.model };
  } catch (e) {
    throw new Error(`Claude 回傳的不是有效 JSON：${e.message}`);
  }
}

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
  let text = normalizeText(chunk.文字.replace(/=== 第 \d+ 頁 ===/g, '\n'));

  // 卷末答案區
  let key = {};
  const keyAt = text.search(/\n\s*【?(?:參考)?(?:答案|解答)】?\s*:?\s*(?:\n|(?=\d))/);
  if (keyAt > 0) {
    key = parseAnswerKey(text.slice(keyAt));
    text = text.slice(0, keyAt);
  }

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
    out.題目.push({
      原題號: no, 科目代碼: null,
      題幹: toLatexLite(stem),
      選項: sp.opts.map(toLatexLite),
      答案: ans != null && ans < sp.opts.length ? ans : null,
      答案依據: ans != null ? (inlineAns != null ? '考卷上標示的答案' : '卷末參考答案') : null,
      難度: null, 解析: explain ? toLatexLite(explain) : null,
      版本: null, 年級: null, 冊: null, 章: null, 節: null,
      圖表: [], 不確定: hasFig ? ['圖片'] : [],
    });
  });
  if (skipped) out.備註 += ` 有 ${skipped} 段沒有找到 (A)(B)(C)(D) 選項，可能是填充或問答題，已略過。`;
  if (!out.題目.length) out.備註 += ' 沒有拆出任何選擇題：請確認題目格式是「1. 題目 (A)… (B)… (C)… (D)…」。';
  return out;
}

module.exports = { OUTPUT_SCHEMA, SYSTEM_PROMPT, callClaude, offlineParse, toLatexLite, buildUserContent, explainApiError, verifyKey };
