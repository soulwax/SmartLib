import { getServerSession, type NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { z } from "zod"

import { findAuthUserByEmail } from "@/lib/auth-service"
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, verifyPassword } from "@/lib/password"

const credentialsSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
})

const authSecret =
  process.env.NEXTAUTH_SECRET ??
  process.env.AUTH_SECRET ??
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.DATABASE_URL ??
  "dev-only-insecure-secret"

export const authOptions: NextAuthOptions = {
  secret: authSecret ?? "dev-only-insecure-secret",
  session: {
    strategy: "jwt",
  },
  providers: [
    CredentialsProvider({
      name: "Email + Password",
      credentials: {
        email: {
          label: "Email",
          type: "email",
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

        const email = parsed.data.email.trim().toLowerCase()
        const password = parsed.data.password

        const { user } = await findAuthUserByEmail(email)
        if (!user) {
          return null
        }

        const validPassword = await verifyPassword(password, user.passwordHash)
        if (!validPassword) {
          return null
        }

        return {
          id: user.id,
          email: user.email,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id
      }

      return token
    },
    async session({ session, token }) {
      if (session.user && typeof token.userId === "string") {
        session.user.id = token.userId
      }

      return session
    },
  },
}

export function auth() {
  return getServerSession(authOptions)
}
