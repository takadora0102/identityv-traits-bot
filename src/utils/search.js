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
  // カタカナ→ひらがな（簡易）
  return lower.replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
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
