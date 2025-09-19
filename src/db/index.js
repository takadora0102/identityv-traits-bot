// src/db/index.js
const fs = require('fs');
const { Pool } = require('pg');

function resolveSslConfig() {
  if (process.env.DB_SSL_REJECT_UNAUTHORIZED === 'false') {
    return { rejectUnauthorized: false };
  }

  const caPath = process.env.DB_SSL_CA_PATH;
  if (caPath) {
    try {
      fs.accessSync(caPath, fs.constants.R_OK);
      return { ca: fs.readFileSync(caPath, 'utf8') };
    } catch (err) {
      console.warn(`[db] Failed to read DB SSL CA file at ${caPath}: ${err.message}`);
    }
  }

  return true;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: resolveSslConfig(),
});

pool.on('error', (err) => {
  console.error('[db] pool error:', err);
});

async function init() {
  try {
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
  } catch (err) {
    console.error('[db] init failed:', err);
    throw err;
  }
}

async function createMatch({ guildId, channelId, mode, createdBy }) {
  try {
    const res = await pool.query(
      `insert into matches (guild_id, channel_id, started_at, mode, created_by)
       values ($1,$2, now(), $3, $4) returning id`,
      [guildId, channelId, mode, createdBy || null]
    );
    const id = res.rows[0].id;
    console.log('[db] createMatch ok:', id);
    return id;
  } catch (err) {
    console.error('[db] createMatch failed:', err);
    throw err;
  }
}

async function updateMatch(id, patch) {
  try {
    // 可変更新：渡されたキーだけ更新
    const fields = [];
    const vals = [];
    let idx = 1;
    for (const [k, v] of Object.entries(patch)) {
      fields.push(`${k} = $${idx++}`);
      vals.push(v);
    }
    if (!fields.length) {
      console.log('[db] updateMatch skipped (no fields):', id);
      return;
    }
    vals.push(id);
    const sql = `update matches set ${fields.join(', ')} where id = $${idx}`;
    await pool.query(sql, vals);
    console.log('[db] updateMatch ok:', id);
  } catch (err) {
    console.error('[db] updateMatch failed:', err);
    throw err;
  }
}

async function closeMatch(id) {
  try {
    await pool.query(`update matches set ended_at = now() where id = $1`, [id]);
    console.log('[db] closeMatch ok:', id);
  } catch (err) {
    console.error('[db] closeMatch failed:', err);
    throw err;
  }
}

async function getRecentMatches(guildId, limit = 20) {
  try {
    const res = await pool.query(
      `select * from matches where guild_id = $1 order by started_at desc limit $2`,
      [guildId, limit]
    );
    console.log('[db] getRecentMatches ok:', guildId, `(${res.rows.length})`);
    return res.rows;
  } catch (err) {
    console.error('[db] getRecentMatches failed:', err);
    throw err;
  }
}

module.exports = {
  pool,
  init,
  createMatch,
  updateMatch,
  closeMatch,
  getRecentMatches,
};
