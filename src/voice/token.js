// src/voice/token.js
const tokenCache = new Map();

function loadToken({ envKey, filePath, label }) {
  const fs = require('fs');
  let t = process.env[envKey];
  if (!t && filePath && fs.existsSync(filePath)) {
    t = fs.readFileSync(filePath, 'utf8').trim();
  }
  if (!t) console.warn(`[voice] missing token for ${label || envKey}`);
  return t;
}

const TOKEN_LOADERS = {
  kaidoku_kasoku: () =>
    loadToken({
      envKey: 'KAIDOKU_KASOKU_TOKEN',
      filePath: '/etc/secrets/kaidoku_kasoku',
      label: 'kaidoku_kasoku',
    }),
};

function getVoiceToken(name, { reload = false } = {}) {
  const loader = TOKEN_LOADERS[name];
  if (!loader) return null;
  if (reload || !tokenCache.has(name)) {
    const value = loader();
    tokenCache.set(name, value ?? null);
  }
  return tokenCache.get(name);
}

function clearVoiceToken(name) {
  if (typeof name === 'string') tokenCache.delete(name);
  else tokenCache.clear();
}

module.exports = {
  loadToken,
  getVoiceToken,
  clearVoiceToken,
};
