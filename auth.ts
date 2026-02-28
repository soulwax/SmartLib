import { getServerSession, type NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import { z } from "zod";

import { deriveUserRole } from "@/lib/authorization";
import {
  EmailNotVerifiedError,
  ensureAuthUserByUsername,
  ensureAuthUserForSignIn,
  ensureSuperAdminSeeded,
  findAuthUserByEmail,
  findAuthUserByUsername,
  findAuthUserById,
  isConfiguredSuperAdminCredentials,
} from "@/lib/auth-service";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from "@/lib/password";
import {
  assertRateLimit,
  RATE_LIMIT_RULES,
  RateLimitExceededError,
} from "@/lib/rate-limit";

const credentialsSchema = z.object({
  email: z.string().trim().min(1).max(320),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});
export const GITHUB_FALLBACK_EMAIL_DOMAIN = "github.local";
const DEFAULT_AUTH_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_AUTH_SESSION_UPDATE_AGE_SECONDS = 12 * 60 * 60;
const MIN_AUTH_SESSION_MAX_AGE_SECONDS = 15 * 60;
const MAX_AUTH_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const MIN_AUTH_SESSION_UPDATE_AGE_SECONDS = 5 * 60;

function isProductionEnv(): boolean {
  return process.env.NODE_ENV === "production";
}

function parsePositiveIntegerEnv(
  key: string,
  defaultValue: number,
  options?: {
    minimum?: number;
    maximum?: number;
  },
): number {
  const rawValue = process.env[key]?.trim();
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[auth] Ignoring invalid ${key} value "${rawValue}". Falling back to ${defaultValue}.`,
    );
    return defaultValue;
  }

  if (typeof options?.minimum === "number" && parsed < options.minimum) {
    console.warn(
      `[auth] ${key} value ${parsed} is below minimum ${options.minimum}. Falling back to ${defaultValue}.`,
    );
    return defaultValue;
  }

  if (typeof options?.maximum === "number" && parsed > options.maximum) {
    console.warn(
      `[auth] ${key} value ${parsed} exceeds maximum ${options.maximum}. Falling back to ${defaultValue}.`,
    );
    return defaultValue;
  }

  return parsed;
}

function getSessionLifetimeConfig(): { maxAgeSeconds: number; updateAgeSeconds: number } {
  const maxAgeSeconds = parsePositiveIntegerEnv(
    "AUTH_SESSION_MAX_AGE_SECONDS",
    DEFAULT_AUTH_SESSION_MAX_AGE_SECONDS,
    {
      minimum: MIN_AUTH_SESSION_MAX_AGE_SECONDS,
      maximum: MAX_AUTH_SESSION_MAX_AGE_SECONDS,
    },
  );

  const desiredUpdateAgeSeconds = parsePositiveIntegerEnv(
    "AUTH_SESSION_UPDATE_AGE_SECONDS",
    DEFAULT_AUTH_SESSION_UPDATE_AGE_SECONDS,
    { minimum: MIN_AUTH_SESSION_UPDATE_AGE_SECONDS },
  );
  const maxAllowedUpdateAgeSeconds = Math.max(
    MIN_AUTH_SESSION_UPDATE_AGE_SECONDS,
    maxAgeSeconds - 60,
  );
  const updateAgeSeconds = Math.min(
    desiredUpdateAgeSeconds,
    maxAllowedUpdateAgeSeconds,
  );

  if (updateAgeSeconds !== desiredUpdateAgeSeconds) {
    console.warn(
      `[auth] AUTH_SESSION_UPDATE_AGE_SECONDS reduced to ${updateAgeSeconds} so it stays below session max age.`,
    );
  }

  return { maxAgeSeconds, updateAgeSeconds };
}

function validateAuthBaseUrl(): void {
  const nextAuthUrl = process.env.NEXTAUTH_URL?.trim();
  if (!nextAuthUrl) {
    if (isProductionEnv()) {
      throw new Error(
        "NEXTAUTH_URL must be set in production and should use https://.",
      );
    }
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(nextAuthUrl);
  } catch {
    throw new Error(
      `NEXTAUTH_URL is invalid: "${nextAuthUrl}". Use a full URL like https://example.com.`,
    );
  }

  if (isProductionEnv() && parsedUrl.protocol !== "https:") {
    throw new Error(
      `NEXTAUTH_URL must use https:// in production (received "${nextAuthUrl}").`,
    );
  }
}

