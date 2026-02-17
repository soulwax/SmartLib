import { z } from "zod"

import type { ResourceInput, ResourceLinkInput } from "@/lib/resources"

const resourceLinkSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  label: z.string().trim().min(1).max(120),
  note: z.string().trim().max(280).optional(),
})

const resourceInputSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  category: z.string().trim().min(1).max(80),
  tags: z.array(z.string().trim().min(1).max(40)).max(24).optional(),
  links: z.array(resourceLinkSchema).min(1).max(100),
})

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim()

function normalizeUrl(rawUrl: string) {
  const normalizedUrl = rawUrl.trim()
  let parsed: URL

  try {
    parsed = new URL(normalizedUrl)
  } catch {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["links", "url"],
        message: "Link URL must be a valid absolute URL.",
      },
    ])
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["links", "url"],
        message: "Link URL must use http or https.",
      },
    ])
  }

  return parsed.toString()
}

function normalizeLink(link: ResourceLinkInput): ResourceLinkInput {
  const note = link.note ? normalizeWhitespace(link.note) : undefined

  return {
    url: normalizeUrl(link.url),
    label: normalizeWhitespace(link.label),
    note: note && note.length > 0 ? note : undefined,
  }
}

function normalizeTag(rawTag: string): string {
  return normalizeWhitespace(rawTag)
}

export function parseResourceInput(payload: unknown): ResourceInput {
  const parsed = resourceInputSchema.parse(payload)
  const tags = parsed.tags ?? []
  const seen = new Set<string>()
  const normalizedTags: string[] = []

  for (const tag of tags) {
    const normalizedTag = normalizeTag(tag)
    if (!normalizedTag) {
      continue
    }

    const key = normalizedTag.toLowerCase()
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    normalizedTags.push(normalizedTag)
  }

  return {
    workspaceId: parsed.workspaceId,
    category: normalizeWhitespace(parsed.category),
    tags: normalizedTags,
    links: parsed.links.map(normalizeLink),
  }
}
