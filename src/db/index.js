// src/db/index.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase は SSL 必須
});

async function init() {
  // 起動時に最低限の存在チェック（本番は SQL Editor で作ってある前提）
  await pool.query(`
    create extension if not exists pgcrypto;
    create table if not exists matches (
      id uuid primary key default gen_random_uuid(),
      guild_id     text not null,
      channel_id   text not null,
      started_at   timestamptz not null,
      ended_at     timestamptz,
      mode         text not null check (mode in ('rank','multi')),
      map          text,
      bans_surv    text[] default '{}',
      bans_hunter  text[] default '{}',
      picks_surv   text[] default '{}',
      pick_hunter  text,
      result       text check (result in ('win','draw','lose')),
      created_by   text,
      meta         jsonb default '{}'
    );
    create index if not exists idx_matches_guild_time on matches (guild_id, started_at desc);
  `);
  console.log('[db] init ok');
}

function assertMode(mode) {
  if (!['rank', 'multi'].includes(mode)) {
    throw new Error(`[db] invalid mode: ${mode} (allowed: 'rank'|'multi')`);
  }
}

async function createMatch({ guildId, channelId, mode, createdBy }) {
  assertMode(mode);
  const res = await pool.query(
    `insert into matches (guild_id, channel_id, started_at, mode, created_by)
     values ($1,$2, now(), $3, $4) returning id`,
    [guildId, channelId, mode, createdBy || null]
  );
  return res.rows[0].id;
}

async function updateMatch(id, patch) {
  // 可変更新：渡されたキーだけ更新
  const fields = [];
  const vals = [];
  let idx = 1;
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = $${idx++}`);
    vals.push(v);
  }
  if (!fields.length) return;
  vals.push(id);
  const sql = `update matches set ${fields.join(', ')} where id = $${idx}`;
  await pool.query(sql, vals);
}

async function closeMatch(id) {
  await pool.query(`update matches set ended_at = now() where id = $1`, [id]);
}

async function getRecentMatches(guildId, limit = 20) {
  const res = await pool.query(
    `select * from matches where guild_id = $1 order by started_at desc limit $2`,
    [guildId, limit]
  );
  return res.rows;
}

module.exports = {
  pool,
  init,
  createMatch,
  updateMatch,
  closeMatch,
  getRecentMatches,
};
