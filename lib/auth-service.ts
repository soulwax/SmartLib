import "server-only"

import { createHash, randomBytes, randomUUID } from "node:crypto"

import {
  consumeEmailVerificationToken as consumeDbEmailVerificationToken,
  createEmailVerificationToken as createDbEmailVerificationToken,
  createUser as createDbUser,
  ensureUserByEmail as ensureDbUserByEmail,
  ensureUserByUsername as ensureDbUserByUsername,
  findUserByEmail as findDbUser,
  findUserByUsername as findDbUserByUsername,
  findUserById as findDbUserById,
  hasFirstAdmin as hasDbFirstAdmin,
  listUsers as listDbUsers,
  makeUserExclusiveFirstAdmin as makeDbUserExclusiveFirstAdmin,
  markUserAsAdmin as markDbUserAsAdmin,
  markUserAsFirstAdmin as markDbUserAsFirstAdmin,
  markUserEmailVerified as markDbUserEmailVerified,
  type AuthUserRecord,
  updateUserRole as updateDbUserRole,
  updateUserPasswordHash as updateDbUserPasswordHash,
  UserAlreadyExistsError,
  UserNotFoundError,
} from "@/lib/auth-repository"
import type { UserRole } from "@/lib/authorization"
import { hasDatabaseEnv, getOptionalSuperAdminEnv } from "@/lib/env"
import { hashPassword, verifyPassword } from "@/lib/password"

export type AuthDataMode = "database" | "mock"

const EMAIL_VERIFICATION_TTL_MINUTES = 60 * 24

interface VerificationEmailDelivery {
  mode: "resend" | "mock"
  previewUrl?: string
}

interface VerifyTokenRecord {
  userId: string
  tokenHash: string
  expiresAt: string
  consumedAt: string | null
}

type EnsureAuthUserForSignInOptions = {
  allowCreate?: boolean
  autoVerifyEmail?: boolean
  requireVerifiedEmail?: boolean
}

export class NotFirstAdminError extends Error {
  constructor() {
    super("Only FirstAdmin can grant admin access.")
    this.name = "NotFirstAdminError"
  }
}

export class EmailNotVerifiedError extends Error {
  constructor() {
    super("Email address must be verified before sign-in.")
    this.name = "EmailNotVerifiedError"
  }
}

export class InvalidEmailVerificationTokenError extends Error {
  constructor() {
    super("Email verification token is invalid or expired.")
    this.name = "InvalidEmailVerificationTokenError"
  }
}

const mockUsersByEmail = new Map<string, AuthUserRecord>()
const mockUsersByUsername = new Map<string, AuthUserRecord>()
const mockVerificationTokensByHash = new Map<string, VerifyTokenRecord>()
let superAdminBootstrap: Promise<void> | null = null

function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase()
}

function cloneUserRecord(user: AuthUserRecord): AuthUserRecord {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    passwordHash: user.passwordHash,
    role: user.role,
    isAdmin: user.isAdmin,
    isFirstAdmin: user.isFirstAdmin,
    emailVerifiedAt: user.emailVerifiedAt,
  }
}

function currentMode(): AuthDataMode {
  return hasDatabaseEnv() ? "database" : "mock"
}

function getConfiguredSuperAdmin(): { username: string; password: string } | null {
  const configured = getOptionalSuperAdminEnv()
  if (!configured) {
    return null
  }

  return {
    username: normalizeIdentifier(configured.username),
    password: configured.password,
  }
}

function getEmailVerificationBaseUrl(): string {
  const explicit =
    process.env.EMAIL_VERIFICATION_BASE_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim()
  if (explicit) {
    return explicit.replace(/\/+$/, "")
  }

  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) {
    return `https://${vercel.replace(/\/+$/, "")}`
  }

  return "http://localhost:3000"
}

function getEmailFromAddress(): string | null {
  const configured =
    process.env.EMAIL_FROM?.trim() || process.env.RESEND_FROM?.trim() || null
  return configured
}

function hashEmailVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

function generateEmailVerificationToken(): string {
  return randomBytes(32).toString("base64url")
}

function getEmailVerificationExpiryDate(): Date {
  const expiresAt = new Date()
  expiresAt.setMinutes(expiresAt.getMinutes() + EMAIL_VERIFICATION_TTL_MINUTES)
  return expiresAt
}

