import "server-only"

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

const scrypt = promisify(scryptCallback)

const SALT_BYTES = 16
const KEY_BYTES = 64

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 72

function validatePasswordLength(password: string) {
  return (
    password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH
  )
}

export async function hashPassword(password: string): Promise<string> {
  if (!validatePasswordLength(password)) {
    throw new Error(
      `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`
    )
  }

  const salt = randomBytes(SALT_BYTES)
  const derived = (await scrypt(password, salt, KEY_BYTES)) as Buffer

  return `${salt.toString("hex")}:${derived.toString("hex")}`
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  if (!validatePasswordLength(password)) {
    return false
  }

  const [saltHex, hashHex] = storedHash.split(":")

  if (!saltHex || !hashHex) {
    return false
  }

  try {
    const salt = Buffer.from(saltHex, "hex")
    const expectedHash = Buffer.from(hashHex, "hex")
    const derived = (await scrypt(password, salt, expectedHash.length)) as Buffer

    if (derived.length !== expectedHash.length) {
      return false
    }

    return timingSafeEqual(derived, expectedHash)
  } catch {
    return false
  }
}
