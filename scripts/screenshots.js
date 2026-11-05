#!/usr/bin/env node
'use strict';
/**
 * 自動擷取遊戲畫面，做為選遊戲卡片的封面。
 *
 *   npm run screenshots              擷取還沒有封面的內建遊戲與已發布的上傳遊戲
 *   npm run screenshots -- --all     全部重新擷取
 *   npm run screenshots -- quiz typhoon   只擷取指定的遊戲（填遊戲 id）
 *
 * 需要 Playwright（npm i -D playwright 後執行 npx playwright install chromium）。
 * 使用題庫的遊戲會實際走一次「選範圍 → 開始」，所以題庫裡至少要有一題該科的題目。
 * 封面存放：內建遊戲 public/games/<id>/cover.jpg；上傳遊戲 <題庫>/遊戲/<id>/封面.jpg
 */
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('找不到 Playwright。請先執行：\n  npm i -D playwright\n  npx playwright install chromium');
  process.exit(1);
}

const args = process.argv.slice(2);
const all = args.includes('--all');
const only = new Set(args.filter((a) => !a.startsWith('--')));
const VIEW = { width: 1200, height: 750 };
const SCALE = 0.6; // 輸出 720×450 的 JPG

function coverPath(cfg, g) {
  return g.外部 ? path.join(cfg.gamesDir, g.id, '封面.jpg') : path.join(__dirname, '..', 'public', 'games', g.id, 'cover.jpg');
}
const hasCover = (cfg, g) => (g.外部
  ? ['jpg', 'png', 'webp', 'gif'].some((e) => fs.existsSync(path.join(cfg.gamesDir, g.id, `封面.${e}`)))
  : fs.existsSync(coverPath(cfg, g)));

async function playBankGame(page, base, g, counts) {
  const subject = (g.科目 || []).find((s) => counts[s] > 0);
  if (!subject) throw new Error('題庫中沒有這個遊戲適用科目的題目');
  await page.goto(`${base}/`);
  await page.click(`.zone.z-${subject}`);
  await page.locator('.gcard', { hasText: g.名稱 }).first().click();
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(250);
    const step = await page.evaluate(() => location.hash.slice(1));
    if (step === 'play') return;
    if (step === 'version') await page.click('#version-cards .card');
    else if (step === 'volume') {
      if (await page.isDisabled('#volume-next')) await page.click('#volume-groups .chip');
      await page.click('#volume-next');
    } else if (step === 'chapter') { await page.click('#check-all'); await page.click('#chapter-next'); }
    else if (step === 'ready') await page.click('#start');
  }
  throw new Error('無法進入遊戲畫面');
}

(async () => {
  const cfg = loadConfig();
  const app = createApp(cfg);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { 遊戲: games } = await (await fetch(`${base}/api/games`)).json();
  const tree = await (await fetch(`${base}/api/tree`)).json();
  const counts = Object.fromEntries(tree.科目.map((s) => [s.代碼, s.題數]));

  const todo = games.filter((g) => (only.size ? only.has(g.id) : all || !hasCover(cfg, g)));
  if (!todo.length) { console.log('所有遊戲都已經有封面（要重新擷取請加 --all）'); server.close(); return; }

  const browser = await chromium.launch();
  let ok = 0;
  for (const g of todo) {
    // 非全版面的題庫遊戲（例如單題闖關）畫面較小，用小一點的視窗讓內容填滿封面
    const small = g.使用題庫 && !g.全版面 && !g.外部;
    const ctx = await browser.newContext(small ? { viewport: { width: 800, height: 500 }, deviceScaleFactor: 0.9 } : { viewport: VIEW, deviceScaleFactor: SCALE });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    try {
      let target;
      if (g.使用題庫) {
        await playBankGame(page, base, g, counts);
        await page.addStyleTag({ content: '.play-bar{display:none!important}' });
        target = page.locator('#game-root');
      } else {
        await page.goto(/^https?:/.test(g.入口) ? g.入口 : base + g.入口);
        target = page;
      }
      await page.waitForTimeout(3000); // 等動畫、字型載入
      const out = coverPath(cfg, g);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await target.screenshot({ path: out, type: 'jpeg', quality: 72 });
      console.log(`✔ ${g.名稱} → ${path.relative(process.cwd(), out)}`);
      ok++;
    } catch (e) {
      console.log(`✘ ${g.名稱}：${e.message.split('\n')[0]}`);
    }
    await ctx.close();
  }
  await browser.close();
  server.close();
  console.log(`完成：${ok}/${todo.length} 個遊戲`);
})().catch((e) => { console.error(e); process.exit(1); });
