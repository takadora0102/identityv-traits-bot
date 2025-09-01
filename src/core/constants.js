// 特質・CT定義と音声トークン定義

const TRAITS = {
  listen: {
    key: 'listen',
    label: 'リッスン',
    startCT: 20,     // 開始時のみ
    afterCT: null,   // 実運用不要
    convCT: 80       // 最大CT（換算用）
  },
  abnormal: {
    key: 'abnormal',
    label: '異常',
    startCT: 40,
    afterCT: 90,
    convCT: 90
  },
  excitement: {
    key: 'excitement',
    label: '興奮',
    startCT: 40,
    afterCT: 100,
    convCT: 100
  },
  peeper: {
    key: 'peeper',
    label: '巡視者',
    startCT: 30,
    afterCT: 90,
    convCT: 90
  },
  teleport: {
    key: 'teleport',
    label: '瞬間移動',
    startCT: 45,
    afterCT: 100,
    convCT: 100
  },
  watcher: {
    key: 'watcher',
    label: '監視者',
    startCT: 10,      // 開幕1個は10sでチャージ
    afterCT: 30,      // 以後は30sごとに1個
    convCT: 90,       // 換算ゲージ=90s（3個満タン）
    stacksMax: 3
  },
  blink: {
    key: 'blink',
    label: '神出鬼没',
    startCT: 60,
    afterCT: 150,
    convCT: 150
  },
  transition: {
    key: 'transition',
    label: '移形',
    startCT: 50,
    afterCT: 100,
    convCT: 100
  }
};

// 試合開始時に「使用可能」をアナウンスする対象（ユーザ指定）
const INITIAL_NOTIFY_TRAITS = ['excitement', 'teleport', 'transition', 'blink'];

// 裏向きカードが使用可能になる時刻（試合開始からの秒）
const BACKCARD_UNLOCK_SEC = 120;

// 音声トークン → ファイル名（拡張子は .ogg 推奨。存在しない場合はログのみ）
const VOICE_TOKENS = {
  // 特質名
  excitement: 'kofun',
  teleport: 'shunkan',
  transition: 'ikei',
  blink: 'shinshutsu',
  abnormal: 'ijou',
  peeper: 'junshisha',
  watcher: 'kanshisha',
  listen: 'listen',
  backcard: 'uramuki',

  // 汎用語
  remain: 'nokori',
  ready: 'tsukae_masu',
  full: 'mantan',
  charge1: 'hitotsu_kaifuku',
  charge2: 'futatsu_kaifuku',
  next_charge_in: 'tsugi_charge_made',

  // 秒数
  s5: '5byo',
  s10: '10byo',
  s30: '30byo',
  s60: '60byo'
};

module.exports = {
  TRAITS,
  INITIAL_NOTIFY_TRAITS,
  BACKCARD_UNLOCK_SEC,
  VOICE_TOKENS
};
