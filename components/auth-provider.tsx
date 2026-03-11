"use client"

import type React from "react"
import type { Session } from "next-auth"
import { SessionProvider } from "next-auth/react"

export function AuthProvider({
  children,
  session,
}: {
  children: React.ReactNode
  session?: Session | null
}) {
  return <SessionProvider session={session}>{children}</SessionProvider>
}
