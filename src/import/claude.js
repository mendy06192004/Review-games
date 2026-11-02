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
          科目代碼: nul({ type: 'string', enum: ['C', 'E', 'M'] }),
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

const SYSTEM_PROMPT = `你是台灣國中小「國文、英文、數學」題庫的整理助手。老師上傳了考卷或講義，請把其中的「選擇題」逐題整理成結構化資料，交給老師人工審核。

原則（非常重要）：
1. 只整理文件中真的存在的題目，題幹與選項照原文謄寫，不要改寫、不要自己出題。非選擇題（填充、計算、問答）略過，並在「備註」說明略過了哪些。
2. 不確定就填 null，不要猜：
   - 答案：只有在文件明確提供（答案欄、解答頁、標示正解）時才填，填「選項索引」（第一個選項是 0），並在「答案依據」寫出根據（例如「考卷末參考答案：3.(A)」）。文件沒給答案就填 null，即使你會算也不要填。
   - 版本、年級、冊、章、節：只有文件標題、頁首或老師提供的資訊明確寫出時才填，否則 null。
   - 難度：文件沒有標示就填 null。
   - 解析：文件有附解析才填，否則 null。
3. 選項不要包含 (A)(B)、①② 等編號，只保留內容。數學式用一般文字表示（例如 x²、√12、½、×、÷），不要用 LaTeX。
4. 題目若有圖、表、幾何圖形：在「圖表」列出位置。
   - 來自頁面圖片：來源="頁面"，頁=頁碼，左/上/右/下=該圖在頁面中的比例座標（0~1，左上角為 0,0），範圍只包住圖本身、不要包含題幹文字。
   - 來自 Word 內嵌圖片：來源="內嵌"，代號填文中標示的 [圖N]。
5. 任何你沒把握的欄位，把欄位名稱放進「不確定」（例如 ["答案","章"]）。掃描品質差、字跡難辨的地方也要列出。
6. 科目代碼：國文 C、英文 E、數學 M；無法判斷填 null。`;

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
  const msg = await stream.finalMessage();
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
 * 離線簡易模式：不呼叫 Claude，只用規則解析「文字層」中的
 * 「1. 題幹 (A)… (B)… (C)… (D)…」與「參考答案：1.(B)」格式。
 * 用途：沒有 API 金鑰時測試整個流程；掃描檔、Word 圖片等無法處理。
 */
function offlineParse(chunk, hints) {
  const out = { 題目: [], 備註: '離線簡易模式：未使用 Claude，僅以規則解析文字層，請特別仔細審核。', 模型: 'offline-rules' };
  if (!chunk.文字) {
    throw new Error('離線簡易模式無法處理沒有文字層的檔案（掃描檔、照片需要 Claude 進行 OCR），請設定 ANTHROPIC_API_KEY 後再匯入');
  }
  const text = chunk.文字.replace(/=== 第 \d+ 頁 ===/g, '');
  const keyPart = (text.match(/(參考)?答案[:：]([\s\S]*)$/) || [])[2] || '';
  const answers = {};
  for (const m of keyPart.matchAll(/(\d+)\s*[.、]\s*[(（]([A-D])[)）]/g)) answers[m[1]] = 'ABCD'.indexOf(m[2]);
  const body = keyPart ? text.slice(0, text.lastIndexOf(keyPart)).replace(/(參考)?答案[:：]$/, '') : text;
  const blocks = body.split(/\n(?=\d+\s*[.、．]\s*)/).slice(1);
  for (const blk of blocks) {
    const m = blk.match(/^(\d+)\s*[.、．]\s*([\s\S]*)$/);
    if (!m) continue;
    const [, no, rest] = m;
    const optStart = rest.search(/[(（]A[)）]/);
    if (optStart < 0) continue;
    const stemRaw = rest.slice(0, optStart);
    const opts = rest.slice(optStart).split(/[(（][A-D][)）]/).slice(1).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    // 題幹中圖上的零散標籤（單一字母/數字行）去掉
    const stem = stemRaw.split('\n').filter((l) => !/^[A-Za-z0-9 ]{1,6}$/.test(l.trim())).join('').replace(/\s+/g, ' ').trim();
    const hasFig = /如[右左上下]?圖|如圖/.test(stem);
    out.題目.push({
      原題號: no, 科目代碼: null, 題幹: stem, 選項: opts,
      答案: no in answers ? answers[no] : null,
      答案依據: no in answers ? '考卷所附參考答案' : null,
      難度: null, 解析: null,
      版本: null, 年級: null, 冊: null, 章: null, 節: null,
      圖表: [], 不確定: hasFig ? ['圖片'] : [],
    });
  }
  return out;
}

module.exports = { OUTPUT_SCHEMA, SYSTEM_PROMPT, callClaude, offlineParse, buildUserContent };
