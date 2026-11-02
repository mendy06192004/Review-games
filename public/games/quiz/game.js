// 範例遊戲：單題選擇題。答對加分（連續答對有加成），答錯顯示正確答案。
// 只包含遊戲邏輯與畫面；題目由主機傳入，答案由主機向伺服器驗證。

const CSS = `
.qz{max-width:760px;margin:0 auto}
.qz-hud{display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
.qz-pill{background:var(--panel);border:1px solid var(--border);border-radius:999px;padding:4px 14px;font-weight:700}
.qz-bar{flex:1;min-width:120px;height:8px;background:var(--border);border-radius:4px;overflow:hidden}
.qz-bar i{display:block;height:100%;background:var(--accent);transition:width .3s}
.qz-card{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:20px}
.qz-stem{font-size:1.25rem;font-weight:700;white-space:pre-wrap;margin:0 0 14px}
.qz-img{max-width:100%;max-height:300px;display:block;margin:0 auto 14px;border-radius:8px;background:#fff}
.qz-opts{display:grid;gap:10px}
.qz-opt{display:flex;gap:12px;align-items:center;text-align:left;width:100%;min-height:56px;padding:10px 14px;border:2px solid var(--border);border-radius:14px;background:var(--bg);font-size:1.08rem}
.qz-opt b{flex:none;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:var(--panel);border:1px solid var(--border)}
.qz-opt:hover:not(:disabled){border-color:var(--accent)}
.qz-opt.ok{border-color:var(--ok);background:var(--ok-bg)}
.qz-opt.bad{border-color:var(--bad);background:var(--bad-bg)}
.qz-opt:disabled{cursor:default}
.qz-fb{margin-top:14px;padding:12px 14px;border-radius:12px;background:var(--bg);white-space:pre-wrap}
.qz-fb.ok strong{color:var(--ok)}.qz-fb.bad strong{color:var(--bad)}
.qz-plus{color:var(--ok);font-weight:800;margin-left:6px}
.qz-next{margin-top:14px;width:100%}
@media (min-width:640px){.qz-opts{grid-template-columns:1fr 1fr}}
`;
const LETTER = 'ABCDEFGH';
const STARS = { 1: '★', 2: '★★', 3: '★★★' };

export default function createGame(host) {
  const style = Object.assign(document.createElement('style'), { textContent: CSS });
  document.head.append(style);

  const st = { questions: [], i: 0, score: 0, streak: 0, correct: 0, answered: null, busy: false, log: [] };

  const el = (tag, props = {}, ...kids) => {
    const e = Object.assign(document.createElement(tag), props);
    kids.flat().forEach((k) => k != null && e.append(k));
    return e;
  };

  const game = {
    start(questions) {
      Object.assign(st, { questions, i: 0, score: 0, streak: 0, correct: 0, answered: null, busy: false, log: [] });
    },

    render() {
      const q = st.questions[st.i];
      const n = st.questions.length;
      const a = st.answered;
      const opts = q.選項.map((text, k) => {
        const b = el('button', { className: 'qz-opt', type: 'button', disabled: !!a || st.busy }, el('b', { textContent: LETTER[k] }), el('span', { textContent: text }));
        if (a) {
          if (k === a.答案) b.classList.add('ok');
          else if (k === a.choice) b.classList.add('bad');
        }
        b.addEventListener('click', () => game.onAnswer(q.id, k));
        return b;
      });
      let fb = null;
      let next = null;
      if (a) {
        fb = el('div', { className: `qz-fb ${a.correct ? 'ok' : 'bad'}` },
          el('strong', { textContent: a.correct ? '答對了！' : `答錯了，正確答案是 (${LETTER[a.答案]}) ${q.選項[a.答案]}` }),
          a.correct ? el('span', { className: 'qz-plus', textContent: `+${a.gain}` }) : null,
          a.解析 ? `\n${a.解析}` : null);
        next = el('button', { className: 'btn primary qz-next', type: 'button', textContent: st.i + 1 < n ? '下一題 →' : '看成績' });
        next.addEventListener('click', () => {
          if (st.i + 1 < n) { st.i++; st.answered = null; game.render(); } else {
            host.finish({ score: st.score, correct: st.correct, total: n, 紀錄: st.log });
          }
        });
      }
      host.root.replaceChildren(el('div', { className: 'qz' },
        el('div', { className: 'qz-hud' },
          el('span', { className: 'qz-pill', textContent: `第 ${st.i + 1}/${n} 題` }),
          el('span', { className: 'qz-bar' }, el('i', { style: `width:${((st.i + (a ? 1 : 0)) / n) * 100}%` })),
          el('span', { className: 'qz-pill', textContent: `⭐ ${st.score} 分` }),
          st.streak >= 2 ? el('span', { className: 'qz-pill', textContent: `🔥 連對 ${st.streak}` }) : null),
        el('div', { className: 'qz-card' },
          el('div', { className: 'qz-pill', style: 'display:inline-block;margin-bottom:10px;font-size:.85rem', textContent: `${q.科目}　難度 ${STARS[q.難度] || ''}` }),
          el('p', { className: 'qz-stem', textContent: q.題幹 }),
          q.圖片 ? el('img', { className: 'qz-img', src: q.圖片, alt: '題目圖片' }) : null,
          el('div', { className: 'qz-opts' }, opts),
          fb, next)));
      if (next) next.focus();
    },

    async onAnswer(questionId, choice) {
      if (st.answered || st.busy) return null;
      st.busy = true;
      game.render();
      try {
        const r = await host.check(questionId, choice);
        const q = st.questions[st.i];
        let gain = 0;
        if (r.correct) {
          st.streak++;
          st.correct++;
          gain = 10 + Math.min(st.streak - 1, 5) * 2; // 連對加成，最多 +10
          st.score += gain;
        } else {
          st.streak = 0;
        }
        st.answered = { ...r, choice, gain };
        st.log.push({ 題幹: q.題幹, correct: r.correct, 正確答案: `(${LETTER[r.答案]}) ${q.選項[r.答案]}` });
        return r;
      } catch (e) {
        alert('無法驗證答案：' + e.message);
        return null;
      } finally {
        st.busy = false;
        game.render();
      }
    },

    destroy() { style.remove(); },
  };
  return game;
}
