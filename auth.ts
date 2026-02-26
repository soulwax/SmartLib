import { getServerSession, type NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import { z } from "zod";

import { deriveUserRole } from "@/lib/authorization";
import {
  EmailNotVerifiedError,
  ensureAuthUserForSignIn,
  ensureSuperAdminSeeded,
  findAuthUserByEmail,
  findAuthUserById,
  isConfiguredSuperAdminCredentials,
} from "@/lib/auth-service";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from "@/lib/password";

const credentialsSchema = z.object({
  email: z.string().trim().min(1).max(320),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

const authSecret =
  process.env.NEXTAUTH_SECRET ??
  process.env.AUTH_SECRET ??
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.DATABASE_URL ??
  "dev-only-insecure-secret";

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
    typeof token.role === "string" &&
    typeof token.isAdmin === "boolean" &&
    typeof token.isFirstAdmin === "boolean" &&
    typeof token.email === "string" &&
    token.email.length > 0
  );
}

export const authOptions: NextAuthOptions = {
  secret: authSecret ?? "dev-only-insecure-secret",
  session: {
    strategy: "jwt",
  },
  providers: [
    ...(githubClientId && githubClientSecret
      ? [
          GitHubProvider({
            clientId: githubClientId,
            clientSecret: githubClientSecret,
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

        const { user } = await findAuthUserByEmail(identifier);
        if (!user?.passwordHash) {
          return null;
        }

        const validPassword = await verifyPassword(password, user.passwordHash);
        if (!validPassword) {
          return null;
        }

        try {
          const { user: syncedUser } = await ensureAuthUserForSignIn(
            identifier,
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
          userId: user.id,
        });

        const identifier = user.email?.trim().toLowerCase();
        if (!identifier) {
          console.error("[auth] signIn failed: no email provided by OAuth provider");
          return false;
        }

        const isCredentialsSignIn = account?.provider === "credentials";
        const isGitHubSignIn = account?.provider === "github";

        const { user: syncedUser } = await ensureAuthUserForSignIn(identifier, {
          allowCreate: !isCredentialsSignIn,
          autoVerifyEmail: isGitHubSignIn,
          requireVerifiedEmail: isCredentialsSignIn,
        });

        user.id = syncedUser.id;
        user.email = syncedUser.email;
        user.role = syncedUser.role;
        user.isAdmin = syncedUser.isAdmin;
        user.isFirstAdmin = syncedUser.isFirstAdmin;

        console.log("[auth] signIn successful", {
          userId: user.id,
          email: user.email,
          role: user.role,
        });

        return true;
      } catch (error) {
        console.error("[auth] signIn callback error:", error);
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
        }

        token.authStateRefreshedAt = now;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        if (typeof token.userId === "string") {
          session.user.id = token.userId;
        } else if (typeof token.sub === "string") {
          session.user.id = token.sub;
        }

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
