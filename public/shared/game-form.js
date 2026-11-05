/* 遊戲資料表單：管理員「新增 / 編輯遊戲」與老師「投稿遊戲」共用。
 * GameForm.build({ 分類, 科目, 上限MB }, { mode: 'admin'|'submit'|'edit', initial })
 *   → { el, collect(): Promise<{資訊, 檔案?, 封面?}> }
 */
(function () {
  'use strict';
  function el(tag, props, ...kids) {
    const e = Object.assign(document.createElement(tag), props || {});
    kids.flat().forEach((k) => k != null && e.append(k));
    return e;
  }
  function field(label, input, hint) {
    return el('label', { className: 'gf-field' }, el('span', { className: 'gf-label', textContent: label }), input, hint ? el('small', { className: 'gf-hint', textContent: hint }) : null);
  }
  function readFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve({ 檔名: file.name, 內容: String(r.result).replace(/^data:[^,]*,/, '') });
      r.onerror = () => reject(new Error('讀取檔案失敗'));
      r.readAsDataURL(file);
    });
  }

  function build(meta, opts) {
    const mode = opts.mode || 'submit';
    const v = opts.initial || {};
    const f = {
      名稱: el('input', { type: 'text', maxLength: 40, value: v.名稱 || '', required: true, placeholder: '例如：成語接龍大冒險' }),
      連結: el('input', { type: 'url', value: v.連結 || '', placeholder: 'https://gemini.google.com/share/…' }),
      年級: el('select', {}, el('option', { value: '', textContent: '（不限）' }), ...Object.values(meta.年級 || {}).map((g) => el('option', { value: g, textContent: g }))),
      章節: el('input', { type: 'text', maxLength: 40, value: v.章節 || '', placeholder: '例如：第2章 一元二次方程式' }),
      說明: el('textarea', { maxLength: 300, value: v.說明 || '', placeholder: '一兩句話說明怎麼玩、適合什麼學生' }),
      分類: el('select', {}, ...meta.分類.map((c) => el('option', { value: c, textContent: c }))),
      領域: el('input', { type: 'text', maxLength: 60, value: v.領域 || '', placeholder: '例如：自我照顧・個人衛生；國二數學：根式' }),
      使用題庫: el('input', { type: 'checkbox', checked: !!v.使用題庫 }),
      題數選項: el('input', { type: 'text', value: (v.題數選項 || [10, 20, 30]).join(','), placeholder: '10,20,30' }),
      投稿者: el('input', { type: 'text', maxLength: 40, value: v.投稿者 || '' }),
      聯絡: el('input', { type: 'text', maxLength: 80, value: v.聯絡 || '', placeholder: 'Email 或學校分機（選填）' }),
      給管理員的話: el('textarea', { maxLength: 500, value: v.給管理員的話 || '' }),
      檔案: el('input', { type: 'file', accept: '.zip,.html,.htm,application/zip,text/html' }),
      封面: el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' }),
      直接發布: el('input', { type: 'checkbox' }),
    };
    f.分類.value = v.分類 || (v.使用題庫 ? '複習遊戲' : meta.分類[1] || meta.分類[0]);
    f.年級.value = v.年級 || '';
    // 遊戲來源：上傳檔案，或貼上連結（Gemini、Canva、Wordwall… 只是掛在平台上，不能用題庫）
    const isLinkInit = !!v.連結;
    const srcFile = el('input', { type: 'radio', name: 'gf-src-' + Math.random(), checked: !isLinkInit });
    const srcLink = el('input', { type: 'radio', name: srcFile.name, checked: isLinkInit });
    const srcRow = el('div', { className: 'gf-checks' },
      el('label', { className: 'gf-check' }, srcFile, ' 上傳遊戲檔（.html / .zip）'),
      el('label', { className: 'gf-check' }, srcLink, ' 貼上遊戲連結'));
    const subjects = Object.entries(meta.科目).map(([code, name]) => {
      const cb = el('input', { type: 'checkbox', value: code, checked: (v.科目 || []).includes(code) });
      return { cb, label: el('label', { className: 'gf-check' }, cb, ` ${name}`) };
    });
    const subjWrap = el('div', { className: 'gf-checks' }, subjects.map((s) => s.label));
    const bankBox = el('div', { className: 'gf-bank' },
      field('適用科目', subjWrap, '使用題庫：會出這些科目的題目。不使用題庫：遊戲會出現在這些學科分區（可不勾，放在「其他」）。'),
      field('題數選項', f.題數選項, '學生可選的題數，用逗號分隔（使用題庫的遊戲才需要）'));
    const sync = () => {
      const link = srcLink.checked;
      if (link) f.使用題庫.checked = false;
      f.使用題庫.closest('label').hidden = link;
      f.連結.closest('label').hidden = !link;
      f.檔案.closest('label').hidden = link;
      if (f.使用題庫.checked && f.分類.value !== '複習遊戲' && f.分類.value !== '學科練習') f.分類.value = '複習遊戲';
      if (!f.使用題庫.checked && f.分類.value === '複習遊戲') f.分類.value = '學科練習';
      f.題數選項.closest('label').hidden = !f.使用題庫.checked;
    };
    f.使用題庫.addEventListener('change', () => {
      if (f.使用題庫.checked) f.分類.value = '複習遊戲';
      sync();
    });
    f.分類.addEventListener('change', () => { if (f.分類.value === '複習遊戲' && !srcLink.checked) f.使用題庫.checked = true; sync(); });
    srcFile.addEventListener('change', sync);
    srcLink.addEventListener('change', sync);

    const msg = el('p', { className: 'gf-err', role: 'alert' });
    const box = el('div', { className: 'gf' },
      field('遊戲名稱 *', f.名稱),
      field('說明', f.說明),
      field('遊戲來源', srcRow),
      field('遊戲連結 *', f.連結, '貼上分享網址。這類遊戲只是掛在平台上，不能使用平台的題庫；若遊戲網站不允許嵌入，學生可以按「在新視窗開啟」。'),
      el('label', { className: 'gf-check big' }, f.使用題庫, ' 這個遊戲會用平台的題庫出題（使用 GameBridge）'),
      el('div', { className: 'gf-row' }, field('分類', f.分類), field('領域 / 範圍（選填）', f.領域)),
      el('div', { className: 'gf-row' }, field('適用年級（選填）', f.年級), field('章節（選填）', f.章節, '學生頁會顯示成標籤，並依年級、章節排序')),
      bankBox,
      mode === 'edit' ? null : el('div', { className: 'gf-row' }, field(mode === 'submit' ? '投稿老師 *' : '作者（選填）', f.投稿者), field('聯絡方式', f.聯絡)),
      mode === 'submit' ? field('給管理員的話（選填）', f.給管理員的話) : null,
      field(mode === 'edit' ? '替換遊戲檔（選填）' : '遊戲檔 *', f.檔案, `.zip（最外層要有 index.html）或單一 .html，上限 ${meta.上限MB}MB`),
      field(mode === 'edit' ? '替換封面圖（選填）' : '封面圖（選填）', f.封面, '遊戲畫面截圖，建議 16:10 橫式。沒有的話會顯示遊戲名稱，管理員之後可補上。'),
      mode === 'admin' ? el('label', { className: 'gf-check big' }, f.直接發布, ' 直接發布（不經過待審核）') : null,
      msg);
    sync();

    async function collect() {
      msg.textContent = '';
      const 資訊 = {
        名稱: f.名稱.value, 說明: f.說明.value, 分類: f.分類.value, 領域: f.領域.value,
        年級: f.年級.value, 章節: f.章節.value,
        使用題庫: !srcLink.checked && f.使用題庫.checked, 科目: subjects.filter((s) => s.cb.checked).map((s) => s.cb.value),
        題數選項: f.題數選項.value,
      };
      if (mode !== 'edit') Object.assign(資訊, { 投稿者: f.投稿者.value, 聯絡: f.聯絡.value });
      if (mode === 'submit') 資訊.給管理員的話 = f.給管理員的話.value;
      const fail = (t) => { msg.textContent = t; throw new Error(t); };
      if (!資訊.名稱.trim()) fail('請填寫遊戲名稱');
      if (mode === 'submit' && !資訊.投稿者.trim()) fail('請填寫投稿老師姓名');
      if (資訊.使用題庫 && !資訊.科目.length) fail('使用題庫的遊戲請至少勾選一個科目');
      const linkMode = srcLink.checked;
      const linkVal = f.連結.value.trim();
      if (linkMode && !/^https?:\/\//i.test(linkVal)) fail('請貼上完整的遊戲連結（https:// 開頭）');
      if (linkMode && 資訊.分類 === '複習遊戲') fail('連結遊戲不能用題庫，分類請改成其他類別');
      const file = linkMode ? null : f.檔案.files[0];
      if (!linkMode && !file && mode !== 'edit') fail('請選擇遊戲檔');
      if (file && file.size > meta.上限MB * 1024 * 1024) fail(`遊戲檔太大（上限 ${meta.上限MB}MB）`);
      const cover = f.封面.files[0];
      if (cover && cover.size > 3 * 1024 * 1024) fail('封面圖太大（上限 3MB）');
      const body = { 資訊 };
      if (linkMode) body.連結 = linkVal;
      if (file) body.檔案 = await readFile(file);
      if (cover) body.封面 = await readFile(cover);
      if (mode === 'admin') body.直接發布 = f.直接發布.checked;
      return body;
    }
    return { el: box, collect, showError: (t) => { msg.textContent = t; } };
  }

  window.GameForm = { build };
})();
