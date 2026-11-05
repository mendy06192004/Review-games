'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { createApp } = require('../src/app');
const { makeTempBank } = require('./helpers');

async function start(cfg) {
  const server = createApp(cfg).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (p, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON */ }
    return { status: res.status, body: json, text, headers: res.headers };
  };
  return { call, base, close: () => server.close() };
}

const HTML = '<!doctype html><html><head><title>t</title></head><body><script>localStorage.setItem("a","1")</script>hi</body></html>';
const b64 = (s) => Buffer.from(s).toString('base64');
const info = (over = {}) => ({ 名稱: '測試遊戲', 說明: '說明', 分類: '生活管理', 使用題庫: false, 科目: [], 投稿者: '王老師', ...over });

test('老師投稿 → 待審核（學生看不到）→ 管理員發布 → 學生可玩（沙盒）', async () => {
  const { cfg, cleanup } = makeTempBank();
  const app = await start(cfg);
  try {
    const r = await app.call('/api/submit/games', { method: 'POST', body: { 資訊: info(), 檔案: { 檔名: 'game.html', 內容: b64(HTML) } } });
    assert.strictEqual(r.status, 200, r.text);
    const id = r.body.編號;
    assert.strictEqual(r.body.狀態, '待審核');

    let list = await app.call('/api/games');
    assert.ok(!list.body.遊戲.some((g) => g.id === id), '待審核的遊戲不應出現在學生端');
    assert.strictEqual((await app.call(`/ugames/${id}/index.html`)).status, 404);
    // 管理員可以預覽未發布的遊戲（網址帶簽章，簽章錯誤就看不到）
    const adminList = await app.call('/api/admin/games');
    const pv = await app.call(adminList.body.遊戲.find((x) => x.id === id).預覽網址);
    assert.strictEqual((await app.call(`/gpreview/0000000000000000/${id}/index.html`)).status, 404);
    assert.strictEqual(pv.status, 200);
    assert.match(pv.headers.get('content-security-policy'), /^sandbox allow-scripts/);

    assert.strictEqual((await app.call(`/api/admin/games/${id}/reject`, { method: 'POST', body: {} })).status, 400, '退回要寫原因');
    assert.strictEqual((await app.call(`/api/admin/games/${id}/publish`, { method: 'POST', body: {} })).status, 200);

    list = await app.call('/api/games');
    const g = list.body.遊戲.find((x) => x.id === id);
    assert.ok(g, '發布後學生端看得到');
    assert.strictEqual(g.外部, true);
    assert.strictEqual(g.投稿者, undefined, '學生端不顯示投稿者');
    const page = await app.call(g.入口);
    assert.strictEqual(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /sandbox/);
    assert.ok(!/allow-same-origin/.test(page.headers.get('content-security-policy')), '不可給同源權限');
    assert.match(page.text, /sandbox-shim\.js/, '應自動插入 localStorage 替代程式');

    assert.strictEqual((await app.call(`/api/admin/games/${id}/unpublish`, { method: 'POST', body: {} })).status, 200);
    assert.strictEqual((await app.call(g.入口)).status, 404, '下架後學生端無法開啟');
  } finally {
    app.close();
    cleanup();
  }
});

