import { z } from "zod"

import { parseResourceInput } from "@/lib/resource-validation"
import type { ResourceInput } from "@/lib/resources"

const DEFAULT_TOBY_CATEGORY = "General"
const DEFAULT_TOBY_LABEL = "Untitled link"

export const TOBY_IMPORT_MAX_LISTS = 100
export const TOBY_IMPORT_MAX_CARDS = 400

const tobyCardSchema = z.object({
  title: z.string().optional().default(""),
  url: z.string().trim().min(1).max(2048),
  customTitle: z.string().optional().default(""),
  customDescription: z.string().optional().default(""),
})

const tobyListSchema = z.object({
  title: z.string().optional().default(""),
  cards: z.array(tobyCardSchema).optional().default([]),
  labels: z.array(z.unknown()).optional().default([]),
})

const tobyImportSchema = z.object({
  version: z.number().int().nonnegative(),
  lists: z.array(tobyListSchema).max(TOBY_IMPORT_MAX_LISTS),
})

export interface TobyJsonImportParseResult {
  importedLists: number
  importedCards: number
  resources: ResourceInput[]
}

function createTobyValidationError(
  path: Array<string | number>,
  message: string,
): z.ZodError {
  return new z.ZodError([
    {
      code: "custom",
      path,
      message,
    },
  ])
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeCategoryName(value: string): string {
  const normalized = normalizeWhitespace(value)
  return normalized || DEFAULT_TOBY_CATEGORY
}

function deriveLabelFromUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    const segments = parsed.pathname
      .split("/")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
    const rawSegment = segments.at(-1)
    if (rawSegment) {
      const decoded = decodeURIComponent(rawSegment)
      const normalized = normalizeWhitespace(
        decoded.replace(/[-_]+/g, " ").replace(/\.[a-z0-9]+$/i, ""),
      )
      if (normalized) {
        return normalized
      }
    }

    const hostname = parsed.hostname.replace(/^www\./i, "")
    return normalizeWhitespace(hostname) || DEFAULT_TOBY_LABEL
  } catch {
    return DEFAULT_TOBY_LABEL
  }
}

function normalizeLabel(card: z.infer<typeof tobyCardSchema>): string {
  const normalizedCustomTitle = normalizeWhitespace(card.customTitle)
  if (normalizedCustomTitle) {
    return normalizedCustomTitle
  }

  const normalizedTitle = normalizeWhitespace(card.title)
  if (normalizedTitle) {
    return normalizedTitle
  }

  return deriveLabelFromUrl(card.url)
}

function normalizeNote(value: string): string | undefined {
  const normalized = normalizeWhitespace(value)
  return normalized || undefined
}

export function parseTobyJsonImport(content: string): TobyJsonImportParseResult {
  const trimmed = content.trim()
  if (!trimmed) {
    throw createTobyValidationError([], "Toby JSON content is required.")
  }

  let payload: unknown
  try {
    payload = JSON.parse(trimmed)
  } catch {
    throw createTobyValidationError([], "Toby import content must be valid JSON.")
  }

  const parsed = tobyImportSchema.parse(payload)
  const totalCards = parsed.lists.reduce(
    (count, list) => count + list.cards.length,
    0,
  )

  if (totalCards === 0) {
    throw createTobyValidationError(
      ["lists"],
      "No Toby cards were found in this export.",
    )
  }

  if (totalCards > TOBY_IMPORT_MAX_CARDS) {
    throw createTobyValidationError(
      ["lists"],
      `Toby JSON imports support up to ${TOBY_IMPORT_MAX_CARDS} cards per import.`,
    )
  }

  const resources: ResourceInput[] = []
  let importedLists = 0

  for (const list of parsed.lists) {
    if (list.cards.length === 0) {
      continue
    }

    importedLists += 1
    const category = normalizeCategoryName(list.title)

    for (const card of list.cards) {
      resources.push(
        parseResourceInput({
          category,
          tags: [],
          links: [
            {
              url: card.url,
              label: normalizeLabel(card),
              note: normalizeNote(card.customDescription),
            },
          ],
        }),
      )
    }
  }

  return {
    importedLists,
    importedCards: resources.length,
    resources,
  }
}
