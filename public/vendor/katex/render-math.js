/* 數學式渲染（KaTeX，檔案都在本機，不需要網路）
 * 題目中用 $...$（行內）或 $$...$$（獨立一行）包住 LaTeX，例如：$\frac{1}{2}$、$x^2+\sqrt{3}$
 *   MathRender.render(el)    渲染某個元素
 *   MathRender.watch(el)     之後 el 內容有變動就自動渲染（遊戲換題時用）
 */
(function () {
  'use strict';
  if (window.MathRender) return;
  var BASE = '/vendor/katex/';
  var DELIMS = [
    { left: '$$', right: '$$', display: true },
    { left: '\\[', right: '\\]', display: true },
    { left: '\\(', right: '\\)', display: false },
    { left: '$', right: '$', display: false },
  ];
  var ready = null;
  function load() {
    if (ready) return ready;
    ready = new Promise(function (resolve) {
      if (!document.querySelector('link[data-katex]')) {
        var l = document.createElement('link');
        l.rel = 'stylesheet'; l.href = BASE + 'katex.min.css'; l.setAttribute('data-katex', '');
        (document.head || document.documentElement).appendChild(l);
      }
      function add(src, cb) {
        var s = document.createElement('script');
        s.src = BASE + src; s.onload = cb; s.onerror = function () { resolve(false); };
        (document.head || document.documentElement).appendChild(s);
      }
      if (window.renderMathInElement) return resolve(true);
      add('katex.min.js', function () { add('auto-render.min.js', function () { resolve(true); }); });
    });
    return ready;
  }
  var busy = false;
  function render(el) {
    if (!el || !/\$|\\\(|\\\[/.test(el.textContent || '')) return Promise.resolve();
    return load().then(function (ok) {
      if (!ok || !window.renderMathInElement) return;
      busy = true;
      try { window.renderMathInElement(el, { delimiters: DELIMS, throwOnError: false, ignoredClasses: ['no-math'] }); } catch (e) { /* 寫錯的式子保持原文 */ }
      busy = false;
    });
  }
  function watch(el) {
    if (!el || el.__mathWatch) return;
    el.__mathWatch = true;
    var t = null;
    new MutationObserver(function () {
      if (busy) return;
      clearTimeout(t);
      t = setTimeout(function () { render(el); }, 30);
    }).observe(el, { childList: true, subtree: true, characterData: true });
    render(el);
  }
  window.MathRender = { render: render, watch: watch, load: load };
})();