function buildEmailVerificationUrl(token: string): string {
  const baseUrl = getEmailVerificationBaseUrl()
  const url = new URL("/api/auth/verify-email", `${baseUrl}/`)
  url.searchParams.set("token", token)
  return url.toString()
}

async function sendEmailVerificationEmail(
  recipientEmail: string,
  verificationUrl: string
): Promise<VerificationEmailDelivery> {
  const resendApiKey = process.env.RESEND_API_KEY?.trim()
  const fromAddress = getEmailFromAddress()

  if (!resendApiKey || !fromAddress) {
    console.info(
      `[auth] verification email fallback for ${recipientEmail}: ${verificationUrl}`
    )
    return {
      mode: "mock",
      previewUrl: verificationUrl,
    }
  }

  const expiryHours = EMAIL_VERIFICATION_TTL_MINUTES / 60
  // Unique per-send ID prevents Gmail from collapsing re-sends into a thread
  const entityRefId = randomBytes(16).toString("hex")

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Confirm your lib.bluesix account</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;">
  <!-- Hidden preheader — controls inbox preview text -->
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">Confirm your email to activate your lib.bluesix account — link expires in ${expiryHours} hours.</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:8px;border:1px solid #e2e8f0;">
        <tr><td style="padding:32px 40px 0;">
          <p style="margin:0;font-size:13px;font-weight:600;color:#64748b;letter-spacing:0.06em;text-transform:uppercase;">lib.bluesix</p>
        </td></tr>
        <tr><td style="padding:24px 40px 32px;">
          <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;line-height:1.3;color:#0f172a;">Confirm your email address</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">You are one step away from your personal library. Click the button below to confirm your email and activate your account.</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
            <tr><td style="background:#0f172a;border-radius:6px;">
              <a href="${verificationUrl}" style="display:inline-block;padding:13px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">Confirm email address</a>
            </td></tr>
          </table>
          <p style="margin:0 0 6px;font-size:13px;color:#64748b;">If the button does not work, copy and paste this URL into your browser:</p>
          <p style="margin:0;font-size:12px;word-break:break-all;"><a href="${verificationUrl}" style="color:#0f172a;">${verificationUrl}</a></p>
        </td></tr>
        <tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e2e8f0;margin:0;"></td></tr>
        <tr><td style="padding:20px 40px 28px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">This link expires in ${expiryHours} hours. If you did not create a lib.bluesix account, you can safely ignore this email — no account will be created without confirmation.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = [
    "lib.bluesix — Confirm your email address",
    "",
    "You are one step away from your personal library.",
    "Click the link below to confirm your email and activate your account:",
    "",
    verificationUrl,
    "",
    `This link expires in ${expiryHours} hours.`,
    "If you did not create a lib.bluesix account, you can safely ignore this email.",
  ].join("\n")

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [recipientEmail],
        subject: "Confirm your lib.bluesix account",
        html,
        text,
        headers: {
          // Prevents Gmail from threading repeated sends together
          "X-Entity-Ref-ID": entityRefId,
        },
        tags: [{ name: "category", value: "email-verification" }],
      }),
    })

    if (!response.ok) {
      const responseText = await response.text()
      console.error(
        `[auth] resend delivery failed (${response.status}) for ${recipientEmail}: ${responseText || "No response body."}`
      )
    } else {
      return {
        mode: "resend",
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error(
      `[auth] resend delivery exception for ${recipientEmail}: ${message}`
    )
  }

  console.info(
    `[auth] verification email fallback for ${recipientEmail}: ${verificationUrl}`
  )
  return {
    mode: "mock",
    previewUrl: verificationUrl,
  }
}

async function issueAndSendVerificationForDbUser(
  user: AuthUserRecord
): Promise<VerificationEmailDelivery> {
  const rawToken = generateEmailVerificationToken()
  const hashedToken = hashEmailVerificationToken(rawToken)
  const expiresAt = getEmailVerificationExpiryDate()

  await createDbEmailVerificationToken(user.id, hashedToken, expiresAt)
  return sendEmailVerificationEmail(user.email, buildEmailVerificationUrl(rawToken))
}

