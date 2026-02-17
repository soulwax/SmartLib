export const USER_ROLES = [
  "viewer",
  "editor",
  "admin",
  "first_admin",
] as const

export type UserRole = (typeof USER_ROLES)[number]

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole)
}

export function deriveUserRole(input: {
  role?: string | null
  isAdmin?: boolean
  isFirstAdmin?: boolean
}): UserRole {
  if (input.isFirstAdmin) {
    return "first_admin"
  }

  if (input.isAdmin) {
    return "admin"
  }

  if (isUserRole(input.role)) {
    return input.role
  }

  return "viewer"
}

export function hasAdminAccess(role: UserRole): boolean {
  return role === "admin" || role === "first_admin"
}

export function hasFirstAdminAccess(role: UserRole): boolean {
  return role === "first_admin"
}

export function canCreateResources(role: UserRole): boolean {
  return role !== "viewer"
}

export function canManageResource(
  role: UserRole,
  actorUserId: string | null | undefined,
  ownerUserId: string | null | undefined
): boolean {
  if (hasAdminAccess(role)) {
    return true
  }

  if (role !== "editor") {
    return false
  }

  if (!actorUserId || !ownerUserId) {
    return false
  }

  return actorUserId === ownerUserId
}
