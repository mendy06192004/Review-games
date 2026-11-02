// 學生端選範圍流程：科目 → 版本 → 年級與冊 → 章節 → 遊戲模式 → 開始
import { runGame } from './games/host.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  kids.flat().forEach((k) => k != null && e.append(k));
  return e;
};
const SUBJECT_ICON = { C: '📖', E: '🔤', M: '🧮' };
const STEPS = [['subject', '科目'], ['version', '版本'], ['volume', '年級與冊'], ['chapter', '章節'], ['mode', '遊戲'], ['ready', '開始']];

const S = { subject: null, subjectName: '', tree: [], version: null, volumes: [], scopes: [], game: null, games: [], count: 10 };
const store = {
  get() { try { return JSON.parse(localStorage.getItem('review-last') || 'null'); } catch { return null; } },
  set(v) { try { localStorage.setItem('review-last', JSON.stringify(v)); } catch { /* 無痕模式等 */ } },
};

async function api(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function show(step) {
  document.querySelectorAll('.step').forEach((s) => { s.hidden = s.dataset.step !== step; });
  const idx = STEPS.findIndex(([k]) => k === step);
  $('#steps').replaceChildren(...STEPS.map(([k, label], i) => el('li', { className: i === idx ? 'on' : i < idx ? 'done' : '', textContent: `${i + 1}. ${label}` })));
  $('#steps').hidden = idx < 0;
  window.scrollTo(0, 0);
  history.replaceState(null, '', step === 'subject' ? location.pathname : `#${step}`);
}
const PREV = { others: 'subject', version: 'subject', volume: 'version', chapter: 'volume', mode: 'chapter', ready: 'mode' };
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => {
  const cur = b.closest('.step').dataset.step;
  show(PREV[cur] || 'subject');
}));
$('#home-link').addEventListener('click', (e) => { e.preventDefault(); show('subject'); });

// ---------- 1. 科目 ----------
async function initSubjects() {
  const [tree, games] = await Promise.all([api('/api/tree'), api('/games/registry.json')]);
  S.games = games;
  $('#subject-cards').replaceChildren(...tree.科目.map((s) => {
    const b = el('button', { className: `card subj-${s.代碼}`, disabled: !s.題數 },
      el('span', { className: 'count', textContent: `${s.題數} 題` }),
      el('span', { className: 'icon', textContent: SUBJECT_ICON[s.代碼] || '📘' }),
      el('span', { className: 'name', textContent: s.名稱 }));
    b.addEventListener('click', () => pickSubject(s.代碼, s.名稱));
    return b;
  }));
  const others = games.filter((g) => g.類型 === 'standalone');
  if (others.length) {
    const b = el('button', { className: 'card subj-O' },
      el('span', { className: 'count', textContent: `${others.length} 個遊戲` }),
      el('span', { className: 'icon', textContent: '🧩' }),
      el('span', { className: 'name', textContent: '其他' }),
      el('span', { className: 'desc', textContent: '生活管理・職業教育・社會技巧・學科練習' }));
    b.addEventListener('click', buildOthers);
    $('#subject-cards').append(b);
  }
}