async function issueAndSendVerificationForMockUser(
  user: AuthUserRecord
): Promise<VerificationEmailDelivery> {
  const rawToken = generateEmailVerificationToken()
  const hashedToken = hashEmailVerificationToken(rawToken)
  const expiresAt = getEmailVerificationExpiryDate().toISOString()

  for (const [key, value] of mockVerificationTokensByHash.entries()) {
    if (value.userId === user.id && value.consumedAt === null) {
      mockVerificationTokensByHash.set(key, {
        ...value,
        consumedAt: new Date().toISOString(),
      })
    }
  }

  mockVerificationTokensByHash.set(hashedToken, {
    userId: user.id,
    tokenHash: hashedToken,
    expiresAt,
    consumedAt: null,
  })

  return sendEmailVerificationEmail(user.email, buildEmailVerificationUrl(rawToken))
}

async function ensureDatabaseSuperAdminSeeded(username: string, password: string) {
  let user = await findDbUser(username)

  if (!user) {
    const passwordHash = await hashPassword(password)
    user = await createDbUser(username, passwordHash, {
      emailVerifiedAt: new Date(),
    })
  } else if (
    !user.passwordHash ||
    !(await verifyPassword(password, user.passwordHash))
  ) {
    const passwordHash = await hashPassword(password)
    user = await updateDbUserPasswordHash(user.id, passwordHash)
  }

  if (!user.emailVerifiedAt) {
    user = await markDbUserEmailVerified(user.id)
  }

  await makeDbUserExclusiveFirstAdmin(user.id)
}

async function ensureMockSuperAdminSeeded(username: string, password: string) {
  const passwordHash = await hashPassword(password)
  const now = new Date().toISOString()

  for (const existing of mockUsersByEmail.values()) {
    existing.isFirstAdmin = false
  }

  const existing = mockUsersByEmail.get(username)

  if (existing) {
    existing.passwordHash = passwordHash
    existing.role = "first_admin"
    existing.isAdmin = true
    existing.isFirstAdmin = true
    existing.emailVerifiedAt = existing.emailVerifiedAt ?? now
    mockUsersByEmail.set(username, existing)
    return
  }

  mockUsersByEmail.set(username, {
    id: crypto.randomUUID(),
    email: username,
    username: null,
    passwordHash,
    role: "first_admin",
    isAdmin: true,
    isFirstAdmin: true,
    emailVerifiedAt: now,
  })
}

async function seedConfiguredSuperAdmin(mode: AuthDataMode) {
  const configured = getConfiguredSuperAdmin()

  if (!configured) {
    return
  }

  if (mode === "database") {
    await ensureDatabaseSuperAdminSeeded(configured.username, configured.password)
    return
  }

  await ensureMockSuperAdminSeeded(configured.username, configured.password)
}

export async function ensureSuperAdminSeeded() {
  if (superAdminBootstrap !== null) {
    await superAdminBootstrap
    return
  }

  const mode = currentMode()

  superAdminBootstrap = (async () => {
    await seedConfiguredSuperAdmin(mode)
  })()

  try {
    await superAdminBootstrap
  } catch (error) {
    superAdminBootstrap = null
    throw error
  }
}

export function isConfiguredSuperAdminCredentials(
  identifier: string,
  password: string
): boolean {
  const configured = getConfiguredSuperAdmin()

  if (!configured) {
    return false
  }

  return (
    normalizeIdentifier(identifier) === configured.username &&
    password === configured.password
  )
}

export async function findAuthUserByEmail(identifier: string): Promise<{
  mode: AuthDataMode
  user: AuthUserRecord | null
}> {
  const mode = currentMode()
  await ensureSuperAdminSeeded()

  const normalizedEmail = normalizeIdentifier(identifier)

  if (mode === "database") {
    return {
      mode,
      user: await findDbUser(normalizedEmail),
    }
  }

  const user = mockUsersByEmail.get(normalizedEmail) ?? null
  return {
    mode,
    user: user ? cloneUserRecord(user) : null,
  }
}

export async function findAuthUserByUsername(username: string): Promise<{
  mode: AuthDataMode
  user: AuthUserRecord | null
}> {
  const mode = currentMode()
  await ensureSuperAdminSeeded()

  const normalizedUsername = normalizeIdentifier(username)

  if (mode === "database") {
    return {
      mode,
      user: await findDbUserByUsername(normalizedUsername),
    }
  }

  const user = mockUsersByUsername.get(normalizedUsername) ?? null
  return {
    mode,
    user: user ? cloneUserRecord(user) : null,
  }
}

