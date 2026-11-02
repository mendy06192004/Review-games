// 把「單檔 HTML 遊戲」包成統一介面的遊戲模組。
// 遊戲在 iframe 中執行（樣式互不干擾），透過 postMessage 取得題目、驗證答案。
export function iframeGame(url) {
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
        frame.src = `${url}?bank=1`;
        frame.title = '遊戲畫面';
        frame.allow = 'autoplay; fullscreen';
        host.root.replaceChildren(frame);
        onMsg = async (e) => {
          if (!frame || e.source !== frame.contentWindow || e.origin !== location.origin) return;
          const m = e.data || {};
          const reply = (msg) => frame.contentWindow.postMessage(msg, location.origin);
          if (m.type === 'ready') reply({ type: 'init', questions });
          if (m.type === 'check') {
            try {
              reply({ type: 'checkResult', req: m.req, result: await game.onAnswer(m.id, m.choice) });
            } catch (err) {
              reply({ type: 'checkResult', req: m.req, error: err.message });
            }
          }
          if (m.type === 'finish') host.finish({ score: m.summary.score ?? stats.correct * 10, ...stats });
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
