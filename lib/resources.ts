export interface ResourceLink {
  id: string
  url: string
  label: string
  note?: string | null
}

export interface ResourceCard {
  id: string
  category: string
  links: ResourceLink[]
  deletedAt?: string | null
}

export interface ResourceLinkInput {
  url: string
  label: string
  note?: string
}

export interface ResourceInput {
  category: string
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
