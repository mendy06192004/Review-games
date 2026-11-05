'use strict';
/**
 * 依檔案類型抽取內容，統一回傳：
 * {
 *   方式: '文字層' | 'OCR' | 'Word' | '圖片OCR',
 *   文字: string,                  // 抽到的文字（掃描檔/圖片為空，交給 Claude 視覺辨識）
 *   頁面: [{ 編號, png: Buffer, 寬, 高 }],   // 供 Claude 看版面、做 OCR，以及切圖
 *   內嵌圖片: [{ 代號, png/buffer, mime }], // Word 內嵌圖片
 * }
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const PDF_RENDER_LONG_EDGE = 1600; // 頁面圖長邊像素，Claude 建議 ≤ 1568 附近
const MIN_TEXT_CHARS_PER_PAGE = 20; // 平均每頁少於此字數視為無文字層（掃描檔）

let pdfjsPromise = null;
function pdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

/**
 * 找出頁面上「畫出來的東西」（圖片、線條、色塊）的位置，用來只截取題目的圖。
 * 回傳 [{左, 右, 上, 下}]（佔頁面寬高的比例，左上角為 0）；排除裁切範圍、整頁外框與分隔線。
 */
async function graphicsOf(lib, page) {
  const out = [];
  try {
    const OPS = lib.OPS;
    const ol = await page.getOperatorList();
    const [x0, y0, x1, y1] = page.view;
    const W = x1 - x0;
    const H = y1 - y0;
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const mul = (m, t) => [m[0] * t[0] + m[2] * t[1], m[1] * t[0] + m[3] * t[1], m[0] * t[2] + m[2] * t[3], m[1] * t[2] + m[3] * t[3], m[0] * t[4] + m[2] * t[5] + m[4], m[1] * t[4] + m[3] * t[5] + m[5]];
    const add = (bb) => {
      const pts = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[0], bb[3]], [bb[2], bb[3]]].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
      const xs = pts.map((p) => (p[0] - x0) / W);
      const ys = pts.map((p) => 1 - (p[1] - y0) / H);
      const g = { 左: Math.max(0, Math.min(...xs)), 右: Math.min(1, Math.max(...xs)), 上: Math.max(0, Math.min(...ys)), 下: Math.min(1, Math.max(...ys)) };
      const w = g.右 - g.左;
      const h = g.下 - g.上;
      if (w > 0.85 && h > 0.5) return; // 整頁外框
      if (h < 0.004 && w > 0.3) return; // 橫向分隔線、底線
      if (w < 0.004 && h > 0.3) return; // 直向分隔線
      if (w < 0.002 && h < 0.002) return;
      out.push(g);
    };
    const IMG = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat].filter((x) => x != null));
    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i];
      const a = ol.argsArray[i];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() || ctm;
      else if (fn === OPS.transform) ctm = mul(ctm, a);
      else if (fn === OPS.paintFormXObjectBegin && a && a[0]) { stack.push(ctm); ctm = mul(ctm, a[0]); }
      else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
      else if (fn === OPS.constructPath) {
        // 只算真的畫出來的（填色或描線），裁切用的路徑不算
        if (a && a[0] !== OPS.endPath && a[2] && a[2].length === 4) add(Array.from(a[2]));
      } else if (IMG.has(fn)) add([0, 0, 1, 1]);
    }
  } catch { /* 讀不到就用文字範圍截圖 */ }
  return out;
}

async function extractPdf(file) {
  const lib = await pdfjs();
  const pkgDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const doc = await lib.getDocument({
    data: new Uint8Array(fs.readFileSync(file)),
    // pdf.js 只接受以 / 結尾的「網址」格式；Windows 的反斜線路徑會被拒絕
    cMapUrl: pathToFileURL(path.join(pkgDir, 'cmaps') + path.sep).href,
    cMapPacked: true,
    standardFontDataUrl: pathToFileURL(path.join(pkgDir, 'standard_fonts') + path.sep).href,
    disableFontFace: true,
    verbosity: 0,
  }).promise;

  const texts = [];
  const pages = [];
  const pageLines = []; // 每頁每一行的文字與位置（佔頁面寬高的比例），用來自動截取題目圖
  const pageGraphics = []; // 每頁的圖片與向量圖形位置

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    // 依 y 座標分行，保留閱讀順序
    const base = page.getViewport({ scale: 1 });
    let lastY = null;
    let line = '';
    let box = null;
    const lines = [];
    const placed = [];
    const [vx0, vy0] = page.view;
    const flush = () => {
      if (line.trim() && box) { lines.push(line); placed.push({ 文字: line.trim(), ...box }); }
      line = ''; box = null;
    };
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const y = Math.round(it.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) flush();
      line += it.str;
      if (it.str.trim()) {
        const h = Math.abs(it.transform[3]) || 10;
        const x = it.transform[4] - vx0;
        const b = {
          上: Math.max(0, 1 - (it.transform[5] - vy0 + h) / base.height),
          下: Math.min(1, 1 - (it.transform[5] - vy0 - h * 0.25) / base.height),
          左: Math.max(0, x / base.width),
          右: Math.min(1, (x + (it.width || h * it.str.length)) / base.width),
        };
        box = box ? { 上: Math.min(box.上, b.上), 下: Math.max(box.下, b.下), 左: Math.min(box.左, b.左), 右: Math.max(box.右, b.右) } : b;
      }
      lastY = y;
    }
    flush();
    pageGraphics.push(await graphicsOf(lib, page));
    texts.push(lines.map((l) => l.trim()).filter(Boolean).join('\n'));
    pageLines.push(placed);

    const scale = PDF_RENDER_LONG_EDGE / Math.max(base.width, base.height);
    const vp = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    pages.push({ 編號: n, png: canvas.toBuffer('image/png'), 寬: canvas.width, 高: canvas.height });
    page.cleanup();
  }
  await (doc.destroy ? doc.destroy() : doc.cleanup?.());

  const total = texts.join('').replace(/\s/g, '').length;
  const hasText = total >= MIN_TEXT_CHARS_PER_PAGE * pages.length;
  return {
    方式: hasText ? '文字層' : 'OCR',
    文字: hasText ? texts.map((t, i) => `=== 第 ${i + 1} 頁 ===\n${t}`).join('\n\n') : '',
    頁文字: hasText ? texts : texts.map(() => ''),
    頁行: pageLines,
    頁圖形: pageGraphics,
    頁面: pages,
    內嵌圖片: [],
  };
}

