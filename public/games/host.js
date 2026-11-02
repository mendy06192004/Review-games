// 遊戲主機：載入遊戲模組，提供統一的 host 介面
//
// 每個遊戲模組（/games/<名稱>/game.js）預設匯出 createGame(host)，回傳：
//   start(questions)            收到題目（不含答案）
//   render()                    把目前狀態畫到 host.root
//   onAnswer(questionId, choice) 學生作答時呼叫，回傳 Promise<驗證結果>
//   destroy()                   （選填）離開時清理
//
// host 提供：
//   host.root                    遊戲畫面容器
//   host.check(id, choice)       向伺服器驗證答案 → { correct, 答案, 解析 }
//   host.finish(result)          結束並顯示成績 { score, correct, total, 紀錄:[{題幹, correct, 正確答案}] }
//   host.exit()                  不計分直接離開

let current = null;

export async function runGame(meta, questions, root, { onFinish, onExit }) {
  stopGame();
  root.replaceChildren();
  root.className = 'game-root' + (meta.全版面 ? ' frame' : '');
  const host = {
    root,
    async check(id, choice) {
      const res = await fetch('/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: [{ id, choice }] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '驗證失敗');
      const r = data.results[0];
      if (r.error) throw new Error(r.error);
      return r;
    },
    finish(result) { stopGame(); onFinish(result); },
    exit() { stopGame(); onExit(); },
  };
  const mod = await import(meta.入口);
  const game = mod.default(host);
  current = game;
  game.start(questions);
  game.render();
  return game;
}

export function stopGame() {
  if (current && current.destroy) current.destroy();
  current = null;
}
runGame.stop = stopGame;
