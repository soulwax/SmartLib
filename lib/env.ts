/**
 * Returns a boolean from an environment variable.
 * Accepts 'true' (case-insensitive, trimmed) as true, else false.
 */
export function getBooleanEnv(
  key: string,
  defaultValue: boolean = false,
): boolean {
  const raw = process.env[key];
  if (raw == null) {
    return defaultValue;
  }
  return raw.trim().toLowerCase() === "true";
}
import "server-only";

const REQUIRED_DATABASE_ENV = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
] as const;

export class MissingDatabaseEnvironmentError extends Error {
  constructor(missingKeys: string[]) {
    super(
      `Missing required database environment variables: ${missingKeys.join(", ")}`,
    );
    this.name = "MissingDatabaseEnvironmentError";
  }
}

export function hasDatabaseEnv(): boolean {
  return REQUIRED_DATABASE_ENV.every((key) => {
    const value = process.env[key];
    return value !== undefined && value.trim().length > 0;
  });
}

export function getDatabaseEnv(): {
  DATABASE_URL: string;
  DATABASE_URL_UNPOOLED: string;
} {
  const missing = REQUIRED_DATABASE_ENV.filter(
    (key) => !process.env[key]?.trim(),
  );

  if (missing.length > 0) {
    throw new MissingDatabaseEnvironmentError([...missing]);
  }

  return {
    DATABASE_URL: process.env.DATABASE_URL!.trim(),
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED!.trim(),
  };
}

export function getOptionalSuperAdminEnv(): {
  username: string;
  password: string;
} | null {
  const username = process.env.SUPERADMIN_USERNAME?.trim();
  const password = process.env.SUPERADMIN_PASSWORD?.trim();

  if (!username || !password) {
    return null;
  }

  return {
    username,
    password,
  };
}
