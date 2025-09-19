// src/voice/player.js
const fs = require('fs');
const path = require('path');
const {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus,
  createAudioResource,
  createAudioPlayer,
  AudioPlayerStatus,
  StreamType,
  demuxProbe,
} = require('@discordjs/voice');
const { defaultDir } = require('../core/bootstrapAudio');
const { getVoiceToken } = require('./token');

const AUDIO_DIR = process.env.AUDIO_DIR || defaultDir;
const GAP_MS = Number.isFinite(Number(process.env.VOICE_GAP_MS))
  ? Number(process.env.VOICE_GAP_MS)
  : 80; // クリップ間の無音(ms)

/** ギルドごとの接続/プレイヤー/キュー状態 */
const connections = new Map(); // guildId -> VoiceConnection
const players = new Map();     // guildId -> AudioPlayer
const queues = new Map();      // guildId -> string[]（ファイルフルパスのキュー）
const playing = new Map();     // guildId -> boolean

function ensureQueue(guildId) {
  if (!queues.has(guildId)) queues.set(guildId, []);
  return queues.get(guildId);
}

function ensurePlayer(guildId) {
  if (!players.has(guildId)) {
    const p = createAudioPlayer();
    // idle になったら次を流す
    p.on('stateChange', (oldS, newS) => {
      if (newS.status === AudioPlayerStatus.Idle && oldS.status !== AudioPlayerStatus.Idle) {
        playing.set(guildId, false);
        setTimeout(() => playNext(guildId), GAP_MS);
      }
    });
    p.on('error', (err) => {
      console.error('[voice] player error:', err);
      playing.set(guildId, false);
      setTimeout(() => playNext(guildId), GAP_MS);
    });
    players.set(guildId, p);
  }
  return players.get(guildId);
}

/** トークン名から音声ファイルパス（.ogg優先, .wavフォールバック）を得る */
function audioPath(token) {
  const candidates = [`${token}.ogg`, `${token}.wav`];
  for (const f of candidates) {
    const p = path.join(AUDIO_DIR, f);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** クリップファイルから AudioResource を生成（demuxProbeで型自動判定） */
async function makeResource(filePath) {
  const stream = fs.createReadStream(filePath);
  const { stream: probed, type } = await demuxProbe(stream); // 例: StreamType.OggOpus
  return createAudioResource(probed, { inputType: type ?? StreamType.Arbitrary });
}

/** 内部: 次のキューを再生 */
async function playNext(guildId) {
  if (playing.get(guildId)) return;
  const q = ensureQueue(guildId);
  if (q.length === 0) return;

  const filePath = q.shift();
  if (!filePath || !fs.existsSync(filePath)) {
    return setTimeout(() => playNext(guildId), GAP_MS);
  }

  try {
    const player = ensurePlayer(guildId);
    const resource = await makeResource(filePath);
    playing.set(guildId, true);
    player.play(resource);
  } catch (e) {
    console.error('[voice] playNext failed:', e);
    playing.set(guildId, false);
    setTimeout(() => playNext(guildId), GAP_MS);
  }
}

/** キューが空＆停止状態のときだけ再生を始める */
function kickIfIdle(guildId) {
  if (!playing.get(guildId) && ensureQueue(guildId).length > 0) {
    setTimeout(() => playNext(guildId), 0);
  }
}

/** VCに接続（既存があれば使い回し） */
async function connectVoice(guild, channelId) {
  const gid = guild.id;
  let conn = connections.get(gid);
  if (conn && conn.joinConfig.channelId === channelId) {
    return conn;
  }
  try {
    conn = joinVoiceChannel({
      guildId: gid,
      channelId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
      // DAVEを無効化し、AEAD/XSalsa 系にフォールバック（@snazzah/davey不要）
      daveEncryption: false,
    });
    connections.set(gid, conn);

    const player = ensurePlayer(gid);
    conn.subscribe(player);
    await entersState(conn, VoiceConnectionStatus.Ready, 10_000);
    console.log(`[voice] connected guild=${gid} ch=${channelId}`);
    // 接続エラー監視
    conn.on('error', (err) => console.error('[voice] connection error:', err));
    conn.on(VoiceConnectionStatus.Disconnected, () => {
      playing.set(gid, false);
    });
    return conn;
  } catch (e) {
    console.error('[voice] connectVoice error', e);
    throw e;
  }
}

/** トークン列をキューに追加して再生（存在するものだけ） */
function enqueueTokens(guildId, tokens) {
  const files = [];
  for (const t of tokens) {
    const p = audioPath(t);
    if (p) files.push(p);
    else if (!getVoiceToken(t)) console.warn(`[voice] missing token file: ${t}`);
  }
  if (files.length === 0) return;
  ensureQueue(guildId).push(...files);
  kickIfIdle(guildId);
}

/** 直接ファイル名（拡張子不要）を渡して再生 */
function enqueueFiles(guildId, names) {
  const files = [];
  for (const n of names) {
    const pOgg = path.join(AUDIO_DIR, `${n}.ogg`);
    const pWav = path.join(AUDIO_DIR, `${n}.wav`);
    if (fs.existsSync(pOgg)) files.push(pOgg);
    else if (fs.existsSync(pWav)) files.push(pWav);
  }
  if (files.length === 0) return;
  ensureQueue(guildId).push(...files);
  kickIfIdle(guildId);
}

/** 再生を止めてキューを空に（VCは切断しない） */
function stopAll(guildId) {
  const q = ensureQueue(guildId);
  q.splice(0, q.length);
  const player = players.get(guildId);
  if (player) player.stop(true);
  playing.set(guildId, false);
}

/** VCから切断（必要なら） */
function disconnect(guildId) {
  const conn = connections.get(guildId);
  if (conn) {
    try { conn.destroy(); } catch {}
    connections.delete(guildId);
  }
  const player = players.get(guildId);
  if (player) players.delete(guildId);
  queues.delete(guildId);
  playing.delete(guildId);
}

module.exports = {
  connectVoice,
  enqueueTokens,
  enqueueFiles,
  stopAll,
  disconnect,
  AUDIO_DIR,
};