function validateAuthSecretStrength(secret: string): void {
  const minimumLength = 32;
  if (secret.length >= minimumLength) {
    return;
  }

  const message =
    `Auth secret is too short (${secret.length}). ` +
    `Use at least ${minimumLength} characters (openssl rand -base64 32).`;

  if (isProductionEnv()) {
    throw new Error(message);
  }

  console.warn(`[auth] WARNING: ${message}`);
}

/**
 * Constructs a fallback email address for GitHub OAuth users when email is not available.
 * Ensures consistent email construction across the codebase.
 */
function constructGitHubFallbackEmail(
  username: string,
  githubId: string | unknown,
): string {
  const normalizedId =
    typeof githubId === "string" && githubId.trim().length > 0
      ? githubId
      : "unknown";
  return `${username.toLowerCase().trim()}+github-${normalizedId}@${GITHUB_FALLBACK_EMAIL_DOMAIN}`;
}

/**
 * Get NextAuth secret with proper security checks.
 * In production, NEXTAUTH_SECRET or AUTH_SECRET MUST be set.
 * In development, falls back to a dev-only secret for convenience.
 */
function getAuthSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;

  if (secret) {
    return secret;
  }

  // Only allow fallback in development mode
  const isDevelopment = !isProductionEnv();

  if (!isDevelopment) {
    throw new Error(
      "NEXTAUTH_SECRET or AUTH_SECRET environment variable must be set in production. " +
        "Generate a secure secret with: openssl rand -base64 32",
    );
  }

  console.warn(
    "[auth] WARNING: Using insecure development secret. " +
      "Set NEXTAUTH_SECRET in production. Generate with: openssl rand -base64 32",
  );

  return "dev-only-insecure-secret-change-in-production";
}

validateAuthBaseUrl();
const authSecret = getAuthSecret();
validateAuthSecretStrength(authSecret);
const sessionLifetime = getSessionLifetimeConfig();
const githubClientId = process.env.GITHUB_CLIENT_ID?.trim();
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();

// Maximum age before we re-fetch/refresh auth-related state (e.g. role/admin flags)
// for a token-backed session. Five minutes is a compromise between:
// - keeping authorization decisions reasonably fresh (shorter TTL = less staleness)
// - avoiding excessive database / auth-service load (longer TTL = fewer refreshes).
// Adjusting this value affects that tradeoff and should be done with care.
const TOKEN_AUTH_STATE_REFRESH_TTL_MS = 5 * 60 * 1000;

/**
 * Returns true if the JWT token contains all required fields for a 'complete' auth state.
 * Required fields: role (string), isAdmin (boolean), isFirstAdmin (boolean), email (non-empty string).
 * This is used to determine if the token is sufficiently hydrated for authorization decisions.
 */
function isAuthStateComplete(token: JWT): boolean {
  return (
    typeof token.userId === "string" &&
    token.userId.length > 0 &&
    typeof token.role === "string" &&
    typeof token.isAdmin === "boolean" &&
    typeof token.isFirstAdmin === "boolean" &&
    typeof token.email === "string" &&
    token.email.length > 0
  );
}

