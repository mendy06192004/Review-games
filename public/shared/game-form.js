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
      圖示: el('input', { type: 'text', maxLength: 8, value: v.圖示 || '', placeholder: '🎮' }),
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
    const subjects = Object.entries(meta.科目).map(([code, name]) => {
      const cb = el('input', { type: 'checkbox', value: code, checked: (v.科目 || []).includes(code) });
      return { cb, label: el('label', { className: 'gf-check' }, cb, ` ${name}`) };
    });
    const subjWrap = el('div', { className: 'gf-checks' }, subjects.map((s) => s.label));
    const bankBox = el('div', { className: 'gf-bank' },
      field('適用科目', subjWrap, '使用題庫：會出這些科目的題目。不使用題庫：遊戲會出現在這些學科分區（可不勾，放在「其他」）。'),
      field('題數選項', f.題數選項, '學生可選的題數，用逗號分隔（使用題庫的遊戲才需要）'));
    const sync = () => {
      if (f.使用題庫.checked && f.分類.value !== '複習遊戲' && f.分類.value !== '學科練習') f.分類.value = '複習遊戲';
      if (!f.使用題庫.checked && f.分類.value === '複習遊戲') f.分類.value = '學科練習';
      f.題數選項.closest('label').hidden = !f.使用題庫.checked;
    };
    f.使用題庫.addEventListener('change', () => {
      if (f.使用題庫.checked) f.分類.value = '複習遊戲';
      sync();
    });
    f.分類.addEventListener('change', () => { if (f.分類.value === '複習遊戲') f.使用題庫.checked = true; sync(); });

    const msg = el('p', { className: 'gf-err', role: 'alert' });
    const box = el('div', { className: 'gf' },
      el('div', { className: 'gf-row' }, field('遊戲名稱 *', f.名稱), field('圖示（一個表情符號）', f.圖示)),
      field('說明', f.說明),
      el('label', { className: 'gf-check big' }, f.使用題庫, ' 這個遊戲會用平台的題庫出題（使用 GameBridge）'),
      el('div', { className: 'gf-row' }, field('分類', f.分類), field('領域 / 範圍（選填）', f.領域)),
      bankBox,
      mode === 'edit' ? null : el('div', { className: 'gf-row' }, field(mode === 'submit' ? '投稿老師 *' : '作者（選填）', f.投稿者), field('聯絡方式', f.聯絡)),
      mode === 'submit' ? field('給管理員的話（選填）', f.給管理員的話) : null,
      field(mode === 'edit' ? '替換遊戲檔（選填）' : '遊戲檔 *', f.檔案, `.zip（最外層要有 index.html）或單一 .html，上限 ${meta.上限MB}MB`),
      field(mode === 'edit' ? '替換封面圖（選填）' : '封面圖（選填）', f.封面, '遊戲畫面截圖，建議 16:10 橫式。沒有的話會顯示圖示，管理員之後可補上。'),
      mode === 'admin' ? el('label', { className: 'gf-check big' }, f.直接發布, ' 直接發布（不經過待審核）') : null,
      msg);
    sync();

    async function collect() {
      msg.textContent = '';
      const 資訊 = {
        名稱: f.名稱.value, 圖示: f.圖示.value, 說明: f.說明.value, 分類: f.分類.value, 領域: f.領域.value,
        使用題庫: f.使用題庫.checked, 科目: subjects.filter((s) => s.cb.checked).map((s) => s.cb.value),
        題數選項: f.題數選項.value,
      };
      if (mode !== 'edit') Object.assign(資訊, { 投稿者: f.投稿者.value, 聯絡: f.聯絡.value });
      if (mode === 'submit') 資訊.給管理員的話 = f.給管理員的話.value;
      const fail = (t) => { msg.textContent = t; throw new Error(t); };
      if (!資訊.名稱.trim()) fail('請填寫遊戲名稱');
      if (mode === 'submit' && !資訊.投稿者.trim()) fail('請填寫投稿老師姓名');
      if (資訊.使用題庫 && !資訊.科目.length) fail('使用題庫的遊戲請至少勾選一個科目');
      const file = f.檔案.files[0];
      if (!file && mode !== 'edit') fail('請選擇遊戲檔');
      if (file && file.size > meta.上限MB * 1024 * 1024) fail(`遊戲檔太大（上限 ${meta.上限MB}MB）`);
      const cover = f.封面.files[0];
      if (cover && cover.size > 3 * 1024 * 1024) fail('封面圖太大（上限 3MB）');
      const body = { 資訊 };
      if (file) body.檔案 = await readFile(file);
      if (cover) body.封面 = await readFile(cover);
      if (mode === 'admin') body.直接發布 = f.直接發布.checked;
      return body;
    }
    return { el: box, collect, showError: (t) => { msg.textContent = t; } };
  }

  window.GameForm = { build };
})();
