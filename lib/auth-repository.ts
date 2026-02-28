import "server-only"

import { and, eq, gt, isNull, sql, type SQL } from "drizzle-orm"

import type { UserRole } from "@/lib/authorization"
import {
  appUsers,
  emailVerificationTokens,
  passwordResetTokens,
} from "@/lib/db-schema"
import { ensureSchema, getDb } from "@/lib/db"

export interface AuthUserRecord {
  id: string
  email: string
  username: string | null
  passwordHash: string | null
  role: UserRole
  isAdmin: boolean
  isFirstAdmin: boolean
  emailVerifiedAt: string | null
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

export interface EmailVerificationTokenRecord {
  id: string
  userId: string
  tokenHash: string
  expiresAt: string
  consumedAt: string | null
  createdAt: string
}

export interface PasswordResetTokenRecord {
  id: string
  userId: string
  tokenHash: string
  expiresAt: string
  consumedAt: string | null
  createdAt: string
}

type AuthUserRow = {
  id: string
  email: string
  username: string | null
  passwordHash: string | null
  role: string
  isAdmin: boolean
  isFirstAdmin: boolean
  emailVerifiedAt: Date | string | null
}

type AuthTokenRow = {
  id: string
  userId: string
  tokenHash: string
  expiresAt: Date | string
  consumedAt: Date | string | null
  createdAt: Date | string
}

function normalizeTimestamp(value: Date | string | null): string | null {
  if (!value) {
    return null
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  return value
}

function normalizeTokenTimestamp(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString()
  }

  return value
}

function normalizeRow(row: AuthUserRow): AuthUserRecord {
  const role: UserRole =
    row.isFirstAdmin
      ? "first_admin"
      : row.isAdmin
        ? "admin"
        : row.role === "viewer"
          ? "viewer"
          : row.role === "editor"
            ? "editor"
            : "viewer"

  return {
    id: row.id,
    email: row.email,
    username: row.username,
    passwordHash: row.passwordHash,
    role,
    isAdmin: row.isAdmin,
    isFirstAdmin: row.isFirstAdmin,
    emailVerifiedAt: normalizeTimestamp(row.emailVerifiedAt),
  }
}

function normalizeTokenRow(
  row: AuthTokenRow
): EmailVerificationTokenRecord {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    expiresAt: normalizeTokenTimestamp(row.expiresAt),
    consumedAt: normalizeTimestamp(row.consumedAt),
    createdAt: normalizeTokenTimestamp(row.createdAt),
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
      username: appUsers.username,
      passwordHash: appUsers.passwordHash,
      role: appUsers.role,
      isAdmin: appUsers.isAdmin,
      isFirstAdmin: appUsers.isFirstAdmin,
      emailVerifiedAt: appUsers.emailVerifiedAt,
    })
    .from(appUsers)
    .where(predicate)
    .limit(1)

  if (rows.length === 0) {
    return null
  }

  return normalizeRow(rows[0] as AuthUserRow)
}

export async function findUserByEmail(
  email: string
): Promise<AuthUserRecord | null> {
  return selectUserByPredicate(sql`lower(${appUsers.email}) = ${email.toLowerCase()}`)
}

export async function findUserByUsername(
  username: string
): Promise<AuthUserRecord | null> {
  return selectUserByPredicate(sql`lower(${appUsers.username}) = ${username.toLowerCase()}`)
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
  passwordHash: string | null,
  options?: { emailVerifiedAt?: Date | null; role?: UserRole; username?: string | null }
): Promise<AuthUserRecord> {
  await ensureSchema()
  const db = getDb()

  const emailVerifiedAt = options?.emailVerifiedAt ?? null
  const role = options?.role ?? "editor"
  const username = options?.username ?? null

  try {
    const rows = await db
      .insert(appUsers)
      .values({
        email: email.toLowerCase(),
        username,
        passwordHash,
        role,
        emailVerifiedAt,
      })
      .returning({
        id: appUsers.id,
        email: appUsers.email,
        username: appUsers.username,
        passwordHash: appUsers.passwordHash,
        role: appUsers.role,
        isAdmin: appUsers.isAdmin,
        isFirstAdmin: appUsers.isFirstAdmin,
        emailVerifiedAt: appUsers.emailVerifiedAt,
      })

    if (rows.length === 0) {
      throw new Error("Failed to insert app user.")
    }

    return normalizeRow(rows[0] as AuthUserRow)
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new UserAlreadyExistsError(email)
    }

    throw error
  }
}