export async function ensureAuthUserByUsername(
  username: string,
  email: string,
  passwordHash: string | null = null,
  options?: { emailVerifiedAt?: Date | null; role?: UserRole }
): Promise<{
  mode: AuthDataMode
  user: AuthUserRecord
}> {
  const mode = currentMode()
  await ensureSuperAdminSeeded()

  const normalizedUsername = normalizeIdentifier(username)
  const normalizedEmail = normalizeIdentifier(email)

  if (mode === "database") {
    return {
      mode,
      user: await ensureDbUserByUsername(
        normalizedUsername,
        normalizedEmail,
        passwordHash,
        options
      ),
    }
  }

  // Mock mode: check username first
  let user = mockUsersByUsername.get(normalizedUsername)
  if (user) {
    return {
      mode,
      user: cloneUserRecord(user),
    }
  }

  // Create new mock user
  const now = new Date().toISOString()
  user = {
    id: randomUUID(),
    email: normalizedEmail,
    username: normalizedUsername,
    passwordHash,
    role: options?.role ?? "editor",
    isAdmin: options?.role === "admin" || options?.role === "first_admin",
    isFirstAdmin: options?.role === "first_admin",
    emailVerifiedAt: options?.emailVerifiedAt?.toISOString() ?? now,
  }
  mockUsersByEmail.set(normalizedEmail, user)
  mockUsersByUsername.set(normalizedUsername, user)

  return {
    mode,
    user: cloneUserRecord(user),
  }
}

export async function findAuthUserById(id: string): Promise<{
  mode: AuthDataMode
  user: AuthUserRecord | null
}> {
  const mode = currentMode()
  await ensureSuperAdminSeeded()

  if (mode === "database") {
    return {
      mode,
      user: await findDbUserById(id),
    }
  }

  for (const user of mockUsersByEmail.values()) {
    if (user.id === id) {
      return {
        mode,
        user: cloneUserRecord(user),
      }
    }
  }

  return {
    mode,
    user: null,
  }
}

export async function registerAuthUser(
  email: string,
  passwordHash: string
): Promise<{
  mode: AuthDataMode
  user: AuthUserRecord
  verificationDelivery: VerificationEmailDelivery
}> {
  const mode = currentMode()
  await ensureSuperAdminSeeded()

  const normalizedEmail = normalizeIdentifier(email)

  if (mode === "database") {
    const user = await createDbUser(normalizedEmail, passwordHash, {
      emailVerifiedAt: null,
    })

    const verificationDelivery = await issueAndSendVerificationForDbUser(user)

    return {
      mode,
      user,
      verificationDelivery,
    }
  }

  const existing = mockUsersByEmail.get(normalizedEmail)
  if (existing) {
    throw new UserAlreadyExistsError(normalizedEmail)
  }

  const user: AuthUserRecord = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    username: null,
    passwordHash,
    role: "editor",
    isAdmin: false,
    isFirstAdmin: false,
    emailVerifiedAt: null,
  }

  mockUsersByEmail.set(normalizedEmail, user)
  const verificationDelivery = await issueAndSendVerificationForMockUser(user)

  return {
    mode,
    user: cloneUserRecord(user),
    verificationDelivery,
  }
}

export async function resendAuthVerificationEmail(
  email: string
): Promise<{
  mode: AuthDataMode
  delivered: VerificationEmailDelivery
  alreadyVerified: boolean
}> {
  const mode = currentMode()
  await ensureSuperAdminSeeded()

  const normalizedEmail = normalizeIdentifier(email)

  if (mode === "database") {
    const user = await findDbUser(normalizedEmail)
    if (!user) {
      throw new UserNotFoundError(normalizedEmail)
    }

    if (user.emailVerifiedAt) {
      return {
        mode,
        delivered: { mode: "mock" },
        alreadyVerified: true,
      }
    }

    const delivered = await issueAndSendVerificationForDbUser(user)
    return {
      mode,
      delivered,
      alreadyVerified: false,
    }
  }

  const user = mockUsersByEmail.get(normalizedEmail)
  if (!user) {
    throw new UserNotFoundError(normalizedEmail)
  }

  if (user.emailVerifiedAt) {
    return {
      mode,
      delivered: { mode: "mock" },
      alreadyVerified: true,
    }
  }

  const delivered = await issueAndSendVerificationForMockUser(user)

  return {
    mode,
    delivered,
    alreadyVerified: false,
  }
}

