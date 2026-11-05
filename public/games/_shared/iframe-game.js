// 把「單檔 HTML 遊戲」包成統一介面的遊戲模組。
// 遊戲在 iframe 中執行（樣式互不干擾），透過 postMessage 取得題目、驗證答案。
//
// opts.sandbox：上傳的遊戲（老師投稿）以沙盒執行，瀏覽器視為「另一個來源」，
// 碰不到平台的資料與管理功能；訊息來源會是 "null"，回覆時也只送到該 iframe。
export const SANDBOX = 'allow-scripts allow-pointer-lock allow-forms allow-modals allow-popups allow-downloads';

export function iframeGame(url, opts = {}) {
  return function createGame(host) {
    let questions = [];
    let frame = null;
    let onMsg = null;
    const stats = { correct: 0, total: 0, 紀錄: [] };
    const byId = new Map();

    const game = {
      start(qs) {
        questions = qs;
        qs.forEach((q) => byId.set(q.id, q));
      },
      render() {
        frame = document.createElement('iframe');
        if (opts.sandbox) frame.setAttribute('sandbox', SANDBOX);
        frame.src = `${url}${url.includes('?') ? '&' : '?'}bank=1`;
        frame.title = '遊戲畫面';
        frame.allow = 'autoplay; fullscreen';
        host.root.replaceChildren(frame);
        const target = opts.sandbox ? '*' : location.origin;
        onMsg = async (e) => {
          if (!frame || e.source !== frame.contentWindow) return;
          if (e.origin !== location.origin && !(opts.sandbox && e.origin === 'null')) return;
          const m = e.data || {};
          const reply = (msg) => frame && frame.contentWindow.postMessage(msg, target);
          if (m.type === 'ready') reply({ type: 'init', questions });
          if (m.type === 'check') {
            try {
              reply({ type: 'checkResult', req: m.req, result: await game.onAnswer(m.id, m.choice) });
            } catch (err) {
              reply({ type: 'checkResult', req: m.req, error: err.message });
            }
          }
          if (m.type === 'finish') host.finish({ score: m.summary?.score ?? stats.correct * 10, ...stats });
        };
        window.addEventListener('message', onMsg);
      },
      async onAnswer(questionId, choice) {
        const r = await host.check(questionId, choice);
        const q = byId.get(questionId);
        stats.total++;
        if (r.correct) stats.correct++;
        if (q) stats.紀錄.push({ 題幹: q.題幹, correct: r.correct, 正確答案: q.選項[r.答案] });
        return r;
      },
      destroy() {
        if (onMsg) window.removeEventListener('message', onMsg);
        frame = null;
      },
    };
    return game;
  };
}
