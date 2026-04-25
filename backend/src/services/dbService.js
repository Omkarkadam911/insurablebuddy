import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Connection pool — reuses connections across requests
// ---------------------------------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('[dbService] unexpected pool error:', err.message);
});

// ---------------------------------------------------------------------------
// initDb — creates tables if they don't exist yet.
// Called once at server startup.
// ---------------------------------------------------------------------------
export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT        PRIMARY KEY,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_active TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      user_timezone TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id          BIGSERIAL   PRIMARY KEY,
      session_id  TEXT        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role        TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
      content     TEXT        NOT NULL,
      sources     JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

    -- View: chat_history
    -- Usage: SELECT * FROM chat_history;
    -- Shows every message across all sessions, newest first.
    CREATE OR REPLACE VIEW chat_history AS
    SELECT
      m.id,
      s.id                                          AS session_id,
      s.user_timezone,
      m.role,
      m.content,
      m.sources,
      m.created_at AT TIME ZONE 'UTC'               AS created_at_utc,
      s.created_at AT TIME ZONE 'UTC'               AS session_started_utc
    FROM messages m
    JOIN sessions s ON s.id = m.session_id
    ORDER BY m.created_at DESC;

    -- Function: get_session(session_id)
    -- Usage: SELECT * FROM get_session('paste-session-id-here');
    -- Returns all messages for one session, oldest first (readable as a conversation).
    CREATE OR REPLACE FUNCTION get_session(p_session_id TEXT)
    RETURNS TABLE (
      role        TEXT,
      content     TEXT,
      sources     JSONB,
      created_at  TIMESTAMPTZ
    )
    LANGUAGE sql STABLE AS $$
      SELECT role, content, sources, created_at
      FROM messages
      WHERE session_id = p_session_id
      ORDER BY created_at ASC;
    $$;

    -- Function: recent_sessions(n)
    -- Usage: SELECT * FROM recent_sessions(10);
    -- Lists the N most recently active sessions with message counts.
    CREATE OR REPLACE FUNCTION recent_sessions(p_limit INT DEFAULT 10)
    RETURNS TABLE (
      session_id      TEXT,
      user_timezone   TEXT,
      message_count   BIGINT,
      last_active     TIMESTAMPTZ,
      session_started TIMESTAMPTZ
    )
    LANGUAGE sql STABLE AS $$
      SELECT
        s.id,
        s.user_timezone,
        COUNT(m.id),
        s.last_active,
        s.created_at
      FROM sessions s
      LEFT JOIN messages m ON m.session_id = s.id
      GROUP BY s.id
      ORDER BY s.last_active DESC
      LIMIT p_limit;
    $$;
  `);
  console.log('[dbService] tables, views, and functions ready');
}

// ---------------------------------------------------------------------------
// upsertSession — creates session row on first message, updates last_active
// ---------------------------------------------------------------------------
export async function upsertSession(sessionId, userTimezone) {
  await pool.query(`
    INSERT INTO sessions (id, user_timezone)
    VALUES ($1, $2)
    ON CONFLICT (id) DO UPDATE SET last_active = NOW(), user_timezone = $2
  `, [sessionId, userTimezone]);
}

// ---------------------------------------------------------------------------
// saveMessage — persists a single message to the messages table
// ---------------------------------------------------------------------------
export async function saveMessage(sessionId, role, content, sources = null) {
  await pool.query(`
    INSERT INTO messages (session_id, role, content, sources)
    VALUES ($1, $2, $3, $4)
  `, [sessionId, role, content, sources ? JSON.stringify(sources) : null]);
}

// ---------------------------------------------------------------------------
// getSessionMessages — returns all messages for a session in order
// ---------------------------------------------------------------------------
export async function getSessionMessages(sessionId) {
  const { rows } = await pool.query(`
    SELECT role, content, sources, created_at
    FROM messages
    WHERE session_id = $1
    ORDER BY created_at ASC
  `, [sessionId]);
  return rows;
}
