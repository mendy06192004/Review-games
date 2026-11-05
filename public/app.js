// 學生端流程：學科 → 遊戲 →（使用題庫的遊戲才需要）版本 → 年級與冊 → 章節 → 開始 → 全螢幕遊戲
import { runGame } from './games/host.js?v=20261105';
import { SANDBOX } from './games/_shared/iframe-game.js?v=20261105';

window.__appStarted = true;

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  kids.flat().forEach((k) => k != null && e.append(k));
  return e;
};

const SUBJECT_CHAR = { C: '國', E: '英', M: '數', B: '自', S: '社' };
const SUBJECT_NOTE = { C: '字音字形・閱讀', E: '單字・文法', M: '計算・圖形', B: '生物・理化・地科', S: '歷史・地理・公民' };
const OTHER_CATS = {
  生活管理: '自我照顧、居家生活、時間管理、社區與交通安全',
  職業教育: '職業探索、職前技能',
  社會技巧: '人際互動、拒絕誘惑、自我保護',
  學科練習: '內建固定範圍的學科小遊戲',
  邏輯推理: '觀察證據、找出矛盾、推理判斷',
};
const BANK_STEPS = [['subject', '學科'], ['games', '遊戲'], ['version', '版本'], ['volume', '年級冊'], ['chapter', '章節'], ['ready', '開始']];

const S = { subject: null, subjectName: '', tree: [], counts: {}, version: null, volumes: [], scopes: [], scopeSubject: null, game: null, games: [], subjects: {} };
const store = {
  get() { try { return JSON.parse(localStorage.getItem('review-last') || 'null'); } catch { return null; } },
  set(v) { try { localStorage.setItem('review-last', JSON.stringify(v)); } catch { /* 無痕模式等 */ } },
};

async function api(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000); // 10 秒沒回應就顯示錯誤，不要一直空白
  let res;
  try { res = await fetch(url, { signal: ctl.signal }); }
  catch (e) { throw new Error(e.name === 'AbortError' ? '伺服器沒有回應，請確認平台是否還在執行' : '無法連線到伺服器'); }
  finally { clearTimeout(timer); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---------- 畫面切換 ----------
let current = 'subject';
function show(step) {
  current = step;
  document.querySelectorAll('.step').forEach((s) => { s.hidden = s.dataset.step !== step; });
  document.body.classList.toggle('playing', step === 'play');
  const idx = BANK_STEPS.findIndex(([k]) => k === step);
  const bankFlow = S.subject !== 'O' && idx > 0;
  $('#steps').replaceChildren(...BANK_STEPS.map(([k, label], i) => el('li', { className: i === idx ? 'on' : i < idx ? 'done' : '', textContent: label })));
  $('#steps').hidden = !bankFlow;
  document.querySelectorAll('[data-game-name]').forEach((e) => { e.textContent = S.game ? `${S.subjectName}・${S.game.名稱}` : ''; });
  if (step !== 'play') { window.scrollTo(0, 0); exitFullscreen(); }
  history.replaceState(null, '', step === 'subject' ? location.pathname : `#${step}`);
}
const PREV = { games: 'subject', version: 'games', volume: 'version', chapter: 'volume', ready: 'games' };
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => show(PREV[b.closest('.step').dataset.step] || 'subject')));
$('#home-link').addEventListener('click', (e) => { e.preventDefault(); stopPlaying(); show('subject'); });