export async function verifyAuthEmailToken(
  rawToken: string
): Promise<{ mode: AuthDataMode; user: AuthUserRecord }> {
  const mode = currentMode()
  await ensureSuperAdminSeeded()

  const normalizedRawToken = rawToken.trim()
  if (!normalizedRawToken) {
    throw new InvalidEmailVerificationTokenError()
  }

  const tokenHash = hashEmailVerificationToken(normalizedRawToken)

  if (mode === "database") {
    const token = await consumeDbEmailVerificationToken(tokenHash)
    if (!token) {
      throw new InvalidEmailVerificationTokenError()
    }

    const user = await markDbUserEmailVerified(token.userId)

    return {
      mode,
      user,
    }
  }

  const token = mockVerificationTokensByHash.get(tokenHash)
  if (!token) {
    throw new InvalidEmailVerificationTokenError()
  }

  if (token.consumedAt) {
    throw new InvalidEmailVerificationTokenError()
  }

  if (Date.parse(token.expiresAt) <= Date.now()) {
    throw new InvalidEmailVerificationTokenError()
  }

  mockVerificationTokensByHash.set(tokenHash, {
    ...token,
    consumedAt: new Date().toISOString(),
  })

  const user = [...mockUsersByEmail.values()].find(
    (existing) => existing.id === token.userId
  )

  if (!user) {
    throw new InvalidEmailVerificationTokenError()
  }

  user.emailVerifiedAt = user.emailVerifiedAt ?? new Date().toISOString()
  mockUsersByEmail.set(user.email, user)

  return {
    mode,
    user: cloneUserRecord(user),
  }
}

export async function ensureAuthUserForSignIn(
  identifier: string,
  options?: EnsureAuthUserForSignInOptions
): Promise<{ mode: AuthDataMode; user: AuthUserRecord }> {
  const mode = currentMode()
  await ensureSuperAdminSeeded()

  const normalizedIdentifier = normalizeIdentifier(identifier)
  const configuredSuperAdmin = getConfiguredSuperAdmin()
  const allowCreate = options?.allowCreate ?? true
  const autoVerifyEmail = options?.autoVerifyEmail ?? false
  const requireVerifiedEmail = options?.requireVerifiedEmail ?? false

  if (mode === "database") {
    let user = allowCreate
      ? await ensureDbUserByEmail(normalizedIdentifier)
      : await findDbUser(normalizedIdentifier)

    if (!user) {
      throw new UserNotFoundError(normalizedIdentifier)
    }

    if (autoVerifyEmail && !user.emailVerifiedAt) {
      user = await markDbUserEmailVerified(user.id)
    }

    if (configuredSuperAdmin && configuredSuperAdmin.username === normalizedIdentifier) {
      user = await makeDbUserExclusiveFirstAdmin(user.id)
      return { mode, user }
    }

    if (!configuredSuperAdmin) {
      const hasFirstAdmin = await hasDbFirstAdmin()
      if (!hasFirstAdmin) {
        user = await markDbUserAsFirstAdmin(user.id)
      }
    }

    if (requireVerifiedEmail && !user.emailVerifiedAt) {
      throw new EmailNotVerifiedError()
    }

    return { mode, user }
  }

  let user = mockUsersByEmail.get(normalizedIdentifier)
  if (!user) {
    if (!allowCreate) {
      throw new UserNotFoundError(normalizedIdentifier)
    }

    user = {
      id: crypto.randomUUID(),
      email: normalizedIdentifier,
      username: null,
      passwordHash: null,
      role: "editor",
      isAdmin: false,
      isFirstAdmin: false,
      emailVerifiedAt: null,
    }
    mockUsersByEmail.set(normalizedIdentifier, user)
  }

  if (autoVerifyEmail && !user.emailVerifiedAt) {
    user.emailVerifiedAt = new Date().toISOString()
  }

  if (configuredSuperAdmin && configuredSuperAdmin.username === normalizedIdentifier) {
    for (const existing of mockUsersByEmail.values()) {
      existing.role = existing.isFirstAdmin ? "admin" : existing.role
      existing.isFirstAdmin = false
    }

    user.role = "first_admin"
    user.isAdmin = true
    user.isFirstAdmin = true
  } else if (!configuredSuperAdmin) {
    const hasFirstAdmin = [...mockUsersByEmail.values()].some(
      (existing) => existing.isFirstAdmin
    )

    if (!hasFirstAdmin) {
      user.role = "first_admin"
      user.isAdmin = true
      user.isFirstAdmin = true
    }
  }

  if (requireVerifiedEmail && !user.emailVerifiedAt) {
    throw new EmailNotVerifiedError()
  }

  mockUsersByEmail.set(normalizedIdentifier, user)

  return {
    mode,
    user: cloneUserRecord(user),
  }
}

