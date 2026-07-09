import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

/**
 * Optional DB access to complete email verification for synthetic users.
 * This orch build does NOT return the verification email HTML in the register
 * response, so the token can only be read from the `email_verifications`
 * table — then the real public /auth/verify-email endpoint is called.
 *
 * Creds come from orch's .env.development (or REAL_DB_* overrides). mysql2 is
 * resolved from orch's node_modules so the editor gains no new dependency.
 * If anything is unavailable, callers fall back to unverified users and the
 * dash-onboarding tests skip with a clear reason.
 */

const ORCH_DIR = process.env.REAL_ORCH_DIR || resolve(process.cwd(), '..', 'orch')

function orchEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  const p = resolve(ORCH_DIR, '.env.development')
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
  return out
}

let mysql: any
function loadMysql(): any | null {
  if (mysql !== undefined) return mysql
  try {
    const req = createRequire(resolve(ORCH_DIR, 'package.json'))
    mysql = req('mysql2/promise')
  } catch {
    mysql = null
  }
  return mysql
}

export function dbConfig() {
  const e = { ...orchEnv(), ...process.env }
  const host = process.env.REAL_DB_HOST || e.DB_HOST
  if (!host) return null
  return {
    host,
    port: Number(process.env.REAL_DB_PORT || e.DB_PORT || 3306),
    user: process.env.REAL_DB_USER || e.DB_USER,
    password: process.env.REAL_DB_PASSWORD || e.DB_PASSWORD,
    database: process.env.REAL_DB_NAME || e.DB_NAME,
  }
}

/**
 * Mark a user's email verified via the real verify endpoint, using the token
 * read from the DB. Returns true on success, false if DB is unavailable.
 */
export async function verifyUserEmailViaDb(
  userId: string,
  orchUrl: string
): Promise<boolean> {
  const cfg = dbConfig()
  const m = loadMysql()
  if (!cfg || !m) return false
  let conn: any
  try {
    conn = await m.createConnection({ ...cfg, connectTimeout: 8000 })
    // one row per user (register upserts on user_id); avoid assuming a
    // created_at column exists
    const [rows] = await conn.execute(
      'SELECT token FROM email_verifications WHERE user_id = ? LIMIT 1',
      [userId]
    )
    const token = rows?.[0]?.token
    if (!token) return false
    const res = await fetch(`${orchUrl}/api/auth/verify-email?token=${token}`, {
      signal: AbortSignal.timeout(8000),
    })
    return res.status < 400
  } catch {
    return false
  } finally {
    if (conn) await conn.end().catch(() => {})
  }
}

let dbProbe: boolean | null = null
export async function dbAvailable(): Promise<boolean> {
  if (dbProbe !== null) return dbProbe
  const cfg = dbConfig()
  const m = loadMysql()
  if (!cfg || !m) return (dbProbe = false)
  try {
    const conn = await m.createConnection({ ...cfg, connectTimeout: 6000 })
    await conn.end()
    dbProbe = true
  } catch {
    dbProbe = false
  }
  return dbProbe
}