// ---------- 其他：特殊需求領域等，不需選範圍 ----------
const CATEGORY = {
  生活管理: '自我照顧、居家生活、時間管理、社區與交通安全',
  職業教育: '職業探索、職前技能',
  社會技巧: '人際互動、拒絕誘惑、自我保護',
  學科練習: '內建固定範圍的學科小遊戲（不使用題庫資料夾）',
};
function buildOthers() {
  const games = S.games.filter((g) => g.類型 === 'standalone');
  const cats = [...new Set([...Object.keys(CATEGORY), ...games.map((g) => g.分類 || '其他')])]
    .filter((c) => games.some((g) => (g.分類 || '其他') === c));
  const list = $('#other-list');
  list.replaceChildren(...cats.map((c) => el('section', { className: 'cat', id: `cat-${c}` },
    el('h2', { textContent: c }),
    CATEGORY[c] ? el('p', { textContent: CATEGORY[c] }) : null,
    el('div', { className: 'cards' }, ...games.filter((g) => (g.分類 || '其他') === c).map((g) => {
      const b = el('button', { className: 'card' },
        el('span', { className: 'icon', textContent: g.圖示 }),
        el('span', { className: 'name', textContent: g.名稱 }),
        g.領域 ? el('span', { className: 'domain', textContent: g.領域 }) : null,
        el('span', { className: 'desc', textContent: g.說明 }));
      b.addEventListener('click', () => playStandalone(g));
      return b;
    })))));
  $('#other-tabs').replaceChildren(...cats.map((c) => {
    const chip = el('button', { className: 'chip', type: 'button', textContent: c });
    chip.addEventListener('click', () => document.getElementById(`cat-${c}`).scrollIntoView({ behavior: 'smooth' }));
    return chip;
  }));
  show('others');
}

function playStandalone(g) {
  runGame.stop?.();
  S.returnTo = 'others';
  $('#play-title').textContent = g.名稱;
  const root = $('#game-root');
  root.className = 'game-root frame';
  root.replaceChildren(el('iframe', { src: g.入口, title: g.名稱, allow: 'autoplay; fullscreen' }));
  show('play');
}

// ---------- 2. 版本 ----------
async function pickSubject(code, name) {
  S.subject = code;
  S.subjectName = name;
  const data = await api(`/api/tree?subject=${encodeURIComponent(code)}`);
  S.tree = data.樹;
  $('#version-cards').replaceChildren(...S.tree.map((v) => {
    const b = el('button', { className: 'card' },
      el('span', { className: 'count', textContent: `${v.題數} 題` }),
      el('span', { className: 'name', textContent: v.名稱 }),
      el('span', { className: 'desc', textContent: v.子層.map((g) => g.名稱).join('、') }));
    b.addEventListener('click', () => pickVersion(v));
    return b;
  }));
  if (!S.tree.length) $('#version-cards').replaceChildren(el('p', { textContent: '這一科目前還沒有題目。' }));
  show('version');
}

// ---------- 3. 年級與冊（多選） ----------
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

// ---------- 4. 章節樹 ----------
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
        const ex = el('button', { className: 'expand', type: 'button', textContent: '▸', ariaLabel: '展開小節' });
        ex.addEventListener('click', () => { secBox.hidden = !secBox.hidden; ex.textContent = secBox.hidden ? '▸' : '▾'; });
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
    $('#chapter-next').disabled = !S.scopes.length;
  };
  const setAll = (on) => { boxes.forEach((cb) => { cb.checked = on; cb.indeterminate = false; cb._secs.forEach((s) => { s.cb.checked = on; }); }); refresh(); };
  $('#check-all').onclick = () => setAll(true);
  $('#check-none').onclick = () => setAll(false);
  setAll(false);
  show('chapter');
}
$('#chapter-next').addEventListener('click', buildModes);

// ---------- 5. 遊戲模式 ----------
function buildModes() {
  const list = S.games.filter((g) => g.類型 !== 'standalone' && (!g.科目 || g.科目.includes(S.subject)));
  $('#mode-cards').replaceChildren(...list.map((g) => {
    const b = el('button', { className: 'card' },
      el('span', { className: 'icon', textContent: g.圖示 }),
      el('span', { className: 'name', textContent: g.名稱 }),
      el('span', { className: 'desc', textContent: g.說明 }));
    b.addEventListener('click', () => { S.game = g; buildReady(); });
    return b;
  }));
  show('mode');
}

