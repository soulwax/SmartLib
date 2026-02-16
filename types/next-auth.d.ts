import type { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user?: DefaultSession["user"] & {
      id: string
      isAdmin: boolean
      isFirstAdmin: boolean
    }
  }

  interface User {
    id: string
    isAdmin?: boolean
    isFirstAdmin?: boolean
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string
    isAdmin?: boolean
    isFirstAdmin?: boolean
  }
}
