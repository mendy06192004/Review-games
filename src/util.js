'use strict';
const crypto = require('crypto');

const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 將「三」「十二」「二十」等中文數字轉為阿拉伯數字（0~99），無法轉換回傳 null */
function cnToNumber(s) {
  if (s === '十') return 10;
  const m = /^([一二兩三四五六七八九])?十([一二三四五六七八九])?$/.exec(s);
  if (m) return (m[1] ? CN_DIGIT[m[1]] : 1) * 10 + (m[2] ? CN_DIGIT[m[2]] : 0);
  if (/^[零〇一二兩三四五六七八九]+$/.test(s)) return Number([...s].map((c) => CN_DIGIT[c]).join(''));
  return null;
}

/** 讓「第二冊」排在「第十冊」前、「國一」在「國二」前的排序比較函式 */
function naturalCompare(a, b) {
  const key = (s) => s.replace(/[零〇一二兩三四五六七八九十]+/g, (m) => {
    const n = cnToNumber(m);
    return n === null ? m : String(n);
  });
  return key(a).localeCompare(key(b), 'zh-Hant-TW', { numeric: true }) || a.localeCompare(b);
}

/** Fisher–Yates 洗牌（使用 crypto 亂數），回傳新陣列 */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { cnToNumber, naturalCompare, shuffle };
