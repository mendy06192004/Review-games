// 後台：遊戲管理（新增、審核、發布、下架、預覽）
import { iframeGame } from '/games/_shared/iframe-game.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  kids.flat().forEach((k) => k != null && e.append(k));
  return e;
};
let META = null;

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 3000);
}
const BADGE = { 待審核: 'warn', 已發布: 'ok', 已退回: 'bad', 已下架: 'muted' };
const size = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
const time = (s) => (s ? new Date(s).toLocaleString('zh-TW', { hour12: false }) : '');

async function load() {
  try {
    const data = await api('/api/admin/games');
    META = data;
    const pending = data.遊戲.filter((g) => g.狀態 === '待審核').length;
    $('#summary').textContent = `共 ${data.遊戲.length} 個上傳遊戲，待審核 ${pending} 個`;
    $('#list').replaceChildren(...(data.遊戲.length ? data.遊戲.map(card) : [el('div', { className: 'empty', textContent: '還沒有上傳的遊戲。內建的 15 個遊戲不會列在這裡。' })]));
  } catch (e) {
    $('#list').textContent = '載入失敗：' + e.message;
  }
}

function card(g) {
  const c = el('article', { className: `card game${g.狀態 === '待審核' ? ' needs' : ''}${g.狀態 === '已退回' ? ' rejected' : ''}${g.狀態 === '已下架' ? ' done' : ''}` });
  const thumb = el('div', { className: 'thumb' }, g.有封面 ? el('img', { src: `/api/admin/games/${g.id}/cover?t=${encodeURIComponent(g.更新時間)}`, alt: '' }) : el('span', { textContent: g.圖示 || '🎮' }));
  const subj = (g.科目 || []).map((s) => META.科目[s] || s).join('、');
  const info = el('div', { className: 'ginfo' },
    el('div', { className: 'meta' },
      el('span', { className: `badge ${BADGE[g.狀態] || ''}`, textContent: g.狀態 }),
      el('span', { textContent: g.來源 === '老師投稿' ? `投稿：${g.投稿者 || '未署名'}` : `管理員新增${g.投稿者 ? `（作者 ${g.投稿者}）` : ''}` }),
      g.聯絡 ? el('span', { textContent: g.聯絡 }) : null,
      el('span', { textContent: time(g.建立時間) })),
    el('h3', { textContent: `${g.圖示 || ''} ${g.名稱}` }),
    el('p', { textContent: g.說明 || '（沒有說明）' }),
    el('div', { className: 'meta' },
      el('span', { textContent: `分類：${g.分類}` }),
      g.領域 ? el('span', { textContent: `領域：${g.領域}` }) : null,
      el('span', { textContent: g.使用題庫 ? `使用題庫：${subj}` : `不使用題庫${subj ? `（顯示於 ${subj}）` : ''}` }),
      el('span', { textContent: `${g.檔案數} 個檔案・${size(g.大小 || 0)}` })),
    g.給管理員的話 ? el('p', { className: 'note', textContent: `投稿留言：${g.給管理員的話}` }) : null,
    g.退回原因 && g.狀態 === '已退回' ? el('div', { className: 'reason', textContent: `退回原因：${g.退回原因}` }) : null);
  const btn = (label, cls, fn) => {
    const b = el('button', { type: 'button', className: cls || '', textContent: label });
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await fn(); } catch (e) { toast(e.message); } finally { b.disabled = false; }
    });
    return b;
  };
  const actions = el('div', { className: 'actions' },
    btn('預覽試玩', '', () => preview(g)),
    btn('編輯', '', () => edit(c, g)),
    g.狀態 !== '已發布' ? btn('發布', 'primary', async () => { await api(`/api/admin/games/${g.id}/publish`, { method: 'POST' }); toast(`已發布「${g.名稱}」，學生端重新整理就看得到`); load(); }) : null,
    g.狀態 === '待審核' ? btn('退回', 'danger', async () => {
      const reason = prompt('退回原因（投稿老師會需要知道要改什麼）：');
      if (!reason) return;
      await api(`/api/admin/games/${g.id}/reject`, { method: 'POST', body: JSON.stringify({ 原因: reason }) });
      toast('已退回'); load();
    }) : null,
    g.狀態 === '已發布' ? btn('下架', 'danger', async () => { await api(`/api/admin/games/${g.id}/unpublish`, { method: 'POST' }); toast('已下架'); load(); }) : null,
    btn('刪除', 'danger', async () => {
      if (!confirm(`確定要永久刪除「${g.名稱}」嗎？檔案會一起刪除，無法復原。`)) return;
      await api(`/api/admin/games/${g.id}`, { method: 'DELETE' });
      toast('已刪除'); load();
    }));
  c.append(el('div', { className: 'grow' }, thumb, info), actions);
  return c;
}

