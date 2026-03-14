import "server-only"

import { generateAiText } from "@/lib/ai-provider"
import {
  normalizeDraftCategory,
  normalizeDraftLabel,
  normalizeDraftNote,
  normalizeDraftTags,
} from "@/lib/link-paste"

const MAX_ITEMS = 25

export interface AiInboxRefinementInputItem {
  id: string
  url: string
  label: string
  note?: string | null
  category?: string | null
  tags?: string[]
}

export interface AiInboxRefinementItem {
  id: string
  label: string
  note: string
  category: string | null
  tags: string[]
}

export interface AiInboxRefinementResult {
  items: AiInboxRefinementItem[]
  usedAi: boolean
  model: string | null
  warning: string | null
}

interface RefineAiInboxItemsInput {
  items: AiInboxRefinementInputItem[]
  categories?: string[]
  useAi?: boolean
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeCategoryHints(values: readonly string[] | undefined): string[] {
  const deduped = new Map<string, string>()

  for (const value of values ?? []) {
    const normalized = normalizeDraftCategory(value)
    if (!normalized) {
      continue
    }

    const key = normalized.toLowerCase()
    if (!deduped.has(key)) {
      deduped.set(key, normalized)
    }
  }

  return [...deduped.values()].slice(0, 40)
}

function buildFallbackItem(item: AiInboxRefinementInputItem): AiInboxRefinementItem {
  return {
    id: item.id,
    label: normalizeDraftLabel(item.label),
    note: normalizeDraftNote(item.note ?? ""),
    category: normalizeDraftCategory(item.category ?? ""),
    tags: normalizeDraftTags(item.tags ?? []),
  }
}

function buildItemDigest(items: AiInboxRefinementInputItem[]): string {
  return items
    .slice(0, MAX_ITEMS)
    .map((item, index) => {
      const parts = [
        `${index + 1}. id=${item.id}`,
        `url=${item.url}`,
        item.label ? `label=${normalizeWhitespace(item.label).slice(0, 120)}` : "",
        item.note ? `note=${normalizeWhitespace(item.note).slice(0, 160)}` : "",
        item.category ? `category=${normalizeDraftCategory(item.category)}` : "",
        item.tags?.length ? `tags=${normalizeDraftTags(item.tags).join(", ")}` : "",
      ].filter(Boolean)

      return parts.join(" | ")
    })
    .join("\n")
}

function parseRefinementResponse(text: string): AiInboxRefinementItem[] {
  const trimmed = text.trim()
  if (!trimmed) {
    return []
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      items?: unknown
    }
    const items = Array.isArray(parsed.items) ? parsed.items : []

    return items
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null
        }

        const candidate = item as {
          id?: unknown
          label?: unknown
          note?: unknown
          category?: unknown
          tags?: unknown
        }

        if (typeof candidate.id !== "string") {
          return null
        }

        const tags = Array.isArray(candidate.tags)
          ? candidate.tags.filter((value): value is string => typeof value === "string")
          : []

        return {
          id: candidate.id,
          label:
            typeof candidate.label === "string"
              ? normalizeDraftLabel(candidate.label)
              : "",
          note:
            typeof candidate.note === "string"
              ? normalizeDraftNote(candidate.note)
              : "",
          category:
            typeof candidate.category === "string"
              ? normalizeDraftCategory(candidate.category)
              : null,
          tags: normalizeDraftTags(tags),
        }
      })
      .filter((item): item is AiInboxRefinementItem => item !== null)
  } catch {
    return []
  }
}

async function generateAiRefinements(
  items: AiInboxRefinementInputItem[],
  categories: string[]
): Promise<{ items: AiInboxRefinementItem[]; model: string }> {
  const aiResult = await generateAiText({
    systemInstruction: [
      "You polish saved developer-link drafts before import.",
      "Return JSON only with shape: {\"items\":[{\"id\":\"...\",\"label\":\"...\",\"note\":\"...\",\"category\":\"...\",\"tags\":[\"...\"]}]}",
      "Preserve the item id exactly.",
      "Keep labels concise and factual (max 120 chars).",
      "Keep notes to one factual sentence (max 280 chars).",
      "Use broad categories with 1-3 words.",
      "Prefer the provided category hints when one clearly fits.",
      "Tags must be factual, 1-4 items, and avoid marketing words.",
      "Do not invent details that are not implied by the URL or current metadata.",
    ].join(" "),
    prompt: [
      categories.length > 0
        ? `Available categories: ${categories.join(", ")}`
        : "No category hints provided.",
      "",
      "Items:",
      buildItemDigest(items),
    ].join("\n"),
    temperature: 0.2,
    maxOutputTokens: 900,
    responseMimeType: "application/json",
  })

  return {
    items: parseRefinementResponse(aiResult.text),
    model: aiResult.model,
  }
}

export async function refineAiInboxItems(
  input: RefineAiInboxItemsInput
): Promise<AiInboxRefinementResult> {
  const items = input.items.slice(0, MAX_ITEMS)
  const fallbackItems = items.map(buildFallbackItem)

  if (!input.useAi) {
    return {
      items: fallbackItems,
      usedAi: false,
      model: null,
      warning: null,
    }
  }

  try {
    const categories = normalizeCategoryHints(input.categories)
    const aiResult = await generateAiRefinements(items, categories)
    const fallbackById = new Map(fallbackItems.map((item) => [item.id, item]))
    const mergedItems = items.map((item) => {
      const fallback = fallbackById.get(item.id) ?? buildFallbackItem(item)
      const refined = aiResult.items.find((candidate) => candidate.id === item.id)
      if (!refined) {
        return fallback
      }

      return {
        id: item.id,
        label: refined.label || fallback.label,
        note: refined.note || fallback.note,
        category: refined.category || fallback.category,
        tags: refined.tags.length > 0 ? refined.tags : fallback.tags,
      }
    })

    return {
      items: mergedItems,
      usedAi: true,
      model: aiResult.model,
      warning: null,
    }
  } catch (error) {
    return {
      items: fallbackItems,
      usedAi: false,
      model: null,
      warning:
        error instanceof Error
          ? error.message
          : "AI refinement failed. Returned normalized metadata instead.",
    }
  }
}
