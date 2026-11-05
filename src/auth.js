'use strict';
/**
 * 後台登入。config.json 的 admin_password 不為空時，後台需要密碼。
 * 登入後以 Cookie 記住 30 天（HttpOnly、SameSite=Strict）；也接受 HTTP Basic（帳號任意）。
 * 改密碼後，舊的登入會自動失效。
 */
const crypto = require('crypto');

const COOKIE = 'review_admin';
const MAX_AGE = 30 * 24 * 3600;

const hmac = (key, msg) => crypto.createHmac('sha256', String(key)).update(msg).digest('hex');
const tokenFor = (cfg) => hmac(cfg.adminPassword, 'review-admin-v1');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function isAdmin(cfg, req) {
  if (!cfg.adminPassword) return true;
  const c = readCookie(req, COOKIE);
  if (c && safeEqual(c, tokenFor(cfg))) return true;
  const [type, token] = (req.headers.authorization || '').split(' ');
  if (type === 'Basic' && token) {
    const pass = Buffer.from(token, 'base64').toString().split(':').slice(1).join(':');
    return safeEqual(pass, cfg.adminPassword);
  }
  return false;
}

/** 保護後台：網頁未登入時導向登入頁；API 回 401 */
function adminAuth(cfg) {
  return (req, res, next) => {
    if (isAdmin(cfg, req)) return next();
    if (req.method === 'GET' && !req.originalUrl.startsWith('/api/')) {
      return res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
    }
    res.status(401).json({ error: '請先登入後台', 需要登入: true });
  };
}

/** 未發布遊戲的預覽網址用簽章代替登入（沙盒中的遊戲載入圖片、程式時不會帶 Cookie） */
const previewToken = (cfg, id) => hmac(cfg.adminPassword || 'no-password', `preview:${id}`).slice(0, 16);

function loginRoutes(app, cfg) {
  let failures = 0;
  app.post('/api/login', async (req, res) => {
    if (!cfg.adminPassword) return res.json({ ok: true, 需要密碼: false });
    const pass = String(req.body?.密碼 ?? '');
    if (!safeEqual(pass, cfg.adminPassword)) {
      failures++;
      await new Promise((r) => setTimeout(r, Math.min(3000, 300 * failures))); // 連續猜錯會越來越慢
      return res.status(401).json({ error: '密碼不正確' });
    }
    failures = 0;
    res.set('Set-Cookie', `${COOKIE}=${tokenFor(cfg)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE}`);
    res.json({ ok: true });
  });
  app.post('/api/logout', (req, res) => {
    res.set('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.json({ ok: true });
  });
  app.get('/api/login/status', (req, res) => res.json({ 需要密碼: !!cfg.adminPassword, 已登入: isAdmin(cfg, req) }));
}

module.exports = { adminAuth, isAdmin, loginRoutes, previewToken };