function edit(c, g) {
  if (c.querySelector('.gf')) return;
  const form = window.GameForm.build(META, { mode: 'edit', initial: g });
  const box = el('div', { className: 'edit-box' }, form.el);
  const save = el('button', { type: 'button', className: 'primary', textContent: '儲存' });
  const cancel = el('button', { type: 'button', textContent: '取消' });
  cancel.onclick = () => box.remove();
  save.onclick = async () => {
    save.disabled = true;
    try {
      const body = await form.collect();
      save.textContent = '上傳中…';
      const r = await api(`/api/admin/games/${g.id}`, { method: 'PUT', body: JSON.stringify(body) });
      toast(r.略過的檔案?.length ? `已儲存（略過 ${r.略過的檔案.length} 個不支援的檔案）` : '已儲存');
      load();
    } catch (e) { form.showError(e.message); } finally { save.disabled = false; save.textContent = '儲存'; }
  };
  box.append(el('div', { className: 'actions' }, cancel, save));
  c.append(box);
}

// ---------- 新增 ----------
let addForm = null;
$('#add').addEventListener('click', () => {
  addForm = window.GameForm.build(META, { mode: 'admin' });
  $('#add-form').replaceChildren(addForm.el);
  $('#add-box').hidden = false;
  $('#add-box').scrollIntoView({ behavior: 'smooth' });
});
$('#add-cancel').addEventListener('click', () => { $('#add-box').hidden = true; });
$('#add-save').addEventListener('click', async () => {
  const b = $('#add-save');
  b.disabled = true;
  try {
    const body = await addForm.collect();
    b.textContent = '上傳中…';
    const r = await api('/api/admin/games', { method: 'POST', body: JSON.stringify(body) });
    $('#add-box').hidden = true;
    toast(`已新增「${r.遊戲.名稱}」（${r.遊戲.狀態}）${r.略過的檔案.length ? `，略過 ${r.略過的檔案.length} 個不支援的檔案` : ''}`);
    load();
  } catch (e) { addForm.showError(e.message); } finally { b.disabled = false; b.textContent = '上傳'; }
});

// ---------- 預覽（題庫遊戲會用題庫裡的題目試玩，答題結果不記錄） ----------
let previewGame = null;
async function sampleQuestions(subjects) {
  for (const s of subjects || []) {
    const tree = await api(`/api/tree?subject=${encodeURIComponent(s)}`);
    if (!tree.樹.length) continue;
    const p = new URLSearchParams();
    tree.樹.forEach((v) => p.append('scope', v.路徑));
    p.set('subject', s);
    p.set('count', 10);
    const data = await api(`/api/questions?${p}`);
    if (data.題目.length) return data.題目;
  }
  return [];
}
async function preview(g) {
  const root = $('#preview-root');
  const url = `/admin/preview/${g.id}/index.html`;
  $('#preview-title').textContent = g.名稱;
  $('#preview-note').textContent = '';
  closePreview();
  if (g.使用題庫) {
    const qs = await sampleQuestions(g.科目);
    $('#preview-note').textContent = qs.length ? `以題庫中 ${qs.length} 題試玩` : '題庫裡沒有適用科目的題目，遊戲會顯示提示畫面';
    const host = {
      root,
      async check(id, choice) {
        const r = await api('/api/check', { method: 'POST', body: JSON.stringify({ answers: [{ id, choice }] }) });
        return r.results[0];
      },
      finish(result) { toast(`遊戲結束：答對 ${result.correct}/${result.total}`); },
      exit() { closePreview(); $('#preview').close(); },
    };
    previewGame = iframeGame(url, { sandbox: true })(host);
    previewGame.start(qs);
    previewGame.render();
  } else {
    const f = el('iframe', { src: url, title: g.名稱, allow: 'autoplay; fullscreen' });
    f.setAttribute('sandbox', 'allow-scripts allow-pointer-lock allow-forms allow-modals allow-popups allow-downloads');
    root.replaceChildren(f);
  }
  $('#preview').showModal();
}
function closePreview() {
  previewGame?.destroy?.();
  previewGame = null;
  $('#preview-root').replaceChildren();
}
$('#preview-close').addEventListener('click', () => { closePreview(); $('#preview').close(); });
$('#preview').addEventListener('close', closePreview);

load();