// ---------- 全螢幕 ----------
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
function enterFullscreen() {
  const root = document.documentElement;
  const req = root.requestFullscreen || root.webkitRequestFullscreen;
  if (!req || fsElement()) return;
  try {
    const p = req.call(root, { navigationUI: 'hide' });
    if (p && p.catch) p.catch(() => {}); // 不支援（例如 iPhone）時仍有網頁內全版面
  } catch { /* 忽略 */ }
}
function exitFullscreen() {
  if (!fsElement()) return;
  const ex = document.exitFullscreen || document.webkitExitFullscreen;
  try { const p = ex.call(document); if (p && p.catch) p.catch(() => {}); } catch { /* 忽略 */ }
}
function updateFsButton() {
  const on = !!fsElement();
  $('#fs-label').textContent = on ? ' 縮小' : ' 全螢幕';
  $('#fs-toggle').hidden = !(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
}
document.addEventListener('fullscreenchange', updateFsButton);
document.addEventListener('webkitfullscreenchange', updateFsButton);
$('#fs-toggle').addEventListener('click', () => (fsElement() ? exitFullscreen() : enterFullscreen()));

// ---------- 首頁：學科分區 ----------
const gamesFor = (code) => S.games.filter((g) => (code === 'O' ? !g.使用題庫 && !g.科目?.length : g.科目?.includes(code)));

async function initHome() {
  const [tree, gameData] = await Promise.all([api('/api/tree'), api('/api/games')]);
  S.games = gameData.遊戲;
  S.subjects = gameData.科目;
  S.gradeOrder = Object.values(gameData.年級 || {});
  S.counts = Object.fromEntries(tree.科目.map((s) => [s.代碼, s.題數]));
  const zone = (code, name, char, note, meta) => {
    const b = el('button', { className: `zone z-${code}`, type: 'button' },
      el('span', { className: 'zone-char', textContent: char, ariaHidden: 'true' }),
      el('span', { className: 'zone-name', textContent: name }),
      el('span', { className: 'zone-note', textContent: note }),
      el('span', { className: 'zone-meta', textContent: meta }));
    b.addEventListener('click', () => pickSubject(code, name));
    return b;
  };
  const zones = tree.科目.map((s) => {
    const n = gamesFor(s.代碼).length;
    return zone(s.代碼, s.名稱, SUBJECT_CHAR[s.代碼] || s.名稱[0], SUBJECT_NOTE[s.代碼] || '', `${s.題數} 題・${n} 個遊戲`);
  });
  const others = gamesFor('O');
  if (others.length) zones.push(zone('O', '其他', '他', '生活管理・職業教育・社會技巧・邏輯推理', `${others.length} 個遊戲`));
  $('#subject-cards').dataset.ok = '1';
  $('#subject-cards').replaceChildren(...zones);
}

// ---------- 選遊戲 ----------
function cover(g) {
  const fig = el('div', { className: 'cover' });
  if (g.封面) {
    fig.append(el('img', { src: g.封面, alt: '', loading: 'lazy', decoding: 'async' }));
  } else {
    fig.classList.add('blank');
    fig.append(el('span', { className: g.圖示 ? '' : 'blank-name', textContent: g.圖示 || g.名稱.slice(0, 1) }));
  }
  return fig;
}

function gameCard(g) {
  const noBank = g.使用題庫 && !(S.counts[S.subject] > 0);
  const b = el('button', { className: 'gcard', type: 'button', disabled: noBank },
    cover(g),
    el('span', { className: 'gbody' },
      el('span', { className: 'gname', textContent: g.名稱 }),
      g.領域 ? el('span', { className: 'gdomain', textContent: g.領域 }) : null,
      g.年級 || g.章節 || g.連結遊戲 ? el('span', { className: 'gchips' },
        g.年級 ? el('span', { className: 'gchip', textContent: g.年級 }) : null,
        g.章節 ? el('span', { className: 'gchip', textContent: g.章節 }) : null,
        g.連結遊戲 ? el('span', { className: 'gchip link', textContent: '外部連結' }) : null) : null,
      el('span', { className: 'gdesc', textContent: g.說明 }),
      el('span', { className: `gtag${g.使用題庫 ? ' bank' : ''}`, textContent: noBank ? '題庫還沒有這一科的題目' : g.使用題庫 ? '平台題庫・選範圍出題' : g.平台版 ? '內建題庫・直接開始' : '直接開始' })));
  b.dataset.id = g.id;
  b.addEventListener('click', () => pickGame(g));
  return b;
}

function pickSubject(code, name) {
  S.subject = code;
  S.subjectName = name;
  S.game = null;
  // 有標年級、章節的遊戲依年級、章節排序（沒標的維持原順序排在前面）
  const gIdx = (g) => (g.年級 ? S.gradeOrder.indexOf(g.年級) + 1 : 0);
  const list = gamesFor(code).map((g, i) => ({ g, i })).sort((a, b) => gIdx(a.g) - gIdx(b.g)
    || (a.g.章節 && b.g.章節 ? a.g.章節.localeCompare(b.g.章節, 'zh-Hant-TW', { numeric: true }) : 0) || a.i - b.i).map((x) => x.g);
  const tabs = $('#game-tabs');
  if (code === 'O') {
    $('#games-eyebrow').textContent = '其他';
    $('#games-title').textContent = '生活與特殊需求領域';
    $('#games-lede').textContent = '這些遊戲不需要選範圍，點了就能玩。';
    const cats = [...new Set([...Object.keys(OTHER_CATS), ...list.map((g) => g.分類 || '其他')])].filter((c) => list.some((g) => (g.分類 || '其他') === c));
    $('#game-list').replaceChildren(...cats.map((c) => el('section', { className: 'gsection', id: `cat-${c}` },
      el('h2', {}, c, OTHER_CATS[c] ? el('small', { textContent: OTHER_CATS[c] }) : null),
      el('div', { className: 'gcards' }, ...list.filter((g) => (g.分類 || '其他') === c).map(gameCard)))));
    tabs.replaceChildren(...cats.map((c) => {
      const chip = el('button', { className: 'chip', type: 'button', textContent: c });
      chip.addEventListener('click', () => document.getElementById(`cat-${c}`).scrollIntoView({ behavior: 'smooth' }));
      return chip;
    }));
    tabs.hidden = cats.length < 2;
  } else {
    // 同一款遊戲的「平台題庫版」與「內建題庫版」合成一張卡片，下方兩個按鈕選玩法
    const pairs = list.filter((x) => x.使用題庫).map((g) => ({ bank: g, classic: list.find((x) => x.平台版 === g.id) || null }));
    const paired = new Set(pairs.flatMap((p) => [p.bank.id, p.classic?.id]).filter(Boolean));
    const fixed = list.filter((g) => !paired.has(g.id));
    $('#games-eyebrow').textContent = `${name}・${S.counts[code] || 0} 題`;
    $('#games-title').textContent = '選一個遊戲';
    $('#games-lede').textContent = pairs.length ? '「用題庫出題」會讓你選版本與章節；「直接開始」就是遊戲內建的題目。' : '';
    const sections = [];
    if (pairs.length) sections.push(el('section', { className: 'gsection' }, el('h2', {}, '複習遊戲', el('small', { textContent: '每個遊戲可選兩種玩法' })), el('div', { className: 'gcards' }, ...pairs.map(pairCard))));
    if (fixed.length) sections.push(el('section', { className: 'gsection' }, el('h2', {}, '學科小遊戲', el('small', { textContent: '內建固定範圍，直接開始' })), el('div', { className: 'gcards' }, ...fixed.map(gameCard))));
    if (!sections.length) sections.push(el('p', { className: 'empty', textContent: '這一科目前還沒有遊戲。' }));
    $('#game-list').replaceChildren(...sections);
    tabs.hidden = true;
  }
  show('games');
}

function pairCard(p) {
  const { bank, classic } = p;
  const noBank = !(S.counts[S.subject] > 0);
  const title = bank.名稱.replace(/（(平台題庫|內建題庫)）$/, '');
  const card = el('article', { className: 'gcard pair' },
    cover(bank),
    el('div', { className: 'gbody' },
      el('span', { className: 'gname', textContent: title }),
      bank.年級 || bank.章節 ? el('span', { className: 'gchips' },
        bank.年級 ? el('span', { className: 'gchip', textContent: bank.年級 }) : null,
        bank.章節 ? el('span', { className: 'gchip', textContent: bank.章節 }) : null) : null,
      el('span', { className: 'gdesc', textContent: bank.說明 }),
      el('div', { className: 'gactions' },
        el('button', { className: 'btn small primary', type: 'button', textContent: '用題庫出題', disabled: noBank,
          title: noBank ? '題庫還沒有這一科的題目' : '選版本、章節，題目來自老師整理的題庫' }),
        classic ? el('button', { className: 'btn small', type: 'button', textContent: '直接開始', title: '遊戲內建的題目，點了就玩' }) : null)));
  const [useBank, direct] = card.querySelectorAll('button');
  card.dataset.id = bank.id;
  if (classic) card.dataset.alt = classic.id;
  useBank.addEventListener('click', () => pickGame(bank));
  if (direct) direct.addEventListener('click', () => pickGame(classic));
  return card;
}

function pickGame(g) {
  S.game = g;
  if (!g.使用題庫) { playStandalone(g); return; }
  // 已經選過同一科的範圍，就直接到「開始」，可再按「更改範圍」
  if (S.scopes.length && S.scopeSubject === S.subject) { buildReady(); return; }
  buildVersions();
}

// ---------- 不用題庫的遊戲：點了就玩 ----------
function playStandalone(g) {
  enterFullscreen();
  stopPlaying();
  S.returnTo = 'games';
  $('#play-title').textContent = g.名稱;
  const root = $('#game-root');
  root.className = 'game-root frame';
  const frame = el('iframe', { src: g.入口, title: g.名稱, allow: 'autoplay; fullscreen' });
  if (g.外部 && !g.連結遊戲) frame.setAttribute('sandbox', SANDBOX);
  root.replaceChildren(frame);
  // 外部連結（Gemini、Canva…）有些網站不允許嵌入：提供開新視窗
  if (g.連結遊戲) {
    root.append(el('div', { className: 'link-tip' }, '畫面空白或打不開？ ',
      el('a', { href: g.入口, target: '_blank', rel: 'noopener', textContent: '在新視窗開啟遊戲 ↗' })));
  }
  show('play');
  updateFsButton();
}

// ---------- 版本 ----------
async function buildVersions() {
  try {
    const data = await api(`/api/tree?subject=${encodeURIComponent(S.subject)}`);
    S.tree = data.樹;
  } catch (e) {
    S.tree = [];
  }
  $('#version-cards').replaceChildren(...S.tree.map((v) => {
    const b = el('button', { className: 'card', type: 'button' },
      el('span', { className: 'name', textContent: v.名稱 }),
      el('span', { className: 'desc', textContent: v.子層.map((g) => g.名稱).join('、') }),
      el('span', { className: 'count', textContent: `${v.題數} 題` }));
    b.addEventListener('click', () => pickVersion(v));
    return b;
  }));
  if (!S.tree.length) $('#version-cards').replaceChildren(el('p', { className: 'empty', textContent: '這一科目前還沒有題目。' }));
  if (S.tree.length === 1) { pickVersion(S.tree[0]); return; }
  show('version');
}

// ---------- 年級與冊（多選） ----------
function pickVersion(v) {
  S.version = v;
  const last = store.get();
  const keep = new Set(last && last.subject === S.subject && last.version === v.名稱 ? last.volumes : []);
  S.volumes = [];
  const update = () => { $('#volume-next').disabled = !S.volumes.length; };
  $('#volume-groups').replaceChildren(...v.子層.map((g) => el('div', { className: 'vol-group' },
    el('h3', { textContent: g.名稱 }),
    el('div', { className: 'chips' }, ...g.子層.map((vol) => {
      const chip = el('button', { className: 'chip', type: 'button' }, `${vol.名稱} `, el('small', { textContent: `${vol.題數} 題` }));
      const key = `${g.名稱}/${vol.名稱}`;
      const toggle = (on) => {
        chip.setAttribute('aria-pressed', on);
        S.volumes = S.volumes.filter((x) => x.node !== vol);
        if (on) S.volumes.push({ grade: g.名稱, node: vol, key });
        update();
      };
      chip.addEventListener('click', () => toggle(chip.getAttribute('aria-pressed') !== 'true'));
      toggle(keep.has(key) || (v.子層.length === 1 && g.子層.length === 1));
      return chip;
    })))));
  update();
  show('volume');
}
$('#volume-next').addEventListener('click', buildChapters);

// ---------- 章節樹 ----------
function buildChapters() {
  const tree = $('#chapter-tree');
  tree.replaceChildren();
  const boxes = [];
  for (const vol of S.volumes) {
    if (S.volumes.length > 1) tree.append(el('div', { className: 'vol-title', textContent: `${vol.grade} ${vol.node.名稱}` }));
    for (const ch of vol.node.子層) {
      const cb = el('input', { type: 'checkbox' });
      const secs = ch.子層.map((sec) => {
        const scb = el('input', { type: 'checkbox' });
        scb._path = sec.路徑;
        return { node: sec, cb: scb };
      });
      cb._path = ch.路徑;
      cb._secs = secs;
      const row = el('div', { className: 'ch-row' },
        el('label', {}, cb, el('span', { className: 'n', textContent: ch.名稱 }), el('span', { className: 'n-count', textContent: `${ch.題數} 題` })));
      const secBox = el('div', { className: 'secs', hidden: true }, ...secs.map((s) => el('div', { className: 'sec-row' },
        el('label', {}, s.cb, el('span', { textContent: s.node.名稱 }), el('span', { className: 'n-count', textContent: `${s.node.題數} 題` })))));
      if (secs.length) {
        const ex = el('button', { className: 'expand', type: 'button', textContent: '＋', ariaLabel: '展開小節' });
        ex.addEventListener('click', () => { secBox.hidden = !secBox.hidden; ex.textContent = secBox.hidden ? '＋' : '－'; });
        row.append(ex);
      }
      cb.addEventListener('change', () => { secs.forEach((s) => { s.cb.checked = cb.checked; }); cb.indeterminate = false; refresh(); });
      secs.forEach((s) => s.cb.addEventListener('change', () => {
        const n = secs.filter((x) => x.cb.checked).length;
        cb.checked = n === secs.length;
        cb.indeterminate = n > 0 && n < secs.length;
        refresh();
      }));
      boxes.push(cb);
      tree.append(el('div', { className: 'ch' }, row, secBox));
    }
  }
  const refresh = () => {
    S.scopes = [];
    for (const cb of boxes) {
      if (cb.checked) S.scopes.push(cb._path);
      else S.scopes.push(...cb._secs.filter((s) => s.cb.checked).map((s) => s.cb._path));
    }
    S.scopeSubject = S.subject;
    $('#chapter-next').disabled = !S.scopes.length;
  };
  const setAll = (on) => { boxes.forEach((cb) => { cb.checked = on; cb.indeterminate = false; cb._secs.forEach((s) => { s.cb.checked = on; }); }); refresh(); };
  $('#check-all').onclick = () => setAll(true);
  $('#check-none').onclick = () => setAll(false);
  setAll(false);
  show('chapter');
}
$('#chapter-next').addEventListener('click', buildReady);

// ---------- 開始 ----------
function chapterNames() {
  return [...$('#chapter-tree').querySelectorAll('.ch')].map((ch) => {
    const main = ch.querySelector('.ch-row input');
    const label = ch.querySelector('.ch-row .n').textContent;
    if (main.checked) return label;
    const secs = [...ch.querySelectorAll('.sec-row input:checked')].map((i) => i.parentElement.querySelector('span').textContent);
    return secs.length ? `${label}（${secs.join('、')}）` : null;
  }).filter(Boolean);
}

function buildReady() {
  $('#ready-cover').replaceChildren(cover(S.game));
  $('#summary').replaceChildren(el('dl', {},
    el('dt', { textContent: '遊戲' }), el('dd', { textContent: S.game.名稱 }),
    el('dt', { textContent: '學科' }), el('dd', { textContent: S.subjectName }),
    el('dt', { textContent: '版本' }), el('dd', { textContent: S.version.名稱 }),
    el('dt', { textContent: '年級冊' }), el('dd', { textContent: S.volumes.map((v) => `${v.grade} ${v.node.名稱}`).join('、') }),
    el('dt', { textContent: '章節' }), el('dd', { textContent: chapterNames().join('、') })));
  const counts = S.game.題數選項 || [5, 10, 15, 20];
  $('#count').replaceChildren(...counts.map((n) => el('option', { value: n, textContent: `${n} 題` })));
  $('#count').value = String(S.game.預設題數 || counts[0]);
  $('#ready-msg').textContent = '';
  show('ready');
}
$('#change-scope').addEventListener('click', buildVersions);

function scopeQuery(count) {
  const p = new URLSearchParams();
  S.scopes.forEach((s) => p.append('scope', s));
  p.set('subject', S.subject);
  p.set('count', count);
  return p.toString();
}

async function startGame() {
  enterFullscreen(); // 必須在點擊當下呼叫，瀏覽器才允許
  const count = Number($('#count').value) || 10;
  $('#start').disabled = true;
  $('#again').disabled = true;
  $('#ready-msg').textContent = '';
  try {
    const data = await api(`/api/questions?${scopeQuery(count)}`);
    if (!data.題目.length) throw new Error('這個範圍目前沒有題目，請換個範圍。');
    store.set({ subject: S.subject, version: S.version.名稱, volumes: S.volumes.map((v) => v.key) });
    $('#play-title').textContent = S.game.名稱;
    S.returnTo = 'ready';
    show('play');
    updateFsButton();
    await runGame(S.game, data.題目, $('#game-root'), { onFinish: showResult, onExit: () => show('ready') });
  } catch (e) {
    show('ready');
    $('#ready-msg').textContent = '無法開始：' + e.message;
  } finally {
    $('#start').disabled = false;
    $('#again').disabled = false;
  }
}
$('#start').addEventListener('click', startGame);

function stopPlaying() {
  runGame.stop?.();
  $('#game-root').replaceChildren();
}
$('#quit').addEventListener('click', () => {
  if (!confirm('確定要離開這場遊戲嗎？')) return;
  stopPlaying();
  show(S.returnTo || 'games');
});

// ---------- 結果 ----------
function showResult(r) {
  const total = r.total || 0;
  const pct = total ? Math.round((r.correct / total) * 100) : 0;
  $('#result-title').textContent = pct >= 80 ? '寫得真好。' : pct >= 50 ? '完成了，再一點點就更好。' : '完成了，再練一次吧。';
  $('#score-box').replaceChildren(
    el('div', {}, el('b', { textContent: r.score ?? 0 }), '分數'),
    el('div', {}, el('b', { textContent: `${r.correct}/${total}` }), '答對'),
    el('div', {}, el('b', { textContent: `${pct}%` }), '正確率'));
  $('#review').replaceChildren(...(r.紀錄 || []).map((x) => el('li', { className: x.correct ? 'ok' : 'bad' },
    el('span', { className: 'mark', textContent: x.correct ? '○' : '×' }),
    el('span', {}, x.題幹, x.correct ? null : el('span', { className: 'ans', textContent: `正確答案：${x.正確答案}` })))));
  show('result');
}
$('#again').addEventListener('click', startGame);
$('#other-mode').addEventListener('click', () => pickSubject(S.subject, S.subjectName));
$('#restart').addEventListener('click', buildVersions);

// ---------- 手機掃碼（同一個 Wi-Fi） ----------
const isLocalHost = () => /^(localhost|127\.|\[?::1\]?$)/.test(location.hostname);
let lanBases = null;
async function openQr() {
  const dlg = $('#qr-dialog');
  // 目前在哪個遊戲，就讓手機直接開到同一個遊戲
  const params = new URLSearchParams();
  if (S.subject) params.set('s', S.subject);
  if (S.game && ['games', 'play', 'ready', 'version', 'volume', 'chapter', 'result'].includes(current)) params.set('g', S.game.id);
  const tail = params.toString() ? `/?${params}` : '/';
  $('#qr-what').textContent = params.get('g') ? `掃描後直接開啟「${S.game.名稱}」` : params.get('s') ? `掃描後直接進入「${S.subjectName}」` : '掃描後開啟複習小書房';
  if (!lanBases) {
    try { lanBases = (await api('/api/lan')).網址 || []; } catch { lanBases = []; }
    if (!isLocalHost()) lanBases = [location.origin, ...lanBases.filter((u) => u !== location.origin)];
  }
  const pick = $('#qr-pick');
  const draw = (base) => {
    const box = $('#qr-code');
    if (!base) {
      box.replaceChildren(el('p', { className: 'msg', textContent: '找不到這台電腦的區網位址。請確認電腦已連上 Wi-Fi 或網路線，再重新開啟這個視窗。' }));
      $('#qr-url').textContent = '';
      return;
    }
    const url = base + tail;
    if (window.qrcode) {
      const qr = window.qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    } else box.replaceChildren();
    $('#qr-url').textContent = url;
  };
  pick.replaceChildren(...lanBases.map((u) => el('option', { value: u, textContent: u })));
  pick.hidden = lanBases.length < 2;
  pick.onchange = () => draw(pick.value);
  draw(lanBases[0]);
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
}
$('#qr-open').addEventListener('click', openQr);
$('#qr-play').addEventListener('click', openQr);
$('#qr-dialog').addEventListener('click', (e) => { if (e.target.id === 'qr-dialog') e.target.close(); });

// 從 QR Code 開啟：?s=科目&g=遊戲，直接帶到那一科／那個遊戲
function openFromLink() {
  const q = new URLSearchParams(location.search);
  const code = q.get('s');
  if (!code) return false;
  history.replaceState(null, '', location.pathname);
  const name = code === 'O' ? '其他' : (S.subjects?.[code] || ({ C: '國文', E: '英文', M: '數學', B: '自然', S: '社會' })[code]);
  if (!name || (code !== 'O' && S.counts[code] == null && !gamesFor(code).length)) return false;
  pickSubject(code, name);
  const g = S.games.find((x) => x.id === q.get('g'));
  if (g) {
    if (g.使用題庫) pickGame(g);
    else {
      // 直接開始的遊戲：先停在選遊戲頁並標出來，讓學生自己點（手機瀏覽器要點一下才能全螢幕、播音效）
      const card = [...document.querySelectorAll('#game-list .gcard')].find((c) => c.dataset.id === g.id || c.dataset.alt === g.id);
      if (card) { card.classList.add('flash'); card.scrollIntoView({ block: 'center' }); }
    }
  }
  return true;
}

// 題目裡的 $...$ 數學式用 KaTeX 顯示（遊戲畫面、結果檢討）
window.MathRender?.watch($('#game-root'));
window.MathRender?.watch($('#review'));

initHome().then(() => { if (!openFromLink()) show('subject'); }).catch((e) => {
  $('#subject-cards').dataset.ok = 'err';
  $('#subject-cards').replaceChildren(el('p', { className: 'msg', textContent: '無法載入：' + e.message + '（請按 Ctrl+F5 重新整理；若還是不行，請看黑色視窗有沒有紅字）' }));
  show('subject');
});
