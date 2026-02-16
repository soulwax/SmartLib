import { getServerSession, type NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import GitHubProvider from "next-auth/providers/github"
import { z } from "zod"

import {
  ensureAuthUserForSignIn,
  ensureSuperAdminSeeded,
  findAuthUserByEmail,
  findAuthUserById,
  isConfiguredSuperAdminCredentials,
} from "@/lib/auth-service"
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, verifyPassword } from "@/lib/password"

const credentialsSchema = z.object({
  email: z.string().trim().min(1).max(320),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
})

const authSecret =
  process.env.NEXTAUTH_SECRET ??
  process.env.AUTH_SECRET ??
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.DATABASE_URL ??
  "dev-only-insecure-secret"

const githubClientId = process.env.GITHUB_CLIENT_ID?.trim()
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET?.trim()

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
        const parsed = credentialsSchema.safeParse(credentials)
        if (!parsed.success) {
          return null
        }

        await ensureSuperAdminSeeded()

        const identifier = parsed.data.email.trim().toLowerCase()
        const password = parsed.data.password

        if (isConfiguredSuperAdminCredentials(identifier, password)) {
          const { user } = await ensureAuthUserForSignIn(identifier)

          return {
            id: user.id,
            email: user.email,
            isAdmin: user.isAdmin,
            isFirstAdmin: user.isFirstAdmin,
          }
        }

        const { user } = await findAuthUserByEmail(identifier)
        if (!user?.passwordHash) {
          return null
        }

        const validPassword = await verifyPassword(password, user.passwordHash)
        if (!validPassword) {
          return null
        }

        const { user: syncedUser } = await ensureAuthUserForSignIn(identifier)

        return {
          id: syncedUser.id,
          email: syncedUser.email,
          isAdmin: syncedUser.isAdmin,
          isFirstAdmin: syncedUser.isFirstAdmin,
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      const identifier = user.email?.trim().toLowerCase()
      if (!identifier) {
        return false
      }

      const { user: syncedUser } = await ensureAuthUserForSignIn(identifier)
      user.id = syncedUser.id
      user.email = syncedUser.email
      user.isAdmin = syncedUser.isAdmin
      user.isFirstAdmin = syncedUser.isFirstAdmin

      return true
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id
      }

      if (typeof user?.isAdmin === "boolean") {
        token.isAdmin = user.isAdmin
      }

      if (typeof user?.isFirstAdmin === "boolean") {
        token.isFirstAdmin = user.isFirstAdmin
      }

      if (!token.userId && typeof token.sub === "string") {
        token.userId = token.sub
      }

      if (typeof token.userId === "string") {
        const { user: authUser } = await findAuthUserById(token.userId)

        if (authUser) {
          token.userId = authUser.id
          token.isAdmin = authUser.isAdmin
          token.isFirstAdmin = authUser.isFirstAdmin
          token.email = authUser.email
        }
      }

      return token
    },
    async session({ session, token }) {
      if (session.user) {
        if (typeof token.userId === "string") {
          session.user.id = token.userId
        } else if (typeof token.sub === "string") {
          session.user.id = token.sub
        }

        session.user.isAdmin = token.isAdmin === true
        session.user.isFirstAdmin = token.isFirstAdmin === true
      }

      return session
    },
  },
}

export function auth() {
  return getServerSession(authOptions)
}