async function extractDocx(file) {
  const mammoth = require('mammoth');
  const images = [];
  const buf = fs.readFileSync(file);
  // 舊版 Word（.doc）改名成 .docx 也打不開，先檢查檔案格式，給老師看得懂的說明
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error('這不是 .docx 格式（可能是舊版 .doc 或改了副檔名）。請用 Word 開啟後「另存新檔」，選擇 Word 文件 (.docx) 再上傳。');
  }
  let result;
  try {
    result = await mammoth.convertToHtml(
      { buffer: buf },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const buf = await image.readAsBuffer();
        const 代號 = `圖${images.length + 1}`;
        images.push({ 代號, buffer: buf, mime: image.contentType });
        return { src: `#${代號}`, alt: 代號 };
      }),
    },
    );
  } catch (e) {
    throw new Error(`Word 檔無法讀取（${e.message}）。請用 Word 開啟後另存為 .docx 再上傳。`);
  }
  // HTML 轉成保留段落與圖片位置的純文字
  const text = result.value
    .replace(/<img[^>]*alt="([^"]+)"[^>]*>/g, '\n[$1]\n')
    .replace(/<\/(p|h\d|li|tr)>/g, '\n')
    .replace(/<(td|th)[^>]*>/g, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // 內嵌圖片轉成 PNG（Claude 支援 png/jpeg/gif/webp；emf/wmf 等無法辨識的保留原檔）
  for (const img of images) {
    if (/png|jpe?g|gif|webp/.test(img.mime)) {
      try {
        const im = await loadImage(img.buffer);
        const c = createCanvas(im.width, im.height);
        c.getContext('2d').drawImage(im, 0, 0);
        img.png = c.toBuffer('image/png');
      } catch { /* 無法解碼就只存原檔 */ }
    }
  }
  return { 方式: 'Word', 文字: text, 頁面: [], 內嵌圖片: images };
}

async function extractImage(file) {
  const im = await loadImage(fs.readFileSync(file));
  const scale = Math.min(1, PDF_RENDER_LONG_EDGE / Math.max(im.width, im.height));
  const c = createCanvas(Math.round(im.width * scale), Math.round(im.height * scale));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(im, 0, 0, c.width, c.height);
  return { 方式: '圖片OCR', 文字: '', 頁面: [{ 編號: 1, png: c.toBuffer('image/png'), 寬: c.width, 高: c.height }], 內嵌圖片: [] };
}

/** 純文字（後台「貼上題目文字」存成的 .txt） */
async function extractTxt(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return { 方式: '文字', 文字: text, 頁面: [], 內嵌圖片: [] };
}

const SUPPORTED = { '.txt': extractTxt, '.pdf': extractPdf, '.docx': extractDocx, '.png': extractImage, '.jpg': extractImage, '.jpeg': extractImage };

async function extract(file) {
  const fn = SUPPORTED[path.extname(file).toLowerCase()];
  if (!fn) throw new Error(`不支援的檔案類型：${path.basename(file)}`);
  return fn(file);
}

/** 從頁面圖切出圖表。box 為 0~1 的比例座標 [左, 上, 右, 下]，四周加一點留白。 */
async function cropFigure(pagePng, box, pad = 0.012) {
  const im = await loadImage(pagePng);
  const [x0, y0, x1, y1] = box.map((v) => Math.min(1, Math.max(0, v)));
  const L = Math.max(0, x0 - pad) * im.width;
  const T = Math.max(0, y0 - pad) * im.height;
  const R = Math.min(1, x1 + pad) * im.width;
  const B = Math.min(1, y1 + pad) * im.height;
  const w = Math.round(R - L);
  const h = Math.round(B - T);
  if (w < 8 || h < 8) throw new Error('切圖範圍太小');
  const c = createCanvas(w, h);
  c.getContext('2d').drawImage(im, L, T, w, h, 0, 0, w, h);
  return c.toBuffer('image/png');
}

module.exports = { extract, cropFigure, SUPPORTED_EXT: Object.keys(SUPPORTED) };
