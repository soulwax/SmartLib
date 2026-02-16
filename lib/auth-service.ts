import "server-only"

import {
  createUser as createDbUser,
  findUserByEmail as findDbUser,
  type AuthUserRecord,
  UserAlreadyExistsError,
} from "@/lib/auth-repository"
import { hasDatabaseEnv } from "@/lib/env"

export type AuthDataMode = "database" | "mock"

const mockUsersByEmail = new Map<string, AuthUserRecord>()

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function cloneUserRecord(user: AuthUserRecord): AuthUserRecord {
  return {
    id: user.id,
    email: user.email,
    passwordHash: user.passwordHash,
  }
}

function currentMode(): AuthDataMode {
  return hasDatabaseEnv() ? "database" : "mock"
}

export async function findAuthUserByEmail(email: string): Promise<{
  mode: AuthDataMode
  user: AuthUserRecord | null
}> {
  const mode = currentMode()
  const normalizedEmail = normalizeEmail(email)

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

export async function registerAuthUser(
  email: string,
  passwordHash: string
): Promise<{ mode: AuthDataMode; user: AuthUserRecord }> {
  const mode = currentMode()
  const normalizedEmail = normalizeEmail(email)

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
  }

  mockUsersByEmail.set(normalizedEmail, user)

  return {
    mode,
    user: cloneUserRecord(user),
  }
}

export { UserAlreadyExistsError }
