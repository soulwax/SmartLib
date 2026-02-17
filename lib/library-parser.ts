import "server-only"

import fs from "node:fs"
import path from "node:path"

import type { ResourceCard, ResourceLink } from "@/lib/resources"

const MAX_LINKS_PER_CARD = 10

interface ParsedLink {
  category: string
  url: string
  label: string
}

function normalizeHeading(heading: string) {
  return heading
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeCategory(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function deriveLabelFromUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.replace(/^www\./, "")
    const pathName = parsed.pathname === "/" ? "" : parsed.pathname
    return `${host}${pathName}`
  } catch {
    return rawUrl
  }
}

function extractInlineLabel(line: string) {
  const stripped = line.replace(/<https?:\/\/[^>]+>/g, "").replace(/`/g, "")
  const cleaned = stripped
    .replace(/^[\-*>\s]+/, "")
    .replace(/[\-:;,\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()

  return cleaned.length > 0 ? cleaned : null
}

function chunkLinks(links: ResourceLink[]): ResourceLink[][] {
  const chunks: ResourceLink[][] = []

  for (let index = 0; index < links.length; index += MAX_LINKS_PER_CARD) {
    chunks.push(links.slice(index, index + MAX_LINKS_PER_CARD))
  }

  return chunks
}

export function parseLibraryMarkdown(markdown: string): ResourceCard[] {
  const lines = markdown.split(/\r?\n/)
  const parsedLinks: ParsedLink[] = []

  let activeMainCategory = "General"
  let activeSubCategory: string | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (!line) {
      continue
    }

    if (line.startsWith("### ")) {
      activeSubCategory = normalizeHeading(line)
      continue
    }

    if (line.startsWith("## ")) {
      activeMainCategory = normalizeHeading(line)
      activeSubCategory = null
      continue
    }

    if (line.startsWith("# ")) {
      continue
    }

    const category = normalizeCategory(
      activeSubCategory
        ? `${activeMainCategory} / ${activeSubCategory}`
        : activeMainCategory
    )

    const urls = [...line.matchAll(/<(https?:\/\/[^>]+)>/g)].map((match) =>
      match[1].trim()
    )

    if (urls.length === 0) {
      continue
    }

    const inlineLabel = extractInlineLabel(line)

    urls.forEach((url) => {
      const label =
        urls.length === 1 && inlineLabel
          ? inlineLabel
          : deriveLabelFromUrl(url)

      parsedLinks.push({
        category,
        url,
        label: urls.length > 1 ? deriveLabelFromUrl(url) : label,
      })
    })
  }

  const linksByCategory = new Map<string, ResourceLink[]>()

  for (const link of parsedLinks) {
    const existing = linksByCategory.get(link.category) ?? []
    existing.push({
      id: crypto.randomUUID(),
      url: link.url,
      label: link.label,
    })
    linksByCategory.set(link.category, existing)
  }

  const resources: ResourceCard[] = []

  for (const [category, links] of linksByCategory.entries()) {
    const linkGroups = chunkLinks(links)

    linkGroups.forEach((group) => {
      resources.push({
        id: crypto.randomUUID(),
        workspaceId: "main",
        category,
        ownerUserId: null,
        tags: [],
        links: group,
      })
    })
  }

  return resources
}

export function loadLibraryResourcesFromFile(): ResourceCard[] {
  const markdownPath = path.join(process.cwd(), "LIBRARY.md")

  if (!fs.existsSync(markdownPath)) {
    return []
  }

  const markdown = fs.readFileSync(markdownPath, "utf8")
  return parseLibraryMarkdown(markdown)
}