export async function ensureUserByEmail(
  email: string,
  passwordHash: string | null = null,
  options?: { emailVerifiedAt?: Date | null; role?: UserRole; username?: string | null }
): Promise<AuthUserRecord> {
  const existing = await findUserByEmail(email)
  if (existing) {
    return existing
  }

  return createUser(email, passwordHash, options)
}

export async function ensureUserByUsername(
  username: string,
  email: string,
  passwordHash: string | null = null,
  options?: { emailVerifiedAt?: Date | null; role?: UserRole }
): Promise<AuthUserRecord> {
  const existing = await findUserByUsername(username)
  if (existing) {
    return existing
  }

  return createUser(email, passwordHash, { ...options, username })
}

export async function markUserAsAdmin(userId: string): Promise<AuthUserRecord> {
  await ensureSchema()
  const db = getDb()

  const rows = await db
    .update(appUsers)
    .set({ isAdmin: true, isFirstAdmin: false, role: "admin" })
    .where(eq(appUsers.id, userId))
    .returning({
      id: appUsers.id,
      email: appUsers.email,
      passwordHash: appUsers.passwordHash,
      role: appUsers.role,
      isAdmin: appUsers.isAdmin,
      isFirstAdmin: appUsers.isFirstAdmin,
      emailVerifiedAt: appUsers.emailVerifiedAt,
    })

  if (rows.length === 0) {
    throw new UserNotFoundError(userId)
  }

  return normalizeRow(rows[0] as AuthUserRow)
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
      username: appUsers.username,
      passwordHash: appUsers.passwordHash,
      role: appUsers.role,
      isAdmin: appUsers.isAdmin,
      isFirstAdmin: appUsers.isFirstAdmin,
      emailVerifiedAt: appUsers.emailVerifiedAt,
    })

  if (rows.length === 0) {
    throw new UserNotFoundError(userId)
  }

  return normalizeRow(rows[0] as AuthUserRow)
}

export async function updateUserUsername(
  userId: string,
  username: string
): Promise<AuthUserRecord> {
  await ensureSchema()
  const db = getDb()

  const rows = await db
    .update(appUsers)
    .set({ username: username.toLowerCase() })
    .where(eq(appUsers.id, userId))
    .returning({
      id: appUsers.id,
      email: appUsers.email,
      username: appUsers.username,
      passwordHash: appUsers.passwordHash,
      role: appUsers.role,
      isAdmin: appUsers.isAdmin,
      isFirstAdmin: appUsers.isFirstAdmin,
      emailVerifiedAt: appUsers.emailVerifiedAt,
    })

  if (rows.length === 0) {
    throw new UserNotFoundError(userId)
  }

  return normalizeRow(rows[0] as AuthUserRow)
}

export async function markUserEmailVerified(
  userId: string
): Promise<AuthUserRecord> {
  await ensureSchema()
  const db = getDb()

  const rows = await db
    .update(appUsers)
    .set({
      emailVerifiedAt: sql`COALESCE(${appUsers.emailVerifiedAt}, NOW())`,
    })
    .where(eq(appUsers.id, userId))
    .returning({
      id: appUsers.id,
      email: appUsers.email,
      passwordHash: appUsers.passwordHash,
      role: appUsers.role,
      isAdmin: appUsers.isAdmin,
      isFirstAdmin: appUsers.isFirstAdmin,
      emailVerifiedAt: appUsers.emailVerifiedAt,
    })

  if (rows.length === 0) {
    throw new UserNotFoundError(userId)
  }

  return normalizeRow(rows[0] as AuthUserRow)
}