// ---------- 6. 開始 ----------
function buildReady() {
  const names = [...$('#chapter-tree').querySelectorAll('.ch')].map((ch) => {
    const main = ch.querySelector('.ch-row input');
    const label = ch.querySelector('.ch-row .n').textContent;
    if (main.checked) return label;
    const secs = [...ch.querySelectorAll('.sec-row input:checked')].map((i) => i.parentElement.querySelector('span').textContent);
    return secs.length ? `${label}（${secs.join('、')}）` : null;
  }).filter(Boolean);
  $('#summary').replaceChildren(el('dl', {},
    el('dt', { textContent: '科目' }), el('dd', { textContent: S.subjectName }),
    el('dt', { textContent: '版本' }), el('dd', { textContent: S.version.名稱 }),
    el('dt', { textContent: '年級與冊' }), el('dd', { textContent: S.volumes.map((v) => `${v.grade} ${v.node.名稱}`).join('、') }),
    el('dt', { textContent: '章節' }), el('dd', { textContent: names.join('、') }),
    el('dt', { textContent: '遊戲' }), el('dd', { textContent: S.game.名稱 })));
  const counts = S.game.題數選項 || [5, 10, 15, 20];
  $('#count').replaceChildren(...counts.map((n) => el('option', { value: n, textContent: `${n} 題` })));
  $('#count').value = String(S.game.預設題數 || 10);
  $('#ready-msg').textContent = '';
  show('ready');
}

function scopeQuery(count) {
  const p = new URLSearchParams();
  S.scopes.forEach((s) => p.append('scope', s));
  p.set('subject', S.subject);
  p.set('count', count);
  return p.toString();
}

async function startGame() {
  const count = Number($('#count').value) || 10;
  $('#start').disabled = true;
  $('#ready-msg').textContent = '';
  try {
    const data = await api(`/api/questions?${scopeQuery(count)}`);
    if (!data.題目.length) { $('#ready-msg').textContent = '這個範圍目前沒有題目，請換個範圍。'; return; }
    store.set({ subject: S.subject, version: S.version.名稱, volumes: S.volumes.map((v) => v.key) });
    $('#play-title').textContent = S.game.名稱;
    S.returnTo = 'mode';
    show('play');
    await runGame(S.game, data.題目, $('#game-root'), { onFinish: showResult, onExit: () => show('mode') });
  } catch (e) {
    show('ready');
    $('#ready-msg').textContent = '無法開始：' + e.message;
  } finally {
    $('#start').disabled = false;
  }
}
$('#start').addEventListener('click', startGame);
$('#quit').addEventListener('click', () => {
  if (!confirm('確定要離開這場遊戲嗎？')) return;
  runGame.stop?.();
  $('#game-root').replaceChildren();
  show(S.returnTo || 'mode');
});

// ---------- 結果 ----------
function showResult(r) {
  const total = r.total || 0;
  const pct = total ? Math.round((r.correct / total) * 100) : 0;
  $('#result-title').textContent = pct >= 80 ? '太厲害了！🎉' : pct >= 50 ? '完成！繼續加油 💪' : '完成！再練習一次吧 📚';
  $('#score-box').replaceChildren(
    el('div', {}, el('b', { textContent: r.score ?? 0 }), '分數'),
    el('div', {}, el('b', { textContent: `${r.correct}/${total}` }), '答對題數'),
    el('div', {}, el('b', { textContent: `${pct}%` }), '正確率'));
  $('#review').replaceChildren(...(r.紀錄 || []).map((x) => el('li', {},
    el('span', { className: x.correct ? 'ok' : 'bad', textContent: x.correct ? '✔ ' : '✘ ' }),
    x.題幹,
    x.correct ? null : el('div', { className: 'ans', textContent: `正確答案：${x.正確答案}` }))));
  show('result');
}
$('#again').addEventListener('click', startGame);
$('#other-mode').addEventListener('click', () => show('mode'));
$('#restart').addEventListener('click', () => show('subject'));

initSubjects().then(() => show('subject')).catch((e) => {
  $('#subject-cards').replaceChildren(el('p', { className: 'msg', textContent: '無法載入題庫：' + e.message }));
  show('subject');
});
