const { TRAITS } = require('./constants');

// 換算用CTを取り出す
function convCT(key) {
  const t = TRAITS[key];
  if (!t) throw new Error(`Unknown trait "${key}"`);
  return t.convCT;
}

// 裏向きカードの比例換算（秒）
function convertRemainSec(oldKey, newKey, oldRemainSec) {
  const oldCT = convCT(oldKey);
  const newCT = convCT(newKey);
  if (!oldCT || !newCT) return Math.max(0, Math.round(oldRemainSec));
  const v = oldRemainSec * (newCT / oldCT);
  return Math.max(0, Math.round(v));
}

// 監視者に切替時：ゲージ90sの残りから「所持＋次チャージ残り」を計算
function watcherFromRemain(remainSec /* 0..90 */) {
  const total = 90;
  const progress = Math.max(0, total - remainSec); // 進捗秒
  const stacks = Math.max(0, Math.min(3, Math.floor(progress / 30)));
  let nextCharge = 0;
  if (stacks < 3) {
    nextCharge = 30 - (progress % 30);
  }
  return { stacks, nextChargeSec: nextCharge };
}

module.exports = {
  convertRemainSec,
  watcherFromRemain
};
