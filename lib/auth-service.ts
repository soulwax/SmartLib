import "server-only"

import {
  createUser as createDbUser,
  ensureUserByEmail as ensureDbUserByEmail,
  findUserByEmail as findDbUser,
  findUserById as findDbUserById,
  hasFirstAdmin as hasDbFirstAdmin,
  makeUserExclusiveFirstAdmin as makeDbUserExclusiveFirstAdmin,
  markUserAsAdmin as markDbUserAsAdmin,
  markUserAsFirstAdmin as markDbUserAsFirstAdmin,
  type AuthUserRecord,
  updateUserPasswordHash as updateDbUserPasswordHash,
  UserAlreadyExistsError,
  UserNotFoundError,
} from "@/lib/auth-repository"
import { hasDatabaseEnv, getOptionalSuperAdminEnv } from "@/lib/env"
import { hashPassword, verifyPassword } from "@/lib/password"

export type AuthDataMode = "database" | "mock"

export class NotFirstAdminError extends Error {
  constructor() {
    super("Only FirstAdmin can grant admin access.")
    this.name = "NotFirstAdminError"
  }
}

const mockUsersByEmail = new Map<string, AuthUserRecord>()
let superAdminBootstrap: Promise<void> | null = null

function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase()
}

function cloneUserRecord(user: AuthUserRecord): AuthUserRecord {
  return {
    id: user.id,
    email: user.email,
    passwordHash: user.passwordHash,
    isAdmin: user.isAdmin,
    isFirstAdmin: user.isFirstAdmin,
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

async function ensureDatabaseSuperAdminSeeded(username: string, password: string) {
  let user = await findDbUser(username)

  if (!user) {
    const passwordHash = await hashPassword(password)
    user = await createDbUser(username, passwordHash)
  } else if (
    !user.passwordHash ||
    !(await verifyPassword(password, user.passwordHash))
  ) {
    const passwordHash = await hashPassword(password)
    user = await updateDbUserPasswordHash(user.id, passwordHash)
  }

  await makeDbUserExclusiveFirstAdmin(user.id)
}

async function ensureMockSuperAdminSeeded(username: string, password: string) {
  const passwordHash = await hashPassword(password)

  for (const existing of mockUsersByEmail.values()) {
    existing.isFirstAdmin = false
  }

  const existing = mockUsersByEmail.get(username)

  if (existing) {
    existing.passwordHash = passwordHash
    existing.isAdmin = true
    existing.isFirstAdmin = true
    mockUsersByEmail.set(username, existing)
    return
  }

  mockUsersByEmail.set(username, {
    id: crypto.randomUUID(),
    email: username,
    passwordHash,
    isAdmin: true,
    isFirstAdmin: true,
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
): Promise<{ mode: AuthDataMode; user: AuthUserRecord }> {
  const mode = currentMode()
  await ensureSuperAdminSeeded()

  const normalizedEmail = normalizeIdentifier(email)

  if (mode === "database") {
    return {
      mode,
      user: await createDbUser(normalizedEmail, passwordHash),
    }
  }

  const existing = mockUsersByEmail.get(normalizedEmail)
  if (existing) {
    throw new UserAlreadyExistsError(normalizedEmail)
  }

  const user: AuthUserRecord = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    passwordHash,
    isAdmin: false,
    isFirstAdmin: false,
  }

  mockUsersByEmail.set(normalizedEmail, user)

  return {
    mode,
    user: cloneUserRecord(user),
  }
}

export async function ensureAuthUserForSignIn(
  identifier: string
): Promise<{ mode: AuthDataMode; user: AuthUserRecord }> {
  const mode = currentMode()
  await ensureSuperAdminSeeded()

  const normalizedIdentifier = normalizeIdentifier(identifier)
  const configuredSuperAdmin = getConfiguredSuperAdmin()

  if (mode === "database") {
    let user = await ensureDbUserByEmail(normalizedIdentifier)

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

    return { mode, user }
  }

  let user = mockUsersByEmail.get(normalizedIdentifier)
  if (!user) {
    user = {
      id: crypto.randomUUID(),
      email: normalizedIdentifier,
      passwordHash: null,
      isAdmin: false,
      isFirstAdmin: false,
    }
    mockUsersByEmail.set(normalizedIdentifier, user)
  }

  if (configuredSuperAdmin && configuredSuperAdmin.username === normalizedIdentifier) {
    for (const existing of mockUsersByEmail.values()) {
      existing.isFirstAdmin = false
    }

    user.isAdmin = true
    user.isFirstAdmin = true
  } else if (!configuredSuperAdmin) {
    const hasFirstAdmin = [...mockUsersByEmail.values()].some(
      (existing) => existing.isFirstAdmin
    )

    if (!hasFirstAdmin) {
      user.isAdmin = true
      user.isFirstAdmin = true
    }
  }

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
  mockUsersByEmail.set(normalizedTarget, targetUser)

  return {
    mode,
    user: cloneUserRecord(targetUser),
  }
}

export { UserAlreadyExistsError, UserNotFoundError }
