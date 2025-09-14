// src/utils/search.js
const fs = require('fs');
const path = require('path');

const dict = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../data/characters.json'), 'utf8')
);

function normalize(s) {
  if (!s) return '';
  // 全角→半角、カナ→かな、英大文字→小文字…の“ゆるい”正規化（簡易版）
  const toHalf = s.replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
                  .replace(/　/g, ' ');
  const lower = toHalf.toLowerCase();
  // ローマ字の揺れ（shi/si等）の正規化
  const romaji = lower
    .replace(/shi/g, 'si')
    .replace(/chi/g, 'ti')
    .replace(/tsu/g, 'tu')
    .replace(/fu/g, 'hu')
    .replace(/ji/g, 'zi')
    .replace(/ju/g, 'zyu')
    .replace(/jo/g, 'zyo')
    .replace(/ja/g, 'zya')
    .replace(/sh([aou])/g, 'sy$1')
    .replace(/ch([aou])/g, 'ty$1');
  // カタカナ→ひらがな（簡易）
  return romaji.replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function pool(role) {
  return role === 'survivor' ? dict.survivors : dict.hunters;
}

function search(role, q, limit = 25, excludeIds = new Set()) {
  const n = normalize(q);
  const list = pool(role);
  const scored = [];

  for (const row of list) {
    if (excludeIds.has(row.id)) continue;
    const cand = [row.ja, row.kana, row.id, ...(row.aliases || [])]
      .filter(Boolean)
      .map(normalize);

    let score = 0;
    for (const c of cand) {
      if (c.startsWith(n)) score = Math.max(score, 3);
      else if (c.includes(n)) score = Math.max(score, 1);
    }
    if (score > 0) scored.push({ row, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.row);
}

module.exports = { search, normalize };