export async function createEmailVerificationToken(
  userId: string,
  tokenHash: string,
  expiresAt: Date
): Promise<EmailVerificationTokenRecord> {
  await ensureSchema()
  const db = getDb()

  await db
    .update(emailVerificationTokens)
    .set({
      consumedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(emailVerificationTokens.userId, userId),
        isNull(emailVerificationTokens.consumedAt)
      )
    )

  const rows = await db
    .insert(emailVerificationTokens)
    .values({
      userId,
      tokenHash,
      expiresAt,
    })
    .returning({
      id: emailVerificationTokens.id,
      userId: emailVerificationTokens.userId,
      tokenHash: emailVerificationTokens.tokenHash,
      expiresAt: emailVerificationTokens.expiresAt,
      consumedAt: emailVerificationTokens.consumedAt,
      createdAt: emailVerificationTokens.createdAt,
    })

  const created = rows[0]
  if (!created) {
    throw new Error("Failed to create email verification token.")
  }

  return normalizeTokenRow(created as AuthTokenRow)
}

export async function consumeEmailVerificationToken(
  tokenHash: string
): Promise<EmailVerificationTokenRecord | null> {
  await ensureSchema()
  const db = getDb()

  const rows = await db
    .select({
      id: emailVerificationTokens.id,
      userId: emailVerificationTokens.userId,
      tokenHash: emailVerificationTokens.tokenHash,
      expiresAt: emailVerificationTokens.expiresAt,
      consumedAt: emailVerificationTokens.consumedAt,
      createdAt: emailVerificationTokens.createdAt,
    })
    .from(emailVerificationTokens)
    .where(
      and(
        eq(emailVerificationTokens.tokenHash, tokenHash),
        isNull(emailVerificationTokens.consumedAt),
        gt(emailVerificationTokens.expiresAt, sql`NOW()`)
      )
    )
    .limit(1)

  const token = rows[0]
  if (!token) {
    return null
  }

  const consumedRows = await db
    .update(emailVerificationTokens)
    .set({
      consumedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(emailVerificationTokens.id, token.id),
        isNull(emailVerificationTokens.consumedAt)
      )
    )
    .returning({
      id: emailVerificationTokens.id,
      userId: emailVerificationTokens.userId,
      tokenHash: emailVerificationTokens.tokenHash,
      expiresAt: emailVerificationTokens.expiresAt,
      consumedAt: emailVerificationTokens.consumedAt,
      createdAt: emailVerificationTokens.createdAt,
    })

  const consumed = consumedRows[0]
  if (!consumed) {
    return null
  }

  return normalizeTokenRow(consumed as AuthTokenRow)
}

export async function createPasswordResetToken(
  userId: string,
  tokenHash: string,
  expiresAt: Date
): Promise<PasswordResetTokenRecord> {
  await ensureSchema()
  const db = getDb()

  await db
    .update(passwordResetTokens)
    .set({
      consumedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(passwordResetTokens.userId, userId),
        isNull(passwordResetTokens.consumedAt)
      )
    )

  const rows = await db
    .insert(passwordResetTokens)
    .values({
      userId,
      tokenHash,
      expiresAt,
    })
    .returning({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      tokenHash: passwordResetTokens.tokenHash,
      expiresAt: passwordResetTokens.expiresAt,
      consumedAt: passwordResetTokens.consumedAt,
      createdAt: passwordResetTokens.createdAt,
    })

  const created = rows[0]
  if (!created) {
    throw new Error("Failed to create password reset token.")
  }

  return normalizeTokenRow(created as AuthTokenRow)
}

export async function consumePasswordResetToken(
  tokenHash: string
): Promise<PasswordResetTokenRecord | null> {
  await ensureSchema()
  const db = getDb()

  const rows = await db
    .select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      tokenHash: passwordResetTokens.tokenHash,
      expiresAt: passwordResetTokens.expiresAt,
      consumedAt: passwordResetTokens.consumedAt,
      createdAt: passwordResetTokens.createdAt,
    })
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.consumedAt),
        gt(passwordResetTokens.expiresAt, sql`NOW()`)
      )
    )
    .limit(1)

  const token = rows[0]
  if (!token) {
    return null
  }

  const consumedRows = await db
    .update(passwordResetTokens)
    .set({
      consumedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(passwordResetTokens.id, token.id),
        isNull(passwordResetTokens.consumedAt)
      )
    )
    .returning({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      tokenHash: passwordResetTokens.tokenHash,
      expiresAt: passwordResetTokens.expiresAt,
      consumedAt: passwordResetTokens.consumedAt,
      createdAt: passwordResetTokens.createdAt,
    })

  const consumed = consumedRows[0]
  if (!consumed) {
    return null
  }

  return normalizeTokenRow(consumed as AuthTokenRow)
}

