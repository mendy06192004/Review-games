/* 上傳的遊戲在沙盒中執行（沒有自己的儲存空間），存取 localStorage 會出錯。
 * 這裡換成「記憶體版」：遊戲照常運作，只是關掉頁面後不會保留紀錄。 */
(function () {
  function memoryStorage() {
    var data = {};
    return {
      get length() { return Object.keys(data).length; },
      key: function (i) { return Object.keys(data)[i] || null; },
      getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[String(k)] = String(v); },
      removeItem: function (k) { delete data[String(k)]; },
      clear: function () { data = {}; },
    };
  }
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    try { window[name].getItem('x'); } catch (e) {
      try { Object.defineProperty(window, name, { value: memoryStorage(), configurable: true }); } catch (e2) { /* 無法替換就算了 */ }
    }
  });
})();