export const authOptions: NextAuthOptions = {
  secret: authSecret,
  session: {
    strategy: "jwt",
    maxAge: sessionLifetime.maxAgeSeconds,
    updateAge: sessionLifetime.updateAgeSeconds,
  },
  jwt: {
    maxAge: sessionLifetime.maxAgeSeconds,
  },
  providers: [
    ...(githubClientId && githubClientSecret
      ? [
          GitHubProvider({
            clientId: githubClientId,
            clientSecret: githubClientSecret,
            profile(profile) {
              // GitHub can return multiple emails. We want the primary, verified one.
              console.log("[auth] GitHub profile received:", {
                id: profile.id,
                email: profile.email,
                login: profile.login,
              });

              const fallbackEmail = constructGitHubFallbackEmail(
                profile.login,
                profile.id,
              );

              return {
                id: profile.id.toString(),
                name: profile.name ?? profile.login,
                email: profile.email || fallbackEmail, // Fallback if email private
                username: profile.login, // Capture GitHub username
                image: profile.avatar_url,
              };
            },
          }),
        ]
      : []),
    CredentialsProvider({
      name: "Email + Password",
      credentials: {
        email: {
          label: "Email or username",
          type: "text",
        },
        password: {
          label: "Password",
          type: "password",
        },
      },
      authorize: async (credentials) => {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }

        await ensureSuperAdminSeeded();

        const identifier = parsed.data.email.trim().toLowerCase();
        const password = parsed.data.password;

        try {
          await assertRateLimit(
            `credentials-signin:${identifier}`,
            RATE_LIMIT_RULES.AUTH_CREDENTIALS_SIGNIN_IDENTIFIER,
            "Too many sign-in attempts. Please wait and try again.",
          );
        } catch (error) {
          if (error instanceof RateLimitExceededError) {
            throw new Error("RATE_LIMITED");
          }
          throw error;
        }

        if (isConfiguredSuperAdminCredentials(identifier, password)) {
          const { user } = await ensureAuthUserForSignIn(identifier, {
            allowCreate: true,
            autoVerifyEmail: true,
          });

          return {
            id: user.id,
            email: user.email,
            role: user.role,
            isAdmin: user.isAdmin,
            isFirstAdmin: user.isFirstAdmin,
          };
        }

        const { user: userByEmail } = await findAuthUserByEmail(identifier);
        const credentialUser =
          userByEmail ?? (await findAuthUserByUsername(identifier)).user;
        if (!credentialUser?.passwordHash) {
          return null;
        }

        const validPassword = await verifyPassword(
          password,
          credentialUser.passwordHash,
        );
        if (!validPassword) {
          return null;
        }

        try {
          const { user: syncedUser } = await ensureAuthUserForSignIn(
            credentialUser.email,
            {
              allowCreate: false,
              requireVerifiedEmail: true,
            },
          );

          return {
            id: syncedUser.id,
            email: syncedUser.email,
            role: syncedUser.role,
            isAdmin: syncedUser.isAdmin,
            isFirstAdmin: syncedUser.isFirstAdmin,
          };
        } catch (error) {
          if (error instanceof EmailNotVerifiedError) {
            throw new Error("EMAIL_NOT_VERIFIED");
          }

          throw error;
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      try {
        console.log("[auth] signIn callback triggered", {
          provider: account?.provider,
          userEmail: user.email,
          username: user.username,
          userId: user.id,
        });

        const isCredentialsSignIn = account?.provider === "credentials";
        const isGitHubSignIn = account?.provider === "github";

        let syncedUser;

        if (isGitHubSignIn && user.username) {
          // GitHub OAuth: use username as primary identifier
          const username = user.username.trim().toLowerCase();
          const fallbackEmail = constructGitHubFallbackEmail(username, user.id);
          const email = user.email?.trim().toLowerCase() || fallbackEmail;
          const canLinkByEmail = !email.endsWith(
            `@${GITHUB_FALLBACK_EMAIL_DOMAIN}`,
          );

          // Check if user exists by username first
          const { user: existingByUsername } =
            await findAuthUserByUsername(username);

          if (existingByUsername) {
            // User already exists with this username
            syncedUser = existingByUsername;
          } else {
            // Check if user exists by email (to link existing accounts)
            const { user: existingByEmail } = await findAuthUserByEmail(email);

            if (existingByEmail && canLinkByEmail) {
              if (!existingByEmail.username) {
                // Found existing account by email without username - link it
                const { updateAuthUserUsername } =
                  await import("@/lib/auth-service");
                const { user: updatedUser } = await updateAuthUserUsername(
                  existingByEmail.id,
                  username,
                );
                syncedUser = updatedUser;
              } else if (existingByEmail.username === username) {
                syncedUser = existingByEmail;
              } else {
                console.error("[auth] github sign-in email conflict", {
                  email,
                  githubUsername: username,
                  existingUsername: existingByEmail.username,
                });
                return false;
              }
            } else {
              // Create new user with username
              const { user: newUser } = await ensureAuthUserByUsername(
                username,
                email,
                null,
                { emailVerifiedAt: new Date() },
              );
              syncedUser = newUser;
            }
          }
        } else {
          // Credentials sign-in: use email
          const identifier = user.email?.trim().toLowerCase();
          if (!identifier) {
            console.error("[auth] signIn failed: no email provided");
            return false;
          }

          const { user: emailUser } = await ensureAuthUserForSignIn(
            identifier,
            {
              allowCreate: !isCredentialsSignIn,
              autoVerifyEmail: false,
              requireVerifiedEmail: isCredentialsSignIn,
            },
          );
          syncedUser = emailUser;
        }

        user.id = syncedUser.id;
        user.email = syncedUser.email;
        user.username = syncedUser.username;
        user.role = syncedUser.role;
        user.isAdmin = syncedUser.isAdmin;
        user.isFirstAdmin = syncedUser.isFirstAdmin;

        console.log("[auth] signIn successful", {
          userId: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
        });

        return true;
      } catch (error) {
        console.error("[auth] signIn callback error:", {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          error,
        });
        return false;
      }
    },
    async jwt({ token, user }) {
      const now = Date.now();

      if (user?.id) {
        token.userId = user.id;
      }

      if (typeof user?.isAdmin === "boolean") {
        token.isAdmin = user.isAdmin;
      }

      if (typeof user?.isFirstAdmin === "boolean") {
        token.isFirstAdmin = user.isFirstAdmin;
      }

      if (typeof user?.role === "string") {
        token.role = user.role;
      }

      if (typeof user?.email === "string") {
        token.email = user.email;
      }

      if (user?.username !== undefined) {
        token.username = user.username;
      }

      if (user?.id) {
        token.authStateRefreshedAt = now;
      }

      if (!token.userId && typeof token.sub === "string") {
        token.userId = token.sub;
      }

      const refreshedAt =
        typeof token.authStateRefreshedAt === "number"
          ? token.authStateRefreshedAt
          : 0;
      const userId = typeof token.userId === "string" ? token.userId : null;
      const hasHydratedAuthState = isAuthStateComplete(token);
      const shouldRefreshAuthState =
        userId !== null &&
        (!hasHydratedAuthState ||
          now - refreshedAt >= TOKEN_AUTH_STATE_REFRESH_TTL_MS);

      if (shouldRefreshAuthState) {
        const { user: authUser } = await findAuthUserById(userId);

        if (authUser) {
          token.userId = authUser.id;
          token.role = authUser.role;
          token.isAdmin = authUser.isAdmin;
          token.isFirstAdmin = authUser.isFirstAdmin;
          token.email = authUser.email;
          token.username = authUser.username;
        } else {
          // Hard-invalidate stale sessions when backing user no longer exists.
          token.userId = "";
          token.sub = "";
          token.role = "viewer";
          token.isAdmin = false;
          token.isFirstAdmin = false;
          token.email = "";
          token.username = null;
        }

        token.authStateRefreshedAt = now;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        if (typeof token.userId === "string" && token.userId.length > 0) {
          session.user.id = token.userId;
        } else {
          session.user.id = "";
        }

        session.user.username = token.username ?? null;
        session.user.role = deriveUserRole({
          role: typeof token.role === "string" ? token.role : null,
          isAdmin: token.isAdmin === true,
          isFirstAdmin: token.isFirstAdmin === true,
        });
        session.user.isAdmin = token.isAdmin === true;
        session.user.isFirstAdmin = token.isFirstAdmin === true;
      }

      return session;
    },
  },
};

export function auth() {
  return getServerSession(authOptions);
}
