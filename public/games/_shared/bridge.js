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
  };
  if (active) post({ type: 'ready' });
})();