export async function promoteAuthUserToAdmin(
  actingUserId: string,
  targetIdentifier: string
): Promise<{ mode: AuthDataMode; user: AuthUserRecord }> {
  const mode = currentMode()
  await ensureSuperAdminSeeded()

  const normalizedTarget = normalizeIdentifier(targetIdentifier)

  if (mode === "database") {
    const actingUser = await findDbUserById(actingUserId)

    if (!actingUser) {
      throw new UserNotFoundError(actingUserId)
    }

    if (!actingUser.isFirstAdmin) {
      throw new NotFirstAdminError()
    }

    const targetUser = await findDbUser(normalizedTarget)
    if (!targetUser) {
      throw new UserNotFoundError(normalizedTarget)
    }

    const promotedUser =
      targetUser.isAdmin ? targetUser : await markDbUserAsAdmin(targetUser.id)

    return {
      mode,
      user: promotedUser,
    }
  }

  const actingUser = [...mockUsersByEmail.values()].find(
    (user) => user.id === actingUserId
  )

  if (!actingUser) {
    throw new UserNotFoundError(actingUserId)
  }

  if (!actingUser.isFirstAdmin) {
    throw new NotFirstAdminError()
  }

  const targetUser = mockUsersByEmail.get(normalizedTarget)
  if (!targetUser) {
    throw new UserNotFoundError(normalizedTarget)
  }

  targetUser.isAdmin = true
  targetUser.role = "admin"
  mockUsersByEmail.set(normalizedTarget, targetUser)

  return {
    mode,
    user: cloneUserRecord(targetUser),
  }
}

export async function listAuthUsers(
  limit = 500
): Promise<{ mode: AuthDataMode; users: AuthUserRecord[] }> {
  const mode = currentMode()
  await ensureSuperAdminSeeded()

  if (mode === "database") {
    return {
      mode,
      users: await listDbUsers(limit),
    }
  }

  const boundedLimit = Math.max(1, Math.min(limit, 2000))
  const users = [...mockUsersByEmail.values()]
    .slice()
    .sort((left, right) => left.email.localeCompare(right.email))
    .slice(0, boundedLimit)
    .map(cloneUserRecord)

  return {
    mode,
    users,
  }
}

export async function updateAuthUserRole(
  userId: string,
  role: UserRole
): Promise<{ mode: AuthDataMode; user: AuthUserRecord }> {
  const mode = currentMode()
  await ensureSuperAdminSeeded()

  if (mode === "database") {
    const user = await updateDbUserRole(userId, role)
    return { mode, user }
  }

  const targetUser = [...mockUsersByEmail.values()].find((user) => user.id === userId)
  if (!targetUser) {
    throw new UserNotFoundError(userId)
  }

  if (role === "first_admin") {
    for (const existing of mockUsersByEmail.values()) {
      if (existing.id !== userId && existing.isFirstAdmin) {
        existing.isFirstAdmin = false
        existing.isAdmin = true
        existing.role = "admin"
      }
    }
  }

  targetUser.role = role
  targetUser.isAdmin = role === "admin" || role === "first_admin"
  targetUser.isFirstAdmin = role === "first_admin"
  mockUsersByEmail.set(targetUser.email, targetUser)

  return {
    mode,
    user: cloneUserRecord(targetUser),
  }
}

export async function findFirstAdminAuthUser(): Promise<{
  mode: AuthDataMode
  user: AuthUserRecord | null
}> {
  const mode = currentMode()
  await ensureSuperAdminSeeded()

  if (mode === "database") {
    const users = await listDbUsers(500)
    const firstAdmin = users.find((user) => user.isFirstAdmin) ?? null
    return { mode, user: firstAdmin }
  }

  const user =
    [...mockUsersByEmail.values()].find((candidate) => candidate.isFirstAdmin) ?? null
  return {
    mode,
    user: user ? cloneUserRecord(user) : null,
  }
}

export { UserAlreadyExistsError, UserNotFoundError }
