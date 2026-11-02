'use strict';
/* 國英數複習平台前端：純 JavaScript，不需編譯。 */
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...children) => {
    const e = Object.assign(document.createElement(tag), props);
    children.forEach((c) => e.append(c));
    return e;
  };
  const DIFF = { 1: '★ 基礎', 2: '★★ 中等', 3: '★★★ 進階' };

  const state = { subjects: new Set(), scopes: [], count: 10, questions: [], i: 0, results: [] };

  async function api(url, opts) {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function show(section) {
    ['setup', 'quiz', 'result'].forEach((s) => { $(s).hidden = s !== section; });
  }

  // ---------- 範圍樹 ----------
  let subjectsRendered = false;

  async function loadTree() {
    const qs = [...state.subjects].map((s) => `subject=${encodeURIComponent(s)}`).join('&');
    const keep = collectScopes();
    try {
      const data = await api('/api/tree' + (qs ? '?' + qs : ''));
      $('updated').textContent = `題庫共 ${data.題目總數} 題 · 更新於 ${new Date(data.更新時間).toLocaleString()}`;
      if (!subjectsRendered) renderSubjects(data.科目);
      renderTree(data.樹, new Set(keep));
    } catch (e) {
      $('tree').textContent = '無法載入範圍：' + e.message;
    }
  }

  function renderSubjects(list) {
    subjectsRendered = true;
    const box = $('subjects');
    box.replaceChildren();
    list.forEach((s) => {
      const cb = el('input', { type: 'checkbox', value: s.代碼 });
      cb.addEventListener('change', () => {
        cb.checked ? state.subjects.add(s.代碼) : state.subjects.delete(s.代碼);
        loadTree();
      });
      box.append(el('label', {}, cb, `${s.名稱}（${s.題數}）`));
    });
    box.append(el('span', { className: 'muted', textContent: '不勾選＝全部科目' }));
  }

  function renderTree(nodes, checkedPaths) {
    const root = $('tree');
    root.replaceChildren();
    if (!nodes.length) { root.textContent = '目前沒有符合的題目。'; return; }
    root.append(buildList(nodes, 0));
    // 恢復先前的勾選
    root.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      if (checkedPaths.has(cb.value)) setChecked(cb, true);
    });
    root.querySelectorAll('input[type=checkbox]').forEach(refreshAncestors);
  }

  function buildList(nodes, depth) {
    const ul = el('ul');
    nodes.forEach((n) => {
      const id = 'n' + Math.random().toString(36).slice(2);
      const cb = el('input', { type: 'checkbox', value: n.路徑, id });
      cb.addEventListener('change', () => { setChecked(cb, cb.checked); refreshAncestors(cb); });
      const li = el('li');
      const row = el('div', { className: 'node' });
      let childList = null;
      if (n.子層.length) {
        childList = buildList(n.子層, depth + 1);
        childList.hidden = depth >= 1; // 預設展開到「年級」
        const tg = el('button', { type: 'button', className: 'toggle', textContent: childList.hidden ? '▸' : '▾' });
        tg.setAttribute('aria-label', '展開/收合');
        tg.addEventListener('click', () => { childList.hidden = !childList.hidden; tg.textContent = childList.hidden ? '▸' : '▾'; });
        row.append(tg);
      } else {
        row.append(el('span', { className: 'spacer' }));
      }
      row.append(cb, el('label', { htmlFor: id }, n.名稱, el('span', { className: 'count', textContent: `${n.題數} 題` })));
      li.append(row);
      if (childList) li.append(childList);
      ul.append(li);
    });
    return ul;
  }

  const childBoxes = (cb) => {
    const ul = cb.closest('li').querySelector(':scope > ul');
    return ul ? [...ul.querySelectorAll(':scope > li > .node > input')] : [];
  };
  const parentBox = (cb) => {
    const li = cb.closest('li').parentElement.closest('li');
    return li ? li.querySelector(':scope > .node > input') : null;
  };

  function setChecked(cb, on) {
    cb.checked = on; cb.indeterminate = false;
    childBoxes(cb).forEach((c) => setChecked(c, on));
  }

  function refreshAncestors(cb) {
    let p = parentBox(cb);
    while (p) {
      const kids = childBoxes(p);
      const all = kids.every((k) => k.checked);
      const some = kids.some((k) => k.checked || k.indeterminate);
      p.checked = all; p.indeterminate = !all && some;
      p = parentBox(p);
    }
  }

  /** 取得勾選的最上層範圍（上層已勾就不再列出下層） */
  function collectScopes() {
    const out = [];
    const walk = (ul) => {
      if (!ul) return;
      ul.querySelectorAll(':scope > li').forEach((li) => {
        const cb = li.querySelector(':scope > .node > input');
        if (cb.checked) out.push(cb.value);
        else walk(li.querySelector(':scope > ul'));
      });
    };
    walk($('tree').querySelector(':scope > ul'));
    return out;
  }

  // ---------- 出題與作答 ----------
  async function start(useLast) {
    $('setup-msg').textContent = '';
    if (!useLast) {
      state.scopes = collectScopes();
      state.count = Math.max(1, Number($('count').value) || 10);
    }
    if (!state.scopes.length) { $('setup-msg').textContent = '請至少勾選一個範圍。'; return; }

    const params = new URLSearchParams();
    state.scopes.forEach((s) => params.append('scope', s));
    params.set('count', state.count);
    if (state.subjects.size) params.set('subject', [...state.subjects].join(','));

    $('start').disabled = true;
    try {
      const data = await api('/api/questions?' + params);
      if (!data.題目.length) { show('setup'); $('setup-msg').textContent = '這個範圍沒有符合的題目。'; return; }
      Object.assign(state, { questions: data.題目, i: 0, results: [] });
      show('quiz');
      renderQuestion();
    } catch (e) {
      show('setup');
      $('setup-msg').textContent = '出題失敗：' + e.message;
    } finally {
      $('start').disabled = false;
    }
  }

  function renderQuestion() {
    const q = state.questions[state.i];
    const n = state.questions.length;
    $('progress-text').textContent = `第 ${state.i + 1} / ${n} 題`;
    $('progress-bar').style.width = `${(state.i / n) * 100}%`;
    $('q-subject').textContent = q.科目;
    $('q-difficulty').textContent = DIFF[q.難度] || '';
    $('q-stem').textContent = q.題幹;
    const img = $('q-image');
    img.hidden = !q.圖片;
    if (q.圖片) img.src = q.圖片; else img.removeAttribute('src');
    $('feedback').hidden = true;
    $('next').hidden = true;

    const list = $('q-options');
    list.replaceChildren();
    q.選項.forEach((text, idx) => {
      const b = el('button', { type: 'button' }, el('span', { className: 'no', textContent: `(${String.fromCharCode(65 + idx)})` }), text);
      b.addEventListener('click', () => answer(idx));
      list.append(el('li', {}, b));
    });
  }

  async function answer(choice) {
    const q = state.questions[state.i];
    const buttons = [...$('q-options').querySelectorAll('button')];
    buttons.forEach((b) => { b.disabled = true; });
    const fb = $('feedback');
    try {
      const data = await api('/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: [{ id: q.id, choice }] }),
      });
      const r = data.results[0];
      if (r.error) throw new Error(r.error);
      buttons[r.答案].classList.add('correct');
      if (!r.correct) buttons[choice].classList.add('wrong');
      fb.className = 'feedback ' + (r.correct ? 'ok' : 'bad');
      fb.replaceChildren(
        el('strong', { textContent: r.correct ? '答對了！' : `答錯了，正確答案是 (${String.fromCharCode(65 + r.答案)})` }),
        r.解析 ? '\n' + r.解析 : '',
      );
      state.results.push({ q, choice, correct: r.correct, answer: r.答案 });
    } catch (e) {
      fb.className = 'feedback bad';
      fb.textContent = '無法驗證答案：' + e.message;
      buttons.forEach((b) => { b.disabled = false; });
      fb.hidden = false;
      return;
    }
    fb.hidden = false;
    $('next').textContent = state.i + 1 < state.questions.length ? '下一題' : '看結果';
    $('next').hidden = false;
    $('next').focus();
  }

  function next() {
    state.i++;
    if (state.i < state.questions.length) renderQuestion();
    else finish();
  }

  function finish() {
    const ok = state.results.filter((r) => r.correct).length;
    $('score').textContent = `答對 ${ok} / ${state.results.length} 題`;
    const list = $('review');
    list.replaceChildren();
    state.results.forEach((r) => {
      const letter = (i) => String.fromCharCode(65 + i);
      list.append(el('li', {},
        el('span', { className: r.correct ? 'ok' : 'bad', textContent: r.correct ? '✔ ' : '✘ ' }),
        r.q.題幹,
        r.correct ? '' : el('span', { className: 'muted', textContent: `（你選 ${letter(r.choice)}，答案 ${letter(r.answer)}）` }),
      ));
    });
    show('result');
  }

  $('start').addEventListener('click', () => start(false));
  $('next').addEventListener('click', next);
  $('quit').addEventListener('click', () => (state.results.length ? finish() : show('setup')));
  $('retry').addEventListener('click', () => start(true));
  $('back').addEventListener('click', () => { show('setup'); loadTree(); });

  loadTree();
})();
