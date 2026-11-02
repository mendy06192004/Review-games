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
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const PDF_RENDER_LONG_EDGE = 1600; // 頁面圖長邊像素，Claude 建議 ≤ 1568 附近
const MIN_TEXT_CHARS_PER_PAGE = 20; // 平均每頁少於此字數視為無文字層（掃描檔）

let pdfjsPromise = null;
function pdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

async function extractPdf(file) {
  const lib = await pdfjs();
  const pkgDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const doc = await lib.getDocument({
    data: new Uint8Array(fs.readFileSync(file)),
    cMapUrl: path.join(pkgDir, 'cmaps') + path.sep,
    cMapPacked: true,
    standardFontDataUrl: path.join(pkgDir, 'standard_fonts') + path.sep,
    disableFontFace: true,
    verbosity: 0,
  }).promise;

  const texts = [];
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    // 依 y 座標分行，保留閱讀順序
    let lastY = null;
    let line = '';
    const lines = [];
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const y = Math.round(it.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; }
      line += it.str;
      lastY = y;
    }
    if (line) lines.push(line);
    texts.push(lines.map((l) => l.trim()).filter(Boolean).join('\n'));

    const base = page.getViewport({ scale: 1 });
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
    頁面: pages,
    內嵌圖片: [],
  };
}

async function extractDocx(file) {
  const mammoth = require('mammoth');
  const images = [];
  const result = await mammoth.convertToHtml(
    { path: file },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const buf = await image.readAsBuffer();
        const 代號 = `圖${images.length + 1}`;
        images.push({ 代號, buffer: buf, mime: image.contentType });
        return { src: `#${代號}`, alt: 代號 };
      }),
    },
  );
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

const SUPPORTED = { '.pdf': extractPdf, '.docx': extractDocx, '.png': extractImage, '.jpg': extractImage, '.jpeg': extractImage };

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
