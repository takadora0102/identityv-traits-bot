// scheduler に guildStates Map を渡すためのアクセサ
const { getGuildState } = require('./core/state');

const guildStates = new Map();

module.exports = { guildStates };
