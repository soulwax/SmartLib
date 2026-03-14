import "server-only"

import { generateAiText } from "@/lib/ai-provider"

const MAX_ITEMS = 25
const MAX_ACTION_ITEMS = 4
const MAX_FOCUS_CATEGORIES = 4

export interface AiInboxSummaryItem {
  url: string
  label?: string | null
  note?: string | null
  category?: string | null
  tags?: string[]
  exactMatchCount?: number
  nearMatchCount?: number
}

export interface AiInboxBatchSummary {
  summary: string
  actionItems: string[]
  focusCategories: string[]
  usedAi: boolean
  model: string | null
  warning: string | null
}

interface SummarizeAiInboxInput {
  items: AiInboxSummaryItem[]
  useAi?: boolean
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeCategory(value: string | null | undefined): string {
  return normalizeWhitespace(value ?? "").slice(0, 80)
}

function normalizeActionItems(values: string[]): string[] {
  const deduped = new Map<string, string>()
  for (const value of values) {
    const item = normalizeWhitespace(value).slice(0, 160)
    if (!item) {
      continue
    }

    const key = item.toLowerCase()
    if (!deduped.has(key)) {
      deduped.set(key, item)
    }
  }

  return [...deduped.values()].slice(0, MAX_ACTION_ITEMS)
}

function normalizeFocusCategories(values: string[]): string[] {
  const deduped = new Map<string, string>()
  for (const value of values) {
    const item = normalizeCategory(value).slice(0, 40)
    if (!item) {
      continue
    }

    const key = item.toLowerCase()
    if (!deduped.has(key)) {
      deduped.set(key, item)
    }
  }

  return [...deduped.values()].slice(0, MAX_FOCUS_CATEGORIES)
}

function parseHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase()
  } catch {
    return "unknown-host"
  }
}

function buildCategoryCounts(items: AiInboxSummaryItem[]): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const item of items) {
    const category = normalizeCategory(item.category)
    if (!category) {
      continue
    }

    const key = category.toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_FOCUS_CATEGORIES)
}

