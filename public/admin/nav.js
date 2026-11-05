/* 後台共用導覽列：總覽／匯入考卷／題目審核／遊戲管理，附待處理數量與登出 */
(function () {
  'use strict';
  var TABS = [
    ['/admin/', '總覽', null],
    ['/admin/import.html', '匯入考卷', '待匯入'],
    ['/admin/questions.html', '題目審核', '草稿'],
    ['/admin/games.html', '遊戲管理', '待審遊戲'],
  ];
  var here = location.pathname.replace(/index\.html$/, '');
  var top = document.querySelector('.top');
  if (!top) return;
  var brand = document.createElement('a');
  brand.href = '/admin/';
  brand.className = 'brand';
  brand.innerHTML = '<span class="seal" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.5C10.2 5 7.6 4.5 4 4.8v13.4c3.6-.3 6.2.2 8 1.7 1.8-1.5 4.4-2 8-1.7V4.8c-3.6-.3-6.2.2-8 1.7z"/><path d="M12 6.5v13.4"/></svg></span>後台';
  var nav = document.createElement('nav');
  nav.className = 'tabs';
  var badges = {};
  TABS.forEach(function (t) {
    var a = document.createElement('a');
    a.href = t[0];
    a.textContent = t[1];
    if (here === t[0]) a.className = 'on';
    if (t[2]) {
      var b = document.createElement('span');
      b.className = 'count';
      b.hidden = true;
      a.appendChild(b);
      badges[t[2]] = b;
    }
    nav.appendChild(a);
  });
  var old = top.querySelector('h1');
  if (old) old.remove();
  var oldTabs = top.querySelector('.tabs');
  if (oldTabs) oldTabs.remove();
  top.prepend(brand, nav);

  var right = document.createElement('span');
  right.className = 'top-right';
  right.innerHTML = '<a href="/" class="link" target="_blank">學生頁面 ↗</a>';
  top.appendChild(right);
  fetch('/api/login/status').then(function (r) { return r.json(); }).then(function (s) {
    if (!s.需要密碼) return;
    var out = document.createElement('button');
    out.type = 'button';
    out.className = 'small';
    out.textContent = '登出';
    out.onclick = function () { fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(function () { location.href = '/login.html'; }); };
    right.appendChild(out);
  });

  window.refreshAdminCounts = function () {
    return fetch('/api/admin/overview').then(function (r) {
      if (r.status === 401) { location.href = '/login.html?next=' + encodeURIComponent(location.pathname); return null; }
      return r.json();
    }).then(function (o) {
      if (!o) return null;
      var n = { 待匯入: o.待匯入, 草稿: o.草稿.總數, 待審遊戲: o.待審遊戲 };
      Object.keys(badges).forEach(function (k) {
        badges[k].textContent = n[k];
        badges[k].hidden = !n[k];
      });
      return o;
    });
  };
  window.refreshAdminCounts();
})();
