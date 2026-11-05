'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const registry = JSON.parse(fs.readFileSync(path.join(PUB, 'games', 'registry.json'), 'utf8'));

test('registry：每個遊戲的入口檔都存在，id 不重複', () => {
  const ids = new Set();
  for (const g of registry) {
    assert.ok(!ids.has(g.id), `id 重複：${g.id}`);
    ids.add(g.id);
    assert.ok(fs.existsSync(path.join(PUB, g.入口)), `${g.名稱} 的入口不存在：${g.入口}`);
    assert.ok(g.分類, `${g.名稱} 缺少分類`);
    if (g.類型 === 'module') {
      assert.deepStrictEqual(g.科目, ['C', 'E', 'M', 'B', 'S'], `${g.名稱} 應支援國英數自社`);
      assert.strictEqual(g.使用題庫, true);
    } else {
      assert.strictEqual(g.使用題庫, false, `${g.名稱} 不使用題庫，應直接開始`);
    }
  }
});

test('題庫遊戲已移除內建題目，只能從題庫資料夾取題', () => {
  const read = (p) => fs.readFileSync(path.join(PUB, 'games', p), 'utf8');
  const survival = read('review-survival/index.html');
  assert.match(survival, /\nconst RAW = \[\];\n/);
  assert.ok(!survival.includes('RAW.push('), '複習生存大作戰不應再有內建題目');
  assert.match(read('principal/index.html'), /const QB = \{zh:\[\],en:\[\],ma:\[\],sc:\[\],so:\[\]\};/);
  const duel = read('review-duel/index.html');
  assert.match(duel, /const GEN=\{\};/);
  assert.ok(!duel.includes('function makeQuestion'), '複習齊打交不應再有自動出題器');
  for (const p of ['principal/index.html', 'review-survival/index.html', 'review-duel/index.html']) {
    assert.match(read(p), /GameBridge\.requireBank\(/, `${p} 應要求從平台開啟`);
  }
});

test('3D 遊戲使用本機的 three.js，不依賴 CDN', () => {
  for (const p of ['car-dilemma/index.html', 'traffic-police/index.html', 'scooter-hell/game.html', 'life-boom/index.html']) {
    const s = fs.readFileSync(path.join(PUB, 'games', p), 'utf8');
    assert.ok(s.includes('/games/_shared/vendor/three-r128.min.js'), p);
    assert.ok(!s.includes('cdnjs.cloudflare.com/ajax/libs/three.js'), p);
  }
});