function buildHostCounts(items: AiInboxSummaryItem[]): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const item of items) {
    const host = parseHostname(item.url)
    counts.set(host, (counts.get(host) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
}

function buildFallbackSummary(items: AiInboxSummaryItem[]): AiInboxBatchSummary {
  const normalizedItems = items.slice(0, MAX_ITEMS)
  const exactDuplicateCount = normalizedItems.filter(
    (item) => (item.exactMatchCount ?? 0) > 0
  ).length
  const nearDuplicateCount = normalizedItems.filter(
    (item) => (item.nearMatchCount ?? 0) > 0
  ).length
  const categoryCounts = buildCategoryCounts(normalizedItems)
  const hostCounts = buildHostCounts(normalizedItems)
  const focusCategories = normalizeFocusCategories(
    categoryCounts.map(([category]) => category)
  )
  const uncategorizedCount = normalizedItems.filter((item) => {
    const normalized = normalizeCategory(item.category).toLowerCase()
    return !normalized || normalized === "general"
  }).length

  const summaryParts = [
    `${normalizedItems.length} links analyzed`,
    exactDuplicateCount > 0
      ? `${exactDuplicateCount} with exact duplicates`
      : "no exact duplicates detected",
    nearDuplicateCount > 0
      ? `${nearDuplicateCount} with similar matches`
      : "minimal similarity overlap",
    focusCategories.length > 0
      ? `focus areas: ${focusCategories.join(", ")}`
      : "categories need refinement",
  ]

  const actionItems: string[] = []
  if (exactDuplicateCount > 0) {
    actionItems.push(
      "Run Smart merge first so exact duplicates enrich existing cards instead of creating more copies."
    )
  }
  if (uncategorizedCount > 0) {
    actionItems.push(
      "Assign categories to uncategorized links before import so board layout remains organized."
    )
  }
  if (nearDuplicateCount > 0) {
    actionItems.push(
      "Review similar matches and combine notes when links appear to cover the same topic."
    )
  }
  if (hostCounts.length > 0) {
    actionItems.push(
      `Prioritize top sources first: ${hostCounts
        .map(([host]) => host)
        .join(", ")}.`
    )
  }

  if (actionItems.length === 0) {
    actionItems.push("Import selected links directly; this batch is already clean.")
  }

  return {
    summary: summaryParts.join("; "),
    actionItems: normalizeActionItems(actionItems),
    focusCategories,
    usedAi: false,
    model: null,
    warning: null,
  }
}

function buildItemDigest(items: AiInboxSummaryItem[]): string {
  return items
    .slice(0, MAX_ITEMS)
    .map((item, index) => {
      const parts = [
        `${index + 1}.`,
        `url=${item.url}`,
        item.label ? `label=${normalizeWhitespace(item.label).slice(0, 120)}` : "",
        item.note ? `note=${normalizeWhitespace(item.note).slice(0, 120)}` : "",
        item.category ? `category=${normalizeCategory(item.category)}` : "",
        item.tags?.length ? `tags=${item.tags.join(", ")}` : "",
        typeof item.exactMatchCount === "number"
          ? `exact=${item.exactMatchCount}`
          : "",
        typeof item.nearMatchCount === "number" ? `similar=${item.nearMatchCount}` : "",
      ].filter(Boolean)

      return parts.join(" | ")
    })
    .join("\n")
}

function parseSummaryFromText(text: string): {
  summary: string | null
  actionItems: string[]
  focusCategories: string[]
} {
  const trimmed = text.trim()
  if (!trimmed) {
    return {
      summary: null,
      actionItems: [],
      focusCategories: [],
    }
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      summary?: unknown
      actions?: unknown
      actionItems?: unknown
      focusCategories?: unknown
      categories?: unknown
    }

    const summary =
      typeof parsed.summary === "string"
        ? normalizeWhitespace(parsed.summary).slice(0, 240)
        : null
    const actionListRaw = Array.isArray(parsed.actions)
      ? parsed.actions
      : Array.isArray(parsed.actionItems)
        ? parsed.actionItems
        : []
    const focusCategoriesRaw = Array.isArray(parsed.focusCategories)
      ? parsed.focusCategories
      : Array.isArray(parsed.categories)
        ? parsed.categories
        : []

    return {
      summary,
      actionItems: normalizeActionItems(
        actionListRaw.filter((item): item is string => typeof item === "string")
      ),
      focusCategories: normalizeFocusCategories(
        focusCategoriesRaw.filter((item): item is string => typeof item === "string")
      ),
    }
  } catch {
    const lines = trimmed
      .split("\n")
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean)
    const summary = lines[0] ?? null
    const actionItems = normalizeActionItems(lines.slice(1, 5))
    return {
      summary: summary?.slice(0, 240) ?? null,
      actionItems,
      focusCategories: [],
    }
  }
}

async function generateAiSummary(
  items: AiInboxSummaryItem[]
): Promise<{
  summary: string
  actionItems: string[]
  focusCategories: string[]
  model: string
}> {
  const digest = buildItemDigest(items)

  const aiResult = await generateAiText({
    systemInstruction:
      "You summarize batches of developer links. Return JSON only with shape: {\"summary\":\"...\",\"actions\":[\"...\"],\"focusCategories\":[\"...\"]}. Summary max 200 chars. actions: 2-4 short action items. focusCategories: up to 4 short categories.",
    prompt: [
      "Summarize this AI inbox batch and propose next actions.",
      "",
      "Items:",
      digest,
    ].join("\n"),
    temperature: 0.2,
    maxOutputTokens: 280,
    responseMimeType: "application/json",
  })
  const parsed = parseSummaryFromText(aiResult.text)
  if (!parsed.summary) {
    throw new Error("AI did not return a usable inbox summary.")
  }

  return {
    summary: parsed.summary,
    actionItems:
      parsed.actionItems.length > 0
        ? parsed.actionItems
        : ["Review duplicates first, then import the highest-value links."],
    focusCategories: parsed.focusCategories,
    model: aiResult.model,
  }
}

export async function summarizeAiInboxBatch(
  input: SummarizeAiInboxInput
): Promise<AiInboxBatchSummary> {
  const items = input.items.slice(0, MAX_ITEMS)
  const fallback = buildFallbackSummary(items)

  if (!input.useAi) {
    return fallback
  }

  try {
    const aiSummary = await generateAiSummary(items)
    return {
      summary: aiSummary.summary,
      actionItems: normalizeActionItems(aiSummary.actionItems),
      focusCategories: normalizeFocusCategories(aiSummary.focusCategories),
      usedAi: true,
      model: aiSummary.model,
      warning: null,
    }
  } catch (error) {
    return {
      ...fallback,
      warning:
        error instanceof Error
          ? error.message
          : "AI summary failed; fallback summary was returned.",
    }
  }
}
