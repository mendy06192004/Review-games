'use strict';
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, props = {}, ...kids) => {
    const e = Object.assign(document.createElement(tag), props);
    kids.flat().forEach((k) => k != null && e.append(k));
    return e;
  };
  const LETTERS = 'ABCDEFGH';
  const SCOPE_FIELDS = ['版本', '年級', '冊', '章', '節'];
  let META = null;

  async function api(url, opts = {}) {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(data.error || `HTTP ${res.status}`);
      e.details = data.details;
      throw e;
    }
    return data;
  }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  async function init() {
    META = await api('/api/admin/meta');
    for (const [k, list] of Object.entries(META.建議)) {
      const dl = $(`#dl-${k}`);
      if (dl) dl.replaceChildren(...list.map((v) => el('option', { value: v })));
    }
    await load();
  }

  async function load() {
    const list = $('#list');
    try {
      const data = await api('/api/admin/drafts');
      const showRejected = $('#showRejected').checked;
      const items = data.草稿.filter((it) => showRejected || it.題目.審核?.狀態 !== '退回');
      const needs = data.草稿.filter((it) => it.題目.needs_review).length;
      $('#summary').textContent = `共 ${data.草稿.length} 題草稿，需審核 ${needs} 題`;
      $('#broken').replaceChildren(...data.無法讀取.map((b) => el('p', { className: 'err', textContent: `⚠ 無法讀取 待審核/${b.檔案}：${b.錯誤}` })));
      list.replaceChildren(...(items.length ? items.map(card) : [el('div', { className: 'empty', textContent: '目前沒有待審核的題目 🎉' })]));
    } catch (e) {
      list.textContent = '載入失敗：' + e.message;
    }
  }

  function card(item) {
    const q = item.題目;
    const flags = new Set(q.待確認欄位 || []);
    const isFlag = (f) => flags.has(f) || [...flags].some((x) => x.startsWith(f + '.') || x.startsWith(f + '['));
    const rejected = q.審核?.狀態 === '退回';
    const c = el('article', { className: `card${q.needs_review ? ' needs' : ''}${rejected ? ' rejected' : ''}` });

    c.append(el('div', { className: 'meta' },
      q.needs_review ? el('span', { className: 'badge warn', textContent: '需審核' }) : el('span', { className: 'badge ok', textContent: '欄位完整' }),
      rejected ? el('span', { className: 'badge bad', textContent: '已退回' }) : null,
      el('span', { textContent: `來源：${item.來源檔}${q.原題號 ? ` 第 ${q.原題號} 題` : ''}` }),
      el('span', { textContent: `（${item.抽取方式}，${new Date(item.處理時間).toLocaleString()}）` }),
      item.來源位置 ? el('span', { textContent: `原檔：${item.來源位置}` }) : null,
    ));
    if (rejected) c.append(el('div', { className: 'reason', textContent: `退回原因：${q.審核.原因}` }));
    if (item.備註) c.append(el('div', { className: 'muted', textContent: `備註：${item.備註}` }));
    if (q.答案依據) c.append(el('div', { className: 'muted', textContent: `答案依據：${q.答案依據}` }));

    const g = el('div', { className: 'grid' });
    const field = (label, input, flagName) => {
      if (flagName && isFlag(flagName)) input.classList.add('flag');
      g.append(el('label', { textContent: label }), input);
      return input;
    };

    // 科目 + id
    const subj = el('select', {}, el('option', { value: '', textContent: '（請選擇）' }),
      ...Object.entries(META.科目).map(([k, v]) => el('option', { value: k, textContent: `${v}（${k}）` })));
    subj.value = q.科目代碼 || (q.id ? q.id.split('-')[0] : '');
    field('科目', subj, '科目');
    const idInput = el('input', { type: 'text', value: q.id || '', placeholder: '例如 M-N2-0154；留空則通過時自動編號' });
    const idBtn = el('button', { type: 'button', className: 'small', textContent: '自動編號' });
    const idRow = el('div', { className: 'row' }, idInput, idBtn);
    if (isFlag('id')) idInput.classList.add('flag');
    g.append(el('label', { textContent: 'id' }), idRow);

    const stem = field('題幹', el('textarea', { value: q.題幹 || '' }), '題幹');

    // 選項 + 答案
    const optsBox = el('div', { className: 'opts' });
    const name = 'ans-' + q.草稿編號;
    const addOpt = (text = '', checked = false) => {
      const radio = el('input', { type: 'radio', name, checked, title: '設為正確答案' });
      const input = el('input', { type: 'text', value: text });
      const del = el('button', { type: 'button', className: 'small', textContent: '刪除' });
      const row = el('div', { className: 'opt' }, radio, el('span', { className: 'letter' }), input, del);
      del.onclick = () => { row.remove(); relabel(); };
      optsBox.append(row);
      relabel();
    };
    const relabel = () => [...optsBox.children].forEach((r, i) => { r.querySelector('.letter').textContent = LETTERS[i] || '?'; });
    (q.選項 || []).forEach((o, i) => addOpt(o, q.答案 === i));
    const addBtn = el('button', { type: 'button', className: 'small', textContent: '＋ 新增選項' });
    addBtn.onclick = () => addOpt();
    const optWrap = el('div', {}, optsBox, el('div', { className: 'muted', style: 'font-size:.85rem;margin-top:4px', textContent: '點選左邊圓圈設定正確答案' }), addBtn);
    if (isFlag('選項') || isFlag('答案')) optWrap.classList.add('flag');
    g.append(el('label', { textContent: '選項 / 答案' }), optWrap);

    const diff = el('select', {}, el('option', { value: '', textContent: '（未設定）' }), ...[1, 2, 3].map((n) => el('option', { value: n, textContent: ['', '1 基礎', '2 中等', '3 進階'][n] })));
    diff.value = q.難度 || '';
    field('難度', diff, '難度');

    const imgInput = el('input', { type: 'text', value: q.圖片 || '', placeholder: '相對於 圖片/ 的路徑，可留空' });
    const imgPrev = el('img', { className: 'img', alt: '題目圖片' });
    const updImg = () => { imgPrev.hidden = !imgInput.value; if (imgInput.value) imgPrev.src = '/media/' + imgInput.value.split('/').map(encodeURIComponent).join('/'); };
    imgInput.oninput = updImg;
    updImg();
    if (isFlag('圖片')) imgInput.classList.add('flag');
    const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', hidden: true });
    const upBtn = el('button', { type: 'button', className: 'small', textContent: '上傳圖片' });
    const clrBtn = el('button', { type: 'button', className: 'small', textContent: '移除圖片' });
    upBtn.onclick = () => file.click();
    clrBtn.onclick = () => { imgInput.value = ''; updImg(); };
    file.onchange = async () => {
      const f = file.files[0];
      if (!f) return;
      try {
        const res = await fetch('/api/admin/images', { method: 'POST', headers: { 'Content-Type': f.type }, body: f });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        imgInput.value = data.圖片;
        imgInput.classList.remove('flag');
        updImg();
        toast('圖片已上傳，記得按「儲存」或「通過」');
      } catch (e) { toast('上傳失敗：' + e.message); }
      file.value = '';
    };
    g.append(el('label', { textContent: '圖片' }), el('div', {}, el('div', { className: 'row' }, imgInput, upBtn, clrBtn), file, imgPrev));

    const expl = field('解析', el('textarea', { value: q.解析 || '', placeholder: '選填' }));

    // 歸屬（可多個）
    const scopes = el('div', { className: 'scopes' });
    const addScope = (a = {}) => {
      const inputs = SCOPE_FIELDS.map((f) => {
        const i = el('input', { type: 'text', value: a[f] || '', placeholder: f + (f === '節' ? '（選填）' : '') });
        if (f !== '節') i.setAttribute('list', `dl-${f}`);
        if (f !== '節' && !a[f] && scopes.children.length === 0 && isFlag('歸屬')) i.classList.add('flag');
        return i;
      });
      const del = el('button', { type: 'button', className: 'small', textContent: '移除' });
      const row = el('div', { className: 'scope' }, ...inputs, del);
      row._inputs = inputs;
      del.onclick = () => row.remove();
      scopes.append(row);
    };
    (q.歸屬 && q.歸屬.length ? q.歸屬 : [{}]).forEach(addScope);
    const addScopeBtn = el('button', { type: 'button', className: 'small', textContent: '＋ 新增歸屬（同一題放到其他版本或章節）' });
    addScopeBtn.onclick = () => addScope();
    g.append(el('label', { textContent: '歸屬' }), el('div', {},
      el('div', { className: 'scope-head' }, ...SCOPE_FIELDS.map((f) => el('span', { textContent: f })), el('span')), scopes, addScopeBtn));

    c.append(g);
    const errBox = el('div', { className: 'err' });
    c.append(errBox);

    const collect = () => {
      const rows = [...optsBox.children];
      const ansIdx = rows.findIndex((r) => r.querySelector('input[type=radio]').checked);
      return {
        科目代碼: subj.value || null,
        id: idInput.value.trim() || null,
        題幹: stem.value.trim(),
        選項: rows.map((r) => r.querySelector('input[type=text]').value.trim()),
        答案: ansIdx >= 0 ? ansIdx : null,
        難度: diff.value ? Number(diff.value) : null,
        圖片: imgInput.value.trim() || null,
        解析: expl.value.trim() || null,
        歸屬: [...scopes.children].map((r) => Object.fromEntries(SCOPE_FIELDS.map((f, i) => [f, r._inputs[i].value.trim() || null]))),
      };
    };

    idBtn.onclick = async () => {
      try {
        const d = collect();
        const r = await api(`/api/admin/next-id?subject=${encodeURIComponent(d.科目代碼 || '')}&grade=${encodeURIComponent(d.歸屬[0]?.年級 || '')}`);
        idInput.value = r.id;
        idInput.classList.remove('flag');
      } catch (e) { errBox.textContent = e.message; }
    };

    const btn = (text, cls, fn) => {
      const b = el('button', { type: 'button', className: cls, textContent: text });
      b.onclick = async () => {
        errBox.textContent = '';
        c.querySelectorAll('button').forEach((x) => { x.disabled = true; });
        try { await fn(); } catch (e) {
          errBox.textContent = e.message + (e.details ? '\n・' + e.details.join('\n・') : '');
        } finally { c.querySelectorAll('button').forEach((x) => { x.disabled = false; }); }
      };
      return b;
    };
    const url = `/api/admin/drafts/${encodeURIComponent(q.草稿編號)}`;
    c.append(el('div', { className: 'actions' },
      btn('儲存', '', async () => {
        await api(url, { method: 'PUT', body: JSON.stringify(collect()) });
        toast('已儲存');
        await load();
      }),
      btn('退回', 'danger', async () => {
        const reason = prompt('請註明退回原因（題目會保留在待審核）：', q.審核?.原因 || '');
        if (reason === null) return;
        await api(url + '/reject', { method: 'POST', body: JSON.stringify({ 原因: reason, 題目: collect() }) });
        toast('已退回');
        await load();
      }),
      btn('通過 ✓', 'primary', async () => {
        const r = await api(url + '/approve', { method: 'POST', body: JSON.stringify({ 題目: collect() }) });
        toast(`已通過：${r.id} → ${r.檔案}（題庫共 ${r.題目總數} 題）`);
        await load();
      }),
    ));
    return c;
  }

  $('#reload').onclick = load;
  $('#showRejected').onchange = load;
  init().catch((e) => { $('#list').textContent = '載入失敗：' + e.message; });
})();
