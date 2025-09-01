const fs = require('fs');
const path = require('path');
const { joinVoiceChannel, entersState, VoiceConnectionStatus, createAudioResource, createAudioPlayer, AudioPlayerStatus } = require('@discordjs/voice');
const { VOICE_TOKENS } = require('../core/constants');

const AUDIO_DIR = path.join(__dirname, '..', '..', 'audio', 'jp');

/** VC接続（既に接続済みなら再利用） */
async function connectVoice(guild, voiceChannelId, state) {
  if (state.voice.connected && state.voice.connection) {
    try { await entersState(state.voice.connection, VoiceConnectionStatus.Ready, 5_000); } catch {}
    return state.voice.connection;
  }
  const channel = guild.channels.cache.get(voiceChannelId);
  if (!channel) throw new Error('VCが見つかりません');

  const connection = joinVoiceChannel({
    channelId: voiceChannelId,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false
  });
  state.voice.connection = connection;
  state.voice.connected = true;

  const player = createAudioPlayer();
  state.voice.player = player;
  connection.subscribe(player);

  player.on(AudioPlayerStatus.Idle, () => {
    state.voice.playing = false;
    processQueue(state);
  });

  player.on('error', (e) => {
    console.warn(`[voice] player error: ${e.message}`);
    state.voice.playing = false;
    processQueue(state);
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
  } catch (e) {
    console.error('[voice] connection not ready:', e.message);
  }
  return connection;
}

function audioPath(token) {
  const f = `${token}.ogg`;
  const p = path.join(AUDIO_DIR, f);
  return fs.existsSync(p) ? p : null;
}

/** 再生キューにトークン配列を積む（存在しないトークンはスキップ） */
function enqueueTokens(state, tokens, gapMs = 80) {
  const files = tokens
    .map(t => audioPath(t))
    .filter(Boolean);
  if (files.length === 0) {
    // 音源が未用意ならログだけ
    console.log(`[voice] (no files) would say: ${tokens.join(' ')}`);
    return;
  }
  state.voice.queue.push({ files, gapMs });
  processQueue(state);
}

function processQueue(state) {
  if (!state.voice.player || state.voice.playing) return;
  const job = state.voice.queue.shift();
  if (!job) return;

  const [first, ...rest] = job.files;
  const playOne = (file) => {
    const res = createAudioResource(file, { inlineVolume: true });
    state.voice.player.play(res);
  };

  let idx = 0;
  const playNext = () => {
    if (idx >= job.files.length) {
      // 全クリップ完了
      state.voice.playing = false;
      return;
    }
    state.voice.playing = true;
    const file = job.files[idx++];
    const onIdle = () => {
      state.voice.player.removeListener(AudioPlayerStatus.Idle, onIdle);
      setTimeout(() => {
        playNext();
      }, job.gapMs);
    };
    state.voice.player.once(AudioPlayerStatus.Idle, onIdle);
    playOne(file);
  };

  playNext();
}

/** 汎用フレーズヘルパー */
function sayReady(state, traitKey) {
  const token = VOICE_TOKENS[traitKey];
  if (!token) return;
  enqueueTokens(state, [token, VOICE_TOKENS.ready]);
}

function sayRemain(state, traitKey, sec) {
  const token = VOICE_TOKENS[traitKey];
  const secToken = sec === 60 ? VOICE_TOKENS.s60
                : sec === 30 ? VOICE_TOKENS.s30
                : sec === 10 ? VOICE_TOKENS.s10
                : sec === 5  ? VOICE_TOKENS.s5 : null;
  if (!token || !secToken) return;
  enqueueTokens(state, [token, VOICE_TOKENS.remain, secToken]);
}

function sayWatcherEvent(state, type /* 'charge1'|'charge2'|'full' */) {
  const t = VOICE_TOKENS['watcher'];
  const map = {
    charge1: VOICE_TOKENS.charge1,
    charge2: VOICE_TOKENS.charge2,
    full: VOICE_TOKENS.full
  };
  const tail = map[type];
  if (!t || !tail) return;
  enqueueTokens(state, [t, tail]);
}

function sayBackcardReady(state) {
  enqueueTokens(state, [VOICE_TOKENS.backcard, VOICE_TOKENS.ready]);
}

module.exports = {
  connectVoice,
  enqueueTokens,
  sayReady,
  sayRemain,
  sayWatcherEvent,
  sayBackcardReady
};
