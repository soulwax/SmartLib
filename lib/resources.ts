export interface ResourceLink {
  id: string
  url: string
  label: string
  note?: string | null
  faviconUrl?: string | null
}

export interface ResourceCard {
  id: string
  category: string
  tags: string[]
  links: ResourceLink[]
  deletedAt?: string | null
}

export interface ResourceCategory {
  id: string
  name: string
  symbol?: string | null
  createdAt?: string
  updatedAt?: string
}

export type ResourceAuditAction = "archived" | "restored"

export interface ResourceAuditActor {
  userId?: string | null
  identifier?: string | null
}

export interface ResourceAuditLogEntry {
  id: string
  resourceId: string
  resourceCategory: string
  action: ResourceAuditAction
  actorUserId: string | null
  actorIdentifier: string
  createdAt: string
}

export interface ResourceLinkInput {
  url: string
  label: string
  note?: string
}

export interface ResourceInput {
  category: string
  tags: string[]
  links: ResourceLinkInput[]
}

export const DEFAULT_CATEGORY_SUGGESTIONS = [
  "General",
  "C++",
  "Rust",
  "Go",
  "TypeScript",
  "Python",
  "Graphics / GPU",
  "Game Engines",
  "Math",
  "Networking",
  "DevOps",
  "Databases",
  "Security",
] as const

export type Category = string
