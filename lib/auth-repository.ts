import "server-only"

import { eq, sql, type SQL } from "drizzle-orm"

import { appUsers } from "@/lib/db-schema"
import { ensureSchema, getDb } from "@/lib/db"

export interface AuthUserRecord {
  id: string
  email: string
  passwordHash: string | null
  isAdmin: boolean
  isFirstAdmin: boolean
}

export class UserAlreadyExistsError extends Error {
  constructor(email: string) {
    super(`A user with email ${email} already exists.`)
    this.name = "UserAlreadyExistsError"
  }
}

export class UserNotFoundError extends Error {
  constructor(identifier: string) {
    super(`User ${identifier} was not found.`)
    this.name = "UserNotFoundError"
  }
}

type AuthUserRow = {
  id: string
  email: string
  passwordHash: string | null
  isAdmin: boolean
  isFirstAdmin: boolean
}

function normalizeRow(row: AuthUserRow): AuthUserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    isAdmin: row.isAdmin,
    isFirstAdmin: row.isFirstAdmin,
  }
}

function readErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null
  }

  if ("code" in error && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code
  }

  if (
    "cause" in error &&
    typeof (error as { cause?: unknown }).cause === "object" &&
    (error as { cause?: unknown }).cause !== null &&
    "code" in (error as { cause: { code?: unknown } }).cause &&
    typeof (error as { cause: { code?: unknown } }).cause.code === "string"
  ) {
    return (error as { cause: { code: string } }).cause.code
  }

  return null
}

function isUniqueViolation(error: unknown): boolean {
  return readErrorCode(error) === "23505"
}

async function selectUserByPredicate(predicate: SQL) {
  await ensureSchema()
  const db = getDb()

  const rows = await db
    .select({
      id: appUsers.id,
      email: appUsers.email,
      passwordHash: appUsers.passwordHash,
      isAdmin: appUsers.isAdmin,
      isFirstAdmin: appUsers.isFirstAdmin,
    })
    .from(appUsers)
    .where(predicate)
    .limit(1)

  if (rows.length === 0) {
    return null
  }

  return normalizeRow(rows[0])
}

export async function findUserByEmail(
  email: string
): Promise<AuthUserRecord | null> {
  return selectUserByPredicate(sql`lower(${appUsers.email}) = ${email.toLowerCase()}`)
}

export async function findUserById(id: string): Promise<AuthUserRecord | null> {
  return selectUserByPredicate(eq(appUsers.id, id))
}

export async function hasFirstAdmin(): Promise<boolean> {
  await ensureSchema()
  const db = getDb()

  const rows = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(eq(appUsers.isFirstAdmin, true))
    .limit(1)

  return rows.length > 0
}

export async function createUser(
  email: string,
  passwordHash: string | null
): Promise<AuthUserRecord> {
  await ensureSchema()
  const db = getDb()

  try {
    const rows = await db
      .insert(appUsers)
      .values({
        email: email.toLowerCase(),
        passwordHash,
      })
      .returning({
        id: appUsers.id,
        email: appUsers.email,
        passwordHash: appUsers.passwordHash,
        isAdmin: appUsers.isAdmin,
        isFirstAdmin: appUsers.isFirstAdmin,
      })

    if (rows.length === 0) {
      throw new Error("Failed to insert app user.")
    }

    return normalizeRow(rows[0])
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new UserAlreadyExistsError(email)
    }

    throw error
  }
}

export async function ensureUserByEmail(
  email: string,
  passwordHash: string | null = null
): Promise<AuthUserRecord> {
  const existing = await findUserByEmail(email)
  if (existing) {
    return existing
  }

  return createUser(email, passwordHash)
}

export async function markUserAsAdmin(userId: string): Promise<AuthUserRecord> {
  await ensureSchema()
  const db = getDb()

  const rows = await db
    .update(appUsers)
    .set({ isAdmin: true })
    .where(eq(appUsers.id, userId))
    .returning({
      id: appUsers.id,
      email: appUsers.email,
      passwordHash: appUsers.passwordHash,
      isAdmin: appUsers.isAdmin,
      isFirstAdmin: appUsers.isFirstAdmin,
    })

  if (rows.length === 0) {
    throw new UserNotFoundError(userId)
  }

  return normalizeRow(rows[0])
}

export async function updateUserPasswordHash(
  userId: string,
  passwordHash: string
): Promise<AuthUserRecord> {
  await ensureSchema()
  const db = getDb()

  const rows = await db
    .update(appUsers)
    .set({ passwordHash })
    .where(eq(appUsers.id, userId))
    .returning({
      id: appUsers.id,
      email: appUsers.email,
      passwordHash: appUsers.passwordHash,
      isAdmin: appUsers.isAdmin,
      isFirstAdmin: appUsers.isFirstAdmin,
    })

  if (rows.length === 0) {
    throw new UserNotFoundError(userId)
  }

  return normalizeRow(rows[0])
}

export async function markUserAsFirstAdmin(
  userId: string
): Promise<AuthUserRecord> {
  await ensureSchema()
  const db = getDb()

  try {
    const rows = await db
      .update(appUsers)
      .set({ isAdmin: true, isFirstAdmin: true })
      .where(eq(appUsers.id, userId))
      .returning({
        id: appUsers.id,
        email: appUsers.email,
        passwordHash: appUsers.passwordHash,
        isAdmin: appUsers.isAdmin,
        isFirstAdmin: appUsers.isFirstAdmin,
      })

    if (rows.length === 0) {
      throw new UserNotFoundError(userId)
    }

    return normalizeRow(rows[0])
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await findUserById(userId)
      if (!existing) {
        throw new UserNotFoundError(userId)
      }

      return existing
    }

    throw error
  }
}

export async function makeUserExclusiveFirstAdmin(
  userId: string
): Promise<AuthUserRecord> {
  await ensureSchema()
  const db = getDb()

  await db
    .update(appUsers)
    .set({ isFirstAdmin: false })
    .where(sql`${appUsers.id} <> ${userId}::uuid`)

  const rows = await db
    .update(appUsers)
    .set({ isAdmin: true, isFirstAdmin: true })
    .where(eq(appUsers.id, userId))
    .returning({
      id: appUsers.id,
      email: appUsers.email,
      passwordHash: appUsers.passwordHash,
      isAdmin: appUsers.isAdmin,
      isFirstAdmin: appUsers.isFirstAdmin,
    })

  if (rows.length === 0) {
    throw new UserNotFoundError(userId)
  }

  return normalizeRow(rows[0])
}
