'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const el = (tag, props = {}, ...kids) => {
    const e = Object.assign(document.createElement(tag), props);
    kids.flat().forEach((k) => k != null && e.append(k));
    return e;
  };
  const size = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
  let INFO = null;
  let polling = null;

  async function api(url, opts = {}) {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { location.href = '/login.html?next=' + encodeURIComponent(location.pathname); throw new Error('請先登入'); }
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

  // ---------- 待匯入清單 ----------
  async function loadFiles() {
    INFO = await api('/api/admin/import/files');
    if ($('#u-subject').options.length === 1) {
      Object.values(INFO.科目).forEach((n) => $('#u-subject').append(el('option', { value: n, textContent: n })));
      Object.values(INFO.年級).forEach((n) => $('#u-grade').append(el('option', { value: n, textContent: n })));
    }
    const box = $('#files');
    if (!INFO.檔案.length) {
      box.replaceChildren(el('p', { className: 'empty', textContent: '目前沒有待匯入的檔案，請先在上方上傳。' }));
    } else {
      box.replaceChildren(...INFO.檔案.map((f) => {
        const cb = el('input', { type: 'checkbox', checked: true, value: f.檔案 });
        cb.addEventListener('change', updateRun);
        const tags = Object.entries(f.判斷).filter(([, v]) => v).map(([k, v]) => `${k}：${v}`).join('　');
        const del = el('button', { type: 'button', className: 'small danger', textContent: '移除' });
        del.addEventListener('click', async () => {
          if (!confirm(`確定要移除「${f.名稱}」嗎？`)) return;
          await api(`/api/admin/import/files?檔案=${encodeURIComponent(f.檔案)}`, { method: 'DELETE' });
          loadFiles();
          window.refreshAdminCounts?.();
        });
        return el('label', { className: 'file' }, cb,
          el('span', { className: 'fname' }, el('b', { textContent: f.名稱 }), el('span', { className: 'muted small', textContent: `${tags || '未標示科目／版本／年級（由檔名與內容判斷）'}・${size(f.大小)}` })),
          del);
      }));
    }
    updateRun();
  }
  function checked() { return [...document.querySelectorAll('#files input:checked')].map((c) => c.value); }
  function updateRun() {
    const n = checked().length;
    $('#run').disabled = !n || !!polling;
    $('#run').textContent = n ? `開始匯入勾選的 ${n} 個檔案` : '開始匯入勾選的檔案';
  }

  // ---------- 上傳 ----------
  async function upload(files) {
    const msg = $('#u-msg');
    let ok = 0;
    for (const [i, f] of [...files].entries()) {
      msg.textContent = `上傳中（${i + 1}/${files.length}）：${f.name}`;
      const res = await fetch('/api/admin/import/upload', {
        method: 'POST',
        headers: {
          'Content-Type': f.type || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(f.name),
          'X-Subject': encodeURIComponent($('#u-subject').value),
          'X-Version': encodeURIComponent($('#u-version').value.trim()),
          'X-Grade': encodeURIComponent($('#u-grade').value),
        },
        body: f,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) ok++;
      else toast(`${f.name}：${data.error || '上傳失敗'}`);
    }
    msg.textContent = ok ? `已上傳 ${ok} 個檔案，請在下方確認後按「開始匯入」。` : '';
    $('#u-files').value = '';
    await loadFiles();
    window.refreshAdminCounts?.();
  }
  $('#u-files').addEventListener('change', (e) => e.target.files.length && upload(e.target.files));
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); });

  // ---------- 貼上文字 ----------
  $('#p-add').addEventListener('click', async () => {
    try {
      const r = await api('/api/admin/import/text', { method: 'POST', body: JSON.stringify({ 文字: $('#p-text').value, 科目: $('#u-subject').value, 版本: $('#u-version').value.trim(), 年級: $('#u-grade').value }) });
      $('#p-text').value = '';
      toast(`已加入待匯入清單：${r.檔案}`);
      await loadFiles();
      window.refreshAdminCounts?.();
    } catch (e) { toast(e.message); }
  });

  // ---------- 執行與進度 ----------
  $('#run').addEventListener('click', async () => {
    const files = checked();
    if (!confirm(`即將處理以下 ${files.length} 個檔案：\n\n${files.join('\n')}\n\n結果會變成草稿，等你審核。確定開始嗎？`)) return;
    try {
      const { 工作 } = await api('/api/admin/import/run', { method: 'POST', body: JSON.stringify({ 檔案: files }) });
      showJob(工作);
      startPolling();
    } catch (e) { toast(e.message); }
  });

  function showJob(job) {
    if (!job) return;
    $('#job-card').hidden = false;
    $('#bar').style.width = `${job.總數 ? (job.完成 / job.總數) * 100 : 0}%`;
    const done = job.狀態 === '完成';
    const total = job.結果.reduce((s, r) => s + r.題數, 0);
    $('#job-status').textContent = done
      ? `完成：${job.總數} 個檔案，共產生 ${total} 題草稿。`
      : `處理中…（${job.完成}/${job.總數}）每個檔案約需 30 秒到數分鐘，請不要關閉黑色視窗。`;
    $('#job-results').replaceChildren(...job.結果.map((r) => el('li', { className: r.錯誤 ? 'bad' : '' },
      el('b', { textContent: r.檔案 }),
      el('span', { textContent: r.錯誤 ? `失敗：${r.錯誤}（原檔留在待匯入，可修正後重試）` : `產生 ${r.題數} 題${r.需審核 ? `，其中 ${r.需審核} 題需要補資料` : ''}` }))));
    $('#job-log').textContent = job.紀錄.join('\n');
    $('#job-next').hidden = !(done && total);
  }
  function startPolling() {
    clearInterval(polling);
    polling = setInterval(async () => {
      const { 工作 } = await api('/api/admin/import/job').catch(() => ({}));
      showJob(工作);
      if (!工作 || 工作.狀態 === '完成') {
        clearInterval(polling);
        polling = null;
        loadFiles();
        window.refreshAdminCounts?.();
      }
    }, 1500);
    updateRun();
  }

  loadFiles().catch((e) => { $('#files').textContent = '載入失敗：' + e.message; });
  // 重新整理頁面時，若有匯入正在進行，繼續顯示進度
  api('/api/admin/import/job').then(({ 工作 }) => { if (工作) { showJob(工作); if (工作.狀態 === '執行中') startPolling(); } }).catch(() => {});
})();
