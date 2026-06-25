import { randomUUID } from 'node:crypto'
import { query } from '../lib/postgres.js'

interface UserRow {
  id: string
  email: string
  password_hash: string
}

interface SessionUserRow {
  session_id: string
  expires_at: Date
  user_id: string
  email: string
}

export interface AccountUser {
  id: string
  email: string
  passwordHash: string
}

export interface SessionUser {
  sessionId: string
  expiresAt: Date
  user: { id: string; email: string }
}

export class PostgresAccountRepository {
  async findUserByEmail(email: string): Promise<AccountUser | null> {
    const result = await query<UserRow>(
      'SELECT id, email, password_hash FROM users WHERE email = $1 LIMIT 1',
      [email],
    )
    const row = result.rows[0]
    return row ? { id: row.id, email: row.email, passwordHash: row.password_hash } : null
  }

  async createUser(email: string, passwordHash: string): Promise<{ id: string; email: string }> {
    const id = randomUUID()
    const result = await query<{ id: string; email: string }>(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email`,
      [id, email, passwordHash],
    )
    return result.rows[0]
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await query(
      `INSERT INTO sessions (id, token_hash, user_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), tokenHash, userId, expiresAt],
    )
  }

  async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    await query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash])
  }

  async deleteSessionById(id: string): Promise<void> {
    await query('DELETE FROM sessions WHERE id = $1', [id])
  }

  async findUserBySessionHash(tokenHash: string): Promise<SessionUser | null> {
    const result = await query<SessionUserRow>(
      `SELECT s.id AS session_id, s.expires_at, u.id AS user_id, u.email
       FROM sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1
       LIMIT 1`,
      [tokenHash],
    )
    const row = result.rows[0]
    return row
      ? {
          sessionId: row.session_id,
          expiresAt: row.expires_at,
          user: { id: row.user_id, email: row.email },
        }
      : null
  }
}

export const accountRepository = new PostgresAccountRepository()
