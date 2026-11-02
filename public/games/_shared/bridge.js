/* 題庫橋接（iframe 遊戲端）
 * 遊戲以 /games/<名稱>/index.html?bank=1 被主機載入時啟用「題庫模式」：
 *   GameBridge.active          是否為題庫模式（直接開檔案則為 false，遊戲沿用內建題目）
 *   GameBridge.questions()     Promise<題目[]>（不含答案）
 *   GameBridge.check(id, k)    Promise<{correct, 答案, 解析}>，由主機向伺服器驗證
 *   GameBridge.finish(summary) 通知主機遊戲結束（選用）
 */
(function () {
  var active = window.parent !== window && /[?&]bank=1\b/.test(location.search);
  var pending = {}; var seq = 0; var resolveQ; var qPromise = new Promise(function (r) { resolveQ = r; });
  function post(msg) { window.parent.postMessage(msg, location.origin); }
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || e.source !== window.parent) return;
    var m = e.data || {};
    if (m.type === 'init') resolveQ(m.questions || []);
    if (m.type === 'checkResult' && pending[m.req]) {
      var p = pending[m.req]; delete pending[m.req];
      if (m.error) p.reject(new Error(m.error)); else p.resolve(m.result);
    }
  });
  window.GameBridge = {
    active: active,
    questions: function () { return active ? qPromise : Promise.resolve([]); },
    check: function (id, choice) {
      if (!active) return Promise.reject(new Error('不在題庫模式'));
      return new Promise(function (resolve, reject) {
        var req = ++seq; pending[req] = { resolve: resolve, reject: reject };
        post({ type: 'check', req: req, id: id, choice: choice });
      });
    },
    finish: function (summary) { if (active) post({ type: 'finish', summary: summary || {} }); },
    /* 題目一律來自題庫資料夾：直接開啟遊戲檔（沒有經過平台選範圍）時，顯示提示並引導回平台 */
    requireBank: function (gameName) {
      if (active) return true;
      var show = function () {
        var d = document.createElement('div');
        d.setAttribute('role', 'dialog');
        d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(20,24,36,.86);font-family:system-ui,"PingFang TC","Microsoft JhengHei",sans-serif';
        d.innerHTML = '<div style="max-width:420px;background:#fff;color:#1f2a37;border-radius:18px;padding:24px;text-align:center;line-height:1.7">'
          + '<div class="gb-title" style="font-size:22px;font-weight:800;margin-bottom:8px"></div>'
          + '<p style="margin:0 0 16px">這個遊戲的題目來自老師的題庫資料夾，請從平台選好科目與範圍後再開始。</p>'
          + '<a href="/" style="display:inline-block;background:#ff7a45;color:#fff;text-decoration:none;font-weight:700;padding:10px 22px;border-radius:12px">回到平台選範圍</a></div>';
        d.querySelector('.gb-title').textContent = gameName || '複習遊戲';
        document.body.appendChild(d);
      };
      if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
      return false;
    },
  };
  if (active) post({ type: 'ready' });
})();
