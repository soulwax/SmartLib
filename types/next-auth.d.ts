import type { DefaultSession } from "next-auth"
import type { UserRole } from "@/lib/authorization"

declare module "next-auth" {
  interface Session {
    user?: DefaultSession["user"] & {
      id: string
      role: UserRole
      isAdmin: boolean
      isFirstAdmin: boolean
    }
  }

  interface User {
    id: string
    role?: UserRole
    isAdmin?: boolean
    isFirstAdmin?: boolean
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string
    role?: UserRole
    isAdmin?: boolean
    isFirstAdmin?: boolean
    authStateRefreshedAt?: number
  }
}