test('ZIP 上傳：自動拿掉外層資料夾、略過不安全與不支援的檔案、讀取封面', async () => {
  const { cfg, cleanup } = makeTempBank();
  const app = await start(cfg);
  try {
    const zip = new JSZip();
    zip.file('我的遊戲/index.html', HTML);
    zip.file('我的遊戲/js/main.js', 'console.log(1)');
    zip.file('我的遊戲/cover.png', Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
    zip.file('我的遊戲/run.exe', 'MZ');
    zip.file('我的遊戲/__MACOSX/._index.html', 'x');
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const r = await app.call('/api/admin/games', { method: 'POST', body: { 資訊: info(), 檔案: { 檔名: 'g.zip', 內容: buf.toString('base64') }, 直接發布: true } });
    assert.strictEqual(r.status, 200, r.text);
    const g = r.body.遊戲;
    assert.strictEqual(g.狀態, '已發布');
    assert.ok(r.body.略過的檔案.some((s) => s.startsWith('run.exe')));
    const dir = path.join(cfg.gamesDir, g.id);
    assert.ok(fs.existsSync(path.join(dir, '檔案', 'index.html')));
    assert.ok(fs.existsSync(path.join(dir, '檔案', 'js', 'main.js')));
    assert.ok(!fs.existsSync(path.join(dir, '檔案', 'run.exe')));
    assert.ok(fs.existsSync(path.join(dir, '封面.png')), 'cover.png 自動當封面');
    const js = await app.call(`/ugames/${g.id}/js/main.js`);
    assert.strictEqual(js.status, 200);
    assert.strictEqual(js.headers.get('access-control-allow-origin'), '*');
    assert.strictEqual((await app.call(`/ugames/${g.id}/../資訊.json`)).status, 404);

    // 沒有 index.html 的壓縮檔
    const bad = new JSZip();
    bad.file('a/one.html', HTML);
    bad.file('b/two.html', HTML);
    const r2 = await app.call('/api/admin/games', { method: 'POST', body: { 資訊: info(), 檔案: { 檔名: 'x.zip', 內容: (await bad.generateAsync({ type: 'nodebuffer' })).toString('base64') } } });
    assert.strictEqual(r2.status, 400);
    assert.match(r2.body.error, /index\.html/);
  } finally {
    app.close();
    cleanup();
  }
});

test('資料檢查：題庫遊戲要選科目、投稿要填老師姓名、投稿密碼', async () => {
  const { cfg, cleanup } = makeTempBank();
  cfg.submitPassword = 'abc';
  const app = await start(cfg);
  const file = { 檔名: 'g.html', 內容: b64(HTML) };
  try {
    let r = await app.call('/api/submit/games', { method: 'POST', body: { 資訊: info(), 檔案: file } });
    assert.strictEqual(r.status, 401);
    r = await app.call('/api/submit/games', { method: 'POST', body: { 密碼: 'abc', 資訊: info({ 投稿者: '' }), 檔案: file } });
    assert.match(r.body.error, /投稿老師/);
    r = await app.call('/api/submit/games', { method: 'POST', body: { 密碼: 'abc', 資訊: info({ 分類: '複習遊戲', 使用題庫: true }), 檔案: file } });
    assert.match(r.body.error, /科目/);
    r = await app.call('/api/submit/games', { method: 'POST', body: { 密碼: 'abc', 資訊: info(), 檔案: { 檔名: 'x.txt', 內容: b64('hello') } } });
    assert.strictEqual(r.status, 400);
    r = await app.call('/api/submit/games', { method: 'POST', body: { 密碼: 'abc', 資訊: info({ 分類: '複習遊戲', 使用題庫: true, 科目: ['B', 'S'] }), 檔案: file } });
    assert.strictEqual(r.status, 200, r.text);
  } finally {
    app.close();
    cleanup();
  }
});

test('管理 API 拒絕跨站的「簡單請求」（防止沙盒遊戲偷偷操作後台）', async () => {
  const { cfg, cleanup } = makeTempBank();
  const app = await start(cfg);
  try {
    const r = await app.call('/api/admin/games', { method: 'POST', body: { 資訊: info(), 檔案: { 檔名: 'g.html', 內容: b64(HTML) }, 直接發布: true } });
    const id = r.body.遊戲.id;
    const forged = await app.call(`/api/admin/games/${id}/unpublish`, { method: 'POST', headers: { 'Content-Type': 'text/plain' } });
    assert.strictEqual(forged.status, 403);
    const nullOrigin = await app.call(`/api/admin/games/${id}/unpublish`, { method: 'POST', body: {}, headers: { Origin: 'null' } });
    assert.strictEqual(nullOrigin.status, 403);
    const list = await app.call('/api/admin/games');
    assert.strictEqual(list.body.遊戲[0].狀態, '已發布');
  } finally {
    app.close();
    cleanup();
  }
});

test('五個學科：自然 B、社會 S 可用於題號與篩選', async () => {
  const { cfg, cleanup } = makeTempBank();
  const app = await start(cfg);
  try {
    const t = await app.call('/api/tree');
    assert.deepStrictEqual(t.body.科目.map((s) => s.代碼), ['C', 'E', 'M', 'B', 'S']);
    assert.strictEqual((await app.call('/api/tree?subject=社會')).status, 200);
  } finally {
    app.close();
    cleanup();
  }
});

test('後台登入：沒登入看不到後台，密碼正確才能進入，登出後失效', async () => {
  const { cfg, cleanup } = makeTempBank();
  cfg.adminPassword = '0928';
  const app = await start(cfg);
  try {
    assert.strictEqual((await app.call('/api/admin/overview')).status, 401);
    assert.strictEqual((await app.call('/api/admin/drafts')).status, 401);
    const redirect = await app.call('/admin/', { headers: {} });
    assert.ok(redirect.text.includes('後台登入'), '未登入開後台會被導到登入頁');
    assert.strictEqual((await app.call('/api/login', { method: 'POST', body: { 密碼: '1234' } })).status, 401);
    const ok = await app.call('/api/login', { method: 'POST', body: { 密碼: '0928' } });
    assert.strictEqual(ok.status, 200);
    const cookie = ok.headers.get('set-cookie').split(';')[0];
    assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
    assert.match(ok.headers.get('set-cookie'), /SameSite=Strict/);
    const ov = await app.call('/api/admin/overview', { headers: { Cookie: cookie } });
    assert.strictEqual(ov.status, 200);
    assert.strictEqual(ov.body.題庫.總數, 3);
    // 學生端與投稿頁不需要密碼
    assert.strictEqual((await app.call('/api/tree')).status, 200);
    assert.strictEqual((await app.call('/api/submit/info')).status, 200);
  } finally {
    app.close();
    cleanup();
  }
});

test('網頁匯入：上傳 → 列出 → 勾選確認後處理 → 只產生草稿，不會寫入題目/', async () => {
  const { cfg, cleanup } = makeTempBank();
  const app = await start(cfg);
  try {
    const pdf = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-exam.pdf'));
    const up = await fetch(`${app.base}/api/admin/import/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent('段考/../一.pdf'), 'X-Subject': encodeURIComponent('數學'), 'X-Version': encodeURIComponent('南一'), 'X-Grade': encodeURIComponent('國二') },
      body: pdf,
    }).then((r) => r.json());
    assert.strictEqual(up.檔案, '數學/南一/國二/段考..一.pdf', '檔名中的路徑符號會被移除');
    const bad = await fetch(`${app.base}/api/admin/import/upload`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'a.exe' }, body: 'MZ' });
    assert.strictEqual(bad.status, 400);

    const list = await app.call('/api/admin/import/files');
    assert.strictEqual(list.body.檔案.length, 1);
    assert.deepStrictEqual(list.body.檔案[0].判斷, { 科目: '數學', 版本: '南一', 年級: '國二' });

    assert.strictEqual((await app.call('/api/admin/import/run', { method: 'POST', body: { 檔案: [] } })).status, 400, '沒勾選不能執行');
    const before = fs.readdirSync(cfg.questionDir, { recursive: true }).length;
    const run = await app.call('/api/admin/import/run', { method: 'POST', body: { 檔案: [up.檔案] } });
    assert.strictEqual(run.status, 200, run.text);
    let job;
    for (let i = 0; i < 100; i++) {
      job = (await app.call('/api/admin/import/job')).body.工作;
      if (job.狀態 === '完成') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.strictEqual(job.狀態, '完成');
    assert.ok(job.結果[0].題數 > 0, JSON.stringify(job));
    assert.strictEqual(fs.readdirSync(cfg.questionDir, { recursive: true }).length, before, '題目/ 不可被自動寫入');
    const ov = await app.call('/api/admin/overview');
    assert.strictEqual(ov.body.待匯入, 0);
    assert.strictEqual(ov.body.草稿.總數, job.結果[0].題數);
    assert.strictEqual(ov.body.最近匯入.length, 1);
  } finally {
    app.close();
    cleanup();
  }
});

test('免金鑰：貼上題目文字 → 離線拆題（含題號前答案、卷末答案、數學式轉 KaTeX）；手動新增空白題目', async () => {
  const { cfg, cleanup } = makeTempBank();
  const app = await start(cfg);
  try {
    const text = '( B )1. 下列何者等於 √9？ (A) 2 (B) 3 (C) 4 (D) 9\n2．x²＝4，x＝？（Ａ）±2（Ｂ）2（Ｃ）4（Ｄ）16\n3. 填充：1+1=__\n參考答案\n2.A';
    const up = await app.call('/api/admin/import/text', { method: 'POST', body: { 文字: text, 科目: '數學', 版本: '南一', 年級: '國二' } });
    assert.strictEqual(up.status, 200, up.text);
    assert.match(up.body.檔案, /^數學\/南一\/國二\/貼上的題目-\d+\.txt$/);
    await app.call('/api/admin/import/run', { method: 'POST', body: { 檔案: [up.body.檔案] } });
    let job;
    for (let i = 0; i < 50; i++) {
      job = (await app.call('/api/admin/import/job')).body.工作;
      if (job.狀態 === '完成') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.strictEqual(job.結果[0].題數, 2, JSON.stringify(job));
    const drafts = (await app.call('/api/admin/drafts')).body.草稿.map((d) => d.題目).sort((a, b) => a.原題號 - b.原題號);
    assert.strictEqual(drafts[0].題幹, '下列何者等於 $\\sqrt{9}$？');
    assert.strictEqual(drafts[0].答案, 1);
    assert.strictEqual(drafts[1].答案, 0);
    assert.strictEqual(drafts[1].科目代碼, 'M');
    assert.match(drafts[1].id, /^M-N2-\d{4}$/);

    const n = await app.call('/api/admin/drafts-new', { method: 'POST', body: {} });
    assert.strictEqual(n.status, 200);
    assert.strictEqual(n.body.題目.選項.length, 4);
    assert.strictEqual((await app.call('/api/admin/drafts')).body.草稿.length, 3);
  } finally {
    app.close();
    cleanup();
  }
});

test('批次設定章節 → 一鍵通過所有完整的題目（缺答案的留在審核）', async () => {
  const { cfg, cleanup } = makeTempBank();
  const app = await start(cfg);
  try {
    const pdf = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-exam.pdf'));
    const up = await fetch(`${app.base}/api/admin/import/upload`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent('段考.pdf') }, body: pdf }).then((r) => r.json());
    await app.call('/api/admin/import/run', { method: 'POST', body: { 檔案: [up.檔案] } });
    for (let i = 0; i < 100; i++) {
      if ((await app.call('/api/admin/import/job')).body.工作.狀態 === '完成') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    let drafts = (await app.call('/api/admin/drafts')).body.草稿;
    assert.strictEqual(drafts.length, 4);
    assert.ok(drafts.every((d) => d.題目.needs_review), '缺章節，全部需要審核');
    const r = await app.call('/api/admin/draft-files', { method: 'PUT', body: { 檔案: drafts[0].草稿檔, 歸屬: { 章: '第1章 乘法公式與多項式' } } });
    assert.strictEqual(r.body.更新題數, 4);
    drafts = (await app.call('/api/admin/drafts')).body.草稿;
    assert.strictEqual(drafts.filter((d) => !d.題目.needs_review).length, 3);
    const ok = await app.call('/api/admin/drafts-approve-all', { method: 'POST', body: {} });
    assert.strictEqual(ok.body.通過, 3);
    assert.strictEqual(ok.body.題目總數, 6);
    assert.strictEqual((await app.call('/api/admin/drafts')).body.草稿.length, 1, '缺答案的題目留著');
  } finally {
    app.close();
    cleanup();
  }
});

test('連結遊戲：貼上網址投稿（不需檔案、不用題庫），發布後學生端以外部連結開啟，並帶年級、章節標籤', async () => {
  const { cfg, cleanup } = makeTempBank();
  const app = await start(cfg);
  try {
    let r = await app.call('/api/submit/games', { method: 'POST', body: { 連結: 'javascript:alert(1)', 資訊: info() } });
    assert.strictEqual(r.status, 400, '只接受 http(s)');
    r = await app.call('/api/submit/games', { method: 'POST', body: { 連結: 'https://gemini.google.com/share/abc123', 資訊: info({ 分類: '學科練習', 使用題庫: true, 科目: ['M'], 年級: '國二', 章節: '第2章 一元二次方程式' }) } });
    assert.strictEqual(r.status, 200, r.text);
    const id = r.body.編號;
    await app.call(`/api/admin/games/${id}/publish`, { method: 'POST', body: {} });
    const g = (await app.call('/api/games')).body.遊戲.find((x) => x.id === id);
    assert.strictEqual(g.入口, 'https://gemini.google.com/share/abc123');
    assert.strictEqual(g.連結遊戲, true);
    assert.strictEqual(g.使用題庫, false, '連結遊戲一律不使用題庫');
    assert.strictEqual(g.年級, '國二');
    assert.strictEqual(g.章節, '第2章 一元二次方程式');
    const admin = (await app.call('/api/admin/games')).body.遊戲.find((x) => x.id === id);
    assert.strictEqual(admin.預覽網址, 'https://gemini.google.com/share/abc123');
  } finally {
    app.close();
    cleanup();
  }
});