export async function markUserAsFirstAdmin(
  userId: string
): Promise<AuthUserRecord> {
  await ensureSchema()
  const db = getDb()

  try {
    const rows = await db
      .update(appUsers)
      .set({ isAdmin: true, isFirstAdmin: true, role: "first_admin" })
      .where(eq(appUsers.id, userId))
      .returning({
        id: appUsers.id,
        email: appUsers.email,
        username: appUsers.username,
        passwordHash: appUsers.passwordHash,
        role: appUsers.role,
        isAdmin: appUsers.isAdmin,
        isFirstAdmin: appUsers.isFirstAdmin,
        emailVerifiedAt: appUsers.emailVerifiedAt,
      })

    if (rows.length === 0) {
      throw new UserNotFoundError(userId)
    }

    return normalizeRow(rows[0] as AuthUserRow)
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
    .set({
      isFirstAdmin: false,
      role: sql`CASE WHEN ${appUsers.role} = 'first_admin' THEN 'admin' ELSE ${appUsers.role} END`,
    })
    .where(sql`${appUsers.id} <> ${userId}::uuid`)

  const rows = await db
    .update(appUsers)
    .set({ isAdmin: true, isFirstAdmin: true, role: "first_admin" })
    .where(eq(appUsers.id, userId))
    .returning({
      id: appUsers.id,
      email: appUsers.email,
      passwordHash: appUsers.passwordHash,
      role: appUsers.role,
      isAdmin: appUsers.isAdmin,
      isFirstAdmin: appUsers.isFirstAdmin,
      emailVerifiedAt: appUsers.emailVerifiedAt,
    })

  if (rows.length === 0) {
    throw new UserNotFoundError(userId)
  }

  return normalizeRow(rows[0] as AuthUserRow)
}

export async function listUsers(limit = 500): Promise<AuthUserRecord[]> {
  await ensureSchema()
  const db = getDb()
  const boundedLimit = Math.max(1, Math.min(limit, 2000))

  const rows = await db
    .select({
      id: appUsers.id,
      email: appUsers.email,
      passwordHash: appUsers.passwordHash,
      role: appUsers.role,
      isAdmin: appUsers.isAdmin,
      isFirstAdmin: appUsers.isFirstAdmin,
      emailVerifiedAt: appUsers.emailVerifiedAt,
    })
    .from(appUsers)
    .orderBy(sql`lower(${appUsers.email}) asc`)
    .limit(boundedLimit)

  return rows.map((row) => normalizeRow(row as AuthUserRow))
}

export async function updateUserRole(
  userId: string,
  role: UserRole
): Promise<AuthUserRecord> {
  await ensureSchema()
  const db = getDb()

  if (role === "first_admin") {
    await db
      .update(appUsers)
      .set({
        isFirstAdmin: false,
        role: sql`CASE WHEN ${appUsers.role} = 'first_admin' THEN 'admin' ELSE ${appUsers.role} END`,
      })
      .where(sql`${appUsers.id} <> ${userId}::uuid`)
  }

  const rows = await db
    .update(appUsers)
    .set({
      role,
      isAdmin: role === "admin" || role === "first_admin",
      isFirstAdmin: role === "first_admin",
    })
    .where(eq(appUsers.id, userId))
    .returning({
      id: appUsers.id,
      email: appUsers.email,
      passwordHash: appUsers.passwordHash,
      role: appUsers.role,
      isAdmin: appUsers.isAdmin,
      isFirstAdmin: appUsers.isFirstAdmin,
      emailVerifiedAt: appUsers.emailVerifiedAt,
    })

  const updated = rows[0]
  if (!updated) {
    throw new UserNotFoundError(userId)
  }

  return normalizeRow(updated as AuthUserRow)
}

export async function deleteUserById(userId: string): Promise<void> {
  await ensureSchema()
  const db = getDb()

  const rows = await db
    .delete(appUsers)
    .where(eq(appUsers.id, userId))
    .returning({
      id: appUsers.id,
    })

  if (rows.length === 0) {
    throw new UserNotFoundError(userId)
  }
}
