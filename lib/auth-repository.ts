import "server-only"

import { ensureSchema, getSql } from "@/lib/db"

interface AuthUserRow {
  id: string
  email: string
  password_hash: string
}

export interface AuthUserRecord {
  id: string
  email: string
  passwordHash: string
}

export class UserAlreadyExistsError extends Error {
  constructor(email: string) {
    super(`A user with email ${email} already exists.`)
    this.name = "UserAlreadyExistsError"
  }
}

function normalizeRow(row: AuthUserRow): AuthUserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false
  }

  return (
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    (error as { code: string }).code === "23505"
  )
}

export async function findUserByEmail(
  email: string
): Promise<AuthUserRecord | null> {
  await ensureSchema()
  const sql = getSql()

  const rows = (await sql`
    SELECT id, email, password_hash
    FROM app_users
    WHERE lower(email) = lower(${email})
    LIMIT 1
  `) as AuthUserRow[]

  if (rows.length === 0) {
    return null
  }

  return normalizeRow(rows[0])
}

export async function createUser(
  email: string,
  passwordHash: string
): Promise<AuthUserRecord> {
  await ensureSchema()
  const sql = getSql()

  try {
    const rows = (await sql`
      INSERT INTO app_users (email, password_hash)
      VALUES (${email.toLowerCase()}, ${passwordHash})
      RETURNING id, email, password_hash
    `) as AuthUserRow[]

    return normalizeRow(rows[0])
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new UserAlreadyExistsError(email)
    }

    throw error
  }
}
